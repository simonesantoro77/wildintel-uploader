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
    wanted = location_id.strip().lower()
    if not wanted:
        raise EpicollectError("Choose the location first.")
    return find_entries_of([wanted], revision, settings)[wanted]


def find_entries_of(location_ids: list[str], revision: int | None, settings: config.Settings | None = None) -> dict[str, list[dict]]:
    """find_entries for several locations at once, reading the project once: the entries of each, by its id in lower case."""
    cfg = (settings or config.load_settings()).EPICOLLECT5
    if not cfg.enabled:
        raise EpicollectError("Epicollect5 is turned off — turn it on in Settings › Epicollect5.")
    if not cfg.project_slug:
        raise EpicollectError("There is no Epicollect5 project saved yet — set its slug in Settings › Epicollect5.")
    mapping = {k: v for k, v in cfg.mapping.items() if v}
    if "location_id" not in mapping:
        raise EpicollectError("The location id is not mapped yet — relate it to an input of the form in Settings › Epicollect5 › Mapping.")
    found: dict[str, list[dict]] = {w: [] for w in (loc.strip().lower() for loc in location_ids) if w}
    try:
        entries = _all_entries(cfg.project_slug, cfg.client_id, cfg.client_secret)
    except EpicollectError:
        raise
    except Exception as exc:  # the network, or an answer that is not JSON
        logger.warning("Reading the entries of the Epicollect5 project %s failed: %s", cfg.project_slug, exc)
        raise EpicollectError(f"Could not reach Epicollect5: {exc}") from exc

    inputs = _read_project(cfg.project_slug, cfg.client_id, cfg.client_secret)["inputs"] if cfg.unmapped_to_comments else []
    for entry in entries:
        fields = entry_fields(entry, mapping)
        location = (fields.get("location_id") or "").lower()
        if location not in found:
            continue
        if revision is not None and "revision" in mapping and fields.get("revision") != revision:
            continue
        if cfg.unmapped_to_comments and (notes := unmapped_notes(entry, inputs, mapping)):
            fields["comments"] = "\n".join(filter(None, [fields.get("comments"), notes]))
        found[location].append({"uuid": entry.get("ec5_uuid"), "title": entry.get("title") or "", "created_at": entry.get("created_at") or "", "fields": fields})
    return {location: sorted(items, key=lambda e: e["created_at"], reverse=True) for location, items in found.items()}


# ── The entries of the form of the field flow of a visit: one entry is one visit ────────────────────────────────────

# What each question of the form of a visit is (found by its label, ignoring case and spaces), and the field of a visit it gives.
VISIT_QUESTIONS: dict[str, str] = {
    "setupby": "trappers", "collection": "session", "revision": "session", "date": "date", "locationid": "location_id", "statusofthecamera": "camera_status",
    "cardandbatteries": "card_batteries_ok", "batterystatus": "battery_status", "batteriesstatus": "battery_status", "cardstatus": "card_status", "nºpicturescollected": "num_photos", "dateandtimeok": "date_time_ok", "action": "action",
    "actionaftertheft": "action_after_theft", "cameraname": "camera_label", "cameramodel": "camera_model", "serialnumber": "camera_id",
    "cameraheight": "camera_height", "cameradelay": "camera_interval", "cameratilt": "camera_tilt", "cameraheading": "camera_heading",
    "detectiondistance": "detection_distance", "baituse": "bait_use", "featuretype": "feature_type", "habitat": "habitat", "sdtoinsert": "sd",
    "actionafterthereview": "action", "actionafterinspection": "action", "calibration": "calibration", "observations": "comments", "coordinates": "coordinates", "time": "time",
}
# what the form answers of the card and the batteries — one question — and what each of them is
_CARD_CODES = {"ok": ("OK", "OK"), "card full": ("OK", "CardFull"), "no batteries": ("NoBatteries", "OK"), "card full and no batteries": ("NoBatteries", "CardFull")}
VISIT_COLUMNS = (
    "location_id", "session", "date", "time", "created_at", "actions", "trappers", "setup_by", "camera_status", "battery_status", "card_status", "num_photos", "date_time_ok", "camera_id", "camera_model",
    "camera_height", "camera_interval", "camera_tilt", "camera_heading", "detection_distance", "bait_use", "feature_type", "habitat", "sd", "calibration", "comments", "latitude", "longitude",
)


def _label(text: str) -> str:
    return re.sub(r"\s+", "", text or "").lower()


# What the form answers of the status of the camera when there is none at the site: the old form said it as a new site or an inactive one
_NO_CAMERA = ("no camera at the site", "new site", "inactive site")


def visit_actions(status: str | None, action: str | None, action_after_theft: str | None) -> str:
    """What a visit did, from what the form answers — one simple rule: an Installation if the status says there is no camera at the site (a new site, or an inactive one: its camera was removed before — the form now says it in one option) and one is put up; the action after a theft if the camera was
    stolen; the action otherwise. As the visit keeps them: a camera inspected is a Revision, replaced is a Revision, a Desinstallation and an Installation (after a theft, a Stolen and an
    Installation), a camera removed is a Revision and a Desinstallation, and a site removed is those two and an Archive — the location is given up — (after a theft, a
    Stolen and an Archive; after a theft a camera removed — not replaced, the site stays open — is a Stolen alone)."""
    status = (status or "").strip().lower()
    if status in _NO_CAMERA:
        return "Installation"  # no camera at the site — new, or its camera was removed before — has one put up: the form asks the same questions in both
    if status == "stolen":
        return {"camera replacement": "Stolen + Installation", "site removal": "Stolen + Archive", "camera removal": "Stolen", "none": "Stolen"}.get((action_after_theft or "").strip().lower(), "")
    return {
        "camera inspection": "Revision", "keep the camera": "Revision", "camera replacement": "Revision + Desinstallation + Installation", "camera removal": "Revision + Desinstallation",
        "site removal": "Revision + Desinstallation + Archive",
    }.get((action or "").strip().lower(), "")


def visit_row(entry: dict, refs: dict[str, str]) -> dict[str, str]:
    """A visit, as a row with the columns a visit has, from an entry of the form of the field flow. `refs` says the ref of the input each field comes from. What the
    entry leaves blank is not in the row. The camera's height is noted in centimetres and a visit keeps it in metres."""
    raw = {field: entry.get(ref) for field, ref in refs.items()}
    row: dict[str, str] = {}
    if (text := _text(raw.get("location_id"))) is not None:
        row["location_id"] = text
    if (text := _text(raw.get("session"))) is not None:
        row["session"] = text
    if (day := _day(raw.get("date"))) is not None:
        row["date"] = day.isoformat()
    if (clock := _clock(raw.get("time"))) is not None:
        row["time"] = clock.strftime("%H:%M:%S")
    if _text(entry.get("created_at")):
        row["created_at"] = str(entry["created_at"])
    if actions := visit_actions(_text(raw.get("camera_status")), _text(raw.get("action")), _text(raw.get("action_after_theft"))):
        row["actions"] = actions
    trappers = raw.get("trappers")
    names = trappers if isinstance(trappers, list) else ([trappers] if _text(trappers) else [])
    if names := [str(n).strip() for n in names if str(n).strip()]:
        row["trappers"] = ", ".join(names)
        row["setup_by"] = names[0]
    if (text := _text(raw.get("camera_status"))) is not None and text.strip().lower() != "no camera at the site":   # no camera is not a status of a camera: nothing is kept
        row["camera_status"] = text
    if (text := _text(raw.get("card_batteries_ok"))) is not None and text.lower() in _CARD_CODES:
        row["battery_status"], row["card_status"] = _CARD_CODES[text.lower()]
    # the form that asks the batteries and the card apart: each answer is its own column (the codes are read as they are written)
    for field in ("battery_status", "card_status"):
        if (text := _text(raw.get(field))) is not None:
            row[field] = text
    if (number := _number(raw.get("num_photos"))) is not None:
        row["num_photos"] = str(int(number))
    if (text := _text(raw.get("date_time_ok"))) is not None:
        row["date_time_ok"] = "Yes" if text.lower().startswith("ok") else "No"
    if (text := _text(raw.get("camera_id")) or _text(raw.get("camera_label"))) is not None:
        row["camera_id"] = text
    for field in ("camera_model", "feature_type", "habitat", "comments"):
        if (text := _text(raw.get(field))) is not None:
            row[field] = text
    # the card is what the SD cards of the project are called — its number: the form is a free text, where it is written "SD 7", "sd-7" or "7"
    if (text := _text(raw.get("sd"))) is not None:
        row["sd"] = re.sub(r"^sd\s*[-_#.:]?\s*", "", text, flags=re.IGNORECASE) or text
    if (number := _number(raw.get("camera_height"))) is not None:
        row["camera_height"] = str(round(number / 100, 4))
    for field in ("camera_interval", "camera_tilt", "camera_heading", "detection_distance"):
        if (number := _number(raw.get(field))) is not None:
            row[field] = str(number)
    for field in ("bait_use", "calibration"):
        if (flag := _yes_no(raw.get(field))) is not None:
            row[field] = "yes" if flag else "no"
    if (place := _place(raw.get("coordinates"))) is not None:
        row["latitude"], row["longitude"] = str(place["latitude"]), str(place.get("longitude", ""))
    return row


def visits_csv(settings: config.Settings | None = None) -> str:
    """The entries of the Epicollect5 project saved in the settings, as the text of a CSV with a row per visit and the columns a visit has — to be read as any other
    file of visits is. The inputs are found by their labels (see VISIT_QUESTIONS).

    Raises:
        EpicollectError: no project is saved, or it cannot be read, or the form is not the one of the field flow of a visit.
    """
    import csv  # noqa: PLC0415
    import io  # noqa: PLC0415
    settings = settings or config.load_settings()
    cfg = settings.EPICOLLECT5
    form = fetch_form(settings)
    refs = {VISIT_QUESTIONS[_label(i["label"])]: i["ref"] for i in form["inputs"] if _label(i.get("label", "")) in VISIT_QUESTIONS}
    missing = [name for name in ("locationID", "Date", "Status of the camera") if _label(name) not in {_label(i.get("label", "")) for i in form["inputs"]}]
    if missing:
        raise EpicollectError(f"The form of the project does not have the questions of a visit: {', '.join(missing)}.")
    try:
        entries = _all_entries(cfg.project_slug or "", cfg.client_id, cfg.client_secret)
    except EpicollectError:
        raise
    except Exception as exc:  # the network, or an answer that is not JSON
        raise EpicollectError(f"Could not read the entries from Epicollect5: {exc}") from exc
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=list(VISIT_COLUMNS), lineterminator="\n")
    writer.writeheader()
    for entry in entries:
        writer.writerow(visit_row(entry, refs))
    return out.getvalue()


# Epicollect5 cuts the headers of the CSV it gives at this many characters.
_HEADER_LIMIT = 20


def _header_key(header: str) -> tuple[str, str | None]:
    """A column of the CSV Epicollect5 gives, as the question it answers: its label with no number in front and no marks, and which part of a place it is, if it is one
    (`lat_26_Coordinates`, `long_26_Coordinates`)."""
    part = None
    match = re.match(r"(?i)^(lat|long|accuracy)_(.*)$", header.strip())
    if match:
        part, header = match.group(1).lower(), match.group(2)
    header = re.sub(r"^\d+_", "", header.strip())
    return re.sub(r"[\W_]+", "", header).lower(), part


def is_form_csv(text: str) -> bool:
    """Whether a CSV is the download of the WildINTEL form of Epicollect5: it has the columns of the form (the location, the status of the camera and created_at)."""
    try:
        visits_from_csv(text)
    except EpicollectError:
        return False
    return True


def visits_from_csv(text: str) -> str:
    """The CSV downloaded from the new Epicollect5 project (the form of the field flow), as the text of a CSV with a row per visit and the columns a visit has. Its
    columns are found by the label of their question, ignoring the number in front, the case and the marks — and a header cut at 20 characters, as Epicollect5 does, by the beginning of it.

    Raises:
        EpicollectError: the file has no rows, or it is not the form of a visit.
    """
    import csv  # noqa: PLC0415
    import io  # noqa: PLC0415
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    headers = reader.fieldnames or []
    questions = {re.sub(r"[\W_]+", "", k).lower(): v for k, v in VISIT_QUESTIONS.items()} | {"npicturescollected": "num_photos"}
    refs: dict[str, str] = {}
    place: dict[str, str] = {}
    cut_headers: list[tuple[str, str]] = []
    for header in headers:
        key, part = _header_key(header)
        if key == "coordinates" and part in ("lat", "long"):
            place[part] = header
        elif part is None and key in questions:
            refs[questions[key]] = header
        elif part is None and len(header.strip()) >= _HEADER_LIMIT:
            # Epicollect5 cuts a header — its number, an underscore and the question — at 20 characters ("7_Status_of_the_came"): the question is then the beginning of a label
            cut_headers.append((key, header))
    # a cut header may begin more than one label ("10_Action_after_the_" is "Action after the review" and "Action after theft"): the question that another column already is is not it
    for _ in range(len(cut_headers)):
        for key, header in list(cut_headers):
            cut = {field for label, field in questions.items() if label.startswith(key) and len(key) >= 3} - set(refs)
            if len(cut) == 1:
                refs[cut.pop()] = header
                cut_headers.remove((key, header))
    # the day and the time of a visit are when its entry was created (created_at): the form has no date or time to ask for
    missing = [name for name, field in (("locationID", "location_id"), ("Status of the camera", "camera_status")) if field not in refs]
    if "created_at" not in (reader.fieldnames or []):
        missing.append("created_at")
    if missing:
        raise EpicollectError(f"The file is not the download of the form of a visit: it has no column for {', '.join(missing)}.")
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=list(VISIT_COLUMNS), lineterminator="\n")
    writer.writeheader()
    for line in reader:
        entry: dict[str, Any] = {ref: line.get(header) for ref, header in ((h, h) for h in refs.values())}
        entry["created_at"] = line.get("created_at")
        if "trappers" in refs and (names := _text(line.get(refs["trappers"]))):
            entry[refs["trappers"]] = [n.strip() for n in names.split(",")]
        if place:
            lat, lon = _text(line.get(place.get("lat", ""))), _text(line.get(place.get("long", "")))
            if lat:
                entry["__place"] = {"latitude": lat, "longitude": lon or ""}
        refs_now = dict(refs)
        if "__place" in entry:
            refs_now["coordinates"] = "__place"
        writer.writerow(visit_row(entry, refs_now))
    return out.getvalue()
