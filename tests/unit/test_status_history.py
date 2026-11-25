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


# ── what was kept before the history: rebuilt from the visits ────────────────────────────────────────────────────────────

def _kept_before_the_history(root: Path, location_status: str = "active", status_date: str | None = None) -> None:
    """A research project whose location, camera, cards and visits were kept before the history was: it has none."""
    from wildintel_uploader.core import storage
    from wildintel_uploader.core.schemas.requests import VisitRecord
    _project(root)
    svc.write_location(root, "DONA", {**LOCATION, "status": "pending"})
    svc.write_field_items(root, "DONA", "cameras", [{"label": "CAM1", "camera_id": "12", "status": "ready"}])
    svc.write_field_items(root, "DONA", "sd_cards", [{"label": "S1", "status": "ready"}, {"label": "S2", "status": "ready"}])
    visit = {"location_id": "DONA_01", "time": "09:00:00", "camera_id": "12", "num_photos": None}
    svc.write_visits(root, "DONA", [VisitRecord.model_validate(v).model_dump(mode="json") for v in [
        {**visit, "session": "R0001", "date": "2026-01-10", "actions": ["Installation"], "sd": "S1"},
        {**visit, "session": "R0002", "date": "2026-02-10", "actions": ["Revision"], "sd": "S2", "num_photos": 100},
        {**visit, "session": "R0003", "date": "2026-03-10", "actions": ["Desinstallation"], "num_photos": 50},
    ]])
    # what the records say now — the location as it was changed by hand, if it was
    svc.update_location(root, "DONA", "DONA_01", {"status": location_status, "status_date": status_date}, by_visit=True)
    svc.write_field_items(root, "DONA", "cameras", [{**c, "status": "ready"} for c in svc.list_field_items(root, "DONA", "cameras")])
    svc.write_field_items(root, "DONA", "sd_cards", [{**c, "status": "ready"} for c in svc.list_field_items(root, "DONA", "sd_cards")])
    storage.open_store(root).delete_records("DONA", "status_history")


def test_a_history_that_is_not_there_is_rebuilt_from_the_visits_the_first_time_it_is_asked_for(tmp_path: Path):
    _kept_before_the_history(tmp_path, "ready")

    lines = status_history.list_history(tmp_path, "DONA")

    assert all(l["reconstructed"] for l in lines)
    by = lambda kind, name: [(l["before"], l["after"], l["day"], l["reason"]) for l in lines if (l["kind"], l["name"]) == (kind, name)]
    assert by("locations", "DONA_01") == [("unknown", "active", "2026-01-10", "The visit R0001 to DONA_01."), ("active", "ready", "2026-03-10", "The visit R0003 to DONA_01.")]
    assert by("cameras", "CAM1") == [("unknown", "active", "2026-01-10", "The visit R0001 to DONA_01."), ("active", "ready", "2026-03-10", "The visit R0003 to DONA_01.")]
    assert [(b, a, d) for b, a, d, _ in by("sd_cards", "S1")] == [("unknown", "active", "2026-01-10"), ("active", "ready", "2026-02-10")]
    assert [(b, a, d) for b, a, d, _ in by("sd_cards", "S2")] == [("unknown", "active", "2026-02-10"), ("active", "ready", "2026-03-10")]
    assert [l["day"] for l in lines] == sorted(l["day"] for l in lines)          # the oldest first


def test_when_the_visits_do_not_end_in_the_status_of_today_a_last_line_says_so_of_its_day(tmp_path: Path):
    _kept_before_the_history(tmp_path, "archived", "2026-04-01")

    lines = status_history.list_history(tmp_path, "DONA", "locations", "DONA_01")

    assert (lines[-1]["before"], lines[-1]["after"], lines[-1]["day"]) == ("ready", "archived", "2026-04-01")
    assert lines[-1]["reason"] == "The status is archived, the visits say ready."


def test_it_is_rebuilt_once_and_again_on_request_without_writing_a_line_twice_nor_losing_one(tmp_path: Path):
    _kept_before_the_history(tmp_path, "ready")
    first = status_history.list_history(tmp_path, "DONA")
    svc.write_field_items(tmp_path, "DONA", "cameras", [{**c, "status": "planned"} for c in svc.list_field_items(tmp_path, "DONA", "cameras")], by_hand=True)

    again = status_history.list_history(tmp_path, "DONA")                         # there is one: it is not made again
    added = status_history.rebuild(tmp_path, "DONA")                             # nothing is lacking: nothing is added, the change by hand stays

    assert len(again) == len(first) + 1 and added == 0
    assert status_history.list_history(tmp_path, "DONA") == again
    assert again[-1]["reason"] == status_history.BY_HAND and not again[-1].get("reconstructed")


def test_a_research_project_with_no_visits_has_an_empty_history_written_so_that_it_is_not_made_again(tmp_path: Path):
    from wildintel_uploader.core import storage
    _project(tmp_path)

    assert status_history.list_history(tmp_path, "DONA") == []
    assert storage.open_store(tmp_path).has_records("DONA", "status_history")


def test_a_change_a_visit_wrote_as_it_happened_is_not_written_again_and_its_one_needs_no_last_line(tmp_path: Path):
    _kept_before_the_history(tmp_path, "active")                               # the visits say ready
    with status_history.because("The visit R0003 to DONA_01.", "2026-03-10"):     # as it was written when the visit was saved
        status_history.record_changes(tmp_path, "DONA", "locations", [{"location_id": "DONA_01", "status": "active"}], [{"location_id": "DONA_01", "status": "ready"}],
                                      lambda l: l["location_id"], lambda item, old: old[0])

    status_history.rebuild(tmp_path, "DONA")
    lines = status_history.list_history(tmp_path, "DONA", "locations", "DONA_01")

    assert [(l["after"], l["day"]) for l in lines].count(("ready", "2026-03-10")) == 1
    assert not any(l.get("to_today") for l in lines)


def test_the_history_is_rebuilt_with_an_endpoint(tmp_path: Path):
    from unittest.mock import patch

    from fastapi.testclient import TestClient

    from wildintel_uploader.web.main import app
    _kept_before_the_history(tmp_path, "ready")
    client = TestClient(app)
    with patch("wildintel_uploader.web.api.routers.app_settings._root", return_value=tmp_path):
        done = client.post("/api/settings/status-history/rebuild", json={"research_project_id": "DONA"})
        again = client.post("/api/settings/status-history/rebuild", json={"research_project_id": "DONA"})
        missing = client.post("/api/settings/status-history/rebuild", json={"research_project_id": "NOPE"})

    assert done.json() == {"added": 8} and again.json() == {"added": 0} and missing.status_code == 400
