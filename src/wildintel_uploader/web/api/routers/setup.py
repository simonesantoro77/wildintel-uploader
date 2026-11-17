"""FastAPI router — the initial setup of the application, step by step (see the wizard in Utilities): the trappers, their roles in a research project, and its cameras and SD cards
are *added* to what is kept — never replaced — so a step can be done again, or later in the settings, without losing anything. The research project and its locations have their own
endpoints (deployment-import)."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from wildintel_uploader.core import config
from wildintel_uploader.core.services import local_folder_service

router = APIRouter(prefix="/api/setup", tags=["setup"])

ROLES = ("contact", "principalInvestigator", "rightsHolder", "publisher", "contributor")


class TrapperItem(BaseModel):
    username: str = Field(min_length=1)
    name: str = Field(min_length=1)
    affiliation: str | None = None
    email: str | None = None


class TrappersRequest(BaseModel):
    trappers: list[TrapperItem]


class RoleItem(BaseModel):
    trapper: str = Field(min_length=1)
    role: Literal["contact", "principalInvestigator", "rightsHolder", "publisher", "contributor"] = "contributor"


class RolesRequest(BaseModel):
    research_project_id: str
    roles: list[RoleItem]


class FieldItem(BaseModel):
    label: str = Field(min_length=1)
    camera_id: str | None = None
    camera_model: str | None = None
    brand: str | None = None
    capacity: str | None = None


class FieldItemsRequest(BaseModel):
    research_project_id: str
    kind: Literal["cameras", "sd_cards"]
    items: list[FieldItem]


def _clean(values: dict) -> dict:
    return {k: (v.strip() if isinstance(v, str) else v) for k, v in values.items() if v not in (None, "")}


@router.post("/trappers")
def add_trappers(req: TrappersRequest) -> dict:
    """Adds the trappers that are not kept yet — one with the username of another, whatever its case, is left out. {"added": [usernames], "skipped": [usernames]}."""
    root = config.collections_dir()
    kept = local_folder_service.list_trappers(root)
    have = {str(t.get("username", "")).lower() for t in kept}
    added, skipped, new = [], [], []
    for item in req.trappers:
        data = _clean(item.model_dump())
        key = data["username"].lower()
        if key in have:
            skipped.append(data["username"])
            continue
        have.add(key)
        new.append({**data, "status": "active"})
        added.append(data["username"])
    if new:
        local_folder_service.write_trappers(root, [*kept, *new])
    return {"added": added, "skipped": skipped}


@router.post("/roles")
def add_roles(req: RolesRequest) -> dict:
    """Gives trappers a role in a research project: the ones it has already are left as they are, and a trapper that is not kept is refused. {"added": [[trapper, role]]}."""
    root = config.collections_dir()
    try:
        local_folder_service.require_research_project(root, req.research_project_id)
        people = {str(t.get("name", "")).strip().lower(): t["name"] for t in local_folder_service.list_trappers(root)}
        kept = local_folder_service.list_roles(root, req.research_project_id)
        have = {(str(r.get("trapper", "")).lower(), r.get("role")) for r in kept}
        new, added = [], []
        for item in req.roles:
            name = people.get(item.trapper.strip().lower())
            if name is None:
                raise HTTPException(404, f"There is no trapper called {item.trapper!r}: add it before giving it a role.")
            if (name.lower(), item.role) not in have:
                have.add((name.lower(), item.role))
                new.append({"trapper": name, "role": item.role})
                added.append([name, item.role])
        if new:
            local_folder_service.write_roles(root, req.research_project_id, [*kept, *new])
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"added": added}


@router.post("/field-items")
def add_field_items(req: FieldItemsRequest) -> dict:
    """Adds cameras or SD cards to a research project: one with the label of another is left out. {"added": [labels], "skipped": [labels]}."""
    root = config.collections_dir()
    try:
        kept = local_folder_service.list_field_items(root, req.research_project_id, req.kind)
        have = {str(i.get("label", "")).strip().lower() for i in kept}
        added, skipped, new = [], [], []
        for item in req.items:
            data = _clean(item.model_dump())
            if req.kind == "cameras":
                data.pop("brand", None); data.pop("capacity", None)
            else:
                data.pop("camera_id", None); data.pop("camera_model", None)
            key = data["label"].lower()
            if key in have:
                skipped.append(data["label"])
                continue
            have.add(key)
            new.append({**data, "research_project": req.research_project_id, "status": "active"})
            added.append(data["label"])
        if new:
            local_folder_service.write_field_items(root, req.research_project_id, req.kind, [*kept, *new])
    except local_folder_service.LocalFolderError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"added": added, "skipped": skipped}
