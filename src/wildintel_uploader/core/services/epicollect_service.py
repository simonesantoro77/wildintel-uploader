"""Reading the form of an Epicollect5 project — what its inputs are — so that they can be mapped onto the fields of a deployment
(settings EPICOLLECT5.mapping). Only the project's definition is read here, never its entries."""
from __future__ import annotations

import logging
from typing import Any

import pyepicollect
from pyepicollect import auth

from wildintel_uploader.core import config

logger = logging.getLogger(__name__)

# Inputs that hold nothing to map: a text to read, and the containers (their own inputs are listed instead).
_NOT_DATA = {"readme", "group", "branch"}


class EpicollectError(Exception):
    """Something the user can act on: no project set, the project is private and the client is wrong, the server is unreachable."""


def _walk(inputs: list[dict], form: str, group: str | None = None, branch: str | None = None) -> list[dict]:
    """The inputs of a form, flattened: those inside a group or a branch say which."""
    found: list[dict] = []
    for item in inputs:
        kind = item.get("type") or ""
        label = (item.get("question") or item.get("label") or item.get("ref") or "").strip()
        if kind == "group":
            found += _walk(item.get("group") or [], form, group=label or group, branch=branch)
        elif kind == "branch":
            found += _walk(item.get("branch") or [], form, group=group, branch=label or branch)
        elif kind not in _NOT_DATA and item.get("ref"):
            options = [a.get("answer") for a in item.get("possible_answers") or [] if a.get("answer")]
            found.append({"ref": item["ref"], "label": label, "type": kind, "form": form, "group": group, "branch": branch, "options": options})
    return found


def parse_project(definition: dict) -> dict:
    """The project's name and slug and every input of every form, from the export of the project (GET /api/export/project/<slug>)."""
    project = ((definition.get("data") or {}).get("project")) or {}
    if not project:
        errors = definition.get("errors") or []
        detail = errors[0].get("title") if errors and isinstance(errors[0], dict) else None
        raise EpicollectError(detail or "Epicollect5 did not answer with a project definition.")
    inputs: list[dict] = []
    for form in project.get("forms") or []:
        inputs += _walk(form.get("inputs") or [], form.get("name") or form.get("ref") or "")
    return {"project": {"name": project.get("name") or "", "slug": project.get("slug") or ""}, "inputs": inputs}


def _token(settings: config.Settings) -> str | None:
    cfg = settings.EPICOLLECT5
    if not (cfg.client_id and cfg.client_secret):
        return None
    data = auth.request_token(cfg.client_id, cfg.client_secret)
    token = data.get("access_token")
    if not token:
        raise EpicollectError("Epicollect5 refused the client id and secret saved in the settings.")
    return token


def fetch_form(settings: config.Settings | None = None) -> dict:
    """The inputs of the project saved in the settings. A public project needs no client; a private one needs it."""
    settings = settings or config.load_settings()
    slug = settings.EPICOLLECT5.project_slug
    if not slug:
        raise EpicollectError("There is no Epicollect5 project saved yet — set its slug in Settings › Epicollect5.")
    try:
        definition: Any = pyepicollect.api.get_project(slug, _token(settings))
    except EpicollectError:
        raise
    except Exception as exc:  # the network, or an answer that is not JSON
        logger.warning("Reading the Epicollect5 project %s failed: %s", slug, exc)
        raise EpicollectError(f"Could not reach Epicollect5: {exc}") from exc
    return parse_project(definition)
