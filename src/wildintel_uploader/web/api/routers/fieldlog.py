"""FastAPI router — field records: the Epicollect download of a field trip and the fieldwork datasheet, turned into
the updated datasheet and each collection's FileTimestampLog and FieldworkLog (see services.fieldlog_service)."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from wildintel_uploader.core import config
from wildintel_uploader.core.services import fieldlog_service, file_manager, folder_picker, local_folder_service, sync_service, trapper_service

router = APIRouter(prefix="/api/fieldlog", tags=["fieldlog"])
logger = logging.getLogger(__name__)


class PickFileRequest(BaseModel):
    kind: Literal["epicollect", "datasheet"]


class FieldlogRequest(BaseModel):
    epicollect: str
    datasheet: str
    research_project_id: Optional[str] = None


class TakeProjectRequest(BaseModel):
    pk: int
    name: Optional[str] = None
    acronym: Optional[str] = None


class OpenRequest(BaseModel):
    path: str


_PICK = {
    "epicollect": ("Select the field survey from the app (CSV)", ["*.csv"]),
    "datasheet": ("Select the field history (fieldwork datasheet, .xlsx)", ["*.xlsx", "*.xlsm"]),
}


@router.get("/columns")
def columns() -> dict:
    """The Epicollect columns the field records read, with the name each has unless the settings map it."""
    return {"results": fieldlog_service.column_fields()}


@router.post("/pick-file")
def pick_file(req: PickFileRequest) -> dict:
    """Opens the OS's own file dialog for the Epicollect download or the datasheet: {"path"}, None if cancelled."""
    title, patterns = _PICK[req.kind]
    try:
        return {"path": folder_picker.pick_file(title, patterns)}
    except folder_picker.FolderPickerUnavailable as exc:
        raise HTTPException(501, str(exc)) from exc


@router.get("/last")
def last() -> dict:
    """The files and the research project used last, to start from."""
    options = config.load_settings().FIELDLOG
    return {"epicollect": options.last_epicollect, "datasheet": options.last_datasheet, "research_project_id": options.last_research_project}


def _in_trapper(research_project_id: str | None, collections: list[str]) -> list[str] | None:
    """Which of the collections Trapper already has for the research project — None when that can't be asked (no
    account saved, a research project not taken from Trapper, Trapper not reachable)."""
    if not research_project_id:
        return None
    try:
        folder = local_folder_service.project_dir(config.collections_dir(), research_project_id)
        project = json.loads((folder / local_folder_service.RESEARCH_PROJECT_METADATA_FILE).read_text(encoding="utf-8"))
        pk = project.get("trapper_pk")
        if not pk:
            return None
        credentials = trapper_service.resolve_credentials(None, None, None)
        names = {c["name"].lower() for c in sync_service.project_collections(credentials, int(pk))}
    except Exception as exc:  # the field records go on without it
        logger.info("Could not ask Trapper for the collections of %s: %s", research_project_id, exc)
        return None
    return [c for c in collections if c.lower() in names]


@router.post("/analyze")
def analyze(req: FieldlogRequest) -> dict:
    """What the field trip adds and what it says of each deployment — nothing is written. "in_trapper" says which of its
    collections Trapper already has (None when it can't be asked)."""
    try:
        result = fieldlog_service.analyze(req.epicollect, req.datasheet, req.research_project_id)
    except fieldlog_service.FieldlogError as exc:
        raise HTTPException(400, str(exc)) from exc
    result["in_trapper"] = _in_trapper(req.research_project_id, result["collections"])
    return result


class NewLocation(BaseModel):
    location_id: str
    latitude: float
    longitude: float


class AddLocationsRequest(BaseModel):
    research_project_id: str
    locations: list[NewLocation]


@router.post("/add-locations")
def add_locations(req: AddLocationsRequest) -> dict:
    """Saves sites of the field records as locations of the research project, with the coordinates confirmed by the
    user — the upload creates them in Trapper."""
    try:
        return {"results": fieldlog_service.add_locations(req.research_project_id, [l.model_dump() for l in req.locations])}
    except fieldlog_service.FieldlogError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/apply")
def apply(req: FieldlogRequest) -> dict:
    """Writes the updated datasheet beside the original and each collection's FileTimestampLog and FieldworkLog, and
    remembers the files and the research project for next time."""
    settings = config.load_settings()
    try:
        result = fieldlog_service.apply(req.epicollect, req.datasheet, req.research_project_id or "", settings)
    except fieldlog_service.FieldlogError as exc:
        raise HTTPException(400, str(exc)) from exc
    settings.FIELDLOG.last_epicollect = req.epicollect
    settings.FIELDLOG.last_datasheet = next((f for f in result["files"] if f.lower().endswith((".xlsx", ".xlsm"))), req.datasheet)
    settings.FIELDLOG.last_research_project = req.research_project_id
    config.save_settings(settings)
    return result


@router.post("/take-project")
def take_project(req: TakeProjectRequest) -> dict:
    """Takes a research project of Trapper and its locations into the collections folder, with the account saved in the
    settings — no classification project needed. The locations already there are kept, the missing ones added."""
    from wildintel_uploader.web.api.routers.trapper import TrapperCredentials, call, resolve
    credentials = resolve(TrapperCredentials())
    try:
        return call(lambda: sync_service.take_locations(credentials, config.collections_dir(), req.model_dump()))
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(400, str(exc)) from exc


def _open_in_file_manager(path: Path) -> None:
    """Opens a folder in the system's file explorer (a seam the tests replace)."""
    file_manager.open_folder(path)


@router.post("/open-folder")
def open_folder(req: OpenRequest) -> dict:
    """Opens the folder holding a file the field records wrote (or that folder itself) in the file explorer."""
    target = Path(req.path).expanduser()
    folder = target if target.is_dir() else target.parent
    if not folder.is_dir():
        raise HTTPException(404, "That folder does not exist.")
    try:
        _open_in_file_manager(folder)
    except OSError as exc:
        raise HTTPException(500, f"Could not open the file explorer: {exc}") from exc
    return {"opened": str(folder)}
