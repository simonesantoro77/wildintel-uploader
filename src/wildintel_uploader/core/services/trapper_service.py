"""Trapper integration — thin wrapper around wildintel-trapper-sdk (module
trapper_client), the same SDK wildintel-zooniverse and wildintel-publisher's
web app use.

No server-side session: every call builds its own TrapperClient from fresh
credentials, falling back to settings.toml's TRAPPER section for whatever
the request left blank (the password is never sent back to the frontend).

Registering a deployment goes through deployments.import_deployments() —
the SDK's simulation of Trapper's classic geomap/deployment/import/ form
(cookie/session auth, not the token-authenticated REST API, which is
read-only for deployments). See services.deployment_import_service for the
CSV this builds from a DeploymentFields."""
from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime, timedelta, timezone as dt_timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from trapper_client import TrapperClient

from wildintel_uploader.core import config
from wildintel_uploader.core.schemas.requests import DeploymentFields

logger = logging.getLogger(__name__)

LIST_PAGE_SIZE = 200

# DeploymentFields' own attribute -> the CSV column name Trapper's import
# form expects — the same Camtrap DP-style names DeploymentFields itself
# uses (see core.schemas.requests.DeploymentFields), so this is a 1:1 map.
_CSV_COLUMNS: list[tuple[str, str]] = [
    ("deployment_id", "deploymentID"),
    ("location_id", "locationID"),
    ("location_name", "locationName"),
    ("latitude", "latitude"),
    ("longitude", "longitude"),
    ("coordinate_uncertainty", "coordinateUncertainty"),
    ("start_date", "deploymentStart"),
    ("end_date", "deploymentEnd"),
    ("setup_by", "setupBy"),
    ("camera_id", "cameraID"),
    ("camera_model", "cameraModel"),
    ("camera_interval", "cameraDelay"),
    ("camera_height", "cameraHeight"),
    ("camera_depth", "cameraDepth"),
    ("camera_tilt", "cameraTilt"),
    ("camera_heading", "cameraHeading"),
    ("detection_distance", "detectionDistance"),
    ("bait_use", "baitUse"),
    ("timestamp_issues", "timestampIssues"),
    ("feature_type", "featureType"),
    ("habitat", "habitat"),
    ("deployment_groups", "deploymentGroups"),
    ("comments", "deploymentComments"),
    ("tags", "tags"),
]


def _client(url: str, username: str, password: str) -> TrapperClient:
    logger.debug("Trapper client for %s as %s", url, username)
    return TrapperClient(base_url=url.rstrip("/"), user_name=username, user_password=password)


def client(url: str, username: str, password: str) -> TrapperClient:
    """A Trapper client, for services doing more than listing."""
    return _client(url, username, password)


def get_connection_defaults() -> dict:
    settings = config.load_settings()
    return {
        "base_url": settings.TRAPPER.base_url,
        "user_name": settings.TRAPPER.user_name,
        "has_password": bool(settings.TRAPPER.user_password),
    }


def resolve_credentials(url: str | None, username: str | None, password: str | None) -> tuple[str, str, str]:
    """Raises:
        ValueError: naming whatever is still missing after the fallback.
    """
    trapper = config.load_settings().TRAPPER
    resolved = (url or trapper.base_url, username or trapper.user_name, password or trapper.user_password)
    missing = [name for name, value in zip(("URL", "username", "password"), resolved) if not value]
    if missing:
        raise ValueError(f"Missing Trapper {', '.join(missing)} — provide it, or save it in the configuration first.")
    return resolved  # type: ignore[return-value]


def save_credentials(url: str, username: str, password: str) -> None:
    settings = config.load_settings()
    settings.TRAPPER.base_url = url
    settings.TRAPPER.user_name = username
    settings.TRAPPER.user_password = password
    config.save_settings(settings)


def test_connection(url: str, username: str, password: str) -> dict:
    """Checks the credentials with a single one-item page of research
    projects — its pagination still says how many there are."""
    result = _client(url, username, password).research_projects.get(page=1, page_size=1)
    return {"ok": True, "research_projects_count": result.pagination.count}


def list_research_projects(url: str, username: str, password: str) -> list[dict]:
    projects = _client(url, username, password).research_projects.where(page_size=LIST_PAGE_SIZE)
    return sorted(
        ({"pk": p.pk, "name": p.name or f"#{p.pk}", "acronym": p.acronym} for p in projects),
        key=lambda p: p["name"].lower(),
    )


def list_classification_projects(url: str, username: str, password: str, research_project_pk: int) -> list[dict]:
    projects = _client(url, username, password).classification_projects.where(
        research_project=research_project_pk, page_size=LIST_PAGE_SIZE,
    )
    return sorted(
        ({"pk": p.pk, "name": p.name, "is_active": p.is_active} for p in projects),
        key=lambda p: p["name"].lower(),
    )


def list_locations(url: str, username: str, password: str, research_project_pk: int) -> list[dict]:
    """A research project's locations: pk, location_id, name, timezone and its
    coordinates (latitude/longitude, WGS84), its owner, whether this account can manage it, and whether it ignores summer time
    ("ignore_dst") — those come from Trapper's export endpoint, since the plain
    list only has the coordinates as a display string. None when Trapper can't say."""
    trapper = _client(url, username, password)
    locations = trapper.locations.where(research_project=research_project_pk, page_size=LIST_PAGE_SIZE)
    coordinates: dict[int, tuple[float | None, float | None]] = {}
    ignore_dst: dict[int, bool | None] = {}
    try:
        for export in trapper.locations.export(query={"research_project": research_project_pk}):
            coordinates[export.pk] = (export.latitude, export.longitude)
            ignore_dst[export.pk] = getattr(export, "ignore_dst", None)
    except Exception as exc:  # the locations are still usable, just without coordinates
        logger.warning("Could not read the locations' coordinates from Trapper: %s", exc)
    return sorted(
        (
            {
                "pk": l.pk, "location_id": l.location_id or f"#{l.pk}", "name": l.name, "timezone": l.timezone, "ignore_dst": ignore_dst.get(l.pk),
                "latitude": coordinates.get(l.pk, (None, None))[0], "longitude": coordinates.get(l.pk, (None, None))[1],
                "owner": getattr(l, "owner", None),
                # Trapper only offers the deletion of a location to its owner and managers — it is what tells whether this account is one.
                "can_manage": bool(l.delete_data) if hasattr(l, "delete_data") else None,
            }
            for l in locations
        ),
        key=lambda l: l["location_id"].lower(),
    )


def _plain_value(value):
    """A datetime becomes its ISO string — everything else, including
    DeploymentExport's own tags list, is already JSON-friendly."""
    return value.isoformat() if isinstance(value, datetime) else value


def list_deployments(url: str, username: str, password: str, research_project_pk: int) -> list[dict]:
    """Existing deployments of a research project, already shaped like
    DeploymentFields (plus "pk") — from Trapper's export endpoint, since
    the plain deployments list/get API doesn't carry camera/location
    details. Used by the "use an existing deployment" wizard branch, so the
    picked deployment can go straight into the deployment-details step."""
    exports = _client(url, username, password).deployments.export(query={"research_project": research_project_pk})
    deployments = [
        {"pk": export.pk, **{attr: _plain_value(getattr(export, attr, None)) for attr, _ in _CSV_COLUMNS}}
        for export in exports
    ]
    return sorted(deployments, key=lambda d: (d["deployment_id"] or "").lower())


def list_deployment_resources(url: str, username: str, password: str, deployment_pk: int) -> list[dict]:
    """The resources (images) Trapper has for a deployment — its pk — as plain dicts: pk, name, date_recorded (as Trapper
    gives it), mime, whether that date is right, and what is known of what they show (observation types, species, tags)."""
    resources = _client(url, username, password).resources.where(deployments=deployment_pk, page_size=LIST_PAGE_SIZE)
    return [
        {
            "pk": r.pk, "name": r.name, "date_recorded": r.date_recorded, "mime": r.mime, "date_recorded_correct": r.date_recorded_correct,
            "observation_type": list(r.observation_type), "species": list(r.species), "tags": list(r.tags),
        }
        for r in resources
    ]


def list_deployment_media(url: str, username: str, password: str, classification_project_pk: int, deployment_pk: int) -> list[dict]:
    """The files of a deployment's images, as a classification project holds them — {"pk", "name", "url"}. The url is the one
    Trapper serves the file from, with the access token it asks for in its query: without it the file is a 404, even for the
    account that owns it. The token is made for the account asking, so private images have it too — but only the images that
    are in a collection of that classification project are listed."""
    media = _client(url, username, password).classification_media.where_project_media(
        classification_project_pk, deployment=[deployment_pk], page_size=LIST_PAGE_SIZE,
    )
    return [{"pk": int(m.mediaID), "name": m.fileName, "url": str(m.filePath)} for m in media]


def file_downloader(url: str, username: str, password: str) -> Callable[[str, Path], int]:
    """A function that downloads a file of Trapper (the url of list_deployment_media) to a path and says its size. It is written
    under a temporary name and moved into place when it is whole, so a stop never leaves half an image. One client serves
    every call, from as many threads as wanted."""
    media = _client(url, username, password).classification_media

    def download(file_url: str, destination: Path) -> int:
        partial = destination.with_name(destination.name + ".part")
        try:
            media.download_media_file(file_url, partial)
            partial.replace(destination)
        finally:
            partial.unlink(missing_ok=True)
        return destination.stat().st_size

    return download


def _csv_value(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list):
        return ",".join(value)
    return str(value)


TRAPPER_DATETIME = "%Y-%m-%dT%H:%M:%S"


def trapper_wall_clock(value: str | None, timezone_name: str | None, ignore_dst: bool = False) -> str | None:
    """A date as Trapper's import form wants it: the camera's wall clock as YYYY-MM-DDThh:mm:ss, with no designator —
    the form is told the timezone on its own, and reads the date in it. A date with an offset ("…+02:00", "…Z") is
    moved to the wall clock of timezone_name; with ignore_dst, to the one its standard time has, which is the clock of a
    camera that never changed to summer time. A date with no offset is already a wall clock: it is kept.

    Raises:
        ValueError: it isn't an ISO 8601 date, or timezone_name isn't a timezone.
    """
    if not value:
        return value
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or not timezone_name:
        return parsed.replace(tzinfo=None).strftime(TRAPPER_DATETIME)
    local = parsed.astimezone(ZoneInfo(timezone_name))
    if ignore_dst:
        standard = local.utcoffset() - (local.dst() or timedelta(0))
        local = parsed.astimezone(dt_timezone(standard))
    return local.replace(tzinfo=None).strftime(TRAPPER_DATETIME)


def write_deployment_csv(deployment: DeploymentFields, path: Path, *, timezone: str | None = None, ignore_dst: bool = False) -> Path:
    """One-row CSV in the column order Trapper's import form expects. The dates are written as Trapper reads them —
    the wall clock of `timezone`, with no designator (see trapper_wall_clock)."""
    values = deployment.model_dump()
    for field in ("start_date", "end_date"):
        values[field] = trapper_wall_clock(values[field], timezone, ignore_dst)
    header = ",".join(csv_name for _, csv_name in _CSV_COLUMNS)
    row = ",".join(f'"{_csv_value(values[attr]).replace(chr(34), chr(34) * 2)}"' for attr, _ in _CSV_COLUMNS)
    path.write_text(f"{header}\n{row}\n", encoding="utf-8")
    return path


def import_deployment(
    url: str, username: str, password: str,
    research_project_pk: int, classification_project_pk: int | None,
    deployment: DeploymentFields, timezone: str, csv_path: Path, *, ignore_dst: bool = False,
) -> None:
    """Registers one deployment in Trapper from its CSV (see
    write_deployment_csv) — raises trapper_client.err.APIError on failure."""
    write_deployment_csv(deployment, csv_path, timezone=timezone, ignore_dst=ignore_dst)
    _client(url, username, password).deployments.import_deployments(
        file=csv_path, timezone=timezone, research_project=research_project_pk,
        classification_project=classification_project_pk, ignore_dst=ignore_dst,
    )
