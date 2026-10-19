"""Reading the form of the Epicollect5 project in the settings: its inputs, flattened, and what goes wrong said plainly."""
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
