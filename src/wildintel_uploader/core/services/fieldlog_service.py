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
    kept (local_folder_service.upsert_timestamp_log), as the processing reads it;
  * <R000N>_FieldworkLog.csv — every deployment of the collection, closed or open, with its fields named as Camtrap DP
    names them (deploymentID, setupBy, cameraID, deploymentComments, and cameraModel, cameraHeight, baitUse, habitat…
    when the field survey has them) and what the field trip says of its card.

When the setup visit and the retrieval visit say something different of a field, both are kept: a text as
"Setup: … | Retrieval: …", the tags and groups of both together, and a number, a yes/no or a feature type (which must
be one value in Camtrap DP) as the setup visit says it, with the retrieval's value noted in deploymentComments.

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
# The Camtrap DP fields a visit may bring besides setupBy, cameraID and the notes (engine.EXTRA_FIELDS): the kind of
# value each one is, and its limits.
FEATURE_TYPES = ("roadPaved", "roadDirt", "trailHiking", "trailGame", "roadUnderpass", "roadOverpass", "roadBridge",
                 "culvert", "burrow", "nestSite", "carcass", "waterSource", "fruitingTree")
EXTRA_KINDS: dict[str, tuple] = {
    "cameraModel": ("single",), "cameraDelay": ("int", 0, None), "cameraHeight": ("float", 0, None),
    "cameraDepth": ("float", 0, None), "cameraTilt": ("int", -90, 90), "cameraHeading": ("int", 0, 360),
    "detectionDistance": ("float", 0, None), "timestampIssues": ("bool",), "baitUse": ("bool",),
    "featureType": ("enum",), "habitat": ("text",), "deploymentGroups": ("list",), "deploymentTags": ("list",),
}
assert list(EXTRA_KINDS) == engine.EXTRA_FIELDS
FIELDWORK_LOG_FIELDS = [
    "deploymentID", "locationID", "deploymentStart", "deploymentEnd", "setupBy", "cameraID",
    *[f for f in engine.EXTRA_FIELDS if f != "deploymentTags"], "deploymentTags",
    "deploymentComments", "status", "collection", "cardSD", "photosCounted", "startSession", "startAction",
    "endSession", "endAction",
]
# The datasheet fields an Epicollect column can be mapped to in the settings, with the column read when none is.
COLUMN_FIELDS: list[tuple[str, str, str]] = [
    *((field, column, field) for field, column in engine.EPI_TO_SHEET.items()),
    (engine.EPI_CREATED, engine.EPI_CREATED, "Time of the entry (UTC)"),
    (engine.EPI_DATE, engine.EPI_DATE, "Date typed"),
    (engine.EPI_HOUR, engine.EPI_HOUR, "Hour typed"),
    *((field, field, f"{field} (Camtrap DP, optional)") for field in engine.EXTRA_FIELDS),
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


def _comments(start: dict, end: dict | None, retrieval_notes: list[str] | None = None) -> str:
    """What both visits noted: "Setup: …" and "Retrieval: …", each only when it says something — the retrieval's with
    the values of its fields that could not be kept beside the setup's."""
    parts = []
    if start.get("notes"):
        parts.append(f"Setup: {start['notes']}")
    retrieval = [n for n in [end.get("notes") if end else None, *(retrieval_notes or [])] if n]
    if retrieval:
        parts.append(f"Retrieval: {'; '.join(retrieval)}")
    return " | ".join(parts)


def _both(setup, retrieval) -> str | None:
    """A text both visits give: one value when they agree or only one gives it, else "Setup: … | Retrieval: …"."""
    setup, retrieval = (str(v).strip() if v not in (None, "") else None for v in (setup, retrieval))
    if not setup or not retrieval or setup.lower() == retrieval.lower():
        return setup or retrieval
    return f"Setup: {setup} | Retrieval: {retrieval}"


_TRUE = {"true", "yes", "y", "si", "sí", "s", "1", "verdadero", "x"}
_FALSE = {"false", "no", "n", "0", "falso"}


def _parse_extra(field: str, raw) -> tuple[object, str | None]:
    """A field's value as Camtrap DP has it — a number, a yes/no, one of the feature types, a text or a list — or None
    with why it can't be one."""
    if raw in (None, ""):
        return None, None
    text = str(raw).strip()
    kind = EXTRA_KINDS[field]
    if kind[0] in ("int", "float"):
        try:
            number = float(text.replace(",", "."))
        except ValueError:
            return None, f"{field} '{text}' is not a number"
        if kind[0] == "int":
            if not number.is_integer():
                return None, f"{field} '{text}' is not a whole number"
            number = int(number)
        lo, hi = kind[1], kind[2]
        if (lo is not None and number < lo) or (hi is not None and number > hi):
            limits = f"{lo} to {hi}" if hi is not None else f"{lo} or more"
            return None, f"{field} {text} is out of its range ({limits})"
        return number, None
    if kind[0] == "bool":
        low = text.lower()
        if low in _TRUE:
            return True, None
        if low in _FALSE:
            return False, None
        return None, f"{field} '{text}' is not yes or no"
    if kind[0] == "enum":
        match = next((t for t in FEATURE_TYPES if t.lower() == text.replace(" ", "").lower()), None)
        return (match, None) if match else (None, f"{field} '{text}' is not one of {', '.join(FEATURE_TYPES)}")
    if kind[0] == "list":
        return [t.strip() for t in text.replace(";", "|").replace(",", "|").split("|") if t.strip()], None
    return text, None


def _extras(start: dict, end: dict | None) -> tuple[dict, list[str], list[str]]:
    """The Camtrap DP fields of a deployment from its setup and retrieval visits: {field: value}, the notes of the
    retrieval's values that could not be kept, and what could not be read."""
    out: dict[str, object] = {}
    retrieval_notes: list[str] = []
    problems: list[str] = []
    for field, kind in EXTRA_KINDS.items():
        values = []
        for visit in (start, end):
            value, problem = _parse_extra(field, ((visit or {}).get("extra") or {}).get(field))
            if problem:
                problems.append(f"{visit['session']} {visit['site']}: {problem}; left out")
            values.append(value)
        setup, retrieval = values
        if kind[0] == "list":
            joined = list(dict.fromkeys([*(setup or []), *(retrieval or [])]))
            if joined:
                out[field] = " | ".join(joined)
        elif kind[0] == "text":
            value = _both(setup, retrieval)
            if value:
                out[field] = value
        else:
            value = setup if setup is not None else retrieval
            if value is not None:
                out[field] = value
            if setup is not None and retrieval is not None and str(setup).lower() != str(retrieval).lower():
                retrieval_notes.append(f"{field} {_shown(retrieval)} (setup {_shown(setup)})")
    return out, retrieval_notes, problems


def _shown(value) -> str:
    if isinstance(value, bool):
        return "yes" if value else "no"
    return str(value)


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
    visit left there; the photos counted are the end visit's; who set it up and the other fields, both visits'."""
    trim = (lambda d: d) if keep_seconds else (lambda d: d.replace(second=0))
    fields, retrieval_notes, problems = _extras(start, end)
    return {
        "deployment_id": deployment_id(collection, site),
        "collection": engine.session_name(collection),
        "site": site,
        "status": "closed" if end else "open",
        "start": _iso(trim(start["when"])),
        "end": _iso(trim(end["when"])) if end else None,
        "setup_by": _both(start.get("trappers"), end.get("trappers") if end else None),
        "camera_id": None if start.get("cam") is None else str(start["cam"]),
        "card": start.get("sd"),
        "photos_counted": _number(end.get("nphotos")) if end else None,
        "comments": _comments(start, end, retrieval_notes),
        "fields": fields,
        "field_problems": problems,
        "start_visit": _visit(start),
        "end_visit": _visit(end),
    }


def _open_deployments(visits: list[dict], keep_seconds: bool, last_session: int) -> list[dict]:
    """Per site, the deployment its latest visit started and no visit has closed yet: the camera is still out there.
    Not after a visit that took the camera away or found it stolen, nor one that collected nothing.

    It belongs to the collection the visit that closes it will name: the one before the session of that visit. A camera
    left before the current field trip (last_session) is collected on it, so its deployment is the collection being
    completed (last_session - 1) — also when its site was not reached on one or more trips before. One left on the current
    trip is collected on the next, so it is the next collection's (last_session)."""
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
        collection = last_session - 1 if v["snum"] < last_session else last_session
        out.append(_deployment(collection, site, v, None, keep_seconds))
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
    # An Installation (a new site, or a new camera at a site) while the card left at the visit before was not collected:
    # nothing closes that deployment, so its card would be left out. A Revision and an Installation the same day (a camera
    # changed) are fine.
    replaced: list[str] = []
    by_site: dict[str, list[dict]] = {}
    for v in prep["visits"]:
        if v.get("status", "").lower() not in engine.NOT_VISITED_STATUS:
            by_site.setdefault(v["site"], []).append(v)
    for v in current:
        if v["action"].lower() != "installation":
            continue
        before = [b for b in by_site.get(v["site"], []) if b["when"] < v["when"]]
        if not before:
            continue
        last = max(before, key=lambda b: b["when"])
        action = last["action"].lower()
        if action in engine.END_ACTIONS or action in engine.LOST_ACTIONS or (v["when"] - last["when"]).total_seconds() < 86400:
            continue
        replaced.append(f"{v['session']} {v['site']}: Installation on {v['when']:%Y-%m-%d} while the card left there on "
                        f"{last['when']:%Y-%m-%d} ({last['session']} {last['action']}) was not collected — no Revision or "
                        "Desinstallation before it, so that card has no deployment. Check the field data.")
    shared: list[str] = replaced
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
    for label, path in (("field survey (from App)", epicollect), ("field history", datasheet)):
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
    open_ = [d for d in _open_deployments(prep["visits"], keep, prep["last_s"]) if int(d["collection"][1:]) >= min(collections)]
    checks = _checks(prep, _locations(research_project_id, settings))
    if checks["new_sites"]:
        prep["report"].warn(
            "Sites not among the locations of %s: %s. Check each one is really new and not a site misnamed in the field; "
            "then save it as a location, with the coordinates of its installation — the upload creates it in Trapper."
            % (research_project_id, ", ".join(s["site"] for s in checks["new_sites"]))
        )
    for line in checks["shared"]:
        prep["report"].warn(line)
    for problem in dict.fromkeys(p for d in closed + open_ for p in d["field_problems"]):
        prep["report"].warn(problem)
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


def _cell(value) -> str:
    """A field's value as the FieldworkLog writes it: Camtrap DP's true/false for a yes/no."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


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
                **{f: _cell(d["fields"].get(f)) for f in engine.EXTRA_FIELDS},
                "deploymentComments": d["comments"], "status": d["status"],
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
                    local_folder_service.upsert_timestamp_log(collection_dir, d["deployment_id"], start, end)
                except local_folder_service.LocalFolderError as exc:
                    prep["report"].warn(f"{d['deployment_id']}: not put in the FileTimestampLog: {exc}")
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
