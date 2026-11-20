"""wildintel-uploader's own settings.toml — Trapper connection defaults and
where imported deployments are organized locally, kept in the user's config
directory (editable on the app's settings page).

Same approach as wildintel-zooniverse's own core/config.py: a Pydantic model
validated from what Dynaconf reads, written back with Dynaconf's TOML
loader. Created with defaults the first time it's read."""
from __future__ import annotations

import os
import re
import tempfile
import unicodedata
from pathlib import Path
from datetime import date
from typing import Literal, Optional

import platformdirs
from dynaconf import Dynaconf, loaders
from pydantic import BaseModel, Field, ValidationInfo, field_validator, model_validator

from wildintel_uploader.core.services import ids

APP_NAME = "wildintel-uploader"
DEFAULT_CONFIG_FILE = Path(platformdirs.user_config_dir(APP_NAME)) / "settings.toml"
# More settings files besides the default one: every .toml in CONFIGS_DIR.
# Which one is in use is named by ACTIVE_CONFIG_POINTER (see active_config_file).
CONFIGS_DIR = DEFAULT_CONFIG_FILE.parent / "configs"
ACTIVE_CONFIG_POINTER = DEFAULT_CONFIG_FILE.parent / "active-config"
DEFAULT_CONFIG_ID = "default"


def get_app_documents_dir() -> Path:
    return Path(platformdirs.user_documents_dir()) / APP_NAME


def get_logs_dir() -> Path:
    """Where the app's log files go — the log folder of the system, which is state: ~/.local/state/wildintel-uploader/log
    on Linux (see logging_setup). Not configurable."""
    return Path(platformdirs.user_log_dir(APP_NAME))


def legacy_logs_dir() -> Path:
    """Where the log files were kept before: next to settings.toml."""
    return DEFAULT_CONFIG_FILE.parent / "logs"


def legacy_sessions_dir() -> Path:
    """Where the sessions were kept before they moved to the state folder: <documents>/wildintel-uploader/sessions."""
    return get_app_documents_dir() / "sessions"


def get_sessions_dir() -> Path:
    """Where in-progress and interrupted wizard runs persist — they are state: ~/.local/state/wildintel-uploader/sessions on
    Linux (the XDG state folder), the app's folder in Windows and macOS. Not configurable — see services.session_store."""
    return Path(platformdirs.user_state_dir(APP_NAME)) / "sessions"


def default_data_dir() -> Path:
    """The data folder, where the app keeps what it makes — <documents>/wildintel-uploader.
    Its collections, reports and packages go in folders inside it (see
    collections_dir, reports_dir, packages_dir). DATA.dir can override it."""
    return get_app_documents_dir()


LogLevel = Literal["ERROR", "WARNING", "INFO", "DEBUG"]

MAX_WORKERS = 64


def default_workers() -> int:
    """How many images are worked on at once unless the settings say otherwise: the CPUs there are, up to 4."""
    return max(1, min(4, os.cpu_count() or 1))


class GeneralSettings(BaseModel):
    log_level: LogLevel = Field(
        default="INFO",
        description="How much the app logs, to the console and its log file. (GENERAL.log_level)",
    )
    workers: int = Field(
        default_factory=default_workers, ge=1, le=MAX_WORKERS,
        description="How many images are validated or preprocessed at once — up to the CPUs of the machine pays off. (GENERAL.workers)",
    )
    default_research_project: Optional[str] = Field(
        default=None,
        description="The acronym of the research project that comes filled in wherever one is asked for; it can still be changed there. (GENERAL.default_research_project)",
    )

    show_welcome: bool = Field(
        default=True,
        description="Whether the welcome page is shown when the app opens: off, the app opens on what comes after it (the menu). (GENERAL.show_welcome)",
    )

    @field_validator("default_research_project")
    @classmethod
    def _default_research_project(cls, value: Optional[str]) -> Optional[str]:
        return (value or "").strip() or None


class TrapperSettings(BaseModel):
    enabled: bool = Field(default=True, description="Whether TRAPPER is used as a place to upload deployments to. (TRAPPER.enabled)")
    base_url: Optional[str] = Field(default=None, description="TRAPPER server URL. (TRAPPER.base_url)")
    user_name: Optional[str] = Field(default=None, description="TRAPPER username (its email — the import form only accepts that). (TRAPPER.user_name)")
    user_password: Optional[str] = Field(
        default=None, description="TRAPPER password. (TRAPPER.user_password)", json_schema_extra={"secret": True},
    )
    max_zip_mb: int = Field(
        default=500, ge=1, le=5000,
        description="The images of each deployment are uploaded in packages of at most this many megabytes. (TRAPPER.max_zip_mb)",
    )


class AgoutiSettings(BaseModel):
    """What an upload to Agouti needs (its public API: https://docs.agouti.eu/api/endpoints.html) — kept here; nothing is uploaded to Agouti yet."""

    enabled: bool = Field(default=False, description="Whether Agouti is used as a place to upload deployments to. (AGOUTI.enabled)")
    base_url: Optional[str] = Field(default=None, description="The address of Agouti's API (https://api.agouti.eu). (AGOUTI.base_url)")
    api_key: Optional[str] = Field(
        default=None, description="The API key Agouti's support gives, sent as X-API-KEY. (AGOUTI.api_key)", json_schema_extra={"secret": True},
    )
    project_id: Optional[str] = Field(default=None, description="The id of the Agouti project the deployments are uploaded to. (AGOUTI.project_id)")

    @field_validator("base_url", "project_id")
    @classmethod
    def _stripped(cls, value: Optional[str]) -> Optional[str]:
        return (value.strip() or None) if isinstance(value, str) else value


class EpicollectCsvSettings(BaseModel):
    enabled: bool = Field(default=True, description="Whether the CSV downloaded from the new WildINTEL Epicollect project can be read for visits. (EPICOLLECTCSV.enabled)")


class Epicollect5Settings(BaseModel):
    enabled: bool = Field(default=False, description="Whether Epicollect5 is used as a source: of visits (its entries are downloaded as a CSV), and of the details of a deployment when it is imported. (EPICOLLECT5.enabled)")
    unmapped_to_comments: bool = Field(
        default=False,
        description="What an entry says in an input that is not mapped to any field goes to the comments of the deployment. (EPICOLLECT5.unmapped_to_comments)",
    )
    project_slug: Optional[str] = Field(default=None, description="Slug of the Epicollect5 project — the name in its URL (five.epicollect.net/project/<slug>). (EPICOLLECT5.project_slug)")
    client_id: Optional[str] = Field(default=None, description="Client id of the Epicollect5 API client app, for private projects. (EPICOLLECT5.client_id)")
    client_secret: Optional[str] = Field(
        default=None, description="Client secret of the Epicollect5 API client app. (EPICOLLECT5.client_secret)", json_schema_extra={"secret": True},
    )
    mapping: dict[str, str] = Field(
        default_factory=dict,
        description="Which input of the Epicollect5 form (its ref) gives each field of a deployment: deployment field -> input ref. (EPICOLLECT5.mapping)",
    )


class DataSettings(BaseModel):
    # None until first read/saved — resolved against default_data_dir() so
    # moving the app's documents dir (a platformdirs choice) doesn't strand
    # an old absolute path baked into settings.toml.
    dir: Optional[str] = Field(
        default=None,
        description="The data folder, where the app keeps what it makes: its collections (collections/<research project id>/<collection>/<deployment id>), reports and packages go in folders inside it, unless each has one of its own. (DATA.dir)",
    )
    collections_dir: Optional[str] = Field(
        default=None,
        description="A folder of its own for the collections, instead of the \"collections\" folder inside DATA.dir: <folder>/<research project id>/<collection>/<deployment id>. (DATA.collections_dir)",
    )
    reports_dir: Optional[str] = Field(
        default=None,
        description="A folder of its own for the reports of the validations, postvalidations and preprocessings, instead of the \"reports\" folder inside DATA.dir. (DATA.reports_dir)",
    )
    storage: str = Field(
        default="json",
        description="Where the app keeps its records — the research projects and their locations, visits, cameras and SD cards: \"json\" (files in the collections folder, the one there is for now). (DATA.storage)",
    )
    packages_dir: Optional[str] = Field(
        default=None,
        description="A folder of its own for the packages made to upload to TRAPPER, instead of the \"packages\" folder inside DATA.dir: <folder>/<research project id>/<collection>. (DATA.packages_dir)",
    )

    @field_validator("dir", "collections_dir", "reports_dir", "packages_dir")
    @classmethod
    def _absolute(cls, value: Optional[str]) -> Optional[str]:
        if value is None or not value.strip():
            return None
        if not Path(value.strip()).expanduser().is_absolute():
            raise ValueError("must be an absolute path (or start with ~)")
        return value.strip()


class ValidationSettings(BaseModel):
    """Which of the "Validate folder contents" checks the wizard shows — and
    so runs. Each looks at the folder alone, without knowing the deployment."""

    corrupted: bool = Field(default=True, description="Corrupted images. (VALIDATION.corrupted)")
    sequence: bool = Field(default=True, description="Shooting order vs. filename sequence. (VALIDATION.sequence)")
    structure: bool = Field(default=True, description="Folder structure (subdirectories). (VALIDATION.structure)")
    camera: bool = Field(default=True, description="Same camera (model and id) on every image. (VALIDATION.camera)")
    exif: bool = Field(default=True, description="Required EXIF fields (capture date, camera model and id). (VALIDATION.exif)")
    duplicates: bool = Field(default=True, description="Duplicate images (same content). (VALIDATION.duplicates)")


class PostvalidationSettings(BaseModel):
    """Which of the postvalidation checks the wizard shows — and so runs — and
    the parameters those that take one start from. They need what the wizard
    knows of the deployment: its id, collection, location and dates."""

    deployment_id: bool = Field(default=True, description="Deployment id format. (POSTVALIDATION.deployment_id)")
    collection_prefix: bool = Field(default=True, description="Deployment id starts with its collection. (POSTVALIDATION.collection_prefix)")
    collection_name: bool = Field(default=True, description="Collection name. (POSTVALIDATION.collection_name)")
    location: bool = Field(default=True, description="The id's location is the one chosen. (POSTVALIDATION.location)")
    time_range: bool = Field(default=True, description="Image dates fit the deployment. (POSTVALIDATION.time_range)")
    camera: bool = Field(default=True, description="Camera consistency. (POSTVALIDATION.camera)")
    image_count: bool = Field(default=True, description="The number of images is like the previous revisions'. (POSTVALIDATION.image_count)")
    sequence_count: bool = Field(default=True, description="The number of sequences is like the previous revisions'. (POSTVALIDATION.sequence_count)")
    sequence_length: bool = Field(default=True, description="The length of the sequences is like the previous revisions'. (POSTVALIDATION.sequence_length)")
    sd_card: bool = Field(default=True, description="The SD card is the one the visit left in the camera. (POSTVALIDATION.sd_card)")
    photo_count: bool = Field(default=True, description="The folder has the number of images the visit counted on the card. (POSTVALIDATION.photo_count)")
    sequence_gap_seconds: float = Field(
        default=60.0, gt=0, le=86400,
        description="What a sequence is: a new one starts when the gap to the previous image is at least this many seconds. (POSTVALIDATION.sequence_gap_seconds)",
    )
    min_revisions: int = Field(
        default=2, ge=1, le=50,
        description="How many previous revisions of the location the statistical checks need to have to judge — with fewer they are skipped. (POSTVALIDATION.min_revisions)",
    )
    similarity_method: Literal["median", "mean", "last", "range"] = Field(
        default="median",
        description="What this revision is compared to: the median or mean of the previous ones, the last one, or the range they span. (POSTVALIDATION.similarity_method)",
    )
    image_count_tolerance: float = Field(default=50.0, ge=0, le=1000, description="What is similar for the number of images, in percent. (POSTVALIDATION.image_count_tolerance)")
    sequence_count_tolerance: float = Field(default=50.0, ge=0, le=1000, description="What is similar for the number of sequences, in percent. (POSTVALIDATION.sequence_count_tolerance)")
    sequence_length_tolerance: float = Field(default=50.0, ge=0, le=1000, description="What is similar for the length of the sequences, in percent. (POSTVALIDATION.sequence_length_tolerance)")
    tolerance_hours: float = Field(
        default=1.0, ge=0, le=8760,
        description="Hours of leeway around the deployment's start and end when checking the image dates — the default of the tolerance the wizard asks for. (POSTVALIDATION.tolerance_hours)",
    )


class PreprocessingSettings(BaseModel):
    """What is done to the images as they are imported into their collection —
    which preprocessing steps a new run starts with, and the values they use.
    The wizard lists them before the import, and a run can still switch each off."""

    rename: bool = Field(default=True, description="Rename the images <DEPLOYMENT>__<YYYYMMDD>_<n>.<EXT>. (PREPROCESSING.rename)")
    resize: bool = Field(default=True, description="Resize the images to a width, keeping their proportions. (PREPROCESSING.resize)")
    resize_width: int = Field(
        default=2400, ge=100, le=20000,
        description="The width, in pixels, images wider than it are resized to. Smaller ones are left as they are. (PREPROCESSING.resize_width)",
    )
    metadata: bool = Field(default=True, description="Add authorship, rights and license metadata (XMP, with ExifTool). (PREPROCESSING.metadata)")
    owner: str = Field(default="", description="Who owns the images — the rights holder. (PREPROCESSING.owner)")
    publisher: str = Field(default="", description="Who publishes the images. (PREPROCESSING.publisher)")
    coverage: str = Field(
        default="", description="Where the images were taken, in the coverage text (e.g. Doñana National Park). Blank: the deployment's location. (PREPROCESSING.coverage)",
    )
    license_url: str = Field(
        default="https://creativecommons.org/licenses/by-nc/4.0/", description="The license the images are shared under. (PREPROCESSING.license_url)",
    )
    ignore_dst: bool = Field(
        default=True,
        description="Read the camera's clock as if it never changed to summer time, using the timezone's standard offset. (PREPROCESSING.ignore_dst)",
    )
    convert_to_utc: bool = Field(default=True, description="Give the capture dates (in names and metadata) in UTC. (PREPROCESSING.convert_to_utc)")

    @field_validator("owner", "publisher", "coverage", "license_url")
    @classmethod
    def _stripped(cls, value: str) -> str:
        return value.strip()


def username_from(name: str, taken: set[str] | None = None) -> str:
    """A username made from a full name — `Ana Pérez` is `ana.perez` —, one that is not among those `taken` (lower case): a number is added when it is."""
    folded = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode("ascii").lower()
    base = re.sub(r"[^a-z0-9]+", ".", folded).strip(".") or "trapper"
    username, n = base, 1
    while taken and username in taken:
        n += 1
        username = f"{base}{n}"
    return username


_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class Trapper(BaseModel):
    """One of the people who go to the field — {username, name, affiliation, email}. The people are global: they belong to no research project (what each is in a project is
    its role, which is the project's). Its `username` is what it is called in the app, as the label of an SD card is, and no two have the same."""
    username: str = Field(min_length=1, description="What the trapper is called in the app — required, and unique among the trappers (whatever its case), as the label of an SD card is.")
    name: str = Field(min_length=1, description="The trapper's full name, written as it should be on a visit.")
    affiliation: Optional[str] = Field(default=None, description="Where the trapper works, free text.")
    email: Optional[str] = Field(default=None, description="The trapper's email address — optional.")
    status: Literal["active", "inactive", "archived"] = Field(default="active", description="Whether the trapper still goes to the field: an inactive one is no longer suggested, and an archived one is out of use for good (it never goes back).")
    trapper_pk: Optional[int] = Field(default=None, description="Its id in TRAPPER, when it was taken from there — such a trapper can only be seen here.")
    id: Optional[str] = Field(default=None, description="Its internal id — a UUID the app generates when it is kept, that never changes and is never typed: what the records that refer to it point to.")
    created_at: Optional[str] = Field(default=None, description="When it was kept here (ISO 8601, UTC, with a Z): written by the app, never typed.")
    updated_at: Optional[str] = Field(default=None, description="When it was last changed (ISO 8601, UTC, with a Z): written by the app, never typed.")
    deleted_at: Optional[str] = Field(default=None, description="When it was removed (ISO 8601, UTC, with a Z), if it was: it is no longer listed, but it is kept — nothing is deleted.")

    @field_validator("username")
    @classmethod
    def _username(cls, value: str) -> str:
        value = value.strip()
        if not value or re.search(r"\s", value):
            raise ValueError("can't be blank or have spaces")
        return value

    @field_validator("email")
    @classmethod
    def _email_address(cls, value: Optional[str]) -> Optional[str]:
        value = (value or "").strip()
        if value and not _EMAIL.match(value):
            raise ValueError("is not an email address")
        return value or None

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        return " ".join(value.split())

    @field_validator("affiliation")
    @classmethod
    def _affiliation(cls, value: Optional[str]) -> Optional[str]:
        return (value or "").strip() or None


def _tidy(value: Optional[str]) -> Optional[str]:
    return (" ".join(value.split()) if value else "") or None


def _blank_date(value):
    """A date left blank is no date."""
    return None if isinstance(value, str) and not value.strip() else value


def migrate_gear(data):
    """A camera or an SD card as it was kept before: "retired" is archived, and "stolen", "lost" and "broken" are archived with that reason. An archived one has a reason."""
    if not isinstance(data, dict):
        return data
    data = dict(data)
    status = data.get("status")
    if status in ("stolen", "lost", "broken"):
        data["status"], data["archive_reason"] = "archived", data.get("archive_reason") or status
    elif status == "retired":
        data["status"] = "archived"
    if data.get("status") == "archived" and not data.get("archive_reason"):
        data["archive_reason"] = "other"
    return data


TRAPPER_ROLES = ("contact", "principalInvestigator", "rightsHolder", "publisher", "contributor")


class TrapperRole(BaseModel):
    """What a trapper is in a research project — one of the roles of a contributor in Camtrap DP (contributors.role)."""
    research_project: str = Field(min_length=1, description="The acronym of the research project.")
    trapper: str = Field(min_length=1, description="The name of the trapper, as it is in the list of trappers.")
    role: Literal["contact", "principalInvestigator", "rightsHolder", "publisher", "contributor"] = Field(default="contributor", description="Its role in the research project.")
    id: Optional[str] = Field(default=None, description="Its internal id — a UUID the app generates when it is kept, that never changes and is never typed: what the records that refer to it point to.")
    created_at: Optional[str] = Field(default=None, description="When it was kept here (ISO 8601, UTC, with a Z): written by the app, never typed.")
    updated_at: Optional[str] = Field(default=None, description="When it was last changed (ISO 8601, UTC, with a Z): written by the app, never typed.")
    deleted_at: Optional[str] = Field(default=None, description="When it was removed (ISO 8601, UTC, with a Z), if it was: it is no longer listed, but it is kept — nothing is deleted.")

    @field_validator("trapper")
    @classmethod
    def _trapper(cls, value: str) -> str:
        return " ".join(value.split())


class SdCard(BaseModel):
    """One of the SD cards of the field work — its label, as it is written on it, and optionally its brand, its capacity and the
    day it was put into production."""
    label: str = Field(min_length=1, description="What the card is called — its number or the label on it (e.g. A12).")
    brand: Optional[str] = Field(default=None, description="Who makes it, free text (e.g. SanDisk).")
    capacity: Optional[str] = Field(default=None, description="How much it holds, free text (e.g. 64 GB).")
    in_service: Optional[date] = Field(default=None, description="The day it was put into production.")
    research_project: Optional[str] = Field(default=None, description="The acronym of the research project it belongs to: every one belongs to one (a card or camera without it, as older settings had, waits to be assigned).")
    status: Literal["planned", "ready", "active", "archived"] = Field(default="ready", description="Planned: only in Settings, not in the app. Ready: available, not in the field yet. Active: in use. Archived: out of use for good (see archive_reason).")
    archive_reason: Optional[Literal["lost", "stolen", "broken", "other"]] = Field(default=None, description="Why it was archived; other when it is none of the others (the status note says it).")
    status_date: Optional[date] = Field(default=None, description="The day it stopped being active.")
    status_note: Optional[str] = Field(default=None, description="Why, free text.")
    id: Optional[str] = Field(default=None, description="Its internal id — a UUID the app generates when it is kept, that never changes and is never typed: what the records that refer to it point to.")
    created_at: Optional[str] = Field(default=None, description="When it was kept here (ISO 8601, UTC, with a Z): written by the app, never typed.")
    updated_at: Optional[str] = Field(default=None, description="When it was last changed (ISO 8601, UTC, with a Z): written by the app, never typed.")
    deleted_at: Optional[str] = Field(default=None, description="When it was removed (ISO 8601, UTC, with a Z), if it was: it is no longer listed, but it is kept — nothing is deleted.")

    _blank_in_service = field_validator("in_service", mode="before")(_blank_date)
    _blank_status_date = field_validator("status_date", mode="before")(_blank_date)
    _research_project = field_validator("research_project")(lambda cls, v: _tidy(v))
    _status_note = field_validator("status_note")(lambda cls, v: _tidy(v))
    _migrated = model_validator(mode="before")(lambda cls, data: migrate_gear(data))

    @field_validator("brand")
    @classmethod
    def _brand(cls, value: Optional[str]) -> Optional[str]:
        return _tidy(value)

    @field_validator("label")
    @classmethod
    def _label(cls, value: str) -> str:
        return " ".join(value.split())

    @field_validator("capacity")
    @classmethod
    def _capacity(cls, value: Optional[str]) -> Optional[str]:
        return _tidy(value)


class Camera(BaseModel):
    """One of the camera traps — its label (what it is called), optionally its id (the serial number) and its model, as Camtrap DP names
    them, and the day it was put into production."""
    label: str = Field(min_length=1, description="What the camera is called — the name it goes by in the field.")
    camera_id: Optional[str] = Field(default=None, description="The camera's id — its serial number. (cameraID)")
    camera_model: Optional[str] = Field(default=None, description="Manufacturer and model, written as manufacturer-model. (cameraModel)")
    connectivity: Optional[Literal["none", "4g", "5g"]] = Field(default=None, description="The mobile network the camera sends its images through: none when it does not.")
    power_source: Optional[Literal["cells", "battery"]] = Field(default=None, description="What it runs on: cells (AA, AAA… the ones that are changed) or a battery.")
    battery_removable: Optional[Literal["yes", "no"]] = Field(default=None, description="Whether the battery can be taken out of the camera: only said of a battery, as cells are always taken out to be changed.")
    in_service: Optional[date] = Field(default=None, description="The day it was put into production.")
    research_project: Optional[str] = Field(default=None, description="The acronym of the research project it belongs to: every one belongs to one (a card or camera without it, as older settings had, waits to be assigned).")
    status: Literal["planned", "ready", "active", "archived"] = Field(default="ready", description="Planned: only in Settings, not in the app. Ready: available, not in the field yet. Active: in use. Archived: out of use for good (see archive_reason).")
    archive_reason: Optional[Literal["lost", "stolen", "broken", "other"]] = Field(default=None, description="Why it was archived; other when it is none of the others (the status note says it).")
    status_date: Optional[date] = Field(default=None, description="The day it stopped being active.")
    status_note: Optional[str] = Field(default=None, description="Why, free text.")
    id: Optional[str] = Field(default=None, description="Its internal id — a UUID the app generates when it is kept, that never changes and is never typed: what the records that refer to it point to.")
    created_at: Optional[str] = Field(default=None, description="When it was kept here (ISO 8601, UTC, with a Z): written by the app, never typed.")
    updated_at: Optional[str] = Field(default=None, description="When it was last changed (ISO 8601, UTC, with a Z): written by the app, never typed.")
    deleted_at: Optional[str] = Field(default=None, description="When it was removed (ISO 8601, UTC, with a Z), if it was: it is no longer listed, but it is kept — nothing is deleted.")

    _blank_in_service = field_validator("in_service", mode="before")(_blank_date)
    _blank_status_date = field_validator("status_date", mode="before")(_blank_date)
    _research_project = field_validator("research_project")(lambda cls, v: _tidy(v))
    _status_note = field_validator("status_note")(lambda cls, v: _tidy(v))
    _migrated = model_validator(mode="before")(lambda cls, data: migrate_gear(data))

    @model_validator(mode="after")
    def _removable_only_of_a_battery(self) -> "Camera":
        # cells are always taken out to be changed: only a battery says whether it can be
        if self.power_source != "battery":
            self.battery_removable = None
        return self

    @model_validator(mode="before")
    @classmethod
    def _label_from_id(cls, data):
        """A camera kept before it had a label is called by its id."""
        if isinstance(data, dict) and not str(data.get("label") or "").strip() and str(data.get("camera_id") or "").strip():
            return {**data, "label": data["camera_id"]}
        return data

    @field_validator("label")
    @classmethod
    def _label(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("A camera needs a label.")
        return value

    @field_validator("camera_id")
    @classmethod
    def _camera_id(cls, value: Optional[str]) -> Optional[str]:
        return _tidy(value)

    @field_validator("camera_model")
    @classmethod
    def _camera_model(cls, value: Optional[str]) -> Optional[str]:
        return _tidy(value)


def _unique(items: list, key: str, scope: str | None = None) -> list:
    """What is listed once by its `key` — as written: `7b` and `7B` are two —, within its `scope` (whatever its case) when it has one, in the order given; the blank ones go."""
    kept: dict[tuple, object] = {}
    for item in items:
        name = getattr(item, key)
        if name:
            kept.setdefault(((getattr(item, scope) or "").lower() if scope else "", name), item)
    return list(kept.values())


class FieldworkSettings(BaseModel):
    trappers: list[Trapper] = Field(
        default_factory=list,
        description="The people who go to the field — suggested when a visit is registered, as who went. (FIELDWORK.trappers)",
    )
    sd_cards: list[SdCard] = Field(default_factory=list, description="The SD cards of the field work. (FIELDWORK.sd_cards)")
    cameras: list[Camera] = Field(default_factory=list, description="The camera traps of the field work. (FIELDWORK.cameras)")
    roles: list[TrapperRole] = Field(default_factory=list, description="What each trapper is in each research project: a trapper can have several in the same project, one entry for each. (FIELDWORK.roles)")

    @field_validator("trappers", mode="before")
    @classmethod
    def _from_names(cls, trappers, info: ValidationInfo):
        """A plain name is a trapper without affiliation. What was kept before the trappers had a username (settings read from the file or from an old backup, validated with
        `context={"migrate": True}`) gets one made from its name — never the same as another's; what comes from a client does not: it has to say it."""
        if not isinstance(trappers, list):
            return trappers
        trappers = [{"name": t} if isinstance(t, str) else t for t in trappers]
        if (info.context or {}).get("migrate"):
            taken = {str(t.get("username")).strip().lower() for t in trappers if isinstance(t, dict) and t.get("username")}
            migrated = []
            for t in trappers:
                if isinstance(t, dict) and not t.get("username") and t.get("name"):
                    username = username_from(str(t["name"]), taken)
                    taken.add(username)
                    t = {**t, "username": username}
                if isinstance(t, dict) and not t.get("id") and t.get("username"):   # kept before the ids existed: the same one whenever it is read
                    t = {**t, "id": ids.legacy_id("trapper", t["username"])}
                migrated.append(t)
            trappers = migrated
        return trappers

    @field_validator("trappers")
    @classmethod
    def _unique_trappers(cls, trappers: list[Trapper]) -> list[Trapper]:
        # a full name is listed once among those that were not deleted (a deleted one is kept as it is); a username is the trapper's own, and only one has it
        alive = {id(t) for t in _unique([t for t in trappers if not t.deleted_at], "name")}
        trappers = [t for t in trappers if t.deleted_at or id(t) in alive]
        seen: dict[str, str] = {}
        for t in trappers:
            # a username is the account of the trapper, an email: it is read whatever its case, while the full name counts it
            if t.username.lower() in seen:
                raise ValueError(f"The username '{t.username}' is used by more than one trapper ({seen[t.username.lower()]} and {t.name}): it is unique.")
            seen[t.username.lower()] = t.name
        return trappers

    @field_validator("roles")
    @classmethod
    def _unique_roles(cls, roles: list[TrapperRole]) -> list[TrapperRole]:
        kept: dict[tuple, TrapperRole] = {}
        for r in roles:
            kept.setdefault((r.research_project.lower(), r.trapper.lower(), r.role), r)
        return list(kept.values())

    @field_validator("sd_cards")
    @classmethod
    def _unique_sd_cards(cls, cards: list[SdCard]) -> list[SdCard]:
        return _unique(cards, "label", "research_project")

    @field_validator("cameras")
    @classmethod
    def _unique_cameras(cls, cameras: list[Camera]) -> list[Camera]:
        return _unique(cameras, "label", "research_project")


class FieldlogSettings(BaseModel):
    """Field records: how the visits of a field trip are read from the file of the field app (an Epicollect download) and what is made of them
    (see services.visits_csv and services.visit_deployments)."""

    time_source: Literal["created_at", "hour"] = Field(
        default="created_at",
        description="When a visit happened: created_at, the time its entry was created (UTC); or hour, the date and the hour typed in the form (the wall clock of its location). (FIELDLOG.time_source)",
    )
    keep_seconds: bool = Field(
        default=False, description="Keep the seconds of the visits in the deployments' start and end written in the logs; off, they are cut to the minute. (FIELDLOG.keep_seconds)",
    )


class Settings(BaseModel):
    GENERAL: GeneralSettings = Field(default_factory=GeneralSettings)
    TRAPPER: TrapperSettings = Field(default_factory=TrapperSettings)
    EPICOLLECT5: Epicollect5Settings = Field(default_factory=Epicollect5Settings)
    AGOUTI: AgoutiSettings = Field(default_factory=AgoutiSettings)
    EPICOLLECTCSV: EpicollectCsvSettings = Field(default_factory=EpicollectCsvSettings)
    DATA: DataSettings = Field(default_factory=DataSettings)
    VALIDATION: ValidationSettings = Field(default_factory=ValidationSettings)
    POSTVALIDATION: PostvalidationSettings = Field(default_factory=PostvalidationSettings)
    PREPROCESSING: PreprocessingSettings = Field(default_factory=PreprocessingSettings)
    FIELDWORK: FieldworkSettings = Field(default_factory=FieldworkSettings)
    FIELDLOG: FieldlogSettings = Field(default_factory=FieldlogSettings)


class ConfigInfo(BaseModel):
    """One settings file the user can switch to — see list_configs."""
    id: str
    name: str
    path: str
    active: bool


def _config_path(config_id: str) -> Path:
    return DEFAULT_CONFIG_FILE if config_id == DEFAULT_CONFIG_ID else CONFIGS_DIR / f"{config_id}.toml"


def _config_ids() -> list[str]:
    extra = sorted(p.stem for p in CONFIGS_DIR.glob("*.toml")) if CONFIGS_DIR.is_dir() else []
    return [DEFAULT_CONFIG_ID, *(config_id for config_id in extra if config_id != DEFAULT_CONFIG_ID)]


def active_config_id() -> str:
    """The id of the config in use: the one ACTIVE_CONFIG_POINTER names, or
    the default one if it's missing, empty or names a file that's gone."""
    try:
        config_id = ACTIVE_CONFIG_POINTER.read_text(encoding="utf-8").strip()
    except OSError:
        return DEFAULT_CONFIG_ID
    return config_id if config_id in _config_ids() else DEFAULT_CONFIG_ID


def active_config_file() -> Path:
    """The settings file load_settings()/save_settings() work on when not
    given one explicitly."""
    return _config_path(active_config_id())


def list_configs() -> list[ConfigInfo]:
    active = active_config_id()
    return [
        ConfigInfo(
            id=config_id, name="Default config" if config_id == DEFAULT_CONFIG_ID else config_id,
            path=str(_config_path(config_id)), active=config_id == active,
        )
        for config_id in _config_ids()
    ]


def create_config(name: str) -> str:
    """Writes a new config file with the default values — named after `name`
    (made file-name safe, and unique among the existing ones) — and returns
    its id. It doesn't become the active one.

    Raises:
        ValueError: if `name` has no letters or digits to name a file after.
    """
    base = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    if not base:
        raise ValueError("A config needs a name with at least one letter or digit.")
    existing = set(_config_ids())
    config_id, suffix = base, 2
    while config_id in existing:
        config_id, suffix = f"{base}-{suffix}", suffix + 1
    CONFIGS_DIR.mkdir(parents=True, exist_ok=True)
    loaders.toml_loader.write(str(_config_path(config_id)), Settings().model_dump(mode="json", exclude_none=True), merge=False)
    return config_id


def set_active_config(config_id: str) -> None:
    """Raises:
        KeyError: if there's no config with that id.
    """
    if config_id not in _config_ids():
        raise KeyError(config_id)
    ACTIVE_CONFIG_POINTER.parent.mkdir(parents=True, exist_ok=True)
    ACTIVE_CONFIG_POINTER.write_text(config_id, encoding="utf-8")


def config_file_for(config_id: str) -> Path:
    """Raises:
        KeyError: if there's no config with that id.
    """
    if config_id not in _config_ids():
        raise KeyError(config_id)
    return _config_path(config_id)


def _ensure_config_file(config_file: Path) -> None:
    if config_file.exists():
        return
    config_file.parent.mkdir(parents=True, exist_ok=True)
    loaders.toml_loader.write(str(config_file), Settings().model_dump(mode="json", exclude_none=True), merge=False)


def load_settings(config_file: Optional[Path] = None) -> Settings:
    config_file = config_file or active_config_file()
    _ensure_config_file(config_file)
    dynaconf_settings = Dynaconf(settings_files=[str(config_file)], envvar_prefix="WILDINTEL_UPLOADER")
    return Settings.model_validate(dynaconf_settings.to_dict(), context={"migrate": True})   # what was kept before a field existed gets it


def save_settings(settings: Settings, config_file: Optional[Path] = None) -> None:
    config_file = config_file or active_config_file()
    config_file.parent.mkdir(parents=True, exist_ok=True)
    # Written to a file of its own and put in place at once: two saves at the same time (or a read in the middle of one) never leave a
    # half-written settings file, which the app could not read again.
    fd, tmp = tempfile.mkstemp(dir=config_file.parent, prefix=f".{config_file.name}.", suffix=".tmp")
    os.close(fd)
    try:
        loaders.toml_loader.write(tmp, settings.model_dump(mode="json", exclude_none=True), merge=False)
        os.replace(tmp, config_file)
    finally:
        Path(tmp).unlink(missing_ok=True)


def workers(settings: Settings | None = None) -> int:
    """How many images are validated or preprocessed at once — GENERAL.workers."""
    return (settings or load_settings()).GENERAL.workers


def max_zip_mb(settings: Settings | None = None) -> int:
    """The largest zip an upload makes, in megabytes — TRAPPER.max_zip_mb."""
    return (settings or load_settings()).TRAPPER.max_zip_mb


def data_dir(settings: Settings | None = None) -> Path:
    """The effective data directory — DATA.dir if set, else the default."""
    settings = settings or load_settings()
    return Path(settings.DATA.dir).expanduser() if settings.DATA.dir else default_data_dir()


def collections_dir(settings: Settings | None = None) -> Path:
    """Where every collection is kept locally before anything is uploaded:
    DATA.collections_dir if set, else <data directory>/collections — then
    <research project id>/<collection, e.g. R0003>/<deployment id>/ (see
    services.deployment_import_service)."""
    settings = settings or load_settings()
    custom = settings.DATA.collections_dir
    return Path(custom).expanduser() if custom else data_dir(settings) / "collections"


def reports_dir(settings: Settings | None = None) -> Path:
    """Where the reports of the validations, postvalidations and preprocessings are kept:
    DATA.reports_dir if set, else <data directory>/reports (see services.report_service)."""
    settings = settings or load_settings()
    custom = settings.DATA.reports_dir
    return Path(custom).expanduser() if custom else data_dir(settings) / "reports"


def packages_dir(settings: Settings | None = None) -> Path:
    """Where the packages made to upload to Trapper are written: DATA.packages_dir if set, else
    <data directory>/packages — then <research project id>/<collection> (see services.trapper_upload_service)."""
    settings = settings or load_settings()
    custom = settings.DATA.packages_dir
    return Path(custom).expanduser() if custom else data_dir(settings) / "packages"
