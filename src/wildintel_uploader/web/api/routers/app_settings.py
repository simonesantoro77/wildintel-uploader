"""FastAPI router — the app's own settings.toml (see config.py), edited on
the settings page. The password never goes back to the frontend: TRAPPER
says whether one is saved instead, and saving a blank one keeps it."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from wildintel_uploader.core import config
from wildintel_uploader.core import logging_setup, storage
from wildintel_uploader.core.services import audit, file_manager, local_folder_service, status_history

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _public(settings: config.Settings) -> dict:
    data = settings.model_dump(mode="json")
    data["TRAPPER"]["has_password"] = bool(data["TRAPPER"].pop("user_password"))
    data["EPICOLLECT5"]["has_secret"] = bool(data["EPICOLLECT5"].pop("client_secret"))
    data["AGOUTI"]["has_api_key"] = bool(data["AGOUTI"].pop("api_key"))
    data["FIELDWORK"]["roles"] = audit.alive(data["FIELDWORK"]["roles"])
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


def _root(settings: config.Settings):
    return config.collections_dir(settings)


def _shown(settings: config.Settings) -> dict:
    """The settings as the page has them: the cameras and the SD cards are those of the research projects, in their folders of the collections folder."""
    root = _root(settings)
    data = _public(settings)
    for kind in ("cameras", "sd_cards"):
        # what is still in the settings file belongs to a research project that is not in the collections folder (yet)
        data["FIELDWORK"][kind] = [i.model_dump(mode="json") if hasattr(i, "model_dump") else i for i in local_folder_service.list_all_field_items(root, kind)] + data["FIELDWORK"][kind]
    # the trappers are the people, whatever the project: kept beside the projects, not in the settings (an earlier version kept them here: they are moved when they are asked for)
    data["FIELDWORK"]["trappers"] = local_folder_service.list_trappers(root)
    # the roles belong to the research projects too: what is still in the settings file is of a project that is not here (yet)
    data["FIELDWORK"]["roles"] = local_folder_service.list_all_roles(root) + data["FIELDWORK"]["roles"]
    return data


def _move_to_the_projects(settings: config.Settings) -> config.Settings:
    """Cameras and SD cards kept in settings.toml (as they were before) go to the folder of their research project, as a file of its own: the ones that are a
    research project's, to it. What can't be moved stays: the ones whose project isn't in the collections folder yet, and the ones that belong to none — a camera
    or an SD card belongs to one research project, so those wait to be assigned to one in the settings. Does nothing once there is nothing left to move."""
    fieldwork = settings.FIELDWORK
    if not fieldwork.cameras and not fieldwork.sd_cards and not fieldwork.roles:
        return settings
    root = _root(settings)
    projects = [p["acronym"] for p in local_folder_service.list_research_projects(root)]
    leftovers: dict[str, list] = {"cameras": [], "sd_cards": []}
    for kind in ("cameras", "sd_cards"):
        label = {"cameras": "label", "sd_cards": "label"}[kind]
        for project in projects:
            mine = [i for i in getattr(fieldwork, kind) if (i.research_project or "").lower() == project.lower()]
            if not mine:
                continue
            kept = local_folder_service.list_field_items(root, project, kind)
            have = {str(i.get(label, "")) for i in kept}   # as written: 7b and 7B are two
            added = [i.model_dump(mode="json") for i in mine if i.label not in have]
            local_folder_service.write_field_items(root, project, kind, [*kept, *added])
        leftovers[kind] = [i for i in getattr(fieldwork, kind) if (i.research_project or "").lower() not in {p.lower() for p in projects}]
    # the roles too: a role of a project that is kept here goes to it
    roles_left = []
    for project in projects:
        mine = [r for r in fieldwork.roles if r.research_project.lower() == project.lower()]
        if not mine:
            continue
        kept = local_folder_service.list_roles(root, project, include_deleted=True)
        have = {(str(r.get("trapper") or "").lower(), r.get("role") or "contributor") for r in kept}
        added = [r.model_dump(mode="json") for r in mine if (r.trapper.lower(), r.role) not in have]
        local_folder_service.write_roles(root, project, [*audit.alive(kept), *added])
    roles_left = [r for r in fieldwork.roles if r.research_project.lower() not in {p.lower() for p in projects}]
    if (leftovers["cameras"], leftovers["sd_cards"], roles_left) != (fieldwork.cameras, fieldwork.sd_cards, fieldwork.roles):
        fieldwork.cameras, fieldwork.sd_cards, fieldwork.roles = leftovers["cameras"], leftovers["sd_cards"], roles_left
        config.save_settings(settings)
    return settings


def _follow_data_dir(old: config.Settings, new: config.Settings) -> None:
    """When the data folder changes, the collections, reports and packages folders that were inside the old one go inside the new one: a folder kept elsewhere stays where it is, and one that was
    just <old data folder>/<its name> goes back to being the default one."""
    old_dir, new_dir = config.data_dir(old), config.data_dir(new)
    if old_dir == new_dir:
        return
    for key in ("collections", "reports", "packages"):
        value = getattr(new.DATA, f"{key}_dir")
        if not value:
            continue
        try:
            inside = Path(value).expanduser().relative_to(old_dir)
        except ValueError:
            continue
        setattr(new.DATA, f"{key}_dir", None if str(inside) == key else str(new_dir / inside))


@router.get("")
def get_settings() -> dict:
    return _shown(_move_to_the_projects(config.load_settings()))


@router.put("")
def save_settings(new: config.Settings) -> dict:
    """Replaces every setting — except a password left blank, which keeps
    the saved one. Blank URL/username are cleared."""
    current = config.load_settings()
    if "storage" not in new.DATA.model_fields_set:   # the page does not show where the records are kept: it is not its to change
        new.DATA.storage = current.DATA.storage
    if (new.DATA.storage or "json").strip().lower() not in storage.available():
        raise HTTPException(422, f"There is no storage called '{new.DATA.storage}': {', '.join(storage.available())}.")
    _follow_data_dir(current, new)
    if not new.TRAPPER.user_password:
        new.TRAPPER.user_password = current.TRAPPER.user_password
    if not new.EPICOLLECT5.client_secret:
        new.EPICOLLECT5.client_secret = current.EPICOLLECT5.client_secret
    if not new.AGOUTI.api_key:
        new.AGOUTI.api_key = current.AGOUTI.api_key
    for section, fields in ((new.TRAPPER, ("base_url", "user_name")), (new.EPICOLLECT5, ("project_slug", "client_id")), (new.AGOUTI, ("base_url", "project_id"))):
        for field in fields:
            if not getattr(section, field):
                setattr(section, field, None)
    root = _root(new)
    local_folder_service.write_trappers(root, [t.model_dump(mode="json") for t in new.FIELDWORK.trappers])   # the people are kept beside the projects, not in the settings
    new.FIELDWORK.trappers = []
    model = {"cameras": config.Camera, "sd_cards": config.SdCard}
    for kind in ("cameras", "sd_cards"):
        items = getattr(new.FIELDWORK, kind)
        # An archived camera or SD card is archived for good: what is kept of it is not changed.
        for project in {i.research_project for i in items if i.research_project}:
            try:
                kept = local_folder_service.list_field_items(root, project, kind)
            except local_folder_service.LocalFolderError:
                continue
            archived = {str(k.get("label") or "").strip(): model[kind].model_validate(k).model_dump(mode="json") for k in kept if k.get("status") == "archived"}
            for item in items:
                before = archived.get(item.label.strip()) if item.research_project == project else None
                if before is not None and item.model_dump(mode="json") != before:
                    raise HTTPException(422, f"{'The camera' if kind == 'cameras' else 'The SD card'} {item.label} is archived for good: it can no longer be changed.")
        free = [i for i in items if not i.research_project]
        if free:
            raise HTTPException(422, f"{'A camera' if kind == 'cameras' else 'An SD card'} belongs to a research project: choose one for {free[0].label}.")
        by_project: dict[str, list] = {}
        for item in items:
            by_project.setdefault(item.research_project, []).append(item.model_dump(mode="json"))
        known = {p["acronym"] for p in local_folder_service.list_research_projects(root)}
        # the list of each research project is replaced by what the page has — the ones it no longer lists are gone; a project that is not kept here keeps them in the settings
        for project in known:
            try:
                local_folder_service.write_field_items(root, project, kind, by_project.get(project, []), by_hand=True)
            except local_folder_service.LocalFolderError as exc:
                raise HTTPException(422, str(exc)) from exc
        setattr(new.FIELDWORK, kind, [i for i in items if i.research_project not in known])
    # the roles belong to the research projects: each project's are replaced by what the page has — the ones it no longer lists are deleted, logically
    known = {p["acronym"] for p in local_folder_service.list_research_projects(root)}
    by_project: dict[str, list] = {}
    for role in new.FIELDWORK.roles:
        by_project.setdefault(role.research_project, []).append(role.model_dump(mode="json"))
    for project in known:
        local_folder_service.write_roles(root, project, by_project.get(project, []))
    new.FIELDWORK.roles = [r for r in new.FIELDWORK.roles if r.research_project not in known]
    config.save_settings(new)
    storage.configure(new.DATA.storage)   # where the records are kept, from now on
    logging_setup.apply_level(logging_setup.effective_level())
    return _shown(new)


class DefaultResearchProjectRequest(BaseModel):
    acronym: str


@router.put("/default-research-project")
def set_default_research_project(req: DefaultResearchProjectRequest) -> dict:
    """Changes only the research project that comes filled in everywhere — what the selector of the header does. It must be one of the collections folder."""
    settings = config.load_settings()
    wanted = req.acronym.strip().lower()
    found = next((p["acronym"] for p in local_folder_service.list_research_projects(_root(settings)) if p["acronym"].lower() == wanted), None)
    if found is None:
        raise HTTPException(404, f"There is no research project called {req.acronym!r} in the collections folder.")
    settings.GENERAL.default_research_project = found
    config.save_settings(settings)
    return {"default_research_project": found}


class ShowWelcomeRequest(BaseModel):
    show: bool


@router.put("/show-welcome")
def set_show_welcome(req: ShowWelcomeRequest) -> dict:
    """Changes only whether the welcome page is shown when the app opens — what its tick does."""
    settings = config.load_settings()
    settings.GENERAL.show_welcome = req.show
    config.save_settings(settings)
    return {"show_welcome": req.show}


class DataDirRequest(BaseModel):
    dir: str | None = None


@router.put("/data-dir")
def set_data_dir(req: DataDirRequest) -> dict:
    """Changes only the data folder — what the initial setup asks for. Blank is the default one. What is kept in the old one is not moved, and the folders that were inside it go inside the new one."""
    settings = config.load_settings()
    before = settings.model_copy(deep=True)
    wanted = (req.dir or "").strip()
    if wanted and not (Path(wanted).expanduser().is_absolute()):
        raise HTTPException(422, "The data folder must be an absolute path (or one starting with ~).")
    settings.DATA.dir = wanted or None
    _follow_data_dir(before, settings)
    config.save_settings(settings)
    return {"dir": str(config.data_dir(settings))}


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


class FieldItemStatusRequest(BaseModel):
    research_project_id: str
    kind: Literal["cameras", "sd_cards"]
    # What the visits call it: a camera's serial number, or its label when it has none; an SD card's label.
    key: str
    # what a visit says of it: stolen, lost or broken are the reason it is archived
    status: Literal["archived", "stolen", "lost", "broken"]
    status_date: str | None = None
    status_note: str | None = None


@router.post("/field-item-status")
def set_field_item_status(req: FieldItemStatusRequest) -> dict:
    """Marks a camera or an SD card of a research project as no longer available (stolen, lost…) — what a visit that finds a camera stolen says of it and of its card.
    Nothing happens, and `updated` is false, when the research project does not keep one called that — or when it is archived, which is for good and is never changed."""
    root = _root(config.load_settings())
    try:
        items = local_folder_service.list_field_items(root, req.research_project_id, req.kind)
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(400, str(exc)) from exc
    wanted = req.key.strip()   # as written: 7b and 7B are two
    updated = False
    for item in items:
        names = {str(item.get("label") or "").strip()} | ({str(item.get("camera_id") or "").strip()} if req.kind == "cameras" else set())
        if wanted and wanted in names and item.get("status") != "archived":
            item["status"], item["status_date"], item["status_note"] = "archived", req.status_date, req.status_note
            item["archive_reason"] = req.status if req.status != "archived" else "other"
            updated = True
    if updated:
        try:
            local_folder_service.write_field_items(root, req.research_project_id, req.kind, items)
        except local_folder_service.LocalFolderError as exc:
            raise HTTPException(400, str(exc)) from exc
    return {"updated": updated}


class StatusHistoryRequest(BaseModel):
    research_project_id: str
    kind: Literal["locations", "cameras", "sd_cards"] | None = None
    name: str | None = None


@router.post("/status-history")
def status_history_of(req: StatusHistoryRequest) -> dict:
    """The history of the status of the locations, the cameras and the SD cards of a research project — of one kind, and of one of them, when they are given — the oldest first."""
    try:
        local_folder_service.require_research_project(_root(config.load_settings()), req.research_project_id)
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"results": status_history.list_history(_root(config.load_settings()), req.research_project_id, req.kind, req.name)}


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
