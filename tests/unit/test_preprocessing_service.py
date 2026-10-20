"""services.preprocessing_service — the dates, the names, the resizing and the XMP
metadata images get as they are imported into their collection."""
import hashlib
import json
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import pytest
from PIL import Image

from wildintel_uploader.core.schemas.requests import DeploymentFields
from wildintel_uploader.core.services import camera_info
from wildintel_uploader.core.services import preprocessing_service as pre

needs_exiftool = pytest.mark.skipif(shutil.which("exiftool") is None, reason="ExifTool isn't installed")

DEPLOYMENT = DeploymentFields.model_validate({
    "deployment_id": "R0003-DONA_01", "location_id": "DONA_01", "location_name": "Doñana site 1", "latitude": 37.0, "longitude": -6.5,
    "start_date": "2024-07-01T00:00:00+02:00", "end_date": "2024-07-31T00:00:00+02:00",
})
NO_XMP = pre.PreprocessOptions(metadata=False, timezone="Europe/Madrid")


def _jpeg(path: Path, *, taken: str | None = "2024:07:01 10:00:00", size=(3000, 2000), make="RECONYX", model="HF2 PRO COVERT", color="red") -> Path:
    img = Image.new("RGB", size, color=color)
    exif = img.getexif()
    if taken:
        exif.get_ifd(0x8769)[36867] = taken
    if make:
        exif[271] = make
    if model:
        exif[272] = model
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, exif=exif)
    return path


def _run(source: Path, collection: Path, options=NO_XMP, deployment=DEPLOYMENT, name=None) -> list[dict]:
    return list(pre.preprocess_stream(str(source), str(collection), name, deployment, options))


# ── dates ────────────────────────────────────────────────────────────────────

def test_ignoring_summer_time_reads_the_clock_in_the_standard_offset_all_year():
    zone = pre.zone_of("Europe/Madrid")
    summer = pre.localize(datetime(2024, 7, 1, 10, 0), zone, ignore_dst=True)
    winter = pre.localize(datetime(2024, 1, 1, 10, 0), zone, ignore_dst=True)

    assert summer.utcoffset().total_seconds() == 3600 and winter.utcoffset().total_seconds() == 3600  # +01:00 both
    assert pre.localize(datetime(2024, 7, 1, 10, 0), zone, ignore_dst=False).utcoffset().total_seconds() == 7200  # +02:00 in summer


def test_the_capture_date_is_converted_to_utc(tmp_path: Path):
    image = _jpeg(tmp_path / "a.jpg", taken="2024:07:01 10:00:00")

    utc, source = pre.capture_datetime(image, pre.PreprocessOptions(timezone="Europe/Madrid", ignore_dst=True, convert_to_utc=True))
    dst, _ = pre.capture_datetime(image, pre.PreprocessOptions(timezone="Europe/Madrid", ignore_dst=False, convert_to_utc=True))
    local, _ = pre.capture_datetime(image, pre.PreprocessOptions(timezone="Europe/Madrid", ignore_dst=False, convert_to_utc=False))

    assert source == "exif"
    assert utc == datetime(2024, 7, 1, 9, 0, tzinfo=timezone.utc)   # 10:00 at +01:00
    assert dst == datetime(2024, 7, 1, 8, 0, tzinfo=timezone.utc)   # 10:00 at +02:00
    assert local.isoformat() == "2024-07-01T10:00:00+02:00"         # not converted


def test_the_capture_date_falls_back_from_the_original_to_the_digitized_date_to_the_file(tmp_path: Path):
    digitized = tmp_path / "digitized.jpg"
    img = Image.new("RGB", (10, 10))
    exif = img.getexif()
    exif.get_ifd(0x8769)[36868] = "2024:05:05 05:05:05"  # only DateTimeDigitized
    img.save(digitized, exif=exif)
    no_data = tmp_path / "nodata.jpg"
    img = Image.new("RGB", (10, 10))
    exif = img.getexif()
    exif.get_ifd(0x8769)[36867] = "0000:00:00 00:00:00"  # what some cameras write when the clock is unset
    img.save(no_data, exif=exif)
    bare = _jpeg(tmp_path / "bare.jpg", taken=None)
    options = pre.PreprocessOptions(timezone="UTC", convert_to_utc=False)

    assert pre.capture_datetime(digitized, options) == (datetime(2024, 5, 5, 5, 5, 5, tzinfo=pre.zone_of("UTC")), "exif")
    assert pre.capture_datetime(no_data, options)[1] == "file"
    date, source = pre.capture_datetime(bare, options)
    assert source == "file" and abs((date.replace(tzinfo=None) - datetime.fromtimestamp(bare.stat().st_mtime)).total_seconds()) < 2


def test_an_unknown_timezone_is_refused():
    with pytest.raises(pre.DeploymentImportError, match="Unknown timezone"):
        pre.zone_of("Mars/Olympus")


# ── names ────────────────────────────────────────────────────────────────────

def test_the_new_name_is_deployment_date_and_position_in_upper_case():
    date = datetime(2024, 7, 1, 9, 0, tzinfo=timezone.utc)

    assert pre.new_name("R0003-DONA_01", date, 7, ".jpg") == "R0003-DONA_01__20240701_7.JPEG"
    assert pre.new_name("R0003-DONA_01", date, 12, ".JPEG") == "R0003-DONA_01__20240701_12.JPEG"
    assert pre.new_name("R0003-DONA_01", date, 1, ".png") == "R0003-DONA_01__20240701_1.PNG"


# ── resizing ─────────────────────────────────────────────────────────────────

def test_a_wide_image_is_resized_to_the_width_keeping_its_proportions_exif_and_all(tmp_path: Path):
    source = _jpeg(tmp_path / "big.jpg", size=(4800, 3200))

    resized = pre.resize_to_width(source, tmp_path / "out.jpg", 2400)

    assert resized is True
    with Image.open(tmp_path / "out.jpg") as img:
        assert img.size == (2400, 1600)
        assert img.getexif().get(271) == "RECONYX"                          # the make survived
        assert img.getexif().get_ifd(0x8769).get(36867) == "2024:07:01 10:00:00"  # and the capture date


def test_the_resize_keeps_the_jpeg_quality_the_original_had(tmp_path: Path):
    source = tmp_path / "low.jpg"
    Image.effect_noise((4800, 3200), 40).convert("RGB").save(source, "JPEG", quality=60)

    pre.resize_to_width(source, tmp_path / "out.jpg", 2400)

    with Image.open(source) as before, Image.open(tmp_path / "out.jpg") as after:
        assert after.quantization == before.quantization   # not re-encoded at a fixed, higher quality
    assert (tmp_path / "out.jpg").stat().st_size < source.stat().st_size


def test_an_image_no_wider_than_the_width_is_left_exactly_as_it_is(tmp_path: Path):
    source = _jpeg(tmp_path / "small.jpg", size=(1200, 800))

    assert pre.resize_to_width(source, tmp_path / "out.jpg", 2400) is False
    assert (tmp_path / "out.jpg").read_bytes() == source.read_bytes()  # not even re-encoded


def test_the_resize_keeps_the_format(tmp_path: Path):
    png = tmp_path / "a.png"
    Image.new("RGB", (3000, 1000), "blue").save(png)

    pre.resize_to_width(png, tmp_path / "out.png", 1500)

    with Image.open(tmp_path / "out.png") as img:
        assert img.format == "PNG" and img.size == (1500, 500)


# ── the XMP tags ─────────────────────────────────────────────────────────────

def _tags(**overrides) -> dict:
    options = pre.PreprocessOptions(owner="Universidad de Huelva", publisher="WildINTEL", coverage="Doñana National Park", research_project="Doñana", **overrides)
    return pre.xmp_tags(options, DEPLOYMENT, camera="RECONYX HF2 PRO COVERT", date=datetime(2024, 7, 1, 9, 0, tzinfo=timezone.utc),
                        mime="image/jpeg", source_hash="aaa", image_hash="bbb", year=2026)


def test_the_xmp_tags_are_the_ones_wildintel_tools_wrote():
    tags = _tags()

    assert tags["XMP-dc:Creator"] == "CT (reconyx hf2 pro covert Doñana)"
    assert tags["XMP-dc:Date"] == "2024-07-01T09:00:00+00:00"
    assert tags["XMP-dc:Format"] == "image/jpeg"
    assert tags["XMP-dc:Identifier"] == "WildINTEL:bbb" and tags["XMP-dc:Source"] == "WildINTEL:aaa"
    assert tags["XMP-dc:Publisher"] == "WildINTEL"
    assert tags["XMP-dc:Rights"] == "© Universidad de Huelva, 2026. All rights reserved."
    assert tags["XMP-dc:Coverage"] == "This image was taken at Doñana National Park, as part of the WildINTEL project. https://wildintel.eu/"
    assert tags["XMP-xmpRights:Marked"] == "true" and tags["XMP-xmpRights:Owner"] == "Universidad de Huelva"
    assert tags["XMP-xmpRights:WebStatement"] == "https://creativecommons.org/licenses/by-nc/4.0/"


def test_blank_authorship_is_unknown_and_a_blank_coverage_is_the_deployments_location():
    tags = pre.xmp_tags(pre.PreprocessOptions(), DEPLOYMENT, camera=None, date=datetime(2024, 7, 1, tzinfo=timezone.utc), mime="image/jpeg", source_hash="a", image_hash="b", year=2026)

    assert tags["XMP-dc:Rights"] == "© Unknown, 2026. All rights reserved."
    assert tags["XMP-dc:Publisher"] == "Unknown" and tags["XMP-xmpRights:Owner"] == "Unknown"
    assert "Doñana site 1" in tags["XMP-dc:Coverage"]
    assert tags["XMP-dc:Creator"] == "CT ((unknown) (unknown) Unknown)"


def test_the_license_is_the_one_given():
    assert _tags(license_url="https://example.org/license")["XMP-xmpRights:WebStatement"] == "https://example.org/license"


# ── the whole import ─────────────────────────────────────────────────────────

def _source(tmp_path: Path, count=3) -> Path:
    source = tmp_path / "source"
    for i in range(1, count + 1):
        _jpeg(source / f"IMG_{i:04d}.JPG", taken=f"2024:07:0{i} 10:00:00")
    return source


def test_the_images_are_renamed_resized_and_kept_flat_in_the_deployments_folder(tmp_path: Path):
    source, collection = _source(tmp_path), tmp_path / "collections" / "DONA" / "R0003"

    events = _run(source, collection, name="R0003")

    dest = collection / "R0003-DONA_01"
    names = sorted(p.name for p in dest.glob("*.JPEG"))
    assert names == ["R0003-DONA_01__20240701_1.JPEG", "R0003-DONA_01__20240702_2.JPEG", "R0003-DONA_01__20240703_3.JPEG"]
    for image in dest.glob("*.JPEG"):
        with Image.open(image) as img:
            assert img.width == 2400
    assert [e["type"] for e in events] == ["copy", "copy", "copy", "sealing", "done"]
    assert {k: v for k, v in events[-1].items() if k != "report_id"} == {"type": "done", "dest_dir": str(dest), "processed": 3, "skipped": 0, "sealed": True}
    assert events[-1]["report_id"].endswith("_preprocessing_R0003-DONA_01")
    assert events[0]["name"] == "R0003-DONA_01__20240701_1.JPEG"
    assert json.loads((dest / "deployment.json").read_text())["deployment_id"] == "R0003-DONA_01"
    assert json.loads((collection / "collection.json").read_text())["name"] == "R0003"
    assert not (dest / "IMG_0001.JPG").exists()


def test_the_position_in_the_name_follows_natural_file_name_order_across_subfolders(tmp_path: Path):
    source = tmp_path / "source"
    _jpeg(source / "IMG_10.JPG", taken="2024:07:01 10:00:00")
    _jpeg(source / "IMG_2.JPG", taken="2024:07:01 10:00:00")
    _jpeg(source / "sub" / "IMG_1.JPG", taken="2024:07:01 10:00:00")

    _run(source, tmp_path / "out")
    log = json.loads((tmp_path / "out" / "R0003-DONA_01" / "preprocessing.json").read_text())

    assert [(i["original"], i["name"]) for i in log["images"]] == [
        ("IMG_2.JPG", "R0003-DONA_01__20240701_1.JPEG"), ("IMG_10.JPG", "R0003-DONA_01__20240701_2.JPEG"), ("sub/IMG_1.JPG", "R0003-DONA_01__20240701_3.JPEG"),
    ]


def test_the_date_in_the_name_is_the_utc_one(tmp_path: Path):
    source = tmp_path / "source"
    _jpeg(source / "a.JPG", taken="2024:07:02 00:30:00")  # 00:30 at +01:00 is 23:30 the day before, in UTC

    _run(source, tmp_path / "out")

    assert (tmp_path / "out" / "R0003-DONA_01" / "R0003-DONA_01__20240701_1.JPEG").is_file()


def test_without_renaming_the_names_and_subfolders_stay(tmp_path: Path):
    source = tmp_path / "source"
    _jpeg(source / "sub" / "IMG_0001.JPG")

    _run(source, tmp_path / "out", pre.PreprocessOptions(rename=False, metadata=False, timezone="Europe/Madrid"))

    assert (tmp_path / "out" / "R0003-DONA_01" / "sub" / "IMG_0001.JPG").is_file()


def test_without_resizing_the_images_keep_their_size(tmp_path: Path):
    source = _source(tmp_path, 1)

    _run(source, tmp_path / "out", pre.PreprocessOptions(resize=False, metadata=False, timezone="Europe/Madrid"))

    [image] = (tmp_path / "out" / "R0003-DONA_01").glob("*.JPEG")
    with Image.open(image) as img:
        assert img.size == (3000, 2000)
    assert image.read_bytes() == (source / "IMG_0001.JPG").read_bytes()


def test_with_everything_off_the_images_are_just_copied(tmp_path: Path):
    source = _source(tmp_path, 2)

    _run(source, tmp_path / "out", pre.PreprocessOptions(rename=False, resize=False, metadata=False, timezone="Europe/Madrid"))

    dest = tmp_path / "out" / "R0003-DONA_01"
    for original in source.glob("*.JPG"):
        assert (dest / original.name).read_bytes() == original.read_bytes()


def test_the_width_is_the_one_asked_for(tmp_path: Path):
    source = _source(tmp_path, 1)

    _run(source, tmp_path / "out", pre.PreprocessOptions(resize_width=1000, metadata=False, timezone="Europe/Madrid"))

    [image] = (tmp_path / "out" / "R0003-DONA_01").glob("*.JPEG")
    with Image.open(image) as img:
        assert img.size == (1000, 667)


def test_what_was_done_to_each_image_is_recorded_with_the_hash_of_the_original_and_of_the_result(tmp_path: Path):
    source = _source(tmp_path, 1)

    _run(source, tmp_path / "out")
    dest = tmp_path / "out" / "R0003-DONA_01"
    log = json.loads((dest / "preprocessing.json").read_text())
    [entry] = log["images"]

    assert log["options"]["resize_width"] == 2400 and log["options"]["timezone"] == "Europe/Madrid"
    assert (log["processed"], log["skipped"]) == (1, 0)
    assert entry["source_hash"] == hashlib.sha1((source / "IMG_0001.JPG").read_bytes()).hexdigest()
    assert entry["hash"] == hashlib.sha1((dest / entry["name"]).read_bytes()).hexdigest()
    assert entry["hash"] != entry["source_hash"]
    assert entry["final_hash"] == entry["hash"]  # no metadata written, so the file is as it was hashed
    assert entry["resized"] is True and entry["date"] == "2024-07-01T09:00:00+00:00" and entry["date_source"] == "exif"
    assert entry["camera"] == "RECONYX HF2 PRO COVERT"


def test_an_image_that_cannot_be_processed_is_skipped_and_the_rest_go_on(tmp_path: Path):
    source = _source(tmp_path, 2)
    (source / "IMG_0003.JPG").write_bytes(b"not an image at all")

    events = _run(source, tmp_path / "out")

    skipped = [e for e in events if e["type"] == "skipped"]
    assert [e["name"] for e in skipped] == ["IMG_0003.JPG"] and skipped[0]["detail"]
    assert events[-1]["processed"] == 2 and events[-1]["skipped"] == 1
    assert len(list((tmp_path / "out" / "R0003-DONA_01").glob("*.JPEG"))) == 2


def test_files_that_are_not_images_go_across_as_they_are(tmp_path: Path):
    source = _source(tmp_path, 1)
    (source / "notes.txt").write_text("field notes", encoding="utf-8")

    events = _run(source, tmp_path / "out")

    assert (tmp_path / "out" / "R0003-DONA_01" / "notes.txt").read_text(encoding="utf-8") == "field notes"
    assert [e["type"] for e in events].count("copy") == 2


def test_an_import_needs_a_source_outside_the_destination_and_a_known_timezone(tmp_path: Path):
    source = _source(tmp_path, 1)

    with pytest.raises(pre.DeploymentImportError, match="Unknown timezone"):
        _run(source, tmp_path / "out", pre.PreprocessOptions(metadata=False, timezone="Mars/Olympus"))
    with pytest.raises(pre.DeploymentImportError, match="cannot be"):
        _run(source, source)  # into itself


def test_a_deployments_folder_that_already_has_images_is_never_mixed_into(tmp_path: Path):
    source = _source(tmp_path, 1)
    _run(source, tmp_path / "out")

    with pytest.raises(pre.DeploymentImportError, match="already exists"):
        _run(source, tmp_path / "out")


def test_adding_metadata_without_exiftool_is_refused_up_front_and_nothing_is_written(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(camera_info, "exiftool_path", lambda: None)
    source = _source(tmp_path, 1)

    with pytest.raises(pre.DeploymentImportError, match="needs ExifTool"):
        _run(source, tmp_path / "out", pre.PreprocessOptions(metadata=True, timezone="Europe/Madrid"))
    assert not (tmp_path / "out").exists()


def test_the_files_exiftool_leaves_when_it_is_interrupted_are_removed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    image = tmp_path / "R0001-WICP_0001__20250612_1.JPEG"
    image.write_bytes(b"x")

    def interrupted(*args, **kwargs):  # ExifTool dies with a file half written
        (tmp_path / "R0001-WICP_0001__20250612_1.JPEG_exiftool_tmp").write_bytes(b"half")
        return subprocess.CompletedProcess(args, 1, stdout="", stderr="Error: killed")

    monkeypatch.setattr(pre.subprocess, "run", interrupted)

    with pytest.raises(pre.DeploymentImportError, match="could not write"):
        pre.write_xmp("exiftool", [(image, {"XMP-dc:Creator": "x"})])

    assert sorted(p.name for p in tmp_path.iterdir()) == [image.name]


def test_the_import_leaves_a_report_of_what_was_done_to_each_image(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from wildintel_uploader.core import config
    from wildintel_uploader.core.services import report_service

    reports = tmp_path / "reports"
    monkeypatch.setattr(config, "reports_dir", lambda settings=None: reports)
    (tmp_path / "source").mkdir()
    source = _source(tmp_path)
    (source / "IMG_0004.JPG").write_bytes(b"not an image")  # it can't be processed: skipped

    events = _run(source, tmp_path / "out" / "R0003", name="R0003")

    done = events[-1]
    assert done["type"] == "done" and done["skipped"] == 1
    report = report_service.read(done["report_id"])
    assert report["kind"] == "preprocessing" and report["deployment_id"] == "R0003-DONA_01"
    by_image = {e["identifier"]: e for e in report["entries"]}
    assert by_image["IMG_0001.JPG"]["status"] == "ok" and "→ R0003-DONA_01__" in by_image["IMG_0001.JPG"]["message"]
    assert by_image["IMG_0004.JPG"]["status"] == "failed"
    assert report["totals"] == {"entries": 4, "ok": 3, "failed": 1, "images_with_issues": 1}


def test_without_metadata_exiftool_is_not_needed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(camera_info, "exiftool_path", lambda: None)

    events = _run(_source(tmp_path, 1), tmp_path / "out")

    assert events[-1]["type"] == "done"


@needs_exiftool
def test_the_xmp_metadata_is_written_into_each_image(tmp_path: Path):
    source = _source(tmp_path, 2)
    options = pre.PreprocessOptions(
        owner="Universidad de Huelva", publisher="WildINTEL", coverage="Doñana National Park", research_project="Doñana", timezone="Europe/Madrid",
    )

    events = _run(source, tmp_path / "out", options)

    assert "metadata" in [e["type"] for e in events]
    dest = tmp_path / "out" / "R0003-DONA_01"
    log = json.loads((dest / "preprocessing.json").read_text())
    first = log["images"][0]
    tags = json.loads(subprocess.run(
        ["exiftool", "-json", "-charset", "utf8", "-XMP-dc:all", "-XMP-xmpRights:all", str(dest / first["name"])], capture_output=True, text=True, encoding="utf-8",
    ).stdout)[0]
    assert tags["Creator"] == "CT (reconyx hf2 pro covert Doñana)"
    assert tags["Rights"].startswith("© Universidad de Huelva, ") and tags["Rights"].endswith(". All rights reserved.")
    assert tags["Publisher"] == "WildINTEL" and tags["Owner"] == "Universidad de Huelva"
    assert tags["Source"] == f"WildINTEL:{first['source_hash']}" and tags["Identifier"] == f"WildINTEL:{first['hash']}"
    assert tags["WebStatement"] == "https://creativecommons.org/licenses/by-nc/4.0/"
    assert tags["Coverage"] == "This image was taken at Doñana National Park, as part of the WildINTEL project. https://wildintel.eu/"
    assert not list(dest.glob("*_original"))  # no backups left beside the images


@needs_exiftool
def test_the_metadata_survives_awkward_file_names_and_the_exif_survives_the_metadata(tmp_path: Path):
    source = tmp_path / "source"
    _jpeg(source / "ñu (1) cámara.JPG", taken="2024:07:01 10:00:00")

    _run(source, tmp_path / "out", pre.PreprocessOptions(rename=False, owner="Doñana", timezone="Europe/Madrid"))

    image = tmp_path / "out" / "R0003-DONA_01" / "ñu (1) cámara.JPG"
    tags = json.loads(subprocess.run(["exiftool", "-json", "-charset", "utf8", "-Owner", "-Make", "-DateTimeOriginal", str(image)], capture_output=True, text=True, encoding="utf-8").stdout)[0]
    assert tags["Owner"] == "Doñana" and tags["Make"] == "RECONYX" and tags["DateTimeOriginal"] == "2024:07:01 10:00:00"


@needs_exiftool
def test_the_final_hash_is_the_one_of_the_file_with_its_metadata_and_the_identifier_is_left_as_it_was(tmp_path: Path):
    source = _source(tmp_path, 1)
    options = pre.PreprocessOptions(owner="Universidad de Huelva", research_project="Doñana", timezone="Europe/Madrid")

    _run(source, tmp_path / "out", options)
    dest = tmp_path / "out" / "R0003-DONA_01"
    [entry] = json.loads((dest / "preprocessing.json").read_text())["images"]

    assert entry["final_hash"] == hashlib.sha1((dest / entry["name"]).read_bytes()).hexdigest()  # what sha1sum gives
    assert entry["final_hash"] != entry["hash"]  # the XMP changed the file after the identifier was taken


def test_a_deployment_synced_from_trapper_is_never_imported_into(tmp_path: Path):
    source = _source(tmp_path, 1)
    synced = tmp_path / "out" / DEPLOYMENT.deployment_id
    synced.mkdir(parents=True)
    (synced / "images.json").write_text('{"source": "trapper"}', encoding="utf-8")

    with pytest.raises(pre.DeploymentImportError, match="synced from Trapper"):
        _run(source, tmp_path / "out")
    assert not (synced / "preprocessing.json").exists()


# ── preprocess now, consolidate later ────────────────────────────────────────

def _two_images(tmp_path: Path) -> Path:
    source = tmp_path / "card"
    _jpeg(source / "a.jpg", taken="2024:07:01 10:00:00")
    _jpeg(source / "b.jpg", taken="2024:07:01 11:00:00", color="blue")
    return source


def test_without_consolidating_the_deployment_is_left_pending_and_unsealed(tmp_path: Path):
    source, collection = _two_images(tmp_path), tmp_path / "collections" / "R0003"

    events = list(pre.preprocess_stream(str(source), str(collection), None, DEPLOYMENT, NO_XMP, consolidate=False))

    dest = collection / "R0003-DONA_01"
    assert [e["type"] for e in events][-1] == "done" and "sealing" not in [e["type"] for e in events]
    assert events[-1]["sealed"] is None and events[-1]["processed"] == 2
    assert (dest / "preprocessing.json").is_file() and (dest / "images.json").is_file()
    assert not (dest / "seal.json").exists() and not (dest / "deployment.json").exists()


def test_a_pending_deployment_is_preprocessed_again_instead_of_refused(tmp_path: Path):
    source, collection = _two_images(tmp_path), tmp_path / "collections" / "R0003"
    list(pre.preprocess_stream(str(source), str(collection), None, DEPLOYMENT, NO_XMP, consolidate=False))
    _jpeg(source / "c.jpg", taken="2024:07:01 12:00:00", color="green")

    events = list(pre.preprocess_stream(str(source), str(collection), None, DEPLOYMENT, NO_XMP, consolidate=False))

    assert events[-1]["processed"] == 3
    assert len(list((collection / "R0003-DONA_01").glob("*.JPEG"))) == 3


def test_consolidating_writes_the_deployment_and_seals_it_and_then_nothing_can_be_redone(tmp_path: Path):
    source, collection = _two_images(tmp_path), tmp_path / "collections" / "R0003"
    list(pre.preprocess_stream(str(source), str(collection), None, DEPLOYMENT, NO_XMP, consolidate=False))

    events = list(pre.consolidate_stream(str(source), str(collection), DEPLOYMENT))

    dest = collection / "R0003-DONA_01"
    assert [e["type"] for e in events] == ["sealing", "done"] and events[-1]["sealed"] is True and events[-1]["processed"] == 2
    assert (dest / "deployment.json").is_file() and (dest / "seal.json").is_file()
    with pytest.raises(pre.DeploymentImportError, match="already consolidated"):
        pre.consolidate_stream(str(source), str(collection), DEPLOYMENT)
    with pytest.raises(pre.DeploymentImportError, match="already exists"):
        list(pre.preprocess_stream(str(source), str(collection), None, DEPLOYMENT, NO_XMP, consolidate=False))


def test_a_deployment_that_was_not_preprocessed_cannot_be_consolidated(tmp_path: Path):
    source = _two_images(tmp_path)
    with pytest.raises(pre.DeploymentImportError, match="has not been preprocessed"):
        pre.consolidate_stream(str(source), str(tmp_path / "collections" / "R0003"), DEPLOYMENT)
