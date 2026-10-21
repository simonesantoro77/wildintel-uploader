"""services.repair_service — a deployment's metadata rebuilt from the contents of its own folder."""
import json
from datetime import datetime
from pathlib import Path

import pytest
from PIL import Image

from wildintel_uploader.core.schemas.requests import DeploymentFields
from wildintel_uploader.core.services import local_folder_service as lfs
from wildintel_uploader.core.services import preprocessing_service as pre
from wildintel_uploader.core.services import report_service, repair_service as rep, seal_service

DEPLOYMENT_ID = "R0003-DONA_01"
DEPLOYMENT = DeploymentFields.model_validate({
    "deployment_id": DEPLOYMENT_ID, "location_id": "DONA_01", "location_name": "Doñana site 1", "latitude": 37.0, "longitude": -6.5,
    "start_date": "2024-07-01T09:00:00+01:00", "end_date": "2024-07-01T12:00:00+01:00",
})
OPTIONS = pre.PreprocessOptions(metadata=False, timezone="Europe/Madrid")


def _jpeg(path: Path, taken: str, color="red") -> None:
    img = Image.new("RGB", (400, 300), color=color)
    exif = img.getexif()
    exif.get_ifd(0x8769)[36867] = taken
    exif[271], exif[272] = "RECONYX", "HF2 PRO COVERT"
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, exif=exif)


@pytest.fixture
def kept(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """A research project DONA with its location, and a deployment imported, preprocessed and sealed in R0003."""
    root = tmp_path / "collections"
    project = root / "DONA"
    project.mkdir(parents=True)
    (project / lfs.RESEARCH_PROJECT_METADATA_FILE).write_text(json.dumps({"name": "Doñana", "acronym": "DONA"}), encoding="utf-8")
    (project / lfs.LOCATIONS_FILE).write_text(json.dumps([
        {"location_id": "DONA_01", "name": "Doñana site 1", "timezone": "Europe/Madrid", "ignore_dst": True, "latitude": 37.0, "longitude": -6.5},
    ]), encoding="utf-8")
    source = tmp_path / "card"
    for n, (taken, color) in enumerate([("2024:07:01 10:00:00", "red"), ("2024:07:01 11:00:00", "blue"), ("2024:07:01 11:30:00", "green")], 1):
        _jpeg(source / f"IMG_{n:04d}.jpg", taken, color)
    collection = project / "R0003"
    list(pre.preprocess_stream(str(source), str(collection), "R0003", DEPLOYMENT, OPTIONS))
    lfs.upsert_timestamp_log(collection, DEPLOYMENT_ID, *(datetime(2024, 7, 1, h, m) for h, m in ((9, 0), (12, 0))))
    return root, collection / DEPLOYMENT_ID


def _repair(root: Path, deployment_id=DEPLOYMENT_ID) -> list[dict]:
    return list(rep.repair_stream(root, "DONA", "R0003", deployment_id))


def test_a_deployment_that_was_just_imported_is_valid(kept):
    root, _ = kept
    state = rep.inspect(root, "DONA", "R0003", DEPLOYMENT_ID)

    assert state["status"] == "valid" and state["images"] == 3 and state["log"] == "row"
    assert state["problems"] == []


def test_a_deployment_is_valid_or_not_as_its_seal_says(kept):
    root, dest = kept
    (dest / lfs.DEPLOYMENT_METADATA_FILE).unlink()
    assert rep.inspect(root, "DONA", "R0003", DEPLOYMENT_ID)["status"] == "broken"

    (dest / seal_service.SEAL_FILE).unlink()
    state = rep.inspect(root, "DONA", "R0003", DEPLOYMENT_ID)
    assert state["status"] == "unsealed"
    assert "deployment.json is missing" in state["problems"] and "It has no seal: its images were never sealed." in state["problems"]


def test_every_metadata_file_is_rebuilt_from_the_images_and_the_deployment_is_valid_again(kept):
    root, dest = kept
    before = json.loads((dest / lfs.DEPLOYMENT_METADATA_FILE).read_text(encoding="utf-8"))
    for name in (lfs.DEPLOYMENT_METADATA_FILE, lfs.IMAGES_FILE, pre.PREPROCESSING_LOG_FILE, seal_service.SEAL_FILE):
        (dest / name).unlink()

    events = _repair(root)

    assert events[-1]["type"] == "done" and events[-1]["status"] == "valid" and events[-1]["report_id"]
    assert sorted(events[-1]["written"]) == sorted([lfs.DEPLOYMENT_METADATA_FILE, lfs.IMAGES_FILE, pre.PREPROCESSING_LOG_FILE, seal_service.SEAL_FILE])
    assert [e["step"] for e in events if e["type"] == "step" and e["status"] == "done"] == ["inspect", "dates", "deployment", "preprocessing", "images", "seal"]
    after = json.loads((dest / lfs.DEPLOYMENT_METADATA_FILE).read_text(encoding="utf-8"))
    assert after["deployment_id"] == DEPLOYMENT_ID and after["latitude"] == 37.0 and after["location_name"] == "Doñana site 1"
    assert (after["start_date"], after["end_date"]) == (before["start_date"], before["end_date"])  # the log said 09:00 → 12:00, as at the import
    assert "HF2" in after["camera_model"].upper()  # read from the images
    log = json.loads((dest / pre.PREPROCESSING_LOG_FILE).read_text(encoding="utf-8"))
    assert [i["name"] for i in log["images"]] == sorted(p.name for p in dest.glob("*.JPEG")) and log["recovered"]
    assert all(i["date"] and i["final_hash"] for i in log["images"])
    assert json.loads((dest / lfs.IMAGES_FILE).read_text(encoding="utf-8"))["image_count"] == 3
    assert json.loads((dest / seal_service.SEAL_FILE).read_text(encoding="utf-8"))["recovered"]
    assert rep.inspect(root, "DONA", "R0003", DEPLOYMENT_ID)["status"] == "valid"


def test_the_timestamp_log_prevails_over_what_the_images_say(kept):
    root, dest = kept
    collection = dest.parent
    lfs.upsert_timestamp_log(collection, DEPLOYMENT_ID, *(datetime(2024, 6, 30, 8, 0), datetime(2024, 7, 2, 18, 0)))
    (dest / lfs.DEPLOYMENT_METADATA_FILE).unlink()

    events = _repair(root)

    deployment = json.loads((dest / lfs.DEPLOYMENT_METADATA_FILE).read_text(encoding="utf-8"))
    assert deployment["start_date"].startswith("2024-06-30T08:00:00") and deployment["end_date"].startswith("2024-07-02T18:00:00")
    assert "the timestamp log says so" in next(e["message"] for e in events if e["type"] == "step" and e["step"] == "dates" and e["status"] == "done")
    assert lfs.TIMESTAMP_LOG_SUFFIX not in "".join(events[-1]["written"])  # the log was not touched


def test_without_a_row_in_the_log_the_period_is_the_one_left_in_deployment_json_or_the_images_and_the_row_is_added(kept):
    root, dest = kept
    collection = dest.parent
    lfs.timestamp_log_path(collection).unlink()
    (dest / lfs.DEPLOYMENT_METADATA_FILE).unlink()

    events = _repair(root)

    rows = lfs.read_timestamp_log(lfs.timestamp_log_path(collection))
    assert [(r["Deployment"], r["StartDate"], r["StartTime"], r["EndTime"]) for r in rows] == [(DEPLOYMENT_ID.lower(), "2024:07:01", "10:00:00", "11:30:00")]  # from the images
    assert lfs.timestamp_log_path(collection).name in events[-1]["written"]


def test_what_is_left_of_deployment_json_is_kept(kept):
    root, dest = kept
    metadata = json.loads((dest / lfs.DEPLOYMENT_METADATA_FILE).read_text(encoding="utf-8"))
    metadata.update({"setup_by": "Ana", "comments": "Near the pond", "camera_height": 1.2})
    (dest / lfs.DEPLOYMENT_METADATA_FILE).write_text(json.dumps(metadata), encoding="utf-8")
    (dest / seal_service.SEAL_FILE).unlink()

    _repair(root)

    after = json.loads((dest / lfs.DEPLOYMENT_METADATA_FILE).read_text(encoding="utf-8"))
    assert (after["setup_by"], after["comments"], after["camera_height"]) == ("Ana", "Near the pond", 1.2)


def test_what_the_images_fail_is_reported_and_the_repair_still_seals(kept):
    root, dest = kept
    (dest / "R0003-DONA_01__20240701_3.JPEG").write_bytes((dest / "R0003-DONA_01__20240701_2.JPEG").read_bytes())  # a duplicate, with the same date
    (dest / seal_service.SEAL_FILE).unlink()

    events = _repair(root)

    report = report_service.read(events[-1]["report_id"])
    assert report["kind"] == "repair" and report["checks"]["duplicates"]["failed"] == 2
    assert events[-1]["problems"] >= 2 and events[-1]["status"] == "valid"


def test_the_names_of_the_images_are_checked_as_preprocessing_leaves_them(kept):
    root, dest = kept
    (dest / "R0003-DONA_01__20240701_1.JPEG").rename(dest / "holiday.jpg")

    events = _repair(root)

    report = report_service.read(events[-1]["report_id"])
    names = {e["identifier"]: e["message"] for e in report["entries"] if e["check"] == "preprocessing_names" and e["status"] == "failed"}
    assert list(names) == ["holiday.jpg"] and "is not named" in names["holiday.jpg"]


def test_a_deployment_with_no_images_gets_its_deployment_json_and_nothing_to_seal(kept):
    root, dest = kept
    for p in dest.iterdir():
        p.unlink()

    events = _repair(root)

    assert [e["step"] for e in events if e["type"] == "step" and e["status"] == "skipped"] == ["preprocessing", "images", "seal"]
    assert (dest / lfs.DEPLOYMENT_METADATA_FILE).is_file() and not (dest / seal_service.SEAL_FILE).exists()
    assert events[-1]["status"] == "unsealed"


def test_it_says_what_is_missing_when_the_deployment_cannot_be_rebuilt(kept):
    root, dest = kept
    (dest.parent.parent / lfs.LOCATIONS_FILE).write_text("[]", encoding="utf-8")
    (dest / lfs.DEPLOYMENT_METADATA_FILE).unlink()

    with pytest.raises(rep.RepairError, match="deployment.json can't be rebuilt"):
        _repair(root)


def test_a_deployment_synced_from_trapper_is_never_repaired(kept):
    root, dest = kept
    lfs.write_images_file(dest, DEPLOYMENT_ID, [], source="trapper")

    assert rep.inspect(root, "DONA", "R0003", DEPLOYMENT_ID)["status"] == "synced"
    with pytest.raises(rep.RepairError, match="synced from Trapper"):
        _repair(root)


def test_the_collections_list_every_deployment_folder_whatever_state_it_is_in(kept):
    root, dest = kept
    (dest.parent / "R0003-DONA_02").mkdir()
    (dest / lfs.DEPLOYMENT_METADATA_FILE).unlink()

    found = rep.list_collections(root, "DONA")

    assert [c["name"] for c in found] == ["R0003"]
    by_id = {d["deployment_id"]: d for d in found[0]["deployments"]}
    assert set(by_id) == {DEPLOYMENT_ID, "R0003-DONA_02"} and by_id[DEPLOYMENT_ID]["images"] == 3
    assert by_id[DEPLOYMENT_ID]["files"][lfs.DEPLOYMENT_METADATA_FILE] is False and by_id["R0003-DONA_02"]["images"] == 0


@pytest.mark.parametrize("collection, deployment", [("Doñana", DEPLOYMENT_ID), ("R0003", "DONA-01"), ("R0009", DEPLOYMENT_ID), ("R0003", "R0003-OTHER_01")])
def test_names_that_are_not_there_are_refused(kept, collection: str, deployment: str):
    root, _ = kept
    with pytest.raises(rep.RepairError):
        rep.inspect(root, "DONA", collection, deployment)
