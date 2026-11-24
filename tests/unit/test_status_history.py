"""The history of the status of the locations, the cameras and the SD cards: a line for each change, with why."""
from pathlib import Path

from wildintel_uploader.core.services import local_folder_service as svc
from wildintel_uploader.core.services import status_history

LOCATION = {"location_id": "DONA_01", "name": "Doñana 1", "timezone": "UTC", "ignore_dst": False, "latitude": 37.1, "longitude": -6.4, "status": "pending"}


def _project(root: Path) -> None:
    svc.write_research_project(root, {"name": "Doñana", "acronym": "DONA"})


def _lines(root: Path, kind: str | None = None, name: str | None = None) -> list[tuple]:
    return [(l["kind"], l["name"], l["before"], l["after"], l["reason"], l["day"]) for l in status_history.list_history(root, "DONA", kind, name)]


def test_a_location_says_how_it_was_made_and_each_change_of_its_status_with_why_and_the_day_it_is_of(tmp_path: Path):
    _project(tmp_path)
    svc.write_location(tmp_path, "DONA", LOCATION)

    with status_history.because("The visit R0001 to DONA_01.", "2026-10-19"):
        svc.update_location(tmp_path, "DONA", "dona_01", {"status": "active"}, by_visit=True)
    svc.update_location(tmp_path, "DONA", "DONA_01", {"name": "Doñana uno"})   # not the status: nothing is written

    assert _lines(tmp_path, "locations", "DONA_01") == [
        ("locations", "DONA_01", None, "pending", "Created.", _lines(tmp_path)[0][5]),
        ("locations", "DONA_01", "pending", "active", "The visit R0001 to DONA_01.", "2026-10-19"),
    ]


def test_what_is_changed_with_no_reason_said_is_a_change_by_hand_and_the_cameras_and_the_cards_are_followed_by_their_label(tmp_path: Path):
    _project(tmp_path)
    svc.write_field_items(tmp_path, "DONA", "cameras", [{"label": "CAM1", "camera_id": "12", "status": "ready"}])
    kept = svc.list_field_items(tmp_path, "DONA", "cameras")
    svc.write_field_items(tmp_path, "DONA", "cameras", [{**kept[0], "status": "planned"}], by_hand=True)
    svc.write_field_items(tmp_path, "DONA", "cameras", [{**svc.list_field_items(tmp_path, "DONA", "cameras")[0], "model": "Reconyx"}], by_hand=True)   # nothing of the status

    lines = _lines(tmp_path, "cameras", "cam1")
    assert [(l[2], l[3], l[4]) for l in lines] == [(None, "ready", "Created."), ("ready", "planned", status_history.BY_HAND)]


def test_each_change_made_at_once_has_the_reason_of_its_own(tmp_path: Path):
    _project(tmp_path)
    svc.write_field_items(tmp_path, "DONA", "sd_cards", [{"label": "7b", "status": "active"}, {"label": "8", "status": "active"}])
    items = svc.list_field_items(tmp_path, "DONA", "sd_cards")

    with status_history.because("The visits.", None, {("sd_cards", "7b"): ("The visit R0002 to DONA_01.", "2026-11-02"), ("sd_cards", "8"): ("The visit R0002 to DONA_02.", "2026-11-03")}):
        svc.write_field_items(tmp_path, "DONA", "sd_cards", [{**i, "status": "ready"} for i in items])

    changed = [l for l in _lines(tmp_path, "sd_cards") if l[2] == "active"]
    assert sorted((l[1], l[4], l[5]) for l in changed) == [("7b", "The visit R0002 to DONA_01.", "2026-11-02"), ("8", "The visit R0002 to DONA_02.", "2026-11-03")]


def test_the_history_is_read_with_an_endpoint_by_kind_and_by_name(tmp_path: Path):
    from unittest.mock import patch

    from fastapi.testclient import TestClient

    from wildintel_uploader.web.main import app
    _project(tmp_path)
    svc.write_location(tmp_path, "DONA", LOCATION)
    svc.write_field_items(tmp_path, "DONA", "cameras", [{"label": "CAM1", "status": "ready"}])
    client = TestClient(app)
    with patch("wildintel_uploader.web.api.routers.app_settings._root", return_value=tmp_path):
        everything = client.post("/api/settings/status-history", json={"research_project_id": "DONA"}).json()["results"]
        cameras = client.post("/api/settings/status-history", json={"research_project_id": "DONA", "kind": "cameras"}).json()["results"]
        one = client.post("/api/settings/status-history", json={"research_project_id": "DONA", "kind": "locations", "name": "dona_01"}).json()["results"]
        missing = client.post("/api/settings/status-history", json={"research_project_id": "NOPE"})

    assert {(l["kind"], l["name"]) for l in everything} == {("locations", "DONA_01"), ("cameras", "CAM1")}
    assert [l["name"] for l in cameras] == ["CAM1"] and [l["name"] for l in one] == ["DONA_01"]
    assert missing.status_code == 400
