"""FastAPI router — the visits to the camera traps of a research project, kept in its folder of the collections folder
(see local_folder_service.list_visits and write_visit)."""
from __future__ import annotations


from fastapi import APIRouter, HTTPException

from wildintel_uploader.core import config
from wildintel_uploader.core.schemas.requests import CreateRevisionRequest, FieldLogsRequest, ImportVisitsCsvRequest, LinkVisitRequest, ListVisitsRequest, MarkNotVisitedRequest, SaveVisitRequest, UpdateVisitRequest, VisitRecord, VisitsCsvColumnsRequest
from wildintel_uploader.core.services import epicollect_service, audit, local_folder_service, report_service, trapper_upload_service, visit_deployments, visit_rules, visit_time, visits_csv

router = APIRouter(prefix="/api/visits", tags=["visits"])


def _trapper_state(root, research_project_id: str, deployment_id: str | None) -> tuple[str | None, bool]:
    """Whether the deployment a visit gave is on Trapper — it was uploaded from here (its upload.json says when) or it was synced from there — and when it was uploaded."""
    if not deployment_id:
        return None, False
    folder = root / research_project_id / deployment_id.split("-", 1)[0] / deployment_id
    upload = local_folder_service._read_json(folder / trapper_upload_service.UPLOAD_LOG_FILE)
    uploaded_at = upload.get("uploaded_at") if isinstance(upload, dict) else None
    return uploaded_at, bool(uploaded_at) or local_folder_service.is_synced(folder)


def _uploads_of(folder) -> list[dict]:
    """What was done with a deployment's folder: one upload for each platform it was sent to (only "trapper" for now) — `kind` "uploaded" with the day and what it did, or "synced"
    when the deployment came from Trapper and was not sent from here. None when it was not sent anywhere."""
    upload = local_folder_service._read_json(folder / trapper_upload_service.UPLOAD_LOG_FILE)
    # the page of the deployment in Trapper — or of its revision —, as it was when it was sent; an upload made before that was kept goes to the site
    site = (config.load_settings().TRAPPER.base_url or "").rstrip("/") or None
    if isinstance(upload, dict) and upload.get("uploaded_at"):
        return [{"destination": "trapper", "kind": "uploaded", "uploaded_at": upload.get("uploaded_at"), "parts": upload.get("parts"),
                 "location_created": bool(upload.get("location_created")), "deployment_created": bool(upload.get("deployment_created")),
                 "url": upload.get("deployment_url") or upload.get("collection_url") or site}]
    if local_folder_service.is_synced(folder):
        return [{"destination": "trapper", "kind": "synced", "uploaded_at": None, "parts": None, "location_created": None, "deployment_created": None, "url": site}]
    return []


# Where a deployment can be sent, and the settings that say whether each is used: only the uploaders that are in use have an upload planned.
UPLOADERS = {"trapper": lambda settings: settings.TRAPPER.enabled, "agouti": lambda settings: settings.AGOUTI.enabled}


def _upload_states(root, research_project_id: str, imported: str | None, deployment_id: str, failures: list[dict]) -> list[dict]:
    """The upload of a deployment to each uploader in use: "planned" from the start, then "done" (it was sent from here, or it was synced from the destination) or "failed" (it was
    tried and did not work: it can be tried again) — {"destination", "state", "kind", "uploaded_at", "note"}."""
    settings = config.load_settings()
    # what was done is told by the folder of the deployment, once it is created (`imported`); what failed, by the failures kept
    done = {u["destination"]: u for u in (_uploads_of(root / research_project_id / imported.split("-", 1)[0] / imported) if imported else [])}
    failed = {f["destination"]: f for f in failures if f.get("deployment_id") == deployment_id}
    out = []
    for destination, used in UPLOADERS.items():
        if not used(settings) and destination not in done:
            continue
        if destination in done:
            out.append({"destination": destination, "state": "done", "kind": done[destination]["kind"], "uploaded_at": done[destination].get("uploaded_at"), "note": None})
        elif destination in failed:
            out.append({"destination": destination, "state": "failed", "kind": None, "uploaded_at": None, "note": failed[destination].get("note")})
        else:
            out.append({"destination": destination, "state": "planned", "kind": None, "uploaded_at": None, "note": None})
    return out


def _write_logs(root, research_project_id: str, new: list[dict]) -> dict:
    """The folders of the collections the new visits change, and their FileTimestampLog and FieldworkLog — made when a visit is registered, not when its
    deployment is imported. {"collections": [...], "warnings": [...]}; nothing is written when no deployment is said by the visits yet."""
    if not new:
        return {"collections": [], "warnings": []}
    visits = local_folder_service.list_visits(root, research_project_id)
    keep = config.load_settings().FIELDLOG.keep_seconds
    return visit_deployments.write_collection_logs(root, research_project_id, visit_deployments.collections_of(visits, new, keep), keep)


def _refresh_states(root, research_project_id: str) -> None:
    """Keeps the state of the visits — a visit that left a camera is collected once a later one took its card, and the one just added has its own."""
    visit_deployments.refresh_states(root, research_project_id, config.load_settings().FIELDLOG.keep_seconds)


def _archive_locations(root, research_project_id: str, new: list[dict]) -> list[str]:
    """The locations that the visits with an Archive action give up: archived from the day of the visit, with a note that says which visit did it."""
    done = []
    for v in new:
        if "Archive" not in (v.get("actions") or []):
            continue
        note = f"Archived in the visit {v.get('session')}" + (f": {v['comments']}" if v.get("comments") else "")
        try:
            local_folder_service.update_location(root, research_project_id, v["location_id"], {"status": "archived", "status_date": v["date"], "status_note": note}, by_visit=True)
            done.append(v["location_id"])
        except local_folder_service.LocalFolderError:
            continue
    return done


def _apply_to_entities(root, research_project_id: str, new: list[dict], before: list[dict]) -> None:
    """What the visits just kept do to the cameras and the SD cards (see visit_rules.entity_changes): in the field, back to ready, or archived when stolen. What is archived is
    for good, and is never changed; what the research project does not keep is left alone."""
    history = list(before)
    changes: list[tuple[dict, dict]] = []
    for visit in sorted(new, key=visit_rules._stamp):
        changes += [(visit, c) for c in visit_rules.entity_changes(visit, history)]
        history.append(visit)
    for visit, change in [(v, c) for v, c in changes if c["kind"] == "locations"]:
        site = next((l for l in local_folder_service.list_locations(root, research_project_id) if str(l.get("location_id", "")).lower() == change["name"].lower()), None)
        if site is not None and site.get("status") in ("ready", "active") and site["status"] != change["status"]:
            try:
                local_folder_service.update_location(root, research_project_id, site["location_id"], {"status": change["status"]}, by_visit=True)
            except local_folder_service.LocalFolderError:
                continue
    for kind in ("cameras", "sd_cards"):
        wanted = [(v, c) for v, c in changes if c["kind"] == kind]
        if not wanted:
            continue
        items = local_folder_service.list_field_items(root, research_project_id, kind)
        changed = False
        for visit, change in wanted:
            for item in items:
                names = {str(item.get("label") or "").strip().lower()} | ({str(item.get("camera_id") or "").strip().lower()} if kind == "cameras" else set())
                if change["name"].strip().lower() not in names or item.get("status") == "archived" or item.get("status") == change["status"]:
                    continue
                item["status"] = change["status"]
                if change["status"] == "archived":
                    item["archive_reason"], item["status_date"] = change["reason"], visit.get("date")
                    item["status_note"] = "Stolen" if kind == "cameras" else "Stolen with the camera"
                changed = True
        if changed:
            local_folder_service.write_field_items(root, research_project_id, kind, items)


@router.post("/list")
def list_visits(req: ListVisitsRequest) -> dict:
    """The visits kept for a research project, those to one location only when it is given."""
    try:
        return {"results": local_folder_service.list_visits(config.collections_dir(), req.research_project_id, req.location_id)}
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/save")
def save_visit(req: SaveVisitRequest) -> dict:
    """Registers a visit to a research project already kept in the collections folder — if it follows the rules of a visit (see services.visit_rules): its
    site is a location of the project, it is not kept already, it has what its actions ask and its camera and card are where it says."""
    root = config.collections_dir()
    try:
        local_folder_service.require_active_research_project(root, req.research_project_id)
        visit = req.visit.model_dump(mode="json")
        locations = local_folder_service.list_locations(root, req.research_project_id)
        # the rules compare instants: the day and the time are the wall clock of the location
        location = next((l for l in locations if str(l.get("location_id", "")).lower() == visit["location_id"].lower()), None)
        visit["when"] = visit_time.to_when(visit["date"], visit["time"], location)
        kept_visits = local_folder_service.list_visits(root, req.research_project_id)
        cards = local_folder_service.list_field_items(root, req.research_project_id, "sd_cards")
        unknown = local_folder_service.list_unknown(root, req.research_project_id)
        # a visit that takes the place of an unknown one is put where its instant says, among the visits that are kept
        fills = any(u["location_id"].lower() == visit["location_id"].lower() and u["session"].upper() == str(visit["session"]).upper() for u in unknown)
        if fills:
            reasons = _not_entities(root, req.research_project_id, None, visit) + visit_rules.edit_errors(None, visit, kept_visits, locations, cards, unknown)
        else:
            reasons = _not_entities(root, req.research_project_id, None, visit) + visit_rules.refusals(visit, kept_visits, locations, cards, unknown)
        if reasons:
            raise HTTPException(422, " ".join(reasons))
        kept = local_folder_service.write_visit(root, req.research_project_id, visit)
        _archive_locations(root, req.research_project_id, [kept])
        _apply_to_entities(root, req.research_project_id, [kept], kept_visits)
        _refresh_states(root, req.research_project_id)
        return {**kept, "field_logs": _write_logs(root, req.research_project_id, [kept])}
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(400, str(exc)) from exc


def _trapper_names() -> list[str]:
    return [t["name"] for t in local_folder_service.list_trappers(config.collections_dir())]


def _not_entities(root, research_project_id: str, old: dict | None, visit: dict) -> list[str]:
    """What a visit says that is not an entity: a camera or an SD card that is not one of the research project's, a trapper that is not in the settings. Only what
    changed from `old` is said — what the visit already had stays, as it may have been kept without being listed."""
    reasons = []
    cameras = {str(x).lower() for c in local_folder_service.list_field_items(root, research_project_id, "cameras") if c.get("status") != "planned" for x in (c.get("camera_id"), c.get("label")) if x}
    cards = {str(c.get("label")).lower() for c in local_folder_service.list_field_items(root, research_project_id, "sd_cards") if c.get("status") != "planned"}
    trappers = {t["name"].lower() for t in local_folder_service.list_trappers(config.collections_dir())}
    names = lambda text: [n.strip() for n in str(text or "").split(",") if n.strip()]  # noqa: E731
    camera, card = visit.get("camera_id"), visit.get("sd")
    if camera and str(camera).lower() not in cameras and str(camera).lower() != str((old or {}).get("camera_id") or "").lower():
        reasons.append(f"The camera {camera} is not one of the cameras of {research_project_id}.")
    if card and str(card).lower() not in cards and str(card).lower() != str((old or {}).get("sd") or "").lower():
        reasons.append(f"The SD card {card} is not one of the SD cards of {research_project_id}.")
    before = {n.lower() for n in names((old or {}).get("trappers"))}
    reasons += [f"{n} is not one of the trappers." for n in names(visit.get("trappers")) if n.lower() not in trappers and n.lower() not in before]
    return reasons


@router.post("/update")
def update_visit(req: UpdateVisitRequest) -> dict:
    """Edits a visit kept — its key, the site and the revision, does not change. A visit that starts or closes an imported deployment cannot be edited (409). What the
    edit would make wrong — in the visit and in the visits after it that it touches — is told, and nothing is changed (422)."""
    root = config.collections_dir()
    try:
        local_folder_service.require_research_project(root, req.research_project_id)
        kept_visits = local_folder_service.list_visits(root, req.research_project_id)
        old = next((v for v in kept_visits if v["location_id"].lower() == req.location_id.lower() and str(v.get("session") or "").upper() == req.session.upper()), None)
        if old is None:
            raise HTTPException(404, f"There is no visit to {req.location_id} in {req.session}.")
        if (str(old["location_id"]).lower(), str(old.get("when") or "")) in visit_deployments.locked(kept_visits, config.load_settings().FIELDLOG.keep_seconds):
            raise HTTPException(409, f"The visit to {old['location_id']} in {old['session']} starts or closes a deployment that is imported: it cannot be edited.")
        visit = {**req.visit.model_dump(mode="json"), "location_id": old["location_id"], "session": old["session"]}
        if ("Archive" in (old.get("actions") or [])) != ("Archive" in visit["actions"]):
            raise HTTPException(422, "The action Archive cannot be added to a visit or taken from it by editing.")
        locations = local_folder_service.list_locations(root, req.research_project_id)
        location = next((l for l in locations if str(l.get("location_id", "")).lower() == visit["location_id"].lower()), None)
        visit["when"] = visit_time.to_when(visit["date"], visit["time"], location)
        others = [v for v in kept_visits if v is not old]
        reasons = _not_entities(root, req.research_project_id, old, visit) + visit_rules.edit_errors(old, visit, others, locations, local_folder_service.list_field_items(root, req.research_project_id, "sd_cards"),
                                          local_folder_service.list_unknown(root, req.research_project_id))
        if reasons:
            raise HTTPException(422, " ".join(reasons))
        kept = local_folder_service.update_visit(root, req.research_project_id, req.location_id, req.session, visit)
        _refresh_states(root, req.research_project_id)
        return {**kept, "field_logs": _write_logs(root, req.research_project_id, [kept])}
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/create-revision")
def create_revision(req: CreateRevisionRequest) -> dict:
    """Plans the next revision: it is kept, and the visit book has a planned visit to each location that can be visited — the ones that are not archived and not only planned
    in the settings: ready or active. A revision is one trip to every location, so the one before has to be finished for visits to be made in the new one: when it is not,
    the answer says which locations are still to be visited in it (`previous`), for the person to be told.

    {"session", "planned": [location ids], "previous": {"session", "missing": [location ids]} | None}. A revision that was planned and has no visit yet is the last: the next one
    is not planned until it has."""
    root = config.collections_dir()
    try:
        local_folder_service.require_active_research_project(root, req.research_project_id)
        visits = local_folder_service.list_visits(root, req.research_project_id)
        locations = local_folder_service.list_locations(root, req.research_project_id)
        unknown = local_folder_service.list_unknown(root, req.research_project_id)
        planned = local_folder_service.list_planned_revisions(root, req.research_project_id)
        made = {n for n in (visit_rules._session_number(v.get("session")) for v in visits) if n is not None}
        known = made | {n for n in (visit_rules._session_number(s) for s in planned) if n is not None} | {n for n in (visit_rules._session_number(u.get("session")) for u in unknown) if n is not None}
        latest = max(known, default=0)
        if latest and latest not in made:
            raise HTTPException(409, f"R{latest:04d} is planned and has no visit yet: register its first visit before planning the next revision.")
        sites = [str(l["location_id"]) for l in locations if l.get("location_id") and l.get("status") not in ("archived", "planned")]
        if not sites:
            raise HTTPException(409, "No location can be visited: none is ready or active. Add one, or make one ready, in the settings.")
        previous = None
        if latest:
            missing = visit_rules.revision_missing(latest, visits, locations, "", unknown)
            previous = {"session": f"R{latest:04d}", "missing": missing} if missing else None
        session = local_folder_service.plan_revision(root, req.research_project_id, f"R{latest + 1:04d}")
        return {"session": session, "planned": sorted(sites, key=str.lower), "previous": previous}
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/mark-not-visited")
def mark_not_visited(req: MarkNotVisitedRequest) -> dict:
    """Finishes a revision whose locations were not all visited: each of them that has no visit in it gets one with the status "Not revised" — the visit
    that could not be made. {"session", "marked": [location ids]}."""
    root = config.collections_dir()
    try:
        local_folder_service.require_research_project(root, req.research_project_id)
        locations = local_folder_service.list_locations(root, req.research_project_id)
        kept = local_folder_service.list_visits(root, req.research_project_id)
        number = int(req.session[1:])
        planned = {n for n in (visit_rules._session_number(x) for x in local_folder_service.list_planned_revisions(root, req.research_project_id)) if n is not None}
        # a revision that was planned and has no visit yet is marked as not visited on today's day: it has no day of its own
        today = audit.now()[:10] if number in planned else None
        records = visit_rules.not_visited_records(number, kept, locations, on=today)
        for record in records:
            location = next((l for l in locations if str(l.get("location_id", "")).lower() == record["location_id"].lower()), None)
            record["when"] = visit_time.to_when(record["date"], record["time"], location)
        local_folder_service.write_visits(root, req.research_project_id, [VisitRecord.model_validate(r).model_dump(mode="json") for r in records])
        _refresh_states(root, req.research_project_id)
        return {"session": req.session, "marked": [r["location_id"] for r in records]}
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(400, str(exc)) from exc


def _save_report(research_project_id: str, result: dict, saved: int) -> str | None:
    """The report of an import, kept with the other reports (see report_service) — its id; None when it could not be written."""
    try:
        return report_service.save(report_service.visits_import_report(research_project_id, result, saved))
    except OSError:
        return None


@router.post("/import-csv")
def import_visits_csv(req: ImportVisitsCsvRequest) -> dict:
    """Reads the visits of a CSV file for a research project: what can be kept and what is wrong with the rest — kept when `save` is set.

    When the visits are kept, the folders of the collections they change get their FileTimestampLog and FieldworkLog."""
    root = config.collections_dir()
    try:
        if req.save:
            local_folder_service.require_active_research_project(root, req.research_project_id)
        locations = local_folder_service.list_locations(root, req.research_project_id)
        kept = local_folder_service.list_visits(root, req.research_project_id)
        cards = local_folder_service.list_field_items(root, req.research_project_id, "sd_cards")
        cameras = local_folder_service.list_field_items(root, req.research_project_id, "cameras")
        field_options = config.load_settings().FIELDLOG
        text, fmt, mapping, time_source = req.csv, req.format, req.mapping, field_options.time_source
        if fmt == "epicollect-api":
            # the entries come from Epicollect5 as rows of a visit's columns; the time of a visit is the one the settings say (by default when the entry was created, UTC: the Time of the form is local)
            try:
                text = epicollect_service.visits_csv(config.load_settings())
            except epicollect_service.EpicollectError as exc:
                raise HTTPException(400, str(exc)) from exc
            fmt, mapping = "mapped", {c: c for c in epicollect_service.VISIT_COLUMNS}
        if fmt == "epicollect-csv":
            # the download of the new Epicollect5 project: its questions are found by their labels, and the day and the time of a visit are when its entry was created (UTC)
            try:
                text = epicollect_service.visits_from_csv(text)
            except epicollect_service.EpicollectError as exc:
                raise HTTPException(400, str(exc)) from exc
            fmt, mapping = "mapped", {c: c for c in epicollect_service.VISIT_COLUMNS}
            time_source = "created_at"   # the form has no date or time: a visit happened when its entry was created
        if req.format in ("epicollect-csv", "epicollect-api"):
            # the form gives one place, the one of the visit: a location that is created from it has those coordinates (its timezone and its summer time are the defaults asked for)
            text = _with_location_coordinates(text)
            mapping = {**mapping, "location_latitude": "location_latitude", "location_longitude": "location_longitude"}
        # the form of Epicollect5 lets a site be made on the spot (New site): its timezone is the one asked for, UTC when none was
        from_epicollect = req.format in ("epicollect-csv", "epicollect-api")
        defaults = {"timezone": "UTC", "daylight_saving": "no", **(req.defaults or {})} if from_epicollect else req.defaults
        result = visits_csv.parse_visits(text, locations, kept, mapping, {"time_source": time_source, "cards": cards, "cameras": cameras, "create": req.create, "close_revisions": req.close_revisions, "defaults": defaults, "new_site_makes_location": from_epicollect, "trappers": _trapper_names(),
                                                                                                                                  "unknown": local_folder_service.list_unknown(root, req.research_project_id)})
        saved = field_logs = report = None
        if req.save:
            # what the visits need is created first: their locations, cameras and SD cards
            for location in result["create"]["locations"]:
                local_folder_service.write_location(root, req.research_project_id, location)
            for kind, kept_items in (("cameras", cameras), ("sd_cards", cards)):
                if result["create"][kind]:
                    local_folder_service.write_field_items(root, req.research_project_id, kind, [*kept_items, *result["create"][kind]])
            # the revision before is closed first, when asked: its locations still planned are kept as not visited
            if result["closed"]:
                local_folder_service.write_visits(root, req.research_project_id, [VisitRecord.model_validate(m).model_dump(mode="json") for m in result["closed"]])
            saved = local_folder_service.write_visits(root, req.research_project_id, result["visits"])
            local_folder_service.write_unknown(root, req.research_project_id, result["unknown"])
            _archive_locations(root, req.research_project_id, result["visits"])
            _apply_to_entities(root, req.research_project_id, result["visits"], kept)
            _refresh_states(root, req.research_project_id)
            field_logs = _write_logs(root, req.research_project_id, result["visits"])
            report = _save_report(req.research_project_id, result, saved)
    except (local_folder_service.LocalFolderError, visits_csv.VisitsCsvError) as exc:
        raise HTTPException(400, str(exc)) from exc
    # each visit is told on the wall clock of its location: the timezone of the location goes with it (the ones this file creates, too)
    zones = {str(l.get("location_id", "")).lower(): l.get("timezone") for l in [*locations, *result["create"]["locations"]]}
    visits = [{**v, "timezone": zones.get(str(v.get("location_id", "")).lower())} for v in result["visits"]]
    return {**result, "visits": visits, "saved": saved, "field_logs": field_logs, "report": report}


@router.post("/export-csv")
def export_visits_csv(req: ListVisitsRequest) -> dict:
    """The visits kept to a research project as a CSV that /import-csv reads back (every visit, or those to one location when it is given): {"csv", "filename", "count"}."""
    try:
        visits = local_folder_service.list_visits(config.collections_dir(), req.research_project_id)
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(400, str(exc)) from exc
    if req.location_id:
        visits = [v for v in visits if str(v.get("location_id", "")).lower() == req.location_id.lower()]
    return {"csv": visits_csv.export_visits(visits), "filename": f"{req.research_project_id}_visits.csv", "count": len(visits)}


@router.post("/epicollect-download")
def epicollect_download() -> dict:
    """The entries of the Epicollect5 project of the settings, as the text of a CSV with a row per visit and the columns a visit has: {"csv", "count"}."""
    try:
        text = epicollect_service.visits_csv(config.load_settings())
    except epicollect_service.EpicollectError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"csv": text, "count": max(text.count("\n") - 1, 0)}


@router.post("/csv-columns")
def csv_columns(req: VisitsCsvColumnsRequest) -> dict:
    """The columns of a CSV file, a few of its rows, the fields of a visit it can give and the column that most likely gives each."""
    try:
        needed_by = {f: [e for e, spec in visits_csv.CREATABLE.items() if f in spec["required"]] for f, _, _ in visits_csv.FIELDS}
        return {**visits_csv.suggest_mapping(req.csv), "fields": [
            {"field": f, "label": label, "required": required, "entity": visits_csv.ENTITY_ONLY.get(f), "required_with": needed_by[f]} for f, label, required in visits_csv.FIELDS]}
    except visits_csv.VisitsCsvError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/closed")
def closed_visits(req: ListVisitsRequest) -> dict:
    """The visits of a research project that closed a deployment and have none yet — the ones a deployment is imported for."""
    try:
        closed = local_folder_service.closed_visits(config.collections_dir(), req.research_project_id)
        # with what the two visits say of the deployment, mixed as the FieldworkLog mixes them: what the form of the deployment starts from
        # each visit is told on the wall clock of its location: the timezone of the location goes with it
        zones = {str(l.get("location_id", "")).lower(): l.get("timezone") for l in local_folder_service.list_locations(config.collections_dir(), req.research_project_id, include_deleted=True)}

        def zoned(visit: dict) -> dict:
            return {**visit, "timezone": zones.get(str(visit.get("location_id", "")).lower())}
        return {"results": [{"visit": zoned(c["visit"]), "end": zoned(c["end"]), "details": visit_deployments.merged_details(c["visit"], c["end"])} for c in closed]}
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/link")
def link_visit(req: LinkVisitRequest) -> dict:
    """Records which deployment a visit closed, once it is imported."""
    try:
        root = config.collections_dir()
        linked = local_folder_service.link_visit(root, req.research_project_id, req.location_id, req.date.isoformat(), req.time.isoformat(), req.deployment_id)
        _refresh_states(root, req.research_project_id)
        return linked
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(400, str(exc)) from exc


def _with_location_coordinates(text: str) -> str:
    """The CSV of the visits of Epicollect5 with two columns more, the coordinates of the location: the form says only the place of the visit, which a new location takes."""
    import csv
    import io
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        return text
    names = [*rows[0].keys(), "location_latitude", "location_longitude"]
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=names, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({**row, "location_latitude": row.get("latitude", ""), "location_longitude": row.get("longitude", "")})
    return out.getvalue()


def _wall_clock(visit: dict) -> str:
    """The day and the time of a visit on the wall clock of its location (2026-09-14T08:30:00) — what the visit says, not the instant."""
    return f"{visit.get('date')}T{visit.get('time')}"


@router.post("/deployments")
def deployments(req: ListVisitsRequest) -> dict:
    """The deployments the visits of a research project say — closed ones (a visit left the camera and a later one collected its card) and open ones (the camera is
    still out) — by collection, with their fields as Camtrap DP names them."""
    try:
        root = config.collections_dir()
        local_folder_service.require_research_project(root, req.research_project_id)
        found = visit_deployments.deployments(local_folder_service.list_visits(root, req.research_project_id, req.location_id), config.load_settings().FIELDLOG.keep_seconds)
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(400, str(exc)) from exc
    results = []
    failures = local_folder_service.list_upload_failures(root, req.research_project_id)
    # each deployment is told in the timezone of its location, as the visits are: the day and the time on the wall clock there, besides the instants
    zones = {str(l.get("location_id", "")).lower(): l.get("timezone") for l in local_folder_service.list_locations(root, req.research_project_id, include_deleted=True)}
    for d in found:
        imported = d["start_visit"].get("deployment_id")
        uploaded_at, on_trapper = _trapper_state(root, req.research_project_id, imported)
        results.append({k: v for k, v in d.items() if k not in ("start_visit", "end_visit")} | {
            "start_session": d["start_visit"].get("session"), "end_session": (d["end_visit"] or {}).get("session"),
            "start_local": _wall_clock(d["start_visit"]), "end_local": _wall_clock(d["end_visit"]) if d["end_visit"] else None, "timezone": zones.get(str(d["site"]).lower()),
            # whether the deployment was created and its images imported (its visit says which deployment it gave), and whether it is on Trapper
            "images_stored": bool(imported), "uploaded_at": uploaded_at, "on_trapper": on_trapper,
            "uploads": _uploads_of(root / req.research_project_id / imported.split("-", 1)[0] / imported) if imported else [],
            # the upload to each uploader in use is its own: planned, done or failed — apart from the deployment's own state; a deployment that will not be made has none
            "upload_states": [] if d["no_images"] else _upload_states(root, req.research_project_id, imported, d["deployment_id"], failures),
        })
    return {"results": results}


@router.post("/field-logs")
def field_logs(req: FieldLogsRequest) -> dict:
    """Writes, in the folder of each collection the visits give deployments to, its FileTimestampLog (the closed deployments' start and end) and its FieldworkLog
    (every deployment, closed or open, with its fields as Camtrap DP names them)."""
    try:
        return visit_deployments.write_collection_logs(config.collections_dir(), req.research_project_id, req.collections, config.load_settings().FIELDLOG.keep_seconds)
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/book")
def visit_book(req: ListVisitsRequest) -> dict:
    """The visit book of a research project: its visits, each with the deployment it started and whether that is closed (a later visit collected its card) or
    open (the camera is still out) — and a row for each location that was not visited in a session the visits have (`not_done`)."""
    try:
        root = config.collections_dir()
        local_folder_service.require_research_project(root, req.research_project_id)
        _refresh_states(root, req.research_project_id)  # what was kept before the states were is given its own
        visits = local_folder_service.list_visits(root, req.research_project_id, req.location_id)
        locations = local_folder_service.list_locations(root, req.research_project_id) if req.location_id is None else None
        book = visit_deployments.visit_book(visits, config.load_settings().FIELDLOG.keep_seconds, locations,
                                            [u for u in local_folder_service.list_unknown(root, req.research_project_id) if req.location_id is None or u["location_id"].lower() == req.location_id.lower()],
                                            local_folder_service.list_planned_revisions(root, req.research_project_id))
        # a visit is told on the wall clock of its location: the timezone of the location goes with it
        zones = {str(l.get("location_id", "")).lower(): l.get("timezone") for l in local_folder_service.list_locations(root, req.research_project_id, include_deleted=True)}
        for visit in book:
            visit["uploaded_at"], visit["on_trapper"] = _trapper_state(root, req.research_project_id, visit.get("deployment_id"))
            visit["timezone"] = zones.get(str(visit.get("location_id", "")).lower())
        return {"results": book}
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(400, str(exc)) from exc
