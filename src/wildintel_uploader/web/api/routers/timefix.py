"""FastAPI router — fixing the dates and times of a copied card's images (see services.timefix_service)."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from wildintel_uploader.core.services import timefix_service

router = APIRouter(prefix="/api/timefix", tags=["timefix"])


class ProjectRequest(BaseModel):
    research_project_id: str


class DeploymentRequest(ProjectRequest):
    collection: str
    deployment_id: str


class ShiftRequest(DeploymentRequest):
    first: str
    last: Optional[str] = None
    offset_seconds: int
    reason: str = ""


class RemoveRequest(DeploymentRequest):
    names: list[str]
    reason: str = ""


def _call(function, *args):
    try:
        return function(*args)
    except timefix_service.TimeFixError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/collections")
def collections(req: ProjectRequest) -> dict:
    """The collections with copied cards, each with its deployments."""
    return {"results": timefix_service.collections(req.research_project_id)}


@router.post("/timeline")
def timeline(req: DeploymentRequest) -> dict:
    """The deployment's images in the camera's order, with their times, segments and the fixes made so far."""
    return _call(timefix_service.timeline, req.research_project_id, req.collection, req.deployment_id)


@router.post("/shift")
def shift(req: ShiftRequest) -> dict:
    """Moves the date and time of a run of images by an offset; returns the timeline after it."""
    return _call(timefix_service.shift, req.research_project_id, req.collection, req.deployment_id, req.first, req.last, req.offset_seconds, req.reason)


@router.post("/remove")
def remove(req: RemoveRequest) -> dict:
    """Takes images whose time can't be made right out of the deployment; returns the timeline after it."""
    return _call(timefix_service.remove, req.research_project_id, req.collection, req.deployment_id, req.names, req.reason)


@router.post("/restore")
def restore(req: DeploymentRequest) -> dict:
    """Puts the deployment back as its card was; returns the timeline after it."""
    return _call(timefix_service.restore, req.research_project_id, req.collection, req.deployment_id)
