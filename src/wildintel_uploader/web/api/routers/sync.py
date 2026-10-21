"""FastAPI router — syncing the local collections folder with Trapper (see services.sync_service)."""
from __future__ import annotations

import json
import logging
from collections.abc import Iterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from wildintel_uploader.core import config
from wildintel_uploader.core.logging_setup import debugging
from wildintel_uploader.core.schemas.requests import SyncCollectionNamesRequest, SyncCollectionsRequest
from wildintel_uploader.core.services import deployment_import_service, local_folder_service, sync_service
from wildintel_uploader.web.api.routers.trapper import http_exc, resolve

router = APIRouter(prefix="/api/sync", tags=["sync"])
logger = logging.getLogger(__name__)


@router.post("/collection-names")
def collection_names(req: SyncCollectionNamesRequest) -> dict:
    """The research project's collections, to choose what to sync: the field ones with their deployments and what the
    collections folder already has of each, and the other ones (subsets made in Trapper), to download by their images."""
    project_id = req.research_project_acronym or str(req.research_project_pk)
    try:
        return sync_service.collections_with_deployments(resolve(req), req.research_project_pk, config.collections_dir(), project_id)
    except Exception as exc:
        logger.warning("Reading the collections of the classification project failed: %s", exc, exc_info=debugging())
        raise http_exc(exc) from exc


@router.post("/collections")
def sync_collections(req: SyncCollectionsRequest) -> StreamingResponse:
    """Creates in the collections folder what Trapper has for the classification project and it lacks — the research
    project, its locations, the collections starting with R and, in each, its timestamp log and its deployments, one
    deployment at a time. What is already there is kept as it is.

    Answers NDJSON: a {"type": "progress", "message"} per step and, last, {"type": "done", ...} with what was created
    and kept (see sync_service.sync_stream). A failure midway is an {"type": "error", "detail"} line: the 200 is
    already sent by then. The credentials and the folder name are checked first, as a plain 4xx."""
    credentials = resolve(req)
    project = {"pk": req.research_project_pk, "name": req.research_project_name, "acronym": req.research_project_acronym}
    try:
        local_folder_service.project_dir(config.collections_dir(), project["acronym"] or str(project["pk"]))
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(400, str(exc)) from exc
    if (req.download_images or req.other_collections) and not req.classification_project_pk:
        raise HTTPException(400, "Downloading images needs a classification project: Trapper only gives the files through one.")
    events = sync_service.sync_stream(credentials, config.collections_dir(), project, req.classification_project_pk, req.collections, req.deployments, req.download_images,
                                      [c.model_dump() for c in req.other_collections])

    def lines() -> Iterator[str]:
        try:
            for event in events:
                yield json.dumps(event) + "\n"
        except (local_folder_service.LocalFolderError, deployment_import_service.DeploymentImportError) as exc:
            yield json.dumps({"type": "error", "detail": str(exc)}) + "\n"
        except Exception as exc:
            logger.warning("Syncing the local collections failed: %s", exc, exc_info=debugging())
            yield json.dumps({"type": "error", "detail": http_exc(exc).detail}) + "\n"

    return StreamingResponse(lines(), media_type="application/x-ndjson")
