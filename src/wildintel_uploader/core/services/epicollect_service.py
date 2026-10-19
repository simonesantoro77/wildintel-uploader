"""Reading the form of an Epicollect5 project — what its inputs are — so that they can be mapped onto the fields of a deployment
(settings EPICOLLECT5.mapping). Only the project's definition is read here, never its entries."""
from __future__ import annotations

import logging
import re
import time as monotonic
from collections.abc import Callable
from datetime import date, datetime, time
from typing import Any, get_args

import pyepicollect
from pyepicollect import auth

from wildintel_uploader.core import config
from wildintel_uploader.core.schemas.requests import FeatureType

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


# The client's token, kept while it is valid: every read would ask for a new one, and Epicollect5 limits how many it gives.
_TOKEN_MARGIN = 60  # seconds before it expires that it is no longer used
_TOKEN_LIFETIME = 3600  # when Epicollect5 doesn't say how long it lasts
_tokens: dict[tuple[str, str], tuple[str, float]] = {}


def forget_tokens() -> None:
    _tokens.clear()


def _token(client_id: str | None, client_secret: str | None) -> tuple[str | None, bool]:
    """(token, whether it was already kept). No client, no token: a public project needs none."""
    if not (client_id and client_secret):
        return None, False
    key = (client_id, client_secret)
    kept = _tokens.get(key)
    if kept and kept[1] > monotonic.monotonic():
        return kept[0], True
    data = auth.request_token(client_id, client_secret)
    token = data.get("access_token")
    if not token:
        errors = data.get("errors") or []
        detail = errors[0].get("title") if errors and isinstance(errors[0], dict) else None
        if detail and "too many" in detail.lower():  # not a wrong client: Epicollect5 asks to wait
            raise EpicollectError(f"Epicollect5 says: {detail} Your client id and secret may be fine.")
        raise EpicollectError("Epicollect5 refused the client id and secret.")
    lifetime = data.get("expires_in")
    lifetime = lifetime if isinstance(lifetime, (int, float)) and lifetime > 0 else _TOKEN_LIFETIME
    _tokens[key] = (token, monotonic.monotonic() + max(lifetime - _TOKEN_MARGIN, 0))
    return token, False


def _ask(client_id: str | None, client_secret: str | None, request: Callable[[str | None], Any]) -> Any:
    """request(token)'s answer. A kept token that Epicollect5 no longer takes — it answers with errors — is replaced once."""
    token, kept = _token(client_id, client_secret)
    answer = request(token)
    if kept and isinstance(answer, dict) and answer.get("errors"):
        _tokens.pop((client_id or "", client_secret or ""), None)
        token, _ = _token(client_id, client_secret)
        answer = request(token)
    return answer


def _read_project(slug: str, client_id: str | None, client_secret: str | None) -> dict:
    """The project's definition, parsed. A public project needs no client; a private one needs it."""
    try:
        definition = _ask(client_id, client_secret, lambda token: pyepicollect.api.get_project(slug, token))
    except EpicollectError:
        raise
    except Exception as exc:  # the network, or an answer that is not JSON
        logger.warning("Reading the Epicollect5 project %s failed: %s", slug, exc)
        raise EpicollectError(f"Could not reach Epicollect5: {exc}") from exc
    return parse_project(definition)


def fetch_form(settings: config.Settings | None = None) -> dict:
    """The inputs of the project saved in the settings."""
    cfg = (settings or config.load_settings()).EPICOLLECT5
    if not cfg.project_slug:
        raise EpicollectError("There is no Epicollect5 project saved yet — set its slug in Settings › Epicollect5.")
    return _read_project(cfg.project_slug, cfg.client_id, cfg.client_secret)


def test_connection(slug: str | None, client_id: str | None, client_secret: str | None, settings: config.Settings | None = None) -> dict:
    """Whether the project can be read with these values, saving nothing. A blank secret next to the saved client id is the saved
    secret, as the settings page leaves it blank to keep it. {"ok", "project", "slug", "forms", "inputs"}."""
    saved = (settings or config.load_settings()).EPICOLLECT5
    slug, client_id, client_secret = (slug or "").strip(), (client_id or "").strip() or None, client_secret or None
    if not slug:
        raise EpicollectError("Type the project's slug first.")
    if client_secret is None and client_id and client_id == saved.client_id:
        client_secret = saved.client_secret
    if client_id and not client_secret:
        raise EpicollectError("A client id needs its secret too.")
    parsed = _read_project(slug, client_id, client_secret)
    return {"ok": True, "project": parsed["project"]["name"], "slug": parsed["project"]["slug"],
            "forms": len({i["form"] for i in parsed["inputs"]}), "inputs": len(parsed["inputs"])}


# ── The entries: one row of the form is one deployment ───────────────────────────────────────────────────────────────

_PAGE_SIZE = 1000
_YES = {"yes", "true", "1", "y", "si", "sí"}
_FEATURE_TYPES = set(get_args(FeatureType))
# Fields that hold text as it is, a number, a yes/no, or a list.
_TEXT = ("location_name", "camera_model", "camera_id", "habitat", "setup_by", "deployment_groups", "comments")
_NUMBER = ("camera_interval", "detection_distance", "camera_height", "camera_depth", "camera_tilt", "camera_heading")
_BOOL = ("bait_use", "timestamp_issues")


def _all_entries(slug: str, client_id: str | None, client_secret: str | None) -> list[dict]:
    """Every entry of the project, a page at a time."""
    entries: list[dict] = []
    page = 1
    while True:
        answer = _ask(client_id, client_secret, lambda token: pyepicollect.api.get_entries(slug, token, per_page=_PAGE_SIZE, page=page))
        if not isinstance(answer, dict) or "errors" in answer:
            errors = (answer or {}).get("errors") if isinstance(answer, dict) else None
            detail = errors[0].get("title") if errors and isinstance(errors[0], dict) else None
            raise EpicollectError(detail or "Epicollect5 did not answer with the entries.")
        entries += (answer.get("data") or {}).get("entries") or []
        last = int(((answer.get("meta") or {}).get("last_page")) or 1)
        if page >= last:
            return entries
        page += 1


def _text(value: Any) -> str | None:
    if value is None or isinstance(value, (dict, list)):
        return None
    return str(value).strip() or None


def _number(value: Any) -> float | int | None:
    text = _text(value)
    if text is None:
        return None
    try:
        number = float(text.replace(",", "."))
    except ValueError:
        return None
    return int(number) if number.is_integer() else number


def _day(value: Any) -> date | None:
    """A date as Epicollect5 gives it: ISO (with or without a time), or as the form's own format — day first, as in Europe."""
    text = _text(value)
    if text is None:
        return None
    text = text.replace("Z", "")
    for pattern in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, pattern).date()
        except ValueError:
            continue
    return None


def _clock(value: Any) -> time | None:
    text = _text(value)
    if text is None:
        return None
    match = re.search(r"(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?", text)
    if not match:
        return None
    hour, minute, second, meridiem = int(match.group(1)), int(match.group(2)), int(match.group(3) or 0), (match.group(4) or "").lower()
    if meridiem == "pm" and hour < 12:
        hour += 12
    elif meridiem == "am" and hour == 12:
        hour = 0
    try:
        return time(hour, minute, second)
    except ValueError:
        return None


def _yes_no(value: Any) -> bool | None:
    """A radio or a dropdown says yes or no; a checkbox is a list, ticked or not. Nothing answered is not recorded."""
    if isinstance(value, list):
        return any(str(v).strip().lower() in _YES for v in value)
    text = _text(value)
    return None if text is None else text.lower() in _YES


def _place(value: Any) -> dict | None:
    return value if isinstance(value, dict) and value.get("latitude") not in (None, "") else None


def entry_fields(entry: dict, mapping: dict[str, str]) -> dict:
    """What an entry says of a deployment, by field, through the mapping. The day and the time are kept apart (start_date /
    start_time, end_date / end_time): the wizard has the images' own times to complete a day with. What the entry leaves
    blank, or says in a way that can't be read, is not in the result."""
    raw = {key: entry.get(ref) for key, ref in mapping.items() if ref}
    found: dict[str, Any] = {}

    for key in _TEXT:
        if (value := _text(raw.get(key))) is not None:
            found[key] = value
    if (value := _text(raw.get("location_id"))) is not None:
        found["location_id"] = value
    for key in _NUMBER:
        if (value := _number(raw.get(key))) is not None:
            found[key] = value
    for key in _BOOL:
        if (flag := _yes_no(raw.get(key))) is not None:
            found[key] = flag
    if (value := _text(raw.get("feature_type"))) in _FEATURE_TYPES:
        found["feature_type"] = value

    tags = raw.get("tags")
    items = tags if isinstance(tags, list) else (str(tags).split(",") if _text(tags) else [])
    if tags_found := [str(t).strip() for t in items if str(t).strip()]:
        found["tags"] = tags_found

    # A GPS input gives all three; a decimal input gives its own.
    for key, part in (("latitude", "latitude"), ("longitude", "longitude"), ("coordinate_uncertainty", "accuracy")):
        place = _place(entry.get(mapping.get(key) or ""))
        value = _number(place.get(part)) if place else _number(raw.get(key))
        if value is not None:
            found[key] = value

    if (value := _number(raw.get("revision"))) is not None:
        found["revision"] = int(value)
    for key in ("start_date", "end_date"):
        if (day := _day(raw.get(key))) is not None:
            found[key] = day.isoformat()
    for key in ("start_time", "end_time"):
        if (clock := _clock(raw.get(key))) is not None:
            found[key] = clock.strftime("%H:%M:%S")
    return found


# Inputs whose answer is a file, not something to read.
_MEDIA = {"photo", "audio", "video"}


def _answer_text(value: Any) -> str | None:
    """An answer as a line of text: a place as "lat, lon", a list joined, anything else as it is. Nothing answered is None."""
    if isinstance(value, dict):
        lat, lon = value.get("latitude"), value.get("longitude")
        return f"{lat}, {lon}" if lat not in (None, "") and lon not in (None, "") else None
    if isinstance(value, list):
        return ", ".join(str(v).strip() for v in value if str(v).strip()) or None
    return _text(value)


def unmapped_notes(entry: dict, inputs: list[dict], mapping: dict[str, str]) -> str | None:
    """What the entry answers in the inputs of the form that no field of a deployment is mapped to, a line each as
    "question: answer". None when there is nothing."""
    mapped = set(mapping.values())
    lines = []
    for item in inputs:
        if item["ref"] in mapped or item["type"] in _MEDIA:
            continue
        if (answer := _answer_text(entry.get(item["ref"]))) is not None:
            lines.append(f"{item['label'] or item['ref']}: {answer}")
    return "\n".join(lines) or None


def find_entries(location_id: str, revision: int | None, settings: config.Settings | None = None) -> list[dict]:
    """The entries that are this location's — and this revision's, when the form asks it —, newest first. Each is
    {"uuid", "title", "created_at", "fields"}. The location is compared without regard to case, as Trapper keeps it in
    lower case."""
    cfg = (settings or config.load_settings()).EPICOLLECT5
    if not cfg.enabled:
        raise EpicollectError("Epicollect5 is turned off — turn it on in Settings › Epicollect5.")
    if not cfg.project_slug:
        raise EpicollectError("There is no Epicollect5 project saved yet — set its slug in Settings › Epicollect5.")
    mapping = {k: v for k, v in cfg.mapping.items() if v}
    if "location_id" not in mapping:
        raise EpicollectError("The location id is not mapped yet — relate it to an input of the form in Settings › Epicollect5 › Mapping.")
    wanted = location_id.strip().lower()
    if not wanted:
        raise EpicollectError("Choose the location first.")
    try:
        entries = _all_entries(cfg.project_slug, cfg.client_id, cfg.client_secret)
    except EpicollectError:
        raise
    except Exception as exc:  # the network, or an answer that is not JSON
        logger.warning("Reading the entries of the Epicollect5 project %s failed: %s", cfg.project_slug, exc)
        raise EpicollectError(f"Could not reach Epicollect5: {exc}") from exc

    inputs = _read_project(cfg.project_slug, cfg.client_id, cfg.client_secret)["inputs"] if cfg.unmapped_to_comments else []
    found: list[dict] = []
    for entry in entries:
        fields = entry_fields(entry, mapping)
        if (fields.get("location_id") or "").lower() != wanted:
            continue
        if revision is not None and "revision" in mapping and fields.get("revision") != revision:
            continue
        if cfg.unmapped_to_comments and (notes := unmapped_notes(entry, inputs, mapping)):
            fields["comments"] = "\n".join(filter(None, [fields.get("comments"), notes]))
        found.append({"uuid": entry.get("ec5_uuid"), "title": entry.get("title") or "", "created_at": entry.get("created_at") or "", "fields": fields})
    return sorted(found, key=lambda e: e["created_at"], reverse=True)
