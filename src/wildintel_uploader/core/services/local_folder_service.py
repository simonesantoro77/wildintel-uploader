"""Organizing a deployment into a local "collection" folder instead of
Trapper — the "Local folder" destination, for when there's no Trapper
account/instance involved at all.

A collection here is just a folder holding one subfolder per deployment,
with a small collection.json recording its own name (mirroring Trapper's
own Collection model, which needs nothing more than a name to create one).
Each deployment's own folder likewise gets a deployment.json with the
fields the wizard collected, since there's no Trapper database to register
them in."""
from __future__ import annotations

import csv
import json
import logging
import re
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

COLLECTION_METADATA_FILE = "collection.json"
DEPLOYMENT_METADATA_FILE = "deployment.json"
IMAGES_FILE = "images.json"
RESEARCH_PROJECT_METADATA_FILE = "research_project.json"
LOCATIONS_FILE = "locations.json"

# A research project's id (its acronym) names its folder in the collections folder.
_PROJECT_ID = re.compile(r"^[0-9A-Za-z][0-9A-Za-z_.-]*$")


class LocalFolderError(Exception):
    """A research project or location can't be read or saved in the collections folder."""


def check_collection(path: Path) -> dict:
    """Whether path already exists, and the collection name recorded in it
    from an earlier run, if any (None if it's missing, unreadable, or the
    folder is new/foreign)."""
    name = None
    metadata_path = path / COLLECTION_METADATA_FILE
    if metadata_path.is_file():
        try:
            name = json.loads(metadata_path.read_text(encoding="utf-8")).get("name")
        except (json.JSONDecodeError, OSError):
            name = None
    return {"exists": path.is_dir(), "name": name}


def write_collection_metadata(path: Path, name: str | None) -> None:
    """Creates the collection folder if it doesn't exist yet, and records
    its name — merged into whatever collection.json is already there, so
    reusing an existing collection never needs a name to keep the one it
    has."""
    path.mkdir(parents=True, exist_ok=True)
    metadata_path = path / COLLECTION_METADATA_FILE
    metadata: dict = {}
    if metadata_path.is_file():
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            metadata = {}
    if name:
        metadata["name"] = name
    metadata_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")


def write_deployment_metadata(path: Path, deployment: dict) -> None:
    path.mkdir(parents=True, exist_ok=True)
    (path / DEPLOYMENT_METADATA_FILE).write_text(
        json.dumps(deployment, indent=2, ensure_ascii=False), encoding="utf-8",
    )


def is_synced(deployment_dir: Path) -> bool:
    """Whether the deployment was synced from Trapper (its images.json says so): what Trapper holds is not modified here."""
    info = _read_json(deployment_dir / IMAGES_FILE)
    return isinstance(info, dict) and info.get("source") == "trapper"


def image_entry(name: str, local_time: str | None, source: str, extra: dict) -> dict:
    """One image of images.json: "name" and "local_time" (the camera's wall clock, None when unknown) are always there;
    "source" says where the rest comes from ("local" or "trapper") and "extra" holds those attributes, which are
    different for each source."""
    return {"name": name, "local_time": local_time, "source": source, "extra": extra}


def write_images_file(deployment_dir: Path, deployment_id: str, images: list[dict], *, source: str = "local") -> None:
    """images.json — what is known of each image of the deployment, for statistics and checks without opening the
    images again: {"deployment_id", "source", "image_count", "first", "last", "images": [...]}. "source" says where it
    comes from: "local" (the images were read here) or "trapper" (what Trapper holds for them); each image says it too.
    Build the images with image_entry. "first" and "last" are the
    earliest and latest "local_time" of the images (the camera's wall clock) that have one."""
    times = sorted(i["local_time"] for i in images if i.get("local_time"))
    summary = {"deployment_id": deployment_id, "source": source, "image_count": len(images), "first": times[0] if times else None, "last": times[-1] if times else None}
    (deployment_dir / IMAGES_FILE).write_text(json.dumps({**summary, "images": images}, indent=2, ensure_ascii=False), encoding="utf-8")


def list_deployments(collection_dir: Path) -> list[dict]:
    """Every deployment already organized in this collection folder — each
    subfolder holding a deployment.json (see write_deployment_metadata) —
    for the "use an existing deployment" branch of the "Local folder"
    destination. Empty if the folder doesn't exist."""
    if not collection_dir.is_dir():
        return []
    deployments = []
    for entry in sorted(collection_dir.iterdir()):
        if not entry.is_dir():
            continue
        metadata_path = entry / DEPLOYMENT_METADATA_FILE
        if not metadata_path.is_file():
            continue
        try:
            deployments.append(json.loads(metadata_path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            continue
    return deployments


# ── research projects and locations kept in the collections folder ──────────
#
#   <collections folder>/<research project id>/research_project.json
#   <collections folder>/<research project id>/locations.json
#   <collections folder>/<research project id>/<R0003>/<deployment id>/…
#
# The wizard's first question, "where was it taken?", is answered from these —
# or a new research project/location is added, by hand or from Trapper.

def project_dir(root: Path, research_project_id: str) -> Path:
    """The research project's own folder.

    Raises:
        LocalFolderError: the id can't be a folder name.
    """
    if not _PROJECT_ID.match(research_project_id):
        raise LocalFolderError(
            f"The research project id '{research_project_id}' can only have letters, digits, '_', '-' and '.' (and start with a letter or digit) to be a folder name."
        )
    return root / research_project_id


def _read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def list_research_projects(root: Path) -> list[dict]:
    """Every research project already kept in the collections folder — each
    subfolder holding a research_project.json. Empty if the folder doesn't
    exist yet (the first run)."""
    if not root.is_dir():
        return []
    # Two folders can say the same acronym (one renamed by hand, say): the project is listed once, from the folder the app itself
    # would look in — the one named by the acronym — or else the first.
    projects: dict[str, tuple[dict, bool]] = {}
    for entry in sorted(root.iterdir(), key=lambda e: e.name.lower()):
        metadata = _read_json(entry / RESEARCH_PROJECT_METADATA_FILE) if entry.is_dir() else None
        if not isinstance(metadata, dict):
            continue
        key = str(metadata.get("acronym") or entry.name).lower()
        named_by_acronym = entry.name == metadata.get("acronym")
        if key in projects:
            logger.warning("The research project %s is in more than one folder of %s (%s too): it is listed once.", key, root, entry.name)
            if not named_by_acronym or projects[key][1]:
                continue
        projects[key] = (metadata, named_by_acronym)
    return [metadata for metadata, _ in projects.values()]


def write_research_project(root: Path, project: dict) -> dict:
    """Adds a research project: its folder (named by its acronym) and
    research_project.json.

    Raises:
        LocalFolderError: the acronym can't be a folder name, or it's already there.
    """
    folder = project_dir(root, project["acronym"])
    if (folder / RESEARCH_PROJECT_METADATA_FILE).is_file():
        raise LocalFolderError(f"The research project '{project['acronym']}' already exists.")
    folder.mkdir(parents=True, exist_ok=True)
    (folder / RESEARCH_PROJECT_METADATA_FILE).write_text(json.dumps(project, indent=2, ensure_ascii=False), encoding="utf-8")
    return project


def list_locations(root: Path, research_project_id: str) -> list[dict]:
    """The locations kept for a research project — empty until one is added.

    Raises:
        LocalFolderError: the research project id can't be a folder name.
    """
    locations = _read_json(project_dir(root, research_project_id) / LOCATIONS_FILE)
    return [l for l in locations if isinstance(l, dict)] if isinstance(locations, list) else []


def write_location(root: Path, research_project_id: str, location: dict) -> dict:
    """Adds a location to a research project that's already kept here.

    Raises:
        LocalFolderError: the research project isn't there, or the location
            id is already used in it.
    """
    folder = project_dir(root, research_project_id)
    if not (folder / RESEARCH_PROJECT_METADATA_FILE).is_file():
        raise LocalFolderError(f"The research project '{research_project_id}' isn't in the collections folder.")
    locations = list_locations(root, research_project_id)
    if any(l.get("location_id", "").lower() == location["location_id"].lower() for l in locations):
        raise LocalFolderError(f"The location '{location['location_id']}' already exists in {research_project_id}.")
    locations.append(location)
    (folder / LOCATIONS_FILE).write_text(json.dumps(locations, indent=2, ensure_ascii=False), encoding="utf-8")
    return location


def update_location(root: Path, research_project_id: str, location_id: str, changes: dict) -> dict:
    """Changes a kept location's fields (found ignoring case) — only the keys in changes, the rest stay.

    Raises:
        LocalFolderError: the research project or the location isn't there.
    """
    locations = list_locations(root, research_project_id)
    index = next((i for i, l in enumerate(locations) if l.get("location_id", "").lower() == location_id.lower()), None)
    if index is None:
        raise LocalFolderError(f"The location '{location_id}' isn't in {research_project_id}.")
    locations[index] = {**locations[index], **changes}
    (project_dir(root, research_project_id) / LOCATIONS_FILE).write_text(json.dumps(locations, indent=2, ensure_ascii=False), encoding="utf-8")
    return locations[index]


def location_time(root: Path, research_project_id: str, location_id: str | None) -> dict:
    """The timezone and summer-time setting kept for a location (found ignoring case) — only the ones it has. They belong
    to the location, so they are what every deployment there is read in; empty when it isn't kept, or has neither.

    Raises:
        LocalFolderError: the research project id can't be a folder name.
    """
    return location_time_in(project_dir(root, research_project_id), location_id)


def location_time_in(project_folder: Path, location_id: str | None) -> dict:
    """location_time for a research project's folder, wherever it is — <folder>/locations.json."""
    locations = _read_json(project_folder / LOCATIONS_FILE)
    found = next((l for l in locations if isinstance(l, dict) and location_id and str(l.get("location_id", "")).lower() == location_id.lower()), None) if isinstance(locations, list) else None
    return {k: found[k] for k in ("timezone", "ignore_dst") if found and found.get(k) is not None}


# ── the collection's timestamp log ──────────────────────────────────────────
#
#   <collection folder>/<collection>_FileTimestampLog.csv — as wildintel-tools has it
#
#   Deployment,StartDate,StartTime,EndDate,EndTime
#   R0003-DONA_0007_B,2024:09:04,13:10:00,2024:11:04,14:28:00
#
# One row per deployment: when its images were taken, as the camera's local
# wall-clock time. wildintel-tools' check-deployments reads it.

TIMESTAMP_LOG_SUFFIX = "_FileTimestampLog.csv"
TIMESTAMP_LOG_FIELDS = ["Deployment", "StartDate", "StartTime", "EndDate", "EndTime"]


def timestamp_log_path(collection_dir: Path) -> Path:
    """<collection>/<collection>_FileTimestampLog.csv."""
    return collection_dir / f"{collection_dir.name}{TIMESTAMP_LOG_SUFFIX}"


def read_timestamp_log(path: Path) -> list[dict]:
    """The rows of a timestamp log — none if there isn't one yet.

    Raises:
        LocalFolderError: it exists but can't be read as one (no header, a column missing or repeated).
    """
    if not path.is_file():
        return []
    try:
        with path.open(newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            header = reader.fieldnames
            if not header:
                raise LocalFolderError(f"{path.name} has no header row.")
            repeated = sorted({name for name in header if header.count(name) > 1})
            if repeated:
                raise LocalFolderError(f"{path.name} repeats the columns: {', '.join(repeated)}.")
            missing = [name for name in TIMESTAMP_LOG_FIELDS if name not in header]
            if missing:
                raise LocalFolderError(f"{path.name} is missing the columns: {', '.join(missing)}.")
            rows = []
            for row in reader:
                clean = {name: (row.get(name) or "").strip() for name in TIMESTAMP_LOG_FIELDS}
                if clean["Deployment"]:
                    rows.append(clean)
            return rows
    except (OSError, UnicodeDecodeError, csv.Error) as exc:
        raise LocalFolderError(f"Could not read {path.name}: {exc}") from exc


def upsert_timestamp_log(collection_dir: Path, deployment_id: str, start: datetime, end: datetime) -> dict:
    """Puts a deployment's row — its start and end, as wall-clock times — in its collection's
    timestamp log, creating the collection folder (named in its collection.json) and the log if
    need be. The deployment's own row is replaced (compared ignoring case), the others stay.

    Returns {"path", "action": "added" | "updated" | "unchanged", "rows"}.

    Raises:
        LocalFolderError: the log that's there can't be read — it is left as it is — or the
            deployment ends before it starts.
    """
    if end <= start:
        raise LocalFolderError(f"{deployment_id} must start before it ends ({start} → {end}).")
    path = timestamp_log_path(collection_dir)
    rows = read_timestamp_log(path)
    new_row = {
        "Deployment": deployment_id, "StartDate": start.strftime("%Y:%m:%d"), "StartTime": start.strftime("%H:%M:%S"),
        "EndDate": end.strftime("%Y:%m:%d"), "EndTime": end.strftime("%H:%M:%S"),
    }
    index = next((i for i, row in enumerate(rows) if row["Deployment"].upper() == deployment_id.upper()), None)
    if index is None:
        rows.append(new_row)
        action = "added"
    elif rows[index] == new_row:
        action = "unchanged"
    else:
        rows[index] = new_row
        action = "updated"
    if not collection_dir.is_dir():
        write_collection_metadata(collection_dir, collection_dir.name)
    if action != "unchanged" or not path.is_file():
        with path.open("w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=TIMESTAMP_LOG_FIELDS)
            writer.writeheader()
            writer.writerows(rows)
    return {"path": str(path), "action": action, "rows": len(rows)}
