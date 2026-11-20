"""Repairing a deployment kept in the collections folder: if its metadata files are gone, or its seal no longer matches,
they are written again from what the folder itself holds.

    <collections folder>/<research project id>/<R0003>/<deployment id>/
        <images>, deployment.json, images.json, preprocessing.json, seal.json
    <collections folder>/<research project id>/<R0003>/<R0003>_FileTimestampLog.csv

A deployment is **valid** when its seal.json still matches it (seal_service.verify); anything else is not. Repairing it:

  - reads the capture date of every image (the camera's wall clock, from its EXIF) and its camera;
  - takes the deployment's period from the collection's FileTimestampLog.csv if the deployment has a row there — the log
    always prevails over what the images say — and, if it has none, from the deployment.json that is left or else from the
    images, and adds the row;
  - writes deployment.json (what is left of it, the location's details and the camera, plus that period), preprocessing.json
    and images.json, as the images are;
  - validates and postvalidates the images (and checks the preprocessing: their names, sizes and metadata) and writes a new
    seal.json with the result, and a report of it all.

What can't be known is left as it was or empty: the original name of a renamed image, and the options it was preprocessed
with, unless a preprocessing.json that is left says so. A deployment synced from Trapper is not touched."""
from __future__ import annotations

import json
import logging
import re
import subprocess
from collections.abc import Iterator
from dataclasses import asdict, fields
from datetime import datetime, timezone
from pathlib import Path

from pydantic import ValidationError

from wildintel_uploader.core import config, parallel
from wildintel_uploader.core.schemas.requests import DeploymentFields
from wildintel_uploader.core.services import camera_info, local_folder_service, report_service, seal_service
from wildintel_uploader.core.services import deployment_import_service as dis
from wildintel_uploader.core.services import preprocessing_service as pre
from wildintel_uploader.core.services.deployment_import_service import DeploymentImportError

logger = logging.getLogger(__name__)

_COLLECTION = re.compile(r"^R\d{4}(_.+)?$")
_DEPLOYMENT = re.compile(r"^R\d{4}-.+$")
_METADATA_FILES = (local_folder_service.DEPLOYMENT_METADATA_FILE, local_folder_service.IMAGES_FILE, pre.PREPROCESSING_LOG_FILE, seal_service.SEAL_FILE)
_XMP_BATCH = 200


class RepairError(DeploymentImportError):
    """A deployment that can't be inspected or repaired — and why."""


# ── what is there ────────────────────────────────────────────────────────────

def _read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _images_in(folder: Path) -> list[Path]:
    return seal_service._images_of(folder)


def _collection_dir(collections_dir: Path, research_project_id: str, collection: str) -> Path:
    if not _COLLECTION.match(collection):
        raise RepairError(f"'{collection}' isn't a collection's name.")
    try:
        folder = local_folder_service.project_dir(collections_dir, research_project_id) / collection
    except local_folder_service.LocalFolderError as exc:
        raise RepairError(str(exc)) from exc
    if not folder.is_dir():
        raise RepairError(f"The collection {collection} isn't in {research_project_id}.")
    return folder


def _deployment_dir(collections_dir: Path, research_project_id: str, collection: str, deployment_id: str) -> Path:
    if not _DEPLOYMENT.match(deployment_id):
        raise RepairError(f"'{deployment_id}' isn't a deployment's id.")
    dest = _collection_dir(collections_dir, research_project_id, collection) / deployment_id
    if not dest.is_dir():
        raise RepairError(f"{deployment_id} isn't in the collection {collection}.")
    return dest


def list_collections(collections_dir: Path, research_project_id: str) -> list[dict]:
    """The collections kept for a research project and the folders in each that are deployments — whatever state they are in:
    even one with no metadata at all. Cheap: nothing is read but the folder's names (see inspect for the state of one)."""
    try:
        project = local_folder_service.project_dir(collections_dir, research_project_id)
    except local_folder_service.LocalFolderError as exc:
        raise RepairError(str(exc)) from exc
    if not project.is_dir():
        return []
    collections = []
    for collection in sorted(project.iterdir()):
        if not (collection.is_dir() and _COLLECTION.match(collection.name)):
            continue
        deployments = [
            {"deployment_id": folder.name, "images": len(_images_in(folder)), "files": {name: (folder / name).is_file() for name in _METADATA_FILES},
             "synced": local_folder_service.is_synced(folder)}
            for folder in sorted(collection.iterdir()) if folder.is_dir() and _DEPLOYMENT.match(folder.name)
        ]
        collections.append({"name": collection.name, "path": str(collection), "deployments": deployments})
    return collections


def _log_row(collection: Path, deployment_id: str) -> tuple[dict | None, str | None]:
    """The deployment's row in the collection's timestamp log, and what is wrong with the log if it can't be read."""
    try:
        rows = local_folder_service.read_timestamp_log(local_folder_service.timestamp_log_path(collection))
    except local_folder_service.LocalFolderError as exc:
        return None, str(exc)
    return next((r for r in rows if r["Deployment"].upper() == deployment_id.upper()), None), None


def _row_times(row: dict) -> tuple[datetime, datetime]:
    try:
        return (datetime.strptime(f"{row['StartDate']} {row['StartTime']}", "%Y:%m:%d %H:%M:%S"),
                datetime.strptime(f"{row['EndDate']} {row['EndTime']}", "%Y:%m:%d %H:%M:%S"))
    except ValueError as exc:
        raise RepairError(f"The timestamp log's row of this deployment can't be read: {exc}") from exc


def inspect(collections_dir: Path, research_project_id: str, collection: str, deployment_id: str) -> dict:
    """The state of one deployment: {"deployment_id", "status": "valid" | "broken" | "unsealed" | "synced", "seal": verify()'s answer,
    "files": {name: "ok" | "missing" | "unreadable"}, "images", "log": "row" | "no row" | "no log" | <what is wrong with it>, "problems": [...]}.
    Valid is what seal.json says — nothing else decides it."""
    dest = _deployment_dir(collections_dir, research_project_id, collection, deployment_id)
    images = _images_in(dest)
    files = {}
    for name in _METADATA_FILES:
        path = dest / name
        files[name] = "missing" if not path.is_file() else ("ok" if _read_json(path) is not None else "unreadable")
    row, log_problem = _log_row(dest.parent, deployment_id)
    log = log_problem or ("row" if row else ("no row" if local_folder_service.timestamp_log_path(dest.parent).is_file() else "no log"))
    if local_folder_service.is_synced(dest):
        return {"deployment_id": deployment_id, "status": "synced", "seal": None, "files": files, "images": len(images), "log": log,
                "problems": ["It was synced from TRAPPER: what TRAPPER holds is not modified here."]}
    seal = seal_service.verify(dest)
    status = {"valid": "valid", "broken": "broken", "none": "unsealed"}[seal["status"]]
    problems = [f"{name} is {state}" for name, state in files.items() if state != "ok" and not (name == seal_service.SEAL_FILE and state == "missing")]
    if seal["status"] == "none":
        problems.append("It has no seal: its images were never sealed.")
    if seal["status"] == "broken":
        for key, text in (("changed", "image(s) changed since they were sealed"), ("missing", "sealed image(s) missing"), ("added", "image(s) added since it was sealed")):
            if seal[key]:
                problems.append(f"{len(seal[key])} {text}")
        if seal["deployment_changed"]:
            problems.append("deployment.json is not what was sealed")
        if seal["seal_changed"]:
            problems.append("seal.json itself was changed")
    if log in ("no row", "no log"):
        problems.append("The collection's timestamp log has no row for it." if log == "no row" else "The collection has no timestamp log.")
    elif log not in ("row",):
        problems.append(log)
    if not images:
        problems.append("There are no images in the folder.")
    return {"deployment_id": deployment_id, "status": status, "seal": seal, "files": files, "images": len(images), "log": log, "problems": problems}


# ── repairing ────────────────────────────────────────────────────────────────

def _options_of(old: dict | None, location_time: dict, name_zone: str | None) -> pre.PreprocessOptions:
    """The options the images were preprocessed with: the ones a preprocessing.json that is left says, else the settings'
    — with the location's timezone and summer-time setting — since nothing else says."""
    settings = config.load_settings().PREPROCESSING
    base = {f.name: getattr(settings, f.name) for f in fields(pre.PreprocessOptions) if hasattr(settings, f.name)}
    base.update({k: v for k, v in location_time.items() if k in ("timezone", "ignore_dst")})
    if isinstance(old, dict) and isinstance(old.get("options"), dict):
        names = {f.name for f in fields(pre.PreprocessOptions)}
        base.update({k: v for k, v in old["options"].items() if k in names})
    if not base.get("timezone"):
        base["timezone"] = name_zone or ""
    if not base["timezone"]:
        raise RepairError("There is no timezone to read the capture dates in: set it in the location's time settings first.")
    pre.zone_of(base["timezone"])
    return pre.PreprocessOptions(**base)


def _xmp(files: list[Path]) -> dict[Path, dict]:
    """What the XMP of each image says — the identifier and the source hash the preprocessing wrote — if ExifTool is there."""
    exiftool = camera_info.exiftool_path()
    if not exiftool or not files:
        return {}
    found: dict[Path, dict] = {}
    for start in range(0, len(files), _XMP_BATCH):
        batch = files[start:start + _XMP_BATCH]
        try:
            completed = subprocess.run([exiftool, "-json", "-XMP-dc:Identifier", "-XMP-dc:Source", *map(str, batch)], capture_output=True, text=True, encoding="utf-8", check=False)
            rows = json.loads(completed.stdout or "[]")
        except (OSError, json.JSONDecodeError):
            return {}
        for path, row in zip(batch, rows):
            source = str(row.get("Source") or "")
            found[path] = {"identifier": bool(row.get("Identifier")), "source_hash": source.removeprefix("WildINTEL:") if source.startswith("WildINTEL:") else None}
    return found


def _location_of(root: Path, research_project_id: str, deployment_id: str, old: dict | None) -> tuple[str | None, dict]:
    """The id of the deployment's location — the one deployment.json says, else the end of the deployment's id — and the record
    kept for it in the research project (found ignoring case)."""
    wanted = (old or {}).get("location_id") or (deployment_id.split("-", 1)[1] if "-" in deployment_id else None)
    record = next((l for l in local_folder_service.list_locations(root, research_project_id) if wanted and str(l.get("location_id", "")).lower() == wanted.lower()), {})
    return (record.get("location_id") or wanted), record


def _preprocessing_problems(dest: Path, deployment_id: str, records: list[dict], options: pre.PreprocessOptions, old: dict[str, dict], xmp: dict[Path, dict]) -> dict[str, dict[str, str]]:
    """The checks of the preprocessing the folder can answer: check -> {image: what is wrong}. Names: <DEPLOYMENT>__<YYYYMMDD>_<n>.<EXT>
    with the day of the capture date and a number once each; size: not wider than the width asked for; metadata: the XMP
    identifier is there; hash: the file is the one that was preprocessed."""
    problems: dict[str, dict[str, str]] = {"preprocessing_names": {}, "preprocessing_size": {}, "preprocessing_metadata": {}, "preprocessing_hash": {}}
    pattern = re.compile(rf"^{re.escape(deployment_id.upper())}__(\d{{8}})_(\d+)(\.[A-Z]+)$")
    numbers: dict[str, list[str]] = {}
    for r in records:
        match = pattern.match(Path(r["name"]).name)
        if not match:
            problems["preprocessing_names"][r["name"]] = f"is not named <{deployment_id.upper()}>__<YYYYMMDD>_<n>.<EXT>"
            continue
        day = datetime.fromisoformat(r["date"]).strftime("%Y%m%d")
        if match.group(1) != day:
            problems["preprocessing_names"][r["name"]] = f"its name says {match.group(1)} and its capture date is {day}"
        numbers.setdefault(match.group(2), []).append(r["name"])
    for number, names in numbers.items():
        if len(names) > 1:
            for name in names:
                problems["preprocessing_names"][name] = f"the number {number} is also in {', '.join(n for n in names if n != name)}"
    if options.resize:
        for r in records:
            width = r.get("width")
            if width and width > options.resize_width:
                problems["preprocessing_size"][r["name"]] = f"is {width} px wide, more than the {options.resize_width} px asked for"
    if options.metadata and xmp:
        for r in records:
            if not xmp.get(dest / r["name"], {}).get("identifier"):
                problems["preprocessing_metadata"][r["name"]] = "has no WildINTEL identifier in its XMP metadata"
    for r in records:
        before = old.get(r["name"])
        if before and before.get("final_hash") and before["final_hash"] != r["final_hash"]:
            problems["preprocessing_hash"][r["name"]] = "is not the file that was preprocessed (its hash changed)"
    return problems


def repair_stream(collections_dir: Path, research_project_id: str, collection: str, deployment_id: str) -> Iterator[dict]:
    """Repairs one deployment. Events: {"type": "step", "step", "status": "running" | "done" | "skipped", "message"} — the steps are
    "inspect", "dates", "deployment", "preprocessing", "images", "seal" — and, last,
    {"type": "done", "deployment_id", "images", "written": [files], "problems": n, "status": "valid", "report_id"}.

    Raises:
        RepairError: the deployment isn't there, was synced from Trapper, or what is needed to rebuild it isn't known.
    """
    dest = _deployment_dir(collections_dir, research_project_id, collection, deployment_id)
    if local_folder_service.is_synced(dest):
        raise RepairError(f"{deployment_id} was synced from TRAPPER, so it can't be modified here.")
    collection_dir = dest.parent

    def step(name: str, status: str, message: str) -> dict:
        return {"type": "step", "step": name, "status": status, "message": message}

    def events() -> Iterator[dict]:
        old_deployment = _read_json(dest / local_folder_service.DEPLOYMENT_METADATA_FILE)
        old_deployment = old_deployment if isinstance(old_deployment, dict) else None
        old_log = _read_json(dest / pre.PREPROCESSING_LOG_FILE)
        old_log = old_log if isinstance(old_log, dict) and isinstance(old_log.get("images"), list) else None
        old_records = {r["name"]: r for r in (old_log or {}).get("images", []) if isinstance(r, dict) and "name" in r}
        written: list[str] = []
        file_results: list[tuple[str, bool, str]] = []

        yield step("inspect", "running", "Looking at the folder…")
        images = _images_in(dest)
        names = [str(p.relative_to(dest)) for p in images]
        yield step("inspect", "done", f"{len(images)} image(s), {sum((dest / n).is_file() for n in _METADATA_FILES)} of {len(_METADATA_FILES)} metadata files.")

        location_id, location = _location_of(collections_dir, research_project_id, deployment_id, old_deployment)
        location_time = local_folder_service.location_time(collections_dir, research_project_id, location_id)
        zone_name = location_time.get("timezone") or ((old_log or {}).get("options") or {}).get("timezone")
        options = _options_of(old_log, location_time, zone_name)
        zone = pre.zone_of(zone_name or options.timezone)
        ignore_dst = location_time["ignore_dst"] if location_time.get("ignore_dst") is not None else options.ignore_dst

        # ── when it was: the timestamp log prevails over the images ──
        yield step("dates", "running", "Reading the capture dates and the timestamp log…")
        times = dict(zip(images, parallel.pmap(lambda p: pre._camera_time(p, options), images)))
        exif_times = [t[0] for t in times.values() if t[2] == "exif"] or [t[0] for t in times.values()]
        computed = (min(exif_times), max(exif_times)) if exif_times else None
        row, log_problem = _log_row(collection_dir, deployment_id)
        if log_problem and local_folder_service.timestamp_log_path(collection_dir).is_file():
            raise RepairError(log_problem)
        if row:
            start, end = _row_times(row)
            note = "the timestamp log says so"
            if computed and (computed[0] < start.replace(microsecond=0) or computed[1] > end):
                note += f" — its images were taken {computed[0]:%Y-%m-%d %H:%M:%S} → {computed[1]:%Y-%m-%d %H:%M:%S}, and the log prevails"
        elif old_deployment and old_deployment.get("start_date") and old_deployment.get("end_date"):
            try:
                start, end = (datetime.fromisoformat(old_deployment[k]).replace(tzinfo=None) for k in ("start_date", "end_date"))
                note = "the deployment.json that was left says so"
            except ValueError:
                start = end = None
        else:
            start = end = None
        if start is None or end is None:
            if not computed:
                raise RepairError("It has no row in the timestamp log, no dates in its deployment.json and no images to read them from.")
            (start, end), note = computed, "read from its images"
        if end <= start:
            raise RepairError(f"The period of {deployment_id} is not valid: it ends ({end}) before it starts ({start}).")
        if row is None:
            try:
                result = local_folder_service.upsert_timestamp_log(collection_dir, deployment_id, start, end)
            except local_folder_service.LocalFolderError as exc:
                raise RepairError(str(exc)) from exc
            written.append(Path(result["path"]).name)
            file_results.append((Path(result["path"]).name, True, f"a row for {deployment_id} was added"))
            yield step("dates", "done", f"{start:%Y-%m-%d %H:%M:%S} → {end:%Y-%m-%d %H:%M:%S} ({note}); added to the timestamp log.")
        else:
            yield step("dates", "done", f"{start:%Y-%m-%d %H:%M:%S} → {end:%Y-%m-%d %H:%M:%S} ({note}).")

        # ── deployment.json ──
        yield step("deployment", "running", "Writing deployment.json…")
        cameras, _ = camera_info.read_cameras(images)
        models = {c.model for c in cameras.values() if c.model}
        ids = {c.camera_id for c in cameras.values() if c.camera_id}
        fields_: dict = {
            "deployment_id": deployment_id, "location_id": location_id, "location_name": location.get("name"), "latitude": location.get("latitude"),
            "longitude": location.get("longitude"), "coordinate_uncertainty": location.get("coordinate_uncertainty"),
            "camera_model": next(iter(models)) if len(models) == 1 else None, "camera_id": next(iter(ids)) if len(ids) == 1 else None,
        }
        merged = {**{k: v for k, v in fields_.items() if v is not None}, **{k: v for k, v in (old_deployment or {}).items() if v is not None}}
        merged["deployment_id"] = deployment_id
        merged["start_date"] = pre.localize(start, zone, ignore_dst=ignore_dst).isoformat()
        merged["end_date"] = pre.localize(end, zone, ignore_dst=ignore_dst).isoformat()
        try:
            deployment = DeploymentFields.model_validate(merged)
        except ValidationError as exc:
            problems = "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors())
            file_results.append((local_folder_service.DEPLOYMENT_METADATA_FILE, False, f"could not be rebuilt — {problems}"))
            raise RepairError(f"deployment.json can't be rebuilt: {problems}. Add what is missing (the location's coordinates, for one) and repair it again.") from exc
        body = deployment.model_dump()
        if old_deployment != body:
            local_folder_service.write_deployment_metadata(dest, body)
            written.append(local_folder_service.DEPLOYMENT_METADATA_FILE)
            what = "rebuilt" if old_deployment is None else "updated: " + ", ".join(sorted(k for k in body if (old_deployment or {}).get(k) != body[k]))
            file_results.append((local_folder_service.DEPLOYMENT_METADATA_FILE, True, what))
            yield step("deployment", "done", f"deployment.json {what}.")
        else:
            file_results.append((local_folder_service.DEPLOYMENT_METADATA_FILE, True, "was fine"))
            yield step("deployment", "done", "deployment.json was fine.")

        # ── preprocessing.json and images.json, from the images ──
        records: list[dict] = []
        sealed = None
        xmp: dict[Path, dict] = {}
        if not images:
            for name in (pre.PREPROCESSING_LOG_FILE, local_folder_service.IMAGES_FILE, seal_service.SEAL_FILE):
                yield step({"preprocessing.json": "preprocessing", "images.json": "images", "seal.json": "seal"}[name], "skipped", "There are no images.")
        else:
            yield step("preprocessing", "running", "Rebuilding preprocessing.json from the images…")
            xmp = _xmp(images)
            hashes = dict(zip(images, parallel.pmap(pre._sha1, images)))
            for path, name in zip(images, names):
                naive, aware, source = times[path]
                date = aware.astimezone(timezone.utc) if options.convert_to_utc else aware
                before = old_records.get(name, {})
                try:
                    from PIL import Image
                    with Image.open(path) as img:
                        width, height = img.width, img.height
                except Exception:
                    width = height = None
                records.append({
                    "original": before.get("original", name), "name": name, "date": date.isoformat(), "date_source": source, "resized": before.get("resized"),
                    "source_hash": before.get("source_hash") or xmp.get(path, {}).get("source_hash"), "hash": before.get("hash") or hashes[path],
                    "final_hash": hashes[path], "camera": cameras[path].model if path in cameras else None, "width": width, "height": height,
                    "_local": naive, "_date": date, "_size": path.stat().st_size,
                })
            public = [{k: v for k, v in r.items() if not k.startswith("_")} for r in records]
            options_body = {**asdict(options), "timezone": zone_name or options.timezone, "ignore_dst": ignore_dst}
            log_body = {"options": options_body, "processed": len(public), "skipped": (old_log or {}).get("skipped", 0), "images": public,
                        "recovered": {"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "from": "the images in the folder"}}
            (dest / pre.PREPROCESSING_LOG_FILE).write_text(json.dumps(log_body, indent=2, ensure_ascii=False), encoding="utf-8")
            written.append(pre.PREPROCESSING_LOG_FILE)
            file_results.append((pre.PREPROCESSING_LOG_FILE, True, "rebuilt" if old_log is None else "rebuilt from the images and what was left of it"))
            missing_source = sum(1 for r in records if not r["source_hash"])
            yield step("preprocessing", "done", f"preprocessing.json written for {len(records)} image(s)" + (f"; {missing_source} without the hash of their original" if missing_source else "") + ".")

            yield step("images", "running", "Rebuilding images.json…")
            entries = [local_folder_service.image_entry(r["name"], r["_local"].isoformat(), "local", {
                "original": r["original"], "taken_at": r["date"], "timestamp": r["_date"].timestamp(), "date_source": r["date_source"], "camera": r["camera"],
                "width": r["width"], "height": r["height"], "size_bytes": r["_size"], "resized": r["resized"], "sha1": r["final_hash"], "source_sha1": r["source_hash"],
            }) for r in records]
            local_folder_service.write_images_file(dest, deployment_id, entries)
            written.append(local_folder_service.IMAGES_FILE)
            file_results.append((local_folder_service.IMAGES_FILE, True, "rebuilt from the images"))
            yield step("images", "done", f"images.json written: {len(entries)} image(s).")

            # ── validate, postvalidate, seal ──
            yield step("seal", "running", "Validating and postvalidating the images, and sealing…")
            sealed = seal_service.seal(
                dest, dest, deployment, source_hashes={r["name"]: r["source_hash"] for r in records if r["source_hash"]}, preprocessing=options_body, recovered=True,
            )
            written.append(seal_service.SEAL_FILE)
            file_results.append((seal_service.SEAL_FILE, True, "written again"))
            failed = sum(1 for e in sealed["images"] for v in (*e["validations"].values(), *e["postvalidations"].values()) if v != "ok")
            yield step("seal", "done", "Sealed. " + (f"{failed} problem(s) found in the images." if failed else "The images passed every check."))

        old_by_name = {n: r for n, r in old_records.items()}
        preprocessing = _preprocessing_problems(dest, deployment_id, records, options, old_by_name, xmp) if records else {}
        report_id = None
        try:
            report_id = report_service.save(report_service.repair_report(deployment_id, dest, file_results, sealed, preprocessing))
        except Exception as exc:  # the repair is done: not having its report is no reason to fail it
            logger.warning("Could not write the report of the repair of %s: %s", deployment_id, exc)
        status = seal_service.verify(dest)["status"] if sealed else "unsealed"
        problems = (report_service.read(report_id)["totals"]["failed"] if report_id else 0)
        logger.info("Deployment %s repaired: wrote %s", deployment_id, ", ".join(written))
        yield {"type": "done", "deployment_id": deployment_id, "images": len(images), "written": written, "problems": problems, "status": {"valid": "valid", "broken": "broken", "none": "unsealed"}.get(status, status), "report_id": report_id}

    return events()
