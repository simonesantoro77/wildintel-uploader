"""Reads the visits to the camera traps of a research project from a CSV file (see local_folder_service.write_visits): any CSV, with the column that gives
each field of a visit (see FIELDS) said by the caller (`mapping`, {field: column name}); suggest_mapping offers a mapping to start from. The downloads of the
Epicollect5 projects are turned into such a CSV first (see epicollect_service)."""
from __future__ import annotations

import csv
import datetime as dt
import io
import re
import unicodedata

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator, model_validator
from pydantic_core import PydanticCustomError

from wildintel_uploader.core import config
from wildintel_uploader.core.schemas.requests import LocationRecord, VisitRecord
from wildintel_uploader.core.services import visit_rules, visit_time

# What each column of a CSV may be called, to suggest a mapping — compared without case, spaces, dashes, underscores or a number in front.
COLUMN_NAMES: dict[str, tuple[str, ...]] = {
    "location_id": ("site", "location", "locationid", "sitio"),
    "date": ("date", "fecha"),
    "time": ("time", "hora", "hour"),
    "when": ("datetime", "when", "fechahora"),
    "actions": ("actions", "action", "accion"),
    "trappers": ("trappers", "trapper", "who", "tramperos", "responsable"),
    "session": ("session", "revision", "sesion", "collection"),
    "camera_status": ("camerastatus", "status", "state", "estado", "statusofthecame"),
    "battery_status": ("batterystatus", "batteries", "battery", "pilas", "bateria"),
    "card_status": ("cardstatus", "sdstatus", "tarjeta"),
    "card_batteries_ok": ("cardbatteriesok", "cardbatteries", "cardpilasok"),   # how it was before: one column for both
    "num_photos": ("numphotos", "photos", "numimages", "numfotos", "numberofpictures"),
    "sd": ("sd", "sdcard"),
    "date_time_ok": ("datetimeok", "fechahoraok", "dateandhour"),
    "camera_id": ("camera", "cameraid", "camara"),
    "camera_model": ("cameramodel",),
    "comments": ("notes", "comments", "deploymentcomments", "observaciones", "observation"),
    "setup_by": ("setupby",),
    "latitude": ("latitude", "lat", "latitud", "lat13coordenates", "lat13localizacinactua"),
    "longitude": ("longitude", "lon", "lng", "longitud", "long13coordenates", "long13localizacinactua"),
    "location_latitude": ("locationlatitude", "locationlat"),
    "location_longitude": ("locationlongitude", "locationlon", "locationlng"),
    "created_at": ("createdat",),
    # what a deployment has beside, named as Camtrap DP names it (or as the visit does)
    "camera_interval": ("cameradelay", "camerainterval"),
    "camera_height": ("cameraheight",),
    "camera_depth": ("cameradepth",),
    "camera_tilt": ("cameratilt",),
    "camera_heading": ("cameraheading",),
    "detection_distance": ("detectiondistance",),
    "timestamp_issues": ("timestampissues",),
    "calibration": ("calibration", "cameracalibrated"),
    "bait_use": ("baituse",),
    "feature_type": ("featuretype",),
    "habitat": ("habitat",),
    "deployment_groups": ("deploymentgroups",),
    "tags": ("tags", "deploymenttags"),
}
# The fields of a visit a CSV can give, in the order they are asked for: what each one is, and whether the visit needs it.
FIELDS: tuple[tuple[str, str, bool], ...] = (
    ("location_id", "Location (of the research project)", True),
    ("actions", "Actions (Installation, Revision, Desinstallation, Stolen, Archive — several with +)", True),
    ("date", "Date (YYYY-MM-DD or DD/MM/YYYY)", False),
    ("time", "Time (HH:MM[:SS])", False),
    ("when", "Date and time in one column (YYYY-MM-DD HH:MM:SS)", False),
    ("created_at", "Created at (UTC, as Epicollect writes it)", False),
    ("session", "Revision (R0013, or its number)", False),
    ("trappers", "Who went", False),
    ("camera_status", "Status of the camera", False),
    ("battery_status", "Batteries (OK, NoBatteries)", False),
    ("card_status", "SD card (OK, CardFull)", False),
    ("num_photos", "Images on the card collected", False),
    ("sd", "SD card left", False),
    ("date_time_ok", "Date and time of the camera OK", False),
    ("camera_id", "Camera id", False),
    ("camera_model", "Camera model", False),
    ("comments", "Notes", False),
    ("setup_by", "Set up by", False),
    ("latitude", "Latitude of the visit (where the trapper was when it was noted; the location's when the file has none)", False),
    ("longitude", "Longitude of the visit (where the trapper was when it was noted; the location's when the file has none)", False),
    ("camera_interval", "Camera delay (s)", False),
    ("camera_height", "Camera height (m)", False),
    ("camera_depth", "Camera depth (m)", False),
    ("camera_tilt", "Camera tilt (°)", False),
    ("camera_heading", "Camera heading (°)", False),
    ("detection_distance", "Detection distance (m)", False),
    ("timestamp_issues", "Timestamp issues (yes/no)", False),
    ("bait_use", "Bait use (yes/no)", False),
    ("calibration", "Camera calibrated (yes/no)", False),
    ("feature_type", "Feature type", False),
    ("habitat", "Habitat", False),
    ("deployment_groups", "Deployment groups", False),
    ("tags", "Tags (separated by |)", False),
    # what a row says of the entities it may create (see CREATABLE): they are not fields of the visit
    ("location_name", "Name of the location", False),
    ("location_latitude", "Latitude of the location", False),
    ("location_longitude", "Longitude of the location", False),
    ("timezone", "Timezone of the location (IANA, e.g. Europe/Madrid)", False),
    ("daylight_saving", "Daylight saving time of the location (yes if its cameras follow it, no if they do not)", False),
    ("coordinate_uncertainty", "Coordinate uncertainty of the location (m)", False),
    ("sd_brand", "Brand of the SD card", False),
    ("sd_capacity", "Capacity of the SD card (e.g. 64 GB)", False),
)
REQUIRED = tuple(f for f, _, required in FIELDS if required)
# What the import can create when a visit names a location, a camera or an SD card that does not exist: each one's fields that a row must give — by a column or
# by a default — and the ones that are only asked for when it is created. The fields of the visit that appear here (camera_id, camera_model, sd) become required
# when it is; the coordinates of the location are its own (location_latitude, location_longitude), apart from those of the visit, which a row gives or, when it has none, are those of its location.
CREATABLE: dict[str, dict] = {
    "locations": {"required": ["location_latitude", "location_longitude", "timezone", "daylight_saving"], "extra": ["location_name", "coordinate_uncertainty"]},
    "cameras": {"required": ["camera_id"], "extra": ["camera_model"]},
    "sd_cards": {"required": ["sd"], "extra": ["sd_brand", "sd_capacity"]},
    # the people who went are what the visits say they are called (who went, who set up): nothing else is asked of them — their username is worked out from the name
    "trappers": {"required": [], "extra": []},
}
# The fields that are not a visit's but an entity's.
ENTITY_ONLY = {f: entity for entity, spec in CREATABLE.items() for f in [*spec["required"], *spec["extra"]] if f in ("location_name", "location_latitude", "location_longitude", "timezone", "daylight_saving", "coordinate_uncertainty", "sd_brand", "sd_capacity")}
ACTIONS = {a.lower(): a for a in ("SiteStart", "Installation", "Revision", "Desinstallation", "Stolen", "Archive")} | {
    # the start of a site, as it is told
    "site start": "SiteStart", "site_start": "SiteStart", "start of site": "SiteStart", "site setup": "SiteStart",
    "location start": "SiteStart", "location_start": "SiteStart", "start of location": "SiteStart", "location setup": "SiteStart",
    # as the datasheets of the field work write them
    "i": "Installation", "r": "Revision", "d": "Desinstallation", "robada": "Stolen", "uninstallation": "Desinstallation", "removal": "Desinstallation",
}
YES = {"yes", "true", "1", "y", "si", "sí"}
NO = {"no", "false", "0", "n"}
CODES = {c.lower(): c for c in ("OK", "CarFull", "NoBatteries", "CarFullNoBatteries")}
# ...and as the datasheet writes them (SinPilas, CarFullSinPilas) and as the form says them in English ("Card full", "No batteries", "Card full and no batteries"),
# compared without spaces, case or the s of the card
CODES_OTHER = {"cardfull": "CarFull", "sinpilas": "NoBatteries", "carfullsinpilas": "CarFullNoBatteries", "cardfullandnobatteries": "CarFullNoBatteries", "carfullandnobatteries": "CarFullNoBatteries"}


def card_code(value) -> str | None:
    """The code of how the card and the batteries were (OK, CarFull, NoBatteries or CarFullNoBatteries), from the code itself or from the other ways it is written;
    None when it is none of them."""
    text = re.sub(r"[\s_-]+", "", str(value).strip().lower())
    return CODES.get(text) or CODES_OTHER.get(text)


# What kind of error a problem is, by its code — the rows with the same code are told together. The codes are those of the errors the row raises (RowError, or
# the custom errors of CsvVisit): they do not change when a message is reworded.
ERROR_LABELS: dict[str, str] = {
    "actions_invalid": "Actions not valid",
    "card_batteries_invalid": "Card and batteries not valid",
    "battery_status_invalid": "Batteries not valid",
    "card_status_invalid": "SD card status not valid",
    "yes_no_invalid": "Not yes or no",
    "camera_status_invalid": "Status of the camera not valid",
    "session_invalid": "Revision not valid",
    "revision_not_finished": "Revision started before the one before is finished",
    "revision_without_previous": "Revision before it has no visit",
    "revision_closed": "Revision closed",
    "revision_order": "Revision out of order",
    "visit_repeated": "Location visited twice in a revision",
    "visit_refused": "Breaks the rules of a visit",
    "site_not_a_location": "Not a location of the research project",
    "visit_at_the_same_time": "Visit already there at that time",
    "first_visit_not_installation": "First visit is not an Installation",
    "site_start_repeated": "Location started twice",
    "site_start_not_first": "Location start is not the first visit",
    "visit_before_site_start": "Visit before the location started",
    "required_field": "Something its actions ask is missing",
    "camera_not_at_the_site": "Not the camera at the location",
    "camera_installed_here": "Camera already installed here",
    "camera_installed_elsewhere": "Camera installed at another location",
    "card_archived": "SD card archived",
    "card_is_the_one_collected": "SD card left is the one collected",
    "card_in_another_camera": "SD card in another camera",
    "card_collected_in_revision": "SD card collected in this revision",
    "visit_not_after_the_last": "Visit not after the last one of the location",
    "site_archived": "Location archived",
    "site_has_a_camera": "Location already has a camera",
    "site_without_camera": "Location has no camera",
    "site_planned": "Location planned",
    "archive_with_installation": "Archive with an Installation",
    "archive_camera_still_there": "Camera still there when the location is archived",
    "camera_unknown": "Camera not in the research project",
    "card_unknown": "SD card not in the research project",
    "trapper_unknown": "Trapper not in the settings",
    "date_invalid": "Date or time not valid",
    "number_invalid": "Number not valid",
    "coordinates_missing": "Coordinates of the visit missing",
    "create_missing": "Data to create it is missing",
    "create_invalid": "Data to create it is not valid",
    "visit_invalid": "Value not valid",
}


def error_label(code: str) -> str:
    """The kind of error a code says — see ERROR_LABELS."""
    return ERROR_LABELS.get(code, "Other problem")


class RowError(ValueError):
    """What is wrong with a row of the file, with the code of the kind of error it is (see ERROR_LABELS)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _custom(code: str, message: str, value) -> PydanticCustomError:
    return PydanticCustomError(code, message, {"value": value})


class CsvVisit(BaseModel):
    """The cells of a row of the file, read as what they say of a visit — all text, as the file has it. A cell that is not what its field takes raises an error with
    its code (see ERROR_LABELS); what the row does not say is left unset, so that only what it says is kept (`model_dump(exclude_unset=True)`)."""

    model_config = ConfigDict(extra="ignore")

    actions: list[str] = []
    session: str | None = None
    camera_status: str | None = None
    trappers: str | None = None
    sd: str | None = None
    date_time_ok: str | None = None
    camera_id: str | None = None
    camera_model: str | None = None
    comments: str | None = None
    setup_by: str | None = None
    battery_status: str | None = None
    card_status: str | None = None
    card_batteries_ok: str | None = None   # how it was before: one column for both
    num_photos: int | None = None
    camera_interval: int | None = None
    camera_tilt: int | None = None
    camera_heading: int | None = None
    camera_height: float | None = None
    camera_depth: float | None = None
    detection_distance: float | None = None
    timestamp_issues: bool | None = None
    bait_use: bool | None = None
    calibration: bool | None = None
    feature_type: str | None = None
    habitat: str | None = None
    deployment_groups: str | None = None
    tags: list[str] | None = None
    latitude: float | None = None
    longitude: float | None = None

    @field_validator("actions", mode="before")
    @classmethod
    def _actions(cls, value):
        names = [ACTIONS.get(a.strip().lower()) for a in re.split(r"[+;/|&,]", str(value)) if a.strip()]
        if None in names:
            raise _custom("actions_invalid", "The actions '{value}' are not Installation, Revision, Desinstallation, Stolen or Archive.", value)
        return names

    @field_validator("session", mode="before")
    @classmethod
    def _session(cls, value):
        m = re.search(r"\d+", str(value))
        if not m:
            raise _custom("session_invalid", "'{value}' is not a revision (R0013, or its number).", value)
        return f"R{int(m.group(0)):04d}"

    @field_validator("card_batteries_ok", mode="before")
    @classmethod
    def _card_batteries(cls, value):
        code = card_code(value)
        if code is None:
            raise _custom("card_batteries_invalid", "'{value}' is not OK, Card full, No batteries or Card full and no batteries (CarFull, NoBatteries and CarFullNoBatteries are the codes).", value)
        return code

    @field_validator("battery_status", mode="before")
    @classmethod
    def _battery(cls, value):
        code = visit_rules.battery_status_code(value)
        if code is None:
            raise _custom("battery_status_invalid", "'{value}' is not OK or No batteries (OK and NoBatteries are the codes).", value)
        return code

    @field_validator("card_status", mode="before")
    @classmethod
    def _card(cls, value):
        code = visit_rules.card_status_code(value)
        if code is None:
            raise _custom("card_status_invalid", "'{value}' is not OK or Card full (OK and CardFull are the codes).", value)
        return code

    @field_validator("camera_status", mode="before")
    @classmethod
    def _camera_status(cls, value):
        code = visit_rules.camera_status_code(value)
        if code is None:
            raise _custom("camera_status_invalid", "'{value}' is not " + ", ".join(visit_rules.CAMERA_STATUSES[:-1]) + " or " + visit_rules.CAMERA_STATUSES[-1] + ".", value)
        return code

    @field_validator("num_photos", "camera_interval", "camera_tilt", "camera_heading", mode="before")
    @classmethod
    def _whole(cls, value):
        try:
            return int(float(value))
        except (TypeError, ValueError, OverflowError):
            raise _custom("number_invalid", "'{value}' is not a whole number.", value) from None

    @field_validator("camera_height", "camera_depth", "detection_distance", "latitude", "longitude", mode="before")
    @classmethod
    def _number(cls, value):
        try:
            return float(value)
        except (TypeError, ValueError):
            raise _custom("number_invalid", "'{value}' is not a number.", value) from None

    @field_validator("timestamp_issues", "bait_use", "calibration", mode="before")
    @classmethod
    def _yes_no(cls, value):
        word = str(value).lower()
        if word not in YES | NO:
            raise _custom("yes_no_invalid", "'{value}' is not yes or no.", value)
        return word in YES

    @field_validator("tags", mode="before")
    @classmethod
    def _tags(cls, value):
        return [t.strip() for t in re.split(r"[|;]", str(value)) if t.strip()]

    @model_validator(mode="after")
    def _something_was_done(self):
        # a visit that could not be made has no action: it is exported so, and read back so
        if not self.actions and not visit_rules.is_not_revised({"camera_status": self.camera_status}):
            raise _custom("actions_invalid", "The actions '{value}' are not Installation, Revision, Desinstallation, Stolen or Archive.", "")
        return self


def _problem_of(exc: ValidationError) -> tuple[str, str]:
    """The code and the message of the first error of a validation: those of a custom error of CsvVisit as they are, the others — a value the model of the visit
    refuses — as "visit_invalid", with the field they are of."""
    error = exc.errors()[0]
    where = ".".join(str(p) for p in error["loc"])
    code = error["type"] if error["type"] in ERROR_LABELS else "visit_invalid"
    # the actions, the session and the card already say what they are of; the rest are told with their field
    return code, error["msg"] if not where or code in ("actions_invalid", "session_invalid", "card_batteries_invalid") else f"{where}: {error['msg']}"


class VisitsCsvError(Exception):
    """The file can't be read as visits at all."""


def _key(name: str) -> str:
    """A column name without its number in front (12_Observation), its case, spaces or underscores."""
    return re.sub(r"[^a-z0-9]", "", re.sub(r"^\d+_", "", name.strip().lower()))


def _table(text: str) -> list[list[str]]:
    """The rows of the file, the first being its header — the delimiter is the one the header has most of."""
    text = text.lstrip("﻿")
    head = text.splitlines()[0] if text.strip() else ""
    delimiter = max(",;\t", key=head.count)
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    table = [row for row in reader if any(cell.strip() for cell in row)]
    if not table:
        raise VisitsCsvError("The file is empty.")
    return table


def _fields(header: list[str], mapping: dict[str, str] | None) -> list[str | None]:
    """The field of a visit each column of the header gives — nothing for a column that is not used."""
    by_column = {column: field for field, column in (mapping or {}).items() if column}
    return [by_column.get(cell) for cell in header]


def suggest_mapping(text: str) -> dict:
    """The columns of a CSV, a few of its rows, and for each field of a visit the column that most likely gives it — to start a mapping from."""
    table = _table(text)
    header = table[0]
    names = {alias: field for field, aliases in COLUMN_NAMES.items() for alias in aliases} | {_key(f): f for f, _, _ in FIELDS}
    mapping: dict[str, str] = {}
    for cell in header:
        field = names.get(_key(cell))
        if field and field not in mapping:
            mapping[field] = cell
    return {"columns": header, "sample": table[1:4], "mapping": mapping}


def _rows(text: str, mapping: dict[str, str] | None, defaults: dict[str, str] | None = None,
          create: dict[str, bool] | None = None) -> tuple[dict[str, str], list[dict[str, str]]]:
    """The file's columns, as the visit's fields they are, and its rows keyed by those fields.

    `defaults` ({field: value}) is what a field is when its column is not in the file or a cell of it is empty; a field with a default counts as given. `create` ({locations, cameras,
    sd_cards}: bool) says which entities are created when they do not exist: the fields they need (see CREATABLE) are required too."""
    table = _table(text)
    fields = _fields(table[0], mapping)
    defaults = {f: v.strip() for f, v in (defaults or {}).items() if f and str(v).strip()}
    present = {f for f in fields if f} | set(defaults)
    missing = [f for f in REQUIRED if f not in present]
    missing += [f for entity, on in (create or {}).items() if on and entity in CREATABLE for f in CREATABLE[entity]["required"] if f not in present and f not in missing]
    if not present & {"created_at", "when"} and not {"date", "time"} <= present:
        missing.append("the date and the time (or created_at)")
    if missing:
        raise VisitsCsvError(f"The file has no column for: {', '.join(missing)}. Columns found: {', '.join(c.strip() for c in table[0])}.")
    rows = [{**defaults, **{f: cell.strip() for f, cell in zip(fields, row) if f and cell.strip()}} for row in table[1:]]
    return {f: c for f, c in zip(fields, table[0]) if f}, rows


def _local(created: dt.datetime, location: dict) -> dt.datetime:
    """The time of an entry — UTC — in the timezone of the location, with no summer time when the location ignores it; UTC when it has none."""
    return visit_time.utc_to_local(created, location)


def _real(date: str, time: str) -> tuple[str, str]:
    """The day and the time, once they are known to be a day and a time that exist (the 13th month, the 25th hour)."""
    try:
        dt.date.fromisoformat(date)
        dt.time.fromisoformat(time)
    except ValueError:
        raise RowError("date_invalid", f"'{date} {time}' is not a date and a time that exist.") from None
    return date, time


def _when(row: dict[str, str], location: dict, time_source: str = "created_at") -> tuple[str, str]:
    """The day and the time of a visit: when its entry was created (created_at, UTC, as Epicollect writes it), else its date and time — or, when `time_source`
    is "hour", the date and the hour typed in the form (the wall clock of its location) when the row has them, else the time its entry was created."""
    if "created_at" in row and not (time_source == "hour" and "date" in row and "time" in row):
        try:
            created = dt.datetime.fromisoformat(row["created_at"].replace("Z", "+00:00"))
        except ValueError as exc:
            raise RowError("date_invalid", f"'{row['created_at']}' is not a created_at (2026-09-04T10:16:31.000Z).") from exc
        if created.tzinfo is not None:
            created = (created - created.utcoffset()).replace(tzinfo=None)
        local = _local(created.replace(microsecond=0), location)
        return local.date().isoformat(), local.time().isoformat()
    if "when" in row:
        m = re.fullmatch(r"(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)", row["when"])
        if not m:
            raise RowError("date_invalid", f"'{row['when']}' is not a date and time (YYYY-MM-DD HH:MM:SS).")
        return _real(m.group(1), m.group(2) if m.group(2).count(":") == 2 else f"{m.group(2)}:00")
    if "date" not in row or "time" not in row:
        raise RowError("date_invalid", "The date and the time are required.")
    day = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", row["date"]) or re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", row["date"])
    if not day:
        raise RowError("date_invalid", f"'{row['date']}' is not a date (YYYY-MM-DD or DD/MM/YYYY).")
    date = row["date"] if "-" in row["date"] else f"{day.group(3)}-{day.group(2)}-{day.group(1)}"
    return _real(date, row["time"] if row["time"].count(":") == 2 else f"{row['time']}:00")


def _archived_by(locations: list[dict], visits: list[dict]) -> list[dict]:
    """The locations as the visits leave them: one that a visit archives (its actions have Archive) is archived on the day of that visit, unless it already was before."""
    archived_on: dict[str, str] = {}
    for v in visits:
        if "Archive" in (v.get("actions") or []):
            site, day = str(v.get("location_id") or "").lower(), str(v.get("date") or "")
            if site and day and (site not in archived_on or day < archived_on[site]):
                archived_on[site] = day
    out = []
    for l in locations:
        day = archived_on.get(str(l.get("location_id") or "").lower())
        already = l.get("status") == "archived" and (not l.get("status_date") or (day and str(l["status_date"]) <= day))
        out.append({**l, "status": "archived", "status_date": day} if day and not already else l)
    return out


def _minute_before(time: str) -> str:
    """The minute before a time of the day (HH:MM[:SS]), and the first of the day for the first."""
    h, m = (int(x) for x in time.split(":")[:2])
    total = max(h * 60 + m - 1, 0)
    return f"{total // 60:02d}:{total % 60:02d}:00"


def parse_visits(text: str, locations: list[dict], kept: list[dict], mapping: dict[str, str] | None = None, options: dict | None = None) -> dict:
    """The visits in the CSV `text` that can be kept, and what is wrong with the rest.

    `mapping` ({field: column}) says the column that gives each field of a visit — see the top of the module.
    A site must be a location of the research project (found ignoring case); its coordinates
    are the visit's unless the row has its own. A row without a session gets the next of its location, counted from the visits already
    kept. A visit already kept — the same location, day and time — is left as it is, and counted as skipped.

    A site that is not a location is not a problem to throw the rows away for: it may be a site that is really new, or one misnamed in the field. Its
    visits are held and the site comes back in "new_sites" with what tells the two apart (the coordinates of its first visit, the nearest location and
    how far, the ids one character apart — see visit_rules.new_site), to add it as a location or to correct the file. What is odd in the visits that are
    kept — what their actions ask and they lack, a camera or a card where it cannot be, two Revisions in a session… — comes back in "warnings": the
    visits are kept as the field wrote them and questioned, as the field records are.

    `options` are the settings of the field records: "time_source" ("created_at", or "hour" to read the date and the hour typed) and "cards" (the SD cards of the settings, to tell which are archived). A row whose session and site are those of a visit already
    kept is that visit: left as it is, and counted as skipped.

    Returns {"visits": [...], "problems": [{"row", "message"}], "skipped": int, "new_sites": [...], "warnings": [str], "notes": [str]} — the rows
    numbered as in the file, the header being 1. "notes" are what is worth knowing but not wrong: the sites of the trip before not visited on this one (their cameras
    are still out), visits where nothing was collected, visits with no photo count.

    Raises:
        VisitsCsvError: the file is empty or lacks a required column.
    """
    options = options or {}
    time_source = options.get("time_source") or "created_at"
    create = {entity: bool(on) for entity, on in (options.get("create") or {}).items() if entity in CREATABLE}
    _, rows = _rows(text, mapping, options.get("defaults"), create)
    known = {str(l.get("location_id", "")).lower(): l for l in locations}
    # What a row creates when its location, camera or SD card does not exist and it is asked to: {row: {"locations": [...], "cameras": [...], "sd_cards": [...]}}, and the
    # locations made from the first row that gave each site (the other rows of it are read in its timezone).
    cameras_known = {str(c.get(k) or "") for c in options.get("cameras") or [] if c.get("status") != "planned" for k in ("camera_id", "label")} - {""}   # as written: 7b and 7B are two
    cards_known = {str(c.get("label") or "") for c in options.get("cards") or [] if c.get("status") != "planned"} - {""}
    made_by_row: dict[int, dict[str, list[dict]]] = {}
    new_locations: dict[str, dict] = {}
    already = {(str(v.get("location_id", "")).lower(), v.get("date"), v.get("time")) for v in kept}
    problems: list[dict] = []
    parsed: list[tuple[int, dict]] = []
    skipped = 0
    held: dict[str, list[dict]] = {}  # the visits to sites that are not locations of the research project, by site
    row_warnings: list[tuple[int, str]] = []  # what is odd in a row by itself: its row, and what
    took_location_coordinates: list[int] = []  # the rows that have no coordinates of the visit: they take those of their location
    from_location = options.get("coordinates_from_location", True)   # a row with none takes its location's — unless the import is asked not to
    # A revision is one visit to each site: the session and the site of a visit already kept are taken, whatever its camera or its actions
    in_file: dict[tuple[str, str], int] = {}
    kept_by_site = visit_rules.History(kept)   # the visits kept, found by site: a row asks of its site's, not of all of them
    same_visit = {(str(v.get("session") or "").upper(), str(v.get("location_id", "")).lower()) for v in kept if v.get("session")}

    # What became of each row of the file: {row: {"row", "site", "result", "message"}} — result is ok, problem, already_kept, new_site or ignored.
    report: dict[int, dict] = {}

    def problem(n: int, message: str, code: str = "other") -> None:
        problems.append({"row": n, "message": message})
        report[n] = {**report.get(n, {"row": n, "site": ""}), "result": "problem", "label": error_label(code), "message": message}

    by_new_site: list[dict] = []   # the locations that a visit that says New site made
    for n, row in enumerate(rows, start=2):
        found = re.search(r"\d+", row.get("session", ""))
        report[n] = {"row": n, "site": row.get("location_id", ""), "session": f"R{int(found.group(0)):04d}" if found else "", "actions": row.get("actions", ""), "result": "ok", "label": "", "message": "", "data": dict(row)}
        site = row.get("location_id", "")
        location = known.get(site.lower()) or new_locations.get(site.lower())
        unknown = location is None
        made: dict[str, list[dict]] = {"locations": [], "cameras": [], "sd_cards": []}
        try:
            # a visit that says New site makes its site — the form lets a site be made on the spot —, when the file is asked to (the one of Epicollect5 is), with no need of the switch
            says_new_site = bool(options.get("new_site_makes_location")) and str(row.get("camera_status") or "").strip().lower() == "new site"
            if unknown and (create.get("locations") or says_new_site):
                location = _new_location(site, row)
                made["locations"].append(location)
                unknown = False
                if says_new_site and not create.get("locations"):
                    by_new_site.append(location)
        except RowError as exc:
            problem(n, str(exc), exc.code)
            continue
        if unknown:
            location = {}  # held with its site apart: the time is read as UTC, as nothing says better
        try:
            date, time = _when(row, location, time_source)
            report[n] |= {"date": date, "time": time[:5]}
            # what the cells say of the visit — each one read as its field takes it, or refused with the code of what is wrong
            cells = CsvVisit.model_validate(row)
            # the coordinates of a visit are required, but a file need not have them: a row that has none takes those of its location (said once, in a note) unless the import is asked not to. One of the two is not enough.
            if cells.latitude is None and cells.longitude is None:
                if not from_location:
                    raise RowError("coordinates_missing", "The row needs the coordinates of the visit: a latitude and a longitude.")
                if location.get("latitude") is None or location.get("longitude") is None:
                    raise RowError("coordinates_missing", "The row has no coordinates of the visit (a latitude and a longitude), and its location has none to take instead.")
                cells.latitude, cells.longitude = float(location["latitude"]), float(location["longitude"])
                took_location_coordinates.append(n)
            elif cells.latitude is None or cells.longitude is None:
                raise RowError("coordinates_missing", "The row has only one of the coordinates of the visit: it needs a latitude and a longitude" + (", or none (then those of its location are used)." if from_location else "."))
            actions = cells.actions
            # a camera and an SD card are what their cell says, stripped; the ones that exist are found ignoring the case
            if create.get("cameras") and cells.camera_id and cells.camera_id not in cameras_known:
                made["cameras"].append(_new_camera(cells.camera_id, row))
            if create.get("sd_cards") and cells.sd and cells.sd not in cards_known:
                made["sd_cards"].append(_new_card(cells.sd, row))
            # an id that is out of the ordinary is said once for its card, in the rows it is in; the card that is kept already was accepted as it is
            if cells.sd and cells.sd not in cards_known and visit_rules.unusual_card_id(cells.sd):
                row_warnings.append((n, visit_rules.unusual_card_message(cells.sd)))
            data = cells.model_dump(exclude_unset=True, exclude={"actions"})
            if "card_batteries_ok" in data:   # one column for both, as it was: the batteries and the card each in its own field
                battery, card = visit_rules.split_card_batteries(data.pop("card_batteries_ok"))
                data.setdefault("battery_status", battery)
                data.setdefault("card_status", card)
            # the GPS of the note is compared with the location's, to check that the site is the right one
            if data.get("latitude") is not None and data.get("longitude") is not None and location.get("latitude") is not None and location.get("longitude") is not None:
                gap = visit_rules.distance_m(data["latitude"], data["longitude"], float(location["latitude"]), float(location["longitude"]))
                if gap > visit_rules.GPS_TOLERANCE_M:
                    row_warnings.append((n, f"Row {n} ({site}): the GPS of the note is {round(gap)} m from the location; check that the location is the right one."))
            visit = {"location_id": location.get("location_id", site), "date": date, "time": time, "actions": actions, **data}
            visit.setdefault("session", "R0000")  # worked out below, when the order of the visits is known
            record = VisitRecord.model_validate(visit).model_dump(mode="json")
            record["when"] = visit_time.to_when(record["date"], record["time"], location)
            record = visit_rules.with_site_start(record, kept_by_site, None)
            report[n]["actions"] = " + ".join(record["actions"])
        except RowError as exc:
            problem(n, str(exc), exc.code)
            continue
        except ValidationError as exc:
            code, message = _problem_of(exc)
            problem(n, message, code)
            continue
        except ValueError as exc:
            problem(n, str(exc))
            continue
        if unknown:
            held.setdefault(site, []).append(record)
            report[n] |= {"result": "new_site", "label": "Not a location of the research project", "message": f"{site} is not a location of the research project: the visit is held until the location is added or the file corrected."}
            continue
        again = (str(record["session"]).upper(), record["location_id"].lower())
        # two visits are the same when they are of the same revision and the same site, whatever the day: the day is not part of it. Only a row with no revision —
        # it gets the next of its site, so there is nothing to compare — is told by the day and the time it says.
        by_time = (record["location_id"].lower(), record["date"], record["time"]) in already
        if ("session" in row and again in same_visit) or ("session" not in row and by_time):
            skipped += 1
            closed = visit_rules.is_closed_revision(record["session"], kept, locations)
            report[n] |= {"result": "already_kept", "label": "Already kept", "message": (f"A visit to {record['location_id']} on {record['date']} at {record['time']} is already kept: it is not imported again." if "session" not in row
                                                              else f"The {record['session']} visit of {record['location_id']} is already kept: it is not imported again."
                                                                 + (f" {record['session']} is closed — every location has its visit — so nothing new can be imported in it." if closed else ""))}
            continue
        if visit_rules.is_closed_revision(record["session"], kept, locations):
            problem(n, f"{record['session']} is closed: every location has its visit in it, so nothing new can be imported in it.", "revision_closed")
            continue
        # the key of a visit is its site and its revision: a site is visited once in a revision, whatever the day
        if "session" in row and again in in_file:
            problem(n, f"{record['location_id']} has already a visit in {record['session']} in row {in_file[again]} of the file: a revision is one visit to each location.", "visit_repeated")
            continue
        if "session" in row:
            in_file[again] = n
        already.add((record["location_id"].lower(), record["date"], record["time"]))
        parsed.append((n, record | {"_given": "session" in row}))
        if made["locations"]:
            new_locations[site.lower()] = made["locations"][0]
        made_by_row[n] = made

    row_of = {id(r): n for n, r in parsed}
    count: dict[str, int] = {}
    for loc in {r["location_id"].lower() for _, r in parsed}:
        count[loc] = sum(1 for v in kept if str(v.get("location_id", "")).lower() == loc)
    visits = []
    for _, record in sorted(parsed, key=lambda p: (p[1]["date"], p[1]["time"])):
        given = record.pop("_given")
        loc = record["location_id"].lower()
        # a visit that does not put a camera up is of the one at the site: an inspection or a removal does not say which — and it is not told here: it is in the visit before
        if not given:
            record["session"] = f"R{count[loc] + 1:04d}"
        count[loc] += 1
        visits.append(record)
    # The first camera put up at a pending site starts it.
    seen_sites = {str(v.get("location_id", "")).lower() for v in kept}
    by_site = {str(l.get("location_id", "")).lower(): l for l in [*locations, *new_locations.values()]}
    for record in sorted(visits, key=visit_rules._stamp):
        site = record["location_id"].lower()
        if site not in seen_sites:
            record["actions"] = visit_rules.with_site_start(record, [], by_site.get(site))["actions"]
            report[row_of[id(record)]]["actions"] = " + ".join(record["actions"])
            seen_sites.add(site)
    # every visit of a revision is after those of the revisions before it and before those of the revisions after it, whichever the site
    disordered = visit_rules.revision_order_conflicts(visits, kept)
    for visit, why in disordered:
        problem(row_of[id(visit)], why, "revision_order")
    out_of_order = {id(r) for r, _ in disordered}
    visits = [v for v in visits if id(v) not in out_of_order]
    # a visit of a file follows the rules of a visit by hand (see visit_rules.refusals): the visits are taken in the order of their instants, each against the ones kept and
    # the ones of the file before it that were kept, and the one that breaks them is refused with the row it comes from. What cannot be checked is not: the revisions a site
    # lacks before its first visit are unknown (nothing is known of them — no day, no camera, no card), so a first visit to a site after R0001 may be any.
    # A revision is imported only when the one before it is known — it has a visit, kept or in the file — and closed: only R0001 has none before it. So an import
    # makes no unknown visit: what a revision lacks is a visit to be made, marked as not visited when the revision is closed.
    unknown_kept = options.get("unknown") or []
    unknown: list[dict] = []
    all_locations = [*locations, *new_locations.values()]
    floor = 1
    close_after = options.get("close_after") or None
    close_notes: list[str] = []
    accepted, gate, closing = visit_rules.History(kept), {}, []
    unknown_kept_keys = {(str(u["location_id"]).lower(), str(u["session"]).upper()) for u in unknown_kept}

    def fills_unknown(v: dict) -> bool:
        """Whether the visit takes the place of an unknown one of the visits kept: its site has none in its revision, that is unknown."""
        return (v["location_id"].lower(), str(v["session"]).upper()) in unknown_kept_keys

    # the visits that fill an unknown one come last: each is checked with the visits after it that it touches, and those need the other visits of its revision to be there
    for visit in sorted(visits, key=lambda v: (fills_unknown(v), visit_rules._stamp(v))):
        number = visit_rules._session_number(visit.get("session"))
        fills = fills_unknown(visit)
        if number is not None and number not in gate and not fills:
            # a revision starts when the one before it is finished — said once for the revision, with the visits that were kept before it
            day = min(str(v["date"]) for v in visits if visit_rules._session_number(v.get("session")) == number)
            # a site given up by a visit taken so far (an Archive) is out of use from then on, as if the revisions had come in one file each: archiving is only kept when saving
            in_use = _archived_by(all_locations, accepted)
            before = [v for v in accepted if visit_rules._session_number(v.get("session")) == number - 1]
            if number > 1 and not before:
                gate[number] = visit_rules._reason("revision_without_previous", f"R{number:04d} cannot start: R{number - 1:04d} has no visit. Import the visits of R{number - 1:04d} first.")
            closes = None
            # the day to close on matters only to a revision that has locations still to be visited: one that is finished is left as it is
            if number > 1 and before and options.get("close_revisions") and close_after and visit_rules.revision_missing(number - 1, accepted, in_use, day, [*unknown_kept, *unknown], visits):
                # the day it is closed on: so long after its last visit, or so long before the first visit of the revision after it
                last = max(str(v["date"]) for v in before)
                amount, unit = int(close_after["amount"]), str(close_after["unit"])
                if close_after.get("anchor") == "before_next":
                    close_day, lasted = visit_rules.shifted(day, -amount, unit), f"{amount} {unit} before the first visit of R{number:04d} ({day})"
                else:
                    close_day, lasted = visit_rules.shifted(last, amount, unit), f"{amount} {unit} after its last visit ({last})"
                # it cannot end before its last visit, nor after the revision after it starts: the day is taken to the nearest one it can be
                if close_day < last:
                    close_notes.append(f"R{number - 1:04d} would be closed on {close_day}, {lasted}, before its last visit: it is closed on {last}, the day of its last visit.")
                    close_day = last
                elif close_day >= day:
                    # it reaches the revision after it: the day before the first visit of that one — never before its own last visit
                    before_next = max(last, visit_rules.shifted(day, -1, "days"))
                    close_notes.append(f"R{number - 1:04d} would be closed on {close_day}, {lasted}, when R{number:04d} has started ({day}): it is closed on {before_next}, the day before.")
                    close_day = before_next
                # on the day of the first visit after it, just before that visit
                earliest = min(str(v.get("time") or "00:00:00") for v in visits if visit_rules._session_number(v.get("session")) == number and str(v["date"]) == day) if close_day == day else None
                closes = (close_day, _minute_before(earliest) if earliest else "23:59:00")
            if number not in gate and options.get("close_revisions"):
                # the revision before is closed as the form does when asked: its locations still planned are marked as not visited
                marks = visit_rules.not_visited_records(number - 1, [*accepted, *(v for v in visits if visit_rules.SITE_START in (v.get('actions') or []))], in_use, [*unknown_kept, *unknown], closes=closes)
                for mark in marks:
                    location = next((l for l in all_locations if str(l.get("location_id", "")).lower() == mark["location_id"].lower()), None)
                    mark["when"] = visit_time.to_when(mark["date"], mark["time"], location)
                    mark["comments"] = "Marked as not visited when the revision after it was added from a file."
                accepted.extend(marks)
                closing.extend(marks)
            if number not in gate:
                gate[number] = visit_rules.unfinished_revision(number, accepted, in_use, floor, day, [*unknown_kept, *unknown], visits)
        n = row_of[id(visit)]
        reasons = [gate[number]] if number is not None and not fills and gate.get(number) else []
        # a visit that takes the place of an unknown one is put where its instant says, among the visits kept (as in the form)
        if fills:
            reasons += visit_rules.edit_errors(None, visit, accepted, all_locations, options.get("cards"), [*unknown_kept, *unknown])
        else:
            reasons += visit_rules.refusals(visit, accepted, all_locations, options.get("cards"), [*unknown_kept, *unknown], gate=False, first_may_be_any=True, photos_optional=bool(options.get("photos_not_counted")))
        # what the visit says that is not an entity (a camera, a card, a trapper) is refused, as in the form, unless the import creates it
        camera, card = str(visit.get("camera_id") or ""), str(visit.get("sd") or "")
        check = options.get("check_entities", True)
        if check and camera and options.get("cameras") is not None and camera not in cameras_known and not create.get("cameras"):
            reasons.append(visit_rules._reason("camera_unknown", f"The camera {visit['camera_id']} is not one of the cameras of the research project."))
        if check and card and options.get("cards") is not None and card not in cards_known and not create.get("sd_cards"):
            reasons.append(visit_rules._reason("card_unknown", f"The SD card {visit['sd']} is not one of the SD cards of the research project."))
        if check and options.get("trappers") is not None and not create.get("trappers"):
            known_trappers = {str(t) for t in options["trappers"]}   # as written: two people that differ only in case are two
            reasons += [visit_rules._reason("trapper_unknown", f"{t} is not one of the trappers.") for t in (x.strip() for x in str(visit.get("trappers") or "").split(",")) if t and t not in known_trappers]
        if reasons:
            # the kind of error is that of the first rule it breaks; every reason is told
            problem(n, " ".join(dict.fromkeys(reasons)), getattr(reasons[0], "code", "visit_refused"))
        else:
            accepted.append(visit)
    refused_ids = {id(v) for v in visits} - {id(v) for v in accepted}
    visits = [v for v in visits if id(v) not in refused_ids]
    new_sites = [visit_rules.new_site(site, records, locations) for site, records in sorted(held.items())]
    # what is odd and still kept, said once and told in the rows it is about: the visits that make it odd are rows of the file
    said: list[tuple[str, list[int]]] = [(message, [n]) for n, message in row_warnings]
    for message, about in [*visit_rules.session_jump_items(visits, kept), *visit_rules.history_warning_items(visits, kept, options.get("cards"), [*unknown_kept, *unknown], bool(options.get("photos_not_counted")))]:
        said.append((message, sorted({row_of[id(v)] for v in about if id(v) in row_of})))
    warnings = list(dict.fromkeys(message for message, _ in said))
    notes = visit_rules.history_notes(visits, kept)
    if options.get("photos_not_counted"):
        uncounted = [v for v in visits if {"Revision", "Desinstallation"} & set(v["actions"]) and v.get("num_photos") is None and v.get("card_status") != "CardFull" and str(v.get("camera_status") or "").lower() not in visit_rules.NOT_REVISED]
        if uncounted:
            notes.append(f"{len(uncounted)} {'visit has' if len(uncounted) == 1 else 'visits have'} no count of the images on the card, kept as the file says: the images of their deployments are not checked against a count.")
    took = sorted(n for n in took_location_coordinates if n in row_of.values() and any(row_of.get(id(v)) == n for v in visits))
    if took:
        shown = ", ".join(str(n) for n in took[:8]) + (f" and {len(took) - 8} more" if len(took) > 8 else "")
        notes.append(f"{len(took)} {'row has' if len(took) == 1 else 'rows have'} no coordinates of the visit (row {shown}): the coordinates of their location are used.")
    made_here = {l["location_id"].lower() for l in create_out_locations(new_locations, visits)}
    for location in by_new_site:
        if location["location_id"].lower() in made_here:
            notes.append(f"The location {location['location_id']} is made because its visit says New site: its place is the one of the visit and its timezone is {location['timezone']} — "
                         f"change it in the settings if it is not that one.")
    notes += close_notes
    closed = [m for m in closing if any(visit_rules._session_number(v.get("session")) == visit_rules._session_number(m["session"]) + 1 for v in visits)]
    for session in sorted({m["session"] for m in closed}):
        notes.append(f"{session} is closed to start the revision after it: {', '.join(m['location_id'] for m in closed if m['session'] == session)} still planned in it, marked as not visited.")
    # a site that has no visit in a revision the file gives was not there: the revision after it has to put its camera up
    upwards = visit_rules.unknown_installation_warnings(visits, kept, [*unknown_kept, *unknown])
    warnings += [m for m in upwards if m not in warnings]
    if unknown:
        by_revision: dict[str, list[str]] = {}
        for u in unknown:
            by_revision.setdefault(u["session"], []).append(u["location_id"])
        # the revisions in a row that have the same sites are told once: R0005–R0009
        groups: list[tuple[list[str], list[str]]] = []
        for session, sites in sorted(by_revision.items()):
            number, wanted = visit_rules._session_number(session), sorted(sites)
            if groups and groups[-1][1] == wanted and visit_rules._session_number(groups[-1][0][-1]) == (number or 0) - 1:
                groups[-1][0].append(session)
            else:
                groups.append(([session], wanted))
        for sessions, sites in groups:
            name = sessions[0] if len(sessions) == 1 else f"{sessions[0]}–{sessions[-1]}"
            notes.append(f"The {'revision' if len(sessions) == 1 else 'revisions'} {name} {'is' if len(sessions) == 1 else 'are'} created, but there is no data of {'its' if len(sessions) == 1 else 'their'} visits to {', '.join(sites)}: "
                         f"they are created as unknown visits, and the visits after them cannot be checked against them.")
    # what is created is what the visits that are kept need: a location, a camera or an SD card that only a refused visit named is not
    kept_rows = {row_of[id(v)] for v in visits}
    sites = {v["location_id"].lower() for v in visits}
    create_out: dict[str, list[dict]] = {"locations": [l for site, l in new_locations.items() if site in sites], "cameras": [], "sd_cards": [], "trappers": []}
    # the people the visits that are kept say went, who are not trappers yet: made as they are called, when the import is asked to
    trapper_rows: dict[int, list[str]] = {}
    if create.get("trappers") and options.get("trappers") is not None:
        have = {str(t) for t in options["trappers"]}
        taken = {str(u).lower() for u in options.get("trapper_usernames") or []}
        for visit in visits:
            for who in (x.strip() for x in str(visit.get("trappers") or "").split(",")):
                if who and who not in have:
                    username = _username_of(who, taken)
                    taken.add(username.lower()); have.add(who)
                    create_out["trappers"].append({"username": username, "name": who, "status": "active"})
                if who and who in {t["name"] for t in create_out["trappers"]}:
                    trapper_rows.setdefault(row_of[id(visit)], []).append(who)
        if create_out["trappers"]:
            notes.append(f"The trappers {', '.join(t['name'] for t in create_out['trappers'])} {'is' if len(create_out['trappers']) == 1 else 'are'} created as the visits say {'it' if len(create_out['trappers']) == 1 else 'them'}: "
                         f"their username is worked out from the name ({', '.join(t['username'] for t in create_out['trappers'])}); complete them in Settings › Trappers.")
    for n in sorted(kept_rows):
        for kind in ("cameras", "sd_cards"):
            for entity in made_by_row.get(n, {}).get(kind, []):
                key = str(entity.get("camera_id") or entity.get("label"))
                if key not in {str(e.get("camera_id") or e.get("label")) for e in create_out[kind]}:
                    create_out[kind].append(entity)
    # a warning goes to the rows that are added; one about no row, or only about rows that are not added, is said apart
    loose: list[str] = []
    for message, rows_about in said:
        added = [n for n in rows_about if n in kept_rows]
        if not added:
            loose.append(message)
        for n in added:
            if message not in report[n].setdefault("warnings", []):
                report[n]["warnings"].append(message)
    loose += upwards
    for n in sorted(kept_rows):
        names = [f"the location {l['location_id']}" for l in made_by_row.get(n, {}).get("locations", [])]
        names += [f"the camera {c['camera_id']}" for c in made_by_row.get(n, {}).get("cameras", [])]
        names += [f"the SD card {c['label']}" for c in made_by_row.get(n, {}).get("sd_cards", [])]
        names += [f"the trapper {w}" for w in dict.fromkeys(trapper_rows.get(n, []))]
        if names and n in report and report[n]["result"] == "ok":
            report[n]["message"] = f"The visit is added, and creates {', '.join(names)}."
    return {"visits": visits, "problems": problems, "rows": [report[n] for n in sorted(report)], "skipped": skipped, "new_sites": new_sites,
            "create": create_out, "warnings": warnings, "loose_warnings": list(dict.fromkeys(loose)), "notes": notes, "unknown": unknown, "closed": closed}


# The columns of an export: the fields of a visit a CSV can give, by their names — which the import finds by themselves — less the two that are worked out
# from the others (the instant of the visit and the time of the entry) and what the visit gets once it is kept (its state and its deployment).
EXPORT_FIELDS = tuple(f for f, _, _ in FIELDS if f not in ("when", "created_at") and f not in ENTITY_ONLY)


def export_visits(visits: list[dict]) -> str:
    """The visits as CSV text that the import reads back as they are: a column for each field of EXPORT_FIELDS, the actions joined with +, the tags with |,
    the yes/no fields as yes or no, and the visits from the oldest. It starts with a byte order mark, so that a spreadsheet reads the accents."""
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(EXPORT_FIELDS)

    def cell(visit: dict, field: str) -> str:
        value = visit.get(field)
        if value is None:
            return ""
        if field == "actions":
            return "+".join(value)
        if field == "tags":
            return "|".join(value)
        if isinstance(value, bool):
            return "yes" if value else "no"
        return str(value)

    for visit in sorted(visits, key=lambda v: (str(v.get("date")), str(v.get("time")))):
        writer.writerow([cell(visit, f) for f in EXPORT_FIELDS])
    return "\ufeff" + out.getvalue()


def create_out_locations(new_locations: dict[str, dict], visits: list[dict]) -> list[dict]:
    """The locations a file makes that a visit kept needs."""
    sites = {v["location_id"].lower() for v in visits}
    return [l for site, l in new_locations.items() if site in sites]


def _username_of(name: str, taken: set[str]) -> str:
    """The username of a trapper made from the name a visit says: the name without accents, in lower case, with a dot between its words (`Ana Pérez` is `ana.perez`) — another number
    when it is taken (`ana.perez2`). It is what the trapper is called in the app: it can be changed in the settings."""
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    base = re.sub(r"[^a-z0-9]+", ".", ascii_name.lower()).strip(".") or "trapper"
    username, n = base, 1
    while username.lower() in taken:
        n += 1
        username = f"{base}{n}"
    return username


def _new_location(site: str, row: dict[str, str]) -> dict:
    """The location a row creates: its id, its coordinates (the location's, not the visit's) and its timezone are the row's.

    Raises:
        RowError: the row has no coordinates or timezone, or they are not valid."""
    try:
        latitude, longitude = float(row["location_latitude"]), float(row["location_longitude"])
    except (KeyError, ValueError) as exc:
        raise RowError("create_missing", f"To create the location {site} the row needs its own coordinates: a latitude and a longitude of the location.") from exc
    if not row.get("timezone"):
        raise RowError("create_missing", f"To create the location {site} the row needs its timezone (e.g. Europe/Madrid).")
    saving = str(row.get("daylight_saving") or "").strip().lower()
    if saving not in YES | NO:
        raise RowError("create_missing", f"To create the location {site} the row needs to say if its cameras follow daylight saving time (yes or no).")
    try:
        uncertainty = int(float(row["coordinate_uncertainty"])) if row.get("coordinate_uncertainty") else None
        return LocationRecord(location_id=site, name=row.get("location_name") or None, latitude=latitude, longitude=longitude, timezone=row["timezone"],
                              ignore_dst=saving in NO, coordinate_uncertainty=uncertainty, status="pending").model_dump(mode="json")
    except (ValidationError, ValueError) as exc:
        raise RowError("create_invalid", f"To create the location {site}: {_first(exc) if isinstance(exc, ValidationError) else exc}") from exc


def _new_camera(camera_id: str, row: dict[str, str]) -> dict:
    """The camera a row creates: called by its id, with the model of the row when it has one."""
    return config.Camera(label=camera_id, camera_id=camera_id, camera_model=row.get("camera_model") or None).model_dump(mode="json")


def _new_card(label: str, row: dict[str, str]) -> dict:
    """The SD card a row creates: its id is its label, with the brand and the capacity of the row, when it has them."""
    return config.SdCard(label=label, brand=row.get("sd_brand") or None, capacity=row.get("sd_capacity") or None).model_dump(mode="json")


def _first(exc: ValidationError) -> str:
    error = exc.errors()[0]
    where = ".".join(str(p) for p in error["loc"])
    return f"{where}: {error['msg']}" if where else error["msg"]
