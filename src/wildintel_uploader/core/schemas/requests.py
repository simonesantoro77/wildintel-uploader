"""Request/response models for the web API."""
from __future__ import annotations

import re
from datetime import date as date_type, datetime, time as time_type
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from wildintel_uploader.core.services.visit_time import is_utc
from wildintel_uploader.core.services.visit_rules import CAMERA_STATUSES, battery_status_code, camera_status_code, card_status_code, split_card_batteries


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


class StatisticsRequest(BaseModel):
    """A revision (collection) kept in the collections folder, to compare its deployments with the previous revisions of their locations."""

    research_project_id: str = Field(min_length=1)
    collection: str = Field(pattern=r"^R\d{4}(_.+)?$")


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


class CardRequest(BaseModel):
    """A memory card — or the copy of one — by the path of its folder."""

    path: str = Field(min_length=1)


class BrowseFolderRequest(BaseModel):
    # None uses the picker's own default title.
    title: Optional[str] = None


# The checks validate-images/validate-deployment can run — see
# services.deployment_import_service's own IMAGE_CHECKS/DEPLOYMENT_CHECKS.
ImageCheck = Literal["corrupted", "sequence", "structure", "camera", "exif", "duplicates"]
DeploymentCheck = Literal[
    "deployment_id", "collection_prefix", "collection_name", "location", "time_range", "camera",
    "image_count", "sequence_count", "sequence_length", "sd_card", "photo_count",
]


class ValidateImagesRequest(BaseModel):
    path: str
    # None runs every check.
    checks: Optional[list[ImageCheck]] = None
    # The research project the images are for: the duplicates check also looks for images imported before into it. None: only the folder itself.
    research_project_id: Optional[str] = None
    # The deployment being imported, when it is known: what was kept of it is not a duplicate (it is imported again).
    deployment_id: Optional[str] = None


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


class VisitCheckInfo(BaseModel):
    """What the visit the deployment is of says, for the checks against it: the card it left, and the photos counted when it was collected."""

    left_session: Optional[str] = None  # the visit that left the camera
    left_sd: Optional[str] = None  # the card it left in it
    collected_session: Optional[str] = None  # the visit that collected the card
    counted_photos: Optional[int] = Field(default=None, ge=0)  # the photos it counted on the card
    sd_card: Optional[str] = None  # the card the images are said to come from


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
    # The visit the deployment is of, for the checks of the card and of the photos (none: they have nothing to compare with).
    visit: Optional[VisitCheckInfo] = None


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
    # Whether it is being prepared, running or over: a finished one is not offered when a deployment is imported.
    status: Literal["planned", "active", "finished", "archived"] = "active"
    keywords: str = ""
    abstract: str = Field(default="", max_length=2000)
    methods: str = Field(default="", max_length=2000)
    description: str = Field(default="", max_length=2000)
    # Set when it was filled in from Trapper — to find its locations there later.
    trapper_pk: Optional[int] = None


class UpdateResearchProjectRequest(ResearchProjectRecord):
    """Change a research project already kept: the fields given are the ones that change, the rest stay. The acronym names it, and its folder,
    so it is the one that is found, never changed."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=255)  # type: ignore[assignment]
    acronym: str = Field(min_length=1)
    sampling_design: Optional[int] = Field(default=None, ge=1, le=6)  # type: ignore[assignment]
    sensor_method: Optional[int] = Field(default=None, ge=1, le=3)  # type: ignore[assignment]
    animal_types: Optional[int] = Field(default=None, ge=1, le=3)  # type: ignore[assignment]
    bait_use: Optional[int] = Field(default=None, ge=1, le=6)  # type: ignore[assignment]
    event_interval: Optional[int] = Field(default=None, ge=0)  # type: ignore[assignment]
    status: Optional[Literal["planned", "active", "finished", "archived"]] = None  # type: ignore[assignment]
    keywords: Optional[str] = None  # type: ignore[assignment]
    abstract: Optional[str] = Field(default=None, max_length=2000)  # type: ignore[assignment]
    methods: Optional[str] = Field(default=None, max_length=2000)  # type: ignore[assignment]
    description: Optional[str] = Field(default=None, max_length=2000)  # type: ignore[assignment]


DEFAULT_TIMEZONE = "UTC"


class LocationRecord(BaseModel):
    """A location of a research project kept in the collections folder."""

    location_id: str = Field(min_length=1, max_length=100)
    name: Optional[str] = None
    # IANA timezone and whether its cameras ignore summer time. Both belong to the location — never to a deployment: every deployment there uses them,
    # and Trapper only accepts a package that declares the same. They are always said when a location is made: the cameras' clocks are taken as UTC, and the
    # time of a field visit is read in the timezone of its location.
    timezone: str = Field(min_length=1)
    ignore_dst: bool
    # Where it is — WGS84 decimal degrees, as in Camtrap DP's deployments table. Always said.
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    coordinate_uncertainty: Optional[int] = Field(default=None, ge=1)
    # The day it was put into production (YYYY-MM-DD).
    in_service: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    trapper_pk: Optional[int] = None
    # Whether it is in use; an archived or a planned one is not offered for a visit. When it changed (YYYY-MM-DD) and why are free to leave out.
    status: Literal["planned", "pending", "ready", "active", "archived"] = "ready"
    status_date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    status_note: Optional[str] = None

    # what was kept as "retired" is archived now
    _legacy_status = field_validator("status", mode="before")(lambda cls, v: "archived" if v == "retired" else v)

    @field_validator("timezone")
    @classmethod
    def _known_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("is not a known IANA timezone") from exc
        return value

    @model_validator(mode="after")
    def _no_summer_time_in_utc(self) -> "LocationRecord":
        # UTC has no summer time: whether the cameras ignore it does not apply there, so it is never said to.
        if is_utc(self.timezone):
            self.ignore_dst = False
        return self


class LocalLocationsRequest(BaseModel):
    research_project_id: str = Field(min_length=1)


class DeleteLocationRequest(LocalLocationsRequest):
    location_id: str = Field(min_length=1)


class SaveLocationRequest(LocalLocationsRequest):
    location: LocationRecord


class VisitRecord(BaseModel):
    """A visit to a camera trap, as the fieldwork datasheet keeps it, at a location of the research project.

    What the datasheet has that Camtrap DP does not is the visit's own (session, action, status, card and batteries, the
    photos counted, the SD card, whether the camera's date and time were right, and who went: trappers); what it has of a
    deployment is named as DeploymentFields names it — camera_id (Camera), comments (Notes), the coordinates, setup_by —
    beside the optional details the field app may also ask for."""

    location_id: str = Field(min_length=1, max_length=100)
    session: str = Field(pattern=r"^R\d+$")
    date: date_type
    time: time_type
    # The instant of the visit, ISO 8601 in UTC with a Z — what is kept; the day and the time above are the wall clock of its location. Worked out when it is left out.
    when: Optional[str] = None
    # A visit may do several things: a camera revised and another put up, a card changed and the camera taken away…
    # Empty only for a visit that could not be made (its status says it was not revised): nothing was done at it.
    actions: list[Literal["SiteStart", "Installation", "Revision", "Desinstallation", "Stolen", "Archive"]] = Field(default_factory=list)
    trappers: Optional[str] = None
    # The status of the camera when the visit found it (e.g. Working, Not revised).
    camera_status: Optional[str] = None
    # How the batteries were (OK, or NoBatteries when there were none) and how the SD card was (OK, or CardFull). They were one field, card_batteries_ok: a visit that says it is read as both.
    battery_status: Optional[Literal["OK", "NoBatteries"]] = None
    card_status: Optional[Literal["OK", "CardFull"]] = None
    num_photos: Optional[int] = Field(default=None, ge=0)
    sd: Optional[str] = None
    date_time_ok: Optional[str] = None
    # Whether the camera was calibrated at the visit (a check of the field flow that Camtrap DP does not have) — asked where a camera is left or put up.
    calibration: Optional[bool] = None
    latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180)
    # The deployment this visit started — the images of the card it left, once they are imported (see local_folder_service.closed_visits).
    deployment_id: Optional[str] = None
    # Where the visit is in its life: deployed (it left a camera that is still out), collected (its card was collected), stolen, or not visited (it could not be made).
    # Kept when the visit is added, and changed when a later visit gives it a deployment — see visit_deployments.refresh_states.
    state: Optional[Literal["deployed", "collected", "stolen", "not_visited", "no_camera"]] = None
    # When the visit was registered and when it was last changed (ISO 8601, UTC, with a Z): written by the app when the visit is kept (see services.audit), never typed —
    # what is sent for them is not taken.
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    setup_by: Optional[str] = None
    camera_id: Optional[str] = None
    camera_model: Optional[str] = None
    camera_interval: Optional[int] = Field(default=None, ge=0)
    camera_height: Optional[float] = Field(default=None, ge=0)
    camera_depth: Optional[float] = Field(default=None, ge=0)
    camera_tilt: Optional[int] = Field(default=None, ge=-90, le=90)
    camera_heading: Optional[int] = Field(default=None, ge=0, le=360)
    detection_distance: Optional[float] = Field(default=None, ge=0)
    timestamp_issues: Optional[bool] = None
    bait_use: Optional[bool] = None
    feature_type: Optional[FeatureType] = None
    habitat: Optional[str] = None
    deployment_groups: Optional[str] = None
    comments: Optional[str] = None
    tags: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _one_field_before(cls, data):
        """A visit that says card_batteries_ok — how it was kept before — says the status of the batteries and the one of the card."""
        if isinstance(data, dict) and "card_batteries_ok" in data:
            data = dict(data)
            battery, card = split_card_batteries(data.pop("card_batteries_ok"))
            if battery and not data.get("battery_status"):
                data["battery_status"] = battery
            if card and not data.get("card_status"):
                data["card_status"] = card
        return data

    @field_validator("battery_status", mode="before")
    @classmethod
    def _battery_code(cls, value):
        return None if value in (None, "") else (battery_status_code(value) or value)

    @field_validator("card_status", mode="before")
    @classmethod
    def _card_code(cls, value):
        return None if value in (None, "") else (card_status_code(value) or value)

    @field_validator("camera_status", mode="before")
    @classmethod
    def _camera_status_code(cls, value):
        if value is None or str(value).strip() == "":
            return None
        code = camera_status_code(value)
        if code is None:
            raise ValueError("The status of the camera is " + ", ".join(CAMERA_STATUSES[:-1]) + " or " + CAMERA_STATUSES[-1] + ".")
        return code

    @field_validator("actions")
    @classmethod
    def _once_each(cls, actions: list[str]) -> list[str]:
        return list(dict.fromkeys(actions))

    @model_validator(mode="after")
    def _the_status_of_a_camera_found_stolen_is_stolen(self):
        # a Stolen visit says it all with its action: the status of the camera is Stolen — and only there is the camera found stolen
        if "Stolen" in self.actions:
            if self.camera_status not in (None, "Stolen"):
                raise ValueError("The camera of a Stolen visit is stolen: its status is Stolen.")
            self.camera_status = "Stolen"
        elif self.camera_status == "Stolen":
            raise ValueError("The status Stolen is for the visit that finds the camera stolen: its action is Stolen.")
        return self

    @model_validator(mode="after")
    def _no_card_left_where_the_camera_is_taken_away(self):
        # the camera that is taken away goes with its card: nothing is left, unless another camera is put up
        actions = set(self.actions)
        if "Desinstallation" in actions and "Installation" not in actions and self.sd:
            raise ValueError("No SD card is left where the camera is taken away: leave the card out.")
        return self

    @model_validator(mode="after")
    def _no_photos_on_a_full_card(self):
        # with the card full its photos are not counted: their number is not given
        if self.card_status == "CardFull" and self.num_photos is not None:
            raise ValueError("The photos on a full card are not counted: leave their number out.")
        return self

    @model_validator(mode="after")
    def _something_was_done(self):
        # a visit that could not be made did nothing; any other did at least one thing
        if not self.actions and str(self.camera_status or "").strip().lower() not in ("not revised", "no revisada", "no revisado"):
            raise ValueError("A visit does at least one action — only a visit that could not be made (status Not revised) has none.")
        return self

    @model_validator(mode="after")
    def _height_or_depth(self) -> "VisitRecord":
        if self.camera_height is not None and self.camera_depth is not None:
            raise ValueError("camera_height and camera_depth are mutually exclusive: only one should be set.")
        return self


class ListVisitsRequest(LocalLocationsRequest):
    """The visits of a research project — only those to one location when it is given."""

    location_id: Optional[str] = None


class CreateRevisionRequest(LocalLocationsRequest):
    """Plan the next revision: a visit to each location that is ready, planned."""


class MarkNotVisitedRequest(LocalLocationsRequest):
    """Finish a revision: the locations with no visit in it are marked as not visited."""

    session: str = Field(pattern=r"^R\d+$")


class SaveVisitRequest(LocalLocationsRequest):
    visit: VisitRecord


class UpdateVisitRequest(LocalLocationsRequest):
    """Edit a visit kept: its site and its revision are its key — they say which one it is, and do not change."""

    location_id: str = Field(min_length=1)
    session: str = Field(pattern=r"^R\d+$")
    visit: VisitRecord


class FieldLogsRequest(LocalLocationsRequest):
    """Write the logs of the collections the visits of a research project give deployments to — only the ones named, when some are."""

    collections: Optional[list[str]] = None


class LinkVisitRequest(LocalLocationsRequest):
    """The visit that closed a deployment (found by its location, day and time), and the deployment."""

    location_id: str = Field(min_length=1)
    date: date_type
    time: time_type
    deployment_id: str = Field(min_length=1)


class ImportVisitsCsvRequest(LocalLocationsRequest):
    """The text of a CSV file with visits — only read and checked unless `save` is set, then the visits that can be kept are."""

    csv: str = ""
    save: bool = False
    # How the file is read: with the column of each field said in `mapping`, as the download of the new Epicollect5 project, or as the entries of the Epicollect5
    # project of the settings (`csv` is then not used: they are read from Epicollect5).
    format: Literal["mapped", "epicollect-api", "epicollect-csv"] = "mapped"
    mapping: Optional[dict[str, str]] = None
    # What to create when the file names a location, a camera or an SD card that does not exist: {"locations": bool, "cameras": bool, "sd_cards": bool}. The fields each one
    # needs become required (see visits_csv.CREATABLE).
    create: Optional[dict[str, bool]] = None
    # The revision before the ones the file starts is closed when it has locations still planned: each is marked as not visited (an unknown one is not).
    close_revisions: bool = False
    # The value of a field that the file has no column for, or whose cell is empty: {field: value}.
    defaults: Optional[dict[str, str]] = None


class VisitsCsvColumnsRequest(BaseModel):
    """The text of a CSV file whose columns are asked for, to map them to the fields of a visit."""

    csv: str


class UpdateLocationRequest(LocalLocationsRequest):
    """Change a location already kept — its name, where it is, its timezone and/or summer-time setting. The fields left out stay as
    they are; one given as null is cleared."""

    location_id: str = Field(min_length=1)
    name: Optional[str] = None
    latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180)
    coordinate_uncertainty: Optional[int] = Field(default=None, ge=1)
    timezone: Optional[str] = None
    ignore_dst: Optional[bool] = None
    in_service: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    status: Optional[Literal["planned", "pending", "ready", "active", "archived"]] = None
    status_date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    status_note: Optional[str] = None

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

    @model_validator(mode="after")
    def _no_summer_time_in_utc(self) -> "UpdateLocationRequest":
        if is_utc(self.timezone) and self.ignore_dst is not None:
            self.ignore_dst = False
        return self


class FieldworkVisits(BaseModel):
    """What the visits a deployment is of say of it, for the FieldworkLog: the one that left the camera and the one that collected its card."""

    left_session: str | None = None
    left_action: str | None = None
    collected_session: str | None = None
    collected_action: str | None = None
    counted_photos: int | None = None
    #: The card the images are said to come from; the card the visit left when none is said.
    sd_card: str | None = None
    left_sd: str | None = None


class TimestampLogRequest(BaseModel):
    """Put a deployment's start and end in its collection's FileTimestampLog — and its row in the FieldworkLog."""

    research_project_id: str = Field(min_length=1)
    deployment: DeploymentFields
    #: The visits the deployment is of, when it is of some.
    visits: FieldworkVisits | None = None


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
