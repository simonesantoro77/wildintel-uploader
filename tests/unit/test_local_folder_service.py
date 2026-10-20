"""services.local_folder_service — the "Local folder" destination's own
collection/deployment metadata, all on disk, no network."""
import json
from datetime import datetime
from pathlib import Path

import pytest

from wildintel_uploader.core.services import local_folder_service as svc


def test_check_collection_reports_a_missing_folder(tmp_path: Path):
    result = svc.check_collection(tmp_path / "nope")
    assert result == {"exists": False, "name": None}


def test_check_collection_reports_an_existing_folder_without_metadata(tmp_path: Path):
    result = svc.check_collection(tmp_path)
    assert result == {"exists": True, "name": None}


def test_write_collection_metadata_creates_the_folder_and_records_the_name(tmp_path: Path):
    collection = tmp_path / "R0001"
    svc.write_collection_metadata(collection, "Doñana 2024")

    assert collection.is_dir()
    assert svc.check_collection(collection) == {"exists": True, "name": "Doñana 2024"}


def test_write_collection_metadata_keeps_the_existing_name_when_none_is_given(tmp_path: Path):
    svc.write_collection_metadata(tmp_path, "Doñana 2024")
    svc.write_collection_metadata(tmp_path, None)

    assert svc.check_collection(tmp_path)["name"] == "Doñana 2024"


def test_write_and_list_deployment_metadata(tmp_path: Path):
    deployment_dir = tmp_path / "R0001-DONA_01"
    deployment = {"deployment_id": "R0001-DONA_01", "location_id": "DONA_01", "start_date": "2024-09-04T13:10:00"}
    svc.write_deployment_metadata(deployment_dir, deployment)

    assert (deployment_dir / "deployment.json").is_file()
    assert svc.list_deployments(tmp_path) == [deployment]


def test_list_deployments_ignores_folders_without_metadata(tmp_path: Path):
    (tmp_path / "not-a-deployment").mkdir()
    assert svc.list_deployments(tmp_path) == []


def test_list_deployments_of_a_missing_collection_is_empty(tmp_path: Path):
    assert svc.list_deployments(tmp_path / "nope") == []


# ── the collection's FileTimestampLog ───────────────────────────────────────

START = datetime(2024, 9, 4, 13, 10, 0)
END = datetime(2024, 11, 4, 14, 28, 0)


def test_the_log_is_named_after_its_collection(tmp_path: Path):
    assert svc.timestamp_log_path(tmp_path / "R0003").name == "R0003_FileTimestampLog.csv"
    assert svc.timestamp_log_path(tmp_path / "R0003_winter").name == "R0003_winter_FileTimestampLog.csv"


def test_a_deployment_is_added_with_wildintel_tools_header_and_formats(tmp_path: Path):
    collection = tmp_path / "DONA" / "R0003"

    result = svc.upsert_timestamp_log(collection, "R0003-DONA_0007_B", START, END)

    log = collection / "R0003_FileTimestampLog.csv"
    assert result == {"path": str(log), "action": "added", "rows": 1}
    # utf-8 with a BOM, as Excel and wildintel-tools write it; one row per deployment.
    assert log.read_bytes().startswith(b"\xef\xbb\xbf")
    assert log.read_text(encoding="utf-8-sig").splitlines() == [
        "Deployment,StartDate,StartTime,EndDate,EndTime",
        "r0003-dona_0007_b,2024:09:04,13:10:00,2024:11:04,14:28:00",  # in lower case, as Trapper keeps it
    ]


def test_the_collection_folder_is_created_and_named_in_its_metadata(tmp_path: Path):
    collection = tmp_path / "DONA" / "R0003"

    svc.upsert_timestamp_log(collection, "R0003-DONA_01", START, END)

    assert json.loads((collection / "collection.json").read_text())["name"] == "R0003"
    assert svc.check_collection(collection) == {"exists": True, "name": "R0003"}


def test_other_deployments_of_the_collection_keep_their_rows(tmp_path: Path):
    collection = tmp_path / "R0003"
    svc.upsert_timestamp_log(collection, "R0003-DONA_01", START, END)

    result = svc.upsert_timestamp_log(collection, "R0003-DONA_02", datetime(2024, 9, 5, 6, 0, 0), datetime(2024, 11, 5, 18, 0, 0))

    assert result["action"] == "added" and result["rows"] == 2
    assert [r["Deployment"] for r in svc.read_timestamp_log(collection / "R0003_FileTimestampLog.csv")] == ["r0003-dona_01", "r0003-dona_02"]


def test_a_deployment_that_is_there_has_its_row_replaced_not_duplicated(tmp_path: Path):
    collection = tmp_path / "R0003"
    svc.upsert_timestamp_log(collection, "R0003-DONA_01", START, END)

    updated = svc.upsert_timestamp_log(collection, "r0003-dona_01", START, datetime(2024, 12, 1, 8, 0, 0))  # compared ignoring case
    same = svc.upsert_timestamp_log(collection, "r0003-dona_01", START, datetime(2024, 12, 1, 8, 0, 0))

    assert updated["action"] == "updated" and updated["rows"] == 1
    assert same["action"] == "unchanged"
    [row] = svc.read_timestamp_log(collection / "R0003_FileTimestampLog.csv")
    assert row["Deployment"] == "r0003-dona_01" and row["EndDate"] == "2024:12:01"


def test_an_unchanged_log_is_not_rewritten(tmp_path: Path):
    collection = tmp_path / "R0003"
    svc.upsert_timestamp_log(collection, "R0003-DONA_01", START, END)
    log = collection / "R0003_FileTimestampLog.csv"
    before = log.stat().st_mtime_ns

    svc.upsert_timestamp_log(collection, "R0003-DONA_01", START, END)

    assert log.stat().st_mtime_ns == before


def test_a_log_wildintel_tools_wrote_is_read_and_kept(tmp_path: Path):
    collection = tmp_path / "R0001"
    collection.mkdir()
    (collection / "R0001_FileTimestampLog.csv").write_text(
        "Deployment,StartDate,StartTime,EndDate,EndTime\nR0001-DONA_0007_B,2024:09:04,13:10:00,2024:11:04,14:28:00\n\nR0001-DONA_0008_A,2024:09:04,06:00:00,2024:11:04,18:00:00\n",
        encoding="utf-8",
    )

    svc.upsert_timestamp_log(collection, "R0001-DONA_0009_C", START, END)

    rows = svc.read_timestamp_log(collection / "R0001_FileTimestampLog.csv")
    assert [r["Deployment"] for r in rows] == ["R0001-DONA_0007_B", "R0001-DONA_0008_A", "r0001-dona_0009_c"]  # the rows it did not write stay as they were
    assert rows[1]["StartTime"] == "06:00:00"


@pytest.mark.parametrize("content,message", [
    ("", "no header"),
    ("Deployment,StartDate,StartTime\nR0001-X,2024:09:04,13:10:00\n", "missing the columns: EndDate, EndTime"),
    ("Deployment,StartDate,StartDate,EndDate,EndTime\n", "repeats the columns: StartDate"),
])
def test_a_log_that_cannot_be_read_is_refused_and_left_as_it_is(tmp_path: Path, content: str, message: str):
    collection = tmp_path / "R0001"
    collection.mkdir()
    log = collection / "R0001_FileTimestampLog.csv"
    log.write_text(content, encoding="utf-8")

    with pytest.raises(svc.LocalFolderError, match=message):
        svc.upsert_timestamp_log(collection, "R0001-DONA_01", START, END)

    assert log.read_text(encoding="utf-8") == content


def test_a_deployment_cannot_end_before_it_starts(tmp_path: Path):
    with pytest.raises(svc.LocalFolderError, match="must start before it ends"):
        svc.upsert_timestamp_log(tmp_path / "R0003", "R0003-DONA_01", END, START)

    assert not (tmp_path / "R0003").exists()  # nothing was created


def test_a_research_project_in_two_folders_is_listed_once_from_the_one_named_by_its_acronym(tmp_path):
    for folder in ("DONA_24_", "DONA_24", "WICP_01"):  # the first renamed by hand, the second made by a sync
        (tmp_path / folder).mkdir()
        acronym = "WICP_01" if folder == "WICP_01" else "DONA_24"
        (tmp_path / folder / "research_project.json").write_text(json.dumps({"name": acronym, "acronym": acronym, "marker": folder}), encoding="utf-8")

    listed = svc.list_research_projects(tmp_path)

    assert [(p["acronym"], p["marker"]) for p in listed] == [("DONA_24", "DONA_24"), ("WICP_01", "WICP_01")]
