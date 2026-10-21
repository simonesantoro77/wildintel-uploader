"""Copying the SD cards — the step between the field records and the import, guided by what the field trip says.

Each card is copied, untouched, into the cards folder, in the layout an import session reads:

    <data directory>/cards/<research project id>/<R000N>/
        R000N_FileTimestampLog.csv       — a copy of the collection's own: each deployment's period
        R000N-DONA_0007/                 — one folder per deployment, the card's files in it, flat
            card_copy.json               — the copy record (see below)

The deployments come from the collection's FieldworkLog (services.fieldlog_service): a deployment whose card was
collected in the field is one to copy; one whose camera is still out is not yet. When a card is put in, the app looks
at it — how many files, when the first and last were taken, which camera — and proposes the deployment it belongs to
(the card's label as noted in the field, and the dates against each deployment's period), with what does not fit
(more or fewer files than counted in the field, dates outside the period). The user confirms, and it is copied:

  * every file of the card but the system's own (.DS_Store, Thumbs.db…), into one flat folder — a name already
    there gets its folder's name before it;
  * each file checked after it is written: its SHA-256 read back from the copy must be the one read from the card;
  * the card is never changed.

The copy record (card_copy.json) says which card it was, when and by whom it was copied, and each file with its size
and checksum — so the copy can be shown to be the card, and a card that was already copied is recognised, whichever
deployment it is offered to: its fingerprint (the names and sizes of its files) is compared with every copy record of
the research project.

Folders that come from elsewhere — organized some other way, a deployment per folder somewhere in a tree — are copied
the same way (scan_tree finds the folders with images and guesses their collection and site from the path).
"""
from __future__ import annotations

import datetime as dt
import getpass
import hashlib
import json
import logging
import os
import re
import shutil
from collections.abc import Iterator
from pathlib import Path

from wildintel_uploader.core import config, parallel
from wildintel_uploader.core.services import deployment_import_service as dis
from wildintel_uploader.core.services import fieldlog_service, local_folder_service

logger = logging.getLogger(__name__)

COPY_RECORD_FILE = "card_copy.json"
VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".m4v", ".mts"}
MEDIA_EXTENSIONS = dis.IMAGE_EXTENSIONS | VIDEO_EXTENSIONS
_JUNK = {".ds_store", "thumbs.db", "desktop.ini"}
_COLLECTION = re.compile(r"^R\d{4}$", re.IGNORECASE)
_CHUNK = 1024 * 1024


class IngestError(Exception):
    """A card or a folder can't be looked at or copied."""


# ── where things are ────────────────────────────────────────────────────────

def _check_collection(collection: str) -> str:
    if not _COLLECTION.match(collection or ""):
        raise IngestError(f"'{collection}' is not a collection like R0042.")
    return collection.upper()


def card_collection_dir(research_project_id: str, collection: str, settings: config.Settings | None = None) -> Path:
    """<cards folder>/<research project>/<R000N> — what Import session is given.

    Raises:
        IngestError: the research project id can't be a folder name, or the collection isn't like R0042.
    """
    try:
        project = local_folder_service.project_dir(config.cards_dir(settings), research_project_id)
    except local_folder_service.LocalFolderError as exc:
        raise IngestError(str(exc)) from exc
    return project / _check_collection(collection)


def _collection_dir(research_project_id: str, collection: str, settings: config.Settings | None) -> Path:
    try:
        return local_folder_service.project_dir(config.collections_dir(settings), research_project_id) / _check_collection(collection)
    except local_folder_service.LocalFolderError as exc:
        raise IngestError(str(exc)) from exc


def _is_junk(path: Path) -> bool:
    return path.name.lower() in _JUNK or path.name.startswith("._") or any(part.startswith(".") for part in path.parts)


def card_files(source: Path) -> list[Path]:
    """The files of a card or folder worth copying — everything but the system's own and hidden ones — in order."""
    return sorted((p for p in source.rglob("*") if p.is_file() and not _is_junk(p.relative_to(source))), key=lambda p: dis._natural_key(p.relative_to(source)))


def fingerprint(source: Path, files: list[Path]) -> str:
    """What tells a card apart: the names and sizes of its files. The same card copied twice has the same one."""
    digest = hashlib.sha256()
    for path in files:
        digest.update(f"{path.name.lower()}\t{path.stat().st_size}\n".encode())
    return digest.hexdigest()


def read_copy_record(deployment_dir: Path) -> dict | None:
    try:
        record = json.loads((deployment_dir / COPY_RECORD_FILE).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return record if isinstance(record, dict) else None


def _copy_records(research_project_id: str, settings: config.Settings | None) -> list[tuple[Path, dict]]:
    """Every copy record kept for the research project, in any collection."""
    project = config.cards_dir(settings) / research_project_id
    if not project.is_dir():
        return []
    out = []
    for path in sorted(project.glob(f"*/*/{COPY_RECORD_FILE}")):
        record = read_copy_record(path.parent)
        if record:
            out.append((path.parent, record))
    return out


# ── the collection ──────────────────────────────────────────────────────────

def list_collections(research_project_id: str, settings: config.Settings | None = None) -> list[str]:
    """The collections of the research project that have a FieldworkLog — the ones whose cards can be copied guided by
    the field records — newest first."""
    try:
        project = local_folder_service.project_dir(config.collections_dir(settings), research_project_id)
    except local_folder_service.LocalFolderError as exc:
        raise IngestError(str(exc)) from exc
    if not project.is_dir():
        return []
    found = [p.name for p in project.iterdir() if p.is_dir() and _COLLECTION.match(p.name) and (p / f"{p.name}{fieldlog_service.FIELDWORK_LOG_SUFFIX}").is_file()]
    return sorted(found, reverse=True)


def card_collections(research_project_id: str | None = None, settings: config.Settings | None = None) -> list[dict]:
    """The collections in the cards folder, ready for Process collection, newest first: {"research_project_id",
    "collection", "folder", "deployments" (subfolders), "processed" (of them already in the collections folder)}."""
    root = config.cards_dir(settings)
    if not root.is_dir():
        return []
    found = []
    for project in sorted(p for p in root.iterdir() if p.is_dir()):
        if research_project_id and project.name.lower() != research_project_id.lower():
            continue
        for folder in (p for p in project.iterdir() if p.is_dir() and _COLLECTION.match(p.name)):
            names = [d.name for d in folder.iterdir() if d.is_dir() and not d.name.startswith(".")]
            try:
                done = processed_deployments(_collection_dir(project.name, folder.name, settings))
            except IngestError:
                done = set()
            found.append({"research_project_id": project.name, "collection": folder.name, "folder": str(folder),
                          "deployments": len(names), "processed": sum(1 for n in names if n.lower() in done)})
    return sorted(found, key=lambda c: (c["collection"], c["research_project_id"]), reverse=True)


def field_details(research_project_id: str, collection: str, settings: config.Settings | None = None) -> dict[str, dict]:
    """What the field records say of each deployment of the collection, by deployment id: who set it up, the camera, its
    tags and notes, its site and period (UTC) and card. What Process collection fills each deployment in with."""
    rows = fieldlog_service.read_fieldwork_log(_collection_dir(research_project_id, collection, settings))
    details = {}
    for row in rows:
        tags = [t.strip() for t in re.split(r"[;,|]", row.get("deploymentTags") or "") if t.strip()]
        details[row.get("deploymentID", "")] = {
            "location_id": row.get("locationID") or None, "start": row.get("deploymentStart") or None, "end": row.get("deploymentEnd") or None,
            "setup_by": row.get("setupBy") or None, "camera_id": row.get("cameraID") or None, "tags": tags,
            "comments": row.get("deploymentComments") or None, "card": row.get("cardSD") or None,
        }
    return details


def collection_status(research_project_id: str, collection: str, settings: config.Settings | None = None) -> dict:
    """Each deployment of the collection, as the field records say it and as far as its card has been copied:
    "out" (camera still out there), "to_copy" (card collected, not copied yet), "copied" or "processed" (already in
    the collection's folder, by Process collection) — with the copy record's
    summary. Copies of deployments the field records don't know are listed as "unexpected".

    Raises:
        IngestError: the research project or collection can't be a folder name.
    """
    collection = _check_collection(collection)
    collection_dir = _collection_dir(research_project_id, collection, settings)
    rows = fieldlog_service.read_fieldwork_log(collection_dir)
    cards = card_collection_dir(research_project_id, collection, settings)
    processed = processed_deployments(collection_dir)
    deployments = []
    known = set()
    for row in rows:
        deployment_id = row.get("deploymentID", "")
        known.add(deployment_id.lower())
        record = read_copy_record(cards / deployment_id)
        if deployment_id.lower() in processed:
            state = "processed"
        elif record:
            state = "copied"
        else:
            state = "to_copy" if row.get("status") == "closed" else "out"
        deployments.append({
            "deployment_id": deployment_id, "site": row.get("locationID"), "state": state,
            "start": row.get("deploymentStart") or None, "end": row.get("deploymentEnd") or None,
            "card": row.get("cardSD") or None, "camera_id": row.get("cameraID") or None,
            "photos_counted": int(row["photosCounted"]) if (row.get("photosCounted") or "").isdigit() else None,
            "copy": _record_summary(record),
        })
    unexpected = []
    if cards.is_dir():
        for folder in sorted(p for p in cards.iterdir() if p.is_dir()):
            record = read_copy_record(folder)
            if record and folder.name.lower() not in known:
                unexpected.append({"deployment_id": folder.name, "copy": _record_summary(record)})
    counts = {state: sum(1 for d in deployments if d["state"] == state) for state in ("out", "to_copy", "copied", "processed")}
    return {
        "collection": collection, "cards_dir": str(cards), "has_fieldwork_log": bool(rows),
        "deployments": deployments, "unexpected": unexpected, "counts": counts,
    }


def processed_deployments(collection_dir: Path) -> set[str]:
    """The deployments already processed into the collection, lower-cased: each a folder holding its deployment.json."""
    try:
        return {p.name.lower() for p in collection_dir.iterdir()
                if p.is_dir() and (p / local_folder_service.DEPLOYMENT_METADATA_FILE).is_file()}
    except OSError:
        return set()


def _record_summary(record: dict | None) -> dict | None:
    if not record:
        return None
    return {k: record.get(k) for k in ("card_label", "copied_at", "copied_by", "file_count", "total_bytes", "source", "first", "last")}


def prepare_collection(research_project_id: str, collection: str, settings: config.Settings | None = None) -> dict:
    """Makes the collection's cards folder ready to receive the cards: the folder itself, a copy of the collection's
    FileTimestampLog (what Import session reads each deployment's period from) and an empty folder for each deployment
    whose card was collected. Returns collection_status.

    Raises:
        IngestError: the collection has no FieldworkLog yet (run the field records first), or a folder can't be made.
    """
    status = collection_status(research_project_id, collection, settings)
    if not status["has_fieldwork_log"]:
        raise IngestError(f"{status['collection']} has no field records yet: run Field records first.")
    cards = Path(status["cards_dir"])
    source_log = local_folder_service.timestamp_log_path(_collection_dir(research_project_id, collection, settings))
    try:
        cards.mkdir(parents=True, exist_ok=True)
        if source_log.is_file():
            shutil.copy2(source_log, cards / source_log.name)
        for d in status["deployments"]:
            if d["state"] in ("to_copy", "copied"):
                (cards / d["deployment_id"]).mkdir(exist_ok=True)
    except OSError as exc:
        raise IngestError(f"Could not prepare {cards}: {exc}") from exc
    return collection_status(research_project_id, collection, settings)


# ── looking at a card ───────────────────────────────────────────────────────

def _parse_utc(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    try:
        return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return None


def _camera_local(when_utc: dt.datetime, timezone: str) -> dt.datetime:
    """A UTC time as the cameras' clock shows it — the same unless the settings say they are set otherwise."""
    if timezone.upper() == "UTC":
        return when_utc
    from zoneinfo import ZoneInfo
    return when_utc.replace(tzinfo=dt.timezone.utc).astimezone(ZoneInfo(timezone)).replace(tzinfo=None)


def inspect_source(source: str, research_project_id: str, collection: str, card_label: str | None = None,
                   settings: config.Settings | None = None) -> dict:
    """A card (or any folder) looked at before it is copied: its files, when the first and last image were taken,
    the cameras, whether it was copied already, and the deployments of the collection it may belong to — best first,
    each with what fits and what doesn't.

    Raises:
        IngestError: the source isn't a folder, or has no files.
    """
    settings = settings or config.load_settings()
    root = Path(source).expanduser()
    if not root.is_dir():
        raise IngestError(f"Not a folder: {source}")
    files = card_files(root)
    if not files:
        raise IngestError(f"There are no files in {root}.")
    images = [p for p in files if p.suffix.lower() in dis.IMAGE_EXTENSIONS]
    videos = [p for p in files if p.suffix.lower() in VIDEO_EXTENSIONS]
    dates = [d for d in parallel.pmap(dis._image_datetime, images, settings.GENERAL.workers) if d]
    models = sorted({m for m in (dis._image_camera_model(p) for p in images[:: max(1, len(images) // 10)][:10]) if m})
    print_ = fingerprint(root, files)
    copies = [
        {"deployment_id": folder.name, "collection": folder.parent.name, "copied_at": record.get("copied_at"), "card_label": record.get("card_label")}
        for folder, record in _copy_records(research_project_id, settings) if record.get("fingerprint") == print_
    ]
    status = collection_status(research_project_id, collection, settings)
    tolerance = dt.timedelta(hours=settings.POSTVALIDATION.tolerance_hours)
    count_tolerance = settings.INGEST.count_tolerance / 100
    timezone = settings.FIELDLOG.camera_timezone
    label = (card_label or "").strip().lower()
    candidates = []
    for d in status["deployments"]:
        if d["state"] != "to_copy":  # a camera still out has no card yet; a card copied is not offered again
            continue
        start, end = _parse_utc(d["start"]), _parse_utc(d["end"])
        score, fits, problems = 0.0, [], []
        if label and d["card"] and d["card"].strip().lower() == label:
            score += 100
            fits.append(f"Card {d['card']}, as noted in the field.")
        elif label and d["card"]:
            problems.append(f"The field records say card {d['card']}, not {card_label}.")
        if start and end and dates:
            lo, hi = _camera_local(start, timezone) - tolerance, _camera_local(end, timezone) + tolerance
            inside = sum(1 for x in dates if lo <= x <= hi)
            share = inside / len(dates)
            score += 50 * share
            if share == 1:
                fits.append("Every image was taken within its period.")
            else:
                problems.append(f"{len(dates) - inside} of {len(dates)} images were taken outside its period ({d['start']} – {d['end']}).")
        if d["photos_counted"]:
            counted = d["photos_counted"]
            if abs(len(files) - counted) <= count_tolerance * counted:
                score += 10
                fits.append(f"{len(files)} files for {counted} photos counted in the field.")
            else:
                problems.append(f"{len(files)} files, but {counted} photos were counted in the field.")
        candidates.append({**d, "score": round(score, 1), "fits": fits, "problems": problems})
    candidates.sort(key=lambda c: (-c["score"], c["deployment_id"]))
    return {
        "source": str(root), "file_count": len(files), "image_count": len(images), "video_count": len(videos),
        "other_count": len(files) - len(images) - len(videos), "total_bytes": sum(p.stat().st_size for p in files),
        "subfolders": len({p.parent for p in files}), "first": min(dates).isoformat() if dates else None,
        "last": max(dates).isoformat() if dates else None, "undated": len(images) - len(dates),
        "camera_models": models, "fingerprint": print_, "already_copied": copies,
        "candidates": candidates[:8], "collection": status["collection"],
    }


# ── copying ─────────────────────────────────────────────────────────────────

def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _copy_checked(source: Path, target: Path) -> str:
    """Copies one file, its checksum read on the way, and checks the copy by reading it back.

    Raises:
        IngestError: the copy doesn't match the card.
    """
    partial = target.with_name(target.name + ".part")
    digest = hashlib.sha256()
    with source.open("rb") as src, partial.open("wb") as dst:
        for chunk in iter(lambda: src.read(_CHUNK), b""):
            digest.update(chunk)
            dst.write(chunk)
    expected = digest.hexdigest()
    if _sha256(partial) != expected:
        partial.unlink(missing_ok=True)
        raise IngestError(f"The copy of {source.name} does not match the card: it was not kept. Try the card again.")
    shutil.copystat(source, partial)
    os.replace(partial, target)
    return expected


def _targets(root: Path, files: list[Path]) -> list[str]:
    """The name each file gets in the flat deployment folder: its own, or — if another file already took it — with its
    folder's name before it (100MEDIA_IMG_0001.JPG)."""
    taken: set[str] = set()
    names = []
    for path in files:
        name = path.name
        if name.lower() in taken:
            parent = "_".join(path.relative_to(root).parent.parts) or "card"
            name = f"{parent}_{path.name}"
            n = 2
            while name.lower() in taken:
                name, n = f"{parent}_{n}_{path.name}", n + 1
        taken.add(name.lower())
        names.append(name)
    return names


def copy_stream(source: str, research_project_id: str, collection: str, deployment_id: str, card_label: str | None = None,
                settings: config.Settings | None = None, *, allow_unknown: bool = False, label_confirmed: bool = False) -> Iterator[dict]:
    """Copies a card into its deployment's folder of the cards folder. Yields {"type": "copy", "index", "total",
    "name"} per file and ends with {"type": "done", "record"}. The deployment folder must be empty, and the card not
    copied before (its fingerprint in no copy record of the research project). allow_unknown lets a deployment that is
    not in the field records be copied (folders that come from elsewhere).

    Raises:
        IngestError: before anything is copied, when one of those doesn't hold; while copying, when a file can't be
            read or written, or its copy doesn't match.
    """
    settings = settings or config.load_settings()
    root = Path(source).expanduser()
    if not root.is_dir():
        raise IngestError(f"Not a folder: {source}")
    collection = _check_collection(collection)
    if not re.match(rf"^{collection}-[0-9A-Za-z][0-9A-Za-z_.-]*$", deployment_id or "", re.IGNORECASE):
        raise IngestError(f"'{deployment_id}' is not a deployment of {collection} (like {collection}-DONA_0007).")
    if not allow_unknown:
        status = collection_status(research_project_id, collection, settings)
        known = {d["deployment_id"].lower(): d for d in status["deployments"]}
        if deployment_id.lower() not in known:
            raise IngestError(f"{deployment_id} is not in the field records of {collection}.")
        if known[deployment_id.lower()]["state"] == "out":
            raise IngestError(f"The field records say the camera of {deployment_id} is still out: its card was not collected.")
        field_card = known[deployment_id.lower()]["card"]
        if not (card_label or "").strip():
            raise IngestError("Type the label written on the card: it is checked against the one noted in the field.")
        mismatch = bool(field_card) and field_card.strip().lower() != card_label.strip().lower()
        if mismatch and not label_confirmed:
            raise IngestError(f"The card in your hand is {card_label.strip()}, but the field records say {field_card} for {deployment_id}. "
                              "Confirm it is the right card to copy it anyway: it is written down as a correction for the field data.")
    else:
        field_card, mismatch = None, False
    files = card_files(root)
    if not files:
        raise IngestError(f"There are no files in {root}.")
    print_ = fingerprint(root, files)
    for folder, record in _copy_records(research_project_id, settings):
        if record.get("fingerprint") == print_:
            raise IngestError(f"This card was already copied, as {folder.name} ({record.get('copied_at')}).")
    cards = card_collection_dir(research_project_id, collection, settings)
    dest = cards / deployment_id
    if dest.is_dir() and any(p for p in dest.iterdir() if not p.name.startswith(".")):
        raise IngestError(f"{dest} already holds files: a deployment gets one card.")
    try:
        if dest.resolve() == root.resolve() or dest.resolve().is_relative_to(root.resolve()):
            raise IngestError("The card can't be copied into itself.")
    except OSError as exc:
        raise IngestError(f"Could not resolve the paths: {exc}") from exc
    try:
        dest.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise IngestError(f"Could not make {dest}: {exc}") from exc
    names = _targets(root, files)
    entries = []
    for index, (path, name) in enumerate(zip(files, names), start=1):
        try:
            checksum = _copy_checked(path, dest / name)
        except OSError as exc:
            raise IngestError(f"Could not copy {path.relative_to(root)}: {exc}") from exc
        entries.append({"name": name, "source": str(path.relative_to(root)), "size": path.stat().st_size, "sha256": checksum})
        yield {"type": "copy", "index": index, "total": len(files), "name": name}
    images = [dest / e["name"] for e in entries if Path(e["name"]).suffix.lower() in dis.IMAGE_EXTENSIONS]
    dates = [d for d in parallel.pmap(dis._image_datetime, images, settings.GENERAL.workers) if d]
    try:
        user = getpass.getuser()
    except Exception:
        user = None
    record = {
        "deployment_id": deployment_id, "collection": collection, "research_project_id": research_project_id,
        "card_label": (card_label or "").strip() or None, "source": str(root),
        "copied_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "copied_by": user,
        "file_count": len(entries), "total_bytes": sum(e["size"] for e in entries),
        "first": min(dates).isoformat() if dates else None, "last": max(dates).isoformat() if dates else None,
        "field_card": field_card, "label_mismatch": mismatch,
        "fingerprint": print_, "files": entries,
    }
    (dest / COPY_RECORD_FILE).write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")
    if mismatch:
        _note_correction(cards, deployment_id, field_card, (card_label or "").strip(), record["copied_at"], user)
    logger.info("Card %s copied into %s: %d files", card_label or root, dest, len(entries))
    yield {"type": "done", "record": _record_summary(record) | {"deployment_id": deployment_id, "path": str(dest)}}


FIELD_CORRECTIONS_FILE = "field_corrections.csv"


def _note_correction(cards: Path, deployment_id: str, field_card: str | None, card: str, when: str, user: str | None) -> None:
    """Writes down, in the collection's field_corrections.csv, a card whose label is not the one the field records say,
    for the field data (the field app, the datasheet) to be corrected."""
    import csv
    path = cards / FIELD_CORRECTIONS_FILE
    new = not path.is_file()
    with path.open("a", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        if new:
            writer.writerow(["deployment", "what", "field records say", "found", "when (UTC)", "by"])
        writer.writerow([deployment_id, "card label", field_card or "", card, when, user or ""])


def read_corrections(research_project_id: str, collection: str, settings: config.Settings | None = None) -> list[dict]:
    """The corrections for the field data written down while copying the collection's cards."""
    import csv
    path = card_collection_dir(research_project_id, collection, settings) / FIELD_CORRECTIONS_FILE
    if not path.is_file():
        return []
    with path.open(newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


# ── ejecting the card ───────────────────────────────────────────────────────

def eject(source: str) -> dict:
    """Ejects the removable drive a card was copied from, so it can be taken out: {"ejected", "message"}. Only a drive the
    system says is removable is ejected, never a folder of a fixed disk."""
    import platform
    import subprocess
    path = Path(source).expanduser()
    system = platform.system()
    if system == "Windows":
        drive = path.drive  # "E:"
        if not drive:
            return {"ejected": False, "message": "The card is not on a drive of its own."}
        import ctypes
        if ctypes.windll.kernel32.GetDriveTypeW(f"{drive}\\") != 2:  # DRIVE_REMOVABLE
            return {"ejected": False, "message": f"{drive} is not a removable drive: nothing ejected."}
        script = f"(New-Object -ComObject Shell.Application).Namespace(17).ParseName('{drive}').InvokeVerb('Eject')"
        result = subprocess.run(["powershell", "-NoProfile", "-STA", "-Command", script], capture_output=True, text=True, check=False)
        if result.returncode != 0:
            return {"ejected": False, "message": f"Could not eject {drive}: {result.stderr.strip()}"}
        return {"ejected": True, "message": f"{drive} ejected: you can take the card out."}
    if system == "Darwin":
        parts = path.resolve().parts
        if len(parts) < 3 or parts[1] != "Volumes":
            return {"ejected": False, "message": "The card is not a mounted volume."}
        volume = Path("/", parts[1], parts[2])
        result = subprocess.run(["diskutil", "eject", str(volume)], capture_output=True, text=True, check=False)
        ok = result.returncode == 0
        return {"ejected": ok, "message": f"{volume.name} ejected: you can take the card out." if ok else f"Could not eject {volume.name}: {result.stderr.strip()}"}
    return {"ejected": False, "message": "Eject the card from the system before taking it out."}


# ── folders that come from elsewhere ────────────────────────────────────────

def scan_tree(root: str, research_project_id: str | None = None, settings: config.Settings | None = None) -> dict:
    """The folders under root that hold images directly — each a deployment's images, whatever way the tree is
    organized — with a guess of its collection (an R0042 anywhere in its path) and its site (a part of the path that is
    one of the research project's locations, ignoring case). Returns {"root", "folders": [{"path", "relative",
    "image_count", "file_count", "collection", "site", "deployment_id"}]}.

    Raises:
        IngestError: root isn't a folder.
    """
    base = Path(root).expanduser()
    if not base.is_dir():
        raise IngestError(f"Not a folder: {root}")
    sites: dict[str, str] = {}
    if research_project_id:
        try:
            for location in local_folder_service.list_locations(config.collections_dir(settings), research_project_id):
                if location.get("location_id"):
                    sites[str(location["location_id"]).lower()] = str(location["location_id"])
        except local_folder_service.LocalFolderError:
            pass
    by_folder: dict[Path, list[Path]] = {}
    for path in card_files(base):
        by_folder.setdefault(path.parent, []).append(path)
    folders = []
    for folder, files in sorted(by_folder.items(), key=lambda kv: str(kv[0]).lower()):
        images = [p for p in files if p.suffix.lower() in MEDIA_EXTENSIONS]
        if not images:
            continue
        relative = folder.relative_to(base)
        parts = [base.name, *relative.parts]
        joined = "/".join(parts)
        collection = next((m.group(0).upper() for m in re.finditer(r"R\d{4}", joined, re.IGNORECASE)), None)
        site = None
        for part in reversed(parts):
            candidate = re.sub(r"^R\d{4}-", "", part, flags=re.IGNORECASE)
            if candidate.lower() in sites:
                site = sites[candidate.lower()]
                break
        folders.append({
            "path": str(folder), "relative": str(relative) if str(relative) != "." else base.name,
            "image_count": len(images), "file_count": len(files), "collection": collection, "site": site,
            "deployment_id": f"{collection}-{site}" if collection and site else None,
        })
    return {"root": str(base), "folders": folders}
