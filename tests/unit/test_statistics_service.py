"""services.statistics_service — is this revision of a location like the ones before it?"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from PIL import Image

from wildintel_uploader.core.services import statistics_service as st

T0 = datetime(2024, 9, 1, 8, 0, 0)


def _stamps(count: int, per_sequence: int, *, gap=600, within=10, start=T0) -> list[datetime]:
    """`count` images in sequences of `per_sequence`: `within` seconds apart inside one, `gap` between sequences."""
    out, t = [], start
    for i in range(count):
        out.append(t)
        t += timedelta(seconds=within if (i + 1) % per_sequence else gap)
    return out


def _jpeg(path: Path, taken: datetime) -> None:
    img = Image.new("RGB", (4, 4))
    exif = img.getexif()
    exif.get_ifd(0x8769)[36867] = taken.strftime("%Y:%m:%d %H:%M:%S")
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, exif=exif)


def _revision(root: Path, rp: str, deployment_id: str, stamps: list[datetime], *, collection: str | None = None, log=True) -> Path:
    """A previous revision kept in the collections folder, with its images.json (or just its images)."""
    folder = root / rp / (collection or deployment_id[:5]) / deployment_id
    folder.mkdir(parents=True)
    if log:
        images = [{"name": f"{i}.jpeg", "local_time": t.isoformat(), "source": "trapper", "extra": {}} for i, t in enumerate(stamps)]
        (folder / "images.json").write_text(json.dumps({"images": images}), encoding="utf-8")
    else:
        for i, t in enumerate(stamps):
            _jpeg(folder / f"IMG_{i:04d}.JPG", t)
    return folder


def _times(stamps: list[datetime]) -> st.DeploymentTimes:
    return st.DeploymentTimes(len(stamps), sorted(t.replace(tzinfo=timezone.utc).timestamp() for t in stamps))


# ── what a sequence is ───────────────────────────────────────────────────────

def test_a_sequence_starts_when_the_gap_is_at_least_x_seconds():
    assert st.sequence_lengths([0, 10, 20, 200, 210, 1000], 60) == [3, 2, 1]
    assert st.sequence_lengths([0, 59, 118], 60) == [3]           # 59 s apart: the same sequence
    assert st.sequence_lengths([0, 60], 60) == [1, 1]              # exactly 60 s: "at least X" starts a new one
    assert st.sequence_lengths([0, 10, 20], 5) == [1, 1, 1]        # a stricter gap splits more
    assert st.sequence_lengths([0, 10, 20], 3600) == [3]           # a looser one splits less


def test_the_sequences_do_not_depend_on_the_order_the_times_come_in():
    assert st.sequence_lengths([200, 0, 1000, 10, 210, 20], 60) == [3, 2, 1]


def test_no_images_no_sequences():
    assert st.sequence_lengths([], 60) == []


# ── the previous revisions of a location ────────────────────────────────────

def test_only_the_lower_revisions_of_the_same_location_in_the_same_research_project_count(tmp_path: Path):
    for rp, dep in [("DONA", "R0001-DONA_0006_B"), ("DONA", "R0002-DONA_0006_B"), ("DONA", "R0003-DONA_0006_B"), ("DONA", "R0004-DONA_0006_B"),
                    ("DONA", "R0002-DONA_0007_A"), ("DONA", "R0005-DONA_0006_B"), ("OTRO", "R0001-DONA_0006_B")]:
        _revision(tmp_path, rp, dep, _stamps(3, 3))

    found = st.previous_revisions(tmp_path, "DONA", "R0004-DONA_0006_B")

    assert [(r.revision, r.deployment_id) for r in found] == [(1, "R0001-DONA_0006_B"), (2, "R0002-DONA_0006_B"), (3, "R0003-DONA_0006_B")]


def test_the_location_is_compared_ignoring_case_and_collections_with_a_suffix_count(tmp_path: Path):
    _revision(tmp_path, "DONA", "R0001-dona_0006_b", _stamps(3, 3), collection="R0001_winter")

    assert [r.deployment_id for r in st.previous_revisions(tmp_path, "DONA", "R0002-DONA_0006_B")] == ["R0001-dona_0006_b"]


def test_a_first_revision_an_odd_id_or_an_unknown_research_project_has_no_history(tmp_path: Path):
    _revision(tmp_path, "DONA", "R0001-DONA_01", _stamps(3, 3))

    assert st.previous_revisions(tmp_path, "DONA", "R0001-DONA_01") == []
    assert st.previous_revisions(tmp_path, "DONA", "DONA-DONA_01") == []
    assert st.previous_revisions(tmp_path, "NOPE", "R0002-DONA_01") == []
    assert st.previous_revisions(tmp_path / "missing", "DONA", "R0002-DONA_01") == []


def test_a_revisions_images_are_read_from_its_images_file_or_else_from_their_exif(tmp_path: Path):
    with_log = _revision(tmp_path, "DONA", "R0001-DONA_01", _stamps(6, 3))
    without = _revision(tmp_path, "DONA", "R0002-DONA_01", _stamps(6, 3), log=False)

    a, b = st.times_of_revision(with_log), st.times_of_revision(without)

    assert a.image_count == b.image_count == 6
    assert a.sequences(60) == b.sequences(60) == [3, 3]


def test_an_images_file_that_cannot_be_read_falls_back_to_the_images(tmp_path: Path):
    folder = _revision(tmp_path, "DONA", "R0001-DONA_01", _stamps(4, 2), log=False)
    (folder / "images.json").write_text("{ not json", encoding="utf-8")

    assert st.times_of_revision(folder).image_count == 4


# ── similar ──────────────────────────────────────────────────────────────────

def _cmp(value, previous, **kw):
    return st.compare(value, previous, **{"method": "median", "tolerance_percent": 50, "min_revisions": 2, **kw})


def test_a_value_within_the_tolerance_of_the_median_is_similar():
    result = _cmp(1100, [1000, 1200, 800])  # median 1000, ±50%: 500–1500

    assert result["ok"] and not result["skipped"]
    assert (result["reference"], result["lower"], result["upper"], result["previous"]) == (1000, 500, 1500, 3)


def test_a_value_that_shoots_up_or_collapses_is_not_similar():
    assert _cmp(5000, [1000, 1200, 800])["ok"] is False
    assert _cmp(100, [1000, 1200, 800])["ok"] is False


def test_the_edge_of_the_tolerance_is_still_similar():
    assert _cmp(1500, [1000, 1000])["ok"] is True and _cmp(1501, [1000, 1000])["ok"] is False


def test_the_tolerance_decides_what_similar_is():
    assert _cmp(1800, [1000, 1000], tolerance_percent=50)["ok"] is False
    assert _cmp(1800, [1000, 1000], tolerance_percent=100)["ok"] is True
    assert _cmp(1001, [1000, 1000], tolerance_percent=0)["ok"] is False
    assert _cmp(1000, [1000, 1000], tolerance_percent=0)["ok"] is True


@pytest.mark.parametrize("method,reference,lower,upper", [
    ("median", 1000, 500, 1500),                   # median of 100, 1000, 3000
    ("mean", 1366.67, 683.33, 2050.0),
    ("last", 3000, 1500, 4500),
    ("range", 1000, 50, 4500),                     # min 100 and max 3000, each widened by 50%
])
def test_the_method_decides_what_the_revision_is_compared_to(method, reference, lower, upper):
    result = _cmp(1000, [100, 1000, 3000], method=method)

    assert result["reference"] == pytest.approx(reference, abs=0.01)
    assert result["lower"] == pytest.approx(lower, abs=0.01) and result["upper"] == pytest.approx(upper, abs=0.01)


def test_a_range_is_forgiving_of_a_location_that_varies_a_lot_where_the_median_is_not():
    previous = [100, 1000, 3000]

    assert _cmp(2500, previous, method="median")["ok"] is False
    assert _cmp(2500, previous, method="range")["ok"] is True


def test_without_enough_previous_revisions_the_check_is_skipped_and_does_not_fail():
    result = _cmp(99999, [1000], min_revisions=2)

    assert result["skipped"] is True and result["ok"] is True and result["previous"] == 1
    assert _cmp(99999, [], min_revisions=1)["skipped"] is True
    assert _cmp(99999, [1000], min_revisions=1)["skipped"] is False


def test_the_history_needed_is_never_less_than_one_revision():
    assert _cmp(5, [], min_revisions=0)["skipped"] is True


def test_a_reference_of_zero_is_similar_only_to_zero():
    assert _cmp(0, [0, 0])["ok"] is True
    assert _cmp(3, [0, 0])["ok"] is False


def test_an_unknown_method_is_refused():
    with pytest.raises(st.dis.DeploymentImportError, match="Unknown method"):
        _cmp(1, [1, 1], method="mode")


# ── the statistical checks ───────────────────────────────────────────────────

TOLERANCES = {"image_count": 50.0, "sequence_count": 50.0, "sequence_length": 50.0}


def _run(tmp_path: Path, current: list[datetime], *, checks=frozenset(st.STATISTIC_CHECKS), deployment_id="R0004-DONA_0006_B", **kw):
    params = {"sequence_gap_seconds": 60, "min_revisions": 2, "method": "median", "tolerances": TOLERANCES, **kw}
    return st.statistical_checks(_times(current), tmp_path, "DONA", deployment_id, checks, **params)


def _history(tmp_path: Path, *revisions: list[datetime]) -> None:
    for i, stamps in enumerate(revisions, start=1):
        _revision(tmp_path, "DONA", f"R{i:04d}-DONA_0006_B", stamps)


def test_a_revision_like_the_previous_ones_passes_every_check(tmp_path: Path):
    _history(tmp_path, _stamps(300, 3), _stamps(330, 3), _stamps(270, 3))

    result = _run(tmp_path, _stamps(310, 3))

    assert set(result) == {"image_count", "sequence_count", "sequence_length"}
    assert all(r["ok"] and not r["skipped"] for r in result.values())
    assert result["image_count"]["value"] == 310 and result["sequence_count"]["value"] == pytest.approx(104, abs=1)
    assert result["sequence_length"]["value"] == pytest.approx(3, abs=0.05)
    assert [h["revision"] for h in result["image_count"]["history"]] == [1, 2, 3]
    assert [h["value"] for h in result["image_count"]["history"]] == [300, 330, 270]


def test_a_camera_that_fired_nonstop_fails_the_image_count_but_not_necessarily_the_rest(tmp_path: Path):
    _history(tmp_path, _stamps(300, 3), _stamps(330, 3), _stamps(270, 3))

    result = _run(tmp_path, _stamps(3000, 3))  # ten times the photos, in sequences just as short

    assert result["image_count"]["ok"] is False and "is not similar to" in result["image_count"]["message"]
    assert result["sequence_count"]["ok"] is False  # ten times the sequences too
    assert result["sequence_length"]["ok"] is True  # but the sequences themselves are the same length


def test_longer_sequences_fail_the_length_check_while_the_photo_count_may_be_the_same(tmp_path: Path):
    _history(tmp_path, _stamps(300, 3), _stamps(330, 3), _stamps(270, 3))

    result = _run(tmp_path, _stamps(300, 30))  # same photos, in 10-image sequences ten times longer

    assert result["image_count"]["ok"] is True
    assert result["sequence_length"]["ok"] is False and result["sequence_count"]["ok"] is False


def test_what_a_sequence_is_changes_the_statistics(tmp_path: Path):
    _history(tmp_path, _stamps(300, 3), _stamps(330, 3))

    default = _run(tmp_path, _stamps(300, 3))                       # 600 s between sequences: > 60 s
    wide = _run(tmp_path, _stamps(300, 3), sequence_gap_seconds=3600)  # an hour: everything is one sequence

    assert default["sequence_count"]["value"] == 100 and wide["sequence_count"]["value"] == 1
    assert wide["sequence_length"]["value"] == 300
    assert default["image_count"]["value"] == wide["image_count"]["value"] == 300  # the photos are the same either way


def test_the_previous_revisions_are_split_into_sequences_with_the_same_gap(tmp_path: Path):
    _history(tmp_path, _stamps(300, 3), _stamps(300, 3))

    result = _run(tmp_path, _stamps(300, 3), sequence_gap_seconds=3600)  # history and now, all one sequence each

    assert [h["value"] for h in result["sequence_count"]["history"]] == [1, 1]
    assert result["sequence_count"]["ok"] is True


def test_only_the_checks_asked_for_are_run(tmp_path: Path):
    _history(tmp_path, _stamps(30, 3), _stamps(30, 3))

    assert set(_run(tmp_path, _stamps(30, 3), checks=frozenset({"sequence_count"}))) == {"sequence_count"}
    assert _run(tmp_path, _stamps(30, 3), checks=frozenset({"camera", "location"})) == {}


def test_each_check_has_its_own_tolerance(tmp_path: Path):
    _history(tmp_path, _stamps(300, 3), _stamps(300, 3))

    result = _run(tmp_path, _stamps(420, 3), tolerances={"image_count": 20.0, "sequence_count": 100.0, "sequence_length": 100.0})

    assert result["image_count"]["ok"] is False   # +40%, allowed 20%
    assert result["sequence_count"]["ok"] is True  # +40%, allowed 100%


def test_with_too_little_history_they_are_skipped_and_say_how_much_there_is(tmp_path: Path):
    _history(tmp_path, _stamps(300, 3))

    result = _run(tmp_path, _stamps(9000, 3))

    for check in result.values():
        assert check["skipped"] is True and check["ok"] is True
        assert "1 previous revision(s) of DONA_0006_B found, 2 needed" in check["message"]


def test_a_first_revision_has_nothing_to_compare_with(tmp_path: Path):
    result = _run(tmp_path, _stamps(30, 3), deployment_id="R0001-DONA_0006_B")

    assert all(c["skipped"] and c["previous"] == 0 for c in result.values())


def test_without_a_research_project_there_is_no_history(tmp_path: Path):
    _history(tmp_path, _stamps(300, 3), _stamps(300, 3))

    result = st.statistical_checks(_times(_stamps(300, 3)), tmp_path, None, "R0003-DONA_0006_B", frozenset(st.STATISTIC_CHECKS),
                                   sequence_gap_seconds=60, min_revisions=2, method="median", tolerances=TOLERANCES)

    assert all(c["skipped"] for c in result.values())


def test_the_next_revision_is_one_after_the_highest_kept_for_that_location(tmp_path: Path):
    _revision(tmp_path, "DONA", "R0001-DONA_01", _stamps(3, 3))
    _revision(tmp_path, "DONA", "R0003-DONA_01", _stamps(3, 3), collection="R0003_winter")
    _revision(tmp_path, "DONA", "R0007-DONA_02", _stamps(3, 3))  # another location

    assert st.next_revision(tmp_path, "DONA", "dona_01") == {"last": 3, "next": 4}
    assert st.next_revision(tmp_path, "DONA", "DONA_02") == {"last": 7, "next": 8}
    assert st.next_revision(tmp_path, "DONA", "DONA_03") == {"last": None, "next": 1}
    assert st.next_revision(tmp_path, "NOPE", "DONA_01") == {"last": None, "next": 1}


def test_a_previous_revision_with_no_images_is_not_history(tmp_path: Path):
    _history(tmp_path, _stamps(300, 3), [], _stamps(300, 3))

    result = _run(tmp_path, _stamps(300, 3), deployment_id="R0004-DONA_0006_B")

    assert result["image_count"]["previous"] == 2 and not result["image_count"]["skipped"]


def test_the_message_says_what_it_was_compared_to_and_what_was_allowed(tmp_path: Path):
    _history(tmp_path, _stamps(300, 3), _stamps(330, 3), _stamps(270, 3))

    message = _run(tmp_path, _stamps(310, 3))["image_count"]["message"]

    assert message == "The number of images (310) is similar to the median of the 3 previous revision(s) of DONA_0006_B (allowed 150–450, ±50%)."
    assert "the range of" in _run(tmp_path, _stamps(310, 3), method="range")["image_count"]["message"]
    assert "the last of" in _run(tmp_path, _stamps(310, 3), method="last")["image_count"]["message"]
    assert "images per sequence" in _run(tmp_path, _stamps(310, 3))["sequence_length"]["message"]


def test_the_current_folders_images_are_read_from_their_exif(tmp_path: Path):
    folder = tmp_path / "now"
    for i, t in enumerate(_stamps(6, 3)):
        _jpeg(folder / f"IMG_{i}.JPG", t)
    (folder / "undated.JPG").parent.mkdir(exist_ok=True)
    Image.new("RGB", (4, 4)).save(folder / "undated.JPG")

    times = st.times_of_folder(folder)

    assert times.image_count == 7  # every image counts…
    assert times.sequences(60) == [3, 3]  # …but only the dated ones can be placed in a sequence


# ── the details of the previous revision ─────────────────────────────────────

def _kept(root: Path, deployment_id: str, details: dict | None, *, collection: str) -> None:
    folder = root / "DONA" / collection / deployment_id
    folder.mkdir(parents=True)
    if details is not None:
        (folder / "deployment.json").write_text(json.dumps({"deployment_id": deployment_id, **details}), encoding="utf-8")


def test_the_details_come_from_the_closest_earlier_revision_of_the_location(tmp_path: Path):
    _kept(tmp_path, "R0001-DONA_01", {"habitat": "pine"}, collection="R0001")
    _kept(tmp_path, "R0002-DONA_01", {"habitat": "oak"}, collection="R0002")
    _kept(tmp_path, "R0002-DONA_02", {"habitat": "other place"}, collection="R0002")

    found = st.previous_deployment(tmp_path, "DONA", "R0003-DONA_01")

    assert found["revision"] == 2 and found["deployment_id"] == "R0002-DONA_01"
    assert found["deployment"]["habitat"] == "oak"


def test_a_revision_is_filled_from_the_first_when_that_is_the_only_one(tmp_path: Path):
    _kept(tmp_path, "R0001-DONA_01", {"setup_by": "Ana"}, collection="R0001")

    assert st.previous_deployment(tmp_path, "DONA", "R0002-DONA_01")["deployment"]["setup_by"] == "Ana"


def test_a_revision_that_kept_no_details_is_skipped_for_the_one_before(tmp_path: Path):
    _kept(tmp_path, "R0001-DONA_01", {"setup_by": "Ana"}, collection="R0001")
    _kept(tmp_path, "R0002-DONA_01", None, collection="R0002")

    assert st.previous_deployment(tmp_path, "DONA", "R0003-DONA_01")["revision"] == 1


def test_there_are_no_details_to_fill_in_from_when_there_is_no_earlier_revision(tmp_path: Path):
    _kept(tmp_path, "R0002-DONA_01", {"setup_by": "Ana"}, collection="R0002")

    assert st.previous_deployment(tmp_path, "DONA", "R0001-DONA_01") is None  # the first one
    assert st.previous_deployment(tmp_path, "DONA", "R0003-DONA_09") is None  # another location
    assert st.previous_deployment(tmp_path, "NOPE", "R0003-DONA_01") is None


# ── statistics of a collection ──────────────────────────────────────────────

_TOL = {"image_count": 50.0, "sequence_count": 50.0, "sequence_length": 50.0}


def _collection_stats(root: Path, rp: str, collection: str, **kw) -> list[dict]:
    return st.collection_statistics(root, rp, collection, sequence_gap_seconds=60, min_revisions=2, method="median", tolerances=_TOL, **kw)


def test_collection_statistics_flags_only_the_deployment_that_departs(tmp_path):
    for rev in (1, 2):
        _revision(tmp_path, "RP", f"R000{rev}-A", _stamps(100, 5), collection=f"R000{rev}")
        _revision(tmp_path, "RP", f"R000{rev}-B", _stamps(100, 5), collection=f"R000{rev}")
    _revision(tmp_path, "RP", "R0003-A", _stamps(100, 5), collection="R0003")
    _revision(tmp_path, "RP", "R0003-B", _stamps(1000, 50), collection="R0003")
    rows = {r["deployment_id"]: r for r in _collection_stats(tmp_path, "RP", "R0003")}
    assert rows["R0003-A"]["status"] == "ok"
    assert rows["R0003-B"]["status"] == "review"
    assert rows["R0003-B"]["checks"]["image_count"]["previous"] == 2


def test_collection_statistics_without_history_is_insufficient(tmp_path):
    _revision(tmp_path, "RP", "R0001-A", _stamps(10, 5), collection="R0001")
    assert _collection_stats(tmp_path, "RP", "R0001")[0]["status"] == "insufficient_history"


def test_collection_statistics_unknown_collection(tmp_path):
    with pytest.raises(st.dis.DeploymentImportError):
        _collection_stats(tmp_path, "RP", "R0009")


def test_deployment_metrics_are_kept_and_read_back(tmp_path):
    folder = _revision(tmp_path, "RP", "R0001-A", _stamps(20, 5), collection="R0001")
    first = st.deployment_metrics(folder, 60)
    assert (folder / st.STATS_FILE).is_file()
    # a doctored cache is what is read back while images.json is the same…
    kept = json.loads((folder / st.STATS_FILE).read_text())
    kept["metrics"]["image_count"] = 999
    (folder / st.STATS_FILE).write_text(json.dumps(kept))
    assert st.deployment_metrics(folder, 60)["image_count"] == 999
    # …and it is recomputed when the gap changes or images.json does
    assert st.deployment_metrics(folder, 5)["image_count"] == first["image_count"]
    (folder / "images.json").write_text(json.dumps({"images": []}), encoding="utf-8")
    assert st.deployment_metrics(folder, 60)["image_count"] == 0


def test_deployment_without_images_json_is_not_kept(tmp_path):
    folder = _revision(tmp_path, "RP", "R0001-A", _stamps(5, 5), collection="R0001", log=False)
    assert st.deployment_metrics(folder, 60)["image_count"] == 5
    assert not (folder / st.STATS_FILE).exists()


def test_compare_deployments_gives_the_change(tmp_path):
    _revision(tmp_path, "RP", "R0002-A", _stamps(100, 5), collection="R0002")
    _revision(tmp_path, "RP", "R0003-A", _stamps(200, 5), collection="R0003")
    result = st.compare_deployments(tmp_path, "RP", "R0002-A", "R0003-A", sequence_gap_seconds=60)
    assert result["metrics"]["image_count"] == {"first": 100.0, "second": 200.0, "change_percent": 100.0}
    with pytest.raises(st.dis.DeploymentImportError):
        st.compare_deployments(tmp_path, "RP", "R0002-A", "R0009-A", sequence_gap_seconds=60)


def test_deployment_metrics_say_the_days_it_covers_and_the_images_of_each_calendar_day(tmp_path):
    stamps = [datetime(2024, 9, 1, 8), datetime(2024, 9, 1, 9), datetime(2024, 9, 3, 23, 30), datetime(2024, 9, 4, 0, 30)]
    folder = _revision(tmp_path, "RP", "R0001-A", stamps, collection="R0001")
    metrics = st.deployment_metrics(folder, 60)

    assert metrics["daily"] == [{"date": "2024-09-01", "images": 2}, {"date": "2024-09-02", "images": 0},
                                {"date": "2024-09-03", "images": 1}, {"date": "2024-09-04", "images": 1}]
    assert metrics["days"] == pytest.approx(2 + 16.5 / 24)   # from the first image to the last, 1 Sep 08:00 to 4 Sep 00:30
    assert metrics["images_per_day"] == pytest.approx(4 / metrics["days"])


def test_one_image_covers_no_days_and_has_no_daily_rate(tmp_path):
    folder = _revision(tmp_path, "RP", "R0001-A", [datetime(2024, 9, 1, 8)], collection="R0001")
    metrics = st.deployment_metrics(folder, 60)
    assert metrics["days"] is None and metrics["images_per_day"] is None and metrics["daily"] == [{"date": "2024-09-01", "images": 1}]


def test_the_rows_keep_the_daily_images_of_the_deployment_but_not_of_each_revision(tmp_path):
    _revision(tmp_path, "RP", "R0001-A", _stamps(10, 5), collection="R0001")
    _revision(tmp_path, "RP", "R0002-A", _stamps(10, 5), collection="R0002")
    [row] = _collection_stats(tmp_path, "RP", "R0002")
    assert row["metrics"]["daily"] and row["metrics"]["longest_sequence"] and all(not {"daily", "sequences_daily", "longest_sequence"} & r["metrics"].keys() and r["metrics"]["sequence_lengths"] for r in row["revisions"])


def test_the_sequences_of_a_deployment_by_day_by_length_and_the_longest(tmp_path):
    # 1 Sep: a sequence of 3 images and a single one; 3 Sep: a sequence of 12
    stamps = [datetime(2024, 9, 1, 8, 0, s) for s in (0, 10, 20)] + [datetime(2024, 9, 1, 12)] + [datetime(2024, 9, 3, 9, 0) + timedelta(seconds=s) for s in range(0, 120, 10)]
    metrics = st.deployment_metrics(_revision(tmp_path, "RP", "R0001-A", stamps, collection="R0001"), 60)

    assert metrics["sequences_daily"] == [{"date": "2024-09-01", "sequences": 2}, {"date": "2024-09-02", "sequences": 0}, {"date": "2024-09-03", "sequences": 1}]
    assert metrics["sequence_lengths"] == [[1, 1], [3, 1], [12, 1]]
    assert metrics["longest_sequence"] == {"images": 12, "start": "2024-09-03T09:00:00", "end": "2024-09-03T09:01:50", "seconds": 110.0}


def test_no_images_no_histograms(tmp_path):
    folder = _revision(tmp_path, "RP", "R0001-A", [], collection="R0001")
    metrics = st.deployment_metrics(folder, 60)
    assert metrics["sequences_daily"] == [] and metrics["sequence_lengths"] == [] and metrics["longest_sequence"] is None
