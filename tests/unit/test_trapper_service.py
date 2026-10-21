"""services.trapper_service — the deployment CSV Trapper's import form
expects, and import_deployment's call into the SDK (faked, no network)."""
from datetime import datetime
from pathlib import Path

import pytest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from wildintel_uploader.core.schemas.requests import DeploymentFields
from wildintel_uploader.core.services import trapper_service


def _fields(**overrides) -> DeploymentFields:
    base = dict(
        deployment_id="R0001-DONA_01", location_id="DONA_01", location_name="Doñana 01",
        latitude=37.0, longitude=-6.5, start_date="2024-09-04T13:10:00+02:00", end_date="2024-11-04T14:28:00+02:00",
    )
    return DeploymentFields.model_validate({**base, **overrides})


def test_write_deployment_csv_header_and_row(tmp_path: Path):
    fields = _fields(
        camera_model="Reconyx HC600", camera_height=1.5,
        bait_use=True, tags=["forest", "north"],
    )
    csv_path = trapper_service.write_deployment_csv(fields, tmp_path / "deployment.csv")

    lines = csv_path.read_text(encoding="utf-8").splitlines()
    assert lines[0].split(",")[:3] == ["deploymentID", "locationID", "locationName"]
    assert "deploymentStart" in lines[0]
    row = lines[1]
    assert '"R0001-DONA_01"' in row
    assert '"Reconyx HC600"' in row
    assert '"1.5"' in row
    assert '"true"' in row  # bait_use
    assert '"forest,north"' in row  # tags joined


def test_write_deployment_csv_blank_for_unset_optional_fields(tmp_path: Path):
    csv_path = trapper_service.write_deployment_csv(_fields(), tmp_path / "deployment.csv")
    header, row = csv_path.read_text(encoding="utf-8").splitlines()
    # cameraModel has no value for this deployment — its column is blank.
    camera_model_index = header.split(",").index("cameraModel")
    assert row.split(",")[camera_model_index] == '""'


def _export(**overrides) -> SimpleNamespace:
    base = dict(
        pk=7, deployment_id="R0001-DONA_01", location_id="DONA_01", location_name="Doñana 01",
        latitude=None, longitude=None, coordinate_uncertainty=None,
        start_date=datetime(2024, 9, 4, 13, 10, 0), end_date=None,
        setup_by=None, camera_id=None, camera_model="Reconyx HC600",
        camera_interval=None, camera_height=None, camera_tilt=None, camera_heading=None,
        detection_distance=None, camera_depth=None, bait_use=None, timestamp_issues=None,
        feature_type=None, habitat=None, deployment_groups=None, comments=None, tags=[],
    )
    return SimpleNamespace(**{**base, **overrides})


def test_list_deployments_maps_the_export_shape_and_serializes_dates():
    client = MagicMock()
    client.deployments.export.return_value = [
        _export(), _export(pk=8, deployment_id="R0001-DONA_02", location_id="DONA_02"),
    ]
    with patch("wildintel_uploader.core.services.trapper_service._client", return_value=client):
        result = trapper_service.list_deployments("https://trapper.example.org", "alice", "s3cret", 2)

    client.deployments.export.assert_called_once_with(query={"research_project": 2})
    assert [d["deployment_id"] for d in result] == ["R0001-DONA_01", "R0001-DONA_02"]
    assert result[0]["pk"] == 7
    assert result[0]["start_date"] == "2024-09-04T13:10:00"
    assert result[0]["camera_model"] == "Reconyx HC600"


def test_import_deployment_calls_the_sdk_with_the_csv(tmp_path: Path):
    client = MagicMock()
    with patch("wildintel_uploader.core.services.trapper_service._client", return_value=client) as factory:
        trapper_service.import_deployment(
            "https://trapper.example.org", "alice", "s3cret",
            research_project_pk=2, classification_project_pk=10,
            deployment=_fields(), timezone="Europe/Madrid", csv_path=tmp_path / "deployment.csv",
        )
    factory.assert_called_once_with("https://trapper.example.org", "alice", "s3cret")
    client.deployments.import_deployments.assert_called_once()
    _, kwargs = client.deployments.import_deployments.call_args
    assert kwargs["research_project"] == 2
    assert kwargs["classification_project"] == 10
    assert kwargs["timezone"] == "Europe/Madrid"


def _location(pk: int, location_id: str) -> SimpleNamespace:
    return SimpleNamespace(pk=pk, location_id=location_id, name=f"Site {pk}", timezone="Europe/Madrid")


def test_list_locations_carries_the_coordinates_from_the_export():
    client = MagicMock()
    client.locations.where.return_value = [_location(5, "DONA_01"), _location(6, "DONA_02")]
    client.locations.export.return_value = [
        SimpleNamespace(pk=5, latitude=37.0, longitude=-6.5), SimpleNamespace(pk=6, latitude=None, longitude=None),
    ]

    with patch("wildintel_uploader.core.services.trapper_service._client", return_value=client):
        result = trapper_service.list_locations("https://trapper.example.org", "alice", "s3cret", 2)

    assert [(l["location_id"], l["latitude"], l["longitude"]) for l in result] == [("DONA_01", 37.0, -6.5), ("DONA_02", None, None)]
    client.locations.export.assert_called_once_with(query={"research_project": 2})


def test_list_locations_still_works_when_the_export_fails():
    client = MagicMock()
    client.locations.where.return_value = [_location(5, "DONA_01")]
    client.locations.export.side_effect = RuntimeError("boom")

    with patch("wildintel_uploader.core.services.trapper_service._client", return_value=client):
        [location] = trapper_service.list_locations("https://trapper.example.org", "alice", "s3cret", 2)

    assert location["location_id"] == "DONA_01" and location["latitude"] is None and location["longitude"] is None


# ── the dates of the deployment CSV: Trapper reads them as a wall clock, in the timezone it is told ──

@pytest.mark.parametrize("value, timezone_name, ignore_dst, expected", [
    ("2025-05-01T09:07:45Z", "Europe/Madrid", False, "2025-05-01T11:07:45"),          # UTC → the location's wall clock (summer time)
    ("2025-05-01T11:07:45+02:00", "Europe/Madrid", False, "2025-05-01T11:07:45"),      # already its wall clock: kept
    ("2025-05-01T09:07:45Z", "Europe/Madrid", True, "2025-05-01T10:07:45"),           # a camera that ignores summer time: standard time
    ("2025-01-10T09:07:45Z", "Europe/Madrid", True, "2025-01-10T10:07:45"),           # no summer time in winter: the same
    ("2025-05-01T09:07:45", "Europe/Madrid", False, "2025-05-01T09:07:45"),           # no designator: a wall clock already
    ("2025-05-01T09:07:45Z", None, False, "2025-05-01T09:07:45"),                     # no timezone to move it to
    (None, "Europe/Madrid", False, None),
])
def test_trapper_wall_clock(value, timezone_name, ignore_dst, expected):
    assert trapper_service.trapper_wall_clock(value, timezone_name, ignore_dst) == expected


def test_the_deployment_csv_has_the_dates_trapper_accepts(tmp_path: Path):
    fields = _fields(start_date="2025-05-01T09:07:45Z", end_date="2025-06-12T08:15:27Z")

    csv_path = trapper_service.write_deployment_csv(fields, tmp_path / "d.csv", timezone="Europe/Madrid")

    _, row = csv_path.read_text(encoding="utf-8").splitlines()
    assert '"2025-05-01T11:07:45"' in row and '"2025-06-12T10:15:27"' in row  # Madrid's wall clock, no Z


def test_list_locations_says_who_owns_a_location_and_whether_the_account_can_manage_it():
    client = MagicMock()
    client.locations.where.return_value = [
        SimpleNamespace(pk=5, location_id="mine", name=None, timezone="UTC", owner="alice", delete_data="/geomap/location/5/delete/"),
        SimpleNamespace(pk=6, location_id="theirs", name=None, timezone="UTC", owner="bob", delete_data=None),
    ]
    client.locations.export.return_value = []

    with patch("wildintel_uploader.core.services.trapper_service._client", return_value=client):
        mine, theirs = trapper_service.list_locations("https://trapper.example.org", "alice", "s3cret", 2)

    assert (mine["owner"], mine["can_manage"]) == ("alice", True)
    assert (theirs["owner"], theirs["can_manage"]) == ("bob", False)
