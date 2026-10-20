"""/api/settings — the settings page's own endpoints: the password never goes
back, blank fields keep what was saved, the log can be downloaded and cleared."""
import logging
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from wildintel_uploader.core import config, logging_setup
from wildintel_uploader.web.main import app


@pytest.fixture(autouse=True)
def fresh_settings_file():
    """Every test starts from defaults, whatever an earlier one saved."""
    config.DEFAULT_CONFIG_FILE.unlink(missing_ok=True)
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

    assert set(body) == {"GENERAL", "TRAPPER", "EPICOLLECT5", "DATA", "VALIDATION", "POSTVALIDATION", "PREPROCESSING", "FIELDLOG", "INGEST"}
    assert all(body["VALIDATION"].values())
    assert body["POSTVALIDATION"]["tolerance_hours"] == 1.0
    assert body["FIELDLOG"]["time_source"] == "created_at" and body["FIELDLOG"]["camera_timezone"] == "UTC"
    assert body["GENERAL"]["log_level"] == "INFO"
    assert body["GENERAL"]["log_file"].endswith("wildintel-uploader.log")
    assert 1 <= body["GENERAL"]["workers"] <= 4 and body["GENERAL"]["cpu_count"] >= 1


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
