"""Backups of the settings and of a research project, and their restoration (services.backup_service)."""
import json
import zipfile
from pathlib import Path
from unittest.mock import patch

import pytest

from wildintel_uploader.core import config
from wildintel_uploader.core.services import backup_service, local_folder_service


def _project(root: Path, acronym: str = "DONA") -> Path:
    local_folder_service.write_research_project(root, {"name": "Doñana", "acronym": acronym})
    pdir = root / acronym
    (pdir / "locations.json").write_text(json.dumps([{"location_id": "DONA_01", "status": "active"}, {"location_id": "DONA_02", "status": "archived"}]), encoding="utf-8")
    (pdir / "cameras.json").write_text(json.dumps([{"label": "CAM-1", "camera_id": "BR1", "status": "active"}]), encoding="utf-8")
    (pdir / "sd_cards.json").write_text(json.dumps([{"label": "A13", "status": "active"}]), encoding="utf-8")
    (pdir / "visits.json").write_text(json.dumps([
        {"location_id": "DONA_01", "session": "R0001", "date": "2026-06-10", "time": "09:00:00", "when": "2026-06-10T09:00:00Z", "actions": ["Installation"]},
        {"location_id": "DONA_01", "session": "R0002", "date": "2026-08-05", "time": "09:00:00", "when": "2026-08-05T09:00:00Z", "actions": ["Revision"]},
    ]), encoding="utf-8")
    folder = pdir / "R0001" / "R0001-DONA_01"
    folder.mkdir(parents=True)
    (folder / "deployment.json").write_text(json.dumps({"deployment_id": "R0001-DONA_01"}), encoding="utf-8")
    (folder / "images.json").write_text("{}", encoding="utf-8")
    (folder / "IMG_0001.JPG").write_bytes(b"jpeg-1")
    (folder / "IMG_0002.JPG").write_bytes(b"jpeg-22")
    (pdir / "R0001" / "collection.json").write_text(json.dumps({"name": "R0001"}), encoding="utf-8")
    (pdir / "R0001" / "R0001_FileTimestampLog.csv").write_text("Deployment\n", encoding="utf-8")
    return pdir


def _make(root: Path, dest: Path, **options) -> dict:
    kwargs = dict(settings=False, research_project_id="DONA", project_files=True, visits=True, deployments=["R0001-DONA_01"], images=False, app_version="9.9.9")
    events = list(backup_service.create_backup(root, dest, **{**kwargs, **options}))
    assert events[-1]["type"] == "done"
    return events[-1]


def test_a_project_says_what_can_be_put_in_a_backup(tmp_path: Path):
    _project(tmp_path)

    info = backup_service.describe_project(tmp_path, "DONA")

    assert (info["locations"], info["cameras"], info["sd_cards"], info["visits"]) == (2, 1, 1, 2)
    [collection] = info["collections"]
    [deployment] = collection["deployments"]
    assert collection["name"] == "R0001"
    assert (deployment["id"], deployment["images"], deployment["image_bytes"], deployment["files"]) == ("R0001-DONA_01", 2, len(b"jpeg-1") + len(b"jpeg-22"), 4)


def test_a_backup_holds_what_was_chosen_and_says_so_and_the_images_only_when_asked(tmp_path: Path):
    _project(tmp_path)
    dest = tmp_path / "out"
    dest.mkdir()

    without = _make(tmp_path, dest)
    with zipfile.ZipFile(without["path"]) as zf:
        names = set(zf.namelist())
    assert {"manifest.json", "project/locations.json", "project/visits.json", "deployments/R0001/R0001-DONA_01/deployment.json", "deployments/R0001/collection.json",
            "deployments/R0001/R0001_FileTimestampLog.csv"} <= names
    assert not any(n.endswith(".JPG") for n in names)
    assert without["manifest"]["scope"]["images"] is False and without["manifest"]["secrets_included"] is False
    assert without["manifest"]["counts"] == {"locations": 2, "cameras": 1, "sd_cards": 1, "visits": 2} and without["manifest"]["app_version"] == "9.9.9"

    with_images = _make(tmp_path, dest, images=True)
    with zipfile.ZipFile(with_images["path"]) as zf:
        assert "deployments/R0001/R0001-DONA_01/IMG_0001.JPG" in zf.namelist()
    assert with_images["bytes"] > without["bytes"]


def test_the_settings_go_with_no_passwords_nor_the_folders_of_this_computer(tmp_path: Path):
    settings = config.Settings()
    settings.TRAPPER.user_password = "trapper-secret"
    settings.TRAPPER.user_name = "ana@x.org"
    settings.EPICOLLECT5.client_secret = "epi-secret"
    settings.AGOUTI.api_key = "agouti-key"
    settings.DATA.dir = "/home/me/data"
    dest = tmp_path / "out"
    dest.mkdir()

    with patch.object(config, "load_settings", return_value=settings):
        done = _make(tmp_path, dest, settings=True, research_project_id=None, project_files=False, visits=False, deployments=[])

    with zipfile.ZipFile(done["path"]) as zf:
        text = zf.read("settings.json").decode()
        data = json.loads(text)
    assert "trapper-secret" not in text and "epi-secret" not in text and "agouti-key" not in text and "/home/me/data" not in text
    assert data["TRAPPER"]["user_name"] == "ana@x.org" and data["TRAPPER"]["user_password"] is None and "DATA" not in data
    assert done["manifest"]["scope"]["research_project"] is None


def test_a_backup_of_nothing_is_refused(tmp_path: Path):
    _project(tmp_path)
    with pytest.raises(backup_service.BackupError, match="Nothing was chosen"):
        list(backup_service.create_backup(tmp_path, tmp_path, settings=False, research_project_id="DONA", project_files=False, visits=False, deployments=[], images=False, app_version="1"))
    with pytest.raises(backup_service.BackupError, match="is not there"):
        list(backup_service.create_backup(tmp_path, tmp_path / "nowhere", settings=True, research_project_id=None, project_files=False, visits=False, deployments=[], images=False, app_version="1"))


def test_a_backup_says_what_it_holds_and_what_of_it_is_already_here(tmp_path: Path):
    _project(tmp_path)
    dest = tmp_path / "out"
    dest.mkdir()
    done = _make(tmp_path, dest, images=True)

    read = backup_service.read_backup(tmp_path, Path(done["path"]))
    assert read["manifest"]["scope"]["research_project"] == "DONA" and read["has_images"] == {"R0001-DONA_01": True}
    assert read["here"] == {"project": True, "deployments": {"R0001-DONA_01": True}, "visits": {"in_backup": 2, "already": 2}}

    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    assert backup_service.read_backup(elsewhere, Path(done["path"]))["here"] == {"project": False, "deployments": {"R0001-DONA_01": False}, "visits": {"in_backup": 2, "already": 0}}


def test_a_file_that_is_not_a_backup_is_refused(tmp_path: Path):
    plain = tmp_path / "plain.zip"
    with zipfile.ZipFile(plain, "w") as zf:
        zf.writestr("notes.txt", "hello")
    with pytest.raises(backup_service.BackupError, match="no manifest"):
        backup_service.read_backup(tmp_path, plain)
    text = tmp_path / "text.zip"
    text.write_text("not a zip")
    with pytest.raises(backup_service.BackupError, match="not a .zip"):
        backup_service.read_backup(tmp_path, text)
    newer = tmp_path / "newer.zip"
    with zipfile.ZipFile(newer, "w") as zf:
        zf.writestr("manifest.json", json.dumps({"format": backup_service.FORMAT, "version": 99, "scope": {}}))
    with pytest.raises(backup_service.BackupError, match="newer version"):
        backup_service.read_backup(tmp_path, newer)


def test_a_backup_with_a_path_that_leaves_it_is_not_restored(tmp_path: Path):
    evil = tmp_path / "evil.zip"
    with zipfile.ZipFile(evil, "w") as zf:
        zf.writestr("manifest.json", json.dumps({"format": backup_service.FORMAT, "version": 1, "scope": {}}))
        zf.writestr("../outside.txt", "x")
    with pytest.raises(backup_service.BackupError, match="goes out of it"):
        backup_service.read_backup(tmp_path, evil)


def _restore(root: Path, path: str, **options) -> dict:
    kwargs = dict(settings=False, project_files=True, visits=True, deployments=["R0001-DONA_01"], images=True, replace=False)
    events = list(backup_service.restore_backup(root, Path(path), **{**kwargs, **options}))
    assert events[-1]["type"] == "done"
    return events[-1]["summary"]


def test_a_backup_restores_into_a_folder_where_nothing_is(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    _project(source)
    dest = tmp_path / "out"
    dest.mkdir()
    done = _make(source, dest, images=True)
    target = tmp_path / "target"
    target.mkdir()

    summary = _restore(target, done["path"])

    pdir = target / "DONA"
    assert (pdir / "research_project.json").is_file()
    assert summary["project_files"]["locations"] == {"added": 2, "replaced": 0, "kept": 0} and summary["visits"] == {"added": 2, "replaced": 0, "kept": 0}
    assert summary["deployments"] == {"restored": ["R0001-DONA_01"], "skipped": []}
    assert (pdir / "R0001" / "R0001-DONA_01" / "IMG_0001.JPG").read_bytes() == b"jpeg-1"
    assert (pdir / "R0001" / "collection.json").is_file() and (pdir / "R0001" / "R0001_FileTimestampLog.csv").is_file()
    assert len(json.loads((pdir / "visits.json").read_text(encoding="utf-8"))) == 2


def test_the_history_of_the_status_goes_in_the_backup_and_comes_back_without_repeating_what_is_there(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    pdir = _project(source)
    lines = [{"kind": "locations", "name": "DONA_01", "before": None, "after": "active", "at": "2026-06-10T09:00:00Z", "day": "2026-06-10", "reason": "Created."},
             {"kind": "cameras", "name": "CAM-1", "before": "ready", "after": "active", "at": "2026-06-10T09:01:00Z", "day": "2026-06-10", "reason": "The visit R0001 to DONA_01."}]
    (pdir / "status_history.json").write_text(json.dumps(lines), encoding="utf-8")
    dest = tmp_path / "out"
    dest.mkdir()
    done = _make(source, dest)
    target = tmp_path / "target"
    target.mkdir()

    first = _restore(target, done["path"])
    again = _restore(target, done["path"])

    assert "project/status_history.json" in zipfile.ZipFile(done["path"]).namelist()
    assert first["project_files"]["status_history"] == {"added": 2, "replaced": 0, "kept": 0}
    assert again["project_files"]["status_history"] == {"added": 0, "replaced": 0, "kept": 2}
    assert json.loads((target / "DONA" / "status_history.json").read_text(encoding="utf-8")) == lines


def test_the_images_are_restored_only_when_asked_and_when_the_backup_has_them(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    _project(source)
    dest = tmp_path / "out"
    dest.mkdir()
    done = _make(source, dest, images=True)
    target = tmp_path / "target"
    target.mkdir()

    _restore(target, done["path"], images=False)

    folder = target / "DONA" / "R0001" / "R0001-DONA_01"
    assert (folder / "deployment.json").is_file() and not (folder / "IMG_0001.JPG").exists()


def test_what_is_there_is_not_overwritten_unless_it_is_asked_and_what_is_archived_stays_archived(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    pdir = _project(source)
    dest = tmp_path / "out"
    dest.mkdir()
    done = _make(source, dest, images=True)

    # the same project, a little later: a location changed, one is archived for good, a deployment has other files, a visit was added
    (pdir / "locations.json").write_text(json.dumps([{"location_id": "DONA_01", "status": "archived"}, {"location_id": "DONA_02", "status": "active", "name": "later"}, {"location_id": "DONA_03"}]), encoding="utf-8")
    (pdir / "R0001" / "R0001-DONA_01" / "IMG_0001.JPG").write_bytes(b"changed")
    visits = json.loads((pdir / "visits.json").read_text(encoding="utf-8"))
    (pdir / "visits.json").write_text(json.dumps(visits + [{"location_id": "DONA_03", "session": "R0001", "date": "2026-06-11", "time": "10:00:00", "when": "2026-06-11T10:00:00Z", "actions": ["Installation"]}]), encoding="utf-8")

    kept = _restore(source, done["path"])
    assert kept["project_files"]["locations"] == {"added": 0, "replaced": 0, "kept": 2} and kept["visits"] == {"added": 0, "replaced": 0, "kept": 2}
    assert kept["deployments"]["skipped"] == ["R0001-DONA_01"] and kept["deployments"]["restored"] == []
    assert (pdir / "R0001" / "R0001-DONA_01" / "IMG_0001.JPG").read_bytes() == b"changed"

    replaced = _restore(source, done["path"], replace=True)
    locations = {l["location_id"]: l for l in json.loads((pdir / "locations.json").read_text(encoding="utf-8"))}
    assert locations["DONA_01"]["status"] == "archived"                      # archived in the backup's own copy of it as in what is here: it stays
    assert locations["DONA_02"]["status"] == "archived"                      # what is here was active, the backup says archived: the backup wins
    assert "DONA_03" in locations                                           # what the backup does not have is kept
    assert replaced["project_files"]["locations"]["replaced"] == 1 and replaced["project_files"]["locations"]["kept"] == 1
    assert replaced["deployments"]["restored"] == ["R0001-DONA_01"]
    assert (pdir / "R0001" / "R0001-DONA_01" / "IMG_0001.JPG").read_bytes() == b"jpeg-1"
    assert len(json.loads((pdir / "visits.json").read_text(encoding="utf-8"))) == 3   # the visit made after the backup is not lost


def test_a_project_that_is_not_here_needs_its_data_restored_too(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    _project(source)
    dest = tmp_path / "out"
    dest.mkdir()
    done = _make(source, dest)
    target = tmp_path / "target"
    target.mkdir()

    with pytest.raises(backup_service.BackupError, match="not here: restore its data too"):
        _restore(target, done["path"], project_files=False)


def test_the_settings_are_restored_keeping_the_passwords_and_the_folders_here(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    saved = config.Settings()
    saved.TRAPPER.user_name = "ana@x.org"
    saved.TRAPPER.user_password = "old-secret"
    saved.DATA.dir = "/there"
    dest = tmp_path / "out"
    dest.mkdir()
    with patch.object(config, "load_settings", return_value=saved):
        done = _make(source, dest, settings=True, research_project_id=None, project_files=False, visits=False, deployments=[])

    here = config.Settings()
    here.TRAPPER.user_name = "bob@x.org"
    here.TRAPPER.user_password = "my-secret"
    here.DATA.dir = "/here"
    written = {}
    with patch.object(config, "load_settings", return_value=here), patch.object(config, "save_settings", side_effect=lambda s, *a, **k: written.update(s=s)):
        summary = _restore(source, done["path"], settings=True, project_files=False, visits=False, deployments=[])

    assert summary["settings"] is True
    new = written["s"]
    assert new.TRAPPER.user_name == "ana@x.org"          # what the backup says
    assert new.TRAPPER.user_password == "my-secret"      # the password of this computer stays
    assert new.DATA.dir == "/here"                       # so does its folder
