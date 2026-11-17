"""/api/deployment-import — the folder scan is real (a temp folder); Trapper
itself is faked (no network)."""
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from PIL import Image


def _client() -> TestClient:
    from wildintel_uploader.web.main import app
    return TestClient(app)


def _make_jpeg(path: Path, taken: str) -> None:
    img = Image.new("RGB", (4, 4), color="blue")
    exif = img.getexif()
    exif[306] = taken
    img.save(path, exif=exif)


def test_browse_folder_returns_the_chosen_path():
    with patch("wildintel_uploader.core.services.folder_picker.pick_folder", return_value="/home/me/DONA_01"):
        response = _client().post("/api/deployment-import/browse-folder")
    assert response.status_code == 200
    assert response.json() == {"path": "/home/me/DONA_01"}


def test_browse_folder_reports_when_no_dialog_tool_is_available():
    from wildintel_uploader.core.services import folder_picker
    with patch("wildintel_uploader.core.services.folder_picker.pick_folder", side_effect=folder_picker.FolderPickerUnavailable("nope")):
        response = _client().post("/api/deployment-import/browse-folder")
    assert response.status_code == 501


def test_browse_folder_passes_a_custom_title_through():
    with patch("wildintel_uploader.core.services.folder_picker.pick_folder", return_value="/home/me/Collections") as pick:
        _client().post("/api/deployment-import/browse-folder", json={"title": "Select the collection's folder"})
    pick.assert_called_once_with("Select the collection's folder")


def test_check_collection(tmp_path: Path):
    response = _client().post("/api/deployment-import/check-collection", json={"path": str(tmp_path / "nope")})
    assert response.status_code == 200
    assert response.json() == {"exists": False, "name": None}


def test_list_local_deployments(tmp_path: Path):
    from wildintel_uploader.core.services import local_folder_service
    local_folder_service.write_deployment_metadata(
        tmp_path / "R0001-DONA_01", {"deployment_id": "R0001-DONA_01", "location_id": "DONA_01", "start_date": "2024-09-04T13:10:00"},
    )

    response = _client().post("/api/deployment-import/list-local-deployments", json={"path": str(tmp_path)})

    assert response.status_code == 200
    assert response.json()["results"][0]["deployment_id"] == "R0001-DONA_01"


def test_import_local(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    _make_jpeg(source / "a.jpg", "2024:09:04 13:10:00")
    collection = tmp_path / "collection"

    response = _client().post("/api/deployment-import/import-local", json={
        "source_dir": str(source), "collection_dir": str(collection), "collection_name": "Doñana 2024",
        "deployment": {"deployment_id": "R0001-DONA_01", "location_id": "DONA_01", "start_date": "2024-09-04T13:10:00+02:00", "end_date": "2024-11-04T14:28:00+02:00", "latitude": 37.0, "longitude": -6.5},
    })

    assert response.status_code == 200
    events = [json.loads(line) for line in response.text.splitlines()]
    assert [e["type"] for e in events] == ["copy", "sealing", "done"]
    assert (collection / "R0001-DONA_01" / "a.jpg").is_file()
    assert (collection / "R0001-DONA_01" / "deployment.json").is_file()


def test_import_local_missing_source_is_a_400(tmp_path: Path):
    response = _client().post("/api/deployment-import/import-local", json={
        "source_dir": str(tmp_path / "nope"), "collection_dir": str(tmp_path / "collection"),
        "deployment": {"deployment_id": "R0001-DONA_01", "location_id": "DONA_01", "start_date": "2024-09-04T13:10:00+02:00", "end_date": "2024-11-04T14:28:00+02:00", "latitude": 37.0, "longitude": -6.5},
    })
    assert response.status_code == 400


def test_scan_folder(tmp_path: Path):
    _make_jpeg(tmp_path / "a.jpg", "2024:09:04 13:10:00")

    response = _client().post("/api/deployment-import/scan-folder", json={"path": str(tmp_path)})

    assert response.status_code == 200
    body = response.json()
    assert body == {"file_count": 1, "image_count": 1, "warnings": []}


def test_guess_details(tmp_path: Path):
    _make_jpeg(tmp_path / "a.jpg", "2024:09:04 13:10:00")

    response = _client().post("/api/deployment-import/guess-details", json={"path": str(tmp_path)})

    assert response.status_code == 200
    assert response.json()["start_date"] == "2024-09-04T13:10:00"
    assert _client().post("/api/deployment-import/guess-details", json={"path": "/no/such/folder"}).status_code == 400


def test_scan_folder_missing_path_is_a_400():
    response = _client().post("/api/deployment-import/scan-folder", json={"path": "/no/such/folder"})
    assert response.status_code == 400


def test_scan_session(tmp_path: Path):
    (tmp_path / "SITE_01").mkdir()
    _make_jpeg(tmp_path / "SITE_01" / "a.jpg", "2024:09:04 13:10:00")

    response = _client().post("/api/deployment-import/scan-session", json={"path": str(tmp_path)})

    assert response.status_code == 200
    assert [d["name"] for d in response.json()["deployments"]] == ["SITE_01"]


def test_scan_session_without_subfolders_is_a_400(tmp_path: Path):
    response = _client().post("/api/deployment-import/scan-session", json={"path": str(tmp_path)})
    assert response.status_code == 400


def test_validate_images(tmp_path: Path):
    _make_jpeg(tmp_path / "IMG_0001.jpg", "2024:06:02 10:00:00")
    _make_jpeg(tmp_path / "IMG_0002.jpg", "2024:05:01 10:00:00")
    (tmp_path / "IMG_0003.jpg").write_bytes(b"not actually a jpeg")

    response = _client().post("/api/deployment-import/validate-images", json={"path": str(tmp_path)})

    assert response.status_code == 200
    body = response.json()
    assert body["checked_count"] == 3
    assert [c["path"] for c in body["corrupted"]] == ["IMG_0003.jpg"]
    assert len(body["sequence_issues"]) == 1


def test_validate_images_missing_path_is_a_400():
    response = _client().post("/api/deployment-import/validate-images", json={"path": "/no/such/folder"})
    assert response.status_code == 400


def test_validate_images_runs_only_the_requested_checks(tmp_path: Path):
    (tmp_path / "sub").mkdir()
    _make_jpeg(tmp_path / "sub" / "a.jpg", "2024:06:02 10:00:00")

    response = _client().post(
        "/api/deployment-import/validate-images", json={"path": str(tmp_path), "checks": ["structure"]},
    )

    assert response.status_code == 200
    assert {k: v for k, v in response.json().items() if k != "report_id"} == {"checked_count": 1, "subdirectories": ["sub"]}


def test_validate_deployment(tmp_path: Path):
    _make_jpeg(tmp_path / "a.jpg", "2024:09:03 10:00:00")  # before the deployment's own start_date

    response = _client().post("/api/deployment-import/validate-deployment", json={
        "path": str(tmp_path),
        "deployment": {"deployment_id": "R0001-DONA_01", "location_id": "DONA_01", "start_date": "2024-09-04T00:00:00+02:00", "end_date": "2024-11-04T14:28:00+02:00", "latitude": 37.0, "longitude": -6.5},
    })

    assert response.status_code == 200
    body = response.json()
    assert [o["path"] for o in body["out_of_range"]] == ["a.jpg"]


def test_validate_deployment_missing_path_is_a_400():
    response = _client().post("/api/deployment-import/validate-deployment", json={
        "path": "/no/such/folder",
        "deployment": {"deployment_id": "R0001-DONA_01", "location_id": "DONA_01", "start_date": "2024-09-04T00:00:00+02:00", "end_date": "2024-11-04T14:28:00+02:00", "latitude": 37.0, "longitude": -6.5},
    })
    assert response.status_code == 400


def test_import_deployment_skips_registration_for_an_existing_deployment(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    _make_jpeg(source / "a.jpg", "2024:09:04 13:10:00")

    data_dir = tmp_path / "data"
    fake_client = MagicMock()
    payload = {
        "url": "https://trapper.example.org", "username": "alice", "password": "s3cret",
        "research_project_pk": 2, "research_project_id": "DONA",
        "source_dir": str(source),
        "deployment": {
            "deployment_id": "R0001-DONA_01", "location_id": "DONA_01",
            "start_date": "2024-09-04T13:10:00+02:00", "end_date": "2024-11-04T14:28:00+02:00", "latitude": 37.0, "longitude": -6.5,
        },
        "register_deployment": False,
    }

    with patch("wildintel_uploader.core.services.trapper_service._client", return_value=fake_client), \
         patch("wildintel_uploader.core.services.deployment_import_service.config.collections_dir", return_value=data_dir):
        response = _client().post("/api/deployment-import/import", json=payload)

    assert response.status_code == 200
    events = [json.loads(line) for line in response.text.splitlines()]
    assert [e["type"] for e in events] == ["copy", "done"]  # no "registering"
    assert (data_dir / "DONA" / "R0001" / "R0001-DONA_01" / "a.jpg").is_file()  # <research project>/<collection>/<deployment>
    fake_client.deployments.import_deployments.assert_not_called()


def test_import_deployment_streams_progress_then_registers(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    _make_jpeg(source / "a.jpg", "2024:09:04 13:10:00")

    data_dir = tmp_path / "data"
    fake_client = MagicMock()
    payload = {
        "url": "https://trapper.example.org", "username": "alice", "password": "s3cret",
        "research_project_pk": 2, "research_project_id": "DONA", "classification_project_pk": 10,
        "source_dir": str(source),
        "deployment": {
            "deployment_id": "R0001-DONA_01", "location_id": "DONA_01",
            "start_date": "2024-09-04T13:10:00+02:00", "end_date": "2024-11-04T14:28:00+02:00", "latitude": 37.0, "longitude": -6.5,
        },
    }
    _keep_location(data_dir, timezone="Europe/Madrid")

    with patch("wildintel_uploader.core.services.trapper_service._client", return_value=fake_client), \
         patch("wildintel_uploader.web.api.routers.deployment_import.config.collections_dir", return_value=data_dir), \
         patch("wildintel_uploader.core.services.deployment_import_service.config.collections_dir", return_value=data_dir):
        response = _client().post("/api/deployment-import/import", json=payload)

    assert response.status_code == 200
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[0] == {"type": "copy", "index": 1, "total": 1, "name": "a.jpg"}
    assert events[1] == {"type": "registering"}
    assert events[2]["type"] == "done"
    assert (data_dir / "DONA" / "R0001" / "R0001-DONA_01" / "a.jpg").is_file()  # <research project>/<collection>/<deployment>
    fake_client.deployments.import_deployments.assert_called_once()


def test_import_deployment_writes_the_collection_and_deployment_metadata_beside_the_images(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    _make_jpeg(source / "a.jpg", "2024:09:04 13:10:00")
    data_dir = tmp_path / "data"
    payload = {
        "url": "https://trapper.example.org", "username": "alice", "password": "s3cret",
        "research_project_pk": 2, "research_project_id": "DONA", "source_dir": str(source),
        "deployment": {
            "deployment_id": "R0003-DONA_01", "location_id": "DONA_01",
            "start_date": "2024-09-04T13:10:00+02:00", "end_date": "2024-11-04T14:28:00+02:00", "latitude": 37.0, "longitude": -6.5,
        },
        "register_deployment": False,
    }

    with patch("wildintel_uploader.core.services.trapper_service._client", return_value=MagicMock()), \
         patch("wildintel_uploader.core.services.deployment_import_service.config.collections_dir", return_value=data_dir):
        assert _client().post("/api/deployment-import/import", json=payload).status_code == 200

    collection = data_dir / "DONA" / "R0003"
    assert json.loads((collection / "collection.json").read_text())["name"] == "R0003"
    assert json.loads((collection / "R0003-DONA_01" / "deployment.json").read_text())["deployment_id"] == "R0003-DONA_01"


def test_import_deployment_needs_an_id_starting_with_its_collection(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    payload = {
        "url": "https://trapper.example.org", "username": "alice", "password": "s3cret",
        "research_project_pk": 2, "research_project_id": "DONA", "source_dir": str(source),
        "deployment": {
            "deployment_id": "DONA-DONA_01", "start_date": "2024-09-04T13:10:00+02:00", "end_date": "2024-11-04T14:28:00+02:00",
            "latitude": 37.0, "longitude": -6.5,
        },
        "register_deployment": False,
    }

    with patch("wildintel_uploader.core.services.deployment_import_service.config.collections_dir", return_value=tmp_path / "data"):
        response = _client().post("/api/deployment-import/import", json=payload)

    assert response.status_code == 400
    assert "R + four digits" in response.json()["detail"]


def test_collection_path_is_research_project_then_collection_inside_the_collections_folder(tmp_path: Path):
    data_dir = tmp_path / "data"
    with patch("wildintel_uploader.core.services.deployment_import_service.config.collections_dir", return_value=data_dir):
        response = _client().post("/api/deployment-import/collection-path", json={"research_project_id": "DONA", "deployment_id": "R0003-DONA_01"})

    assert response.status_code == 200
    assert response.json() == {"path": str(data_dir / "DONA" / "R0003"), "collection": "R0003", "exists": False, "name": None}


def test_collection_path_rejects_a_research_project_id_that_is_not_a_folder_name(tmp_path: Path):
    with patch("wildintel_uploader.core.services.deployment_import_service.config.collections_dir", return_value=tmp_path):
        for bad in ("../x", "a/b", "..", "with space"):
            response = _client().post("/api/deployment-import/collection-path", json={"research_project_id": bad, "deployment_id": "R0003-DONA_01"})
            assert response.status_code == 400, bad


# ── research projects and locations kept in the collections folder ──────────

PROJECT = {"name": "Doñana", "acronym": "DONA", "event_interval": 0}


def _in(data_dir: Path):
    return patch("wildintel_uploader.core.services.deployment_import_service.config.collections_dir", return_value=data_dir)


def test_the_first_run_has_no_research_projects(tmp_path: Path):
    with _in(tmp_path / "does-not-exist-yet"):
        response = _client().post("/api/deployment-import/research-projects/list")

    assert response.status_code == 200
    assert response.json() == {"results": []}


def test_adding_a_research_project_keeps_it_in_its_own_folder_and_lists_it(tmp_path: Path):
    with _in(tmp_path):
        saved = _client().post("/api/deployment-import/research-projects/save", json={**PROJECT, "trapper_pk": 2, "keywords": "doñana"})
        listed = _client().post("/api/deployment-import/research-projects/list")

    assert saved.status_code == 200
    assert (tmp_path / "DONA" / "research_project.json").is_file()
    [project] = listed.json()["results"]
    assert project["name"] == "Doñana" and project["acronym"] == "DONA" and project["trapper_pk"] == 2
    assert project["sampling_design"] == 1 and project["event_interval"] == 0  # Trapper's own defaults


def test_a_folder_without_research_project_metadata_is_not_a_research_project(tmp_path: Path):
    (tmp_path / "random_folder").mkdir()
    with _in(tmp_path):
        assert _client().post("/api/deployment-import/research-projects/list").json() == {"results": []}


def test_the_same_research_project_cannot_be_added_twice(tmp_path: Path):
    with _in(tmp_path):
        assert _client().post("/api/deployment-import/research-projects/save", json=PROJECT).status_code == 200
        again = _client().post("/api/deployment-import/research-projects/save", json=PROJECT)

    assert again.status_code == 409
    assert "already exists" in again.json()["detail"]


@pytest.mark.parametrize("bad", [
    {"acronym": "AB"}, {"acronym": "ABCDEFGHIJK"}, {"acronym": "../evil"}, {"acronym": "a b c"}, {"acronym": ".hidden"},
    {"name": ""}, {"event_interval": -1}, {"sampling_design": 9}, {"abstract": "x" * 2001},
])
def test_research_project_fields_follow_trappers_own_form(tmp_path: Path, bad: dict):
    with _in(tmp_path):
        response = _client().post("/api/deployment-import/research-projects/save", json={**PROJECT, **bad})

    assert response.status_code == 422
    assert not any(tmp_path.iterdir())


def test_a_research_project_starts_with_no_locations_and_gets_them_added(tmp_path: Path):
    with _in(tmp_path):
        _client().post("/api/deployment-import/research-projects/save", json=PROJECT)
        empty = _client().post("/api/deployment-import/locations/list", json={"research_project_id": "DONA"})
        saved = _client().post("/api/deployment-import/locations/save", json={
            "research_project_id": "DONA", "location": {"location_id": "DONA_01", "name": "Doñana site 1", "timezone": "Europe/Madrid", "ignore_dst": False, "latitude": 37.0, "longitude": -6.5, "trapper_pk": 5},
        })
        listed = _client().post("/api/deployment-import/locations/list", json={"research_project_id": "DONA"})

    assert empty.json() == {"results": []}
    assert saved.status_code == 200
    [location] = listed.json()["results"]
    assert (location["location_id"], location["name"], location["timezone"], location["trapper_pk"]) == ("DONA_01", "Doñana site 1", "Europe/Madrid", 5)
    assert (location["latitude"], location["longitude"], location["ignore_dst"]) == (37.0, -6.5, False)


def test_a_locations_timezone_and_summer_time_are_fixed_when_it_is_created(tmp_path: Path):
    with _in(tmp_path):
        _client().post("/api/deployment-import/research-projects/save", json=PROJECT)
        _client().post("/api/deployment-import/locations/save", json={"research_project_id": "DONA", "location": {"location_id": "DONA_01", "name": "Site", "timezone": "Europe/Madrid", "ignore_dst": False, "latitude": 37.0, "longitude": -6.5}})
        update = lambda **changes: _client().post("/api/deployment-import/locations/update", json={"research_project_id": "DONA", "location_id": "dona_01", **changes})  # noqa: E731
        zone = update(timezone="UTC")
        summer = update(ignore_dst=True)
        same = update(timezone="Europe/Madrid", ignore_dst=False, name="Site 1")     # saying the same is not changing it
        listed = _client().post("/api/deployment-import/locations/list", json={"research_project_id": "DONA"}).json()["results"]

    assert zone.status_code == 409 and "timezone of a location can't be changed" in zone.json()["detail"]
    assert summer.status_code == 409 and "summer-time setting" in summer.json()["detail"]
    assert same.status_code == 200
    [location] = listed
    assert (location["name"], location["timezone"], location["ignore_dst"]) == ("Site 1", "Europe/Madrid", False)


def test_a_location_can_be_renamed_moved_and_cleared_of_what_is_not_known_any_more(tmp_path: Path):
    with _in(tmp_path):
        _client().post("/api/deployment-import/research-projects/save", json=PROJECT)
        _client().post("/api/deployment-import/locations/save", json={"research_project_id": "DONA", "location": {"location_id": "DONA_01", "name": "Site", "timezone": "UTC", "ignore_dst": False, "latitude": 37.0, "longitude": -6.5, "coordinate_uncertainty": 50}})
        changed = _client().post("/api/deployment-import/locations/update", json={"research_project_id": "DONA", "location_id": "DONA_01", "name": "Site 1", "latitude": 37.1, "coordinate_uncertainty": None})
        bad = _client().post("/api/deployment-import/locations/update", json={"research_project_id": "DONA", "location_id": "DONA_01", "latitude": 95})

    assert changed.status_code == 200 and bad.status_code == 422
    assert (changed.json()["name"], changed.json()["latitude"], changed.json()["longitude"], changed.json()["coordinate_uncertainty"]) == ("Site 1", 37.1, -6.5, None)


def test_updating_a_location_that_is_not_there_is_a_404_and_a_bad_timezone_a_422(tmp_path: Path):
    with _in(tmp_path):
        _client().post("/api/deployment-import/research-projects/save", json=PROJECT)
        missing = _client().post("/api/deployment-import/locations/update", json={"research_project_id": "DONA", "location_id": "NOPE", "timezone": "UTC"})
        bad = _client().post("/api/deployment-import/locations/update", json={"research_project_id": "DONA", "location_id": "X", "timezone": "Mars/Olympus"})

    assert missing.status_code == 404
    assert bad.status_code == 422


def test_a_location_is_deleted_unless_it_has_visits_or_comes_from_trapper(tmp_path: Path):
    visit = {"location_id": "DONA_02", "session": "R0001", "date": "2026-10-02", "time": "08:14:05", "actions": ["Installation"], "camera_id": "12", "sd": "A13"}
    with _in(tmp_path):
        _client().post("/api/deployment-import/research-projects/save", json=PROJECT)
        for location in ({"location_id": "DONA_01", "timezone": "UTC", "ignore_dst": False, "latitude": 37.0, "longitude": -6.5}, {"location_id": "DONA_02", "timezone": "UTC", "ignore_dst": False, "latitude": 37.0, "longitude": -6.5}, {"location_id": "DONA_03", "trapper_pk": 7, "timezone": "UTC", "ignore_dst": False, "latitude": 37.0, "longitude": -6.5}):
            _client().post("/api/deployment-import/locations/save", json={"research_project_id": "DONA", "location": location})
        from wildintel_uploader.core.services import local_folder_service
        local_folder_service.write_field_items(tmp_path, "DONA", "cameras", [{"label": "12", "camera_id": "12", "camera_model": None, "research_project": "DONA"}])
        local_folder_service.write_field_items(tmp_path, "DONA", "sd_cards", [{"label": "A13", "research_project": "DONA"}])
        _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": visit})
        free = _client().post("/api/deployment-import/locations/delete", json={"research_project_id": "DONA", "location_id": "dona_01"})
        visited = _client().post("/api/deployment-import/locations/delete", json={"research_project_id": "DONA", "location_id": "DONA_02"})
        trapper = _client().post("/api/deployment-import/locations/delete", json={"research_project_id": "DONA", "location_id": "DONA_03"})
        missing = _client().post("/api/deployment-import/locations/delete", json={"research_project_id": "DONA", "location_id": "NOPE"})
        listed = _client().post("/api/deployment-import/locations/list", json={"research_project_id": "DONA"}).json()["results"]

    assert free.status_code == 200 and free.json() == {"deleted": "DONA_01"}
    assert visited.status_code == 409 and "1 visit" in visited.json()["detail"]
    assert trapper.status_code == 409 and "Trapper" in trapper.json()["detail"]
    assert missing.status_code == 404
    assert [l["location_id"] for l in listed] == ["DONA_02", "DONA_03"]


def test_the_next_revision_is_asked_by_research_project_and_location(tmp_path: Path):
    deployment = tmp_path / "DONA" / "R0002" / "R0002-DONA_01"
    deployment.mkdir(parents=True)

    with _in(tmp_path):
        known = _client().post("/api/deployment-import/next-revision", json={"research_project_id": "DONA", "location_id": "DONA_01"})
        new = _client().post("/api/deployment-import/next-revision", json={"research_project_id": "DONA", "location_id": "DONA_09"})

    assert known.json() == {"last": 2, "next": 3} and new.json() == {"last": None, "next": 1}


def test_a_location_id_is_unique_within_its_research_project(tmp_path: Path):
    with _in(tmp_path):
        _client().post("/api/deployment-import/research-projects/save", json=PROJECT)
        body = {"research_project_id": "DONA", "location": {"location_id": "DONA_01", "timezone": "UTC", "ignore_dst": False, "latitude": 37.0, "longitude": -6.5}}
        assert _client().post("/api/deployment-import/locations/save", json=body).status_code == 200
        again = _client().post("/api/deployment-import/locations/save", json={**body, "location": {"location_id": "dona_01", "timezone": "UTC", "ignore_dst": False, "latitude": 37.0, "longitude": -6.5}})

    assert again.status_code == 409


def test_a_location_needs_its_research_project_to_be_there(tmp_path: Path):
    with _in(tmp_path):
        response = _client().post("/api/deployment-import/locations/save", json={"research_project_id": "NOPE", "location": {"location_id": "X_01", "timezone": "UTC", "ignore_dst": False, "latitude": 37.0, "longitude": -6.5}})

    assert response.status_code == 400
    assert "isn't in the collections folder" in response.json()["detail"]


def test_a_location_timezone_must_be_a_known_one_and_cannot_be_left_blank(tmp_path: Path):
    with _in(tmp_path):
        _client().post("/api/deployment-import/research-projects/save", json=PROJECT)
        place = {"ignore_dst": False, "latitude": 37.0, "longitude": -6.5}
        bad = _client().post("/api/deployment-import/locations/save", json={"research_project_id": "DONA", "location": {"location_id": "A_01", "timezone": "Mars/Olympus", **place}})
        blank = _client().post("/api/deployment-import/locations/save", json={"research_project_id": "DONA", "location": {"location_id": "A_02", "timezone": "", **place}})
        absent = _client().post("/api/deployment-import/locations/save", json={"research_project_id": "DONA", "location": {"location_id": "A_03", **place}})

    # a location always says its clock: the timezone, the summer time and where it is
    assert bad.status_code == blank.status_code == absent.status_code == 422


def test_a_location_always_says_where_it_is_and_if_its_cameras_follow_summer_time(tmp_path: Path):
    with _in(tmp_path):
        _client().post("/api/deployment-import/research-projects/save", json=PROJECT)
        full = {"location_id": "A_01", "timezone": "UTC", "ignore_dst": False, "latitude": 37.0, "longitude": -6.5}
        refused = [
            _client().post("/api/deployment-import/locations/save", json={"research_project_id": "DONA", "location": {k: v for k, v in full.items() if k != missing}}).status_code
            for missing in ("latitude", "longitude", "ignore_dst")
        ]

    assert refused == [422, 422, 422]


def test_locations_of_a_research_project_id_that_is_not_a_folder_name_are_refused(tmp_path: Path):
    with _in(tmp_path):
        for bad in ("../x", "a/b", ".."):
            response = _client().post("/api/deployment-import/locations/list", json={"research_project_id": bad})
            assert response.status_code == 400, bad


def test_a_location_keeps_its_coordinates_within_the_standards_ranges(tmp_path: Path):
    with _in(tmp_path):
        _client().post("/api/deployment-import/research-projects/save", json=PROJECT)
        saved = _client().post("/api/deployment-import/locations/save", json={
            "research_project_id": "DONA",
            "location": {"location_id": "DONA_01", "timezone": "UTC", "ignore_dst": False, "latitude": 37.0, "longitude": -6.5, "coordinate_uncertainty": 100},
        })
        listed = _client().post("/api/deployment-import/locations/list", json={"research_project_id": "DONA"})
        bad = [
            _client().post("/api/deployment-import/locations/save", json={"research_project_id": "DONA", "location": {"location_id": f"X_{i}", "timezone": "UTC", "ignore_dst": False, "latitude": 37.0, "longitude": -6.5, **coords}}).status_code
            for i, coords in enumerate([{"latitude": 91}, {"longitude": -181}, {"coordinate_uncertainty": 0}])
        ]

    assert saved.status_code == 200
    [location] = listed.json()["results"]
    assert (location["latitude"], location["longitude"], location["coordinate_uncertainty"]) == (37.0, -6.5, 100)
    assert bad == [422, 422, 422]


def test_validate_images_accepts_the_camera_check_and_returns_its_groups(tmp_path: Path):
    _make_jpeg(tmp_path / "a.jpg", "2024:09:04 13:10:00")
    _make_jpeg(tmp_path / "b.jpg", "2024:09:05 13:10:00")

    response = _client().post("/api/deployment-import/validate-images", json={"path": str(tmp_path), "checks": ["camera"]})

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"checked_count", "cameras", "cameras_without_info", "exiftool", "report_id"}
    assert body["cameras"] == [] and body["cameras_without_info"] == 2  # neither image says which camera took it


def test_validate_images_accepts_the_exif_and_duplicates_checks(tmp_path: Path):
    _make_jpeg(tmp_path / "a.jpg", "2024:09:04 13:10:00")
    (tmp_path / "copy.jpg").write_bytes((tmp_path / "a.jpg").read_bytes())

    response = _client().post("/api/deployment-import/validate-images", json={"path": str(tmp_path), "checks": ["exif", "duplicates"]})

    assert response.status_code == 200
    body = response.json()
    assert body["duplicates"] == [{"size": (tmp_path / "a.jpg").stat().st_size, "files": ["a.jpg", "copy.jpg"]}]
    assert body["exif_missing"]["date"]["count"] == 0 and body["exif_missing"]["camera_model"]["count"] == 2


def test_validate_images_looks_for_the_images_imported_before_into_the_research_project(tmp_path: Path):
    import hashlib
    import json
    data_dir = tmp_path / "collections"
    kept = data_dir / "DONA" / "R0001" / "R0001-DONA_01"
    kept.mkdir(parents=True)
    (kept / "preprocessing.json").write_text(json.dumps({"images": [{"original": "IMG_0001.JPG", "source_hash": hashlib.sha1(b"seen before").hexdigest()}]}), encoding="utf-8")
    folder = tmp_path / "card"
    folder.mkdir()
    (folder / "a.jpg").write_bytes(b"seen before")
    (folder / "b.jpg").write_bytes(b"new")
    payload = {"path": str(folder), "checks": ["duplicates"], "research_project_id": "DONA"}

    with patch("wildintel_uploader.web.api.routers.deployment_import.config.collections_dir", return_value=data_dir):
        response = _client().post("/api/deployment-import/validate-images", json=payload)
        elsewhere = _client().post("/api/deployment-import/validate-images", json={**payload, "deployment_id": "R0001-DONA_01"})
        alone = _client().post("/api/deployment-import/validate-images", json={"path": str(folder), "checks": ["duplicates"]})

    assert response.status_code == 200
    assert response.json()["duplicates_in_project"] == [{"file": "a.jpg", "deployment_id": "R0001-DONA_01", "collection": "R0001", "original": "IMG_0001.JPG"}]
    assert elsewhere.json()["duplicates_in_project"] == []   # that deployment is the one imported again
    assert "duplicates_in_project" not in alone.json()       # no research project, nothing to look in


def test_validate_deployment_takes_the_collection_the_location_and_the_tolerance(tmp_path: Path):
    _make_jpeg(tmp_path / "IMG_0001.jpg", "2024:09:04 12:00:00")  # 2 hours after the start
    payload = {
        "path": str(tmp_path),
        "deployment": {
            "deployment_id": "R0003-DONA_01", "start_date": "2024-09-04T10:00:00+02:00", "end_date": "2024-09-10T10:00:00+02:00",
            "latitude": 37.0, "longitude": -6.5,
        },
        "checks": ["collection_name", "collection_prefix", "location", "time_range"],
        "collection_name": "R0004", "expected_location_id": "DONA_02", "tolerance_hours": 3,
    }

    response = _client().post("/api/deployment-import/validate-deployment", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["collection_name"]["ok"] is True
    assert body["collection_prefix"]["ok"] is False  # R0003-… is not in R0004
    assert body["location"]["ok"] is False           # DONA_01 is not DONA_02
    assert body["out_of_range"] == [] and body["tolerance_hours"] == 3  # 2 hours is within a 3 hour tolerance


def test_validate_deployment_refuses_a_negative_tolerance(tmp_path: Path):
    response = _client().post("/api/deployment-import/validate-deployment", json={
        "path": str(tmp_path), "tolerance_hours": -1,
        "deployment": {"deployment_id": "R0003-DONA_01", "start_date": "2024-09-04T10:00:00+02:00", "end_date": "2024-09-10T10:00:00+02:00", "latitude": 37.0, "longitude": -6.5},
    })

    assert response.status_code == 422


# ── preprocessing on import ─────────────────────────────────────────────────

def _keep_location(root: Path, **fields) -> None:
    project = root / "DONA"
    project.mkdir(parents=True, exist_ok=True)
    (project / "locations.json").write_text(json.dumps([{"location_id": "DONA_01", **fields}]), encoding="utf-8")


def _visits_of_r0003(tmp_path: Path, visits: bool = True) -> None:
    """The research project, and the visits that make R0003-DONA_01 a deployment: the one that left the camera and the one that collected its card."""
    from wildintel_uploader.core.services import local_folder_service
    local_folder_service.write_research_project(tmp_path / "collections", {"name": "Doñana", "acronym": "DONA"})
    if not visits:
        return
    local_folder_service.write_visits(tmp_path / "collections", "DONA", [
        {"location_id": "DONA_01", "session": "R0003", "date": "2024-07-01", "time": "09:00:00", "when": "2024-07-01T07:00:00Z", "actions": ["Installation"], "sd": "A13"},
        {"location_id": "DONA_01", "session": "R0004", "date": "2024-07-31", "time": "09:00:00", "when": "2024-07-31T07:00:00Z", "actions": ["Revision"], "num_photos": 1},
    ])


def _import_local_payload(tmp_path: Path, location_time: dict | None = None, **preprocessing) -> dict:
    """location_time is what the kept location DONA_01 holds — the images are read in its timezone, the request has none."""
    _keep_location(tmp_path / "collections", **({"timezone": "Europe/Madrid"} if location_time is None else location_time))
    source = tmp_path / "source"
    source.mkdir()
    _make_jpeg(source / "IMG_0001.jpg", "2024:07:01 10:00:00")
    return {
        "source_dir": str(source), "collection_dir": str(tmp_path / "collections" / "DONA" / "R0003"), "collection_name": "R0003",
        "deployment": {
            "deployment_id": "R0003-DONA_01", "location_id": "DONA_01", "start_date": "2024-07-01T00:00:00+02:00",
            "end_date": "2024-07-31T00:00:00+02:00", "latitude": 37.0, "longitude": -6.5,
        },
        "preprocessing": {"metadata": False, **preprocessing},
    }


def test_import_local_preprocesses_when_asked(tmp_path: Path):
    payload = _import_local_payload(tmp_path, resize_width=1000)

    response = _client().post("/api/deployment-import/import-local", json=payload)

    assert response.status_code == 200
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[0] == {"type": "copy", "index": 1, "total": 1, "name": "R0003-DONA_01__20240701_1.JPEG"}
    assert events[-1]["type"] == "done" and events[-1]["processed"] == 1
    image = tmp_path / "collections" / "DONA" / "R0003" / "R0003-DONA_01" / "R0003-DONA_01__20240701_1.JPEG"
    assert image.is_file()
    assert Image.open(image).width == 4  # the test image is 4 px wide, narrower than 1000: never enlarged


def test_import_local_without_preprocessing_copies_as_before(tmp_path: Path):
    payload = _import_local_payload(tmp_path)
    del payload["preprocessing"]

    response = _client().post("/api/deployment-import/import-local", json=payload)

    assert response.status_code == 200
    assert (tmp_path / "collections" / "DONA" / "R0003" / "R0003-DONA_01" / "IMG_0001.jpg").is_file()


def test_import_local_without_a_location_timezone_is_a_plain_400_before_touching_anything(tmp_path: Path):
    response = _client().post("/api/deployment-import/import-local", json=_import_local_payload(tmp_path, location_time={}))

    assert response.status_code == 400
    assert "has no timezone" in response.json()["detail"]
    assert not (tmp_path / "collections" / "DONA" / "R0003").exists()


def test_import_local_reports_metadata_without_exiftool_as_a_plain_400(tmp_path: Path):
    with patch("wildintel_uploader.core.services.camera_info.exiftool_path", return_value=None):
        response = _client().post("/api/deployment-import/import-local", json=_import_local_payload(tmp_path, metadata=True))

    assert response.status_code == 400
    assert "needs ExifTool" in response.json()["detail"]


@pytest.mark.parametrize("bad", [{"resize_width": 50}, {"resize_width": 30000}])
def test_import_local_refuses_preprocessing_values_out_of_range(tmp_path: Path, bad: dict):
    assert _client().post("/api/deployment-import/import-local", json=_import_local_payload(tmp_path, **bad)).status_code == 422


@pytest.mark.parametrize("installed", [True, False])
def test_the_exiftool_endpoint_says_whether_it_is_installed(installed: bool):
    path = "/usr/bin/exiftool" if installed else None
    with patch("wildintel_uploader.core.services.camera_info.exiftool_path", return_value=path):
        body = _client().get("/api/deployment-import/exiftool").json()

    assert body == {"available": installed, "path": path}


# ── the collection's FileTimestampLog ───────────────────────────────────────

def _log_payload(**deployment) -> dict:
    return {
        "research_project_id": "DONA",
        "deployment": {
            "deployment_id": "R0003-DONA_0007_B", "latitude": 37.0, "longitude": -6.5,
            "start_date": "2024-09-04T13:10:00+02:00", "end_date": "2024-11-04T14:28:00+01:00", **deployment,
        },
    }


def test_timestamp_log_writes_the_deployments_row_in_its_collection(tmp_path: Path):
    with _in(tmp_path):
        response = _client().post("/api/deployment-import/timestamp-log", json=_log_payload())

    log = tmp_path / "DONA" / "R0003" / "R0003_FileTimestampLog.csv"
    assert response.status_code == 200
    fieldwork = tmp_path / "DONA" / "R0003" / "R0003_FieldworkLog.csv"
    assert response.json() == {"path": str(log), "action": "added", "rows": 1, "collection": "R0003",
                               "fieldwork_log": {"path": str(fieldwork), "action": "added", "rows": 1}}
    # The camera's wall-clock time: the designators (+02:00, +01:00) are dropped, not converted.
    assert log.read_text(encoding="utf-8-sig").splitlines()[1] == "r0003-dona_0007_b,2024:09:04,13:10:00,2024:11:04,14:28:00"


def test_timestamp_log_writes_the_deployments_row_in_the_fieldwork_log_too_in_utc(tmp_path: Path):
    payload = _log_payload(setup_by="Ana", camera_id="P800", camera_height=1.2, bait_use=True, tags=["forest", "pine"], comments="Near the pond")
    payload["visits"] = {"left_session": "R0003", "left_action": "Revision", "collected_session": "R0004", "collected_action": "Revision",
                         "counted_photos": 241, "sd_card": "A13", "left_sd": "B2"}
    with _in(tmp_path):
        _client().post("/api/deployment-import/timestamp-log", json=payload)

    lines = (tmp_path / "DONA" / "R0003" / "R0003_FieldworkLog.csv").read_text(encoding="utf-8-sig").splitlines()
    header, row = lines[0].split(","), dict(zip(lines[0].split(","), next(__import__("csv").reader([lines[1]]))))
    assert header[:6] == ["deploymentID", "locationID", "deploymentStart", "deploymentEnd", "setupBy", "cameraID"]
    assert row["deploymentID"] == "R0003-DONA_0007_B"
    assert (row["deploymentStart"], row["deploymentEnd"]) == ("2024-09-04T11:10:00Z", "2024-11-04T13:28:00Z")  # the designators, converted to UTC
    assert (row["setupBy"], row["cameraID"], row["cameraHeight"], row["baitUse"]) == ("Ana", "P800", "1.2", "true")
    assert (row["deploymentTags"], row["deploymentComments"], row["status"], row["collection"]) == ("forest | pine", "Near the pond", "closed", "R0003")
    assert (row["cardSD"], row["photosCounted"]) == ("A13", "241")
    assert (row["startSession"], row["startAction"], row["endSession"], row["endAction"]) == ("R0003", "Revision", "R0004", "Revision")


def test_the_fieldwork_log_keeps_the_other_deployments_rows_and_replaces_its_own(tmp_path: Path):
    with _in(tmp_path):
        _client().post("/api/deployment-import/timestamp-log", json=_log_payload(deployment_id="R0003-DONA_01"))
        _client().post("/api/deployment-import/timestamp-log", json=_log_payload(deployment_id="R0003-DONA_02"))
        again = _client().post("/api/deployment-import/timestamp-log", json=_log_payload(deployment_id="R0003-DONA_01", habitat="Pine forest"))

    log = tmp_path / "DONA" / "R0003" / "R0003_FieldworkLog.csv"
    assert again.json()["fieldwork_log"]["action"] == "updated" and again.json()["fieldwork_log"]["rows"] == 2
    assert "Pine forest" in log.read_text(encoding="utf-8-sig") and log.read_text(encoding="utf-8-sig").count("R0003-DONA_0") == 2


def test_timestamp_log_says_updated_then_unchanged(tmp_path: Path):
    with _in(tmp_path):
        _client().post("/api/deployment-import/timestamp-log", json=_log_payload())
        updated = _client().post("/api/deployment-import/timestamp-log", json=_log_payload(end_date="2024-12-01T08:00:00+01:00"))
        unchanged = _client().post("/api/deployment-import/timestamp-log", json=_log_payload(end_date="2024-12-01T08:00:00+01:00"))

    assert updated.json()["action"] == "updated" and unchanged.json()["action"] == "unchanged"
    assert unchanged.json()["rows"] == 1


def test_timestamp_log_refuses_an_id_without_a_collection_and_a_research_project_that_is_not_a_folder_name(tmp_path: Path):
    with _in(tmp_path):
        no_collection = _client().post("/api/deployment-import/timestamp-log", json=_log_payload(deployment_id="DONA-DONA_01"))
        bad_project = _client().post("/api/deployment-import/timestamp-log", json={**_log_payload(), "research_project_id": "../x"})

    assert no_collection.status_code == 400 and "R + four digits" in no_collection.json()["detail"]
    assert bad_project.status_code == 400
    assert not any(tmp_path.iterdir())


def test_timestamp_log_refuses_a_log_it_cannot_read_and_leaves_it_alone(tmp_path: Path):
    log = tmp_path / "DONA" / "R0003" / "R0003_FileTimestampLog.csv"
    log.parent.mkdir(parents=True)
    log.write_text("Deployment,StartDate\nR0003-X,2024:09:04\n", encoding="utf-8")

    with _in(tmp_path):
        response = _client().post("/api/deployment-import/timestamp-log", json=_log_payload())

    assert response.status_code == 400 and "missing the columns" in response.json()["detail"]
    assert log.read_text(encoding="utf-8") == "Deployment,StartDate\nR0003-X,2024:09:04\n"


def test_the_collection_made_for_the_log_is_the_one_the_import_then_uses(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    _make_jpeg(source / "IMG_0001.jpg", "2024:09:04 13:10:00")
    with _in(tmp_path / "collections"):
        _client().post("/api/deployment-import/timestamp-log", json=_log_payload(deployment_id="R0003-DONA_01"))
        collection = _client().post("/api/deployment-import/collection-path", json={"research_project_id": "DONA", "deployment_id": "R0003-DONA_01"}).json()

    assert collection["exists"] is True and collection["name"] == "R0003"  # so the import keeps that name


# ── statistical postvalidation ──────────────────────────────────────────────

def _stat_payload(tmp_path: Path, **overrides) -> dict:
    source = tmp_path / "source"
    source.mkdir(exist_ok=True)
    for i in range(6):
        _make_jpeg(source / f"IMG_{i:04d}.jpg", f"2024:09:04 1{i // 3}:0{(i % 3) * 1}:00")  # two sequences of three, a long gap apart
    return {
        "path": str(source), "research_project_id": "DONA", "checks": ["image_count", "sequence_count", "sequence_length"],
        "deployment": {
            "deployment_id": "R0003-DONA_01", "start_date": "2024-09-04T10:00:00+02:00", "end_date": "2024-09-30T10:00:00+02:00",
            "latitude": 37.0, "longitude": -6.5,
        },
        **overrides,
    }


def _history_revision(root: Path, revision: int, images: int) -> None:
    folder = root / "DONA" / f"R{revision:04d}" / f"R{revision:04d}-DONA_01"
    folder.mkdir(parents=True)
    entries = [{"name": f"{i}.jpeg", "local_time": f"2024-0{revision}-04T{10 + (i // 3):02d}:0{(i % 3)}:00", "source": "local", "extra": {}} for i in range(images)]
    (folder / "images.json").write_text(json.dumps({"images": entries}), encoding="utf-8")


def test_validate_deployment_compares_with_the_previous_revisions_of_the_location(tmp_path: Path):
    _history_revision(tmp_path / "collections", 1, 6)
    _history_revision(tmp_path / "collections", 2, 6)
    with _in(tmp_path / "collections"):
        response = _client().post("/api/deployment-import/validate-deployment", json=_stat_payload(tmp_path))

    assert response.status_code == 200
    body = response.json()
    assert set(body) >= {"image_count", "sequence_count", "sequence_length"}
    assert body["image_count"]["ok"] is True and body["image_count"]["value"] == 6 and body["image_count"]["previous"] == 2
    assert [h["revision"] for h in body["image_count"]["history"]] == [1, 2]
    assert "camera_mismatches" not in body and "deployment_id" not in body  # only what was asked


def test_validate_deployment_flags_a_revision_that_departs_from_the_previous_ones(tmp_path: Path):
    _history_revision(tmp_path / "collections", 1, 600)
    _history_revision(tmp_path / "collections", 2, 600)
    with _in(tmp_path / "collections"):
        body = _client().post("/api/deployment-import/validate-deployment", json=_stat_payload(tmp_path)).json()

    assert body["image_count"]["ok"] is False
    assert "is not similar to" in body["image_count"]["message"]


def test_validate_deployment_takes_the_statistical_parameters(tmp_path: Path):
    _history_revision(tmp_path / "collections", 1, 12)
    _history_revision(tmp_path / "collections", 2, 12)
    params = {"sequence_gap_seconds": 3600, "min_revisions": 3, "method": "range", "image_count_tolerance": 0, "sequence_count_tolerance": 10, "sequence_length_tolerance": 10}
    with _in(tmp_path / "collections"):
        body = _client().post("/api/deployment-import/validate-deployment", json=_stat_payload(tmp_path, statistics=params)).json()

    assert body["image_count"]["skipped"] is True  # 2 previous revisions, 3 needed
    assert "2 previous revision(s) of DONA_01 found, 3 needed" in body["image_count"]["message"]


def test_validate_deployment_runs_the_statistical_checks_among_the_default_ones_too(tmp_path: Path):
    payload = _stat_payload(tmp_path)
    del payload["checks"]
    with _in(tmp_path / "collections"):
        body = _client().post("/api/deployment-import/validate-deployment", json=payload).json()

    assert {"deployment_id", "out_of_range", "camera_mismatches", "image_count", "sequence_count", "sequence_length"} <= set(body)


@pytest.mark.parametrize("bad", [
    {"sequence_gap_seconds": 0}, {"min_revisions": 0}, {"method": "mode"}, {"image_count_tolerance": -1}, {"sequence_length_tolerance": 5000},
])
def test_validate_deployment_refuses_statistical_parameters_out_of_range(tmp_path: Path, bad: dict):
    response = _client().post("/api/deployment-import/validate-deployment", json=_stat_payload(tmp_path, statistics=bad))

    assert response.status_code == 422


def test_previous_deployments_gives_each_ones_earlier_revision(tmp_path: Path):
    old = tmp_path / "DONA" / "R0001" / "R0001-DONA_01"
    old.mkdir(parents=True)
    (old / "deployment.json").write_text(json.dumps({"deployment_id": "R0001-DONA_01", "habitat": "pine"}), encoding="utf-8")

    with patch("wildintel_uploader.web.api.routers.deployment_import.config.collections_dir", return_value=tmp_path):
        response = _client().post("/api/deployment-import/previous-deployments", json={
            "research_project_id": "DONA", "deployment_ids": ["R0002-DONA_01", "R0002-DONA_02"],
        })

    results = response.json()["results"]
    assert response.status_code == 200
    assert results["R0002-DONA_01"]["deployment_id"] == "R0001-DONA_01" and results["R0002-DONA_01"]["deployment"]["habitat"] == "pine"
    assert results["R0002-DONA_02"] is None


def test_previous_deployments_needs_some_ids():
    response = _client().post("/api/deployment-import/previous-deployments", json={"research_project_id": "DONA", "deployment_ids": []})
    assert response.status_code == 422


def test_existing_deployments_says_where_each_one_is_kept(tmp_path: Path):
    kept = tmp_path / "DONA" / "R0003" / "R0003-DONA_01"
    kept.mkdir(parents=True)
    (kept / "IMG.JPEG").write_bytes(b"x")

    with patch("wildintel_uploader.core.services.deployment_import_service.config.collections_dir", return_value=tmp_path):
        response = _client().post("/api/deployment-import/existing-deployments", json={
            "research_project_id": "DONA", "deployment_ids": ["R0003-DONA_01", "R0003-DONA_02"],
        })

    assert response.status_code == 200
    assert response.json()["results"] == {"R0003-DONA_01": str(kept), "R0003-DONA_02": None}


def test_existing_deployments_needs_some_ids():
    response = _client().post("/api/deployment-import/existing-deployments", json={"research_project_id": "DONA", "deployment_ids": []})
    assert response.status_code == 422


# ── the timezone is the location's, and only there ─────────────────────────

def test_import_local_reads_the_images_in_the_kept_locations_timezone(tmp_path: Path):
    payload = _import_local_payload(tmp_path, location_time={"timezone": "Atlantic/Canary", "ignore_dst": False})

    with patch("wildintel_uploader.web.api.routers.deployment_import.preprocessing_service.preprocess_stream", return_value=iter([])) as stream:
        response = _client().post("/api/deployment-import/import-local", json=payload)

    assert response.status_code == 200
    options = stream.call_args.args[4]
    assert (options.timezone, options.ignore_dst) == ("Atlantic/Canary", False)


def test_a_request_cannot_carry_a_timezone_of_its_own_into_the_import(tmp_path: Path):
    payload = _import_local_payload(tmp_path, location_time={"timezone": "Atlantic/Canary"}, timezone="Europe/Madrid", ignore_dst=False)

    with patch("wildintel_uploader.web.api.routers.deployment_import.preprocessing_service.preprocess_stream", return_value=iter([])) as stream:
        _client().post("/api/deployment-import/import-local", json=payload)

    assert stream.call_args.args[4].timezone == "Atlantic/Canary"  # the extra fields are ignored


def test_import_registers_the_deployment_in_the_kept_locations_timezone(tmp_path: Path):
    root = tmp_path / "collections"
    _keep_location(root, timezone="Atlantic/Canary", ignore_dst=True)
    payload = {
        "url": "https://trapper.example.org", "username": "alice", "password": "s3cret",
        "research_project_pk": 2, "research_project_id": "DONA", "classification_project_pk": 10, "source_dir": str(tmp_path),
        "deployment": {
            "deployment_id": "R0001-DONA_01", "location_id": "dona_01",
            "start_date": "2024-09-04T13:10:00+02:00", "end_date": "2024-11-04T14:28:00+02:00", "latitude": 37.0, "longitude": -6.5,
        },
    }

    with patch("wildintel_uploader.web.api.routers.deployment_import.config.collections_dir", return_value=root), \
         patch("wildintel_uploader.web.api.routers.deployment_import.deployment_import_service.import_stream", return_value=iter([])) as stream:
        response = _client().post("/api/deployment-import/import", json=payload)

    assert response.status_code == 200
    assert stream.call_args.args[7] == "Atlantic/Canary"
    assert stream.call_args.kwargs["ignore_dst"] is True


# ── images.json ─────────────────────────────────────────────────────────────

def test_import_local_without_preprocessing_writes_images_json(tmp_path: Path):
    payload = _import_local_payload(tmp_path)
    del payload["preprocessing"]

    _client().post("/api/deployment-import/import-local", json=payload)

    info = json.loads((tmp_path / "collections" / "DONA" / "R0003" / "R0003-DONA_01" / "images.json").read_text(encoding="utf-8"))
    assert (info["deployment_id"], info["image_count"], info["first"], info["last"]) == ("R0003-DONA_01", 1, "2024-07-01T10:00:00", "2024-07-01T10:00:00")
    image = info["images"][0]
    assert image["name"] == "IMG_0001.jpg" and image["source"] == "local" and (image["extra"]["width"], image["extra"]["height"]) == (4, 4)


def test_import_local_with_preprocessing_writes_images_json_with_the_dates_and_hashes(tmp_path: Path):
    _client().post("/api/deployment-import/import-local", json=_import_local_payload(tmp_path))

    folder = tmp_path / "collections" / "DONA" / "R0003" / "R0003-DONA_01"
    info = json.loads((folder / "images.json").read_text(encoding="utf-8"))
    image = info["images"][0]
    extra = image["extra"]
    assert image["name"] == "R0003-DONA_01__20240701_1.JPEG" and image["source"] == "local" and extra["original"] == "IMG_0001.jpg"
    assert image["local_time"] == "2024-07-01T10:00:00" and extra["taken_at"].startswith("2024-07-01T09:00:00")  # Madrid, ignoring summer time (UTC+1) → UTC
    assert extra["timestamp"] == 1719824400.0
    assert extra["size_bytes"] == (folder / image["name"]).stat().st_size and len(extra["sha1"]) == 40


def test_import_local_refuses_a_deployment_synced_from_trapper(tmp_path: Path):
    with_preprocessing = _import_local_payload(tmp_path)
    plain = {k: v for k, v in with_preprocessing.items() if k != "preprocessing"}
    folder = tmp_path / "collections" / "DONA" / "R0003" / "R0003-DONA_01"
    folder.mkdir(parents=True)
    (folder / "deployment.json").write_text('{"synced": true}', encoding="utf-8")
    (folder / "images.json").write_text('{"source": "trapper", "images": []}', encoding="utf-8")

    for body in (plain, with_preprocessing):
        response = _client().post("/api/deployment-import/import-local", json=body)
        assert response.status_code == 400 and "synced from Trapper" in response.json()["detail"]
    assert json.loads((folder / "deployment.json").read_text(encoding="utf-8")) == {"synced": True}


def test_the_seal_endpoint_says_whether_a_kept_deployment_is_still_what_was_sealed(tmp_path: Path):
    payload = _import_local_payload(tmp_path)
    _visits_of_r0003(tmp_path)
    with _in(tmp_path / "collections"):
        _client().post("/api/deployment-import/import-local", json=payload)
        ask = lambda: _client().post("/api/deployment-import/seal", json={"research_project_id": "DONA", "deployment_id": "R0003-DONA_01"})
        assert ask().json()["status"] == "valid"
        (tmp_path / "collections" / "DONA" / "R0003" / "R0003-DONA_01" / "deployment.json").write_text("{}", encoding="utf-8")
        broken = ask().json()
        missing = _client().post("/api/deployment-import/seal", json={"research_project_id": "DONA", "deployment_id": "R0003-DONA_09"})

    assert broken["status"] == "broken" and broken["deployment_changed"] is True
    assert missing.status_code == 404


def test_preprocess_leaves_the_deployment_pending_and_consolidate_freezes_it(tmp_path: Path):
    payload = _import_local_payload(tmp_path)
    dest = tmp_path / "collections" / "DONA" / "R0003" / "R0003-DONA_01"

    pending = _client().post("/api/deployment-import/preprocess", json=payload)
    assert pending.status_code == 200
    events = [json.loads(line) for line in pending.text.splitlines()]
    assert events[-1]["type"] == "done" and events[-1]["report_id"] and events[-1]["sealed"] is None
    assert not (dest / "seal.json").exists()

    frozen = _client().post("/api/deployment-import/consolidate", json=payload)
    assert frozen.status_code == 200
    events = [json.loads(line) for line in frozen.text.splitlines()]
    assert [e["type"] for e in events] == ["sealing", "done"] and events[-1]["sealed"] is True
    assert (dest / "seal.json").is_file()

    again = _client().post("/api/deployment-import/consolidate", json=payload)
    assert again.status_code == 400 and "already consolidated" in again.json()["detail"]


def test_preprocess_needs_to_be_told_what_to_do_and_consolidate_needs_something_preprocessed(tmp_path: Path):
    payload = _import_local_payload(tmp_path)

    assert _client().post("/api/deployment-import/consolidate", json=payload).status_code == 400
    del payload["preprocessing"]
    assert _client().post("/api/deployment-import/preprocess", json=payload).status_code == 400


def test_the_status_of_a_location_and_of_a_research_project_is_kept_and_defaults_to_active(tmp_path: Path):
    with _in(tmp_path):
        project = _client().post("/api/deployment-import/research-projects/save", json={**PROJECT, "status": "planned"})
        _client().post("/api/deployment-import/locations/save", json={"research_project_id": "DONA", "location": {"location_id": "DONA_01", "timezone": "UTC", "ignore_dst": False, "latitude": 37.0, "longitude": -6.5}})
        archived = _client().post("/api/deployment-import/locations/update", json={
            "research_project_id": "DONA", "location_id": "DONA_01", "status": "archived", "status_date": "2026-06-01", "status_note": "the road was closed",
        })
        # a null status (the field left blank) changes nothing
        same = _client().post("/api/deployment-import/locations/update", json={"research_project_id": "DONA", "location_id": "DONA_01", "status": None, "name": "Site"})
        wrong = _client().post("/api/deployment-import/locations/update", json={"research_project_id": "DONA", "location_id": "DONA_01", "status": "stolen"})
        bad_day = _client().post("/api/deployment-import/locations/update", json={"research_project_id": "DONA", "location_id": "DONA_01", "status_date": "June"})

    assert project.json()["status"] == "planned"
    assert (archived.json()["status"], archived.json()["status_date"], archived.json()["status_note"]) == ("archived", "2026-06-01", "the road was closed")
    assert (same.json()["status"], same.json()["name"]) == ("archived", "Site")
    assert wrong.status_code == 422 and bad_day.status_code == 422


def test_a_research_project_starts_active_and_a_location_ready_to_have_a_camera(tmp_path: Path):
    with _in(tmp_path):
        project = _client().post("/api/deployment-import/research-projects/save", json=PROJECT)
        location = _client().post("/api/deployment-import/locations/save", json={"research_project_id": "DONA", "location": {"location_id": "DONA_01", "timezone": "UTC", "ignore_dst": False, "latitude": 37.0, "longitude": -6.5}})

    assert project.json()["status"] == "active" and location.json()["status"] == "ready"


def test_a_research_project_can_be_changed_but_not_renamed(tmp_path: Path):
    with _in(tmp_path):
        _client().post("/api/deployment-import/research-projects/save", json={**PROJECT, "keywords": "wetland"})
        changed = _client().post("/api/deployment-import/research-projects/update", json={"acronym": "DONA", "name": "Doñana NP", "status": "finished"})
        bad = _client().post("/api/deployment-import/research-projects/update", json={"acronym": "DONA", "status": "stolen"})
        missing = _client().post("/api/deployment-import/research-projects/update", json={"acronym": "NOPE", "name": "x"})
        listed = _client().post("/api/deployment-import/research-projects/list").json()["results"]

    assert changed.status_code == 200 and bad.status_code == 422 and missing.status_code == 404
    [project] = listed
    assert (project["acronym"], project["name"], project["status"], project["keywords"]) == ("DONA", "Doñana NP", "finished", "wetland")  # the rest stayed


def test_a_research_project_is_deleted_logically_unless_it_holds_collections(tmp_path: Path):
    with _in(tmp_path):
        for acronym in ("DONA", "TATR"):
            _client().post("/api/deployment-import/research-projects/save", json={**PROJECT, "acronym": acronym})
            _client().post("/api/deployment-import/locations/save", json={"research_project_id": acronym, "location": {"location_id": f"{acronym}_01", "timezone": "UTC", "ignore_dst": False, "latitude": 37.0, "longitude": -6.5}})
        (tmp_path / "TATR" / "R0001").mkdir()
        kept = _client().post("/api/deployment-import/research-projects/delete", json={"research_project_id": "TATR"})
        gone = _client().post("/api/deployment-import/research-projects/delete", json={"research_project_id": "DONA"})
        again = _client().post("/api/deployment-import/research-projects/delete", json={"research_project_id": "DONA"})
        listed = _client().post("/api/deployment-import/research-projects/list").json()["results"]

    assert kept.status_code == 409 and "R0001" in kept.json()["detail"]
    assert gone.status_code == 200 and again.status_code == 404
    assert [p["acronym"] for p in listed] == ["TATR"] and (tmp_path / "TATR" / "R0001").is_dir()
    # nothing is deleted for good: the project that was deleted is kept, with when — it is only not listed
    kept = json.loads((tmp_path / "DONA" / "research_project.json").read_text(encoding="utf-8"))
    assert kept["deleted_at"] and kept["created_at"] and (tmp_path / "DONA" / "locations.json").is_file()


def test_validate_deployment_takes_the_visit_for_the_card_and_the_photos(tmp_path: Path):
    _make_jpeg(tmp_path / "IMG_0001.jpg", "2024:09:04 12:00:00")
    payload = {
        "path": str(tmp_path),
        "deployment": {
            "deployment_id": "R0003-DONA_01", "start_date": "2024-09-04T10:00:00+02:00", "end_date": "2024-09-10T10:00:00+02:00",
            "latitude": 37.0, "longitude": -6.5,
        },
        "checks": ["sd_card", "photo_count"],
        "visit": {"left_session": "R0002", "left_sd": "7B", "collected_session": "R0003", "counted_photos": 1900, "sd_card": "1B"},
    }

    response = _client().post("/api/deployment-import/validate-deployment", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["sd_card"]["ok"] is False and "left 7B" in body["sd_card"]["message"]
    assert body["photo_count"]["ok"] is False and "1,899 photos missing" in body["photo_count"]["message"]


def test_log_entry_gives_what_the_collections_logs_say_of_a_deployment(tmp_path: Path):
    payload = _log_payload(setup_by="Ana", camera_id="P800", camera_height=1.2, bait_use=True, tags=["forest", "pine"])
    with _in(tmp_path):
        _client().post("/api/deployment-import/timestamp-log", json=payload)
        found = _client().get("/api/deployment-import/log-entry", params={"research_project_id": "DONA", "deployment_id": "R0003-DONA_0007_B"})
        other = _client().get("/api/deployment-import/log-entry", params={"research_project_id": "DONA", "deployment_id": "R0003-DONA_0008_B"})

    assert found.status_code == 200
    body = found.json()
    assert body["collection"] == "R0003"
    assert body["timestamps"] == {"start": "2024-09-04T13:10:00", "end": "2024-11-04T14:28:00"}
    assert body["fieldwork"]["details"] == {"setup_by": "Ana", "camera_id": "P800", "camera_height": 1.2, "bait_use": True, "tags": ["forest", "pine"]}
    assert other.json()["timestamps"] is None and other.json()["fieldwork"] is None


def test_a_archived_location_never_goes_back_to_active_or_planned(tmp_path: Path):
    with _in(tmp_path):
        _client().post("/api/deployment-import/research-projects/save", json=PROJECT)
        _client().post("/api/deployment-import/locations/save", json={"research_project_id": "DONA", "location": {"location_id": "DONA_01", "timezone": "UTC", "ignore_dst": False, "latitude": 37.0, "longitude": -6.5}})
        archived = _client().post("/api/deployment-import/locations/update", json={"research_project_id": "DONA", "location_id": "DONA_01", "status": "archived", "status_note": "Repeated thefts"})
        back = _client().post("/api/deployment-import/locations/update", json={"research_project_id": "DONA", "location_id": "DONA_01", "status": "active"})
        planned = _client().post("/api/deployment-import/locations/update", json={"research_project_id": "DONA", "location_id": "DONA_01", "status": "planned"})
        renamed = _client().post("/api/deployment-import/locations/update", json={"research_project_id": "DONA", "location_id": "DONA_01", "status": "archived", "status_note": "Stolen twice"})

    assert archived.status_code == 200
    assert back.status_code == planned.status_code == 409 and "archived for good" in back.json()["detail"]
    assert renamed.status_code == 200 and renamed.json()["status_note"] == "Stolen twice"  # what says why may be said better; the status stays


def test_a_location_in_utc_never_ignores_summer_time_since_utc_has_none(tmp_path: Path):
    from wildintel_uploader.core.schemas.requests import LocationRecord

    def made(zone: str) -> LocationRecord:
        return LocationRecord(location_id="X_1", timezone=zone, ignore_dst=True, latitude=1, longitude=1)

    assert [made(z).ignore_dst for z in ("UTC", "Etc/UTC", "GMT", "Europe/Madrid")] == [False, False, False, True]

    with _in(tmp_path):
        _client().post("/api/deployment-import/research-projects/save", json=PROJECT)
        saved = _client().post("/api/deployment-import/locations/save", json={
            "research_project_id": "DONA", "location": {"location_id": "DONA_01", "timezone": "UTC", "ignore_dst": True, "latitude": 37.0, "longitude": -6.5},
        })
        listed = _client().post("/api/deployment-import/locations/list", json={"research_project_id": "DONA"}).json()["results"]
        # asking for it afterwards is not changing what the location says: UTC has no summer time
        asked = _client().post("/api/deployment-import/locations/update", json={"research_project_id": "DONA", "location_id": "DONA_01", "timezone": "UTC", "ignore_dst": True, "name": "Site"})

    assert saved.status_code == 200 and listed[0]["ignore_dst"] is False
    assert asked.status_code == 200 and asked.json()["ignore_dst"] is False


def test_a_deployment_that_is_of_no_visit_is_refused_before_a_file_is_touched(tmp_path: Path):
    payload = _import_local_payload(tmp_path)   # the research project has no visits
    _visits_of_r0003(tmp_path, visits=False)
    with _in(tmp_path / "collections"):
        for path in ("preprocess", "import-local"):
            response = _client().post(f"/api/deployment-import/{path}", json=payload)
            assert response.status_code == 400
            assert "always linked to a visit" in response.json()["detail"]
    assert not (tmp_path / "collections" / "DONA" / "R0003").exists()


def test_a_deployment_the_visits_say_is_accepted(tmp_path: Path):
    payload = _import_local_payload(tmp_path)
    _visits_of_r0003(tmp_path)
    with _in(tmp_path / "collections"):
        response = _client().post("/api/deployment-import/preprocess", json=payload)
    assert response.status_code == 200


def test_a_deployment_with_another_id_than_the_visits_say_is_refused(tmp_path: Path):
    payload = _import_local_payload(tmp_path)
    _visits_of_r0003(tmp_path)
    payload["deployment"]["deployment_id"] = "R0009-DONA_01"
    with _in(tmp_path / "collections"):
        response = _client().post("/api/deployment-import/preprocess", json=payload)
    assert response.status_code == 400
