"""Fixing the dates and times of a deployment's images — between copying the cards and importing them.

A camera's clock goes wrong: it is reset to its factory date when the batteries run out, someone sets it an hour or a
day off, it jumps when the settings are lost halfway. timeline() reads the images of a copied card in the order the
camera numbered them, with when each one says it was taken, and splits them where the time goes backwards — each
piece a "segment" taken with one setting of the clock. Each segment is set against the deployment's period (its row of
the collection's FileTimestampLog, in the cameras' clock), and for one outside it an offset is suggested: the first
segment to start at the deployment's start, a later one to go on from where the one before ended.

The fixes are made on the copy of the card in the cards folder, never on the card itself:

  * shift() moves the date and time of a run of images (from one image to another, in the camera's order) by an
    offset, with ExifTool — every date of the image: DateTimeOriginal, CreateDate and ModifyDate;
  * remove() takes out images whose time can't be made right — nothing goes on without a time to trust.

No second copy of the card is kept: every fix is written down in the deployment's time_corrections.json — what, to
which images, by how much, why, when and by whom — so a shift can be undone by shifting back. Nothing is changed
without a record of it.
"""
from __future__ import annotations

import datetime as dt
import getpass
import json
import logging
import subprocess
from pathlib import Path

from wildintel_uploader.core import config, parallel
from wildintel_uploader.core.services import camera_info
from wildintel_uploader.core.services import deployment_import_service as dis
from wildintel_uploader.core.services import ingest_service, local_folder_service

logger = logging.getLogger(__name__)

CORRECTIONS_FILE = "time_corrections.json"
_OWN_FILES = {CORRECTIONS_FILE, ingest_service.COPY_RECORD_FILE}


class TimeFixError(Exception):
    """A deployment's images can't be read or fixed."""


def _dir(research_project_id: str, collection: str, deployment_id: str, settings: config.Settings | None) -> Path:
    try:
        cards = ingest_service.card_collection_dir(research_project_id, collection, settings)
    except ingest_service.IngestError as exc:
        raise TimeFixError(str(exc)) from exc
    if not deployment_id or "/" in deployment_id or "\\" in deployment_id or deployment_id.startswith("."):
        raise TimeFixError(f"'{deployment_id}' is not a deployment.")
    folder = cards / deployment_id
    if not folder.is_dir():
        raise TimeFixError(f"{deployment_id} has no copied card in {cards}.")
    return folder


def _images(folder: Path) -> list[Path]:
    return sorted((p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in dis.IMAGE_EXTENSIONS), key=lambda p: dis._natural_key(Path(p.name)))


def read_corrections(folder: Path) -> list[dict]:
    try:
        data = json.loads((folder / CORRECTIONS_FILE).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return data if isinstance(data, list) else []


def _record(folder: Path, entry: dict) -> None:
    try:
        user = getpass.getuser()
    except Exception:
        user = None
    entries = read_corrections(folder)
    entries.append({"at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "by": user, **entry})
    (folder / CORRECTIONS_FILE).write_text(json.dumps(entries, indent=2, ensure_ascii=False), encoding="utf-8")


def collections(research_project_id: str, settings: config.Settings | None = None) -> list[dict]:
    """The collections with copied cards, newest first, each with its deployment folders that hold images."""
    project = config.cards_dir(settings) / research_project_id
    if not project.is_dir():
        return []
    out = []
    for folder in sorted((p for p in project.iterdir() if p.is_dir()), key=lambda p: p.name, reverse=True):
        deployments = [p.name for p in sorted(folder.iterdir()) if p.is_dir() and any(_images(p))]
        if deployments:
            out.append({"collection": folder.name, "deployments": deployments})
    return out


def _period(cards: Path, deployment_id: str, settings: config.Settings) -> tuple[dt.datetime, dt.datetime] | None:
    """The deployment's start and end as the cameras' clock shows them — from the FileTimestampLog beside its folder."""
    try:
        rows = local_folder_service.read_timestamp_log(local_folder_service.timestamp_log_path(cards))
    except local_folder_service.LocalFolderError:
        return None
    row = next((r for r in rows if r["Deployment"].lower() == deployment_id.lower()), None)
    if row is None:
        return None
    try:
        start = dt.datetime.strptime(f"{row['StartDate']} {row['StartTime']}", "%Y:%m:%d %H:%M:%S")
        end = dt.datetime.strptime(f"{row['EndDate']} {row['EndTime']}", "%Y:%m:%d %H:%M:%S")
    except ValueError:
        return None
    zone = settings.FIELDLOG.camera_timezone
    return ingest_service._camera_local(start, zone), ingest_service._camera_local(end, zone)


def timeline(research_project_id: str, collection: str, deployment_id: str, settings: config.Settings | None = None) -> dict:
    """A deployment's images in the camera's order, when each says it was taken, the segments they make and how each
    fits the deployment's period — with an offset suggested for those that don't — and the fixes made so far.

    Raises:
        TimeFixError: the deployment has no copied card.
    """
    settings = settings or config.load_settings()
    folder = _dir(research_project_id, collection, deployment_id, settings)
    images = _images(folder)
    times = parallel.pmap(dis._image_datetime, images, settings.GENERAL.workers)
    period = _period(folder.parent, deployment_id, settings)
    tolerance = dt.timedelta(hours=settings.POSTVALIDATION.tolerance_hours)
    lo, hi = (period[0] - tolerance, period[1] + tolerance) if period else (None, None)

    def inside(t: dt.datetime) -> bool:
        return lo is None or lo <= t <= hi

    # Segments: runs of dated images whose time never goes backwards, in the camera's order.
    segments: list[dict] = []
    previous = None
    for index, (path, when) in enumerate(zip(images, times)):
        if when is None:
            continue
        if previous is None or when < previous:
            segments.append({"first_index": index, "first": path.name, "first_time": when, "count": 0, "inside": 0})
        segment = segments[-1]
        segment.update(last_index=index, last=path.name, last_time=when)
        segment["count"] += 1
        segment["inside"] += inside(when)
        previous = when
    for i, segment in enumerate(segments):
        suggestion = None
        if period and segment["inside"] < segment["count"]:
            if i == 0:
                target, why = period[0], "so that it starts when the deployment started"
            else:
                target, why = segments[i - 1]["last_time"] + dt.timedelta(seconds=1), "so that it goes on from where the one before ended"
            offset = int((target - segment["first_time"]).total_seconds())
            suggestion = {"offset_seconds": offset, "why": why}
        segment["suggestion"] = suggestion
        segment["state"] = "ok" if segment["inside"] == segment["count"] else ("outside" if segment["inside"] == 0 else "partly")
    for segment in segments:
        segment["first_time"] = segment["first_time"].isoformat()
        segment["last_time"] = segment["last_time"].isoformat()
    undated = [p.name for p, t in zip(images, times) if t is None]
    outside = sum(1 for t in times if t is not None and not inside(t))
    problems = []
    if undated:
        problems.append(f"{len(undated)} image(s) have no date.")
    if len(segments) > 1:
        problems.append(f"The time goes backwards {len(segments) - 1} time(s): the images make {len(segments)} segments.")
    if outside:
        problems.append(f"{outside} image(s) were taken outside the deployment's period.")
    if not period:
        problems.append("The collection's FileTimestampLog has no row for this deployment: the dates can't be checked against its period.")
    return {
        "deployment_id": deployment_id, "collection": folder.parent.name, "folder": str(folder),
        "period": {"start": period[0].isoformat(), "end": period[1].isoformat()} if period else None,
        "tolerance_hours": settings.POSTVALIDATION.tolerance_hours, "camera_timezone": settings.FIELDLOG.camera_timezone,
        "images": [{"name": p.name, "time": t.isoformat() if t else None} for p, t in zip(images, times)],
        "segments": segments, "undated": undated, "outside": outside, "problems": problems, "ok": not problems,
        "corrections": read_corrections(folder),
    }


def _run(images: list[Path], first: str, last: str | None) -> list[Path]:
    names = [p.name for p in images]
    if first not in names:
        raise TimeFixError(f"There is no image {first} in the deployment.")
    end = names.index(last) if last else len(names) - 1
    if last and last not in names:
        raise TimeFixError(f"There is no image {last} in the deployment.")
    start = names.index(first)
    if end < start:
        raise TimeFixError(f"{last} comes before {first}.")
    return images[start:end + 1]


def _shift_argument(offset_seconds: int) -> str:
    """ExifTool's shift, "Y:M:D h:m:s", for an offset in seconds: "-AllDates+=0:0:400 5:30:15"."""
    sign = "+" if offset_seconds >= 0 else "-"
    days, rest = divmod(abs(offset_seconds), 86400)
    hours, rest = divmod(rest, 3600)
    minutes, seconds = divmod(rest, 60)
    return f"-AllDates{sign}=0:0:{days} {hours}:{minutes}:{seconds}"


def shift(research_project_id: str, collection: str, deployment_id: str, first: str, last: str | None, offset_seconds: int,
          reason: str = "", settings: config.Settings | None = None) -> dict:
    """Moves the date and time of the images from first to last (to the end when last is None), in the camera's order,
    by offset_seconds. Returns the timeline after it.

    Raises:
        TimeFixError: no such images, no ExifTool, or ExifTool fails.
    """
    settings = settings or config.load_settings()
    folder = _dir(research_project_id, collection, deployment_id, settings)
    if not offset_seconds:
        raise TimeFixError("An offset of 0 changes nothing.")
    exiftool = camera_info.exiftool_path()
    if exiftool is None:
        raise TimeFixError("Fixing the dates needs ExifTool, and it isn't installed.")
    run = _run(_images(folder), first, last)
    argfile = folder / ".timefix-args.txt"
    argfile.write_text("\n".join(str(p) for p in run) + "\n", encoding="utf-8")
    try:
        result = subprocess.run([exiftool, "-charset", "filename=utf8", "-overwrite_original", "-P", _shift_argument(offset_seconds), "-@", str(argfile)],
                                capture_output=True, text=True, check=False)
    finally:
        argfile.unlink(missing_ok=True)
    if result.returncode != 0:
        raise TimeFixError(f"ExifTool could not change the dates: {(result.stderr or result.stdout).strip()}")
    _record(folder, {"action": "shift", "first": run[0].name, "last": run[-1].name, "count": len(run), "offset_seconds": offset_seconds, "reason": reason.strip() or None})
    logger.info("%s: %d image(s) from %s shifted by %d s", deployment_id, len(run), run[0].name, offset_seconds)
    return timeline(research_project_id, collection, deployment_id, settings)


def remove(research_project_id: str, collection: str, deployment_id: str, names: list[str], reason: str = "",
           settings: config.Settings | None = None) -> dict:
    """Takes images whose time can't be made right out of the deployment: they are deleted, and their names written down.
    Returns the timeline after it.

    Raises:
        TimeFixError: an image isn't in the deployment, or none is given.
    """
    settings = settings or config.load_settings()
    folder = _dir(research_project_id, collection, deployment_id, settings)
    present = {p.name: p for p in _images(folder)}
    missing = [n for n in names if n not in present]
    if not names:
        raise TimeFixError("No image chosen to remove.")
    if missing:
        raise TimeFixError(f"Not in the deployment: {', '.join(missing[:5])}.")
    for name in names:
        present[name].unlink()
    _record(folder, {"action": "remove", "names": names, "count": len(names), "reason": reason.strip() or None})
    logger.info("%s: %d image(s) removed for their time", deployment_id, len(names))
    return timeline(research_project_id, collection, deployment_id, settings)

