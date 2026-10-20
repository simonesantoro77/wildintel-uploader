"""Request/response models for the web API."""
from __future__ import annotations

import re
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class TrapperCredentials(BaseModel):
    # Any of these left blank falls back to settings.toml (see
    # services.trapper_service.resolve_credentials).
    url: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None


class ClassificationProjectsRequest(TrapperCredentials):
    research_project_pk: int


class LocationsRequest(TrapperCredentials):
    research_project_pk: int


class DeploymentsRequest(TrapperCredentials):
    research_project_pk: int


class UploadCollectionsRequest(BaseModel):
    """The collections kept for a research project, to choose what to upload from."""

    research_project_id: str = Field(min_length=1)


class RepairRequest(BaseModel):
    """One deployment kept in the collections folder, to look at or to repair."""

    research_project_id: str = Field(min_length=1)
    collection: str = Field(pattern=r"^R\d{4}(_.+)?$")
    deployment_id: str = Field(pattern=r"^R\d{4}-.+$")


class UploadDeploymentRequest(TrapperCredentials):
    """Upload one deployment of a collection kept locally to Trapper."""

    research_project_id: str = Field(min_length=1)
    collection: str = Field(pattern=r"^R\d{4}(_.+)?$")
    deployment_id: str = Field(pattern=r"^R\d{4}-.+$")
    # "upload" sends it; "dry_run" says what that would do and changes nothing; "generate" only writes the
    # files (the zips, the yamls and the collection's deployments csv) and leaves them.
    mode: Literal["upload", "dry_run", "generate"] = "upload"
    # The classification project the collection goes to — optional when the research project has only one.
    classification_project_pk: Optional[int] = None
    # With "upload": take the package files away once they are up (the zips, the yamls and the deployment's row of the
    # deployments csv). Left as they are, they stay in the packages folder, as "generate" leaves them.
    delete_files: bool = False


class AccessCheckRequest(TrapperCredentials):
    """Check the account can do what uploading a collection's deployments needs, changing nothing."""

    research_project_id: str = Field(min_length=1)
    collection: Optional[str] = Field(default=None, pattern=r"^R\d{4}(_.+)?$")
    # The deployments whose locations are looked for in Trapper.
    deployment_ids: list[str] = Field(default_factory=list)
    classification_project_pk: Optional[int] = None


class UploadClassificationProjectsRequest(TrapperCredentials):
    """The classification projects of a research project kept locally, as Trapper has them."""

    research_project_id: str = Field(min_length=1)


class ScanFolderRequest(BaseModel):
    path: str


class BrowseFolderRequest(BaseModel):
    # None uses the picker's own default title.
    title: Optional[str] = None


# The checks validate-images/validate-deployment can run — see
# services.deployment_import_service's own IMAGE_CHECKS/DEPLOYMENT_CHECKS.
ImageCheck = Literal["corrupted", "sequence", "structure", "camera", "exif", "duplicates"]
DeploymentCheck = Literal[
    "deployment_id", "collection_prefix", "collection_name", "location", "time_range", "camera",
    "image_count", "sequence_count", "sequence_length",
]


class ValidateImagesRequest(BaseModel):
    path: str
    # None runs every check.
    checks: Optional[list[ImageCheck]] = None


# Camtrap DP's own "featureType" enum — deployments-table-schema.json.
FeatureType = Literal[
    "roadPaved", "roadDirt", "trailHiking", "trailGame", "roadUnderpass", "roadOverpass", "roadBridge",
    "culvert", "burrow", "nestSite", "carcass", "waterSource", "fruitingTree",
]


class DeploymentFields(BaseModel):
    """One row of the Camtrap Data Package "deployments" table — see
    https://camtrap-dp.tdwg.org (deployments-table-schema.json), whose field
    names and constraints this mirrors (deploymentID -> deployment_id, etc.):
    deploymentID, latitude, longitude, deploymentStart and deploymentEnd are
    required; the numeric ranges, integer types and the featureType enum
    apply; and cameraHeight/cameraDepth are mutually exclusive. The two dates
    are ISO 8601 with a timezone designator (Z or ±hh:mm)."""

    deployment_id: str = Field(min_length=1)
    location_id: Optional[str] = None
    location_name: Optional[str] = None

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    coordinate_uncertainty: Optional[int] = Field(default=None, ge=1)

    # ISO 8601 with timezone designator — deploymentStart/deploymentEnd.
    start_date: str
    end_date: str

    setup_by: Optional[str] = None
    camera_id: Optional[str] = None
    camera_model: Optional[str] = None
    camera_interval: Optional[int] = Field(default=None, ge=0)  # cameraDelay
    # cameraHeight and cameraDepth are mutually exclusive in the standard.
    camera_height: Optional[float] = Field(default=None, ge=0)
    camera_depth: Optional[float] = Field(default=None, ge=0)
    camera_tilt: Optional[int] = Field(default=None, ge=-90, le=90)
    camera_heading: Optional[int] = Field(default=None, ge=0, le=360)
    detection_distance: Optional[float] = Field(default=None, ge=0)

    timestamp_issues: Optional[bool] = None
    bait_use: Optional[bool] = None
    feature_type: Optional[FeatureType] = None
    habitat: Optional[str] = None
    # deploymentGroups — the standard's single field for what Trapper keeps
    # as two (session/array), e.g. "season:winter 2020 | grid:A1".
    deployment_groups: Optional[str] = None
    comments: Optional[str] = None
    tags: list[str] = Field(default_factory=list)

    @field_validator("start_date", "end_date")
    @classmethod
    def _iso_8601(cls, value: str) -> str:
        if not _ISO_8601.fullmatch(value):
            raise ValueError("must be an ISO 8601 date and time with timezone designator: YYYY-MM-DDThh:mm:ssZ or YYYY-MM-DDThh:mm:ss±hh:mm")
        try:
            datetime.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("is not a valid date and time") from exc
        return value

    @model_validator(mode="after")
    def _starts_before_it_ends(self) -> "DeploymentFields":
        # Both dates are known to be valid ISO 8601 with a designator by now.
        if datetime.fromisoformat(self.start_date) >= datetime.fromisoformat(self.end_date):
            raise ValueError("deploymentStart must be earlier than deploymentEnd")
        return self

    @model_validator(mode="after")
    def _height_or_depth(self) -> "DeploymentFields":
        if self.camera_height is not None and self.camera_depth is not None:
            raise ValueError("camera_height and camera_depth are mutually exclusive — set only one")
        return self


_ISO_8601 = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})")


class ExistingDeploymentsRequest(BaseModel):
    research_project_id: str = Field(min_length=1)
    deployment_ids: list[str] = Field(min_length=1, max_length=1000)


class PreviousDeploymentsRequest(BaseModel):
    research_project_id: str = Field(min_length=1)
    deployment_ids: list[str] = Field(min_length=1, max_length=1000)


class NextRevisionRequest(BaseModel):
    research_project_id: str = Field(min_length=1)
    location_id: str = Field(min_length=1)


class StatisticsParams(BaseModel):
    """What the statistical checks mean by a sequence and by similar (see services.statistics_service)."""

    # A sequence starts when the gap to the previous image is at least this many seconds.
    sequence_gap_seconds: float = Field(default=60.0, gt=0, le=86400)
    # How many previous revisions of the location are needed to judge at all.
    min_revisions: int = Field(default=2, ge=1, le=50)
    method: Literal["median", "mean", "last", "range"] = "median"
    # What is similar, in percent, for each statistic.
    image_count_tolerance: float = Field(default=50.0, ge=0, le=1000)
    sequence_count_tolerance: float = Field(default=50.0, ge=0, le=1000)
    sequence_length_tolerance: float = Field(default=50.0, ge=0, le=1000)


class ValidateDeploymentRequest(BaseModel):
    """Checks a scanned folder's images against a deployment's own declared
    fields — run once the deployment (new or existing) is known."""

    path: str
    deployment: DeploymentFields
    # None runs every check.
    checks: Optional[list[DeploymentCheck]] = None
    # The collection the deployment goes in, when it has a folder of its own (the
    # "Local folder" destination: its name). None for a Trapper deployment, whose
    # collection is the one its id names.
    collection_name: Optional[str] = None
    # The location chosen as where the images were taken, to compare the id's with.
    expected_location_id: Optional[str] = None
    # Hours of leeway around the deployment's start and end for the images' dates.
    tolerance_hours: float = Field(default=1.0, ge=0)
    # The research project whose collections hold the previous revisions of the location.
    research_project_id: Optional[str] = None
    statistics: StatisticsParams = Field(default_factory=StatisticsParams)


class CheckCollectionRequest(BaseModel):
    path: str


class ResearchProjectRecord(BaseModel):
    """A research project kept in the collections folder — the fields of
    Trapper's own "Add research project" form, its choice fields holding
    Trapper's option numbers. The acronym names its folder."""

    name: str = Field(min_length=1, max_length=255)
    acronym: str = Field(min_length=3, max_length=10, pattern=r"^[0-9A-Za-z][0-9A-Za-z_.-]*$")
    sampling_design: int = Field(default=1, ge=1, le=6)
    sensor_method: int = Field(default=1, ge=1, le=3)
    animal_types: int = Field(default=1, ge=1, le=3)
    bait_use: int = Field(default=1, ge=1, le=6)
    event_interval: int = Field(default=0, ge=0)
    keywords: str = ""
    abstract: str = Field(default="", max_length=2000)
    methods: str = Field(default="", max_length=2000)
    description: str = Field(default="", max_length=2000)
    # Set when it was filled in from Trapper — to find its locations there later.
    trapper_pk: Optional[int] = None


class LocationRecord(BaseModel):
    """A location of a research project kept in the collections folder."""

    location_id: str = Field(min_length=1, max_length=100)
    name: Optional[str] = None
    # IANA timezone, when known, and whether its cameras ignore summer time. Both belong to the location — never to a
    # deployment: every deployment there uses them, and Trapper only accepts a package that declares the same.
    timezone: Optional[str] = None
    ignore_dst: Optional[bool] = None
    # Where it is — WGS84 decimal degrees, as in Camtrap DP's deployments table.
    latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180)
    coordinate_uncertainty: Optional[int] = Field(default=None, ge=1)
    trapper_pk: Optional[int] = None

    @field_validator("timezone")
    @classmethod
    def _known_timezone(cls, value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("is not a known IANA timezone") from exc
        return value


class LocalLocationsRequest(BaseModel):
    research_project_id: str = Field(min_length=1)


class SaveLocationRequest(LocalLocationsRequest):
    location: LocationRecord


class UpdateLocationRequest(LocalLocationsRequest):
    """Change the timezone and/or summer-time setting of a location already kept — the fields left out stay as they are."""

    location_id: str = Field(min_length=1)
    timezone: Optional[str] = None
    ignore_dst: Optional[bool] = None

    @field_validator("timezone")
    @classmethod
    def _known_timezone(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("is not a known IANA timezone") from exc
        return value


class TimestampLogRequest(BaseModel):
    """Put a deployment's start and end in its collection's FileTimestampLog."""

    research_project_id: str = Field(min_length=1)
    deployment: DeploymentFields


class CollectionPathRequest(BaseModel):
    """Where a deployment's collection is kept locally by default."""

    research_project_id: str = Field(min_length=1)
    deployment_id: str = Field(min_length=1)


class PreprocessingRequest(BaseModel):
    """What to do to the images as they are imported (see services.preprocessing_service)."""

    rename: bool = True
    resize: bool = True
    resize_width: int = Field(default=2400, ge=100, le=20000)
    metadata: bool = True
    owner: str = ""
    publisher: str = ""
    coverage: str = ""
    license_url: str = "https://creativecommons.org/licenses/by-nc/4.0/"
    # The research project's name, for the creator metadata.
    research_project: str = ""
    # The timezone and summer-time setting the dates are read in are the location's, kept with it: not asked here.
    convert_to_utc: bool = True


class ImportLocalRequest(BaseModel):
    """Organizes a deployment into a local collection folder — no Trapper
    account involved (see services.local_folder_service)."""

    source_dir: str = Field(min_length=1)
    collection_dir: str = Field(min_length=1)
    # Recorded in the collection's own metadata — None when reusing an
    # existing collection that already has one.
    collection_name: Optional[str] = None
    deployment: DeploymentFields
    # None copies the images as they are; given, they are preprocessed as it says.
    preprocessing: Optional[PreprocessingRequest] = None


class ImportDeploymentRequest(TrapperCredentials):
    research_project_pk: int
    # Names the research project's folder in the local collections folder
    # (its acronym, or its pk when it has none).
    research_project_id: str = Field(min_length=1)
    classification_project_pk: Optional[int] = None
    # The folder scanned in the "scan-folder" step — copied into the app's
    # organized data directory before Trapper is told about the deployment.
    source_dir: str = Field(min_length=1)
    deployment: DeploymentFields
    # The timezone and summer-time setting it is registered with are the location's, kept with it: not asked here.
    # "register" collides with abc.ABCMeta.register, which pydantic warns
    # about — hence the longer name.
    register_deployment: bool = True


# ── Wizard sessions (see services.session_store) ──────────────────────────


class SelectedResearchProject(BaseModel):
    pk: int
    name: str
    acronym: Optional[str] = None


class SelectedClassificationProject(BaseModel):
    pk: int
    name: str


class SelectedLocation(BaseModel):
    pk: int
    location_id: str
    name: Optional[str] = None
    timezone: Optional[str] = None


class DeploymentSelection(BaseModel):
    """How the deployment is identified for this run — kept in its session
    so the resume screen can show it without reconnecting to Trapper.
    Two independent choices:

    destination — "trapper": registered in (or found in) a Trapper
    instance. "local": organized into a local collection folder instead,
    with no Trapper account involved at all.

    mode — "existing": the deployment already exists (in Trapper, or
    already organized in the chosen local collection) and was found rather
    than filled in — its own fields (including location) come from there
    (see SaveDetailsRequest), so classification_project/location aren't
    collected here. "new": it's being created for the first time, so they
    are.

    research_project/classification_project/location only apply to
    destination "trapper"; collection_dir/collection_name only to "local"."""

    destination: Literal["trapper", "local"]
    mode: Literal["new", "existing"]
    research_project: Optional[SelectedResearchProject] = None
    classification_project: Optional[SelectedClassificationProject] = None
    location: Optional[SelectedLocation] = None
    collection_dir: Optional[str] = None
    collection_name: Optional[str] = None


class SaveSelectionRequest(BaseModel):
    task_id: str
    selection: DeploymentSelection


class ScanResultFields(BaseModel):
    file_count: int
    image_count: int
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    camera_model: Optional[str] = None
    warnings: list[str] = Field(default_factory=list)


class SaveScanRequest(BaseModel):
    # None starts a new session — the wizard's first step.
    task_id: Optional[str] = None
    source_dir: str = Field(min_length=1)
    scan: ScanResultFields


class SaveDetailsRequest(BaseModel):
    task_id: str
    deployment: DeploymentFields


class SyncCollectionsRequest(TrapperCredentials):
    """Sync the collections folder with the classification project's collections, deployments and locations."""

    research_project_pk: int
    research_project_name: Optional[str] = None
    research_project_acronym: Optional[str] = None
    classification_project_pk: int
    # The collections to sync, by name; left out, every collection starting with R is synced.
    collections: Optional[list[str]] = None
    # The deployments to sync, by id, within those collections; left out, all of them are.
    deployments: Optional[list[str]] = None
    # Also download the images of those deployments from Trapper (through the classification project's media), into their folders.
    download_images: bool = False


class SyncCollectionNamesRequest(TrapperCredentials):
    """The collections of a classification project that can be synced, and the deployments in each."""

    research_project_pk: int
    classification_project_pk: int
