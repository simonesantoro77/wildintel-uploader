"""Reading the form of the Epicollect5 project in the settings: its inputs, flattened, and what goes wrong said plainly."""
import time
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from wildintel_uploader.core import config
from wildintel_uploader.core.services import epicollect_service
from wildintel_uploader.web.main import app

PROJECT = {"data": {"project": {"name": "Doñana cameras", "slug": "donana-cameras", "forms": [{
    "ref": "f1", "name": "Visit", "inputs": [
        {"ref": "f1_a", "type": "readme", "question": "Read me first"},
        {"ref": "f1_b", "type": "text", "question": "Location"},
        {"ref": "f1_c", "type": "date", "question": "Start date"},
        {"ref": "f1_d", "type": "group", "question": "Camera", "group": [
            {"ref": "f1_e", "type": "text", "question": "Camera model"},
            {"ref": "f1_f", "type": "dropdown", "question": "Habitat", "possible_answers": [{"answer": "Pine"}, {"answer": "Marsh"}]},
        ]},
        {"ref": "f1_g", "type": "branch", "question": "Visits", "branch": [{"ref": "f1_h", "type": "integer", "question": "Height"}]},
    ],
}]}}}


@pytest.fixture(autouse=True)
def fresh_settings_file():
    config.DEFAULT_CONFIG_FILE.unlink(missing_ok=True)
    epicollect_service.forget_tokens()
    yield
    config.DEFAULT_CONFIG_FILE.unlink(missing_ok=True)


def test_the_inputs_of_every_form_are_listed_flat_leaving_out_what_holds_no_data():
    form = epicollect_service.parse_project(PROJECT)

    assert form["project"] == {"name": "Doñana cameras", "slug": "donana-cameras"}
    assert [i["ref"] for i in form["inputs"]] == ["f1_b", "f1_c", "f1_e", "f1_f", "f1_h"]
    by_ref = {i["ref"]: i for i in form["inputs"]}
    assert by_ref["f1_e"]["group"] == "Camera" and by_ref["f1_h"]["branch"] == "Visits"
    assert by_ref["f1_f"]["options"] == ["Pine", "Marsh"] and by_ref["f1_f"]["type"] == "dropdown"
    assert by_ref["f1_b"] == {"ref": "f1_b", "label": "Location", "type": "text", "form": "Visit", "group": None, "branch": None, "options": []}


def test_an_answer_without_a_project_says_what_epicollect_said():
    with pytest.raises(epicollect_service.EpicollectError, match="not found"):
        epicollect_service.parse_project({"errors": [{"title": "Project not found or private"}]})


def test_there_must_be_a_project_in_the_settings():
    with pytest.raises(epicollect_service.EpicollectError, match="no Epicollect5 project"):
        epicollect_service.fetch_form(config.Settings())


def test_a_public_project_is_read_without_a_token_and_a_private_one_with_it():
    settings = config.Settings()
    settings.EPICOLLECT5.project_slug = "donana-cameras"
    with patch("pyepicollect.api.get_project", return_value=PROJECT) as get_project:
        epicollect_service.fetch_form(settings)
        get_project.assert_called_once_with("donana-cameras", None)

    settings.EPICOLLECT5.client_id, settings.EPICOLLECT5.client_secret = "12", "secret"
    with patch("pyepicollect.api.get_project", return_value=PROJECT) as get_project, \
            patch("pyepicollect.auth.request_token", return_value={"access_token": "tok"}) as request_token:
        epicollect_service.fetch_form(settings)
        request_token.assert_called_once_with("12", "secret")
        get_project.assert_called_once_with("donana-cameras", "tok")


def test_a_refused_client_is_said():
    settings = config.Settings()
    settings.EPICOLLECT5.project_slug, settings.EPICOLLECT5.client_id, settings.EPICOLLECT5.client_secret = "p", "12", "bad"
    with patch("pyepicollect.auth.request_token", return_value={"error": "invalid_client"}):
        with pytest.raises(epicollect_service.EpicollectError, match="refused the client"):
            epicollect_service.fetch_form(settings)


def test_an_unreachable_server_is_said():
    settings = config.Settings()
    settings.EPICOLLECT5.project_slug = "p"
    with patch("pyepicollect.api.get_project", side_effect=OSError("no route")):
        with pytest.raises(epicollect_service.EpicollectError, match="Could not reach Epicollect5: no route"):
            epicollect_service.fetch_form(settings)


def test_the_endpoint_answers_the_form_or_a_400_with_the_reason():
    client = TestClient(app)
    assert "no Epicollect5 project" in client.get("/api/epicollect/form").json()["detail"]
    assert client.get("/api/epicollect/form").status_code == 400

    settings = config.Settings()
    settings.EPICOLLECT5.project_slug = "donana-cameras"
    config.save_settings(settings)
    with patch("pyepicollect.api.get_project", return_value=PROJECT):
        body = client.get("/api/epicollect/form").json()
    assert body["project"]["slug"] == "donana-cameras" and len(body["inputs"]) == 5


def test_the_mapping_is_kept_in_the_settings_with_its_keys_as_they_are():
    settings = config.Settings()
    settings.EPICOLLECT5.mapping = {"start_date": "f1_c", "camera_model": "f1_e"}
    config.save_settings(settings)

    assert config.load_settings().EPICOLLECT5.mapping == {"start_date": "f1_c", "camera_model": "f1_e"}
    assert TestClient(app).get("/api/settings").json()["EPICOLLECT5"]["mapping"] == {"start_date": "f1_c", "camera_model": "f1_e"}


def test_the_connection_is_tested_with_what_is_typed_and_says_what_it_found():
    with patch("pyepicollect.api.get_project", return_value=PROJECT) as get_project:
        found = epicollect_service.test_connection("donana-cameras", None, None, config.Settings())
    get_project.assert_called_once_with("donana-cameras", None)
    assert found == {"ok": True, "project": "Doñana cameras", "slug": "donana-cameras", "forms": 1, "inputs": 5}


def test_a_blank_secret_is_the_saved_one_of_the_same_client():
    settings = config.Settings()
    settings.EPICOLLECT5.client_id, settings.EPICOLLECT5.client_secret = "12", "secret"
    with patch("pyepicollect.api.get_project", return_value=PROJECT), \
            patch("pyepicollect.auth.request_token", return_value={"access_token": "tok"}) as request_token:
        epicollect_service.test_connection("p", "12", "", settings)
    request_token.assert_called_once_with("12", "secret")

    with pytest.raises(epicollect_service.EpicollectError, match="needs its secret"):
        epicollect_service.test_connection("p", "99", "", settings)


def test_testing_needs_a_slug_and_saves_nothing():
    with pytest.raises(epicollect_service.EpicollectError, match="slug"):
        epicollect_service.test_connection(" ", None, None, config.Settings())

    client = TestClient(app)
    assert client.post("/api/epicollect/test-connection", json={}).status_code == 400
    with patch("pyepicollect.api.get_project", return_value=PROJECT):
        body = client.post("/api/epicollect/test-connection", json={"project_slug": "donana-cameras"}).json()
    assert body["project"] == "Doñana cameras"
    assert config.load_settings().EPICOLLECT5.project_slug is None


def test_a_rate_limit_is_not_reported_as_a_refused_client():
    settings = config.Settings()
    settings.EPICOLLECT5.project_slug, settings.EPICOLLECT5.client_id, settings.EPICOLLECT5.client_secret = "p", "12", "secret"
    answer = {"errors": [{"code": "ec5_255", "title": "Too many requests. Try again later.", "source": "rate-limiter"}]}
    with patch("pyepicollect.auth.request_token", return_value=answer):
        with pytest.raises(epicollect_service.EpicollectError, match="Too many requests.*may be fine"):
            epicollect_service.fetch_form(settings)


# ── The entries ──────────────────────────────────────────────────────────────────────────────────────────────────────

MAPPING = {
    "location_id": "loc", "revision": "rev", "start_date": "sd", "start_time": "st", "end_date": "ed", "end_time": "et",
    "latitude": "gps", "longitude": "gps", "coordinate_uncertainty": "gps", "camera_model": "model", "camera_height": "height",
    "bait_use": "bait", "timestamp_issues": "issues", "feature_type": "feature", "tags": "tags", "habitat": "habitat",
}


def entry(uuid="u1", location="dona_0006", revision="3", created="2026-10-01T10:00:00.000Z", **more):
    return {"ec5_uuid": uuid, "title": location, "created_at": created, "loc": location, "rev": revision, "sd": "2024-09-04", "st": "13:10:00",
            "ed": "2024-10-12", "et": "07:02:41", "gps": {"latitude": 37.00915, "longitude": -6.47822, "accuracy": 12},
            "model": " Reconyx HyperFire 2 ", "height": "0,6", "bait": "yes", "issues": ["no"], "feature": "trailGame", "tags": ["a", "b"],
            "habitat": "", **more}


def test_an_entry_is_read_through_the_mapping_with_the_day_and_the_time_apart():
    found = epicollect_service.entry_fields(entry(), MAPPING)

    assert found == {
        "location_id": "dona_0006", "revision": 3, "start_date": "2024-09-04", "start_time": "13:10:00", "end_date": "2024-10-12", "end_time": "07:02:41",
        "latitude": 37.00915, "longitude": -6.47822, "coordinate_uncertainty": 12, "camera_model": "Reconyx HyperFire 2", "camera_height": 0.6,
        "bait_use": True, "timestamp_issues": False, "feature_type": "trailGame", "tags": ["a", "b"],
    }  # the blank habitat is not there


def test_dates_and_times_are_read_in_the_formats_epicollect5_uses():
    read = lambda sd, st: epicollect_service.entry_fields({"sd": sd, "st": st}, {"start_date": "sd", "start_time": "st"})
    assert read("2024-09-04T00:00:00.000Z", "13:10") == {"start_date": "2024-09-04", "start_time": "13:10:00"}
    assert read("04/09/2024", "1:10 PM") == {"start_date": "2024-09-04", "start_time": "13:10:00"}
    assert read("not a date", "later") == {}


def test_a_feature_type_the_standard_does_not_have_is_left_out():
    assert "feature_type" not in epicollect_service.entry_fields(entry(feature="dunes"), MAPPING)


def test_the_entries_of_a_location_and_revision_are_found_newest_first():
    settings = config.Settings()
    settings.EPICOLLECT5.enabled = True
    settings.EPICOLLECT5.project_slug, settings.EPICOLLECT5.mapping = "p", MAPPING
    answer = {"meta": {"last_page": 1}, "data": {"entries": [
        entry("old", created="2026-09-01T10:00:00.000Z"), entry("new"), entry("rev2", revision="2"), entry("other", location="dona_0007"),
    ]}}
    with patch("pyepicollect.api.get_entries", return_value=answer):
        found = epicollect_service.find_entries("DONA_0006", 3, settings)
        assert [e["uuid"] for e in found] == ["new", "old"]
        assert found[0]["fields"]["start_date"] == "2024-09-04"
        assert [e["uuid"] for e in epicollect_service.find_entries("dona_0006", None, settings)] == ["new", "rev2", "old"]


def test_without_a_revision_in_the_mapping_the_location_is_enough():
    settings = config.Settings()
    settings.EPICOLLECT5.enabled = True
    settings.EPICOLLECT5.project_slug, settings.EPICOLLECT5.mapping = "p", {"location_id": "loc"}
    with patch("pyepicollect.api.get_entries", return_value={"data": {"entries": [entry("a", revision="7")]}}):
        assert [e["uuid"] for e in epicollect_service.find_entries("dona_0006", 3, settings)] == ["a"]


def test_every_page_of_entries_is_read():
    settings = config.Settings()
    settings.EPICOLLECT5.enabled = True
    settings.EPICOLLECT5.project_slug, settings.EPICOLLECT5.mapping = "p", {"location_id": "loc"}
    pages = [{"meta": {"last_page": 2}, "data": {"entries": [entry("a")]}}, {"meta": {"last_page": 2}, "data": {"entries": [entry("b")]}}]
    with patch("pyepicollect.api.get_entries", side_effect=pages) as get_entries:
        assert {e["uuid"] for e in epicollect_service.find_entries("dona_0006", None, settings)} == {"a", "b"}
    assert [c.kwargs["page"] for c in get_entries.call_args_list] == [1, 2]


def test_the_location_must_be_mapped_and_chosen_and_what_epicollect5_says_is_said():
    settings = config.Settings()
    settings.EPICOLLECT5.enabled = True
    settings.EPICOLLECT5.project_slug = "p"
    with pytest.raises(epicollect_service.EpicollectError, match="location id is not mapped"):
        epicollect_service.find_entries("dona_0006", 3, settings)
    settings.EPICOLLECT5.mapping = {"location_id": "loc"}
    with pytest.raises(epicollect_service.EpicollectError, match="Choose the location"):
        epicollect_service.find_entries(" ", 3, settings)
    with patch("pyepicollect.api.get_entries", return_value={"errors": [{"title": "Project not found or private"}]}):
        with pytest.raises(epicollect_service.EpicollectError, match="not found or private"):
            epicollect_service.find_entries("dona_0006", 3, settings)


def test_nothing_is_read_while_epicollect5_is_turned_off():
    settings = config.Settings()
    settings.EPICOLLECT5.project_slug, settings.EPICOLLECT5.mapping = "p", MAPPING
    with patch("pyepicollect.api.get_entries") as get_entries:
        with pytest.raises(epicollect_service.EpicollectError, match="turned off"):
            epicollect_service.find_entries("dona_0006", 3, settings)
    get_entries.assert_not_called()


FORM = {"data": {"project": {"name": "P", "slug": "p", "forms": [{"ref": "f", "name": "Visit", "inputs": [
    {"ref": "loc", "type": "text", "question": "Location"}, {"ref": "note", "type": "text", "question": "Weather"},
    {"ref": "place", "type": "location", "question": "Spot"}, {"ref": "shot", "type": "photo", "question": "Photo"},
    {"ref": "kinds", "type": "checkbox", "question": "Seen"}, {"ref": "empty", "type": "text", "question": "Blank"},
    {"ref": "comments", "type": "text", "question": "Remarks"},
]}]}}}


def test_what_no_mapping_takes_goes_to_the_comments_when_asked():
    settings = config.Settings()
    settings.EPICOLLECT5.enabled = True
    settings.EPICOLLECT5.project_slug, settings.EPICOLLECT5.mapping = "p", {"location_id": "loc", "comments": "comments"}
    row = {"ec5_uuid": "u", "title": "t", "created_at": "", "loc": "dona_0006", "note": "Rain", "place": {"latitude": 37.1, "longitude": -6.4, "accuracy": 3},
           "shot": "a.jpg", "kinds": ["fox", "lynx"], "empty": " ", "comments": "Near the pond"}
    with patch("pyepicollect.api.get_entries", return_value={"data": {"entries": [row]}}), patch("pyepicollect.api.get_project", return_value=FORM):
        assert "Rain" not in epicollect_service.find_entries("dona_0006", None, settings)[0]["fields"].get("comments", "")
        settings.EPICOLLECT5.unmapped_to_comments = True
        comments = epicollect_service.find_entries("dona_0006", None, settings)[0]["fields"]["comments"]
    assert comments == "Near the pond\nWeather: Rain\nSpot: 37.1, -6.4\nSeen: fox, lynx"  # no photo, no blank answer


def test_the_entries_of_several_locations_are_found_reading_the_project_once():
    settings = config.Settings()
    settings.EPICOLLECT5.enabled = True
    settings.EPICOLLECT5.project_slug, settings.EPICOLLECT5.mapping = "p", MAPPING
    rows = [entry("a"), entry("b", location="dona_0007"), entry("c", location="dona_0007", created="2026-09-01T10:00:00.000Z"), entry("d", location="dona_0008", revision="9")]
    with patch("pyepicollect.api.get_entries", return_value={"data": {"entries": rows}}) as get_entries:
        found = epicollect_service.find_entries_of(["DONA_0006", "dona_0007", "dona_0008", "dona_0009"], 3, settings)
    assert get_entries.call_count == 1
    assert {k: [e["uuid"] for e in v] for k, v in found.items()} == {"dona_0006": ["a"], "dona_0007": ["b", "c"], "dona_0008": [], "dona_0009": []}


def test_the_batch_endpoint_answers_the_newest_entry_of_each_location_or_null():
    settings = config.Settings()
    settings.EPICOLLECT5.enabled = True
    settings.EPICOLLECT5.project_slug, settings.EPICOLLECT5.mapping = "p", MAPPING
    config.save_settings(settings)
    rows = [entry("a"), entry("b", location="dona_0007", created="2026-09-01T10:00:00.000Z"), entry("c", location="dona_0007")]
    with patch("pyepicollect.api.get_entries", return_value={"data": {"entries": rows}}):
        body = TestClient(app).post("/api/epicollect/entries/batch", json={"location_ids": ["DONA_0006", "dona_0007", "dona_0099"], "revision": 3}).json()
    assert body["results"]["DONA_0006"]["uuid"] == "a" and body["results"]["dona_0007"]["uuid"] == "c" and body["results"]["dona_0099"] is None


def test_the_entries_endpoint_answers_them_or_a_400():
    client = TestClient(app)
    assert client.post("/api/epicollect/entries", json={"location_id": "dona_0006"}).status_code == 400

    settings = config.Settings()
    settings.EPICOLLECT5.enabled = True
    settings.EPICOLLECT5.project_slug, settings.EPICOLLECT5.mapping = "p", MAPPING
    config.save_settings(settings)
    with patch("pyepicollect.api.get_entries", return_value={"data": {"entries": [entry("a")]}}):
        body = client.post("/api/epicollect/entries", json={"location_id": "dona_0006", "revision": 3}).json()
    assert body["results"][0]["uuid"] == "a" and body["results"][0]["fields"]["revision"] == 3


def test_the_token_is_kept_while_it_is_valid_and_asked_for_again_when_it_expires():
    settings = config.Settings()
    settings.EPICOLLECT5.project_slug, settings.EPICOLLECT5.client_id, settings.EPICOLLECT5.client_secret = "p", "12", "secret"
    with patch("pyepicollect.api.get_project", return_value=PROJECT), \
            patch("pyepicollect.auth.request_token", return_value={"access_token": "tok", "expires_in": 7200}) as request_token:
        epicollect_service.fetch_form(settings)
        epicollect_service.fetch_form(settings)
        epicollect_service.test_connection("p", "12", "", settings)
        assert request_token.call_count == 1

        with patch("time.monotonic", return_value=time.monotonic() + 7200):
            epicollect_service.fetch_form(settings)
        assert request_token.call_count == 2


def test_a_kept_token_that_epicollect5_no_longer_takes_is_replaced_once():
    settings = config.Settings()
    settings.EPICOLLECT5.project_slug, settings.EPICOLLECT5.client_id, settings.EPICOLLECT5.client_secret = "p", "12", "secret"
    tokens = iter([{"access_token": "old"}, {"access_token": "new"}])
    refused = {"errors": [{"title": "Unauthenticated"}]}
    answers = iter([PROJECT, refused, PROJECT])  # "old" gets in, then is refused, then "new" gets in
    with patch("pyepicollect.auth.request_token", side_effect=lambda *_: next(tokens)) as request_token, \
            patch("pyepicollect.api.get_project", side_effect=lambda slug, token: next(answers)) as get_project:
        epicollect_service.fetch_form(settings)
        epicollect_service.fetch_form(settings)  # "old" is kept, but refused: "new" is asked for, once
        assert request_token.call_count == 2
        assert get_project.call_args.args[1] == "new"
