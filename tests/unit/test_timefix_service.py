"""Fixing the dates and times of a copied card: the timeline and its segments against the deployment's period, a run of
images shifted, images removed, and the card put back — the untouched copy kept and every fix written down."""
import datetime as dt
import json
import shutil

import pytest
from fastapi.testclient import TestClient

from tests.unit.test_deployment_import_service import _make_jpeg
from tests.unit.test_fieldlog_service import trip  # noqa: F401
from tests.unit.test_ingest_service import _card, _copy, recorded  # noqa: F401
from wildintel_uploader.core.services import deployment_import_service as dis
from wildintel_uploader.core.services import ingest_service as ing
from wildintel_uploader.core.services import timefix_service as tf
from wildintel_uploader.web.main import app

needs_exiftool = pytest.mark.skipif(shutil.which("exiftool") is None, reason="ExifTool isn't installed")
DEP = "R0002-TATR_0001"  # its period: 2026-02-20 09:30 → 2026-03-30 08:15 (UTC, the cameras' clock)


@pytest.fixture
def copied(recorded, tmp_path, monkeypatch):  # noqa: F811
    """R0002-TATR_0001's card copied: two images in its period, then the clock reset to 2020 for two more."""
    monkeypatch.setattr(tf, "originals_dir", lambda settings=None: tmp_path / "originals")
    card = tmp_path / "sd"
    for i, taken in enumerate(["2026:02:21 10:00:00", "2026:02:22 10:00:00", "2020:01:01 00:00:00", "2020:01:01 06:00:00"], start=1):
        _make_jpeg(card / "DCIM" / f"IMG_{i:04d}.JPG", taken=taken)
    _copy(card)
    ing.prepare_collection("TATRA", "R0002")
    _, cards = recorded
    return cards / "TATRA" / "R0002" / DEP, tmp_path / "originals" / "TATRA" / "R0002" / DEP


def _times(folder):
    return [dis._image_datetime(p).isoformat() for p in sorted(folder.glob("*.JPG"))]


def test_the_timeline_splits_where_the_time_goes_backwards(copied):
    seen = tf.timeline("TATRA", "R0002", DEP)

    assert [s["state"] for s in seen["segments"]] == ["ok", "outside"]
    second = seen["segments"][1]
    assert (second["first"], second["last"], second["count"]) == ("IMG_0003.JPG", "IMG_0004.JPG", 2)
    # It should go on from where the first one ended: 2026-02-22 10:00:01.
    assert second["suggestion"]["offset_seconds"] == int((dt.datetime(2026, 2, 22, 10, 0, 1) - dt.datetime(2020, 1, 1)).total_seconds())
    assert seen["outside"] == 2 and not seen["ok"]
    assert seen["period"]["start"] == "2026-02-20T09:30:00"


@needs_exiftool
def test_shifting_a_run_fixes_it_and_keeps_the_card_as_it_was(copied):
    folder, originals = copied
    offset = tf.timeline("TATRA", "R0002", DEP)["segments"][1]["suggestion"]["offset_seconds"]

    after = tf.shift("TATRA", "R0002", DEP, "IMG_0003.JPG", None, offset, "clock reset after the batteries died")

    assert after["ok"] and len(after["segments"]) == 1
    assert _times(folder) == ["2026-02-21T10:00:00", "2026-02-22T10:00:00", "2026-02-22T10:00:01", "2026-02-22T16:00:01"]
    assert _times(originals)[2] == "2020-01-01T00:00:00"  # the untouched copy
    [entry] = after["corrections"]
    assert (entry["action"], entry["first"], entry["last"], entry["count"], entry["offset_seconds"]) == ("shift", "IMG_0003.JPG", "IMG_0004.JPG", 2, offset)
    assert entry["reason"] == "clock reset after the batteries died"


def test_images_without_a_time_to_trust_are_removed(copied):
    folder, originals = copied
    after = tf.remove("TATRA", "R0002", DEP, ["IMG_0003.JPG", "IMG_0004.JPG"], "no way to know when")

    assert after["ok"] and [i["name"] for i in after["images"]] == ["IMG_0001.JPG", "IMG_0002.JPG"]
    assert (originals / "IMG_0004.JPG").is_file()
    assert json.loads((folder / tf.CORRECTIONS_FILE).read_text())[0]["action"] == "remove"


def test_the_card_can_be_put_back(copied):
    folder, _ = copied
    with pytest.raises(tf.TimeFixError, match="not been fixed"):
        tf.restore("TATRA", "R0002", DEP)
    tf.remove("TATRA", "R0002", DEP, ["IMG_0004.JPG"])

    after = tf.restore("TATRA", "R0002", DEP)

    assert len(after["images"]) == 4 and [c["action"] for c in after["corrections"]] == ["remove", "restore"]


def test_a_run_must_be_in_the_deployment(copied):
    with pytest.raises(tf.TimeFixError, match="no image"):
        tf.shift("TATRA", "R0002", DEP, "IMG_0099.JPG", None, 60)
    with pytest.raises(tf.TimeFixError, match="comes before"):
        tf.shift("TATRA", "R0002", DEP, "IMG_0003.JPG", "IMG_0001.JPG", 60)
    with pytest.raises(tf.TimeFixError, match="has no copied card"):
        tf.timeline("TATRA", "R0002", "R0002-TATR_0002")


def test_the_shift_is_given_to_exiftool_in_days_hours_minutes_and_seconds():
    assert tf._shift_argument(400 * 86400 + 5 * 3600 + 30 * 60 + 15) == "-AllDates+=0:0:400 5:30:15"
    assert tf._shift_argument(-3600) == "-AllDates-=0:0:0 1:0:0"


def test_the_collections_with_copied_cards_are_listed(copied):
    assert tf.collections("TATRA") == [{"collection": "R0002", "deployments": [DEP]}]


def test_the_api_reads_the_timeline_and_refuses_a_bad_run(copied):
    client = TestClient(app)
    body = {"research_project_id": "TATRA", "collection": "R0002", "deployment_id": DEP}

    assert client.post("/api/timefix/timeline", json=body).json()["outside"] == 2
    assert client.post("/api/timefix/shift", json={**body, "first": "nope.jpg", "offset_seconds": 5}).status_code == 400
    assert client.post("/api/timefix/collections", json={"research_project_id": "TATRA"}).json()["results"][0]["collection"] == "R0002"
