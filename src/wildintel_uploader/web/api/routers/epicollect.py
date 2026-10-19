"""FastAPI router — the Epicollect5 project saved in the settings (see services.epicollect_service)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from wildintel_uploader.core.services import epicollect_service

router = APIRouter(prefix="/api/epicollect", tags=["epicollect"])


@router.get("/form")
def form() -> dict:
    """The inputs of the project's forms, to map them onto the fields of a deployment."""
    try:
        return epicollect_service.fetch_form()
    except epicollect_service.EpicollectError as exc:
        raise HTTPException(400, str(exc)) from exc


class TestConnectionRequest(BaseModel):
    project_slug: str | None = None
    client_id: str | None = None
    client_secret: str | None = None


@router.post("/test-connection")
def test_connection(req: TestConnectionRequest) -> dict:
    """Whether the project can be read with what is typed in the settings, saved or not. Nothing is saved."""
    try:
        return epicollect_service.test_connection(req.project_slug, req.client_id, req.client_secret)
    except epicollect_service.EpicollectError as exc:
        raise HTTPException(400, str(exc)) from exc


class EntriesRequest(BaseModel):
    location_id: str
    revision: int | None = None


@router.post("/entries")
def entries(req: EntriesRequest) -> dict:
    """The entries of the project that are this location's (and this revision's), as the fields of a deployment."""
    try:
        return {"results": epicollect_service.find_entries(req.location_id, req.revision)}
    except epicollect_service.EpicollectError as exc:
        raise HTTPException(400, str(exc)) from exc
