"""FastAPI router — the app's own settings.toml (see config.py), edited on
the settings page. The password never goes back to the frontend: TRAPPER
says whether one is saved instead, and saving a blank one keeps it."""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from wildintel_uploader.core import config
from wildintel_uploader.core import logging_setup
from wildintel_uploader.core.services import file_manager

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _public(settings: config.Settings) -> dict:
    data = settings.model_dump(mode="json")
    data["TRAPPER"]["has_password"] = bool(data["TRAPPER"].pop("user_password"))
    data["EPICOLLECT5"]["has_secret"] = bool(data["EPICOLLECT5"].pop("client_secret"))
    data["DATA"]["dir"] = data["DATA"]["dir"] or str(config.default_data_dir())
    # What the collections folder is when no folder of its own is set — shown as the default.
    for key in ("collections", "reports", "packages"):
        data["DATA"][f"default_{key}_dir"] = str(config.data_dir(settings) / key)
    # Read-only: where the log goes, and whether the environment overrides
    # the level set here.
    data["GENERAL"]["log_file"] = str(logging_setup.log_file())
    data["GENERAL"]["log_level_override"] = logging_setup.env_override()
    data["GENERAL"]["cpu_count"] = os.cpu_count() or 1
    return data


@router.get("")
def get_settings() -> dict:
    return _public(config.load_settings())


@router.put("")
def save_settings(new: config.Settings) -> dict:
    """Replaces every setting — except a password left blank, which keeps
    the saved one. Blank URL/username are cleared."""
    current = config.load_settings()
    if not new.TRAPPER.user_password:
        new.TRAPPER.user_password = current.TRAPPER.user_password
    if not new.EPICOLLECT5.client_secret:
        new.EPICOLLECT5.client_secret = current.EPICOLLECT5.client_secret
    for section, fields in ((new.TRAPPER, ("base_url", "user_name")), (new.EPICOLLECT5, ("project_slug", "client_id"))):
        for field in fields:
            if not getattr(section, field):
                setattr(section, field, None)
    config.save_settings(new)
    logging_setup.apply_level(logging_setup.effective_level())
    return _public(new)


@router.get("/log")
def download_log() -> FileResponse:
    """The current log file — to attach to a bug report."""
    path = logging_setup.log_file()
    if not path.is_file():
        raise HTTPException(404, "There's no log file yet.")
    return FileResponse(path, media_type="text/plain", filename=path.name)


@router.delete("/log")
def delete_log() -> dict:
    """Deletes the log file and its rotated copies — logging goes on, into a
    new one."""
    return {"deleted": logging_setup.clear_log()}


class NewConfigRequest(BaseModel):
    name: str


@router.get("/configs")
def get_configs() -> list[dict]:
    """Every settings file the user can switch to, the one in use flagged."""
    return [c.model_dump() for c in config.list_configs()]


@router.post("/configs")
def add_config(req: NewConfigRequest) -> list[dict]:
    """Writes a new settings file with the default values (it doesn't become
    the active one) and returns the updated list."""
    try:
        config.create_config(req.name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return get_configs()


@router.post("/configs/{config_id}/activate")
def activate_config(config_id: str) -> list[dict]:
    """Makes `config_id` the settings file the whole app reads and saves."""
    try:
        config.set_active_config(config_id)
    except KeyError:
        raise HTTPException(404, f"There's no config {config_id!r}.") from None
    return get_configs()


def _existing_config_file(config_id: str) -> Path:
    try:
        path = config.config_file_for(config_id)
    except KeyError:
        raise HTTPException(404, f"There's no config {config_id!r}.") from None
    if not path.is_file():
        raise HTTPException(404, "There's no settings file yet.")
    return path


@router.get("/configs/{config_id}/download")
def download_config(config_id: str) -> FileResponse:
    """The settings file itself, as saved — passwords included, since it's a
    backup of the file; it's the user's own file, on their own machine."""
    path = _existing_config_file(config_id)
    return FileResponse(path, media_type="application/toml", filename=path.name)


@router.post("/configs/{config_id}/open-folder")
def open_config_folder(config_id: str) -> dict:
    """Opens the directory holding that settings file in the OS's file manager."""
    path = _existing_config_file(config_id)
    try:
        file_manager.open_folder(path.parent)
    except OSError as exc:
        raise HTTPException(500, f"Could not open the folder: {exc}") from exc
    return {"ok": True}
