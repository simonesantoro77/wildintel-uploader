"""The deployments a research project's visits say, and the logs of their collections — what the field records of a trip come to.

Each site's visits, in order, give a deployment for every pair of consecutive ones where the first left a camera (an Installation or a Revision) and
the second collected its card (see local_folder_service.closes_collection): the deployment goes from the one to the other, and is **closed**. It belongs to
the collection **the session of the visit that collected it names, minus one** (R0013 collects the deployments of R0012). A camera that was left and
has not been collected yet is an **open** deployment: it will belong to the collection the visit that collects it will name — the one being completed if it
was left before the last trip, the next one if it was left on it.

From the two visits of a deployment come its fields as Camtrap DP names them: who set it up, the camera and the card it was left with, the photos counted
when it was collected, and the details of the camera and the site. When the visit that left it and the one that collected it say something different of
a field, both are kept: a text as "Setup: … | Retrieval: …", the tags and groups of both together, and a number, a yes/no or a feature type as the setup says
it with the retrieval's value noted in the comments.

write_collection_logs() writes, in each collection's folder, the FileTimestampLog (the closed deployments' start and end) and the FieldworkLog (every
deployment of the collection, closed or open).
"""
from __future__ import annotations

import datetime as dt
import logging
import re
from pathlib import Path

from wildintel_uploader.core.services import local_folder_service, visit_rules, visit_time

logger = logging.getLogger(__name__)

# The details of a visit that are Camtrap DP's: the field of the visit, how Camtrap DP names it, and what kind of value it is.
_EXTRAS: list[tuple[str, str, str]] = [
    ("camera_model", "cameraModel", "single"), ("camera_interval", "cameraDelay", "number"), ("camera_height", "cameraHeight", "number"),
    ("camera_depth", "cameraDepth", "number"), ("camera_tilt", "cameraTilt", "number"), ("camera_heading", "cameraHeading", "number"),
    ("detection_distance", "detectionDistance", "number"), ("timestamp_issues", "timestampIssues", "bool"), ("bait_use", "baitUse", "bool"),
    ("feature_type", "featureType", "single"), ("habitat", "habitat", "text"), ("deployment_groups", "deploymentGroups", "list"), ("tags", "deploymentTags", "list"),
]


def session_number(session: str | None) -> int | None:
    m = re.search(r"\d+", session or "")
    return int(m.group(0)) if m else None


def collection_name(number: int) -> str:
    return f"R{number:04d}"


def _leaves_camera(v: dict) -> bool:
    return bool({"Installation", "Revision"} & set(v.get("actions") or []))


def _camera_stays(v: dict) -> bool:
    """Whether a camera is left out after the visit: one put up (an Installation — also when the visit found the other stolen, or took it away), or the one that
    was there and stays (a Revision that does not take it away nor finds it stolen)."""
    actions = set(v.get("actions") or [])
    return "Installation" in actions or ("Revision" in actions and not {"Desinstallation", "Stolen"} & actions)


def _not_revised(v: dict) -> bool:
    return str(v.get("camera_status") or "").lower() in visit_rules.NOT_REVISED


def _text(value) -> str | None:
    text = str(value).strip() if value not in (None, "") else None
    return text or None


def _both(setup, retrieval) -> str | None:
    """A text both visits give: one value when they agree or only one gives it, else "Setup: … | Retrieval: …"."""
    setup, retrieval = _text(setup), _text(retrieval)
    if not setup or not retrieval or setup.lower() == retrieval.lower():
        return setup or retrieval
    return f"Setup: {setup} | Retrieval: {retrieval}"


def _list(value) -> list[str]:
    if isinstance(value, (list, tuple)):
        return [str(t).strip() for t in value if str(t).strip()]
    return [t.strip() for t in re.split(r"[|;,]", str(value or "")) if t.strip()]


def _shown(value) -> str:
    if isinstance(value, bool):
        return "yes" if value else "no"
    return str(value)


def _merged(start: dict, end: dict | None) -> tuple[dict, list[str]]:
    """The details of a deployment from its visits, by the name the visit gives them (camera_model, tags…): the ones both visits say are put together,
    and the retrieval's values that could not be kept beside the setup's come back as notes for the comments."""
    out: dict[str, object] = {}
    retrieval_notes: list[str] = []
    for key, name, kind in _EXTRAS:
        setup, retrieval = start.get(key), (end or {}).get(key)
        if kind == "list":
            joined = list(dict.fromkeys([*_list(setup), *_list(retrieval)]))
            if joined:
                out[key] = joined
        elif kind == "text":
            value = _both(setup, retrieval)
            if value:
                out[key] = value
        else:
            value = setup if setup not in (None, "") else retrieval
            if value not in (None, ""):
                out[key] = value
            if setup not in (None, "") and retrieval not in (None, "") and str(setup).lower() != str(retrieval).lower():
                retrieval_notes.append(f"{name} {_shown(retrieval)} (setup {_shown(setup)})")
    return out, retrieval_notes


def _fields(start: dict, end: dict | None) -> tuple[dict, list[str]]:
    """The Camtrap DP fields of a deployment from its visits — {Camtrap DP's name: value}, a list as its values apart by " | " — and the retrieval's notes."""
    merged, notes = _merged(start, end)
    names = {key: name for key, name, _ in _EXTRAS}
    return {names[k]: (" | ".join(v) if isinstance(v, list) else v) for k, v in merged.items()}, notes


# What a visit says of how the camera was put up, and that a visit that only revises it does not say again: the field form asks it when a camera is put up.
_MOUNT = ("camera_model", "camera_id", "camera_interval", "camera_height", "camera_depth", "camera_tilt", "camera_heading", "detection_distance", "bait_use",
          "feature_type", "habitat")


def with_mount(start: dict, visits: list[dict]) -> dict:
    """The visit that left the camera, with how the camera was put up: when it only revised it, what it does not say comes from the visit that put up that
    camera at the location (the last Installation before it). The deployment of R0042 of a camera put up in R0030 has its height, heading and bait use."""
    if "Installation" in (start.get("actions") or []) or not start.get("when"):
        return start
    site = str(start.get("location_id", "")).lower()
    before = [v for v in visits if str(v.get("location_id", "")).lower() == site and v.get("when") and v["when"] <= start["when"]
              and "Installation" in (v.get("actions") or []) and v is not start]
    if not before:
        return start
    put_up = max(before, key=lambda v: v["when"])
    if start.get("camera_id") and put_up.get("camera_id") and str(start["camera_id"]).lower() != str(put_up["camera_id"]).lower():
        return start                                    # another camera: what was said of that one is not of this one
    return {**start, **{k: put_up[k] for k in _MOUNT if start.get(k) in (None, "") and put_up.get(k) not in (None, "")}}


def merged_details(start: dict, end: dict | None) -> dict:
    """What the two visits of a deployment say of it, as the fields of the form of a deployment have them — the same mix the FieldworkLog gets: who set it up
    (the setup's, with the retrieval's beside when it differs), the camera, the details of the camera and the site, the tags of both, and the comments of
    both as "Setup: … | Retrieval: …". Only the fields they say something of."""
    merged, notes = _merged(start, end)
    details = {k: (" | ".join(v) if k == "deployment_groups" and isinstance(v, list) else v) for k, v in merged.items()}
    setup_by = _both(start.get("setup_by") or start.get("trappers"), (end or {}).get("trappers"))
    for key, value in (("setup_by", setup_by), ("camera_id", _text(start.get("camera_id"))), ("comments", _comments(start, end, notes))):
        if value:
            details[key] = value
    return details


def _comments(start: dict, end: dict | None, retrieval_notes: list[str]) -> str:
    """What both visits noted: "Setup: …" and "Retrieval: …", each only when it says something — the retrieval's with the values of its fields that could not
    be kept beside the setup's."""
    parts = []
    if _text(start.get("comments")):
        parts.append(f"Setup: {_text(start['comments'])}")
    retrieval = [n for n in [_text((end or {}).get("comments")), *retrieval_notes] if n]
    if retrieval:
        parts.append(f"Retrieval: {'; '.join(retrieval)}")
    return " | ".join(parts)


def _utc(when: str | None, keep_seconds: bool = True) -> str:
    """An instant as ISO 8601 UTC with a Z — cut to the minute unless the seconds are kept."""
    if not when:
        return ""
    when = when if when.endswith("Z") else when.replace("+00:00", "Z")
    return when if keep_seconds else re.sub(r":\d{2}Z$", ":00Z", when)


def _deployment(collection: int, start: dict, end: dict | None, keep_seconds: bool = True, no_images: str | None = None, mounted: dict | None = None) -> dict:
    """A deployment from the visit that left the camera and, once it is collected, the one that collected it. When the camera was stolen the visit that found it
    so closes the deployment, but nothing was collected: `no_images` says why there are none ("stolen"), and there never will be. `mounted` is the visit that
    left the camera with how the camera was put up (see with_mount): its fields come from it."""
    fields, notes = _fields(mounted or start, end)
    # who set it up: the one the visit that left it says (else who went); who collected it: who went on the visit that did
    return {
        "deployment_id": f"{collection_name(collection)}-{start['location_id']}", "collection": collection_name(collection), "site": start["location_id"],
        "status": "closed" if end else "open", "start": _utc(start.get("when"), keep_seconds), "end": _utc(end.get("when"), keep_seconds) if end else None,
        "setup_by": _both(start.get("setup_by") or start.get("trappers"), (end or {}).get("trappers")), "camera_id": _text(start.get("camera_id")), "card": _text(start.get("sd")),
        "photos_counted": end.get("num_photos") if end else None,
        # the card was full when it was collected: its photos are not counted, and the number is not given — the dashboards say so instead of it
        "card_full": bool(end and end.get("card_status") == "CardFull"), "comments": _comments(start, end, notes), "fields": fields,
        "start_visit": start, "end_visit": end, "no_images": no_images,
    }


def deployments(visits: list[dict], keep_seconds: bool = True) -> list[dict]:
    """Every deployment the visits say, closed and open, by collection and site — their start and end cut to the minute unless the seconds are kept."""
    by_site: dict[str, list[dict]] = {}
    for v in visits:
        if v.get("when") and not _not_revised(v):
            by_site.setdefault(str(v["location_id"]).lower(), []).append(v)
    last_session = max((n for n in (session_number(v.get("session")) for v in visits) if n is not None), default=0)
    out: list[dict] = []
    for group in by_site.values():
        group.sort(key=lambda v: v["when"])
        mounted = {id(v): with_mount(v, group) for v in group}   # its fields say how the camera was put up; the visit itself is kept as it is
        for earlier, later in zip(group, group[1:]):
            number = session_number(later.get("session"))
            if number is None or not _leaves_camera(earlier):
                continue
            if "Stolen" in (later.get("actions") or []):
                # a stolen camera closes its deployment with no images: nothing was on a card that was taken away
                out.append(_deployment(number - 1, earlier, later, keep_seconds, no_images="stolen", mounted=mounted[id(earlier)]))
            elif local_folder_service.closes_collection(later):
                out.append(_deployment(number - 1, earlier, later, keep_seconds, mounted=mounted[id(earlier)]))
        last = group[-1]
        number = session_number(last.get("session"))
        if _camera_stays(last) and number is not None:
            # still out there: the collection the visit that collects it will name — the one being completed when it was left before the last trip
            out.append(_deployment(last_session - 1 if number < last_session else last_session, last, None, keep_seconds, mounted=mounted[id(last)]))
    return sorted(out, key=lambda d: (d["collection"], d["site"].lower()))


def visit_states(visits: list[dict], keep_seconds: bool = True) -> dict[tuple[str, str], str]:
    """The state of each visit, by its site (ignoring case) and its instant: not_visited (it could not be made); deployed, collected or stolen for the visit that left
    a camera — out there still, its card collected by a later visit, or the camera found stolen —; a visit that left none (it took the camera away, found it stolen or
    only archived the location) is no_camera: it leaves nothing to wait for."""
    started = {id(d["start_visit"]): d for d in deployments(visits, keep_seconds)}
    states: dict[tuple[str, str], str] = {}
    for v in visits:
        d = started.get(id(v))
        if _not_revised(v):
            state = "not_visited"
        elif d:
            state = "deployed" if d["status"] == "open" else "stolen" if d["no_images"] else "collected"
        else:
            state = "no_camera"
        states[(str(v.get("location_id", "")).lower(), str(v.get("when") or ""))] = state
    return states


def refresh_states(root: Path, research_project_id: str, keep_seconds: bool = True) -> int:
    """Keeps the state of the visits of a research project — worked out from all of them: a visit that left a camera is deployed until a later visit collects its
    card, and then it is collected (or stolen). Called when a visit is added and when one is given its deployment. Returns how many visits changed."""
    return local_folder_service.write_states(root, research_project_id, visit_states(local_folder_service.list_visits(root, research_project_id), keep_seconds))


def locked(visits: list[dict], keep_seconds: bool = True) -> set[tuple[str, str]]:
    """The visits that cannot be edited, found by their site (ignoring case) and their instant: those that start or close a deployment that is imported. The deployment is
    linked on the visit that left the camera — the one it belongs to — (or, as it was linked before, on the one that collected the card): either says it."""
    out = set()
    for d in deployments(visits, keep_seconds):
        start, end = d["start_visit"], d["end_visit"]
        if end and (start.get("deployment_id") or end.get("deployment_id")):
            out |= {(str(v["location_id"]).lower(), str(v.get("when") or "")) for v in (start, end)}
    return out


def visit_book(visits: list[dict], keep_seconds: bool = True, locations: list[dict] | None = None, unknown: list[dict] | None = None, planned: list[str] | None = None) -> list[dict]:
    """The visits as the visit book shows them, each with the deployment it started — `deployment` (its id) and `deployment_status` ("closed" once a later visit collected
    its card, "open" while the camera it left is still out) — and neither for a visit that left no camera.

    With the `locations` of the research project, the book also has a row — `not_done` — for each location that has no visit in a session the visits have: a trip is
    made to every location, so the one that was not visited says so, with no day, no time and no actions. The archived locations are left out. The `planned` revisions — "R0003",
    planned before any visit was made to them — are sessions the visits have too: each location has its planned visit in them."""
    started = {id(d["start_visit"]): d for d in deployments(visits, keep_seconds)}
    states = visit_states(visits, keep_seconds)
    fixed = locked(visits, keep_seconds)
    out = []
    for v in visits:
        d = started.get(id(v))
        out.append({**v, "deployment": d["deployment_id"] if d else None, "deployment_status": d["status"] if d else None,
                    "deployment_no_images": d["no_images"] if d else None, "not_done": False, "not_visited": _not_revised(v),
                    "locked": (str(v.get("location_id", "")).lower(), str(v.get("when") or "")) in fixed,
                    "state": states[(str(v.get("location_id", "")).lower(), str(v.get("when") or ""))]})
    # a visit of which nothing is known: it has no day, no time and no actions, and it cannot be edited — only a known one takes its place
    starts = visit_rules.site_starts(visits)
    # a revision before the start of a site has nothing of it: not an unknown visit, nor a planned one
    for u in (x for x in unknown or [] if (visit_rules._session_number(x["session"]) or 0) >= starts.get(str(x["location_id"]).lower(), 0)):
        out.append({"location_id": u["location_id"], "session": str(u["session"]).upper(), "date": "", "time": "", "when": None, "actions": [], "deployment": None, "deployment_status": None,
                    "not_done": False, "not_visited": False, "unknown": True, "locked": True, "state": "unknown"})
    if locations:
        visited = {(str(v.get("session") or "").upper(), str(v.get("location_id", "")).lower()) for v in visits} | {(str(u["session"]).upper(), str(u["location_id"]).lower()) for u in unknown or []}
        sessions = sorted({str(v["session"]).upper() for v in visits if v.get("session")} | {str(s).upper() for s in planned or []})
        for session in sessions:
            for location in locations:
                site = str(location.get("location_id", ""))
                if not site or location.get("status") in ("archived", "planned") or (session, site.lower()) in visited:
                    continue
                if (visit_rules._session_number(session) or 0) < starts.get(site.lower(), 0):
                    continue   # the site starts after this revision
                if not visit_rules._in_play(location, visits):
                    continue   # a site that is pending has not started: nothing is waited for of it
                out.append({"location_id": site, "session": session, "date": "", "time": "", "when": None, "actions": [], "deployment": None, "deployment_status": None, "not_done": True, "not_visited": False, "state": "planned"})
    return out


def _wall(when: str, location: dict | None) -> dt.datetime:
    date, time = visit_time.to_wall(when, location)
    return dt.datetime.fromisoformat(f"{date}T{time}")


def collections_of(visits: list[dict], new: list[dict], keep_seconds: bool = True) -> list[str]:
    """The collections whose deployments have one of the visits `new` (found by their instant and site) among their two — the ones a new visit changes."""
    keys = {(str(v.get("location_id", "")).lower(), v.get("when")) for v in new if v.get("when")}
    found = set()
    for d in deployments(visits, keep_seconds):
        for visit in (d["start_visit"], d["end_visit"]):
            if visit and (str(visit.get("location_id", "")).lower(), visit.get("when")) in keys:
                found.add(d["collection"])
    return sorted(found)


def write_collection_logs(root: Path, research_project_id: str, collections: list[str] | None = None, keep_seconds: bool = True) -> dict:
    """Writes the FileTimestampLog and the FieldworkLog of each collection the visits give deployments to (only the ones named, when `collections` is
    given). The FileTimestampLog is the camera's wall clock — the location's — and the FieldworkLog UTC; the row of a deployment already in them is replaced.

    Returns {"collections": [{"collection", "closed", "open", "files": [...]}], "warnings": [...]}.

    Raises:
        LocalFolderError: the research project isn't kept in the collections folder.
    """
    local_folder_service.require_research_project(root, research_project_id)
    visits = local_folder_service.list_visits(root, research_project_id)
    locations = local_folder_service.list_locations(root, research_project_id)
    where = {str(l["location_id"]).lower(): l for l in locations}
    project = root / research_project_id
    wanted = {c.upper() for c in collections} if collections is not None else None
    by_collection: dict[str, list[dict]] = {}
    for d in deployments(visits, keep_seconds):
        if wanted is None or d["collection"] in wanted:
            by_collection.setdefault(d["collection"], []).append(d)
    result, warnings = [], []
    for collection, items in sorted(by_collection.items()):
        folder = project / collection
        local_folder_service.write_collection_metadata(folder, collection)   # the collection's folder, with its collection.json
        files = []
        for d in items:
            location = where.get(d["site"].lower())
            if d["status"] == "closed" and not d["no_images"]:
                try:
                    local_folder_service.upsert_timestamp_log(folder, d["deployment_id"], _wall(d["start"], location), _wall(d["end"], location))
                except local_folder_service.LocalFolderError as exc:
                    warnings.append(f"{d['deployment_id']}: not put in the FileTimestampLog: {exc}")
            local_folder_service.upsert_fieldwork_log(folder, _row(d))
        for path in (local_folder_service.timestamp_log_path(folder), local_folder_service.fieldwork_log_path(folder)):
            if path.is_file():
                files.append(str(path))
        result.append({"collection": collection, "closed": sum(d["status"] == "closed" for d in items), "open": sum(d["status"] == "open" for d in items), "files": files})
    return {"collections": result, "warnings": warnings}


def _row(d: dict) -> dict:
    """A deployment's row of the FieldworkLog."""
    start, end = d["start_visit"], d["end_visit"]
    cell = lambda v: "" if v is None else ("true" if v is True else "false" if v is False else str(v))  # noqa: E731
    return {
        "deploymentID": d["deployment_id"], "locationID": d["site"], "deploymentStart": d["start"], "deploymentEnd": d["end"] or "",
        "setupBy": d["setup_by"] or "", "cameraID": d["camera_id"] or "", **{name: cell(d["fields"].get(name)) for _, name, _ in _EXTRAS},
        "deploymentComments": d["comments"], "status": d["status"], "collection": d["collection"], "cardSD": d["card"] or "",
        "photosCounted": cell(d["photos_counted"]), "startSession": start.get("session") or "", "startAction": " + ".join(start.get("actions") or []),
        "endSession": (end or {}).get("session") or "", "endAction": " + ".join((end or {}).get("actions") or []),
    }
