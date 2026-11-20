"""services.file_memo — what the steps of an import remember of a file while it is the same one: the camera of an image, and that it decoded in full (#140)."""
import os
from pathlib import Path

import pytest
from PIL import Image

from wildintel_uploader.core.services import camera_info, file_memo
from wildintel_uploader.core.services import deployment_import_service as svc
from wildintel_uploader.core.services import preprocessing_service as pre


def _jpeg(path: Path, size=(4, 4), make="Reconyx", model="HC600", color="red") -> Path:
    img = Image.new("RGB", size, color=color)
    exif = img.getexif()
    exif[271], exif[272] = make, model
    exif[306] = "2024:09:01 10:00:00"
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, exif=exif)
    return path


# ── the memory itself ────────────────────────────────────────────────────────

def test_a_memory_is_bounded_and_forgets_the_oldest_first():
    memo = file_memo.FileMemo(limit=2)
    for n in range(3):
        memo.put(("f", n, n), n)
    assert memo.get(("f", 0, 0)) is None and memo.get(("f", 1, 1)) == 1 and memo.get(("f", 2, 2)) == 2


def test_a_memory_keeps_what_was_asked_for_last():
    memo = file_memo.FileMemo(limit=2)
    memo.put(("f", 0, 0), 0)
    memo.put(("f", 1, 1), 1)
    memo.get(("f", 0, 0))
    memo.put(("f", 2, 2), 2)
    assert memo.get(("f", 0, 0)) == 0 and memo.get(("f", 1, 1)) is None


def test_a_file_that_cannot_be_looked_at_has_no_stamp_and_nothing_is_kept_of_it(tmp_path: Path):
    assert file_memo.stamp(tmp_path / "nothing.jpg") is None
    memo = file_memo.FileMemo()
    memo.put(None, 1)
    assert memo.get(None) is None and len(memo) == 0


def test_a_file_changed_in_size_or_in_time_has_another_stamp(tmp_path: Path):
    path = tmp_path / "a.bin"
    path.write_bytes(b"one")
    before = file_memo.stamp(path)
    path.write_bytes(b"three")
    assert file_memo.stamp(path) != before
    again = file_memo.stamp(path)
    os.utime(path, ns=(1, 1))
    assert file_memo.stamp(path) != again


# ── the camera ───────────────────────────────────────────────────────────────

@pytest.fixture
def no_exiftool(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(camera_info, "exiftool_path", lambda: None)


def _count(monkeypatch: pytest.MonkeyPatch, name: str) -> list:
    calls: list = []
    real = getattr(camera_info, name)
    monkeypatch.setattr(camera_info, name, lambda *a, **k: calls.append(a) or real(*a, **k))
    return calls


def test_the_camera_of_an_image_is_read_once_while_the_image_is_the_same(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, no_exiftool):
    images = [_jpeg(tmp_path / f"IMG_{n}.jpg", model=f"M{n}") for n in range(3)]
    calls = _count(monkeypatch, "_read_with_pillow")

    first, reader = camera_info.read_cameras(images)
    second, again = camera_info.read_cameras(images)

    assert len(calls) == 3 and first == second and reader == again == "pillow"
    assert [info.model for info in second.values()] == ["Reconyx M0", "Reconyx M1", "Reconyx M2"]


def test_only_the_images_that_changed_are_read_again(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, no_exiftool):
    images = [_jpeg(tmp_path / f"IMG_{n}.jpg") for n in range(3)]
    camera_info.read_cameras(images)
    calls = _count(monkeypatch, "_read_with_pillow")

    _jpeg(images[1], size=(8, 8), model="Another")   # replaced by another image
    cameras, _ = camera_info.read_cameras(images)

    assert [c[0].name for c in calls] == ["IMG_1.jpg"]
    assert cameras[images[1]].model == "Reconyx Another" and cameras[images[0]].model == "Reconyx HC600"


def test_a_reading_by_pillow_is_made_again_when_exiftool_is_there_now(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    images = [_jpeg(tmp_path / "a.jpg")]
    monkeypatch.setattr(camera_info, "exiftool_path", lambda: None)
    camera_info.read_cameras(images)

    monkeypatch.setattr(camera_info, "exiftool_path", lambda: "exiftool")
    seen = []
    monkeypatch.setattr(camera_info, "_read_with_exiftool", lambda tool, paths: seen.append(list(paths)) or {p: camera_info.CameraInfo(model="From ExifTool", camera_id="S1") for p in paths})
    cameras, reader = camera_info.read_cameras(images)

    assert seen == [images] and reader == "exiftool" and cameras[images[0]].camera_id == "S1"
    seen.clear()
    camera_info.read_cameras(images)
    assert seen == []   # and now it is remembered


def test_the_reader_is_pillow_when_any_image_was_read_by_it(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    a, b = _jpeg(tmp_path / "a.jpg"), _jpeg(tmp_path / "b.jpg")
    monkeypatch.setattr(camera_info, "exiftool_path", lambda: "exiftool")
    monkeypatch.setattr(camera_info, "_read_with_exiftool", lambda tool, paths: {p: camera_info.CameraInfo(model="X") for p in paths})
    assert camera_info.read_cameras([a])[1] == "exiftool"
    monkeypatch.setattr(camera_info, "_read_with_exiftool", lambda tool, paths: (_ for _ in ()).throw(OSError("gone")))
    assert camera_info.read_cameras([a, b])[1] == "pillow"


# ── the images that decode ───────────────────────────────────────────────────

def _opens(monkeypatch: pytest.MonkeyPatch) -> list:
    opened: list = []
    real = svc.Image.open
    monkeypatch.setattr(svc.Image, "open", lambda path, *a, **k: opened.append(Path(path).name) or real(path, *a, **k))
    return opened


def test_an_image_that_decoded_is_not_decoded_again_while_it_is_the_same(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _jpeg(tmp_path / "a.jpg")
    _jpeg(tmp_path / "b.jpg")
    opened = _opens(monkeypatch)

    assert svc.validate_images(tmp_path, frozenset({"corrupted"}))["corrupted"] == []
    assert sorted(opened) == ["a.jpg", "b.jpg"]
    opened.clear()
    assert svc.validate_images(tmp_path, frozenset({"corrupted"}))["corrupted"] == []
    assert opened == []


def test_a_corrupted_image_is_looked_at_every_time(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _jpeg(tmp_path / "good.jpg")
    bad = _jpeg(tmp_path / "bad.jpg", size=(64, 64))
    bad.write_bytes(bad.read_bytes()[:-40])   # cut short
    opened = _opens(monkeypatch)

    for _ in range(2):
        assert [c["path"] for c in svc.validate_images(tmp_path, frozenset({"corrupted"}))["corrupted"]] == ["bad.jpg"]
    assert opened.count("bad.jpg") == 2 and opened.count("good.jpg") == 1


def test_an_image_that_decoded_and_was_then_cut_short_is_found_corrupted(tmp_path: Path):
    path = _jpeg(tmp_path / "a.jpg", size=(64, 64))
    assert svc.validate_images(tmp_path, frozenset({"corrupted"}))["corrupted"] == []

    path.write_bytes(path.read_bytes()[:-40])

    assert [c["path"] for c in svc.validate_images(tmp_path, frozenset({"corrupted"}))["corrupted"]] == ["a.jpg"]


def test_resizing_an_image_says_it_decoded_and_the_check_does_not_decode_it_again(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    big = _jpeg(tmp_path / "src" / "big.jpg", size=(3000, 2000))
    pre.resize_to_width(big, tmp_path / "out.jpg", 2400)
    opened = _opens(monkeypatch)

    assert svc.validate_images(big.parent, frozenset({"corrupted"}))["corrupted"] == []
    assert opened == []


def test_an_image_that_is_only_copied_is_not_said_to_have_decoded(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    small = _jpeg(tmp_path / "src" / "small.jpg", size=(1000, 800))
    assert pre.resize_to_width(small, tmp_path / "out.jpg", 2400) is False
    opened = _opens(monkeypatch)

    svc.validate_images(small.parent, frozenset({"corrupted"}))

    assert opened == ["small.jpg"]


def test_an_image_that_failed_to_resize_is_not_said_to_have_decoded(tmp_path: Path):
    bad = _jpeg(tmp_path / "src" / "bad.jpg", size=(3000, 2000))
    bad.write_bytes(bad.read_bytes()[:-2000])
    with pytest.raises(Exception):
        pre.resize_to_width(bad, tmp_path / "out.jpg", 2400)

    assert [c["path"] for c in svc.validate_images(bad.parent, frozenset({"corrupted"}))["corrupted"]] == ["bad.jpg"]
