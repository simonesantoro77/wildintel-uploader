"""/api/setup — what the initial setup wizard adds, step by step: the trappers, their roles in a research project, its cameras and its SD cards."""
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from wildintel_uploader.core.services import local_folder_service
from wildintel_uploader.web.main import app


@pytest.fixture(autouse=True)
def collections(tmp_path: Path):
    local_folder_service.write_research_project(tmp_path, {"name": "Doñana", "acronym": "DONA"})
    with patch("wildintel_uploader.web.api.routers.setup.config.collections_dir", return_value=tmp_path):
        yield tmp_path


def _post(path: str, body: dict):
    return TestClient(app).post(f"/api/setup/{path}", json=body)


def test_trappers_are_added_and_one_with_the_username_of_another_is_left_out(collections: Path):
    first = _post("trappers", {"trappers": [{"username": "ana", "name": "Ana Pérez", "affiliation": "UHU"}, {"username": "luis", "name": "Luis"}]})
    again = _post("trappers", {"trappers": [{"username": "ANA", "name": "Ana Other"}, {"username": "marta", "name": "Marta"}]})

    assert first.json() == {"added": ["ana", "luis"], "skipped": []}
    assert again.json() == {"added": ["marta"], "skipped": ["ANA"]}
    assert [t["name"] for t in local_folder_service.list_trappers(collections)] == ["Ana Pérez", "Luis", "Marta"]


def test_a_trapper_needs_a_username_and_a_name():
    assert _post("trappers", {"trappers": [{"username": "", "name": "Ana"}]}).status_code == 422


def test_roles_are_given_to_trappers_that_are_kept_and_the_ones_it_has_are_left_as_they_are(collections: Path):
    _post("trappers", {"trappers": [{"username": "ana", "name": "Ana Pérez"}]})

    first = _post("roles", {"research_project_id": "DONA", "roles": [{"trapper": "ana pérez", "role": "principalInvestigator"}]})
    again = _post("roles", {"research_project_id": "DONA", "roles": [{"trapper": "Ana Pérez", "role": "principalInvestigator"}, {"trapper": "Ana Pérez", "role": "contact"}]})

    assert first.json() == {"added": [["Ana Pérez", "principalInvestigator"]]}
    assert again.json() == {"added": [["Ana Pérez", "contact"]]}
    assert sorted(r["role"] for r in local_folder_service.list_roles(collections, "DONA")) == ["contact", "principalInvestigator"]


def test_a_role_of_a_trapper_that_is_not_kept_is_refused():
    refused = _post("roles", {"research_project_id": "DONA", "roles": [{"trapper": "Nobody", "role": "contact"}]})

    assert refused.status_code == 404 and "Nobody" in refused.json()["detail"]
    assert _post("roles", {"research_project_id": "DONA", "roles": [{"trapper": "x", "role": "boss"}]}).status_code == 422


def test_cameras_and_sd_cards_are_added_to_the_research_project_and_a_label_is_not_added_twice(collections: Path):
    cameras = _post("field-items", {"research_project_id": "DONA", "kind": "cameras", "items": [{"label": "CAM-001", "camera_id": "P800", "camera_model": "Browning"}, {"label": "cam-001"}]})
    cards = _post("field-items", {"research_project_id": "DONA", "kind": "sd_cards", "items": [{"label": "1", "brand": "SanDisk", "capacity": "64 GB"}]})

    assert cameras.json() == {"added": ["CAM-001"], "skipped": ["cam-001"]}
    assert cards.json() == {"added": ["1"], "skipped": []}
    kept = local_folder_service.list_field_items(collections, "DONA", "cameras")
    assert [(c["label"], c["camera_id"], c["status"]) for c in kept] == [("CAM-001", "P800", "active")]
    assert local_folder_service.list_field_items(collections, "DONA", "sd_cards")[0]["capacity"] == "64 GB"


def test_cameras_of_a_research_project_that_is_not_kept_are_refused():
    assert _post("field-items", {"research_project_id": "NOPE", "kind": "cameras", "items": [{"label": "C1"}]}).status_code == 400
