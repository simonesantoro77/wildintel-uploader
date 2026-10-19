"""services.deployment_import_service — folder scanning (EXIF dates, camera
model), path validation, and organizing a copy."""
import json
import shutil
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image

from wildintel_uploader.core.services import camera_info
from wildintel_uploader.core.services import deployment_import_service as svc

needs_exiftool = pytest.mark.skipif(shutil.which("exiftool") is None, reason="ExifTool isn't installed")


def _make_jpeg(
    path: Path, *, taken: str | None = None, make: str | None = None, model: str | None = None, serial: str | None = None,
) -> None:
    img = Image.new("RGB", (4, 4), color="red")
    exif = img.getexif()
    if taken:
        exif[306] = taken  # DateTime (IFD0) — _image_datetime's fallback tag
    if make:
        exif[271] = make  # Make
    if model:
        exif[272] = model  # Model
    if serial:
        exif.get_ifd(0x8769)[42033] = serial  # BodySerialNumber — what ExifTool reports as SerialNumber
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, exif=exif)


# ── check_paths ──────────────────────────────────────────────────────────────

def test_check_paths_rejects_missing_source(tmp_path: Path):
    with pytest.raises(svc.DeploymentImportError, match="Not a folder"):
        svc.check_paths(tmp_path / "nope", tmp_path / "dest")


def test_check_paths_rejects_dest_equal_to_source(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    with pytest.raises(svc.DeploymentImportError, match="cannot be"):
        svc.check_paths(source, source)


def test_check_paths_rejects_dest_nested_in_source(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    with pytest.raises(svc.DeploymentImportError, match="cannot be"):
        svc.check_paths(source, source / "R0001" / "R0001-LOC")


def test_check_paths_accepts_a_sibling_destination(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    svc.check_paths(source, tmp_path / "dest")  # doesn't raise


# ── scan_folder ──────────────────────────────────────────────────────────────

def test_scan_folder_only_counts_the_files_and_the_images(tmp_path: Path):
    _make_jpeg(tmp_path / "a.jpg", taken="2024:09:04 13:10:00", make="Reconyx", model="HC600")
    _make_jpeg(tmp_path / "sub" / "b.jpg", taken="2024:09:05 08:00:00", make="Reconyx", model="HC600")
    (tmp_path / "notes.txt").write_text("x")

    result = svc.scan_folder(tmp_path)

    # Reading the images is for the steps that follow: the scan doesn't open them.
    assert result == {"file_count": 3, "image_count": 2, "warnings": []}


def test_scan_folder_does_not_open_the_images(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _make_jpeg(tmp_path / "a.jpg", taken="2024:09:04 13:10:00")
    monkeypatch.setattr(svc.Image, "open", lambda *a, **k: (_ for _ in ()).throw(AssertionError("opened an image")))
    monkeypatch.setattr(svc.camera_info, "read_cameras", lambda *a, **k: (_ for _ in ()).throw(AssertionError("read the cameras")))

    assert svc.scan_folder(tmp_path)["image_count"] == 1


def test_guess_details_reads_the_date_range_and_the_camera_model(tmp_path: Path):
    _make_jpeg(tmp_path / "a.jpg", taken="2024:09:04 13:10:00", make="Reconyx", model="HC600")
    _make_jpeg(tmp_path / "sub" / "b.jpg", taken="2024:09:05 08:00:00", make="Reconyx", model="HC600")

    result = svc.guess_details(tmp_path)

    assert result["start_date"] == "2024-09-04T13:10:00"
    assert result["end_date"] == "2024-09-05T08:00:00"
    assert result["camera_model"] == "Reconyx HC600"
    assert not [w for w in result["warnings"] if "ExifTool" not in w]


def test_scan_session_scans_each_subfolder_in_name_order(tmp_path: Path):
    _make_jpeg(tmp_path / "SITE_02" / "a.jpg", taken="2024:09:04 13:10:00")
    _make_jpeg(tmp_path / "SITE_01" / "a.jpg", taken="2024:09:01 08:00:00")
    _make_jpeg(tmp_path / "SITE_01" / "b.jpg", taken="2024:09:02 08:00:00")
    (tmp_path / "SITE_03").mkdir()
    (tmp_path / ".hidden").mkdir()
    (tmp_path / "notes.txt").write_text("x")

    result = svc.scan_session(tmp_path)

    assert [d["name"] for d in result["deployments"]] == ["SITE_01", "SITE_02", "SITE_03"]
    first = result["deployments"][0]
    assert first["path"] == str(tmp_path / "SITE_01") and first["image_count"] == 2
    assert (first["start_date"], first["end_date"]) == (None, None)  # read from the images when the details are asked for
    assert result["deployments"][2]["image_count"] == 0
    assert result["loose_files"] == 1 and "1 loose file(s)" in result["warnings"][0]


def _log(path: Path, *rows: str) -> None:
    path.write_text("Deployment,StartDate,StartTime,EndDate,EndTime\n" + "".join(r + "\n" for r in rows), encoding="utf-8")


def test_scan_session_takes_the_dates_from_the_timestamp_log(tmp_path: Path):
    session = tmp_path / "R0033"
    _make_jpeg(session / "DONA_01" / "a.jpg", taken="2024:09:04 13:10:00")
    _make_jpeg(session / "DONA_02" / "a.jpg", taken="2024:09:05 09:00:00")
    _make_jpeg(session / "DONA_03" / "a.jpg", taken="2024:09:06 09:00:00")
    # one row by the full deployment id, one by the subfolder's name, one that matches nothing
    _log(session / "R0033_FileTimestampLog.csv",
         "R0033-DONA_01,2024:09:01,08:00:00,2024:11:01,09:30:00",
         "dona_02,2024:09:02,10:00:00,2024:11:02,11:00:00",
         "R0033-OTHER,2024:09:02,10:00:00,2024:11:02,11:00:00")

    result = svc.scan_session(session)

    first, second, third = result["deployments"]
    assert (first["start_date"], first["end_date"], first["from_timestamp_log"]) == ("2024-09-01T08:00:00", "2024-11-01T09:30:00", True)
    assert (second["start_date"], second["end_date"], second["from_timestamp_log"]) == ("2024-09-02T10:00:00", "2024-11-02T11:00:00", True)
    assert (third["start_date"], third["from_timestamp_log"]) == (None, False)  # no row: no dates here — they are read from its images later
    assert result["timestamp_log"] == {"name": "R0033_FileTimestampLog.csv", "path": str(session / "R0033_FileTimestampLog.csv"), "rows": 3, "matched": 2, "revision": 33}
    assert (first["log_deployment_id"], second["log_deployment_id"], third["log_deployment_id"]) == ("R0033-DONA_01", "dona_02", None)
    assert any("1 row(s)" in w and "match no subfolder: R0033-OTHER" in w for w in result["warnings"])  # the log's row with no folder, by name
    assert any("1 subfolder(s) have no row" in w and "DONA_03" in w for w in result["warnings"])  # and the folder with no row
    assert not any("loose" in w for w in result["warnings"])  # the log itself is not a stray file


def test_scan_session_gives_no_revision_when_the_ids_disagree_or_have_none(tmp_path: Path):
    _make_jpeg(tmp_path / "A" / "a.jpg", taken="2024:09:04 13:10:00")
    _make_jpeg(tmp_path / "B" / "a.jpg", taken="2024:09:04 13:10:00")
    row = ",2024:09:01,08:00:00,2024:11:01,09:30:00"
    _log(tmp_path / "L_FileTimestampLog.csv", "R0001-A" + row, "R0002-B" + row)
    assert svc.scan_session(tmp_path)["timestamp_log"]["revision"] is None
    _log(tmp_path / "L_FileTimestampLog.csv", "A" + row, "B" + row)
    assert svc.scan_session(tmp_path)["timestamp_log"]["revision"] is None


def test_scan_session_without_a_timestamp_log_gives_no_dates(tmp_path: Path):
    _make_jpeg(tmp_path / "SITE_01" / "a.jpg", taken="2024:09:04 13:10:00")

    result = svc.scan_session(tmp_path)

    assert result["timestamp_log"] is None
    assert result["deployments"][0]["from_timestamp_log"] is False
    assert result["deployments"][0]["start_date"] is None


def test_scan_session_uses_the_only_timestamp_log_whatever_it_is_called(tmp_path: Path):
    _make_jpeg(tmp_path / "SITE_01" / "a.jpg", taken="2024:09:04 13:10:00")
    _log(tmp_path / "R0001_FileTimestampLog.csv", "SITE_01,2024:09:01,08:00:00,2024:11:01,09:30:00")

    result = svc.scan_session(tmp_path)

    assert result["deployments"][0]["start_date"] == "2024-09-01T08:00:00"


def test_scan_session_ignores_ambiguous_or_unreadable_timestamp_logs(tmp_path: Path):
    _make_jpeg(tmp_path / "SITE_01" / "a.jpg", taken="2024:09:04 13:10:00")
    _log(tmp_path / "R0001_FileTimestampLog.csv", "SITE_01,2024:09:01,08:00:00,2024:11:01,09:30:00")
    _log(tmp_path / "R0002_FileTimestampLog.csv", "SITE_01,2024:09:01,08:00:00,2024:11:01,09:30:00")
    ambiguous = svc.scan_session(tmp_path)
    assert ambiguous["timestamp_log"] is None and any("none is named after the folder" in w for w in ambiguous["warnings"])

    (tmp_path / "R0002_FileTimestampLog.csv").unlink()
    (tmp_path / "R0001_FileTimestampLog.csv").write_text("Deployment,StartDate\nSITE_01,2024:09:01\n", encoding="utf-8")
    unreadable = svc.scan_session(tmp_path)
    assert unreadable["deployments"][0]["from_timestamp_log"] is False
    assert any("missing the columns" in w for w in unreadable["warnings"])


def test_scan_session_skips_timestamp_log_rows_with_bad_dates(tmp_path: Path):
    _make_jpeg(tmp_path / "SITE_01" / "a.jpg", taken="2024:09:04 13:10:00")
    _make_jpeg(tmp_path / "SITE_02" / "a.jpg", taken="2024:09:04 13:10:00")
    _log(tmp_path / "R0001_FileTimestampLog.csv",
         "SITE_01,2024-09-01,08:00:00,2024:11:01,09:30:00",
         "SITE_02,2024:11:01,09:30:00,2024:09:01,08:00:00")

    result = svc.scan_session(tmp_path)

    assert [d["from_timestamp_log"] for d in result["deployments"]] == [False, False]
    assert len(result["warnings"]) >= 2


def test_scan_session_needs_subfolders(tmp_path: Path):
    (tmp_path / "a.jpg").write_bytes(b"x")
    with pytest.raises(svc.DeploymentImportError, match="no subfolders"):
        svc.scan_session(tmp_path)
    with pytest.raises(svc.DeploymentImportError, match="Not a folder"):
        svc.scan_session(tmp_path / "missing")


def test_guess_details_warns_about_images_with_no_exif_date(tmp_path: Path):
    _make_jpeg(tmp_path / "a.jpg", taken="2024:09:04 13:10:00")
    _make_jpeg(tmp_path / "b.jpg")  # no DateTime tag

    result = svc.guess_details(tmp_path)

    assert any("1 of 2 image(s) have no readable EXIF date" in w for w in result["warnings"])


def test_scan_folder_warns_when_empty(tmp_path: Path):
    result = svc.scan_folder(tmp_path)
    assert result["file_count"] == 0
    assert "empty" in result["warnings"][0]
    assert svc.guess_details(tmp_path)["start_date"] is None


def test_scan_folder_warns_when_nothing_looks_like_an_image(tmp_path: Path):
    (tmp_path / "notes.txt").write_text("x")
    assert "None of the 1 file(s) look like images" in svc.scan_folder(tmp_path)["warnings"][0]


def test_scan_folder_rejects_missing_folder(tmp_path: Path):
    with pytest.raises(svc.DeploymentImportError):
        svc.scan_folder(tmp_path / "nope")


# ── validate_images ──────────────────────────────────────────────────────────

def test_validate_images_reports_no_issues_for_a_clean_flat_folder(tmp_path: Path):
    _make_jpeg(tmp_path / "IMG_0001.jpg", taken="2024:09:04 13:10:00")
    _make_jpeg(tmp_path / "IMG_0002.jpg", taken="2024:09:04 13:10:05")

    result = svc.validate_images(tmp_path)

    assert result["checked_count"] == 2
    assert result["corrupted"] == []
    assert result["sequence_issues"] == []
    assert result["subdirectories"] == []


def test_validate_images_flags_a_corrupted_file(tmp_path: Path):
    _make_jpeg(tmp_path / "IMG_0001.jpg", taken="2024:09:04 13:10:00")
    (tmp_path / "IMG_0002.jpg").write_bytes(b"not actually a jpeg")

    result = svc.validate_images(tmp_path)

    assert result["checked_count"] == 2
    assert [c["path"] for c in result["corrupted"]] == ["IMG_0002.jpg"]


def test_validate_images_flags_an_out_of_order_sequence(tmp_path: Path):
    _make_jpeg(tmp_path / "IMG_0001.jpg", taken="2024:06:02 10:00:00")
    _make_jpeg(tmp_path / "IMG_0002.jpg", taken="2024:05:01 10:00:00")  # earlier than 0001, despite a higher number

    result = svc.validate_images(tmp_path)

    assert len(result["sequence_issues"]) == 1
    issue = result["sequence_issues"][0]
    assert issue["path_a"] == "IMG_0001.jpg" and issue["path_b"] == "IMG_0002.jpg"


def test_validate_images_ignores_undated_or_unnumbered_images_for_the_sequence_check(tmp_path: Path):
    _make_jpeg(tmp_path / "IMG_0001.jpg", taken="2024:06:02 10:00:00")
    _make_jpeg(tmp_path / "IMG_0002.jpg")  # no date — skipped
    _make_jpeg(tmp_path / "cover.jpg", taken="2024:01:01 00:00:00")  # no number — skipped

    result = svc.validate_images(tmp_path)

    assert result["sequence_issues"] == []


def test_validate_images_checks_each_subfolder_s_sequence_on_its_own(tmp_path: Path):
    # Two cards' worth of images, each restarting its own numbering.
    _make_jpeg(tmp_path / "100RECNX" / "IMG_0001.jpg", taken="2024:06:02 10:00:00")
    _make_jpeg(tmp_path / "100RECNX" / "IMG_0002.jpg", taken="2024:06:02 10:00:05")
    _make_jpeg(tmp_path / "101RECNX" / "IMG_0001.jpg", taken="2024:01:01 09:00:00")
    _make_jpeg(tmp_path / "101RECNX" / "IMG_0002.jpg", taken="2024:01:01 09:00:05")

    result = svc.validate_images(tmp_path)

    assert result["sequence_issues"] == []
    assert result["subdirectories"] == ["100RECNX", "101RECNX"]


def test_validate_images_rejects_missing_folder(tmp_path: Path):
    with pytest.raises(svc.DeploymentImportError):
        svc.validate_images(tmp_path / "nope")


def test_validate_images_only_runs_the_requested_checks(tmp_path: Path):
    _make_jpeg(tmp_path / "IMG_0001.jpg", taken="2024:06:02 10:00:00")
    (tmp_path / "IMG_0002.jpg").write_bytes(b"not actually a jpeg")

    result = svc.validate_images(tmp_path, frozenset({"structure"}))

    assert result == {"checked_count": 2, "subdirectories": []}


def test_validate_images_sequence_check_alone_still_finds_corrupted_files_but_does_not_report_them(tmp_path: Path):
    _make_jpeg(tmp_path / "IMG_0001.jpg", taken="2024:06:02 10:00:00")
    (tmp_path / "IMG_0002.jpg").write_bytes(b"not actually a jpeg")

    result = svc.validate_images(tmp_path, frozenset({"sequence"}))

    assert "corrupted" not in result
    assert "subdirectories" not in result
    assert result["sequence_issues"] == []  # the corrupted file is silently skipped, not compared


# ── validate_deployment_consistency ─────────────────────────────────────────

def _deployment(**overrides):
    from wildintel_uploader.core.schemas.requests import DeploymentFields
    base = dict(
        deployment_id="R0001-DONA_01", location_id="DONA_01", latitude=37.0, longitude=-6.5,
        start_date="2024-09-04T00:00:00+02:00", end_date="2024-12-31T00:00:00+01:00",
    )
    return DeploymentFields.model_validate({**base, **overrides})


def _shots(tmp_path: Path, *taken: str) -> Path:
    """One image per date, named IMG_0001… so their natural order is the order given."""
    for i, when in enumerate(taken, start=1):
        _make_jpeg(tmp_path / f"IMG_{i:04d}.jpg", taken=when)
    return tmp_path


RANGE = dict(start_date="2024-09-04T10:00:00+02:00", end_date="2024-09-10T10:00:00+02:00")


def _out_of_range(folder: Path, **kwargs) -> list[dict]:
    return svc.validate_deployment_consistency(folder, _deployment(**RANGE), frozenset({"time_range"}), **kwargs)["out_of_range"]


def test_time_range_passes_when_the_first_last_and_middle_images_are_where_they_should_be(tmp_path: Path):
    folder = _shots(tmp_path, "2024:09:04 10:00:00", "2024:09:07 12:00:00", "2024:09:10 10:00:00")

    assert _out_of_range(folder) == []


def test_time_range_the_first_image_must_be_within_the_tolerance_of_the_start(tmp_path: Path):
    # 2 hours after the start: inside the range, but the first image has to be at the start ± 1h.
    folder = _shots(tmp_path, "2024:09:04 12:00:00", "2024:09:07 12:00:00", "2024:09:10 10:00:00")

    [issue] = _out_of_range(folder)

    assert (issue["path"], issue["rule"], issue["date"]) == ("IMG_0001.jpg", "first", "2024-09-04T12:00:00")
    assert issue["expected"] == "2024-09-04T10:00:00 ± 1h"


def test_time_range_the_last_image_must_be_within_the_tolerance_of_the_end(tmp_path: Path):
    folder = _shots(tmp_path, "2024:09:04 10:00:00", "2024:09:07 12:00:00", "2024:09:09 10:00:00")  # a day before the end

    [issue] = _out_of_range(folder)

    assert (issue["path"], issue["rule"]) == ("IMG_0003.jpg", "last")
    assert issue["expected"] == "2024-09-10T10:00:00 ± 1h"


def test_time_range_the_images_in_between_only_have_to_be_inside_the_range_widened_by_the_tolerance(tmp_path: Path):
    folder = _shots(
        tmp_path, "2024:09:04 10:00:00", "2024:09:04 09:30:00",  # 30 min before the start: within the tolerance
        "2024:09:04 08:00:00",                                   # 2 hours before: out
        "2024:09:10 10:59:00",                                   # 59 min after the end: within the tolerance
        "2024:09:10 12:00:00",                                   # 2 hours after: out
        "2024:09:10 10:00:00",
    )

    issues = _out_of_range(folder)

    assert [(i["path"], i["rule"]) for i in issues] == [("IMG_0003.jpg", "between"), ("IMG_0005.jpg", "between")]
    assert issues[0]["expected"] == "2024-09-04T10:00:00 – 2024-09-10T10:00:00 ± 1h"


def test_time_range_the_tolerance_can_be_changed(tmp_path: Path):
    folder = _shots(tmp_path, "2024:09:04 12:00:00", "2024:09:10 10:00:00")  # the first is 2 hours after the start

    assert [i["path"] for i in _out_of_range(folder)] == ["IMG_0001.jpg"]  # 1 hour, the default
    assert _out_of_range(folder, tolerance_hours=3) == []
    assert [i["path"] for i in _out_of_range(folder, tolerance_hours=0)] == ["IMG_0001.jpg"]  # none at all
    assert svc.validate_deployment_consistency(folder, _deployment(**RANGE), frozenset({"time_range"}), tolerance_hours=1.5)["tolerance_hours"] == 1.5


def test_time_range_the_edge_of_the_tolerance_is_still_inside(tmp_path: Path):
    folder = _shots(tmp_path, "2024:09:04 11:00:00", "2024:09:10 09:00:00")  # exactly start + 1h, end - 1h

    assert _out_of_range(folder) == []


def test_time_range_a_negative_tolerance_is_refused(tmp_path: Path):
    with pytest.raises(svc.DeploymentImportError, match="negative"):
        _out_of_range(_shots(tmp_path, "2024:09:04 10:00:00"), tolerance_hours=-1)


def test_time_range_walks_the_images_in_natural_file_name_order_across_subfolders(tmp_path: Path):
    # By plain text order IMG_10 would come before IMG_2; naturally IMG_2 is the first image (at the start) and IMG_10 the last.
    _make_jpeg(tmp_path / "IMG_2.jpg", taken="2024:09:04 10:00:00")
    _make_jpeg(tmp_path / "IMG_10.jpg", taken="2024:09:10 10:00:00")
    _make_jpeg(tmp_path / "IMG_5.jpg", taken="2024:09:07 10:00:00")

    assert _out_of_range(tmp_path) == []


def test_time_range_skips_an_image_with_no_date_but_it_still_takes_its_place_in_the_order(tmp_path: Path):
    _make_jpeg(tmp_path / "IMG_0001.jpg")  # the first image: no date, so nothing to check
    _make_jpeg(tmp_path / "IMG_0002.jpg", taken="2024:09:05 10:00:00")
    _make_jpeg(tmp_path / "IMG_0003.jpg", taken="2024:09:10 10:00:00")

    assert _out_of_range(tmp_path) == []


def test_time_range_a_single_image_is_the_first_one(tmp_path: Path):
    assert [i["rule"] for i in _out_of_range(_shots(tmp_path, "2024:09:07 10:00:00"))] == ["first"]


def test_validate_deployment_consistency_compares_wall_clock_time_ignoring_the_designator(tmp_path: Path):
    _make_jpeg(tmp_path / "a.jpg", taken="2024:09:04 00:30:00")  # 00:30 local, right after start
    _make_jpeg(tmp_path / "b.jpg", taken="2025:01:01 10:00:00")  # long after end_date

    result = svc.validate_deployment_consistency(tmp_path, _deployment(), frozenset({"time_range"}))

    assert [o["path"] for o in result["out_of_range"]] == ["b.jpg"]


def test_with_timezone_stamps_the_offset_in_force_at_that_moment():
    assert svc.with_timezone("2024-07-01T12:00:00", "Europe/Madrid") == "2024-07-01T12:00:00+02:00"  # summer
    assert svc.with_timezone("2024-12-01T12:00:00", "Europe/Madrid") == "2024-12-01T12:00:00+01:00"  # winter
    assert svc.with_timezone("2024-07-01T12:00:00Z", "Europe/Madrid") == "2024-07-01T12:00:00Z"  # already stamped
    assert svc.with_timezone(None, "Europe/Madrid") is None


def test_with_timezone_rejects_an_unknown_timezone():
    with pytest.raises(svc.DeploymentImportError):
        svc.with_timezone("2024-07-01T12:00:00", "Mars/Olympus")


def test_validate_deployment_consistency_flags_camera_mismatches_and_lists_models_found(tmp_path: Path):
    _make_jpeg(tmp_path / "a.jpg", taken="2024:09:04 10:00:00", make="Reconyx", model="HC600")
    _make_jpeg(tmp_path / "b.jpg", taken="2024:09:04 10:00:05", make="Bushnell", model="Trophy Cam")

    result = svc.validate_deployment_consistency(tmp_path, _deployment(camera_model="Reconyx HC600"))

    assert [m["path"] for m in result["camera_mismatches"]] == ["b.jpg"]
    assert result["camera_models_found"] == ["Bushnell Trophy Cam", "Reconyx HC600"]


def test_validate_deployment_consistency_skips_camera_mismatch_when_undeclared(tmp_path: Path):
    _make_jpeg(tmp_path / "a.jpg", taken="2024:09:04 10:00:00", make="Reconyx", model="HC600")

    result = svc.validate_deployment_consistency(tmp_path, _deployment())  # no camera_model declared

    assert result["camera_mismatches"] == []
    assert result["camera_models_found"] == ["Reconyx HC600"]


def test_validate_deployment_consistency_only_runs_the_requested_checks(tmp_path: Path):
    _make_jpeg(tmp_path / "a.jpg", taken="2024:09:04 10:00:00")

    result = svc.validate_deployment_consistency(tmp_path, _deployment(), frozenset({"time_range"}))

    assert "out_of_range" in result and "camera_mismatches" not in result and "deployment_id" not in result


def test_validate_deployment_consistency_rejects_missing_folder(tmp_path: Path):
    with pytest.raises(svc.DeploymentImportError):
        svc.validate_deployment_consistency(tmp_path / "nope", _deployment())


# ── import_stream ────────────────────────────────────────────────────────────

def test_import_stream_requires_a_timezone_to_register(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    with pytest.raises(svc.DeploymentImportError, match="timezone"):
        svc.import_stream(
            "https://trapper.example.org", "alice", "s3cret", 2, None,
            str(source), _deployment(), None, research_project_id="DONA", register=True,
        )


# ── import_local_stream ──────────────────────────────────────────────────────

def test_import_local_stream_organizes_files_and_writes_metadata(tmp_path: Path):
    source = tmp_path / "source"
    _make_jpeg(source / "a.jpg", taken="2024:09:04 13:10:00")
    collection = tmp_path / "collection"

    events = list(svc.import_local_stream(str(source), str(collection), "Doñana 2024", _deployment()))

    assert events[0] == {"type": "copy", "index": 1, "total": 1, "name": "a.jpg"}
    assert [e["type"] for e in events] == ["copy", "sealing", "done"]
    dest = collection / "R0001-DONA_01"
    assert (dest / "a.jpg").is_file()
    assert (collection / "collection.json").is_file()
    assert (dest / "deployment.json").is_file()


def test_import_local_stream_rejects_bad_paths(tmp_path: Path):
    with pytest.raises(svc.DeploymentImportError):
        svc.import_local_stream(str(tmp_path / "nope"), str(tmp_path / "collection"), None, _deployment())


# ── copy_folder ──────────────────────────────────────────────────────────────

def test_copy_folder_preserves_structure_without_touching_the_source(tmp_path: Path):
    source = tmp_path / "source"
    dest = tmp_path / "dest"
    _make_jpeg(source / "a.jpg", taken="2024:09:04 13:10:00")
    _make_jpeg(source / "sub" / "b.jpg", taken="2024:09:05 08:00:00")

    events = list(svc.copy_folder(source, dest))

    assert [e["index"] for e in events] == [1, 2]
    assert (dest / "a.jpg").is_file()
    assert (dest / "sub" / "b.jpg").is_file()
    assert (source / "a.jpg").is_file()  # untouched
    assert (source / "sub" / "b.jpg").is_file()


# ── collection layout ────────────────────────────────────────────────────────

def test_default_collection_dir_is_research_project_then_collection(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(svc.config, "collections_dir", lambda: tmp_path)
    assert svc.default_collection_dir("DONA", "R0003-DONA_0007_B") == tmp_path / "DONA" / "R0003"


def test_the_data_folder_defaults_to_a_folder_named_like_the_app_in_the_documents_folder():
    from wildintel_uploader.core import config
    assert config.default_data_dir() == config.get_app_documents_dir()
    assert config.default_data_dir().name == "wildintel-uploader"
    assert config.default_data_dir().parent == Path(__import__("platformdirs").user_documents_dir())


def test_the_collections_live_in_a_collections_folder_inside_the_data_folder():
    from wildintel_uploader.core import config
    assert config.collections_dir() == config.data_dir() / "collections"
    assert config.collections_dir().parts[-2:] == ("wildintel-uploader", "collections")


def test_a_different_data_folder_moves_the_collections_with_it(tmp_path: Path):
    from wildintel_uploader.core import config
    settings = config.Settings(DATA=config.DataSettings(dir=str(tmp_path / "images")))
    assert config.data_dir(settings) == tmp_path / "images"
    assert config.collections_dir(settings) == tmp_path / "images" / "collections"


@pytest.mark.parametrize("deployment_id", ["DONA-DONA_01", "R003-DONA_01", "R0003_DONA_01", "R0003", "r0003-DONA_01"])
def test_collection_code_needs_r_four_digits_and_a_hyphen(deployment_id: str):
    with pytest.raises(svc.DeploymentImportError):
        svc.collection_code(deployment_id)


def test_deployment_id_for_builds_the_wildintel_tools_name():
    assert svc.deployment_id_for(3, "DONA_01") == "R0003-DONA_01"
    assert svc.deployment_id_for(1025, " DONA_0007_B ") == "R1025-DONA_0007_B"
    for bad in (0, 10000, -1):
        with pytest.raises(svc.DeploymentImportError):
            svc.deployment_id_for(bad, "DONA_01")
    with pytest.raises(svc.DeploymentImportError):
        svc.deployment_id_for(1, "  ")


# ── the camera: model and id ────────────────────────────────────────────────

@pytest.fixture
def no_exiftool(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(camera_info, "exiftool_path", lambda: None)


def _cameras_folder(tmp_path: Path, *cameras: tuple[str, str, str | None]) -> Path:
    for i, (make, model, serial) in enumerate(cameras):
        _make_jpeg(tmp_path / f"IMG_{i:04d}.jpg", taken=f"2024:09:0{i + 1} 10:00:00", make=make, model=model, serial=serial)
    return tmp_path


def test_guess_details_fills_in_the_camera_model_and_id_when_every_image_agrees(tmp_path: Path, no_exiftool):
    folder = _cameras_folder(tmp_path, ("Reconyx", "HC600", "P800HG08"), ("Reconyx", "HC600", "P800HG08"), ("Reconyx", "HC600", "P800HG08"))

    result = svc.guess_details(folder)

    assert result["camera_model"] == "Reconyx HC600"
    assert result["camera_id"] == "P800HG08"


def test_guess_details_leaves_the_camera_blank_when_the_images_come_from_different_cameras(tmp_path: Path, no_exiftool):
    folder = _cameras_folder(tmp_path, ("Reconyx", "HC600", "P800HG08"), ("Reconyx", "HC600", "P800HG99"), ("Browning", "Recon Force", "P800HG08"))

    result = svc.guess_details(folder)

    assert result["camera_model"] is None and result["camera_id"] is None
    assert any("2 different camera models" in w for w in result["warnings"])
    assert any("2 different camera ids" in w for w in result["warnings"])


def test_guess_details_needs_every_image_to_have_the_camera_information(tmp_path: Path, no_exiftool):
    folder = _cameras_folder(tmp_path, ("Reconyx", "HC600", "P800HG08"), ("Reconyx", "HC600", "P800HG08"))
    _make_jpeg(folder / "IMG_9999.jpg", taken="2024:09:09 10:00:00")  # no camera information at all

    result = svc.guess_details(folder)

    assert result["camera_model"] is None and result["camera_id"] is None


def test_guess_details_can_have_a_model_without_an_id(tmp_path: Path, no_exiftool):
    folder = _cameras_folder(tmp_path, ("Reconyx", "HC600", None), ("Reconyx", "HC600", None))

    result = svc.guess_details(folder)

    assert result["camera_model"] == "Reconyx HC600"
    assert result["camera_id"] is None


def test_guess_details_says_when_exiftool_is_missing(tmp_path: Path, no_exiftool):
    result = svc.guess_details(_cameras_folder(tmp_path, ("Reconyx", "HC600", "SN1")))

    assert any("ExifTool isn't installed" in w for w in result["warnings"])


@needs_exiftool
def test_exiftool_reads_the_model_and_the_serial_number(tmp_path: Path):
    folder = _cameras_folder(tmp_path, ("Reconyx", "HC600", "P800HG08"), ("Reconyx", "HC600", "P800HG08"))

    cameras, reader = camera_info.read_cameras(sorted(folder.glob("*.jpg")))

    assert reader == "exiftool"
    assert {c for c in cameras.values()} == {camera_info.CameraInfo(model="Reconyx HC600", camera_id="P800HG08")}
    result = svc.guess_details(folder)
    assert (result["camera_model"], result["camera_id"]) == ("Reconyx HC600", "P800HG08")
    assert not any("ExifTool isn't installed" in w for w in result["warnings"])


@needs_exiftool
def test_exiftool_copes_with_names_that_are_awkward_for_a_command_line(tmp_path: Path):
    _make_jpeg(tmp_path / "ñu sub" / "IMG 1 (copia).jpg", taken="2024:09:01 10:00:00", make="Reconyx", model="HC600", serial="SN1")

    cameras, reader = camera_info.read_cameras([tmp_path / "ñu sub" / "IMG 1 (copia).jpg"])

    assert reader == "exiftool"
    assert list(cameras.values()) == [camera_info.CameraInfo(model="Reconyx HC600", camera_id="SN1")]


def test_camera_info_asks_exiftool_once_for_all_the_files_and_prefers_the_serial_number_tags_in_order(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    a, b = tmp_path / "a.jpg", tmp_path / "b.jpg"
    calls = []

    def fake_run(args, **kwargs):
        calls.append((args, kwargs))
        rows = [
            {"SourceFile": str(a), "Make": "RECONYX", "Model": "HF2 PRO COVERT", "InternalSerialNumber": "INT-1", "SerialNumber": "SER-1"},
            {"SourceFile": str(b), "Make": "Canon", "Model": "Canon EOS 5D"},  # the model repeats its make; no serial
        ]
        return SimpleNamespace(stdout=json.dumps(rows), returncode=1)  # non-zero: some file couldn't be read

    monkeypatch.setattr(camera_info, "exiftool_path", lambda: "/fake/exiftool")
    monkeypatch.setattr(camera_info.subprocess, "run", fake_run)

    cameras, reader = camera_info.read_cameras([a, b])

    assert reader == "exiftool"
    assert len(calls) == 1 and calls[0][0][0] == "/fake/exiftool"
    assert calls[0][1]["input"] == f"{a}\n{b}"  # the names go in on stdin
    assert cameras[a] == camera_info.CameraInfo(model="RECONYX HF2 PRO COVERT", camera_id="SER-1")  # SerialNumber before InternalSerialNumber
    assert cameras[b] == camera_info.CameraInfo(model="Canon EOS 5D", camera_id=None)


@pytest.mark.parametrize("failure", [OSError("no such file"), subprocess.TimeoutExpired("exiftool", 1), json.JSONDecodeError("bad", "x", 0)])
def test_camera_info_falls_back_to_pillow_when_exiftool_fails(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, failure: Exception):
    _make_jpeg(tmp_path / "a.jpg", make="Reconyx", model="HC600", serial="SN1")

    def boom(*args, **kwargs):
        raise failure

    monkeypatch.setattr(camera_info, "exiftool_path", lambda: "/fake/exiftool")
    monkeypatch.setattr(camera_info.subprocess, "run", boom)

    cameras, reader = camera_info.read_cameras([tmp_path / "a.jpg"])

    assert reader == "pillow"
    assert cameras[tmp_path / "a.jpg"] == camera_info.CameraInfo(model="Reconyx HC600", camera_id="SN1")


def test_common_value_is_only_a_value_every_image_shares():
    assert camera_info.common_value(["a", "a", "a"]) == "a"
    assert camera_info.common_value(["a", "b"]) is None
    assert camera_info.common_value(["a", None]) is None
    assert camera_info.common_value([None, None]) is None
    assert camera_info.common_value([]) is None


# ── validate_images: the same camera on every image ─────────────────────────

def test_validate_images_camera_check_passes_with_one_camera(tmp_path: Path, no_exiftool):
    folder = _cameras_folder(tmp_path, ("Reconyx", "HC600", "P800HG08"), ("Reconyx", "HC600", "P800HG08"))

    result = svc.validate_images(folder, frozenset({"camera"}))

    assert result["cameras"] == [{"model": "Reconyx HC600", "camera_id": "P800HG08", "count": 2, "examples": ["IMG_0000.jpg", "IMG_0001.jpg"]}]
    assert result["cameras_without_info"] == 0
    assert result["exiftool"] is False
    assert set(result) == {"checked_count", "cameras", "cameras_without_info", "exiftool"}  # only what was asked


def test_validate_images_camera_check_lists_each_distinct_model_and_id_with_how_many_each_took(tmp_path: Path, no_exiftool):
    folder = _cameras_folder(
        tmp_path, ("Reconyx", "HC600", "A1"), ("Reconyx", "HC600", "A1"), ("Reconyx", "HC600", "A1"),
        ("Reconyx", "HC600", "B2"), ("Browning", "Recon Force", "A1"),
    )

    result = svc.validate_images(folder, frozenset({"camera"}))

    assert [(c["model"], c["camera_id"], c["count"]) for c in result["cameras"]] == [
        ("Reconyx HC600", "A1", 3), ("Browning Recon Force", "A1", 1), ("Reconyx HC600", "B2", 1),  # the most common first, then by name
    ]


def test_validate_images_camera_check_counts_the_images_with_no_camera_information(tmp_path: Path, no_exiftool):
    folder = _cameras_folder(tmp_path, ("Reconyx", "HC600", "A1"))
    _make_jpeg(folder / "bare1.jpg")
    _make_jpeg(folder / "bare2.jpg")

    result = svc.validate_images(folder, frozenset({"camera"}))

    assert len(result["cameras"]) == 1
    assert result["cameras_without_info"] == 2


def test_validate_images_runs_the_camera_check_with_the_others_by_default(tmp_path: Path, no_exiftool):
    folder = _cameras_folder(tmp_path, ("Reconyx", "HC600", "A1"))

    assert {"corrupted", "sequence_issues", "subdirectories", "cameras"} <= set(svc.validate_images(folder))


@needs_exiftool
def test_validate_images_camera_check_with_exiftool(tmp_path: Path):
    folder = _cameras_folder(tmp_path, ("Reconyx", "HC600", "A1"), ("Reconyx", "HC600", "B2"))

    result = svc.validate_images(folder, frozenset({"camera"}))

    assert result["exiftool"] is True
    assert sorted(c["camera_id"] for c in result["cameras"]) == ["A1", "B2"]


# ── validate_images: the EXIF fields the wizard needs ───────────────────────

def test_validate_images_exif_check_counts_the_images_missing_each_field(tmp_path: Path, no_exiftool):
    _make_jpeg(tmp_path / "complete.jpg", taken="2024:09:01 10:00:00", make="Reconyx", model="HC600", serial="A1")
    _make_jpeg(tmp_path / "no_date.jpg", make="Reconyx", model="HC600", serial="A1")
    _make_jpeg(tmp_path / "no_serial.jpg", taken="2024:09:01 11:00:00", make="Reconyx", model="HC600")
    _make_jpeg(tmp_path / "bare.jpg")

    result = svc.validate_images(tmp_path, frozenset({"exif"}))

    missing = result["exif_missing"]
    assert missing["date"] == {"count": 2, "examples": ["bare.jpg", "no_date.jpg"]}
    assert missing["camera_model"] == {"count": 1, "examples": ["bare.jpg"]}
    assert missing["camera_id"] == {"count": 2, "examples": ["bare.jpg", "no_serial.jpg"]}
    assert set(result) == {"checked_count", "exif_missing", "exiftool"}  # only what was asked


def test_validate_images_exif_check_finds_nothing_missing_when_every_image_has_everything(tmp_path: Path, no_exiftool):
    folder = _cameras_folder(tmp_path, ("Reconyx", "HC600", "A1"), ("Reconyx", "HC600", "A1"))

    result = svc.validate_images(folder, frozenset({"exif"}))

    assert {field: info["count"] for field, info in result["exif_missing"].items()} == {"date": 0, "camera_model": 0, "camera_id": 0}


def test_validate_images_exif_and_camera_checks_read_the_camera_once(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, no_exiftool):
    folder = _cameras_folder(tmp_path, ("Reconyx", "HC600", "A1"))
    calls = []
    real = camera_info.read_cameras
    monkeypatch.setattr(camera_info, "read_cameras", lambda paths: calls.append(paths) or real(paths))

    result = svc.validate_images(folder, frozenset({"exif", "camera"}))

    assert len(calls) == 1
    assert "exif_missing" in result and "cameras" in result


# ── validate_images: duplicate images ───────────────────────────────────────

def test_validate_images_duplicates_finds_files_with_exactly_the_same_content(tmp_path: Path):
    (tmp_path / "sub").mkdir()
    (tmp_path / "IMG_0001.jpg").write_bytes(b"same content")
    (tmp_path / "IMG_0001 (copy).jpg").write_bytes(b"same content")
    (tmp_path / "sub" / "IMG_0001.jpg").write_bytes(b"same content")  # a third copy, in a subfolder
    (tmp_path / "IMG_0002.jpg").write_bytes(b"other content")
    (tmp_path / "IMG_0003.jpg").write_bytes(b"other CONTENT")  # the same size, but not the same
    (tmp_path / "IMG_0004.jpg").write_bytes(b"unique")

    result = svc.validate_images(tmp_path, frozenset({"duplicates"}))

    assert result["duplicates"] == [{"size": len(b"same content"), "files": ["IMG_0001 (copy).jpg", "IMG_0001.jpg", "sub/IMG_0001.jpg"]}]
    assert set(result) == {"checked_count", "duplicates"}


def test_validate_images_duplicates_lists_each_group_separately(tmp_path: Path):
    for name, content in [("a1.jpg", b"AAAA"), ("a2.jpg", b"AAAA"), ("b1.jpg", b"BBBBB"), ("b2.jpg", b"BBBBB"), ("c.jpg", b"C")]:
        (tmp_path / name).write_bytes(content)

    result = svc.validate_images(tmp_path, frozenset({"duplicates"}))

    assert [g["files"] for g in result["duplicates"]] == [["a1.jpg", "a2.jpg"], ["b1.jpg", "b2.jpg"]]


def test_validate_images_duplicates_is_empty_when_every_image_is_different(tmp_path: Path):
    folder = _cameras_folder(tmp_path, ("Reconyx", "HC600", "A1"), ("Reconyx", "HC600", "A1"))  # different dates, so different bytes

    assert svc.validate_images(folder, frozenset({"duplicates"}))["duplicates"] == []


def test_validate_images_duplicates_only_hashes_files_of_the_same_size(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    (tmp_path / "small.jpg").write_bytes(b"1")
    (tmp_path / "medium.jpg").write_bytes(b"22")
    (tmp_path / "big.jpg").write_bytes(b"333")
    hashed = []
    real = svc._content_hash
    monkeypatch.setattr(svc, "_content_hash", lambda path: hashed.append(path.name) or real(path))

    svc.validate_images(tmp_path, frozenset({"duplicates"}))

    assert hashed == []  # no two files share a size, so none can be equal


def test_validate_images_runs_all_six_checks_by_default(tmp_path: Path, no_exiftool):
    folder = _cameras_folder(tmp_path, ("Reconyx", "HC600", "A1"))

    assert {"corrupted", "sequence_issues", "subdirectories", "cameras", "exif_missing", "duplicates"} <= set(svc.validate_images(folder))


# ── postvalidation: the names ────────────────────────────────────────────────

def _names(deployment_id: str, **kwargs) -> dict:
    checks = frozenset({"deployment_id", "collection_prefix", "collection_name", "location"})
    folder = Path(kwargs.pop("folder"))
    return svc.validate_deployment_consistency(folder, _deployment(deployment_id=deployment_id), checks, **kwargs)


@pytest.mark.parametrize("deployment_id", ["R0033-DONA_01", "R0003-DONA_0007_B", "R0001-x", "R1025-A-B", "R0003-DONA_01_winter"])
def test_deployment_id_format_accepts_the_wildintel_tools_names(tmp_path: Path, deployment_id: str):
    assert _names(deployment_id, folder=tmp_path)["deployment_id"]["ok"] is True


@pytest.mark.parametrize("deployment_id", [
    "DONA-DONA_01", "R033-DONA_01", "R00033-DONA_01", "R0033_DONA_01", "R0033-", "R0033", "r0033-DONA_01", "R0033-DO NA", "R0033-DONÑA", "R0033-DONA/01",
])
def test_deployment_id_format_rejects_anything_else(tmp_path: Path, deployment_id: str):
    check = _names(deployment_id, folder=tmp_path)["deployment_id"]

    assert check["ok"] is False
    assert "R0033-DONA_01" in check["message"]


def test_a_trapper_deployment_goes_in_the_collection_its_id_names(tmp_path: Path):
    result = _names("R0003-DONA_01", folder=tmp_path)  # no collection folder of its own

    assert result["collection_name"]["ok"] and result["collection_prefix"]["ok"]
    assert "R0003" in result["collection_prefix"]["message"]


@pytest.mark.parametrize("collection", ["R0003", "R0003_winter", "R0999_a_b"])
def test_collection_name_accepts_r_four_digits_and_an_optional_suffix(tmp_path: Path, collection: str):
    assert _names("R0003-DONA_01", folder=tmp_path, collection_name=collection)["collection_name"]["ok"] is True


@pytest.mark.parametrize("collection", ["Doñana 2024", "R003", "r0003", "R0003winter", "R00033", "0003", "Collections", "R0003 "])
def test_collection_name_rejects_anything_else(tmp_path: Path, collection: str):
    check = _names("R0003-DONA_01", folder=tmp_path, collection_name=collection)["collection_name"]

    assert check["ok"] is False
    assert collection in check["message"]


def test_collection_name_needs_a_collection(tmp_path: Path):
    check = _names("DONA-DONA_01", folder=tmp_path)["collection_name"]  # an id with no collection prefix, and no folder given

    assert check["ok"] is False and "doesn't start with one" in check["message"]


def test_the_id_prefix_has_to_be_the_collection_it_goes_in(tmp_path: Path):
    good = _names("R0003-DONA_01", folder=tmp_path, collection_name="R0003_winter")["collection_prefix"]
    bad = _names("R0003-DONA_01", folder=tmp_path, collection_name="R0004")["collection_prefix"]

    assert good["ok"] is True
    assert bad["ok"] is False and "R0003" in bad["message"] and "R0004" in bad["message"]


def test_the_id_prefix_check_fails_when_either_side_is_not_a_valid_name(tmp_path: Path):
    no_prefix = _names("DONA-DONA_01", folder=tmp_path, collection_name="R0003")["collection_prefix"]
    bad_collection = _names("R0003-DONA_01", folder=tmp_path, collection_name="Doñana")["collection_prefix"]

    assert no_prefix["ok"] is False and "doesn't start with a collection" in no_prefix["message"]
    assert bad_collection["ok"] is False and "no valid collection" in bad_collection["message"]


def test_the_id_prefix_is_compared_ignoring_case(tmp_path: Path):
    # The collection folder name has to be R#### (see collection_name), but the comparison itself doesn't shout.
    assert _names("R0003-DONA_01", folder=tmp_path, collection_name="R0003")["collection_prefix"]["ok"] is True


def test_the_location_in_the_id_is_the_one_chosen(tmp_path: Path):
    ok = _names("R0003-DONA_01", folder=tmp_path, expected_location_id="DONA_01")["location"]
    suffix = _names("R0003-DONA_01_winter", folder=tmp_path, expected_location_id="DONA_01")["location"]
    other = _names("R0003-DONA_02", folder=tmp_path, expected_location_id="DONA_01")["location"]
    longer = _names("R0003-DONA_010", folder=tmp_path, expected_location_id="DONA_01")["location"]  # not a suffix: no underscore

    assert ok["ok"] and suffix["ok"]
    assert other["ok"] is False and "DONA_02" in other["message"] and "DONA_01" in other["message"]
    assert longer["ok"] is False


def test_the_location_check_ignores_case_and_allows_hyphens_inside_the_location(tmp_path: Path):
    assert _names("R0003-dona_01", folder=tmp_path, expected_location_id="DONA_01")["location"]["ok"] is True
    assert _names("R0003-DONA-01", folder=tmp_path, expected_location_id="DONA-01")["location"]["ok"] is True


def test_the_location_check_has_nothing_to_compare_with_when_no_location_was_chosen(tmp_path: Path):
    check = _names("R0003-DONA_01", folder=tmp_path)["location"]

    assert check["ok"] is True and "No location" in check["message"]


def test_a_deployment_id_with_no_location_fails_the_location_check(tmp_path: Path):
    assert _names("R0003", folder=tmp_path, expected_location_id="DONA_01")["location"]["ok"] is False


def test_the_default_run_includes_every_postvalidation_check(tmp_path: Path):
    _make_jpeg(tmp_path / "a.jpg", taken="2024:09:04 10:00:00")

    result = svc.validate_deployment_consistency(tmp_path, _deployment())

    assert {"deployment_id", "collection_name", "collection_prefix", "location", "out_of_range", "tolerance_hours", "camera_mismatches"} <= set(result)


# ── validating several images at once ────────────────────────────────────────

def test_the_image_checks_find_the_same_whatever_the_workers(tmp_path: Path, monkeypatch):
    for i in range(1, 9):
        _make_jpeg(tmp_path / f"IMG_{i:04d}.jpg", taken=f"2024:09:0{i}  10:00:00".replace("  ", " "), make="Reconyx", model="HC600")
    _make_jpeg(tmp_path / "IMG_0003.jpg", taken="2024:08:20 10:00:00", make="Reconyx", model="HC600")  # out of order
    (tmp_path / "IMG_0099.jpg").write_bytes(b"not an image")  # corrupted
    (tmp_path / "IMG_0010.jpg").write_bytes((tmp_path / "IMG_0001.jpg").read_bytes())  # a duplicate
    checks = frozenset({"corrupted", "sequence", "exif", "duplicates", "camera"})

    outcomes = []
    for workers in (1, 4):
        monkeypatch.setattr(svc.config, "workers", lambda settings=None, w=workers: w)
        outcomes.append(svc.validate_images(tmp_path, checks))

    assert outcomes[0] == outcomes[1]
    assert [c["path"] for c in outcomes[0]["corrupted"]] == ["IMG_0099.jpg"]
    assert outcomes[0]["sequence_issues"] and outcomes[0]["duplicates"]


# ── a deployment that is already kept ────────────────────────────────────────

def test_a_deployment_with_images_in_its_folder_already_exists(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(svc.config, "collections_dir", lambda settings=None: tmp_path)
    kept = tmp_path / "DONA" / "R0003" / "R0003-DONA_01"
    kept.mkdir(parents=True)
    (kept / "IMG.JPEG").write_bytes(b"x")

    assert svc.existing_deployment_dir("DONA", "R0003-DONA_01") == kept
    assert svc.existing_deployment_dir("DONA", "R0003-DONA_02") is None  # another location
    assert svc.existing_deployment_dir("DONA", "R0004-DONA_01") is None  # another revision
    assert svc.existing_deployment_dir("OTHER", "R0003-DONA_01") is None  # another research project


def test_an_empty_folder_is_not_an_existing_deployment_and_nor_are_bad_ids(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(svc.config, "collections_dir", lambda settings=None: tmp_path)
    (tmp_path / "DONA" / "R0003" / "R0003-DONA_01").mkdir(parents=True)  # nothing in it: importing is not refused

    assert svc.existing_deployment_dir("DONA", "R0003-DONA_01") is None
    assert svc.existing_deployment_dir("DONA", "no-collection-prefix") is None
    assert svc.existing_deployment_dir("../x", "R0003-DONA_01") is None


# ── bundled ExifTool ─────────────────────────────────────────────────────────

def test_exiftool_path_prefers_the_bundled_copy(tmp_path: Path, monkeypatch):
    name = "exiftool.exe" if sys.platform == "win32" else "exiftool"
    (tmp_path / "exiftool").mkdir()
    bundled = tmp_path / "exiftool" / name
    bundled.write_text("#!/usr/bin/perl\n")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)

    assert camera_info.exiftool_path() == str(bundled)


def test_exiftool_path_falls_back_to_the_path_when_nothing_is_bundled(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
    monkeypatch.setattr(camera_info.shutil, "which", lambda _name: "/usr/bin/exiftool")

    assert camera_info.exiftool_path() == "/usr/bin/exiftool"
