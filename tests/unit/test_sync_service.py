"""Syncing the collections folder with Trapper — Trapper is faked (no network)."""
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from wildintel_uploader.core.services import local_folder_service, sync_service

CREDS = ("https://trapper.example.org", "alice", "s3cret")
PROJECT = {"pk": 2, "name": "Doñana", "acronym": "DONA"}
LOCATIONS = [
    {"pk": 5, "location_id": "dona_01", "name": "Site 1", "timezone": "Europe/Madrid", "ignore_dst": True, "latitude": 37.0, "longitude": -6.5},
    {"pk": 6, "location_id": "dona_02", "name": "Site 2", "timezone": "Europe/Madrid", "ignore_dst": False, "latitude": 37.1, "longitude": -6.4},
]


def _deployment(deployment_id: str, location_id: str, start: str, end: str) -> dict:
    return {
        "pk": 1, "deployment_id": deployment_id, "location_id": location_id, "latitude": 37.0, "longitude": -6.5,
        "start_date": start, "end_date": end,
    }


DEPLOYMENTS = [
    _deployment("r0003-dona_01", "dona_01", "2024-07-01T08:00:00+00:00", "2024-07-31T10:00:00+00:00"),  # summer, ignoring DST: UTC+1
    _deployment("r0003-dona_02", "dona_02", "2024-07-01T08:00:00+00:00", "2024-07-31T10:00:00+00:00"),  # summer, using DST: UTC+2
    {**_deployment("r0003-dona_03", "dona_01", "2024-07-01T08:00:00+0000", "2024-07-31T10:00:00+0000"), "feature_type": ""},  # as Trapper gives it
    _deployment("r0003-dona_04", "dona_01", "not a date", "2024-07-31T10:00:00+0000"),
    _deployment("r0009-dona_01", "dona_01", "2024-07-01T08:00:00+00:00", "2024-07-31T10:00:00+00:00"),  # no such collection in the project
]


RESOURCES = [
    {"pk": 91, "name": "R0003-DONA_01__20240702_2.JPEG", "date_recorded": "2024-07-02T09:30:00+00:00", "mime": "image/jpeg", "date_recorded_correct": True,
     "observation_type": ["animal"], "species": ["Lynx pardinus"], "tags": []},
    {"pk": 90, "name": "R0003-DONA_01__20240701_1.JPEG", "date_recorded": "2024-07-01T08:00:00+00:00", "mime": "image/jpeg", "date_recorded_correct": True,
     "observation_type": [], "species": [], "tags": ["night"]},
]


def _run(root: Path, names=("R0003", "Other")):
    with patch("wildintel_uploader.core.services.sync_service.trapper_service.list_deployment_resources", return_value=RESOURCES), \
         patch("wildintel_uploader.core.services.sync_service.trapper_service.list_locations", return_value=LOCATIONS), \
         patch("wildintel_uploader.core.services.sync_service.trapper_service.list_deployments", return_value=DEPLOYMENTS), \
         patch("wildintel_uploader.core.services.sync_service.collection_names", return_value=[n for n in names if n.startswith("R")]):
        return sync_service.sync(CREDS, root, PROJECT, 10)


def test_wall_clock_follows_the_location_and_its_summer_time_setting():
    assert sync_service.wall_clock("2024-07-01T08:00:00+00:00", "Europe/Madrid", False).hour == 10
    assert sync_service.wall_clock("2024-07-01T08:00:00+00:00", "Europe/Madrid", True).hour == 9
    assert sync_service.wall_clock("2024-12-01T08:00:00Z", "Europe/Madrid", False).hour == 9
    assert sync_service.wall_clock("2024-07-01T08:00:00+00:00", None, False).hour == 8


def test_creates_the_expected_structure(tmp_path: Path):
    result = _run(tmp_path)

    folder = tmp_path / "DONA"
    assert json.loads((folder / "research_project.json").read_text(encoding="utf-8"))["trapper_pk"] == 2
    assert [l["location_id"] for l in json.loads((folder / "locations.json").read_text(encoding="utf-8"))] == ["DONA_01", "DONA_02"]
    assert json.loads((folder / "R0003" / "collection.json").read_text(encoding="utf-8"))["name"] == "R0003"
    assert (folder / "R0003" / "R0003-DONA_01" / "deployment.json").is_file()
    assert (folder / "R0003" / "R0003-DONA_02" / "deployment.json").is_file()
    assert not (folder / "Other").exists()  # only the collections starting with R
    log = (folder / "R0003" / "R0003_FileTimestampLog.csv").read_text(encoding="utf-8-sig")
    assert "R0003-DONA_01,2024:07:01,09:00:00,2024:07:31,11:00:00" in log
    assert "R0003-DONA_02,2024:07:01,10:00:00,2024:07:31,12:00:00" in log
    info = json.loads((folder / "R0003" / "R0003-DONA_01" / "images.json").read_text(encoding="utf-8"))
    assert (info["source"], info["image_count"], info["first"], info["last"]) == ("trapper", 2, "2024-07-01T09:00:00", "2024-07-02T10:30:00")  # DONA_01 ignores DST
    first = info["images"][0]
    assert first["name"] == "R0003-DONA_01__20240701_1.JPEG" and first["source"] == "trapper"
    assert first["extra"]["trapper_pk"] == 90 and first["extra"]["timestamp"] == 1719820800.0 and first["extra"]["tags"] == ["night"]
    assert info["images"][1]["extra"]["species"] == ["Lynx pardinus"]
    assert result["unassigned"] == ["R0009-DONA_01"]
    assert result["created"]["deployments"] == ["R0003-DONA_01", "R0003-DONA_02", "R0003-DONA_03"]
    saved = json.loads((folder / "R0003" / "R0003-DONA_03" / "deployment.json").read_text(encoding="utf-8"))
    assert saved["start_date"] == "2024-07-01T08:00:00+00:00" and saved["feature_type"] is None  # the offset as ±hh:mm, the empty value left out
    assert [f["deployment_id"] for f in result["failed"]] == ["R0003-DONA_04"] and "start_date" in result["failed"][0]["error"]
    assert not (folder / "R0003" / "R0003-DONA_04").exists()


def test_leaves_what_is_already_there_as_it_is(tmp_path: Path):
    _run(tmp_path)
    deployment = tmp_path / "DONA" / "R0003" / "R0003-DONA_01" / "deployment.json"
    deployment.write_text('{"edited": true}', encoding="utf-8")

    again = _run(tmp_path)

    assert deployment.read_text(encoding="utf-8") == '{"edited": true}'
    assert again["created"] == {key: [] for key in again["created"]}
    assert again["kept"]["images"] == ["R0003-DONA_01", "R0003-DONA_02", "R0003-DONA_03"]
    assert again["kept"]["deployments"] == ["R0003-DONA_01", "R0003-DONA_02", "R0003-DONA_03"] and again["kept"]["locations"] == ["DONA_01", "DONA_02"]


def test_the_endpoint_syncs_the_collections_folder(tmp_path: Path):
    from wildintel_uploader.web.main import app
    payload = {**dict(zip(("url", "username", "password"), CREDS)), "research_project_pk": 2, "research_project_name": "Doñana", "research_project_acronym": "DONA", "classification_project_pk": 10}

    with patch("wildintel_uploader.web.api.routers.sync.config.collections_dir", return_value=tmp_path), \
         patch("wildintel_uploader.core.services.sync_service.trapper_service.list_deployment_resources", return_value=RESOURCES), \
         patch("wildintel_uploader.core.services.sync_service.trapper_service.list_locations", return_value=LOCATIONS), \
         patch("wildintel_uploader.core.services.sync_service.trapper_service.list_deployments", return_value=DEPLOYMENTS), \
         patch("wildintel_uploader.core.services.sync_service.collection_names", return_value=["R0003"]):
        response = TestClient(app).post("/api/sync/collections", json=payload)

    events = [json.loads(line) for line in response.text.splitlines()]
    assert response.status_code == 200 and events[-1]["type"] == "done" and events[-1]["research_project_id"] == "DONA"
    assert any(e["type"] == "progress" and "R0003-DONA_01 (1/" in e["message"] for e in events)
    assert (tmp_path / "DONA" / "R0003" / "R0003-DONA_01" / "deployment.json").is_file()


def test_collection_names_are_the_field_collections_of_the_research_project():
    client = MagicMock()
    client.research_projects.where_project_collections.return_value = [
        SimpleNamespace(pk=1, collection_pk=11, name=n) for n in ("R0002", "Pilot", "r0001", "R0002", "R0039-SOLONOVIEMBRE", "R0003_b")
    ]
    with patch("wildintel_uploader.core.services.sync_service.trapper_service.client", return_value=client):
        assert sync_service.collection_names(CREDS, 2) == ["r0001", "R0002", "R0003_b"]
        assert [c["name"] for c in sync_service.project_collections(CREDS, 2)] == ["Pilot", "r0001", "R0002", "R0003_b", "R0039-SOLONOVIEMBRE"]
    client.research_projects.where_project_collections.assert_called_with(2, page_size=sync_service.trapper_service.LIST_PAGE_SIZE)


def test_only_the_chosen_collections_are_synced(tmp_path: Path):
    with patch("wildintel_uploader.core.services.sync_service.trapper_service.list_deployment_resources", return_value=RESOURCES), \
         patch("wildintel_uploader.core.services.sync_service.trapper_service.list_locations", return_value=LOCATIONS), \
         patch("wildintel_uploader.core.services.sync_service.trapper_service.list_deployments", return_value=DEPLOYMENTS), \
         patch("wildintel_uploader.core.services.sync_service.collection_names", return_value=["R0003", "R0004"]):
        result = sync_service.sync(CREDS, tmp_path, PROJECT, 10, ["r0004"])

    assert result["collections"] == ["R0004"]
    assert not (tmp_path / "DONA" / "R0003").exists()


def test_only_the_chosen_deployments_are_synced_and_the_others_are_not_called_unassigned(tmp_path: Path):
    with patch("wildintel_uploader.core.services.sync_service.trapper_service.list_deployment_resources", return_value=RESOURCES), \
         patch("wildintel_uploader.core.services.sync_service.trapper_service.list_locations", return_value=LOCATIONS), \
         patch("wildintel_uploader.core.services.sync_service.trapper_service.list_deployments", return_value=DEPLOYMENTS), \
         patch("wildintel_uploader.core.services.sync_service.collection_names", return_value=["R0003"]):
        result = sync_service.sync(CREDS, tmp_path, PROJECT, 10, None, ["r0003-dona_02"])

    assert result["created"]["deployments"] == ["R0003-DONA_02"]
    assert not (tmp_path / "DONA" / "R0003" / "R0003-DONA_01").exists()
    assert "R0003-DONA_01" not in result["unassigned"]


def test_the_endpoint_lists_the_field_collections_and_the_others_with_what_is_here(tmp_path: Path):
    from wildintel_uploader.web.main import app
    payload = {**dict(zip(("url", "username", "password"), CREDS)), "research_project_pk": 2, "research_project_acronym": "DONA"}
    _run(tmp_path)  # R0003 kept here, its deployments too
    collections = [{"pk": 11, "name": "R0003"}, {"pk": 12, "name": "R0039-SOLONOVIEMBRE"}, {"pk": 13, "name": "solo linces"}]
    with patch("wildintel_uploader.core.services.sync_service.trapper_service.list_deployments", return_value=DEPLOYMENTS), \
         patch("wildintel_uploader.core.services.sync_service.project_collections", return_value=collections), \
         patch("wildintel_uploader.web.api.routers.sync.config.collections_dir", return_value=tmp_path):
        response = TestClient(app).post("/api/sync/collection-names", json=payload)

    body = response.json()
    [field] = body["field"]
    assert field["name"] == "R0003" and "R0003-DONA_01" in field["deployments"]
    assert field["local"]["exists"] and "R0003-DONA_01" in field["local"]["deployments"] and field["local"]["with_images"] == []
    assert [o["name"] for o in body["other"]] == ["R0039-SOLONOVIEMBRE", "solo linces"]


def test_other_collections_are_downloaded_apart_by_their_images(tmp_path: Path):
    root = tmp_path / "collections"
    media = [SimpleNamespace(deploymentID="r0039-dona_01", fileName="a.jpg", filePath="https://t/a"),
             SimpleNamespace(deploymentID="r0039-dona_02", fileName="b.jpg", filePath="https://t/b")]
    client = MagicMock()
    client.classification_media.where_collection_media.return_value = media

    def fake_download(url, path):
        path.write_bytes(b"x")
        return 1

    with patch("wildintel_uploader.core.services.sync_service.trapper_service.client", return_value=client), \
         patch("wildintel_uploader.core.services.sync_service.trapper_service.file_downloader", return_value=fake_download):
        events = list(sync_service.download_collection_stream(CREDS, root, "DONA", 10, {"pk": 12, "name": "R0039/SOLO:NOV"}))
        again = list(sync_service.download_collection_stream(CREDS, root, "DONA", 10, {"pk": 12, "name": "R0039/SOLO:NOV"}))

    folder = tmp_path / "downloads" / "DONA" / "R0039_SOLO_NOV"
    assert (folder / "R0039-DONA_01" / "a.jpg").is_file() and (folder / "R0039-DONA_02" / "b.jpg").is_file()
    client.classification_media.where_collection_media.assert_called_with(10, 12, page_size=sync_service.trapper_service.LIST_PAGE_SIZE)
    assert "2 image(s) to download" in events[0]["message"] and "0 image(s) to download, 2 already here" in again[0]["message"]


def test_downloading_needs_a_classification_project(tmp_path: Path):
    import pytest
    with pytest.raises(local_folder_service.LocalFolderError, match="classification project"):
        list(sync_service.sync_stream(CREDS, tmp_path, PROJECT, None, download_images=True))


# ── Downloading the images ───────────────────────────────────────────────────────────────────────────────────────────

MEDIA = [  # what the classification project holds of R0003-DONA_01 (resource 91 is not in it)
    {"pk": 90, "name": "R0003-DONA_01__20240701_1.JPEG", "url": "https://trapper.example.org/storage/resource/media/90/file/?rt=tok"},
]


def _fake_downloader(fail=()):
    def download(url: str, destination: Path) -> int:
        if destination.name in fail:
            raise OSError("connection reset")
        destination.write_bytes(b"\xff\xd8\xff" + url.encode())
        return destination.stat().st_size
    return lambda *credentials: download


def _run_downloading(root: Path, media=MEDIA, fail=(), only=("R0003-DONA_01",)):
    with patch("wildintel_uploader.core.services.sync_service.trapper_service.list_deployment_resources", return_value=RESOURCES), \
         patch("wildintel_uploader.core.services.sync_service.trapper_service.list_deployment_media", return_value=media) as listed, \
         patch("wildintel_uploader.core.services.sync_service.trapper_service.file_downloader", side_effect=_fake_downloader(fail)), \
         patch("wildintel_uploader.core.services.sync_service.trapper_service.list_locations", return_value=LOCATIONS), \
         patch("wildintel_uploader.core.services.sync_service.trapper_service.list_deployments", return_value=DEPLOYMENTS), \
         patch("wildintel_uploader.core.services.sync_service.collection_names", return_value=["R0003"]):
        return sync_service.sync(CREDS, root, PROJECT, 10, only_deployments=list(only), download_images=True), listed


def test_the_images_are_not_downloaded_unless_asked(tmp_path: Path):
    result = _run(tmp_path)

    assert "downloaded" not in result
    assert not list((tmp_path / "DONA" / "R0003" / "R0003-DONA_01").glob("*.JPEG"))


def test_the_images_the_classification_project_holds_are_downloaded_into_the_deployment_folder(tmp_path: Path):
    result, listed = _run_downloading(tmp_path)

    folder = tmp_path / "DONA" / "R0003" / "R0003-DONA_01"
    assert (folder / "R0003-DONA_01__20240701_1.JPEG").read_bytes().startswith(b"\xff\xd8\xff")
    assert not list(folder.glob("*.part"))
    listed.assert_called_once_with(*CREDS, 10, 1)  # the classification project, and the deployment's pk
    assert result["downloaded"]["images"] == 1 and result["downloaded"]["deployments"] == {"R0003-DONA_01": 1}
    assert result["downloaded"]["bytes"] > 3 and result["downloaded"]["failed"] == []
    # Trapper lists two images for the deployment; the project holds one — the other is said, not hidden.
    assert result["downloaded"]["not_held"] == {"R0003-DONA_01": ["R0003-DONA_01__20240702_2.JPEG"]}
    assert json.loads((folder / "images.json").read_text(encoding="utf-8"))["source"] == "trapper"  # still a synced deployment


def test_what_is_already_downloaded_is_kept_and_a_failure_does_not_stop_the_rest(tmp_path: Path):
    media = MEDIA + [{"pk": 92, "name": "R0003-DONA_01__20240703_3.JPEG", "url": "https://trapper.example.org/x/92/?rt=t"},
                     {"pk": 93, "name": "R0003-DONA_01__20240704_4.JPEG", "url": "https://trapper.example.org/x/93/?rt=t"}]
    folder = tmp_path / "DONA" / "R0003" / "R0003-DONA_01"
    folder.mkdir(parents=True)
    (folder / "R0003-DONA_01__20240701_1.JPEG").write_bytes(b"mine")

    result, _ = _run_downloading(tmp_path, media=media, fail={"R0003-DONA_01__20240703_3.JPEG"})

    assert (folder / "R0003-DONA_01__20240701_1.JPEG").read_bytes() == b"mine"
    assert (folder / "R0003-DONA_01__20240704_4.JPEG").is_file() and not (folder / "R0003-DONA_01__20240703_3.JPEG").exists()
    assert result["downloaded"]["images"] == 1
    assert result["downloaded"]["failed"] == [{"deployment_id": "R0003-DONA_01", "name": "R0003-DONA_01__20240703_3.JPEG", "error": "connection reset"}]


def test_a_name_that_would_leave_the_deployment_folder_is_not_downloaded(tmp_path: Path):
    result, _ = _run_downloading(tmp_path, media=[{"pk": 1, "name": "../../escape.JPEG", "url": "https://trapper.example.org/x/1/?rt=t"}])

    assert result["downloaded"]["images"] == 0 and not (tmp_path / "escape.JPEG").exists()


def test_the_download_is_asked_for_by_the_endpoint(tmp_path: Path):
    from wildintel_uploader.web.main import app
    seen = {}

    def fake_stream(*args, **kwargs):
        seen["download_images"] = args[6] if len(args) > 6 else kwargs.get("download_images")
        yield {"type": "done"}

    with patch("wildintel_uploader.web.api.routers.sync.sync_service.sync_stream", side_effect=fake_stream), \
         patch("wildintel_uploader.web.api.routers.sync.resolve", return_value=CREDS):
        TestClient(app).post("/api/sync/collections", json={"research_project_pk": 2, "research_project_acronym": "DONA", "classification_project_pk": 10, "download_images": True})

    assert seen["download_images"] is True
