"""The settings that are secrets — marked so in the schema of the settings — are never shown by the command-line app, never sent to the settings page and never put in
a backup."""
import pytest
from fastapi.testclient import TestClient
from typer.testing import CliRunner

from wildintel_uploader.cli.app import app as cli
from wildintel_uploader.core import config
from wildintel_uploader.core.services import backup_service
from wildintel_uploader.web.main import app

SECRET = "s3cr3t-value-that-must-not-show"


@pytest.fixture(autouse=True)
def every_secret_saved():
    """Settings with every secret set, and back to the defaults after."""
    config.DEFAULT_CONFIG_FILE.unlink(missing_ok=True)
    settings = config.load_settings()
    for section, field in config.secret_fields():
        setattr(getattr(settings, section), field, SECRET)
    config.save_settings(settings)
    yield
    config.DEFAULT_CONFIG_FILE.unlink(missing_ok=True)


def test_the_secrets_are_read_from_the_schema_of_the_settings():
    assert set(config.secret_fields()) >= {("TRAPPER", "user_password"), ("EPICOLLECT5", "client_secret"), ("AGOUTI", "api_key")}


def test_config_show_says_a_secret_is_saved_and_never_shows_it():
    shown = CliRunner().invoke(cli, ["config", "show"], terminal_width=400)

    assert shown.exit_code == 0, shown.output
    assert SECRET not in shown.output
    for section, field in config.secret_fields():
        assert f"{section}.{field}" in shown.output


@pytest.mark.parametrize("section, field", config.secret_fields())
def test_config_set_hides_a_secret_while_it_is_typed(section: str, field: str):
    typed = CliRunner().invoke(cli, ["config", "set", f"{section}.{field}"], input="new-secret\n")

    assert typed.exit_code == 0, typed.output
    assert "new-secret" not in typed.output
    assert getattr(getattr(config.load_settings(), section), field) == "new-secret"


def test_the_settings_page_gets_whether_each_secret_is_saved_and_never_the_secret():
    sent = TestClient(app).get("/api/settings")

    assert SECRET not in sent.text
    data = sent.json()
    assert (data["TRAPPER"]["has_password"], data["EPICOLLECT5"]["has_secret"], data["AGOUTI"]["has_api_key"]) == (True, True, True)


def test_a_secret_left_blank_on_the_settings_page_keeps_the_saved_one():
    client = TestClient(app)
    page = client.get("/api/settings").json()
    for section, field in config.secret_fields():
        page[section][field] = None

    assert client.put("/api/settings", json=page).status_code == 200
    for section, field in config.secret_fields():
        assert getattr(getattr(config.load_settings(), section), field) == SECRET


def test_no_secret_goes_in_a_backup():
    snapshot = backup_service.settings_snapshot()

    assert SECRET not in str(snapshot)
