"""/api/statistics — the deployments of a revision against the previous revisions of their locations."""
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from tests.unit.test_statistics_service import _revision, _stamps
from wildintel_uploader.web.main import app


def _in(root: Path):
    return patch("wildintel_uploader.core.config.collections_dir", return_value=root)


def test_a_revision_gives_a_row_per_deployment_with_the_revisions_of_its_location(tmp_path):
    for rev in (1, 2):
        _revision(tmp_path, "RP", f"R000{rev}-A", _stamps(100, 5), collection=f"R000{rev}")
    _revision(tmp_path, "RP", "R0003-A", _stamps(1000, 50), collection="R0003")
    with _in(tmp_path):
        response = TestClient(app).post("/api/statistics/revision", json={"research_project_id": "RP", "collection": "R0003"})

    assert response.status_code == 200
    [row] = response.json()["results"]
    assert row["deployment_id"] == "R0003-A" and row["status"] == "review"
    assert [r["revision"] for r in row["revisions"]] == [1, 2, 3]
    assert row["revisions"][-1]["metrics"]["image_count"] == 1000


def test_an_unknown_revision_is_a_404_and_a_bad_name_a_422(tmp_path):
    with _in(tmp_path):
        assert TestClient(app).post("/api/statistics/revision", json={"research_project_id": "RP", "collection": "R0009"}).status_code == 404
        assert TestClient(app).post("/api/statistics/revision", json={"research_project_id": "RP", "collection": "../x"}).status_code == 422
