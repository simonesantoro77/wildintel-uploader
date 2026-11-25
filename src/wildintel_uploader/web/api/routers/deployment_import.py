"""FastAPI router — importing a deployment: scan a local folder for a
starting point (dates, camera model), then organize it and register the
deployment in Trapper, both as one streamed operation (see
services.deployment_import_service)."""
from __future__ import annotations

import json
import logging
import queue
import threading
import time
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from wildintel_uploader.core import config
from wildintel_uploader.core.logging_setup import debugging
from wildintel_uploader.core.schemas.requests import (
    BrowseFolderRequest, CardRequest, CheckCollectionRequest, CollectionPathRequest, ImportDeploymentRequest, ImportLocalRequest,
    DeleteLocationRequest, ExistingDeploymentsRequest, LocalLocationsRequest, PreviousDeploymentsRequest, ResearchProjectRecord, SaveLocationRequest, ScanFolderRequest, TimestampLogRequest,
    NextRevisionRequest, UpdateLocationRequest, UpdateResearchProjectRequest, ValidateDeploymentRequest, ValidateImagesRequest,
)
from wildintel_uploader.core.services import camera_info, card_copy_service, deployment_import_service, deployment_photos, file_manager, folder_picker, local_folder_service, preprocessing_service, report_service, seal_service, statistics_service, visit_deployments
from wildintel_uploader.web.api.routers.trapper import http_exc, resolve

router = APIRouter(prefix="/api/deployment-import", tags=["deployment-import"])
logger = logging.getLogger(__name__)


@router.post("/browse-folder")
def browse_folder(req: BrowseFolderRequest = BrowseFolderRequest()) -> dict:
    """Opens the OS's native folder picker on the machine running the
    backend (always the user's own — see services.folder_picker) and
    returns {"path": ...}, or {"path": None} if cancelled."""
    try:
        path = folder_picker.pick_folder(req.title or "Select the deployment's images folder")
    except folder_picker.FolderPickerUnavailable as exc:
        raise HTTPException(501, str(exc)) from exc
    return {"path": path}


@router.post("/copy-card")
def copy_card(req: CardRequest) -> StreamingResponse:
    """Copies a camera's memory card — read only — to a temporary folder of this computer, so that its images are processed as any local folder. Streamed:
    "start", "progress" after each file and "done" with the `path` of the copy; it is removed with /discard-card-copy when the import is over."""
    return _stream(card_copy_service.copy_card(req.path), "The SD card could not be copied")


@router.post("/eject-card")
def eject_card(req: CardRequest) -> dict:
    """Ejects the removable drive a memory card was copied from, so it can be taken out: {"ejected": bool, "message"}."""
    return card_copy_service.eject(req.path)


@router.post("/discard-card-copy")
def discard_card_copy(req: CardRequest) -> dict:
    """Removes the temporary copy of a memory card — only one made by /copy-card. {"removed": bool}"""
    return {"removed": card_copy_service.discard(req.path)}


@router.post("/check-collection")
def check_collection(req: CheckCollectionRequest) -> dict:
    """Whether a local collection folder already exists, and its recorded
    name if it does (see services.local_folder_service.check_collection) —
    the "Local folder" destination's own first step."""
    return local_folder_service.check_collection(Path(req.path).expanduser())


@router.post("/research-projects/list")
def list_research_projects() -> dict:
    """The research projects already kept in the collections folder — the
    wizard's first question, "where was it taken?", is answered from them.
    Empty until one is added."""
    return {"results": local_folder_service.list_research_projects(config.collections_dir())}


@router.post("/research-projects/save")
def save_research_project(req: ResearchProjectRecord) -> dict:
    """Adds a research project to the collections folder (by hand, or as
    filled in from Trapper) — 409 if its acronym is already there."""
    try:
        return local_folder_service.write_research_project(config.collections_dir(), req.model_dump())
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(409 if "already exists" in str(exc) else 400, str(exc)) from exc


@router.post("/research-projects/update")
def update_research_project(req: UpdateResearchProjectRequest) -> dict:
    """Changes a kept research project — its name, description, keywords and status…; the fields left out stay as they are (its acronym names
    its folder and can't change). 404 if it isn't there."""
    changes = req.model_dump(exclude={"acronym", "trapper_pk"}, exclude_none=True, exclude_unset=True)
    try:
        return local_folder_service.update_research_project(config.collections_dir(), req.acronym, changes)
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(404 if "isn't in" in str(exc) else 400, str(exc)) from exc


@router.post("/research-projects/delete")
def delete_research_project(req: LocalLocationsRequest) -> dict:
    """Deletes a research project with its locations and visits — 409 when it holds anything more (collections, deployments, images), 404 if
    it isn't there."""
    try:
        return local_folder_service.delete_research_project(config.collections_dir(), req.research_project_id)
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(404 if "isn't in" in str(exc) else 409 if "still holds" in str(exc) else 400, str(exc)) from exc


@router.post("/locations/list")
def list_locations(req: LocalLocationsRequest) -> dict:
    """The locations kept for a research project in the collections folder."""
    try:
        return {"results": local_folder_service.list_locations(config.collections_dir(), req.research_project_id)}
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/locations/save")
def save_location(req: SaveLocationRequest) -> dict:
    """Adds a location to a research project already kept in the collections
    folder (by hand, or as filled in from Trapper) — 409 if its id is used."""
    try:
        return local_folder_service.write_location(config.collections_dir(), req.research_project_id, req.location.model_dump(), by_hand=req.by_hand)
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(409 if "already exists" in str(exc) else 400, str(exc)) from exc


@router.post("/locations/update")
def update_location(req: UpdateLocationRequest) -> dict:
    """Changes a kept location — its name, where it is, its status. Its timezone and its summer-time setting belong to the location and are fixed
    when it is created: asking for a different one is a 409. The fields left out stay as they are; 404 if the location isn't there."""
    changes = req.model_dump(include={"name", "latitude", "longitude", "coordinate_uncertainty", "timezone", "ignore_dst", "in_service", "status", "status_date", "status_note"}, exclude_unset=True)
    if changes.get("status") is None:
        changes.pop("status", None)
    try:
        return local_folder_service.update_location(config.collections_dir(), req.research_project_id, req.location_id, changes)
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(404 if "isn't in" in str(exc) else 409 if "can't be changed" in str(exc) else 400, str(exc)) from exc


@router.post("/locations/delete")
def delete_location(req: DeleteLocationRequest) -> dict:
    """Deletes a kept location — 409 when visits were made to it (or it comes from Trapper), 404 if it isn't there."""
    try:
        return local_folder_service.delete_location(config.collections_dir(), req.research_project_id, req.location_id)
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(404 if "isn't in" in str(exc) else 409 if "still has" in str(exc) or "comes from TRAPPER" in str(exc) else 400, str(exc)) from exc


@router.get("/exiftool")
def exiftool() -> dict:
    """Whether ExifTool is installed — the preprocessing's metadata needs it."""
    path = camera_info.exiftool_path()
    return {"available": path is not None, "path": path}


@router.get("/log-entry")
def log_entry(research_project_id: str, deployment_id: str) -> dict:
    """What the collection's FileTimestampLog and FieldworkLog say of a deployment, if they have its row — the dates and details a
    deployment can be filled in from."""
    try:
        return deployment_import_service.log_entry(research_project_id, deployment_id)
    except (deployment_import_service.DeploymentImportError, local_folder_service.LocalFolderError) as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/timestamp-log")
def timestamp_log(req: TimestampLogRequest) -> dict:
    """Puts the deployment's start and end in its collection's <collection>_FileTimestampLog.csv —
    wildintel-tools' file, one row per deployment — before the postvalidation, and its row in the
    <collection>_FieldworkLog.csv beside it: its fields as Camtrap DP names them, in UTC, and what the
    visits it is of say of it. The collection is the one the deployment id names, in the research project's folder."""
    try:
        collection = deployment_import_service.default_collection_dir(req.research_project_id, req.deployment.deployment_id)
        if local_folder_service.is_synced(collection / req.deployment.deployment_id):
            raise deployment_import_service.DeploymentImportError(f"{req.deployment.deployment_id} was synced from TRAPPER, so it can't be modified here.")
        # The camera's wall-clock time: what the images' EXIF holds, whatever the designator says.
        start = datetime.fromisoformat(req.deployment.start_date).replace(tzinfo=None)
        end = datetime.fromisoformat(req.deployment.end_date).replace(tzinfo=None)
        result = local_folder_service.upsert_timestamp_log(collection, req.deployment.deployment_id, start, end)
        fieldwork = local_folder_service.upsert_fieldwork_log(
            collection, deployment_import_service.fieldwork_log_row(req.deployment, req.visits.model_dump() if req.visits else None))
        return {**result, "collection": collection.name, "fieldwork_log": fieldwork}
    except (deployment_import_service.DeploymentImportError, local_folder_service.LocalFolderError) as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/seal")
def seal_status(req: CollectionPathRequest) -> dict:
    """Whether the deployment kept in the collections folder is still what its seal.json says (see services.seal_service):
    {"status": "none" | "valid" | "broken", "changed", "missing", "added", "deployment_changed", "seal_changed"}."""
    dest = deployment_import_service.existing_deployment_dir(req.research_project_id, req.deployment_id)
    if dest is None:
        raise HTTPException(404, f"{req.deployment_id} isn't in the collections folder.")
    return seal_service.verify(dest)


@router.post("/collection-path")
def collection_path(req: CollectionPathRequest) -> dict:
    """Where the deployment's collection is kept locally by default —
    <collections folder>/<research project id>/<R0003> — and whether it
    already exists (and its recorded name), so the "Local folder" step can
    start from it."""
    try:
        path = deployment_import_service.default_collection_dir(req.research_project_id, req.deployment_id)
    except deployment_import_service.DeploymentImportError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"path": str(path), "collection": path.name, **local_folder_service.check_collection(path)}


@router.post("/existing-deployments")
def existing_deployments(req: ExistingDeploymentsRequest) -> dict:
    """For each deployment id, the folder where it is already kept in the collections folder — or null when it is not there
    yet — so the details can say that a deployment already exists before it is imported again."""
    results = {}
    for deployment_id in req.deployment_ids:
        found = deployment_import_service.existing_deployment_dir(req.research_project_id, deployment_id)
        results[deployment_id] = str(found) if found else None
    return {"results": results}


@router.post("/list-local-deployments")
def list_local_deployments(req: CheckCollectionRequest) -> dict:
    """Deployments already organized in a local collection folder — for the
    "Local folder" destination's "use an existing deployment" branch."""
    return {"results": local_folder_service.list_deployments(Path(req.path).expanduser())}


@router.post("/scan-folder")
def scan_folder(req: ScanFolderRequest) -> dict:
    try:
        return deployment_import_service.scan_folder(Path(req.path).expanduser())
    except deployment_import_service.DeploymentImportError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/guess-details")
def guess_details(req: ScanFolderRequest) -> dict:
    """The date range and the camera of a folder's images, read from their metadata — what the deployment form starts from."""
    try:
        return deployment_import_service.guess_details(Path(req.path).expanduser())
    except deployment_import_service.DeploymentImportError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/scan-session")
def scan_session(req: ScanFolderRequest) -> dict:
    """A session folder — one subfolder per deployment — and the scan of each subfolder."""
    try:
        return deployment_import_service.scan_session(Path(req.path).expanduser())
    except deployment_import_service.DeploymentImportError as exc:
        raise HTTPException(400, str(exc)) from exc


def _keep(build) -> str | None:
    """Writes the report build() makes, and returns its id — None if it couldn't be, which is no reason to fail what it reports."""
    try:
        return report_service.save(build())
    except Exception as exc:
        logger.warning("Could not write the report: %s", exc, exc_info=debugging())
        return None


@router.post("/validate-images")
def validate_images(req: ValidateImagesRequest) -> dict:
    """Opt-in checks over an already-scanned folder — corrupted files, an
    out-of-order shooting sequence, and images spread across subfolders
    (see services.deployment_import_service.validate_images)."""
    checks = frozenset(req.checks) if req.checks is not None else None
    try:
        source = Path(req.path).expanduser()
        imported = None
        if req.research_project_id and (checks is None or "duplicates" in checks):
            imported = local_folder_service.imported_source_hashes(config.collections_dir(), req.research_project_id, req.deployment_id)
        result = deployment_import_service.validate_images(source, checks, detail=True, imported=imported)
    except (deployment_import_service.DeploymentImportError, local_folder_service.LocalFolderError) as exc:
        raise HTTPException(400, str(exc)) from exc
    return {**result, "report_id": _keep(lambda: report_service.validation_report(result, source, checks))}


@router.post("/validate-images/stream")
def validate_images_stream(req: ValidateImagesRequest) -> StreamingResponse:
    """The same checks as /validate-images, told as NDJSON while they run: {"type": "progress", "step", "done", "total"} (at most a few
    a second, and the last of each step) and, at the end, {"type": "done", "result": <what /validate-images answers>}. A failure is {"type": "error", "detail"}."""
    checks = frozenset(req.checks) if req.checks is not None else None
    source = Path(req.path).expanduser()
    if not source.is_dir():
        raise HTTPException(400, f"Not a folder: {source}")
    events: queue.Queue = queue.Queue()
    last = {"step": None, "at": 0.0}

    def progress(step: str, done: int, total: int) -> None:
        now = time.monotonic()
        if step != last["step"] or done >= total or now - last["at"] >= 0.25:
            last["step"], last["at"] = step, now
            events.put({"type": "progress", "step": step, "done": done, "total": total})

    def work() -> None:
        try:
            imported = None
            if req.research_project_id and (checks is None or "duplicates" in checks):
                imported = local_folder_service.imported_source_hashes(config.collections_dir(), req.research_project_id, req.deployment_id)
            result = deployment_import_service.validate_images(source, checks, detail=True, imported=imported, progress=progress)
            events.put({"type": "done", "result": {**result, "report_id": _keep(lambda: report_service.validation_report(result, source, checks))}})
        except Exception as exc:
            logger.warning("Validating the images failed: %s", exc, exc_info=debugging())
            events.put({"type": "error", "detail": str(exc)})

    def lines() -> Iterator[str]:
        threading.Thread(target=work, daemon=True).start()
        while True:
            event = events.get()
            yield json.dumps(event) + "\n"
            if event["type"] != "progress":
                return

    return StreamingResponse(lines(), media_type="application/x-ndjson")


@router.post("/previous-deployments")
def previous_deployments(req: PreviousDeploymentsRequest) -> dict:
    """For each deployment id, the details kept for the closest earlier revision of the same
    location in this research project — or null when there is none — to fill a new revision in from."""
    root = config.collections_dir()
    return {"results": {
        deployment_id: statistics_service.previous_deployment(root, req.research_project_id, deployment_id)
        for deployment_id in req.deployment_ids
    }}


@router.post("/next-revision")
def next_revision(req: NextRevisionRequest) -> dict:
    """The revision a new deployment at this location is expected to have — one after the highest kept for it in the
    research project, or 1 — as {"last", "next"}."""
    return statistics_service.next_revision(config.collections_dir(), req.research_project_id, req.location_id)


@router.post("/validate-deployment")
def validate_deployment(req: ValidateDeploymentRequest) -> dict:
    """Opt-in checks of the scanned images against the deployment's own
    fields — shooting times within its date range, camera consistency (see
    services.deployment_import_service.validate_deployment_consistency)."""
    checks = frozenset(req.checks) if req.checks is not None else None
    try:
        source = Path(req.path).expanduser()
        result = deployment_import_service.validate_deployment_consistency(
            source, req.deployment, checks, collection_name=req.collection_name,
            expected_location_id=req.expected_location_id, tolerance_hours=req.tolerance_hours,
            visit=req.visit.model_dump() if req.visit else None,
        )
        # The statistical checks compare this revision with the location's previous ones.
        wanted = frozenset(statistics_service.STATISTIC_CHECKS) if checks is None else checks & frozenset(statistics_service.STATISTIC_CHECKS)
        if wanted:
            stats = req.statistics
            result.update(statistics_service.statistical_checks(
                statistics_service.times_of_folder(source), config.collections_dir(), req.research_project_id,
                req.deployment.deployment_id, wanted, sequence_gap_seconds=stats.sequence_gap_seconds,
                min_revisions=stats.min_revisions, method=stats.method,
                tolerances={
                    "image_count": stats.image_count_tolerance, "sequence_count": stats.sequence_count_tolerance,
                    "sequence_length": stats.sequence_length_tolerance,
                },
            ))
    except deployment_import_service.DeploymentImportError as exc:
        raise HTTPException(400, str(exc)) from exc
    parameters = {"checks": sorted(checks) if checks is not None else None, "tolerance_hours": req.tolerance_hours, **req.statistics.model_dump()}
    return {**result, "report_id": _keep(lambda: report_service.postvalidation_report(result, req.deployment.deployment_id, source, parameters))}


def _location_time(research_project_id: str | None, location_id: str | None) -> dict:
    """The kept location's timezone and summer-time setting — the only source of them, whatever the request carries."""
    if not research_project_id:
        return {}
    try:
        return local_folder_service.location_time(config.collections_dir(), research_project_id, location_id)
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/import")
def import_deployment(req: ImportDeploymentRequest) -> StreamingResponse:
    """The import's events, as NDJSON:
      - {"type": "copy", "index", "total", "name"}: one file organized.
      - {"type": "registering"}: local copy done, registering with Trapper.
      - {"type": "done", "dest_dir"}: the deployment is in Trapper.
      - {"type": "error", "detail"}: something failed midway (the 200 is
        already sent by then — files already copied are left in place).

    Bad source/destination paths are a plain 400, checked before any file
    is touched."""
    url, username, password = resolve(req)
    time = _location_time(req.research_project_id, req.deployment.location_id)
    try:
        events = deployment_import_service.import_stream(
            url, username, password, req.research_project_pk, req.classification_project_pk,
            req.source_dir, req.deployment, time.get("timezone"),
            research_project_id=req.research_project_id, ignore_dst=time.get("ignore_dst", False), register=req.register_deployment,
        )
    except deployment_import_service.DeploymentImportError as exc:
        raise HTTPException(400, str(exc)) from exc

    def lines() -> Iterator[str]:
        try:
            for event in events:
                yield json.dumps(event) + "\n"
        except Exception as exc:
            logger.warning("Deployment import failed: %s", exc, exc_info=debugging())
            yield json.dumps({"type": "error", "detail": http_exc(exc).detail}) + "\n"
            return

    return StreamingResponse(lines(), media_type="application/x-ndjson")


@router.post("/preprocess")
def preprocess(req: ImportLocalRequest) -> StreamingResponse:
    """Preprocesses the images into the collection, leaving the deployment pending — not sealed, so it can be done again — until
    /consolidate freezes it. The same NDJSON events as /import-local, less the sealing."""
    if req.preprocessing is None:
        raise HTTPException(400, "Say what to preprocess.")
    return _import_local(req, consolidate=False)


@router.post("/consolidate")
def consolidate(req: ImportLocalRequest) -> StreamingResponse:
    """Freezes the preprocessed deployment: its metadata is written and it is sealed. Events: "sealing" and "done"."""
    try:
        events = preprocessing_service.consolidate_stream(req.source_dir, req.collection_dir, req.deployment)
    except deployment_import_service.DeploymentImportError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _stream(events, "Consolidating failed")


def _stream(events: Iterator[dict], failure: str) -> StreamingResponse:
    def lines() -> Iterator[str]:
        try:
            for event in events:
                yield json.dumps(event) + "\n"
        except Exception as exc:
            logger.warning("%s: %s", failure, exc, exc_info=debugging())
            yield json.dumps({"type": "error", "detail": str(exc)}) + "\n"
            return

    return StreamingResponse(lines(), media_type="application/x-ndjson")


@router.post("/import-local")
def import_local(req: ImportLocalRequest) -> StreamingResponse:
    """The same NDJSON shape as /import, without a "registering" event —
    the "Local folder" destination never talks to Trapper."""
    return _import_local(req, consolidate=True)


def _require_visit(req: ImportLocalRequest) -> None:
    """A deployment is always of a visit: the one that left the camera and the one that collected its card. A collection of a research project kept in the
    collections folder takes only the deployments its visits say — or one already linked to a visit —; the one that is not is refused before any image is touched."""
    folder = Path(req.collection_dir).expanduser().resolve().parent
    root = config.collections_dir().expanduser().resolve()
    if folder.parent != root:
        return  # not a research project's collection: there are no visits to ask
    deployment_id = req.deployment.deployment_id
    try:
        visits = local_folder_service.list_visits(root, folder.name)
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(400, str(exc)) from exc
    if any(v.get("deployment_id") == deployment_id for v in visits):
        return
    if any(d["deployment_id"] == deployment_id for d in visit_deployments.deployments(visits)):
        return
    raise HTTPException(
        400,
        f"The deployment {deployment_id or '(none)'} is not of any visit of {folder.name}: a deployment is always linked to a visit. Register the visits first, by hand or from a file with their history.",
    )


def _import_local(req: ImportLocalRequest, consolidate: bool) -> StreamingResponse:
    _require_visit(req)
    try:
        if req.preprocessing is not None:
            # The collection sits in its research project's folder, <research project>/<collection>: the images are read
            # in the timezone of the location kept there beside it — the only place it is set.
            time = local_folder_service.location_time_in(Path(req.collection_dir).expanduser().parent, req.deployment.location_id)
            if not time.get("timezone"):
                raise HTTPException(400, f"The location {req.deployment.location_id or '(none)'} has no timezone: set it in the location's time settings first.")
            options = {**req.preprocessing.model_dump(), "timezone": time["timezone"], "ignore_dst": time.get("ignore_dst", True)}
            events = preprocessing_service.preprocess_stream(
                req.source_dir, req.collection_dir, req.collection_name, req.deployment,
                preprocessing_service.PreprocessOptions(**options), consolidate=consolidate,
            )
        else:
            events = deployment_import_service.import_local_stream(
                req.source_dir, req.collection_dir, req.collection_name, req.deployment,
            )
    except deployment_import_service.DeploymentImportError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _stream(events, "Local import failed")


class OpenFolderRequest(BaseModel):
    path: str


def _open_in_file_manager(path: Path) -> None:
    """Opens a folder in the system's file explorer (a seam the tests replace)."""
    file_manager.open_folder(path)


@router.post("/open-folder")
def open_folder(req: OpenFolderRequest) -> dict:
    """Opens a folder kept by the app (inside its data folder, or its collections, reports or packages folder — nothing else) in the file explorer."""
    target = Path(req.path).expanduser().resolve()
    roots = [d.resolve() for d in (config.data_dir(), config.collections_dir(), config.reports_dir(), config.packages_dir())]
    if not any(root == target or root in target.parents for root in roots):
        raise HTTPException(400, "Only folders inside the app's data folder, or its collections, reports or packages folder, can be opened.")
    if not target.is_dir():
        raise HTTPException(404, "That folder does not exist.")
    try:
        _open_in_file_manager(target)
    except OSError as exc:
        raise HTTPException(500, f"Could not open the file explorer: {exc}") from exc
    return {"opened": str(target)}


@router.get("/photos")
def deployment_photos_list(research_project_id: str, collection: str, deployment_id: str) -> dict:
    """The photos of a created deployment, to look at them: {"photos": [{"name", "taken"}]}."""
    try:
        return {"photos": deployment_photos.list_photos(config.collections_dir(), research_project_id, collection, deployment_id)}
    except deployment_photos.DeploymentPhotosError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/photo")
def deployment_photo(research_project_id: str, collection: str, deployment_id: str, name: str, size: str = "thumb") -> Response:
    """A photo of a created deployment, as a JPEG: a thumbnail, or (size=large) one to look at closely."""
    try:
        body = deployment_photos.photo_jpeg(config.collections_dir(), research_project_id, collection, deployment_id, name,
                                            deployment_photos.LARGE if size == "large" else deployment_photos.THUMBNAIL)
    except deployment_photos.DeploymentPhotosError as exc:
        raise HTTPException(404, str(exc)) from exc
    return Response(body, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})
