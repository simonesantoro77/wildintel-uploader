"""/api/settings — the settings page's own endpoints: the password never goes
back, blank fields keep what was saved, the log can be downloaded and cleared."""
import json
import logging
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from wildintel_uploader.core import config, logging_setup
from wildintel_uploader.web.main import app


@pytest.fixture(autouse=True)
def fresh_settings_file(tmp_path: Path):
    """Every test starts from defaults, whatever an earlier one saved — with a collections folder of its own that has two research projects."""
    from wildintel_uploader.core.services import local_folder_service
    config.DEFAULT_CONFIG_FILE.unlink(missing_ok=True)
    for acronym in ("DONA", "TATR"):
        local_folder_service.write_research_project(tmp_path, {"name": acronym, "acronym": acronym})
    with patch("wildintel_uploader.web.api.routers.app_settings._root", return_value=tmp_path):
        yield
    config.DEFAULT_CONFIG_FILE.unlink(missing_ok=True)


def _client() -> TestClient:
    return TestClient(app)


def _put(**sections) -> dict:
    body = config.Settings().model_dump(mode="json")
    for name, values in sections.items():
        body[name].update(values)
    response = _client().put("/api/settings", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_the_defaults_have_every_section_and_every_check_shown():
    body = _client().get("/api/settings").json()

    assert set(body) == {"GENERAL", "TRAPPER", "EPICOLLECT5", "AGOUTI", "EPICOLLECTCSV", "DATA", "VALIDATION", "POSTVALIDATION", "PREPROCESSING", "FIELDLOG", "FIELDWORK"}
    assert all(body["VALIDATION"].values())
    assert body["POSTVALIDATION"]["tolerance_hours"] == 1.0
    assert body["GENERAL"]["log_level"] == "INFO"
    assert body["GENERAL"]["log_file"].endswith("wildintel-uploader.log")
    assert 1 <= body["GENERAL"]["workers"] <= 4 and body["GENERAL"]["cpu_count"] >= 1


def test_the_trappers_start_empty_and_are_saved_clean():
    assert _client().get("/api/settings").json()["FIELDWORK"] == {"trappers": [], "sd_cards": [], "cameras": [], "roles": []}

    saved = _put(FIELDWORK={"trappers": [
        {"username": " ana ", "name": "  Ana   Pérez ", "affiliation": " University of Huelva ", "email": " ana@uhu.es "}, {"username": "luis", "name": "Luis", "affiliation": "  ", "email": ""},
        {"username": "ana.2", "name": "Ana Pérez"},   # the same name as written: listed once — ana pérez would be another person
    ]})

    expected = [{"username": "ana", "name": "Ana Pérez", "affiliation": "University of Huelva", "email": "ana@uhu.es", "status": "active", "trapper_pk": None},
                {"username": "luis", "name": "Luis", "affiliation": None, "email": None, "status": "active", "trapper_pk": None}]
    assert _no_dates(saved["FIELDWORK"]["trappers"]) == expected
    assert _no_dates(_client().get("/api/settings").json()["FIELDWORK"]["trappers"]) == expected


def _no_dates(items: list[dict]) -> list[dict]:
    """The records without the dates the app writes (`created_at`, `updated_at`, `deleted_at`), which have their own tests."""
    return [{k: v for k, v in item.items() if k not in ("id", "created_at", "updated_at", "deleted_at")} for item in items]


def test_the_sd_cards_and_the_cameras_are_saved_clean_and_listed_once():
    saved = _put(FIELDWORK={
        "sd_cards": [{"label": " A12 ", "brand": " SanDisk ", "capacity": " 64   GB ", "in_service": "2026-03-01", "research_project": "DONA"}, {"label": "A12", "research_project": "DONA"},
                     {"label": "B3", "brand": "", "capacity": "", "in_service": "", "research_project": "DONA"}],
        "cameras": [{"camera_id": "P800HG0819", "camera_model": " Reconyx-PC800 ", "in_service": "2025-11-12", "research_project": "DONA"}, {"camera_id": "P800HG0819", "research_project": "DONA"},
                    {"camera_id": "X1", "in_service": "", "research_project": "DONA"}],
    })

    assert _no_dates(saved["FIELDWORK"]["sd_cards"]) == [
        {"label": "A12", "brand": "SanDisk", "capacity": "64 GB", "in_service": "2026-03-01", "research_project": "DONA", **ACTIVE},
        {"label": "B3", "brand": None, "capacity": None, "in_service": None, "research_project": "DONA", **ACTIVE},
    ]
    # kept in the folder of the research project, and read back as it was
    assert _client().get("/api/settings").json()["FIELDWORK"]["sd_cards"][0]["in_service"] == "2026-03-01"
    assert _no_dates(saved["FIELDWORK"]["cameras"]) == [
        {"label": "P800HG0819", "camera_id": "P800HG0819", "camera_model": "Reconyx-PC800", "in_service": "2025-11-12", "research_project": "DONA", **ACTIVE, **NO_POWER},
        {"label": "X1", "camera_id": "X1", "camera_model": None, "in_service": None, "research_project": "DONA", **ACTIVE, **NO_POWER},
    ]  # one kept before it had a label is called by its id


ACTIVE = {"status": "ready", "archive_reason": None, "status_date": None, "status_note": None}
NO_POWER = {"connectivity": None, "power_source": None, "battery_removable": None}   # what a camera says of its connection and its power when it says nothing


def test_a_camera_says_how_it_is_connected_and_what_it_runs_on_and_only_a_battery_says_if_it_can_be_taken_out():
    saved = _put(FIELDWORK={"cameras": [
        {"label": "A", "connectivity": "4g", "power_source": "battery", "battery_removable": "yes", "research_project": "DONA"},
        {"label": "B", "connectivity": "none", "power_source": "cells", "battery_removable": "yes", "research_project": "DONA"},   # cells are always taken out: nothing to say
        {"label": "C", "connectivity": "5g", "research_project": "DONA"},
    ]})["FIELDWORK"]["cameras"]
    by_label = {c["label"]: c for c in saved}

    assert (by_label["A"]["connectivity"], by_label["A"]["power_source"], by_label["A"]["battery_removable"]) == ("4g", "battery", "yes")
    assert (by_label["B"]["connectivity"], by_label["B"]["power_source"], by_label["B"]["battery_removable"]) == ("none", "cells", None)
    assert (by_label["C"]["connectivity"], by_label["C"]["power_source"], by_label["C"]["battery_removable"]) == ("5g", None, None)


def test_the_status_of_the_cameras_the_sd_cards_and_the_trappers_is_kept_and_only_the_known_ones_are_taken():
    saved = _put(FIELDWORK={
        "cameras": [{"camera_id": "X1", "status": "stolen", "status_date": "2026-05-02", "status_note": "  taken from the tree ", "research_project": "DONA"}],
        "sd_cards": [{"label": "A1", "status": "lost", "status_date": "", "research_project": "DONA"}],
        "trappers": [{"username": "ana", "name": "Ana", "status": "inactive"}],
    })

    # stolen, lost and broken are the reasons for being archived
    assert (saved["FIELDWORK"]["cameras"][0]["status"], saved["FIELDWORK"]["cameras"][0]["archive_reason"]) == ("archived", "stolen")
    assert saved["FIELDWORK"]["cameras"][0]["status_date"] == "2026-05-02"
    assert saved["FIELDWORK"]["cameras"][0]["status_note"] == "taken from the tree"
    assert (saved["FIELDWORK"]["sd_cards"][0]["status"], saved["FIELDWORK"]["sd_cards"][0]["archive_reason"], saved["FIELDWORK"]["sd_cards"][0]["status_date"]) == ("archived", "lost", None)
    assert saved["FIELDWORK"]["trappers"][0]["status"] == "inactive"

    # each has its own: a card is not planned, a trapper is not broken
    for field, item in (("sd_cards", {"label": "A1", "status": "planned"}), ("trappers", {"username": "ana", "name": "Ana", "status": "broken"}), ("cameras", {"camera_id": "X1", "status": "planned"})):
        body = config.Settings().model_dump(mode="json")
        body["FIELDWORK"][field] = [item]
        assert _client().put("/api/settings", json=body).status_code == 422


def test_the_sd_cards_and_the_cameras_belong_to_a_research_project_and_are_listed_once_in_each(tmp_path: Path):
    saved = _put(FIELDWORK={
        "sd_cards": [{"label": "A1", "research_project": " DONA "}, {"label": "A1", "research_project": "dona"}, {"label": "A1", "research_project": "TATR"}],
        "cameras": [{"camera_id": "X1", "research_project": "DONA"}, {"camera_id": "X1", "research_project": "DONA"}],
    })

    assert [(c["label"], c["research_project"]) for c in saved["FIELDWORK"]["sd_cards"]] == [("A1", "DONA"), ("A1", "TATR")]
    assert [(c["camera_id"], c["research_project"]) for c in saved["FIELDWORK"]["cameras"]] == [("X1", "DONA")]
    # each in the folder of its research project, as a file of its own — and not in the settings file
    assert [c["label"] for c in json.loads((tmp_path / "DONA" / "sd_cards.json").read_text(encoding="utf-8"))] == ["A1"]
    assert [c["label"] for c in json.loads((tmp_path / "TATR" / "sd_cards.json").read_text(encoding="utf-8"))] == ["A1"]
    assert config.load_settings().FIELDWORK.sd_cards == [] and config.load_settings().FIELDWORK.cameras == []


def test_a_camera_or_an_sd_card_without_a_research_project_is_refused():
    for field, item in (("sd_cards", {"label": "A1"}), ("cameras", {"camera_id": "X1", "research_project": ""})):
        body = config.Settings().model_dump(mode="json")
        body["FIELDWORK"][field] = [item]
        response = _client().put("/api/settings", json=body)
        assert response.status_code == 422 and "belongs to a research project" in response.json()["detail"]


def test_what_was_kept_in_the_settings_file_goes_to_the_research_projects_when_they_are_read(tmp_path: Path):
    legacy = config.Settings.model_validate({"FIELDWORK": {
        "sd_cards": [{"label": "A1", "research_project": "DONA"}, {"label": "Free"}, {"label": "B2", "research_project": "ELSEWHERE"}],
        "cameras": [{"camera_id": "X1", "research_project": "TATR"}],
    }})
    config.save_settings(legacy)

    shown = _client().get("/api/settings").json()["FIELDWORK"]

    # a card of a research project goes to it; one of none, or of a project that is not here, stays in the settings — to be assigned to a project — and is shown
    assert sorted((c["label"], c["research_project"] or "") for c in shown["sd_cards"]) == [("A1", "DONA"), ("B2", "ELSEWHERE"), ("Free", "")]
    assert [c["label"] for c in json.loads((tmp_path / "DONA" / "sd_cards.json").read_text(encoding="utf-8"))] == ["A1"]
    assert [c["camera_id"] for c in json.loads((tmp_path / "TATR" / "cameras.json").read_text(encoding="utf-8"))] == ["X1"]
    left = config.load_settings().FIELDWORK
    assert sorted(c.label for c in left.sd_cards) == ["B2", "Free"] and left.cameras == []


def test_a_camera_is_called_by_its_label_and_its_serial_number_is_optional():
    saved = _put(FIELDWORK={"cameras": [{"label": " North  gate ", "camera_id": " ", "research_project": "DONA"}, {"label": "North gate", "research_project": "DONA"},
                                        {"label": "Ridge", "camera_id": "P800 1", "research_project": "DONA"}]})

    assert [(c["label"], c["camera_id"]) for c in saved["FIELDWORK"]["cameras"]] == [("North gate", None), ("Ridge", "P800 1")]  # one label, once


def test_an_sd_card_needs_a_label_and_a_camera_one_too():
    for field, item in (("sd_cards", {"label": ""}), ("cameras", {"label": " ", "camera_id": ""})):
        body = config.Settings().model_dump(mode="json")
        body["FIELDWORK"][field] = [item]
        assert _client().put("/api/settings", json=body).status_code == 422


def test_a_trapper_needs_a_name():
    body = config.Settings().model_dump(mode="json")
    body["FIELDWORK"]["trappers"] = [{"username": "x", "name": ""}]

    assert _client().put("/api/settings", json=body).status_code == 422


def test_the_workers_are_saved_and_must_be_between_one_and_sixty_four():
    assert _put(GENERAL={"workers": 6})["GENERAL"]["workers"] == 6
    assert _client().get("/api/settings").json()["GENERAL"]["workers"] == 6
    body = config.Settings().model_dump(mode="json")
    for bad in (0, 65):
        body["GENERAL"]["workers"] = bad
        assert _client().put("/api/settings", json=body).status_code == 422


def test_the_data_folder_shown_by_default_is_a_folder_named_like_the_app_in_the_documents_folder():
    body = _client().get("/api/settings").json()

    assert body["DATA"]["dir"] == str(config.default_data_dir())
    assert Path(body["DATA"]["dir"]).name == "wildintel-uploader"


def test_the_password_never_goes_back_only_whether_one_is_saved():
    saved = _put(TRAPPER={"base_url": "https://trapper.example.org", "user_name": "alice", "user_password": "s3cret"})

    assert "user_password" not in saved["TRAPPER"]
    assert saved["TRAPPER"]["has_password"] is True
    assert "s3cret" not in _client().get("/api/settings").text


def test_a_blank_password_keeps_the_saved_one_and_blank_url_and_user_are_cleared():
    _put(TRAPPER={"base_url": "https://trapper.example.org", "user_name": "alice", "user_password": "s3cret"})

    saved = _put(TRAPPER={"base_url": "", "user_name": "", "user_password": ""})

    assert saved["TRAPPER"]["has_password"] is True
    assert saved["TRAPPER"]["base_url"] is None and saved["TRAPPER"]["user_name"] is None
    assert config.load_settings().TRAPPER.user_password == "s3cret"


def test_the_data_folder_can_be_changed_and_a_blank_one_goes_back_to_the_default(tmp_path: Path):
    assert _put(DATA={"dir": str(tmp_path / "images")})["DATA"]["dir"] == str(tmp_path / "images")
    assert config.collections_dir() == tmp_path / "images" / "collections"

    assert _put(DATA={"dir": ""})["DATA"]["dir"] == str(config.default_data_dir())


def test_the_collections_can_have_a_folder_of_their_own_and_otherwise_follow_the_data_folder(tmp_path: Path):
    saved = _put(DATA={"dir": str(tmp_path / "images")})
    assert saved["DATA"]["collections_dir"] is None and saved["DATA"]["default_collections_dir"] == str(tmp_path / "images" / "collections")

    saved = _put(DATA={"dir": str(tmp_path / "images"), "collections_dir": str(tmp_path / "elsewhere")})
    assert saved["DATA"]["collections_dir"] == str(tmp_path / "elsewhere")
    assert config.collections_dir() == tmp_path / "elsewhere"  # the data folder is not where they go any more
    assert config.data_dir() == tmp_path / "images"

    assert _put(DATA={"dir": str(tmp_path / "images"), "collections_dir": ""})["DATA"]["collections_dir"] is None
    assert config.collections_dir() == tmp_path / "images" / "collections"


def test_the_reports_and_the_packages_can_have_a_folder_of_their_own_and_otherwise_follow_the_data_folder(tmp_path: Path):
    saved = _put(DATA={"dir": str(tmp_path / "images")})
    assert saved["DATA"]["reports_dir"] is None and saved["DATA"]["packages_dir"] is None
    assert saved["DATA"]["default_reports_dir"] == str(tmp_path / "images" / "reports")
    assert saved["DATA"]["default_packages_dir"] == str(tmp_path / "images" / "packages")
    assert config.reports_dir() == tmp_path / "images" / "reports" and config.packages_dir() == tmp_path / "images" / "packages"

    _put(DATA={"dir": str(tmp_path / "images"), "reports_dir": str(tmp_path / "r"), "packages_dir": str(tmp_path / "p")})
    assert config.reports_dir() == tmp_path / "r" and config.packages_dir() == tmp_path / "p"

    _put(DATA={"dir": str(tmp_path / "images"), "reports_dir": "", "packages_dir": ""})
    assert config.reports_dir() == tmp_path / "images" / "reports"


def test_the_sessions_and_the_logs_have_no_setting_and_live_in_the_state_folder():
    body = config.Settings().model_dump(mode="json")
    assert "sessions_dir" not in body["DATA"] and "logs_dir" not in body["DATA"]
    assert config.get_sessions_dir().parts[-3:] == ("state", "wildintel-uploader", "sessions") or "wildintel-uploader" in config.get_sessions_dir().parts
    assert config.get_logs_dir().name.lower() in ("log", "logs")


def test_a_relative_folder_is_refused_for_the_collections_the_reports_and_the_packages():
    for key in ("collections_dir", "reports_dir", "packages_dir"):
        body = config.Settings().model_dump(mode="json")
        body["DATA"][key] = "relative/folder"

        assert _client().put("/api/settings", json=body).status_code == 422, key


def test_the_collections_folder_can_be_opened_even_outside_the_data_folder(tmp_path: Path):
    from unittest.mock import patch

    elsewhere = tmp_path / "elsewhere"
    (elsewhere / "DONA").mkdir(parents=True)
    _put(DATA={"dir": str(tmp_path / "images"), "collections_dir": str(elsewhere)})
    with patch("wildintel_uploader.web.api.routers.deployment_import._open_in_file_manager") as opened:
        assert _client().post("/api/deployment-import/open-folder", json={"path": str(elsewhere / "DONA")}).status_code == 200
        assert _client().post("/api/deployment-import/open-folder", json={"path": str(tmp_path)}).status_code == 400
    opened.assert_called_once()


def test_a_relative_data_folder_is_refused():
    body = config.Settings().model_dump(mode="json")
    body["DATA"]["dir"] = "relative/images"

    response = _client().put("/api/settings", json=body)

    assert response.status_code == 422
    assert "absolute" in response.text


def test_which_checks_are_shown_and_the_tolerance_are_saved():
    saved = _put(VALIDATION={"duplicates": False, "exif": False}, POSTVALIDATION={"location": False, "tolerance_hours": 2.5})

    assert saved["VALIDATION"]["duplicates"] is False and saved["VALIDATION"]["exif"] is False
    assert saved["VALIDATION"]["corrupted"] is True
    assert saved["POSTVALIDATION"]["location"] is False and saved["POSTVALIDATION"]["tolerance_hours"] == 2.5
    assert _client().get("/api/settings").json()["POSTVALIDATION"]["tolerance_hours"] == 2.5


@pytest.mark.parametrize("tolerance", [-1, 10_000])
def test_the_tolerance_must_be_within_its_limits(tolerance):
    body = config.Settings().model_dump(mode="json")
    body["POSTVALIDATION"]["tolerance_hours"] = tolerance

    assert _client().put("/api/settings", json=body).status_code == 422


def test_saving_applies_the_log_level_at_once():
    _put(GENERAL={"log_level": "DEBUG"})
    assert logging.getLogger().level == logging.DEBUG

    _put(GENERAL={"log_level": "WARNING"})
    assert logging.getLogger().level == logging.WARNING
    logging_setup.apply_level("INFO")


def test_a_log_level_that_is_not_one_is_refused():
    body = config.Settings().model_dump(mode="json")
    body["GENERAL"]["log_level"] = "CHATTY"

    assert _client().put("/api/settings", json=body).status_code == 422


def test_the_log_can_be_downloaded_once_there_is_one_and_cleared():
    path = logging_setup.log_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("a log line\n", encoding="utf-8")

    downloaded = _client().get("/api/settings/log")
    assert downloaded.status_code == 200 and "a log line" in downloaded.text

    assert _client().delete("/api/settings/log").json()["deleted"] >= 1
    # Logging goes on into a new file, so a fresh log may already be there — but not the old line.
    after = _client().get("/api/settings/log")
    assert after.status_code == 404 or "a log line" not in after.text


def test_the_preprocessing_settings_are_saved_and_come_back():
    saved = _put(PREPROCESSING={"resize": False, "resize_width": 1600, "owner": "Universidad de Huelva", "coverage": "Doñana National Park"})

    assert saved["PREPROCESSING"]["resize"] is False and saved["PREPROCESSING"]["resize_width"] == 1600
    assert saved["PREPROCESSING"]["owner"] == "Universidad de Huelva" and saved["PREPROCESSING"]["rename"] is True
    assert _client().get("/api/settings").json()["PREPROCESSING"]["coverage"] == "Doñana National Park"


@pytest.mark.parametrize("bad", [{"resize_width": 50}, {"resize_width": 99999}])
def test_the_resize_width_must_be_within_its_limits(bad):
    body = config.Settings().model_dump(mode="json")
    body["PREPROCESSING"].update(bad)

    assert _client().put("/api/settings", json=body).status_code == 422


# ── several configs ──────────────────────────────────────────────────────────

@pytest.fixture
def config_dir(tmp_path, monkeypatch):
    """Points the config files (default, extra ones, active pointer) at a temp dir."""
    monkeypatch.setattr(config, "DEFAULT_CONFIG_FILE", tmp_path / "settings.toml")
    monkeypatch.setattr(config, "CONFIGS_DIR", tmp_path / "configs")
    monkeypatch.setattr(config, "ACTIVE_CONFIG_POINTER", tmp_path / "active-config")
    config.save_settings(config.Settings())
    return tmp_path


def _save_trapper_user(client: TestClient, name: str) -> None:
    body = client.get("/api/settings").json()
    body["TRAPPER"]["user_name"] = name
    body["TRAPPER"]["user_password"] = ""
    assert client.put("/api/settings", json=body).status_code == 200


def test_lists_the_default_config_as_the_active_one(config_dir):
    assert _client().get("/api/settings/configs").json() == [
        {"id": "default", "name": "Default config", "path": str(config_dir / "settings.toml"), "active": True},
    ]


def test_a_new_config_has_the_default_values_and_is_not_activated(config_dir):
    client = _client()
    _save_trapper_user(client, "alice")

    configs = client.post("/api/settings/configs", json={"name": "Project B"}).json()

    assert [(c["id"], c["active"]) for c in configs] == [("default", True), ("project-b", False)]
    assert (config_dir / "configs" / "project-b.toml").is_file()
    assert client.get("/api/settings").json()["TRAPPER"]["user_name"] == "alice"  # the default config's own edit
    client.post("/api/settings/configs/project-b/activate")
    assert client.get("/api/settings").json()["TRAPPER"]["user_name"] is None  # the new one starts from defaults


def test_saving_goes_to_the_active_config_only(config_dir):
    client = _client()
    client.post("/api/settings/configs", json={"name": "B"})
    client.post("/api/settings/configs/b/activate")

    _save_trapper_user(client, "bob")

    assert 'user_name = "bob"' in (config_dir / "configs" / "b.toml").read_text(encoding="utf-8")
    assert "bob" not in (config_dir / "settings.toml").read_text(encoding="utf-8")


def test_the_active_config_is_the_one_the_rest_of_the_app_reads(config_dir):
    client = _client()
    client.post("/api/settings/configs", json={"name": "B"})
    client.post("/api/settings/configs/b/activate")
    _save_trapper_user(client, "bob")

    assert config.load_settings().TRAPPER.user_name == "bob"
    assert config.active_config_file() == config_dir / "configs" / "b.toml"
    client.post("/api/settings/configs/default/activate")
    assert config.load_settings().TRAPPER.user_name is None


def test_two_configs_with_the_same_name_get_different_ids(config_dir):
    client = _client()
    client.post("/api/settings/configs", json={"name": "Same"})
    configs = client.post("/api/settings/configs", json={"name": "Same"}).json()

    assert [c["id"] for c in configs] == ["default", "same", "same-2"]


def test_a_config_needs_a_usable_name_and_an_existing_id_to_activate(config_dir):
    client = _client()

    assert client.post("/api/settings/configs", json={"name": "  !! "}).status_code == 400
    assert client.post("/api/settings/configs/nope/activate").status_code == 404
    assert client.get("/api/settings/configs/nope/download").status_code == 404


def test_a_missing_active_config_falls_back_to_the_default_one(config_dir):
    client = _client()
    client.post("/api/settings/configs", json={"name": "B"})
    client.post("/api/settings/configs/b/activate")
    (config_dir / "configs" / "b.toml").unlink()

    assert [(c["id"], c["active"]) for c in client.get("/api/settings/configs").json()] == [("default", True)]


def test_a_config_can_be_downloaded_and_its_folder_opened(config_dir):
    client = _client()
    client.post("/api/settings/configs", json={"name": "B"})

    response = client.get("/api/settings/configs/b/download")
    assert response.status_code == 200
    assert "b.toml" in response.headers["content-disposition"]
    assert response.text == (config_dir / "configs" / "b.toml").read_text(encoding="utf-8")

    with patch("wildintel_uploader.web.api.routers.app_settings.file_manager.open_folder") as opener:
        assert client.post("/api/settings/configs/b/open-folder").status_code == 200
    opener.assert_called_once_with(config_dir / "configs")


def test_log_files_left_next_to_the_settings_are_moved_to_the_log_folder():
    from wildintel_uploader.core import logging_setup

    for leftover in config.get_logs_dir().glob("wildintel-uploader.log*"):  # the tests' own logging may have started one already
        leftover.unlink()
    old = config.legacy_logs_dir()
    old.mkdir(parents=True, exist_ok=True)
    (old / "wildintel-uploader.log").write_text("an old line\n", encoding="utf-8")
    (old / "wildintel-uploader.log.1").write_text("an older one\n", encoding="utf-8")

    logging_setup.migrate_legacy_logs()

    assert (config.get_logs_dir() / "wildintel-uploader.log").read_text(encoding="utf-8") == "an old line\n"
    assert (config.get_logs_dir() / "wildintel-uploader.log.1").is_file()
    assert not old.exists()


def test_a_camera_and_an_sd_card_are_marked_as_not_available_by_what_the_visit_says(tmp_path: Path):
    body = config.Settings().model_dump(mode="json")
    body["FIELDWORK"]["cameras"] = [{"label": "CAM-001", "camera_id": "BR5071050724", "research_project": "DONA"}, {"label": "CAM-002", "research_project": "DONA"}]
    body["FIELDWORK"]["sd_cards"] = [{"label": "1B", "research_project": "DONA"}]
    assert _client().put("/api/settings", json=body).status_code == 200

    camera = _client().post("/api/settings/field-item-status", json={"research_project_id": "DONA", "kind": "cameras", "key": "BR5071050724", "status": "stolen", "status_date": "2026-10-29", "status_note": "Stolen"})
    card = _client().post("/api/settings/field-item-status", json={"research_project_id": "DONA", "kind": "sd_cards", "key": "1B", "status": "stolen", "status_date": "2026-10-29"})
    nobody = _client().post("/api/settings/field-item-status", json={"research_project_id": "DONA", "kind": "cameras", "key": "nobody", "status": "stolen"})
    other_case = _client().post("/api/settings/field-item-status", json={"research_project_id": "DONA", "kind": "sd_cards", "key": "1b", "status": "stolen"})   # 1b is not 1B
    shown = _client().get("/api/settings").json()["FIELDWORK"]

    assert camera.json() == {"updated": True} and card.json() == {"updated": True} and nobody.json() == {"updated": False} and other_case.json() == {"updated": False}
    assert {c["label"]: (c["status"], c["archive_reason"], c["status_date"]) for c in shown["cameras"]} == {"CAM-001": ("archived", "stolen", "2026-10-29"), "CAM-002": ("ready", None, None)}
    assert (shown["sd_cards"][0]["status"], shown["sd_cards"][0]["archive_reason"]) == ("archived", "stolen")


def test_a_archived_camera_or_sd_card_is_not_changed(tmp_path: Path):
    body = config.Settings().model_dump(mode="json")
    body["FIELDWORK"]["cameras"] = [{"label": "CAM-001", "camera_id": "BR1", "research_project": "DONA", "status": "archived", "status_date": "2026-10-01"}]
    body["FIELDWORK"]["sd_cards"] = [{"label": "1B", "research_project": "DONA", "status": "archived"}]
    assert _client().put("/api/settings", json=body).status_code == 200

    body["FIELDWORK"]["cameras"][0]["status"] = "active"
    back = _client().put("/api/settings", json=body)
    body["FIELDWORK"]["cameras"][0]["status"] = "archived"
    body["FIELDWORK"]["cameras"][0]["camera_model"] = "Browning"
    edited = _client().put("/api/settings", json=body)
    body["FIELDWORK"]["cameras"][0].pop("camera_model")
    body["FIELDWORK"]["sd_cards"][0]["brand"] = "SanDisk"
    card = _client().put("/api/settings", json=body)
    marked = _client().post("/api/settings/field-item-status", json={"research_project_id": "DONA", "kind": "cameras", "key": "BR1", "status": "stolen"})

    assert back.status_code == edited.status_code == card.status_code == 422 and "archived for good" in back.json()["detail"]
    assert marked.json() == {"updated": False}


def test_each_source_of_visits_and_each_uploader_can_be_used_or_not(tmp_path: Path):
    shown = _client().get("/api/settings").json()
    # by default: the new WildINTEL CSV and Trapper are used; Epicollect and Agouti are not
    assert (shown["EPICOLLECTCSV"]["enabled"], shown["EPICOLLECT5"]["enabled"], shown["TRAPPER"]["enabled"], shown["AGOUTI"]["enabled"]) == (True, False, True, False)

    saved = _put(EPICOLLECTCSV={"enabled": False}, EPICOLLECT5={"enabled": True}, TRAPPER={"enabled": False}, AGOUTI={"enabled": True})

    assert (saved["EPICOLLECTCSV"]["enabled"], saved["EPICOLLECT5"]["enabled"], saved["TRAPPER"]["enabled"], saved["AGOUTI"]["enabled"]) == (False, True, False, True)


def test_what_an_upload_to_agouti_needs_is_kept_and_its_key_is_not_shown(tmp_path: Path):
    saved = _put(AGOUTI={"enabled": True, "base_url": " https://api.agouti.eu ", "api_key": "secret-key", "project_id": " 42 "})

    assert (saved["AGOUTI"]["base_url"], saved["AGOUTI"]["project_id"], saved["AGOUTI"]["has_api_key"]) == ("https://api.agouti.eu", "42", True)
    assert "api_key" not in saved["AGOUTI"]
    # a blank key keeps the one saved, as the passwords do
    again = _put(AGOUTI={"enabled": True, "base_url": "https://api.agouti.eu", "api_key": "", "project_id": "42"})
    assert again["AGOUTI"]["has_api_key"] is True
    assert config.load_settings().AGOUTI.api_key == "secret-key"


def test_a_trapper_can_have_several_roles_in_a_project_but_not_the_same_one_twice():
    from wildintel_uploader.core.config import FieldworkSettings
    roles = FieldworkSettings(roles=[
        {"research_project": "DONA", "trapper": "Ana Pérez", "role": "contact"},
        {"research_project": "DONA", "trapper": "Ana Pérez", "role": "principalInvestigator"},
        {"research_project": "dona", "trapper": "ana pérez", "role": "contact"},
    ]).roles
    assert [(r.trapper, r.role) for r in roles] == [("Ana Pérez", "contact"), ("Ana Pérez", "principalInvestigator")]


def test_a_camera_and_an_sd_card_get_the_date_they_were_created_and_changed_from_the_app_and_never_from_the_page():
    from wildintel_uploader.core.services import audit
    with patch.object(audit, "now", return_value="2026-11-01T10:00:00Z"):
        first = _put(FIELDWORK={"sd_cards": [{"label": "A12", "research_project": "DONA", "created_at": "1999-01-01T00:00:00Z"}],
                                "cameras": [{"label": "C1", "research_project": "DONA"}]})["FIELDWORK"]
    # a new one: both dates are the instant it was kept — what the page sent for them is not taken
    assert (first["sd_cards"][0]["created_at"], first["sd_cards"][0]["updated_at"]) == ("2026-11-01T10:00:00Z", "2026-11-01T10:00:00Z")
    assert (first["cameras"][0]["created_at"], first["cameras"][0]["updated_at"]) == ("2026-11-01T10:00:00Z", "2026-11-01T10:00:00Z")

    # saved again as it is — the page sends back what it has: nothing changed, so nothing is touched
    with patch.object(audit, "now", return_value="2026-11-02T10:00:00Z"):
        again = _put(FIELDWORK={"sd_cards": first["sd_cards"], "cameras": first["cameras"]})["FIELDWORK"]
    assert (again["sd_cards"][0]["created_at"], again["sd_cards"][0]["updated_at"]) == ("2026-11-01T10:00:00Z", "2026-11-01T10:00:00Z")

    # changed: it keeps when it was created and says when it was changed — and only the one that changed
    changed = {**first["sd_cards"][0], "brand": "SanDisk"}
    with patch.object(audit, "now", return_value="2026-11-03T10:00:00Z"):
        after = _put(FIELDWORK={"sd_cards": [changed], "cameras": first["cameras"]})["FIELDWORK"]
    assert (after["sd_cards"][0]["created_at"], after["sd_cards"][0]["updated_at"]) == ("2026-11-01T10:00:00Z", "2026-11-03T10:00:00Z")
    assert after["cameras"][0]["updated_at"] == "2026-11-01T10:00:00Z"


def test_where_the_records_are_kept_is_a_setting_and_only_a_backend_that_exists_can_be_chosen():
    assert _client().get("/api/settings").json()["DATA"]["storage"] == "json"            # the files of the collections folder, as it has always been
    bad = _client().put("/api/settings", json={**_client().get("/api/settings").json(), "DATA": {**_client().get("/api/settings").json()["DATA"], "storage": "oracle"}})
    assert bad.status_code == 422 and "no storage called 'oracle'" in bad.json()["detail"]


def test_the_page_that_does_not_send_where_the_records_are_kept_does_not_lose_it():
    from wildintel_uploader.core import storage
    storage.register("other", storage.JsonFolderStore)
    try:
        body = _client().get("/api/settings").json()
        body["DATA"]["storage"] = "other"
        assert _client().put("/api/settings", json=body).status_code == 200
        body["DATA"].pop("storage")                       # as the settings page sends its folders: it does not show where the records are kept
        assert _client().put("/api/settings", json=body).status_code == 200
        assert config.load_settings().DATA.storage == "other" and storage.selected() == "other"
    finally:
        storage._FACTORIES.pop("other", None)
        storage.configure("json")


def test_nothing_is_deleted_for_good_what_the_page_no_longer_lists_is_kept_with_its_deleted_at_and_comes_back_when_it_is_listed_again(tmp_path: Path):
    from wildintel_uploader.core.services import audit, local_folder_service as svc
    with patch.object(audit, "now", return_value="2026-11-01T10:00:00Z"):
        _put(FIELDWORK={"trappers": [{"username": "ana", "name": "Ana"}, {"username": "luis", "name": "Luis"}], "sd_cards": [{"label": "A1", "research_project": "DONA"}, {"label": "A2", "research_project": "DONA"}],
                        "cameras": [{"label": "C1", "research_project": "DONA"}], "roles": [{"research_project": "DONA", "trapper": "Ana", "role": "contact"}]})
    with patch.object(audit, "now", return_value="2026-11-02T10:00:00Z"):
        shown = _put(FIELDWORK={"trappers": [{"username": "ana", "name": "Ana"}], "sd_cards": [{"label": "A1", "research_project": "DONA"}], "cameras": [], "roles": []})["FIELDWORK"]
    # the page sees what is left…
    assert [t["name"] for t in shown["trappers"]] == ["Ana"] and [c["label"] for c in shown["sd_cards"]] == ["A1"] and shown["cameras"] == [] and shown["roles"] == []
    # …and what was removed is kept, with when
    assert {t["name"]: t.get("deleted_at") for t in svc.list_trappers(tmp_path, include_deleted=True)} == {"Ana": None, "Luis": "2026-11-02T10:00:00Z"}
    cards = {c["label"]: c for c in svc.list_field_items(tmp_path, "DONA", "sd_cards", include_deleted=True)}
    assert cards["A2"]["deleted_at"] == "2026-11-02T10:00:00Z" and cards["A2"]["created_at"] == "2026-11-01T10:00:00Z" and "deleted_at" not in cards["A1"]
    assert [r["role"] for r in svc.list_roles(tmp_path, "DONA", include_deleted=True)] == ["contact"] and svc.list_roles(tmp_path, "DONA") == []

    # listed again: they come back, as they were created
    with patch.object(audit, "now", return_value="2026-11-03T10:00:00Z"):
        back = _put(FIELDWORK={"trappers": [{"username": "ana", "name": "Ana"}, {"username": "luis", "name": "Luis"}], "sd_cards": [{"label": "A2", "research_project": "DONA"}], "cameras": [], "roles": []})["FIELDWORK"]
    luis = next(t for t in back["trappers"] if t["name"] == "Luis")
    assert luis.get("deleted_at") is None and luis["created_at"] == "2026-11-01T10:00:00Z" and luis["updated_at"] == "2026-11-03T10:00:00Z"
    cards = {c["label"]: c for c in svc.list_field_items(tmp_path, "DONA", "sd_cards", include_deleted=True)}
    assert cards["A2"].get("deleted_at") is None and cards["A1"]["deleted_at"] == "2026-11-03T10:00:00Z"


def test_the_roles_are_the_projects_and_not_the_settings(tmp_path: Path):
    from wildintel_uploader.core.services import local_folder_service as svc
    saved = _put(FIELDWORK={"trappers": [{"username": "ana", "name": "Ana"}], "roles": [{"research_project": "DONA", "trapper": "Ana", "role": "contact"}, {"research_project": "NOWHERE", "trapper": "Ana", "role": "publisher"}]})
    assert sorted((r["research_project"], r["role"]) for r in saved["FIELDWORK"]["roles"]) == [("DONA", "contact"), ("NOWHERE", "publisher")]
    assert [r["role"] for r in svc.list_roles(tmp_path, "DONA")] == ["contact"]                                   # kept in the research project
    assert [(r.research_project, r.role) for r in config.load_settings().FIELDWORK.roles] == [("NOWHERE", "publisher")]   # only what has no project here stays in the settings


def test_a_trapper_without_a_username_or_with_one_that_another_has_is_refused_and_the_username_is_what_tells_one_from_another(tmp_path: Path):
    body = config.Settings().model_dump(mode="json")
    body["FIELDWORK"]["trappers"] = [{"name": "Ana"}]
    assert _client().put("/api/settings", json=body).status_code == 422                       # the username is required
    body["FIELDWORK"]["trappers"] = [{"username": "ana", "name": "Ana"}, {"username": "ANA", "name": "Anabel"}]
    refused = _client().put("/api/settings", json=body)
    assert refused.status_code == 422 and "unique" in refused.text
    body["FIELDWORK"]["trappers"] = [{"username": "ana", "name": "Ana", "email": "ana@uhu.es"}]
    assert _client().put("/api/settings", json=body).status_code == 200
    # changing the name of a username is a change of that trapper, not another one: it keeps when it was created
    from wildintel_uploader.core.services import local_folder_service as svc
    first = svc.list_trappers(tmp_path)[0]
    body["FIELDWORK"]["trappers"] = [{"username": "ana", "name": "Ana Pérez López"}]
    _client().put("/api/settings", json=body)
    now = svc.list_trappers(tmp_path)
    assert [(t["username"], t["name"], t.get("email")) for t in now] == [("ana", "Ana Pérez López", None)] and now[0]["created_at"] == first["created_at"]


def test_what_the_page_says_with_the_id_it_was_given_is_the_same_one_even_if_it_is_renamed(tmp_path: Path):
    from wildintel_uploader.core.services import local_folder_service as svc
    first = _put(FIELDWORK={"trappers": [{"username": "ana", "name": "Ana"}], "sd_cards": [{"label": "A1", "research_project": "DONA"}]})["FIELDWORK"]
    ana, card = first["trappers"][0], first["sd_cards"][0]
    assert len(ana["id"]) == 36 and len(card["id"]) == 36                                          # the ids the app generated

    # the page corrects the username and the label, and sends back what it was given
    renamed = _put(FIELDWORK={"trappers": [{**ana, "username": "ana.perez"}], "sd_cards": [{**card, "label": "A-1"}]})["FIELDWORK"]
    assert (renamed["trappers"][0]["id"], renamed["trappers"][0]["username"]) == (ana["id"], "ana.perez")
    assert (renamed["sd_cards"][0]["id"], renamed["sd_cards"][0]["label"]) == (card["id"], "A-1")
    assert len(svc.list_trappers(tmp_path, include_deleted=True)) == 1                            # not a trapper deleted and another one added
    assert config.load_settings().FIELDWORK.trappers == []                                        # the people are not kept in the settings
    assert len(svc.list_field_items(tmp_path, "DONA", "sd_cards", include_deleted=True)) == 1

    # and an id the page makes up is not taken: a new one is kept with an id of the app's
    forged = _put(FIELDWORK={"trappers": [{"username": "luis", "name": "Luis", "id": "mine"}]})["FIELDWORK"]["trappers"][0]
    assert forged["id"] != "mine" and len(forged["id"]) == 36


def test_the_status_of_a_camera_by_hand_follows_what_the_visits_say(tmp_path, monkeypatch):
    from wildintel_uploader.core.services import local_folder_service as svc
    from wildintel_uploader.core.config import FieldworkSettings  # noqa: F401

    svc.write_location(tmp_path, "DONA", {"location_id": "DONA_01", "timezone": "UTC", "ignore_dst": False, "latitude": 1.0, "longitude": 1.0})
    svc.write_field_items(tmp_path, "DONA", "cameras", [{"label": "CAM-1", "camera_id": "P800", "status": "ready"}])

    def by_hand(status: str) -> str:
        items = svc.list_field_items(tmp_path, "DONA", "cameras")
        try:
            svc.write_field_items(tmp_path, "DONA", "cameras", [{**items[0], "status": status}], by_hand=True)
            return svc.list_field_items(tmp_path, "DONA", "cameras")[0]["status"]
        except svc.LocalFolderError as exc:
            return str(exc)

    free = (by_hand("planned"), by_hand("ready"), by_hand("active"))
    svc.write_visits(tmp_path, "DONA", [{"location_id": "DONA_01", "session": "R0001", "when": "2026-01-01T09:00:00Z", "actions": ["Installation"], "camera_id": "P800", "sd": "A1"}])
    out = (by_hand("planned"), by_hand("archived"))
    svc.write_visits(tmp_path, "DONA", [{"location_id": "DONA_01", "session": "R0002", "when": "2026-02-01T09:00:00Z", "actions": ["Revision", "Desinstallation"], "camera_id": "P800", "num_photos": 1}])
    back = (by_hand("planned"), by_hand("ready"), by_hand("archived"))

    assert free[0] == "planned" and free[1] == "ready" and "a visit does it" in free[2]
    assert all("is put up at DONA_01" in o for o in out)
    assert back == ("planned", "ready", "archived")


def test_the_status_of_an_sd_card_by_hand_follows_what_the_visits_say(tmp_path):
    from wildintel_uploader.core.services import local_folder_service as svc

    svc.write_location(tmp_path, "DONA", {"location_id": "DONA_01", "timezone": "UTC", "ignore_dst": False, "latitude": 1.0, "longitude": 1.0})
    svc.write_field_items(tmp_path, "DONA", "sd_cards", [{"label": "A1", "status": "ready"}])

    def by_hand(status: str) -> str:
        items = svc.list_field_items(tmp_path, "DONA", "sd_cards")
        try:
            svc.write_field_items(tmp_path, "DONA", "sd_cards", [{**items[0], "status": status}], by_hand=True)
            return svc.list_field_items(tmp_path, "DONA", "sd_cards")[0]["status"]
        except svc.LocalFolderError as exc:
            return str(exc)

    free = (by_hand("planned"), by_hand("ready"), by_hand("active"))
    svc.write_visits(tmp_path, "DONA", [{"location_id": "DONA_01", "session": "R0001", "when": "2026-01-01T09:00:00Z", "actions": ["Installation"], "camera_id": "P800", "sd": "A1"}])
    inside = (by_hand("planned"), by_hand("archived"))
    svc.write_visits(tmp_path, "DONA", [{"location_id": "DONA_01", "session": "R0002", "when": "2026-02-01T09:00:00Z", "actions": ["Revision", "Desinstallation"], "camera_id": "P800", "num_photos": 1}])
    back = (by_hand("planned"), by_hand("ready"), by_hand("archived"))

    assert free[0] == "planned" and free[1] == "ready" and "a visit leaves it there" in free[2]
    assert all("is in the camera at DONA_01" in o for o in inside)
    assert back == ("planned", "ready", "archived")


def test_the_default_research_project_is_changed_alone_to_one_of_the_collections_folder():
    _put(TRAPPER={"enabled": False, "base_url": "https://trapper.example", "user_name": "ana@example.org", "user_password": "", "max_zip_mb": 100})

    response = _client().put("/api/settings/default-research-project", json={"acronym": " tatr "})

    assert response.status_code == 200 and response.json() == {"default_research_project": "TATR"}
    saved = config.load_settings()
    assert saved.GENERAL.default_research_project == "TATR"
    assert saved.TRAPPER.base_url == "https://trapper.example"   # nothing else is touched


def test_a_default_research_project_that_is_not_in_the_collections_folder_is_refused():
    assert _client().put("/api/settings/default-research-project", json={"acronym": "GONE"}).status_code == 404
    assert config.load_settings().GENERAL.default_research_project is None


def test_the_welcome_page_is_shown_by_default_and_the_tick_turns_it_off_and_on_changing_nothing_else():
    _put(TRAPPER={"enabled": False, "base_url": "https://trapper.example", "user_name": "ana@example.org", "user_password": "", "max_zip_mb": 100})
    assert config.load_settings().GENERAL.show_welcome is True
    assert _client().get("/api/settings").json()["GENERAL"]["show_welcome"] is True

    response = _client().put("/api/settings/show-welcome", json={"show": False})

    assert response.status_code == 200 and response.json() == {"show_welcome": False}
    saved = config.load_settings()
    assert saved.GENERAL.show_welcome is False
    assert saved.TRAPPER.base_url == "https://trapper.example"   # nothing else is touched
    assert _client().put("/api/settings/show-welcome", json={"show": True}).json() == {"show_welcome": True}
    assert config.load_settings().GENERAL.show_welcome is True
