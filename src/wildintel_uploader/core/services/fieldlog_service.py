"""Field records — the first step of the workflow, before any card is copied.

From the Epicollect download of a field trip and the fieldwork datasheet (.xlsx) it works out, with the FileTimestamps
engine (services.fieldlog.engine):

  * the datasheet with the trip's visits added — a new file beside the original, which is never changed;
  * each deployment of the collection: the two visits it spans, so when it started and ended (UTC), who set the camera
    up, which camera and which card. A deployment is closed once the visit that collects its card is recorded, and open
    (its camera still out there) until then;
  * the checks the field data need before anything else: sites that are not among the research project's locations
    yet, a camera or card at two sites in one session, and the engine's own (sites not visited, revisions with 0
    photos, two installations at one site…).

And writes, in the collection's folder (<collections folder>/<research project>/<R000N>/):

  * <R000N>_FileTimestampLog.csv — each closed deployment's start and end, the row of each replaced and the others
    kept (local_folder_service.upsert_timestamp_log), as the import reads it — and, beside the datasheet, the same in
    the format wildintel-tools and the FileTimestamps tool write (eleven columns), for whoever still uses it;
  * <R000N>_FieldworkLog.csv — every deployment of the collection, closed or open, with its fields named as Camtrap DP
    names them (deploymentID, setupBy, cameraID, deploymentComments…) and what the field trip says of its card.

Every time is UTC: the time of a visit is when its Epicollect entry was created.
"""
from __future__ import annotations

import csv
import datetime as dt
import logging
import os
from pathlib import Path

from wildintel_uploader.core import config
from wildintel_uploader.core.services import local_folder_service
from wildintel_uploader.core.services.fieldlog import engine

logger = logging.getLogger(__name__)

FIELDWORK_LOG_SUFFIX = "_FieldworkLog.csv"
FIELDWORK_LOG_FIELDS = [
    "deploymentID", "locationID", "deploymentStart", "deploymentEnd", "setupBy", "cameraID", "deploymentTags",
    "deploymentComments", "status", "collection", "cardSD", "photosCounted", "startSession", "startAction",
    "endSession", "endAction",
]
# The datasheet fields an Epicollect column can be mapped to in the settings, with the column read when none is.
COLUMN_FIELDS: list[tuple[str, str, str]] = [
    *((field, column, field) for field, column in engine.EPI_TO_SHEET.items()),
    (engine.EPI_CREATED, engine.EPI_CREATED, "Time of the entry (UTC)"),
    (engine.EPI_DATE, engine.EPI_DATE, "Date typed"),
    (engine.EPI_HOUR, engine.EPI_HOUR, "Hour typed"),
]


class FieldlogError(Exception):
    """The field records can't be read or written."""


def column_fields() -> list[dict]:
    """The Epicollect columns the field records read, for the settings: {"field", "default", "label"}."""
    return [{"field": field, "default": column, "label": label} for field, column, label in COLUMN_FIELDS]


def deployment_id(collection: int, site: str) -> str:
    return f"{engine.session_name(collection)}-{site}"


def _iso(when: dt.datetime | None) -> str:
    return when.strftime("%Y-%m-%dT%H:%M:%SZ") if when else ""


def _comments(start: dict, end: dict | None) -> str:
    """What both visits noted: "Start: …" and "End: …", each only when it says something."""
    parts = []
    if start.get("notes"):
        parts.append(f"Start: {start['notes']}")
    if end and end.get("notes"):
        parts.append(f"End: {end['notes']}")
    return " | ".join(parts)


def _number(value) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _visit(v: dict | None) -> dict | None:
    if v is None:
        return None
    return {
        "session": v["session"], "action": v["action"], "when": _iso(v["when"]), "camera": v["cam"],
        "card": v.get("sd"), "photos": _number(v.get("nphotos")), "trappers": v.get("trappers"), "notes": v.get("notes"),
        "new": bool(v.get("new")),
    }


def _deployment(collection: int, site: str, start: dict, end: dict | None, keep_seconds: bool) -> dict:
    """A deployment as the page shows it and the FieldworkLog keeps it. The camera and the card are the ones the start
    visit left there; the photos counted are the end visit's."""
    trim = (lambda d: d) if keep_seconds else (lambda d: d.replace(second=0))
    return {
        "deployment_id": deployment_id(collection, site),
        "collection": engine.session_name(collection),
        "site": site,
        "status": "closed" if end else "open",
        "start": _iso(trim(start["when"])),
        "end": _iso(trim(end["when"])) if end else None,
        "setup_by": start.get("trappers"),
        "camera_id": None if start.get("cam") is None else str(start["cam"]),
        "card": start.get("sd"),
        "photos_counted": _number(end.get("nphotos")) if end else None,
        "comments": _comments(start, end),
        "start_visit": _visit(start),
        "end_visit": _visit(end),
    }


def _open_deployments(visits: list[dict], keep_seconds: bool) -> list[dict]:
    """Per site, the deployment its latest visit started and no visit has closed yet: the camera is still out there.
    Not after a visit that took the camera away or found it stolen, nor one that collected nothing."""
    latest: dict[str, dict] = {}
    for v in visits:
        if v.get("status", "").lower() in engine.NOT_VISITED_STATUS:
            continue
        if v["site"] not in latest or v["when"] > latest[v["site"]]["when"]:
            latest[v["site"]] = v
    out = []
    for site, v in sorted(latest.items()):
        action = v["action"].lower()
        if action in engine.END_ACTIONS or action in engine.LOST_ACTIONS:
            continue
        out.append(_deployment(v["snum"], site, v, None, keep_seconds))
    return out


def _locations(research_project_id: str | None, settings: config.Settings) -> list[dict] | None:
    """The research project's locations kept in the collections folder — None when it has none kept."""
    if not research_project_id:
        return None
    try:
        locations = local_folder_service.list_locations(config.collections_dir(settings), research_project_id)
    except local_folder_service.LocalFolderError as exc:
        raise FieldlogError(str(exc)) from exc
    kept = [l for l in locations if l.get("location_id")]
    return kept or None


def _distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """The distance between two points on the Earth, in metres (haversine)."""
    from math import asin, cos, radians, sin, sqrt
    dlat, dlon = radians(lat2 - lat1), radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * 6371000 * asin(sqrt(a))


def _one_apart(a: str, b: str) -> bool:
    """Whether two ids differ by one character — typed, missed or swapped: TATR_0004 / TATR_0005, DONA_0022 / DONA_0022_B is not."""
    a, b = a.lower(), b.lower()
    if a == b or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        diff = [i for i in range(len(a)) if a[i] != b[i]]
        return len(diff) == 1 or (len(diff) == 2 and diff[1] == diff[0] + 1 and a[diff[0]] == b[diff[1]] and a[diff[1]] == b[diff[0]])
    short, long_ = (a, b) if len(a) < len(b) else (b, a)
    return any(long_[:i] + long_[i + 1:] == short for i in range(len(long_)))


def _new_site(site: str, visits: list[dict], known: list[dict]) -> dict:
    """A site of the field records that is not a location yet, with what helps tell a really new site from a misnamed one:
    the coordinates of its installation (its first visit), the nearest location kept and how far, and the ids one
    character apart from its own."""
    first = min(visits, key=lambda v: v["when"])
    lat, lon = first.get("lat"), first.get("lon")
    nearest = None
    if lat is not None and lon is not None:
        distances = [
            (_distance_m(lat, lon, float(l["latitude"]), float(l["longitude"])), l["location_id"])
            for l in known if l.get("latitude") is not None and l.get("longitude") is not None
        ]
        if distances:
            metres, location_id = min(distances)
            nearest = {"location_id": location_id, "distance_m": round(metres)}
    return {
        "site": site, "session": first["session"], "action": first["action"], "when": _iso(first["when"]),
        "latitude": lat, "longitude": lon, "visits": len(visits), "nearest": nearest,
        "similar": sorted(l["location_id"] for l in known if _one_apart(site, str(l["location_id"]))),
    }


def _checks(prep: dict, locations: list[dict] | None) -> dict:
    """What the app checks on top of the engine, on the sessions being checked: sites that are not locations of the
    research project yet, and a camera or a card at more than one site in a session."""
    sessions = set(prep["check_sessions"])
    current = [v for v in prep["visits"] if v["snum"] in sessions]
    new_sites: list[dict] = []
    if locations is not None:
        known = {str(l["location_id"]).lower() for l in locations}
        unknown = sorted({v["site"] for v in current if v["site"].lower() not in known})
        for site in unknown:
            new_sites.append(_new_site(site, [v for v in prep["visits"] if v["site"] == site], locations))
    shared: list[str] = []
    for what, key in (("Camera", "cam"), ("Card", "sd")):
        by_session: dict[tuple, set] = {}
        for v in current:
            value = v.get(key)
            if value in (None, ""):
                continue
            by_session.setdefault((v["session"], str(value).strip().lower(), str(value).strip()), set()).add(v["site"])
        for (session, _, shown), sites in sorted(by_session.items()):
            if len(sites) > 1:
                shared.append(f"{session}: {what.lower()} {shown} is at {len(sites)} sites ({', '.join(sorted(sites))}).")
    return {"new_sites": new_sites, "shared": shared, "locations_known": locations is not None}


def _work(epicollect: str, datasheet: str, research_project_id: str | None, settings: config.Settings | None) -> tuple[dict, dict]:
    settings = settings or config.load_settings()
    options = settings.FIELDLOG
    for label, path in (("Epicollect download", epicollect), ("fieldwork datasheet", datasheet)):
        if not path or not Path(path).expanduser().is_file():
            raise FieldlogError(f"The {label} is not a file: {path or '(none chosen)'}")
    try:
        prep = engine.prepare(
            str(Path(epicollect).expanduser()), str(Path(datasheet).expanduser()), keep_seconds=options.keep_seconds,
            time_source=options.time_source, overrides=options.columns,
        )
    except engine.FieldlogError as exc:
        raise FieldlogError(str(exc)) from exc
    keep = options.keep_seconds
    collections = sorted({iv["dep"] for iv in prep["intervals"] if iv["end_visit"].get("new")}) or [prep["target"]]
    closed = [
        _deployment(iv["dep"], iv["site"], iv["start_visit"], iv["end_visit"], keep)
        for iv in prep["intervals"] if iv["dep"] in collections
    ]
    open_ = [d for d in _open_deployments(prep["visits"], keep) if int(d["collection"][1:]) >= min(collections)]
    checks = _checks(prep, _locations(research_project_id, settings))
    if checks["new_sites"]:
        prep["report"].warn(
            "Sites not among the locations of %s: %s. Check each one is really new and not a site misnamed in the field; "
            "then save it as a location, with the coordinates of its installation — the upload creates it in Trapper."
            % (research_project_id, ", ".join(s["site"] for s in checks["new_sites"]))
        )
    for line in checks["shared"]:
        prep["report"].warn(line)
    lines = prep["report"].lines
    result = {
        "datasheet": os.path.basename(datasheet),
        "sessions": [engine.session_name(prep["first_s"]), engine.session_name(prep["last_s"])],
        "new_rows": len(prep["new"]),
        "new_visits": [_visit(v) | {"site": v["site"]} for v in prep["new_visits"]],
        "collections": [engine.session_name(c) for c in collections],
        "deployments": sorted(closed + open_, key=lambda d: (d["collection"], d["site"])),
        "new_sites": checks["new_sites"],
        "locations_known": checks["locations_known"],
        "warnings": [l[len("WARNING: "):] for l in lines if l.startswith("WARNING: ")],
        "notes": [l for l in lines if not l.startswith("WARNING: ")],
        "camera_timezone": options.camera_timezone,
    }
    return prep, result


def analyze(epicollect: str, datasheet: str, research_project_id: str | None = None, settings: config.Settings | None = None) -> dict:
    """What the field trip adds and what it says of each deployment, writing nothing.

    Raises:
        FieldlogError: an input is missing or can't be read.
    """
    return _work(epicollect, datasheet, research_project_id, settings)[1]


def _write_fieldwork_log(collection_dir: Path, deployments: list[dict]) -> Path:
    path = collection_dir / f"{collection_dir.name}{FIELDWORK_LOG_SUFFIX}"
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDWORK_LOG_FIELDS)
        writer.writeheader()
        for d in deployments:
            start, end = d["start_visit"], d["end_visit"]
            writer.writerow({
                "deploymentID": d["deployment_id"], "locationID": d["site"], "deploymentStart": d["start"],
                "deploymentEnd": d["end"] or "", "setupBy": d["setup_by"] or "", "cameraID": d["camera_id"] or "",
                "deploymentTags": "", "deploymentComments": d["comments"], "status": d["status"],
                "collection": d["collection"], "cardSD": d["card"] or "",
                "photosCounted": "" if d["photos_counted"] is None else d["photos_counted"],
                "startSession": start["session"], "startAction": start["action"],
                "endSession": end["session"] if end else "", "endAction": end["action"] if end else "",
            })
    return path


def add_locations(research_project_id: str, sites: list[dict], settings: config.Settings | None = None) -> list[dict]:
    """Saves sites of the field records as locations of the research project in the collections folder — each
    {"location_id", "latitude", "longitude"}, in the cameras' timezone (UTC unless the settings say otherwise) and marked
    as coming from the field: the upload creates them in Trapper. Returns the locations saved.

    Raises:
        FieldlogError: the research project isn't kept here, a site is already a location, or its coordinates are missing.
    """
    settings = settings or config.load_settings()
    root = config.collections_dir(settings)
    saved = []
    for site in sites:
        location_id = str(site.get("location_id") or "").strip().upper()
        lat, lon = site.get("latitude"), site.get("longitude")
        if not location_id:
            raise FieldlogError("A location needs its id.")
        if lat is None or lon is None or not (-90 <= float(lat) <= 90 and -180 <= float(lon) <= 180):
            raise FieldlogError(f"{location_id} needs valid coordinates (latitude -90 to 90, longitude -180 to 180).")
        location = {
            "location_id": location_id, "name": location_id, "timezone": settings.FIELDLOG.camera_timezone, "ignore_dst": False,
            "latitude": float(lat), "longitude": float(lon), "coordinate_uncertainty": None, "source": "field",
        }
        try:
            saved.append(local_folder_service.write_location(root, research_project_id, location))
        except local_folder_service.LocalFolderError as exc:
            raise FieldlogError(str(exc)) from exc
    return saved


def read_fieldwork_log(collection_dir: Path) -> list[dict]:
    """The rows of a collection's FieldworkLog — none if it has none yet."""
    path = collection_dir / f"{collection_dir.name}{FIELDWORK_LOG_SUFFIX}"
    if not path.is_file():
        return []
    with path.open(newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def apply(epicollect: str, datasheet: str, research_project_id: str, settings: config.Settings | None = None) -> dict:
    """Writes what analyze works out: the updated datasheet beside the original, and the FileTimestampLog and the
    FieldworkLog of each collection in its folder. Returns analyze's result with "files": the paths written.

    Raises:
        FieldlogError: an input is missing or can't be read, or the research project isn't in the collections folder.
    """
    settings = settings or config.load_settings()
    if not research_project_id:
        raise FieldlogError("Choose the research project the field trip belongs to.")
    root = config.collections_dir(settings)
    try:
        project = local_folder_service.project_dir(root, research_project_id)
    except local_folder_service.LocalFolderError as exc:
        raise FieldlogError(str(exc)) from exc
    if not (project / local_folder_service.RESEARCH_PROJECT_METADATA_FILE).is_file():
        raise FieldlogError(f"The research project '{research_project_id}' isn't in the collections folder.")
    prep, result = _work(epicollect, datasheet, research_project_id, settings)
    sheet = Path(datasheet).expanduser()
    files: list[str] = []
    try:
        files += engine.write_datasheets(prep, str(sheet), str(sheet.parent), settings.FIELDLOG.datasheet_format)
    except OSError as exc:
        raise FieldlogError(f"Could not write the updated datasheet: {exc}") from exc
    # The log in the format wildintel-tools and the FileTimestamps tool write (eleven columns, the hours without a
    # leading zero), beside the datasheet as that tool left it — for whoever still uses it.
    for collection in sorted({iv["dep"] for iv in prep["intervals"] if engine.session_name(iv["dep"]) in result["collections"]}):
        legacy = Path(engine.unique_path(str(sheet.parent / f"{engine.session_name(collection)}_FileTimestampLog.csv")))
        try:
            engine.write_log(str(legacy), [iv for iv in prep["intervals"] if iv["dep"] == collection], settings.FIELDLOG.keep_seconds)
            files.append(str(legacy))
        except OSError as exc:
            prep["report"].warn(f"Could not write {legacy.name} beside the datasheet: {exc}")
    for collection in result["collections"]:
        collection_dir = project / collection
        deployments = [d for d in result["deployments"] if d["collection"] == collection]
        try:
            local_folder_service.write_collection_metadata(collection_dir, collection)
            for d in deployments:
                if d["status"] != "closed":
                    continue
                start = dt.datetime.strptime(d["start"], "%Y-%m-%dT%H:%M:%SZ")
                end = dt.datetime.strptime(d["end"], "%Y-%m-%dT%H:%M:%SZ")
                try:
                    written = local_folder_service.upsert_timestamp_log(collection_dir, d["deployment_id"], start, end)
                except local_folder_service.LocalFolderError as exc:
                    prep["report"].warn(f"{d['deployment_id']}: not put in the FileTimestampLog — {exc}")
                    continue
            log = local_folder_service.timestamp_log_path(collection_dir)
            if log.is_file() and str(log) not in files:
                files.append(str(log))
            files.append(str(_write_fieldwork_log(collection_dir, deployments)))
        except (OSError, local_folder_service.LocalFolderError) as exc:
            raise FieldlogError(f"Could not write the files of {collection}: {exc}") from exc
    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    report_path = Path(engine.unique_path(str(sheet.parent / f"update_report_{stamp}.txt")))
    try:
        report_path.write_text(prep["report"].text(), encoding="utf-8")
        files.append(str(report_path))
    except OSError as exc:
        logger.warning("Could not write the update report %s: %s", report_path, exc)
    lines = prep["report"].lines
    result["warnings"] = [l[len("WARNING: "):] for l in lines if l.startswith("WARNING: ")]
    result["notes"] = [l for l in lines if not l.startswith("WARNING: ")]
    result["files"] = files
    result["collection_dirs"] = [str(project / c) for c in result["collections"]]
    logger.info("Field records of %s written: %s", research_project_id, ", ".join(files))
    return result
