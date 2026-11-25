"""FastAPI router — "Import deployment" wizard sessions (see
services.session_store)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from wildintel_uploader.core.schemas.requests import SaveDetailsRequest, SaveScanRequest, SaveSelectionRequest
from wildintel_uploader.core.services import session_store

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.get("")
def list_sessions() -> list[dict]:
    """Unfinished runs, newest first — offered on startup to resume."""
    return session_store.list_sessions()


@router.post("/scan")
def save_scan(req: SaveScanRequest) -> dict:
    """Saves the source folder and its scan result — the wizard's first
    step, so this creates the session on the first call."""
    try:
        return session_store.write_scan_phase(req.task_id, source_dir=req.source_dir, scan=req.scan.model_dump())
    except session_store.InvalidTaskId as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/selection")
def save_selection(req: SaveSelectionRequest) -> dict:
    """Saves the chosen research project/classification project/location
    into an existing session."""
    try:
        return session_store.write_selection_phase(req.task_id, selection=req.selection.model_dump())
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/details")
def save_details(req: SaveDetailsRequest) -> dict:
    """Saves the deployment's own fields into an existing session — the run
    is then ready to import."""
    try:
        return session_store.write_details_phase(req.task_id, deployment=req.deployment.model_dump())
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.delete("/{task_id}")
def discard(task_id: str) -> dict:
    try:
        session_store.discard_session(task_id)
    except session_store.InvalidTaskId as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"status": "discarded"}
