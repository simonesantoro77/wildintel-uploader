"""FastAPI router — the Epicollect5 project saved in the settings (see services.epicollect_service)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from wildintel_uploader.core.services import epicollect_service

router = APIRouter(prefix="/api/epicollect", tags=["epicollect"])


@router.get("/form")
def form() -> dict:
    """The inputs of the project's forms, to map them onto the fields of a deployment."""
    try:
        return epicollect_service.fetch_form()
    except epicollect_service.EpicollectError as exc:
        raise HTTPException(400, str(exc)) from exc
