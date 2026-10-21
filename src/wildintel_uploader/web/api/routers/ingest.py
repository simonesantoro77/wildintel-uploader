"""FastAPI router — copying the SD cards, guided by the field records (see services.ingest_service)."""
from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from wildintel_uploader.core.logging_setup import debugging
from wildintel_uploader.core.services import ingest_service

router = APIRouter(prefix="/api/ingest", tags=["ingest"])
logger = logging.getLogger(__name__)


class ProjectRequest(BaseModel):
    research_project_id: str


class CollectionRequest(BaseModel):
    research_project_id: str
    collection: str


class InspectRequest(CollectionRequest):
    source: str
    card_label: Optional[str] = None


class CopyRequest(InspectRequest):
    deployment_id: str
    # A folder from elsewhere: its deployment need not be in the field records.
    allow_unknown: bool = False
    # The label in hand is not the one the field records say, and the user confirmed the card is the right one.
    label_confirmed: bool = False


class EjectRequest(BaseModel):
    source: str


class CardCollectionsRequest(BaseModel):
    research_project_id: Optional[str] = None


class TreeRequest(BaseModel):
    root: str
    research_project_id: Optional[str] = None


def _bad(exc: Exception) -> HTTPException:
    return HTTPException(400, str(exc))


@router.post("/collections")
def collections(req: ProjectRequest) -> dict:
    """The research project's collections that have field records, newest first."""
    try:
        return {"results": ingest_service.list_collections(req.research_project_id)}
    except ingest_service.IngestError as exc:
        raise _bad(exc) from exc


@router.post("/status")
def status(req: CollectionRequest) -> dict:
    """Each deployment of the collection: camera still out, card to copy, or copied."""
    try:
        return ingest_service.collection_status(req.research_project_id, req.collection)
    except ingest_service.IngestError as exc:
        raise _bad(exc) from exc


@router.post("/prepare")
def prepare(req: CollectionRequest) -> dict:
    """Makes the collection's cards folder: its FileTimestampLog and a folder per deployment whose card was collected."""
    try:
        return ingest_service.prepare_collection(req.research_project_id, req.collection)
    except ingest_service.IngestError as exc:
        raise _bad(exc) from exc


@router.post("/inspect")
def inspect(req: InspectRequest) -> dict:
    """A card looked at: its files and dates, whether it was copied already, and the deployments it may belong to."""
    try:
        return ingest_service.inspect_source(req.source, req.research_project_id, req.collection, req.card_label)
    except ingest_service.IngestError as exc:
        raise _bad(exc) from exc


@router.post("/copy")
def copy(req: CopyRequest) -> StreamingResponse:
    """Copies a card into its deployment's folder. Answers NDJSON: a {"type": "copy"} per file and, last, {"type":
    "done", "record"}; a failure midway is an {"type": "error", "detail"} line. What is checked before anything is
    copied (a card copied already, a folder that holds files…) is a plain 400."""
    events = ingest_service.copy_stream(req.source, req.research_project_id, req.collection, req.deployment_id, req.card_label,
                                        allow_unknown=req.allow_unknown, label_confirmed=req.label_confirmed)
    try:
        first = next(events)
    except ingest_service.IngestError as exc:
        raise _bad(exc) from exc
    except StopIteration:
        raise HTTPException(400, "Nothing to copy.") from None

    def lines() -> Iterator[str]:
        yield json.dumps(first) + "\n"
        try:
            for event in events:
                yield json.dumps(event) + "\n"
        except ingest_service.IngestError as exc:
            yield json.dumps({"type": "error", "detail": str(exc)}) + "\n"
        except Exception as exc:
            logger.warning("Copying %s failed: %s", req.deployment_id, exc, exc_info=debugging())
            yield json.dumps({"type": "error", "detail": f"The copy failed: {exc}"}) + "\n"

    return StreamingResponse(lines(), media_type="application/x-ndjson")


@router.post("/scan-tree")
def scan_tree(req: TreeRequest) -> dict:
    """The folders under a root that hold images, with their collection and site guessed from the path."""
    try:
        return ingest_service.scan_tree(req.root, req.research_project_id)
    except ingest_service.IngestError as exc:
        raise _bad(exc) from exc


@router.post("/eject")
def eject(req: EjectRequest) -> dict:
    """Ejects the removable drive a card was copied from: {"ejected", "message"}."""
    return ingest_service.eject(req.source)


@router.post("/corrections")
def corrections(req: CollectionRequest) -> dict:
    """The corrections for the field data written down while copying the collection's cards."""
    try:
        return {"results": ingest_service.read_corrections(req.research_project_id, req.collection)}
    except ingest_service.IngestError as exc:
        raise _bad(exc) from exc


@router.post("/card-collections")
def card_collections(req: CardCollectionsRequest) -> dict:
    """The collections in the cards folder, newest first, to pick the one Process collection works on."""
    return {"results": ingest_service.card_collections(req.research_project_id)}


@router.post("/field-details")
def field_details(req: CollectionRequest) -> dict:
    """What the field records say of each deployment of the collection: who set it up, the camera, tags and notes."""
    try:
        return {"results": ingest_service.field_details(req.research_project_id, req.collection)}
    except ingest_service.IngestError as exc:
        raise _bad(exc) from exc
