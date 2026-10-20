"""FastAPI router — field records: the Epicollect download of a field trip and the fieldwork datasheet, turned into
the updated datasheet and each collection's FileTimestampLog and FieldworkLog (see services.fieldlog_service)."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from wildintel_uploader.core import config
from wildintel_uploader.core.services import fieldlog_service, file_manager, folder_picker

router = APIRouter(prefix="/api/fieldlog", tags=["fieldlog"])
logger = logging.getLogger(__name__)


class PickFileRequest(BaseModel):
    kind: Literal["epicollect", "datasheet"]


class FieldlogRequest(BaseModel):
    epicollect: str
    datasheet: str
    research_project_id: Optional[str] = None


class OpenRequest(BaseModel):
    path: str


_PICK = {
    "epicollect": ("Select the Epicollect download (CSV)", ["*.csv"]),
    "datasheet": ("Select the fieldwork datasheet (.xlsx)", ["*.xlsx", "*.xlsm"]),
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


@router.post("/analyze")
def analyze(req: FieldlogRequest) -> dict:
    """What the field trip adds and what it says of each deployment — nothing is written."""
    try:
        return fieldlog_service.analyze(req.epicollect, req.datasheet, req.research_project_id)
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
