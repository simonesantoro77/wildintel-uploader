"""/api/upload — choosing what to upload from the collections folder, and uploading it to Trapper
(Trapper itself faked, no network)."""
import json
import sys
import types
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from tests.unit.test_trapper_upload_service import (  # noqa: F401 — the fixtures and fakes the service's own tests use
    DEPLOYMENT_ID, FakeTrapper, _deployment, _imported, fake_uploader, uploader_login,
)
from wildintel_uploader.core import config
from wildintel_uploader.core.services import trapper_service, trapper_upload_service
from wildintel_uploader.web.main import app

PAYLOAD = {
    "url": "https://trapper.example.org", "username": "alice@example.org", "password": "s3cret",
    "research_project_id": "DONA", "collection": "R0003", "deployment_id": DEPLOYMENT_ID,
}


def _client() -> TestClient:
    return TestClient(app)


def _in(collections: Path):
    return patch("wildintel_uploader.core.services.deployment_import_service.config.collections_dir", return_value=collections)


def _kept(tmp_path: Path, *, trapper_pk=2) -> Path:
    """A research project and a preprocessed deployment kept in the collections folder (under tmp_path/collections)."""
    collection = _imported(tmp_path, 2)
    (collection.parent / "research_project.json").write_text(json.dumps({"name": "Doñana", "acronym": "DONA", "trapper_pk": trapper_pk}), encoding="utf-8")
    return collection


def _events(response) -> list[dict]:
    return [json.loads(line) for line in response.text.splitlines()]


def test_the_collections_of_a_research_project_are_listed(tmp_path: Path):
    _kept(tmp_path)

    with _in(tmp_path / "collections"):
        response = _client().post("/api/upload/collections", json={"research_project_id": "DONA"})

    assert response.status_code == 200
    [collection] = response.json()["results"]
    assert collection["name"] == "R0003"
    assert [(d["deployment_id"], d["images"], d["preprocessed"]) for d in collection["deployments"]] == [(DEPLOYMENT_ID, 2, True)]


def test_a_research_project_id_that_is_not_a_folder_name_is_a_400(tmp_path: Path):
    with _in(tmp_path):
        assert _client().post("/api/upload/collections", json={"research_project_id": "../x"}).status_code == 400


def test_uploading_streams_the_steps_and_ends_with_done(tmp_path: Path, fake_uploader):
    _kept(tmp_path)
    fake = FakeTrapper()

    with _in(tmp_path / "collections"), patch("wildintel_uploader.web.api.routers.upload.config.data_dir", return_value=tmp_path), \
         patch.object(trapper_service, "_client", return_value=fake), patch.object(trapper_upload_service, "WAIT_FOR_COLLECTION_SECONDS", 0.2):
        response = _client().post("/api/upload/deployment", json=PAYLOAD)

    assert response.status_code == 200
    events = _events(response)
    assert [e["step"] for e in events if e["type"] == "step" and e["status"] == "done"] == ["connect", "classification", "uploader", "location", "deployment", "package", "upload", "process", "wait"]
    assert events[-1]["type"] == "done" and events[-1]["collection"] == "R0003" and events[-1]["deployment_id"] == DEPLOYMENT_ID
    assert len(fake.imported_locations) == 1 and len(fake.triggered) == 1


def test_checking_the_access_gives_one_result_per_check_and_changes_nothing(tmp_path: Path):
    _kept(tmp_path)
    fake = FakeTrapper(locations=[])
    payload = {k: v for k, v in PAYLOAD.items() if k != "deployment_id"} | {"deployment_ids": [DEPLOYMENT_ID]}

    with _in(tmp_path / "collections"), patch.object(trapper_service, "_client", return_value=fake), \
         patch.object(trapper_upload_service, "_uploader_login", return_value=None):
        response = _client().post("/api/upload/check-access", json=payload)

    assert response.status_code == 200
    checks = response.json()["checks"]
    assert [(c["check"], c["ok"]) for c in checks] == [("research_project", True), ("classification_project", True), ("location", True), ("uploader", True)]
    assert "Would be created" in checks[2]["message"]
    assert fake.imported_locations == [] and fake.imported_deployments == [] and fake.triggered == []


def test_the_classification_projects_of_a_research_project_are_listed_from_trapper(tmp_path: Path):
    _kept(tmp_path)
    payload = {"url": PAYLOAD["url"], "username": PAYLOAD["username"], "password": PAYLOAD["password"], "research_project_id": "DONA"}

    with _in(tmp_path / "collections"), patch.object(trapper_service, "_client", return_value=FakeTrapper()):
        response = _client().post("/api/upload/classification-projects", json=payload)
        unknown = _client().post("/api/upload/classification-projects", json={**payload, "research_project_id": "NOPE"})

    assert response.status_code == 200 and response.json()["results"] == [{"pk": 7, "name": "Doñana classification", "is_active": True}]
    assert unknown.status_code == 404


def test_checking_the_access_of_an_unknown_research_project_is_a_404(tmp_path: Path):
    _kept(tmp_path)
    payload = {k: v for k, v in PAYLOAD.items() if k != "deployment_id"} | {"research_project_id": "NOPE"}
    with _in(tmp_path / "collections"):
        assert _client().post("/api/upload/check-access", json=payload).status_code == 404


def test_a_failure_midway_is_an_error_line_not_a_crash(tmp_path: Path, fake_uploader):
    _kept(tmp_path, trapper_pk=999)  # a pk Trapper doesn't have, and an acronym it does not either
    fake = FakeTrapper(projects=[])

    with _in(tmp_path / "collections"), patch("wildintel_uploader.web.api.routers.upload.config.data_dir", return_value=tmp_path), \
         patch.object(trapper_service, "_client", return_value=fake):
        response = _client().post("/api/upload/deployment", json=PAYLOAD)

    assert response.status_code == 200
    events = _events(response)
    assert events[-1]["type"] == "error" and "Trapper has no research project 'DONA'" in events[-1]["detail"]
    assert [e["step"] for e in events if e["type"] == "step"] == ["connect"]


def test_an_error_from_trapper_itself_is_reported_in_plain_words(tmp_path: Path, fake_uploader):
    from trapper_client import err

    _kept(tmp_path)

    class Broken(FakeTrapper):
        def __init__(self):
            super().__init__()
            self.research_projects = types.SimpleNamespace(where=self._boom)

        @staticmethod
        def _boom(**kw):
            raise err.UnauthorizedError("401")

    with _in(tmp_path / "collections"), patch("wildintel_uploader.web.api.routers.upload.config.data_dir", return_value=tmp_path), \
         patch.object(trapper_service, "_client", return_value=Broken()):
        events = _events(_client().post("/api/upload/deployment", json=PAYLOAD))

    assert events[-1] == {"type": "error", "detail": "Incorrect Trapper username or password."}


def test_an_unknown_research_project_or_deployment_is_a_404_before_anything_starts(tmp_path: Path):
    _kept(tmp_path)

    with _in(tmp_path / "collections"):
        no_project = _client().post("/api/upload/deployment", json={**PAYLOAD, "research_project_id": "SINE"})
        no_deployment = _client().post("/api/upload/deployment", json={**PAYLOAD, "deployment_id": "R0003-OTHER_01"})

    assert no_project.status_code == 404 and "isn't in the collections folder" in no_project.json()["detail"]
    assert no_deployment.status_code == 404 and "isn't in the collection R0003" in no_deployment.json()["detail"]


@pytest.mark.parametrize("bad", [
    {"collection": "Doñana"}, {"collection": "R003"}, {"deployment_id": "DONA-01"}, {"deployment_id": "R0003"},
])
def test_names_that_are_not_collections_or_deployments_are_a_422(tmp_path: Path, bad: dict):
    with _in(tmp_path):
        assert _client().post("/api/upload/deployment", json={**PAYLOAD, **bad}).status_code == 422


def test_missing_trapper_credentials_are_a_400_naming_what_is_missing(tmp_path: Path):
    with _in(tmp_path), patch.object(trapper_service.config, "load_settings", return_value=config.Settings()):
        response = _client().post("/api/upload/deployment", json={**PAYLOAD, "url": None, "username": None, "password": None})

    assert response.status_code == 400
    assert "Missing Trapper URL, username, password" in response.json()["detail"]


def test_the_zips_are_split_at_the_size_of_the_settings(tmp_path: Path, fake_uploader):
    _kept(tmp_path)
    fake = FakeTrapper()

    with _in(tmp_path / "collections"), patch("wildintel_uploader.web.api.routers.upload.config.data_dir", return_value=tmp_path), \
         patch.object(trapper_service, "_client", return_value=fake), patch.object(config, "max_zip_mb", return_value=1) as size:
        events = _events(_client().post("/api/upload/deployment", json=PAYLOAD))

    assert events[-1]["parts"] == 1  # 1 MB is far bigger than two tiny images
    size.assert_called()


def test_when_the_collection_does_not_appear_the_error_says_how_long_it_waited(tmp_path: Path, fake_uploader):
    _kept(tmp_path)

    with _in(tmp_path / "collections"), patch("wildintel_uploader.web.api.routers.upload.config.data_dir", return_value=tmp_path), \
         patch.object(trapper_service, "_client", return_value=FakeTrapper(collections_appear=False)), \
         patch.object(trapper_upload_service, "WAIT_FOR_COLLECTION_SECONDS", 0.2), patch.object(trapper_upload_service, "POLL_SECONDS", 0.05):
        events = _events(_client().post("/api/upload/deployment", json=PAYLOAD))

    assert events[-1]["type"] == "error" and "didn't appear in Trapper within 0 seconds" in events[-1]["detail"]


# ── the three modes ─────────────────────────────────────────────────────────

def _post(tmp_path: Path, payload: dict, fake: FakeTrapper | None = None, settings=None):
    stack = [_in(tmp_path / "collections"), patch("wildintel_uploader.web.api.routers.upload.config.data_dir", return_value=tmp_path),
             patch.object(trapper_service, "_client", return_value=fake or FakeTrapper())]
    if settings is not None:
        stack.append(patch.object(trapper_service.config, "load_settings", return_value=settings))
    from contextlib import ExitStack

    with ExitStack() as exits:
        for cm in stack:
            exits.enter_context(cm)
        return _client().post("/api/upload/deployment", json=payload)


def test_the_package_files_stay_after_an_upload_unless_deleting_them_is_asked(tmp_path: Path, fake_uploader):
    _kept(tmp_path)
    kept = _events(_post(tmp_path, PAYLOAD, FakeTrapper()))[-1]
    assert kept["files_deleted"] is False and any(name.endswith(".zip") for name in kept["files"]) and any(name.endswith("_deployments.csv") for name in kept["files"])
    assert list((tmp_path / "packages").rglob("*.zip"))

    deleted = _events(_post(tmp_path, {**PAYLOAD, "delete_files": True}, FakeTrapper()))[-1]
    assert deleted["files_deleted"] is True and "files" not in deleted


def test_a_dry_run_streams_what_would_happen_and_changes_nothing(tmp_path: Path, fake_uploader):
    _kept(tmp_path)
    fake = FakeTrapper()

    response = _post(tmp_path, {**PAYLOAD, "mode": "dry_run"}, fake)

    events = _events(response)
    assert events[-1]["type"] == "done" and events[-1]["mode"] == "dry_run" and events[-1]["would_create_location"] is True
    assert fake.imported_locations == [] and fake.triggered == [] and fake_uploader.uploads == []
    assert not (tmp_path / "packages").exists()


def test_generating_the_files_needs_no_trapper_account(tmp_path: Path, fake_uploader):
    _kept(tmp_path)
    no_account = config.Settings()  # no URL, user or password saved

    response = _post(tmp_path, {"research_project_id": "DONA", "collection": "R0003", "deployment_id": DEPLOYMENT_ID, "mode": "generate", "classification_project_pk": 7}, settings=no_account)

    assert response.status_code == 200
    events = _events(response)
    assert events[-1]["type"] == "done" and events[-1]["mode"] == "generate"
    out = tmp_path / "packages" / "DONA" / "R0003"
    assert sorted(p.suffix for p in out.iterdir()) == [".csv", ".yaml", ".zip"]
    assert events[-1]["output_dir"] == str(out)


def test_the_other_modes_do_need_the_account(tmp_path: Path):
    _kept(tmp_path)
    for mode in ("upload", "dry_run"):
        with _in(tmp_path / "collections"), patch.object(trapper_service.config, "load_settings", return_value=config.Settings()):
            response = _client().post("/api/upload/deployment", json={"research_project_id": "DONA", "collection": "R0003", "deployment_id": DEPLOYMENT_ID, "mode": mode})

        assert response.status_code == 400, mode
        assert "Missing Trapper URL, username, password" in response.json()["detail"]


def test_upload_is_the_default_mode(tmp_path: Path, fake_uploader):
    _kept(tmp_path)

    events = _events(_post(tmp_path, PAYLOAD))

    assert events[-1]["mode"] == "upload"


def test_an_unknown_mode_is_a_422(tmp_path: Path):
    with _in(tmp_path):
        assert _client().post("/api/upload/deployment", json={**PAYLOAD, "mode": "send_it"}).status_code == 422


def test_open_folder_opens_a_folder_inside_the_data_folder(tmp_path):
    inside = tmp_path / "collections" / "DONA"
    inside.mkdir(parents=True)
    with patch("wildintel_uploader.web.api.routers.deployment_import.config.data_dir", return_value=tmp_path), \
            patch("wildintel_uploader.web.api.routers.deployment_import._open_in_file_manager") as opener:
        response = _client().post("/api/deployment-import/open-folder", json={"path": str(inside)})
    assert response.status_code == 200
    opener.assert_called_once_with(inside.resolve())


def test_open_folder_refuses_folders_outside_the_data_folder(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    with patch("wildintel_uploader.web.api.routers.deployment_import.config.data_dir", return_value=data), \
            patch("wildintel_uploader.web.api.routers.deployment_import._open_in_file_manager") as opener:
        response = _client().post("/api/deployment-import/open-folder", json={"path": str(tmp_path)})
    assert response.status_code == 400
    opener.assert_not_called()


def test_open_folder_404_when_missing(tmp_path):
    with patch("wildintel_uploader.web.api.routers.deployment_import.config.data_dir", return_value=tmp_path), \
            patch("wildintel_uploader.web.api.routers.deployment_import._open_in_file_manager"):
        response = _client().post("/api/deployment-import/open-folder", json={"path": str(tmp_path / "nope")})
    assert response.status_code == 404


def test_checking_the_selection_says_what_the_account_sees_of_the_project_and_the_collection(tmp_path: Path):
    _kept(tmp_path)
    payload = {k: v for k, v in PAYLOAD.items() if k != "deployment_id"}

    with _in(tmp_path / "collections"), patch.object(trapper_service, "_client", return_value=FakeTrapper()):
        response = _client().post("/api/upload/check-selection", json=payload)
        unknown = _client().post("/api/upload/check-selection", json={**payload, "research_project_id": "NOPE"})
        no_collection = _client().post("/api/upload/check-selection", json={k: v for k, v in payload.items() if k != "collection"})

    assert response.status_code == 200
    assert [(c["check"], c["ok"]) for c in response.json()["checks"]] == [("research_project", True), ("collection", True)]
    assert unknown.status_code == 404 and no_collection.status_code == 400
