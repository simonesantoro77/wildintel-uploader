from fastapi.testclient import TestClient

SCAN = {"file_count": 12, "image_count": 12, "warnings": []}

SELECTION = {
    "destination": "trapper", "mode": "new",
    "research_project": {"pk": 2, "name": "Doñana", "acronym": "DONA"},
    "classification_project": {"pk": 10, "name": "Main CP"},
    "location": {"pk": 5, "location_id": "DONA_01", "name": "Doñana site 1", "timezone": "Europe/Madrid"},
}

EXISTING_SELECTION = {
    "destination": "trapper", "mode": "existing", "research_project": {"pk": 2, "name": "Doñana", "acronym": "DONA"},
}

LOCAL_SELECTION = {"destination": "local", "mode": "new", "collection_dir": "/home/me/Collections/R0001"}

DEPLOYMENT = {"deployment_id": "DONA-DONA_01", "location_id": "DONA_01", "start_date": "2024-09-04T13:10:00+02:00", "end_date": "2024-11-04T14:28:00+02:00", "latitude": 37.0, "longitude": -6.5}


def _client() -> TestClient:
    from wildintel_uploader.web.main import app
    return TestClient(app)


def test_scanning_a_folder_creates_a_resumable_session():
    client = _client()
    saved = client.post("/api/sessions/scan", json={"source_dir": "/home/me/DONA_01", "scan": SCAN}).json()

    assert saved["phase"] == "scanned" and saved["task"] == "deployment"
    assert saved["source_dir"] == "/home/me/DONA_01"
    listed = client.get("/api/sessions").json()
    assert saved["task_id"] in [s["task_id"] for s in listed]
    session = next(s for s in listed if s["task_id"] == saved["task_id"])
    assert session["scan"]["image_count"] == 12
    assert "password" not in str(session) and "username" not in str(session)


def test_scanning_again_updates_the_same_session():
    client = _client()
    first = client.post("/api/sessions/scan", json={"source_dir": "/home/me/DONA_01", "scan": SCAN}).json()
    changed = {**SCAN, "image_count": 20}
    second = client.post("/api/sessions/scan", json={
        "task_id": first["task_id"], "source_dir": "/home/me/DONA_01", "scan": changed,
    }).json()

    assert second["task_id"] == first["task_id"]
    assert second["created_at"] == first["created_at"]
    assert second["scan"]["image_count"] == 20


def test_saving_the_selection_moves_the_session_on_and_a_new_scan_keeps_it():
    client = _client()
    saved = client.post("/api/sessions/scan", json={"source_dir": "/home/me/DONA_01", "scan": SCAN}).json()
    selected = client.post("/api/sessions/selection", json={"task_id": saved["task_id"], "selection": SELECTION}).json()

    assert selected["phase"] == "selected"
    assert selected["selection"]["location"]["location_id"] == "DONA_01"
    assert selected["scan"]["image_count"] == 12

    rescanned = client.post("/api/sessions/scan", json={
        "task_id": saved["task_id"], "source_dir": "/home/me/DONA_01", "scan": SCAN,
    }).json()
    assert rescanned["phase"] == "scanned" and rescanned["selection"]["location"]["location_id"] == "DONA_01"


def test_saving_an_existing_deployment_selection_needs_no_location():
    client = _client()
    saved = client.post("/api/sessions/scan", json={"source_dir": "/home/me/DONA_01", "scan": SCAN}).json()
    selected = client.post("/api/sessions/selection", json={"task_id": saved["task_id"], "selection": EXISTING_SELECTION}).json()

    assert selected["phase"] == "selected"
    assert selected["selection"]["mode"] == "existing"
    assert selected["selection"]["location"] is None


def test_saving_a_local_destination_selection_needs_no_research_project():
    client = _client()
    saved = client.post("/api/sessions/scan", json={"source_dir": "/home/me/DONA_01", "scan": SCAN}).json()
    selected = client.post("/api/sessions/selection", json={"task_id": saved["task_id"], "selection": LOCAL_SELECTION}).json()

    assert selected["phase"] == "selected"
    assert selected["selection"]["destination"] == "local"
    assert selected["selection"]["collection_dir"] == "/home/me/Collections/R0001"
    assert selected["selection"]["research_project"] is None


def test_selection_needs_an_existing_session():
    response = _client().post("/api/sessions/selection", json={"task_id": "nope", "selection": SELECTION})
    assert response.status_code == 404


def test_saving_the_details_moves_the_session_on_and_is_ready_to_import():
    client = _client()
    saved = client.post("/api/sessions/scan", json={"source_dir": "/home/me/DONA_01", "scan": SCAN}).json()
    client.post("/api/sessions/selection", json={"task_id": saved["task_id"], "selection": SELECTION})
    ready = client.post("/api/sessions/details", json={
        "task_id": saved["task_id"], "deployment": DEPLOYMENT,
    }).json()

    assert ready["phase"] == "ready"
    assert ready["deployment"]["deployment_id"] == "DONA-DONA_01"
    assert "timezone" not in ready  # the location's, not the session's
    assert ready["selection"]["location"]["location_id"] == "DONA_01"
    assert "password" not in str(ready)


def test_details_need_an_existing_session_and_valid_values():
    client = _client()
    assert client.post("/api/sessions/details", json={
        "task_id": "nope", "deployment": DEPLOYMENT,
    }).status_code == 404
    saved = client.post("/api/sessions/scan", json={"source_dir": "/home/me/DONA_01", "scan": SCAN}).json()
    bad = client.post("/api/sessions/details", json={
        "task_id": saved["task_id"], "deployment": {**DEPLOYMENT, "deployment_id": ""},
    })
    assert bad.status_code == 422


def test_discarding_a_session_removes_it():
    client = _client()
    saved = client.post("/api/sessions/scan", json={"source_dir": "/home/me/DONA_01", "scan": SCAN}).json()
    client.delete(f"/api/sessions/{saved['task_id']}")
    assert saved["task_id"] not in [s["task_id"] for s in client.get("/api/sessions").json()]


def test_sessions_are_kept_in_the_state_folder():
    from wildintel_uploader.core import config

    saved = _client().post("/api/sessions/scan", json={"source_dir": "/home/me/DONA_01", "scan": SCAN}).json()

    assert (config.get_sessions_dir() / saved["task_id"] / "session.json").is_file()
    assert config.get_sessions_dir().name == "sessions" and "wildintel-uploader" in config.get_sessions_dir().parts


def test_sessions_left_where_they_used_to_be_are_moved_to_where_they_are_kept_now():
    import json

    from wildintel_uploader.core import config
    from wildintel_uploader.core.services import session_store

    old = config.legacy_sessions_dir() / "11111111-1111-1111-1111-111111111111"
    old.mkdir(parents=True)
    (old / "session.json").write_text(json.dumps({"task_id": old.name, "phase": "scanned", "task": "deployment", "created_at": "2026-01-01T00:00:00+00:00"}), encoding="utf-8")

    listed = session_store.list_sessions()

    assert old.name in [s["task_id"] for s in listed]
    assert not old.exists() and (config.get_sessions_dir() / old.name / "session.json").is_file()
    assert not config.legacy_sessions_dir().exists()  # nothing left in the old folder
