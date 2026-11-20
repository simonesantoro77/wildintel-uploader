"""FastAPI router — Trapper lookups (research projects -> classification
projects / locations). No server-side session: every endpoint resolves
credentials fresh (see services.trapper_service)."""
from __future__ import annotations

import logging
from collections.abc import Callable
from typing import TypeVar

import httpx
from fastapi import APIRouter, HTTPException
from trapper_client import err

from wildintel_uploader.core.logging_setup import debugging
from wildintel_uploader.core.schemas.requests import (
    ClassificationProjectsRequest, DeploymentsRequest, LocationsRequest, TrapperCredentials,
)
from wildintel_uploader.core.services import trapper_service

router = APIRouter(prefix="/api/trapper", tags=["trapper"])
logger = logging.getLogger(__name__)

T = TypeVar("T")


def http_exc(exc: Exception) -> HTTPException:
    if isinstance(exc, err.UnauthorizedError):
        return HTTPException(401, "Incorrect TRAPPER username or password.")
    if isinstance(exc, err.ForbiddenError):
        return HTTPException(403, "You don't have permission to access this TRAPPER resource.")
    if isinstance(exc, err.NotFoundError):
        return HTTPException(404, "TRAPPER resource not found.")
    if isinstance(exc, httpx.ConnectError):
        return HTTPException(502, f"Could not connect to the TRAPPER server: {exc}")
    if isinstance(exc, httpx.TimeoutException):
        return HTTPException(504, f"Timed out connecting to the TRAPPER server: {exc}")
    return HTTPException(400, str(exc))


def resolve(req: TrapperCredentials) -> tuple[str, str, str]:
    try:
        return trapper_service.resolve_credentials(req.url, req.username, req.password)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


def call(fn: Callable[[], T]) -> T:
    try:
        return fn()
    except Exception as exc:
        logger.warning("Trapper call failed: %s", exc, exc_info=debugging())
        raise http_exc(exc) from exc


@router.get("/config")
def get_config() -> dict:
    """Saved TRAPPER connection defaults — never the password itself."""
    return trapper_service.get_connection_defaults()


@router.post("/test-connection")
def test_connection(req: TrapperCredentials) -> dict:
    """Checks the credentials, and saves them to settings.toml once they
    work — so they needn't be retyped."""
    url, username, password = resolve(req)
    result = call(lambda: trapper_service.test_connection(url, username, password))
    trapper_service.save_credentials(url, username, password)
    return result


@router.post("/research-projects")
def research_projects(req: TrapperCredentials) -> dict:
    url, username, password = resolve(req)
    return {"results": call(lambda: trapper_service.list_research_projects(url, username, password))}


@router.post("/classification-projects")
def classification_projects(req: ClassificationProjectsRequest) -> dict:
    url, username, password = resolve(req)
    return {"results": call(
        lambda: trapper_service.list_classification_projects(url, username, password, req.research_project_pk),
    )}


@router.post("/locations")
def locations(req: LocationsRequest) -> dict:
    url, username, password = resolve(req)
    return {"results": call(
        lambda: trapper_service.list_locations(url, username, password, req.research_project_pk),
    )}


@router.post("/deployments")
def deployments(req: DeploymentsRequest) -> dict:
    """Existing deployments of a research project — for the "use an
    existing deployment" wizard branch."""
    url, username, password = resolve(req)
    return {"results": call(
        lambda: trapper_service.list_deployments(url, username, password, req.research_project_pk),
    )}
