"""wildintel-uploader's own settings.toml — Trapper connection defaults and
where imported deployments are organized locally, kept in the user's config
directory (editable on the app's settings page).

Same approach as wildintel-zooniverse's own core/config.py: a Pydantic model
validated from what Dynaconf reads, written back with Dynaconf's TOML
loader. Created with defaults the first time it's read."""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Literal, Optional

import platformdirs
from dynaconf import Dynaconf, loaders
from pydantic import BaseModel, Field, field_validator

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
    """Where the app's log files go — next to settings.toml (see
    logging_setup)."""
    return DEFAULT_CONFIG_FILE.parent / "logs"


def get_sessions_dir() -> Path:
    """Where in-progress and interrupted wizard runs persist — see
    services.session_store."""
    return get_app_documents_dir() / "sessions"


def default_data_dir() -> Path:
    """The folder where the app keeps the images — <documents>/wildintel-uploader.
    Its collections go in a "collections" folder inside it (see
    collections_dir). DATA.dir can override it."""
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


class TrapperSettings(BaseModel):
    base_url: Optional[str] = Field(default=None, description="Trapper server URL. (TRAPPER.base_url)")
    user_name: Optional[str] = Field(default=None, description="Trapper username (its email — the import form only accepts that). (TRAPPER.user_name)")
    user_password: Optional[str] = Field(
        default=None, description="Trapper password. (TRAPPER.user_password)", json_schema_extra={"secret": True},
    )
    max_zip_mb: int = Field(
        default=500, ge=1, le=5000,
        description="A deployment's images go up in zips of at most this many megabytes, each with its own yaml. (TRAPPER.max_zip_mb)",
    )


class Epicollect5Settings(BaseModel):
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
        description="The folder where the app keeps the images — its collections go in a \"collections\" folder inside it, before they are uploaded: collections/<research project id>/<collection>/<deployment id>. (DATA.dir)",
    )


    @field_validator("dir")
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


class Settings(BaseModel):
    GENERAL: GeneralSettings = Field(default_factory=GeneralSettings)
    TRAPPER: TrapperSettings = Field(default_factory=TrapperSettings)
    EPICOLLECT5: Epicollect5Settings = Field(default_factory=Epicollect5Settings)
    DATA: DataSettings = Field(default_factory=DataSettings)
    VALIDATION: ValidationSettings = Field(default_factory=ValidationSettings)
    POSTVALIDATION: PostvalidationSettings = Field(default_factory=PostvalidationSettings)
    PREPROCESSING: PreprocessingSettings = Field(default_factory=PreprocessingSettings)


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
    return Settings.model_validate(dynaconf_settings.to_dict())


def save_settings(settings: Settings, config_file: Optional[Path] = None) -> None:
    config_file = config_file or active_config_file()
    config_file.parent.mkdir(parents=True, exist_ok=True)
    loaders.toml_loader.write(str(config_file), settings.model_dump(mode="json", exclude_none=True), merge=False)


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
    <data directory>/collections/<research project id>/<collection, e.g.
    R0003>/<deployment id>/ (see services.deployment_import_service)."""
    return data_dir(settings) / "collections"


def reports_dir(settings: Settings | None = None) -> Path:
    """Where the reports of the validations, postvalidations and preprocessings are kept:
    <data directory>/reports/ (see services.report_service)."""
    return data_dir(settings) / "reports"
