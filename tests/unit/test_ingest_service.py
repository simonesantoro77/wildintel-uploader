"""Copying the SD cards, guided by the field records: the collection's cards folder, a card looked at and matched to
its deployment, the checked copy and its record, and folders that come from elsewhere."""
import csv
import json
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from tests.unit.test_deployment_import_service import _make_jpeg
from tests.unit.test_fieldlog_service import trip  # noqa: F401 — the field records' own fixture
from wildintel_uploader.core.services import fieldlog_service as fs
from wildintel_uploader.core.services import ingest_service as ing
from wildintel_uploader.core.services import local_folder_service as lfs
from wildintel_uploader.web.main import app


@pytest.fixture
def recorded(trip, tmp_path):  # noqa: F811
    """The field records of R0002 written — R0002-TATR_0001's card collected (2026-02-20 09:30 → 2026-03-30 08:15 UTC,
    card 1b), R0002-TATR_0002's camera still out — and a cards folder of its own."""
    root, epi, sheet = trip
    fs.apply(str(epi), str(sheet), "TATRA")
    cards = tmp_path / "cards"
    with patch("wildintel_uploader.core.config.cards_dir", return_value=cards):
        yield root, cards


def _card(path: Path, days=("2026:02:21", "2026:03:01", "2026:03:29"), extra=True) -> Path:
    """A card as a camera leaves it: DCIM/100MEDIA with the images, and the system's own files beside."""
    for i, day in enumerate(days, start=1):
        _make_jpeg(path / "DCIM" / "100MEDIA" / f"IMG_{i:04d}.JPG", taken=f"{day} 12:00:00", make="Bushnell", model="Core")
    if extra:
        (path / ".DS_Store").write_text("x")
        (path / "DCIM" / "100MEDIA" / "Thumbs.db").write_text("x")
    return path


def _copy(source, deployment_id="R0002-TATR_0001", **kw):
    return list(ing.copy_stream(str(source), "TATRA", "R0002", deployment_id, kw.pop("card_label", "1b"), **kw))


def test_the_collections_with_field_records_are_listed(recorded):
    assert ing.list_collections("TATRA") == ["R0002"]


def test_the_status_says_which_cards_are_to_copy(recorded):
    status = ing.collection_status("TATRA", "R0002")

    states = {d["deployment_id"]: d["state"] for d in status["deployments"]}
    assert states == {"R0002-TATR_0001": "to_copy", "R0002-TATR_0002": "out"}
    assert status["counts"] == {"out": 1, "to_copy": 1, "copied": 0, "processed": 0}


def test_preparing_makes_a_folder_ready_for_import_session(recorded):
    _, cards = recorded
    ing.prepare_collection("TATRA", "R0002")

    folder = cards / "TATRA" / "R0002"
    assert (folder / "R0002_FileTimestampLog.csv").is_file()
    assert (folder / "R0002-TATR_0001").is_dir() and not (folder / "R0002-TATR_0002").exists()


def test_a_collection_without_field_records_cannot_be_prepared(recorded):
    with pytest.raises(ing.IngestError, match="Field records"):
        ing.prepare_collection("TATRA", "R0009")


def test_a_card_is_matched_to_its_deployment(recorded, tmp_path):
    card = _card(tmp_path / "sd")
    seen = ing.inspect_source(str(card), "TATRA", "R0002", "1B")

    assert (seen["file_count"], seen["image_count"]) == (3, 3)  # the system's files are left out
    assert seen["first"].startswith("2026-02-21") and seen["camera_models"] == ["Bushnell Core"]
    [best] = seen["candidates"]
    assert best["deployment_id"] == "R0002-TATR_0001"
    assert any("Card 1b" in f for f in best["fits"]) and any("within its period" in f for f in best["fits"])


def test_images_outside_the_period_are_pointed_out(recorded, tmp_path):
    card = _card(tmp_path / "sd", days=("2026:02:21", "2026:05:01"))
    [best] = ing.inspect_source(str(card), "TATRA", "R0002")["candidates"]

    assert any("1 of 2 images were taken outside its period" in p for p in best["problems"])


def test_copying_checks_each_file_and_writes_the_record(recorded, tmp_path):
    _, cards = recorded
    card = _card(tmp_path / "sd")
    events = _copy(card)

    dest = cards / "TATRA" / "R0002" / "R0002-TATR_0001"
    assert [e["type"] for e in events] == ["copy", "copy", "copy", "done"]
    assert sorted(p.name for p in dest.iterdir()) == ["IMG_0001.JPG", "IMG_0002.JPG", "IMG_0003.JPG", "card_copy.json"]
    record = json.loads((dest / ing.COPY_RECORD_FILE).read_text())
    assert record["card_label"] == "1b" and record["file_count"] == 3
    assert record["files"][0]["source"] == "DCIM/100MEDIA/IMG_0001.JPG" and len(record["files"][0]["sha256"]) == 64
    assert (card / "DCIM" / "100MEDIA" / "IMG_0001.JPG").is_file()  # the card is untouched
    assert ing.collection_status("TATRA", "R0002")["counts"]["copied"] == 1


def test_a_card_copied_already_is_refused_whatever_deployment_it_is_offered_to(recorded, tmp_path):
    card = _card(tmp_path / "sd")
    _copy(card)

    assert ing.inspect_source(str(card), "TATRA", "R0002")["already_copied"][0]["deployment_id"] == "R0002-TATR_0001"
    with pytest.raises(ing.IngestError, match="already copied"):
        _copy(card, "R0002-TATR_0099", allow_unknown=True)


def test_a_deployment_whose_camera_is_still_out_gets_no_card(recorded, tmp_path):
    with pytest.raises(ing.IngestError, match="still out"):
        _copy(_card(tmp_path / "sd"), "R0002-TATR_0002")
    with pytest.raises(ing.IngestError, match="not in the field records"):
        _copy(_card(tmp_path / "sd2", days=("2026:02:22",)), "R0002-TATR_0077")


def test_the_label_on_the_card_is_required_and_a_different_one_must_be_confirmed(recorded, tmp_path):
    _, cards = recorded
    card = _card(tmp_path / "sd")
    with pytest.raises(ing.IngestError, match="label written on the card"):
        _copy(card, card_label="")
    with pytest.raises(ing.IngestError, match="field records say 1b"):
        _copy(card, card_label="8")

    _copy(card, card_label="8", label_confirmed=True)
    folder = cards / "TATRA" / "R0002"
    record = json.loads((folder / "R0002-TATR_0001" / ing.COPY_RECORD_FILE).read_text())
    assert record["label_mismatch"] is True and record["field_card"] == "1b"
    [row] = ing.read_corrections("TATRA", "R0002")
    assert (row["deployment"], row["field records say"], row["found"]) == ("R0002-TATR_0001", "1b", "8")


def test_cards_copied_or_processed_are_not_offered_again(recorded, tmp_path):
    root, _ = recorded
    card = _card(tmp_path / "sd")
    _copy(card)
    assert ing.inspect_source(str(_card(tmp_path / "sd2", days=("2026:02:23",))), "TATRA", "R0002")["candidates"] == []

    processed = root / "TATRA" / "R0002" / "R0002-TATR_0001"
    processed.mkdir(parents=True, exist_ok=True)
    (processed / lfs.DEPLOYMENT_METADATA_FILE).write_text("{}")
    assert {d["deployment_id"]: d["state"] for d in ing.collection_status("TATRA", "R0002")["deployments"]}["R0002-TATR_0001"] == "processed"


def test_the_cards_collections_and_the_field_details_are_offered(recorded, tmp_path):
    ing.prepare_collection("TATRA", "R0002")
    [found] = ing.card_collections()
    assert (found["research_project_id"], found["collection"], found["deployments"], found["processed"]) == ("TATRA", "R0002", 1, 0)
    details = ing.field_details("TATRA", "R0002")["R0002-TATR_0001"]
    assert details["location_id"] == "TATR_0001" and details["card"] == "1b" and isinstance(details["tags"], list)


def test_the_camtrap_fields_of_the_field_records_fill_the_details_in(recorded):
    root, _ = recorded
    log = root / "TATRA" / "R0002" / "R0002_FieldworkLog.csv"
    rows = fs.read_fieldwork_log(log.parent)
    rows[0].update(cameraHeight="1.2", baitUse="true", featureType="trailGame", habitat="forest", cameraTilt="")
    with log.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fs.FIELDWORK_LOG_FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    details = ing.field_details("TATRA", "R0002")[rows[0]["deploymentID"]]

    assert (details["camera_height"], details["bait_use"], details["feature_type"], details["habitat"], details["camera_tilt"]) == (1.2, True, "trailGame", "forest", None)


def test_only_a_removable_drive_is_ejected(tmp_path):
    with patch("platform.system", return_value="Linux"):
        assert ing.eject(str(tmp_path))["ejected"] is False


def test_a_card_is_only_said_ejected_once_windows_has_ejected_it():
    from unittest.mock import MagicMock
    windll = MagicMock()
    windll.kernel32.GetDriveTypeW.return_value = 2  # removable
    with patch("platform.system", return_value="Windows"), patch("ctypes.windll", windll, create=True):
        with patch.object(ing, "_eject_windows_ioctl", return_value=(True, "")):
            assert ing.eject("E:\\DCIM") == {"ejected": True, "message": "E: ejected: you can take the card out."}
        with patch.object(ing, "_eject_windows_ioctl", return_value=(False, "something still has a file of the card open")), \
             patch.object(ing, "_eject_windows_shell", return_value=False) as shell:
            done = ing.eject("E:\\")
        assert done["ejected"] is False and "file of the card open" in done["message"] and shell.called
        with patch.object(ing, "_eject_windows_ioctl", return_value=(False, "busy")), patch.object(ing, "_eject_windows_shell", return_value=True):
            assert ing.eject("E:\\")["ejected"] is True
        windll.kernel32.GetDriveTypeW.return_value = 3  # a fixed disk is never ejected
        assert ing.eject("C:\\cards")["ejected"] is False


def test_files_with_the_same_name_in_two_folders_are_both_kept(recorded, tmp_path):
    _, cards = recorded
    card = _card(tmp_path / "sd", days=("2026:02:21",), extra=False)
    _make_jpeg(card / "DCIM" / "101MEDIA" / "IMG_0001.JPG", taken="2026:02:22 12:00:00")
    _copy(card)

    names = sorted(p.name for p in (cards / "TATRA" / "R0002" / "R0002-TATR_0001").glob("*.JPG"))
    assert names == ["DCIM_101MEDIA_IMG_0001.JPG", "IMG_0001.JPG"]


def test_folders_from_elsewhere_get_their_collection_and_site_guessed(recorded, tmp_path):
    tree = tmp_path / "old"
    _make_jpeg(tree / "TATR_0001" / "R0002" / "a.jpg", taken="2026:02:21 12:00:00")
    _make_jpeg(tree / "R0002" / "tatr_0002" / "b.jpg", taken="2026:02:21 12:00:00")
    _make_jpeg(tree / "misc" / "c.jpg", taken="2026:02:21 12:00:00")

    folders = {f["relative"]: f for f in ing.scan_tree(str(tree), "TATRA")["folders"]}

    assert folders["TATR_0001/R0002"]["deployment_id"] == "R0002-TATR_0001"
    assert folders["R0002/tatr_0002"]["deployment_id"] == "R0002-TATR_0002"
    assert folders["misc"]["deployment_id"] is None


def test_the_api_copies_a_card_and_refuses_it_twice(recorded, tmp_path):
    card = _card(tmp_path / "sd")
    client = TestClient(app)
    body = {"research_project_id": "TATRA", "collection": "R0002", "source": str(card), "card_label": "1b", "deployment_id": "R0002-TATR_0001"}

    assert client.post("/api/ingest/collections", json={"research_project_id": "TATRA"}).json()["results"] == ["R0002"]
    assert client.post("/api/ingest/inspect", json=body).json()["candidates"][0]["deployment_id"] == "R0002-TATR_0001"
    lines = [json.loads(l) for l in client.post("/api/ingest/copy", json=body).text.splitlines()]
    again = client.post("/api/ingest/copy", json=body)

    assert lines[-1]["type"] == "done" and lines[-1]["record"]["file_count"] == 3
    assert again.status_code == 400 and "already copied" in again.json()["detail"]
