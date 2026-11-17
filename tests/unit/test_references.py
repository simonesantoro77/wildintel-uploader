"""The records point to each other by id, not by what they are called: a visit says which camera, which SD card, which trapper and which location — their ids — and is told with their
names; the names can be corrected and nothing else changes (services.ids, services.local_folder_service)."""
import json
from pathlib import Path
from unittest.mock import patch

import pytest

from wildintel_uploader.core import config
from wildintel_uploader.core.services import backup_service, ids, local_folder_service as svc

VISIT = {"location_id": "dona_01", "session": "R0001", "date": "2026-06-10", "time": "09:00:00", "actions": ["Installation"], "camera_id": "BR1", "sd": "a13",
         "trappers": "Pedro Pérez, Luis", "setup_by": "pedro pérez", "num_photos": None}


@pytest.fixture
def people(tmp_path):
    """The trappers, which the test can change: call it with (username, name) or (username, name, deleted_at) — the ids are `T-<username>`."""
    def keep(*who: tuple) -> None:
        svc.write_trappers(tmp_path, [{"username": p[0], "name": p[1]} for p in who])
        if any(len(p) > 2 for p in who):                         # one that was deleted: it is kept, with when
            kept = svc.list_trappers(tmp_path, include_deleted=True)
            (tmp_path / "trappers.json").write_text(json.dumps([{**t, "deleted_at": next(p[2] for p in who if p[0] == t["username"] and len(p) > 2)} if any(p[0] == t["username"] and len(p) > 2 for p in who) else t for t in kept]), encoding="utf-8")
    keep(("pedro", "Pedro Pérez"))
    return keep


def _tid(tmp_path: Path, username: str) -> str:
    return next(t["id"] for t in svc.list_trappers(tmp_path, include_deleted=True) if t["username"] == username)


def _project(tmp_path: Path) -> None:
    svc.write_research_project(tmp_path, {"name": "Doñana", "acronym": "DONA"})
    svc.write_location(tmp_path, "DONA", {"location_id": "DONA_01", "latitude": 37.0, "longitude": -6.4, "timezone": "Europe/Madrid", "ignore_dst": False})
    svc.write_field_items(tmp_path, "DONA", "cameras", [{"label": "CAM-1", "camera_id": "BR1"}])
    svc.write_field_items(tmp_path, "DONA", "sd_cards", [{"label": "A13"}])


def _on_disk(tmp_path: Path, name: str = "visits.json"):
    return json.loads((tmp_path / "DONA" / name).read_text(encoding="utf-8"))


def test_a_visit_is_kept_pointing_to_its_location_its_camera_its_card_and_its_trappers_by_id_and_told_with_their_names(tmp_path: Path, people):
    _project(tmp_path)
    told = svc.write_visit(tmp_path, "DONA", VISIT)

    raw = _on_disk(tmp_path)[0]
    place, camera, card = (svc.list_locations(tmp_path, "DONA")[0], svc.list_field_items(tmp_path, "DONA", "cameras")[0], svc.list_field_items(tmp_path, "DONA", "sd_cards")[0])
    assert raw["location_ref"] == place["id"] and raw["camera_ref"] == camera["id"] and raw["sd_ref"] == card["id"]
    assert raw["trapper_refs"] == [_tid(tmp_path, "pedro")] and raw["setup_by_ref"] == _tid(tmp_path, "pedro")
    assert raw["trappers"] == "Luis"                                                              # a trapper nobody registered is kept as it was said
    assert not {"location_id", "camera_id", "sd", "setup_by"} & set(raw)                           # what is pointed to is not said again by name
    assert all(len(i) == 36 for i in (place["id"], camera["id"], card["id"], raw["id"]))           # the ids the app generates
    assert (told["location_id"], told["camera_id"], told["sd"], told["trappers"], told["setup_by"]) == ("DONA_01", "BR1", "A13", "Pedro Pérez, Luis", "Pedro Pérez")
    assert "location_ref" not in told and "trapper_refs" not in told                               # the ids are the app's: the page does not see them as references


def test_correcting_what_something_is_called_changes_nothing_else_the_visits_still_point_to_it(tmp_path: Path, people):
    _project(tmp_path)
    svc.write_visit(tmp_path, "DONA", VISIT)
    before = _on_disk(tmp_path)
    card = svc.list_field_items(tmp_path, "DONA", "sd_cards")[0]
    camera = svc.list_field_items(tmp_path, "DONA", "cameras")[0]

    # the card and the camera are corrected — the page says their ids — and the trapper is renamed in the settings
    svc.write_field_items(tmp_path, "DONA", "sd_cards", [{**card, "label": "A-13"}])
    svc.write_field_items(tmp_path, "DONA", "cameras", [{**camera, "label": "CAM-ONE", "camera_id": "BR1-X"}])
    people(("pedro", "Pedro Pérez López"))
    told = svc.list_visits(tmp_path, "DONA")[0]

    assert _on_disk(tmp_path) == before                                                           # the file of the visits was not touched
    assert (told["sd"], told["camera_id"], told["trappers"], told["setup_by"]) == ("A-13", "BR1-X", "Pedro Pérez López, Luis", "Pedro Pérez López")
    assert [c["label"] for c in svc.list_field_items(tmp_path, "DONA", "sd_cards")] == ["A-13"]   # a rename is not a card that was deleted and another one added
    assert svc.list_field_items(tmp_path, "DONA", "sd_cards")[0]["id"] == card["id"]


def test_what_a_visit_says_and_the_research_project_does_not_have_yet_is_kept_as_it_was_said_and_linked_when_it_is_there(tmp_path: Path, people):
    _project(tmp_path)
    svc.write_visit(tmp_path, "DONA", {**VISIT, "camera_id": "NEW-9", "sd": "Z99"})
    raw = _on_disk(tmp_path)[0]
    assert raw["camera_id"] == "NEW-9" and raw["sd"] == "Z99" and "camera_ref" not in raw and "sd_ref" not in raw

    svc.write_field_items(tmp_path, "DONA", "cameras", [*svc.list_field_items(tmp_path, "DONA", "cameras"), {"label": "NEW-9"}])
    told = svc.list_visits(tmp_path, "DONA")[0]                                                  # read again: it is the camera now
    raw = _on_disk(tmp_path)[0]
    assert raw["camera_ref"] == svc.list_field_items(tmp_path, "DONA", "cameras")[1]["id"] and "camera_id" not in raw
    assert told["camera_id"] == "NEW-9" and told["sd"] == "Z99"                                   # the card is still the one it said


def test_a_location_a_card_or_a_trapper_that_was_deleted_is_still_the_one_a_visit_points_to(tmp_path: Path, people):
    _project(tmp_path)
    svc.write_visit(tmp_path, "DONA", VISIT)
    svc.write_field_items(tmp_path, "DONA", "sd_cards", [])                                      # the card is deleted — logically
    people(("pedro", "Pedro Pérez", "2026-11-02T10:00:00Z"))                          # and so is the trapper: it stays in the settings, with its deleted_at
    told = svc.list_visits(tmp_path, "DONA")[0]
    assert told["sd"] == "A13" and told["trappers"] == "Pedro Pérez, Luis" and told["setup_by"] == "Pedro Pérez"


def test_what_was_kept_before_the_ids_existed_gets_them_when_it_is_read_and_its_visits_are_linked_and_written_so(tmp_path: Path, people):
    svc.write_research_project(tmp_path, {"name": "Doñana", "acronym": "DONA"})
    pdir = tmp_path / "DONA"
    (pdir / "locations.json").write_text(json.dumps([{"location_id": "DONA_01", "timezone": "UTC", "ignore_dst": False, "latitude": 1, "longitude": 1}]), encoding="utf-8")
    (pdir / "cameras.json").write_text(json.dumps([{"label": "CAM-1", "camera_id": "BR1"}]), encoding="utf-8")
    (pdir / "sd_cards.json").write_text(json.dumps([{"label": "A13"}]), encoding="utf-8")
    (pdir / "visits.json").write_text(json.dumps([{"location_id": "DONA_01", "session": "R0001", "when": "2026-06-10T09:00:00Z", "actions": ["Installation"], "camera_id": "BR1", "sd": "A13",
                                                  "trappers": "Pedro Pérez"}]), encoding="utf-8")

    told = svc.list_visits(tmp_path, "DONA")[0]

    assert (told["location_id"], told["camera_id"], told["sd"], told["trappers"]) == ("DONA_01", "BR1", "A13", "Pedro Pérez")
    assert svc.list_field_items(tmp_path, "DONA", "sd_cards")[0]["id"] == ids.legacy_id("sd_cards", "A13", "DONA")   # the same one wherever it is read
    assert "id" not in _on_disk(tmp_path, "sd_cards.json")[0]                                                  # reading the cards wrote nothing: it is kept with the next write
    svc.write_field_items(tmp_path, "DONA", "sd_cards", [{"label": "A13", "brand": "SanDisk"}])
    assert _on_disk(tmp_path, "sd_cards.json")[0]["id"] == ids.legacy_id("sd_cards", "A13", "DONA")           # and is the same one when it is written
    raw = _on_disk(tmp_path)[0]
    assert raw["sd_ref"] == ids.legacy_id("sd_cards", "A13", "DONA") and raw["trapper_refs"] == [_tid(tmp_path, "pedro")] and raw["id"] and "sd" not in raw
    assert svc.list_visits(tmp_path, "DONA") == [told] and _on_disk(tmp_path)[0] == raw         # and it is stable: reading again changes nothing


def test_the_unknown_visits_and_the_roles_point_to_their_location_and_their_trapper_by_id_too(tmp_path: Path, people):
    _project(tmp_path)
    svc.write_unknown(tmp_path, "DONA", [{"location_id": "DONA_01", "session": "R0001"}])
    assert _on_disk(tmp_path, "unknown_visits.json") == [{"location_ref": svc.list_locations(tmp_path, "DONA")[0]["id"], "session": "R0001"}]
    assert svc.list_unknown(tmp_path, "DONA") == [{"location_id": "DONA_01", "session": "R0001"}]

    svc.write_roles(tmp_path, "DONA", [{"research_project": "DONA", "trapper": "Pedro Pérez", "role": "contact"}])
    assert _on_disk(tmp_path, "roles.json")[0]["trapper_ref"] == _tid(tmp_path, "pedro") and "trapper" not in _on_disk(tmp_path, "roles.json")[0]
    people(("pedro", "Pedro Pérez López"))
    assert [r["trapper"] for r in svc.list_roles(tmp_path, "DONA")] == ["Pedro Pérez López"]       # renamed, and it is still him who has the role


def test_a_backup_says_things_by_what_they_are_called_so_it_is_restored_where_the_ids_are_others(tmp_path: Path, people):
    here, there, dest = tmp_path / "here", tmp_path / "there", tmp_path / "dest"
    for folder in (here, there, dest):
        folder.mkdir()
    _project(here)
    svc.write_visit(here, "DONA", VISIT)
    events = list(backup_service.create_backup(here, dest, settings=False, research_project_id="DONA", project_files=True, visits=True, deployments=[], images=False, app_version="1"))
    zip_path = Path(events[-1]["path"])

    # another computer: the same research project, its card and its camera made there — with ids of their own
    _project(there)
    other_card = svc.list_field_items(there, "DONA", "sd_cards")[0]["id"]
    list(backup_service.restore_backup(there, zip_path, settings=False, project_files=False, visits=True, deployments=[], images=False, replace=False))

    raw = _on_disk(there)[0]
    assert raw["sd_ref"] == other_card                                                          # it points to the card of *this* computer
    assert svc.list_visits(there, "DONA")[0]["sd"] == "A13"


def test_the_trappers_an_earlier_version_kept_in_the_settings_go_beside_the_projects_the_first_time_they_are_asked_for(tmp_path: Path):
    config.DEFAULT_CONFIG_FILE.unlink(missing_ok=True)
    settings = config.load_settings()
    settings.FIELDWORK.trappers = [config.Trapper(username="ana", name="Ana", affiliation="CSIC", id=ids.legacy_id("trapper", "ana"))]
    config.save_settings(settings)

    assert [(t["username"], t["name"], t["id"]) for t in svc.list_trappers(tmp_path)] == [("ana", "Ana", ids.legacy_id("trapper", "ana"))]
    assert json.loads((tmp_path / "trappers.json").read_text(encoding="utf-8"))[0]["affiliation"] == "CSIC"
    assert config.load_settings().FIELDWORK.trappers == []                                          # and they are not in the settings any more
    config.DEFAULT_CONFIG_FILE.unlink(missing_ok=True)


def test_the_people_go_in_the_backup_of_the_settings_by_what_they_are_called_and_are_restored_without_being_repeated(tmp_path: Path):
    config.DEFAULT_CONFIG_FILE.unlink(missing_ok=True)
    here, there, dest = tmp_path / "here", tmp_path / "there", tmp_path / "dest"
    for folder in (here, there, dest):
        folder.mkdir()
    svc.write_trappers(here, [{"username": "ana", "name": "Ana"}, {"username": "luis", "name": "Luis"}])
    with patch.object(config, "collections_dir", lambda *a, **k: here):
        events = list(backup_service.create_backup(here, dest, settings=True, research_project_id=None, project_files=False, visits=False, deployments=[], images=False, app_version="1"))
    zip_path = Path(events[-1]["path"])

    svc.write_trappers(there, [{"username": "ana", "name": "Ana Pérez"}])                         # another computer: it has Ana, with her name written otherwise
    list(backup_service.restore_backup(there, zip_path, settings=True, project_files=False, visits=False, deployments=[], images=False, replace=False))

    kept = {t["username"]: t["name"] for t in svc.list_trappers(there)}
    assert kept == {"ana": "Ana Pérez", "luis": "Luis"}                                           # Luis was added; Ana, already there, stays as she was
    config.DEFAULT_CONFIG_FILE.unlink(missing_ok=True)


def test_the_status_of_the_camera_kept_as_status_before_is_read_and_written_as_camera_status(tmp_path: Path, people):
    svc.write_research_project(tmp_path, {"name": "Doñana", "acronym": "DONA"})
    (tmp_path / "DONA" / "visits.json").write_text(json.dumps([{"location_id": "DONA_01", "session": "R0001", "when": "2026-06-10T09:00:00Z", "actions": ["Installation"], "status": "OK"}]), encoding="utf-8")

    told = svc.list_visits(tmp_path, "DONA")[0]

    assert told["camera_status"] == "OK" and "status" not in told
    assert _on_disk(tmp_path)[0]["camera_status"] == "OK" and "status" not in _on_disk(tmp_path)[0]


def test_the_status_of_the_camera_is_one_of_a_few_values_written_as_they_are_and_refused_otherwise():
    from pydantic import ValidationError
    from wildintel_uploader.core.schemas.requests import VisitRecord

    base = {"location_id": "DONA_01", "session": "R0001", "date": "2026-06-10", "time": "09:00:00", "actions": ["Revision"]}
    assert [VisitRecord(**base, camera_status=s).camera_status for s in ("ok", "knocked  down", "Altered", "damaged", "", None)] == ["OK", "Knocked down", "Altered", "Damaged", None, None]
    stolen = {**base, "actions": ["Stolen"]}
    assert [VisitRecord(**stolen, camera_status=s).camera_status for s in ("STOLEN", "", None)] == ["Stolen", "Stolen", "Stolen"]   # the status of a camera found stolen is Stolen, said or not
    for wrong in (dict(**stolen, camera_status="OK"), dict(**base, camera_status="Stolen")):                  # and only there
        with pytest.raises(ValidationError):
            VisitRecord(**wrong)
    assert VisitRecord(**{**base, "actions": []}, camera_status="No revisada").camera_status == "Not revised"
    with pytest.raises(ValidationError):
        VisitRecord(**base, camera_status="Working")


def test_the_batteries_and_the_card_are_two_fields_and_a_visit_kept_with_one_is_moved(tmp_path: Path, people):
    from wildintel_uploader.core.schemas.requests import VisitRecord

    base = {"location_id": "DONA_01", "session": "R0001", "date": "2026-06-10", "time": "09:00:00", "actions": ["Revision"]}
    assert [(v.battery_status, v.card_status) for v in (VisitRecord(**base, card_batteries_ok=c) for c in ("OK", "CarFull", "NoBatteries", "CarFullNoBatteries", "CarFullSinPilas"))] == [
        ("OK", "OK"), ("OK", "CardFull"), ("NoBatteries", "OK"), ("NoBatteries", "CardFull"), ("NoBatteries", "CardFull")]
    assert (VisitRecord(**base, battery_status="no batteries", card_status="card full").battery_status, VisitRecord(**base, card_status="CarFull").card_status) == ("NoBatteries", "CardFull")

    svc.write_research_project(tmp_path, {"name": "Doñana", "acronym": "DONA"})
    (tmp_path / "DONA" / "visits.json").write_text(json.dumps([{"location_id": "DONA_01", "session": "R0001", "when": "2026-06-10T09:00:00Z", "actions": ["Revision"], "card_batteries_ok": "CarFullNoBatteries"}]), encoding="utf-8")
    told = svc.list_visits(tmp_path, "DONA")[0]
    assert (told["battery_status"], told["card_status"]) == ("NoBatteries", "CardFull") and "card_batteries_ok" not in told
    assert "card_batteries_ok" not in _on_disk(tmp_path)[0] and _on_disk(tmp_path)[0]["card_status"] == "CardFull"
