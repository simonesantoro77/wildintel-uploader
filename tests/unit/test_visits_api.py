"""/api/visits — the visits to the camera traps of a research project, kept in the collections folder (a temp folder)."""
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from wildintel_uploader.core.config import load_settings as _real_load_settings  # noqa: E402

PROJECT = {"name": "Doñana", "acronym": "DONA"}
VISIT = {"location_id": "DONA_01", "session": "R0013", "date": "2026-10-02", "time": "08:14:05", "actions": ["Revision"], "camera_id": "12", "num_photos": 1620, "trappers": "Ana, Luis", "setup_by": "Ana", "comments": "pilas cambiadas"}


@pytest.fixture(autouse=True)
def reports(tmp_path_factory, monkeypatch) -> Path:
    """The reports an import leaves go to a folder of the test, never to the one of the user."""
    from wildintel_uploader.core import config
    folder = tmp_path_factory.mktemp("reports")
    monkeypatch.setattr(config, "reports_dir", lambda settings=None: folder)
    return folder


@pytest.fixture(autouse=True)
def entities_unchecked(request, monkeypatch):
    """Most tests save visits of cameras, cards and trappers that nobody registered: the check that they exist is off, except in the tests marked `entities`.
    Every visit of a file needs its coordinates, so the rows of the samples that do not give them get these, as a default."""
    from wildintel_uploader.core.services import visit_rules, visits_csv
    from wildintel_uploader.web.api.routers import visits as router
    real = visits_csv.parse_visits
    entities = request.node.get_closest_marker("entities")
    if not request.node.get_closest_marker("gps"):
        monkeypatch.setattr(visit_rules, "GPS_TOLERANCE_M", 10**9)      # the default coordinates are not those of the sites: only the tests marked `gps` check the distance

    def parse(*a, **k):
        options = dict(a[4] if len(a) > 4 and a[4] else {})
        options["defaults"] = {"latitude": "37.0", "longitude": "-6.4", **(options.get("defaults") or {})}
        if not entities:
            options["check_entities"] = False
        return real(*a[:4], options)

    if not entities:
        monkeypatch.setattr(router, "_not_entities", lambda *a, **k: [])
    monkeypatch.setattr(router.visits_csv, "parse_visits", parse)


def _client() -> TestClient:
    from wildintel_uploader.web.main import app
    return TestClient(app)


def _settings():
    """The settings as they were, with the trappers Ana and Luis."""
    from wildintel_uploader.core import config
    settings = _real_load_settings()
    settings.FIELDWORK.trappers = [config.Trapper(username="ana", name="Ana"), config.Trapper(username="luis", name="Luis")]
    return settings


@contextmanager
def _in(tmp_path: Path):
    from contextlib import ExitStack
    from unittest.mock import Mock

    from wildintel_uploader.core import config
    with ExitStack() as stack:
        stack.enter_context(patch("wildintel_uploader.web.api.routers.deployment_import.config.collections_dir", return_value=tmp_path))
        stack.enter_context(patch("wildintel_uploader.web.api.routers.visits.config.collections_dir", return_value=tmp_path))
        if not isinstance(config.load_settings, Mock):   # a test that gives its own settings keeps them
            stack.enter_context(patch("wildintel_uploader.web.api.routers.visits.config.load_settings", side_effect=_settings))
        yield


def _project(archived: tuple[int, ...] = ()) -> None:
    """The research project, with the locations the tests visit — the numbers `archived` out of use, so that no revision waits for them."""
    _client().post("/api/deployment-import/research-projects/save", json=PROJECT)
    for n in (1, 2, 3):
        _client().post("/api/deployment-import/locations/save", json={"research_project_id": "DONA", "location": {"location_id": f"DONA_0{n}", "name": f"Site {n}", "timezone": "UTC", "ignore_dst": False, "latitude": 37.0 + n / 100, "longitude": -6.5, "status": "archived" if n in archived else "active"}})


def _installed(sites: tuple[int, ...] = (1, 2, 3)) -> None:
    """The first visit of the sites the tests visit: it can only be an Installation."""
    for n in sites:
        install = {**VISIT, "location_id": f"DONA_0{n}", "session": "R0012", "date": "2026-01-10", "actions": ["Installation"], "num_photos": None, "sd": f"S{n}", "camera_id": "12" if n == 1 else f"C{n}"}
        assert _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": install}).status_code == 200


def test_visits_are_registered_and_listed_with_those_to_one_location_apart(tmp_path: Path):
    with _in(tmp_path):
        _project()
        empty = _client().post("/api/visits/list", json={"research_project_id": "DONA"})
        _installed()
        saved = _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": VISIT})
        _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": {**VISIT, "location_id": "DONA_02", "camera_id": "C2"}})
        everything = _client().post("/api/visits/list", json={"research_project_id": "DONA"}).json()["results"]
        one = _client().post("/api/visits/list", json={"research_project_id": "DONA", "location_id": "dona_01"}).json()["results"]

    assert empty.json() == {"results": []}
    assert saved.status_code == 200 and saved.json()["date"] == "2026-10-02" and saved.json()["time"] == "08:14:05"
    assert len(everything) == 5
    assert [v["location_id"] for v in one] == ["DONA_01", "DONA_01"]


def test_how_the_card_and_the_batteries_were_is_one_of_the_codes_of_the_datasheet(tmp_path: Path):
    with _in(tmp_path):
        _project(archived=(2, 3))   # no revision waits for the other sites
        _installed((1,))
        for hour, code in enumerate(("OK", "CarFull", "NoBatteries", "CarFullNoBatteries", "SinPilas")):
            visit = {**VISIT, "session": f"R{13 + hour:04d}", "time": f"0{hour}:00:00", "card_batteries_ok": code, **({"num_photos": None} if "Full" in code else {})}
            assert _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": visit}).status_code == 200
        bad = _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": {**VISIT, "card_batteries_ok": "Yes"}})

    assert bad.status_code == 422


def test_a_visit_that_is_not_one_is_refused(tmp_path: Path):
    with _in(tmp_path):
        _project()
        bad_session = _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": {**VISIT, "session": "trip 3"}})
        bad_action = _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": {**VISIT, "actions": ["Dance"]}})
        bad_latitude = _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": {**VISIT, "latitude": 91, "longitude": 3}})

    no_action = _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": {**VISIT, "actions": []}})

    assert bad_session.status_code == bad_action.status_code == bad_latitude.status_code == no_action.status_code == 422


def test_a_visit_can_do_several_things_each_kept_once(tmp_path: Path):
    with _in(tmp_path):
        _project()
        _installed()
        saved = _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": {**VISIT, "actions": ["Revision", "Desinstallation", "Revision"]}})

    assert saved.status_code == 200 and saved.json()["actions"] == ["Revision", "Desinstallation"]


def test_the_optional_details_of_a_deployment_are_kept_with_the_visit(tmp_path: Path):
    details = {"camera_model": "Reconyx-PC800", "camera_height": 1.2, "camera_tilt": -90, "bait_use": True, "feature_type": "trailHiking", "tags": ["forest edge"]}
    with _in(tmp_path):
        _project()
        _installed()
        saved = _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": {**VISIT, **details}})
        both = _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": {**VISIT, "camera_height": 1.2, "camera_depth": 4.8}})
        bad_feature = _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": {**VISIT, "feature_type": "moon"}})

    assert saved.status_code == 200 and saved.json() | details == saved.json()
    assert both.status_code == bad_feature.status_code == 422


def test_whether_the_camera_was_calibrated_is_kept_with_the_visit(tmp_path: Path):
    with _in(tmp_path):
        _project(archived=(2, 3))   # no revision waits for the other sites
        _installed((1,))
        calibrated = _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": {**VISIT, "calibration": True}})
        silent = _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": {**VISIT, "session": "R0014", "time": "09:00:00"}})

    assert calibrated.status_code == 200 and calibrated.json()["calibration"] is True
    assert silent.status_code == 200 and silent.json()["calibration"] is None


def test_a_visit_to_a_research_project_that_is_not_kept_is_refused(tmp_path: Path):
    with _in(tmp_path):
        response = _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": VISIT})

    assert response.status_code == 400


CSV = (
    "location_id,date,time,actions,trappers,card_batteries_ok,num_photos,sd,camera_id,comments\n"
    "DONA_01,2026-10-02,08:14:05,Installation,Ana,OK,,A13,P800,new camera\n"
    "dona_01,2026-11-05,09:00,Revision + Installation,Ana; Luis,OK,1620,B2,P800,\n"
    "DONA_02,2026-10-03,10:00:00,Installation,,OK,,A14,X1,\n"
)


AUTO = object()  # the mapping the page starts from: the columns found by their names


def _import(tmp_path: Path, text: str, save: bool = False, fmt: str = "mapped", mapping=AUTO, given_up: str = "2026-10-03", **location):
    with _in(tmp_path):
        _client().post("/api/deployment-import/research-projects/save", json=PROJECT)
        # DONA_0001 is only there to be mistaken for DONA_01 (given up on 2026-09-30), and DONA_02 is a site given up on `given_up` (the day of its only visit): no revision that starts after it waits for it
        archived = {"DONA_0001": {"status": "archived", "status_date": min(given_up, "2026-09-30")}, "DONA_02": {"status": "archived", "status_date": given_up}}
        for site, lat in (("DONA_01", 37.1), ("DONA_02", 37.2), ("DONA_0001", 37.1)):
            _client().post("/api/deployment-import/locations/save", json={"research_project_id": "DONA", "location": {"location_id": site, "timezone": "UTC", "ignore_dst": False, "latitude": lat, "longitude": -6.4, **location, **archived.get(site, {})}})
        if mapping is AUTO:
            mapping = _client().post("/api/visits/csv-columns", json={"csv": text}).json().get("mapping") if fmt == "mapped" else None
        return _client().post("/api/visits/import-csv", json={"research_project_id": "DONA", "csv": text, "save": save, "format": fmt, "mapping": mapping})


def test_visits_are_read_from_a_csv_and_only_kept_when_asked(tmp_path: Path):
    shown = _import(tmp_path, CSV)
    with _in(tmp_path):
        nothing = _client().post("/api/visits/list", json={"research_project_id": "DONA"}).json()["results"]

    body = shown.json()
    assert shown.status_code == 200 and body["saved"] is None and nothing == []
    assert body["problems"] == [] and body["skipped"] == 0
    first, third, second = body["visits"]  # by the day of the visit
    assert (first["location_id"], first["session"], first["actions"], first["latitude"]) == ("DONA_01", "R0001", ["Installation"], 37.0)
    assert (second["session"], second["actions"], second["card_status"], second["num_photos"], second["time"]) == ("R0002", ["Revision", "Installation"], "OK", 1620, "09:00:00")
    assert (third["location_id"], third["session"], third["actions"], third["latitude"]) == ("DONA_02", "R0001", ["Installation"], 37.0)   # the default of the sample: its rows give no coordinates


def test_the_visits_of_a_csv_are_added_to_the_ones_kept_without_repeating_any(tmp_path: Path):
    _import(tmp_path, CSV, save=True)
    again = _import(tmp_path, CSV + "DONA_01,2026-12-01,08:00,Desinstallation,,,100,,P800,\n", save=True).json()
    with _in(tmp_path):
        kept = _client().post("/api/visits/list", json={"research_project_id": "DONA", "location_id": "DONA_01"}).json()["results"]

    assert again["skipped"] == 3 and again["saved"] == 1
    assert [v["session"] for v in kept] == ["R0001", "R0002", "R0003"]


def test_the_rows_that_are_not_visits_are_told_apart_from_those_that_are(tmp_path: Path):
    text = "location_id;date;time;actions;num_photos;camera_id;sd\nNOWHERE;2026-10-02;08:00;Revision;1;;\nDONA_01;2026-10-02;08:00;Dance;1;;\nDONA_01;2026/10/02;08:00;Revision;1;;\nDONA_01;2026-10-02;08:00;Revision;many;;\nDONA_01;02/10/2026;08:00;Installation;7;C1;1\n"
    body = _import(tmp_path, text).json()

    assert [p["row"] for p in body["problems"]] == [3, 4, 5]
    assert "Dance" in body["problems"][0]["message"]
    assert [v["num_photos"] for v in body["visits"]] == [7]
    # a site that is not a location is no problem of the row: it is held, to be added or corrected
    assert [s["site"] for s in body["new_sites"]] == ["NOWHERE"]


def test_a_csv_without_the_columns_of_a_visit_is_refused(tmp_path: Path):
    bad = _import(tmp_path, "name,colour\nA,red\n")
    empty = _import(tmp_path, "")

    assert bad.status_code == empty.status_code == 400 and "no column for" in bad.json()["detail"]


def test_what_a_visit_has_of_a_deployment_is_read_too(tmp_path: Path):
    text = (
        "location_id,session,date,time,actions,trappers,status,card_batteries_ok,num_photos,sd,date_time_ok,camera_id,comments,longitude,latitude,"
        "camera_model,camera_interval,camera_height,camera_tilt,camera_heading,detection_distance,timestamp_issues,bait_use,feature_type,habitat,deployment_groups,tags\n"
        "DONA_01,13,2026-10-02,08:14,Revision,Ana,OK,SinPilas,1620,A13,Yes,P800,pilas cambiadas,-6.4,37.1,"
        "Reconyx-PC800,120,1.2,-90,45,9.5,no,yes,trailHiking,forest,north,forest edge|oak\n"
    )
    visit = _import(tmp_path, text).json()["visits"][0]

    assert (visit["session"], visit["actions"], visit["battery_status"], visit["num_photos"], visit["date_time_ok"], visit["comments"]) == ("R0013", ["Revision"], "NoBatteries", 1620, "Yes", "pilas cambiadas")
    assert (visit["longitude"], visit["latitude"]) == (-6.4, 37.1)
    assert (visit["camera_model"], visit["camera_interval"], visit["camera_height"], visit["camera_tilt"], visit["camera_heading"], visit["detection_distance"]) == ("Reconyx-PC800", 120, 1.2, -90, 45, 9.5)
    assert (visit["timestamp_issues"], visit["bait_use"], visit["feature_type"], visit["habitat"], visit["deployment_groups"], visit["tags"]) == (False, True, "trailHiking", "forest", "north", ["forest edge", "oak"])


def test_the_dates_may_be_written_day_first(tmp_path: Path):
    body = _import(tmp_path, "location_id,date,time,actions,camera_id,sd\nDONA_01,02/10/2026,08:00,Installation,C1,1\n").json()

    assert body["problems"] == [] and body["visits"][0]["date"] == "2026-10-02"


EPICOLLECT = (
    "ec5_uuid,created_at,1_Responsable,2_Collection,3_Date,4_Location,5_Camera,6_Action,7_Status_of_the_came,8_Card_Batteries,9_Number_of_pictures,10_SD,11_Date_and_hour,12_Observation,lat_13_Coordenates,long_13_Coordenates,14_Hour\n"
    "a1,2026-09-04T10:16:31.000Z,Ana,13,04/09/2026,DONA_01,5,Revision,OK,OK,1620,A13,Yes,all well,37.2,-6.5,12:16\n"
    "a2,2026-09-04T11:00:00.000Z,Ana,13,04/09/2026,DONA_02,7,Installation,,,,B2,Yes,,,,\n"
)


def test_the_time_of_an_entry_is_put_in_the_timezone_of_its_location(tmp_path: Path):
    summer = _import(tmp_path, EPICOLLECT, timezone="Europe/Madrid").json()["visits"][0]
    standard = _import(tmp_path / "b", EPICOLLECT, timezone="Europe/Madrid", ignore_dst=True).json()["visits"][0]

    assert summer["time"] == "12:16:31"
    assert standard["time"] == "11:16:31"


MAPPED = (
    "Lugar;Dia;Hora;Tarea;Quien;Fotos;Tarjeta;Camara;Ruido\n"
    "DONA_01;02/10/2026;08:14;Installation;Ana;;A13;C1;x\n"
    "DONA_02;03/10/2026;09:30:15;Installation;Ana & Luis;1620;B2;C2;y\n"
)
MAPPING = {"location_id": "Lugar", "date": "Dia", "time": "Hora", "actions": "Tarea", "trappers": "Quien", "num_photos": "Fotos", "sd": "Tarjeta", "camera_id": "Camara"}


def test_a_csv_with_columns_of_its_own_is_read_with_the_columns_each_field_is_mapped_to(tmp_path: Path):
    body = _import(tmp_path, MAPPED, mapping=MAPPING).json()

    assert body["problems"] == []
    first, second = body["visits"]
    assert (first["location_id"], first["date"], first["time"], first["actions"], first["trappers"], first["sd"], first["num_photos"]) == ("DONA_01", "2026-10-02", "08:14:00", ["Installation"], "Ana", "A13", None)
    assert (second["location_id"], second["date"], second["actions"], second["num_photos"]) == ("DONA_02", "2026-10-03", ["Installation"], 1620)


def test_a_mapping_that_leaves_out_what_a_visit_needs_is_refused(tmp_path: Path):
    no_actions = _import(tmp_path, MAPPED, mapping={k: v for k, v in MAPPING.items() if k != "actions"})
    no_time = _import(tmp_path, MAPPED, mapping={k: v for k, v in MAPPING.items() if k != "time"})
    nothing = _import(tmp_path, MAPPED, mapping=None)

    assert no_actions.status_code == no_time.status_code == nothing.status_code == 400
    assert "actions" in no_actions.json()["detail"] and "date and the time" in no_time.json()["detail"]


def test_the_columns_of_a_csv_are_offered_with_the_fields_and_the_column_that_most_likely_gives_each(tmp_path: Path):
    body = _client().post("/api/visits/csv-columns", json={"csv": "Site,Date,Time,Action,Sd,Whatever\nA,2026-10-02,08:00,Revision,B2,1\n"}).json()
    empty = _client().post("/api/visits/csv-columns", json={"csv": ""})

    assert body["columns"] == ["Site", "Date", "Time", "Action", "Sd", "Whatever"] and body["sample"] == [["A", "2026-10-02", "08:00", "Revision", "B2", "1"]]
    assert body["mapping"] == {"location_id": "Site", "date": "Date", "time": "Time", "actions": "Action", "sd": "Sd"}
    assert [f["field"] for f in body["fields"] if f["required"]] == ["location_id", "actions", "latitude", "longitude"]
    assert empty.status_code == 400


def _visit(day: str, actions: list[str], site: str = "DONA_01", **more) -> dict:
    return {**VISIT, "location_id": site, "date": day, "time": "09:00:00", "actions": actions, "num_photos": None, **more}


def _save_all(visits: list[dict]) -> None:
    """Keeps visits as they are, without the rules of a visit made by hand: these tests are about which of them are closed."""
    from wildintel_uploader.core import config
    from wildintel_uploader.core.schemas.requests import VisitRecord
    from wildintel_uploader.core.services import local_folder_service
    _project()
    local_folder_service.write_visits(config.collections_dir(), "DONA", [VisitRecord.model_validate(v).model_dump(mode="json") for v in visits])


def _closed() -> list[dict]:
    return _client().post("/api/visits/closed", json={"research_project_id": "DONA"}).json()["results"]


def test_a_visit_that_left_a_camera_is_closed_once_a_later_visit_collects_its_card(tmp_path: Path):
    with _in(tmp_path):
        _save_all([
            _visit("2026-06-10", ["Installation"]),
            _visit("2026-08-05", ["Revision"], num_photos=1620),
            _visit("2026-10-02", ["Desinstallation"], num_photos=300),
            _visit("2026-06-10", ["Installation"], site="DONA_02"),
        ])
        closed = _closed()

    # the installation and the revision left a card that was collected; the installation at DONA_02 is still out there
    assert [(c["visit"]["location_id"], c["visit"]["date"], c["end"]["date"]) for c in closed] == [("DONA_01", "2026-08-05", "2026-10-02"), ("DONA_01", "2026-06-10", "2026-08-05")]


def test_the_closed_visits_come_with_the_timezone_of_their_location(tmp_path: Path):
    with _in(tmp_path):
        _save_all([_visit("2026-06-10", ["Installation"]), _visit("2026-08-05", ["Revision"], num_photos=1620)])
        [closed] = _closed()

    assert closed["visit"]["timezone"] == "UTC" and closed["end"]["timezone"] == "UTC"   # the day and the time of a visit are told on the wall clock of its location


def test_what_does_not_collect_a_card_leaves_the_visit_before_it_open(tmp_path: Path):
    with _in(tmp_path):
        _save_all([
            _visit("2026-06-10", ["Revision"], num_photos=10),                        # leaves a card; the next visit collects nothing
            _visit("2026-07-01", ["Installation"]),                                   # no card is taken
            _visit("2026-08-01", ["Revision"], num_photos=0),                         # an explicit 0 photos
            _visit("2026-09-01", ["Revision"], camera_status="Not revised", num_photos=5),   # nothing collected
            _visit("2026-10-01", ["Stolen"]),                                         # the camera is gone
            _visit("2026-11-01", ["Revision"], num_photos=5),                         # the camera was stolen before
            _visit("2026-12-01", ["Revision"], num_photos=None),                      # the card was full, the count forgotten: still collected
        ])
        closed = _closed()

    assert [c["visit"]["date"] for c in closed] == ["2026-11-01"] and closed[0]["end"]["date"] == "2026-12-01"


def test_a_stolen_camera_closes_its_deployment_with_no_images(tmp_path: Path):
    with _in(tmp_path):
        _save_all([
            _visit("2026-06-10", ["Installation"]),
            _visit("2026-08-05", ["Stolen", "Installation"], session="R0002"),   # the camera was stolen, another is put up
            _visit("2026-10-02", ["Revision"], session="R0003", num_photos=300),
        ])
        found = _client().post("/api/visits/deployments", json={"research_project_id": "DONA"}).json()["results"]
        book = _client().post("/api/visits/book", json={"research_project_id": "DONA"}).json()["results"]
        closed = _closed()

    stolen, collected, still_out = sorted(found, key=lambda d: d["start"])  # the revision leaves a card too: its deployment is open
    assert (stolen["status"], stolen["no_images"], stolen["end"].startswith("2026-08-05"), stolen["images_stored"]) == ("closed", "stolen", True, False)
    assert (collected["status"], collected["no_images"], still_out["status"]) == ("closed", None, "open")
    # each is told on the wall clock of its location too, with its timezone
    assert collected["start_local"].startswith("2026-08-05T") and collected["end_local"].startswith("2026-10-02T") and collected["timezone"] == "UTC"
    assert still_out["end_local"] is None
    started = {v["date"]: v for v in book}
    assert all(v["timezone"] == "UTC" for v in book if not v.get("not_done"))          # a visit comes with the timezone of its location
    assert started["2026-06-10"]["deployment_status"] == "closed" and started["2026-06-10"]["deployment_no_images"] == "stolen"
    assert started["2026-08-05"]["deployment_no_images"] is None
    # nothing is offered to import for the stolen one: there are no images; the other deployment is closed by its revision
    assert [(c["visit"]["date"], c["end"]["date"]) for c in closed] == [("2026-08-05", "2026-10-02")]


def test_a_visit_linked_to_a_deployment_is_not_offered_again(tmp_path: Path):
    with _in(tmp_path):
        _save_all([_visit("2026-06-10", ["Installation"]), _visit("2026-08-05", ["Revision"], num_photos=1620)])
        linked = _client().post("/api/visits/link", json={"research_project_id": "DONA", "location_id": "dona_01", "date": "2026-06-10", "time": "09:00:00", "deployment_id": "R0001-DONA_01"})
        after = _closed()
        kept = _client().post("/api/visits/list", json={"research_project_id": "DONA"}).json()["results"]
        missing = _client().post("/api/visits/link", json={"research_project_id": "DONA", "location_id": "DONA_01", "date": "2030-01-01", "time": "09:00:00", "deployment_id": "x"})

    assert linked.status_code == 200 and after == []
    assert [v["deployment_id"] for v in kept] == ["R0001-DONA_01", None]
    assert missing.status_code == 400


# ── the rules of a visit: by hand they refuse it, in a CSV they question it ─────────────────────────────────────

def _save(visit: dict):
    return _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": visit})


def test_a_visit_by_hand_has_to_be_of_a_location_of_the_project_and_not_be_kept_already(tmp_path: Path):
    with _in(tmp_path):
        _project()
        _installed()
        elsewhere = _save({**VISIT, "location_id": "NOWHERE"})
        first = _save(VISIT)
        again = _save(VISIT)

    assert elsewhere.status_code == 422 and "not a location of the research project" in elsewhere.json()["detail"]
    assert first.status_code == 200
    assert again.status_code == 422 and "already a visit to DONA_01" in again.json()["detail"]


def test_the_first_visit_to_a_site_can_only_be_an_installation(tmp_path: Path):
    with _in(tmp_path):
        _project(archived=(2, 3))
        revision = _save(VISIT)
        both = _save({**VISIT, "actions": ["Installation", "Revision"], "sd": "A13"})
        installation = _save({**VISIT, "actions": ["Installation"], "sd": "A13", "num_photos": None})
        later = _save({**VISIT, "session": "R0014", "date": "2026-10-05"})

    assert revision.status_code == both.status_code == 422 and "first visit to DONA_01 can only be an Installation" in revision.json()["detail"]
    assert installation.status_code == later.status_code == 200


def test_the_photos_of_a_revision_are_not_required_when_the_card_was_full(tmp_path: Path):
    with _in(tmp_path):
        _project(archived=(2, 3))   # no revision waits for the other sites
        _installed((1,))
        counted = _save({**VISIT, "num_photos": None})
        full = _save({**VISIT, "session": "R0013", "num_photos": None, "card_batteries_ok": "CarFull", "date": "2026-10-03"})
        full_no_batteries = _save({**VISIT, "num_photos": None, "card_batteries_ok": "CarFullNoBatteries", "session": "R0014", "date": "2026-10-04"})
        written = _save({**VISIT, "session": "R0015", "num_photos": 12, "card_batteries_ok": "CarFull", "date": "2026-10-05"})   # the photos of a full card are not counted

    assert counted.status_code == 422 and "photos" in counted.json()["detail"]
    assert full.status_code == full_no_batteries.status_code == 200                           # not asked
    assert written.status_code == 422 and "full card" in str(written.json()["detail"])             # and not given


def test_a_visit_by_hand_lacks_nothing_its_actions_ask(tmp_path: Path):
    with _in(tmp_path):
        _project()
        no_camera = _save({**VISIT, "actions": ["Installation"], "camera_id": None, "sd": "A13"})
        no_card = _save({**VISIT, "actions": ["Installation"], "sd": None})
        no_photos = _save({**VISIT, "actions": ["Revision"], "num_photos": None})
        complete = _save({**VISIT, "actions": ["Installation"], "sd": "A13"})

    assert "The camera is required for Installation" in no_camera.json()["detail"]
    assert "The SD card left in the camera is required for Installation" in no_card.json()["detail"]
    assert "The photos on the card collected is required for Revision" in no_photos.json()["detail"]
    assert complete.status_code == 200


def test_a_camera_and_a_card_cannot_be_in_two_places_at_once(tmp_path: Path):
    install = {**VISIT, "session": "R0012", "date": "2026-01-10", "actions": ["Installation"], "num_photos": None, "sd": "A13"}
    with _in(tmp_path):
        _project(archived=(3,))
        _save(install)
        _save({**install, "location_id": "DONA_02", "camera_id": "77", "sd": "Z9"})   # the revision before is finished: each site has its visit
        later = {**install, "session": "R0013", "location_id": "DONA_02", "date": "2026-10-03"}
        camera = _save({**later, "sd": "B2"})                       # the camera is at DONA_01
        card = _save({**later, "camera_id": "99"})                  # the card is in the camera at DONA_01
        after_collecting = _save({**VISIT, "actions": ["Desinstallation"], "date": "2026-10-05", "num_photos": 10})
        same_revision = _save({**later, "date": "2026-10-06"})      # collected in R0013: not left again in R0013

    assert "installed at DONA_01" in camera.json()["detail"]
    assert "is in the camera at DONA_01" in card.json()["detail"]
    assert same_revision.status_code == 422 and "in this revision (R0013)" in same_revision.json()["detail"]
    assert after_collecting.status_code == 200


def test_a_csv_refuses_the_visits_that_break_the_rules_of_a_visit_as_the_form_does(tmp_path: Path):
    text = (
        "location_id,date,time,actions,num_photos,sd,camera_id\n"
        "DONA_01,2026-10-02,08:00,Installation,,A13,P800\n"
        "DONA_02,2026-10-03,08:00,Installation,,B2,P800\n"      # the camera is at DONA_01
        "DONA_01,2026-10-04,08:00,Revision,,,P800\n"            # no photos counted
    )
    body = _import(tmp_path, text, save=True).json()

    assert body["saved"] == 1 and [p["row"] for p in body["problems"]] == [3, 4]          # what the form refuses, the file refuses
    assert "Camera P800 is installed at DONA_01" in body["problems"][0]["message"]
    assert "photos on the card collected is required" in body["problems"][1]["message"]


def test_a_site_that_is_not_a_location_comes_back_as_new_or_misnamed(tmp_path: Path):
    text = (
        "location_id,date,time,actions,camera_id,latitude,longitude\n"
        "DONA_011,2026-10-02,08:00,Installation,P1,37.1001,-6.4\n"    # one character apart from DONA_01, and next to it
        "FAR_01,2026-10-03,08:00,Installation,P2,38.5,-5.0\n"         # nothing like it
    )
    body = _import(tmp_path, text, save=True).json()
    by_site = {s["site"]: s for s in body["new_sites"]}

    assert body["saved"] == 0 and body["visits"] == []             # held until the site is a location
    assert "DONA_01" in by_site["DONA_011"]["similar"] and by_site["DONA_011"]["nearest"]["location_id"] in ("DONA_01", "DONA_0001")
    assert by_site["DONA_011"]["nearest"]["distance_m"] < 50
    assert by_site["FAR_01"]["similar"] == [] and by_site["FAR_01"]["nearest"]["distance_m"] > 100000
    assert (by_site["FAR_01"]["latitude"], by_site["FAR_01"]["longitude"]) == (38.5, -5.0)


# ── the deployments the visits say, and the logs of their collections ───────────────────────────────────────────

def _field_visits() -> None:
    _save_all([
        # DONA_01: left on R0003, collected on R0004 — a closed deployment of R0003 — and a card left again, still out
        _visit("2024-09-04", ["Installation"], session="R0003", sd="A13", camera_id="P800", camera_model="Reconyx", setup_by="Ana", habitat="Pine", tags=["forest"], comments="new camera", camera_height=1.2, bait_use=True),
        _visit("2024-10-12", ["Revision"], session="R0004", sd="B2", camera_id="P800", num_photos=241, trappers="Luis", habitat="Scrub", tags=["pine", "forest"], comments="pilas", camera_height=1.5, bait_use=True),
        # DONA_02: left on R0003 and not collected yet — open
        _visit("2024-09-05", ["Installation"], site="DONA_02", session="R0003", sd="C7", camera_id="P900"),
    ])


def test_a_deployment_says_when_the_card_was_full_when_it_was_collected(tmp_path: Path):
    with _in(tmp_path):
        _save_all([
            _visit("2024-09-04", ["Installation"], session="R0003", sd="A13", camera_id="P800"),
            _visit("2024-10-12", ["Revision"], session="R0004", sd="B2", camera_id="P800", card_status="CardFull"),
            _visit("2024-09-04", ["Installation"], site="DONA_02", session="R0003", sd="C7", camera_id="P900"),
            _visit("2024-10-12", ["Revision"], site="DONA_02", session="R0004", sd="D1", camera_id="P900", num_photos=120),
        ])
        found = {d["deployment_id"]: d for d in _client().post("/api/visits/deployments", json={"research_project_id": "DONA"}).json()["results"]}

    assert found["R0003-DONA_01"]["card_full"] is True and found["R0003-DONA_01"]["photos_counted"] is None   # its photos were not counted
    assert found["R0003-DONA_02"]["card_full"] is False and found["R0003-DONA_02"]["photos_counted"] == 120


def test_the_deployments_of_the_visits_are_closed_or_open_and_named_by_the_session_that_collects_them(tmp_path: Path):
    with _in(tmp_path):
        _field_visits()
        found = {d["deployment_id"]: d for d in _client().post("/api/visits/deployments", json={"research_project_id": "DONA"}).json()["results"]}

    closed, open_ = found["R0003-DONA_01"], found["R0004-DONA_01"]
    assert closed["status"] == "closed" and (closed["start"], closed["end"]) == ("2024-09-04T09:00:00Z", "2024-10-12T09:00:00Z")
    assert (closed["card"], closed["photos_counted"], closed["camera_id"]) == ("A13", 241, "P800")
    assert (closed["start_session"], closed["end_session"]) == ("R0003", "R0004")
    # the Revision of R0004 left a card too: still out, and the collection being completed (R0003 was the last trip's before it)
    assert open_["status"] == "open" and open_["card"] == "B2" and open_["end"] is None
    assert found["R0003-DONA_02"]["status"] == "open"                      # left on R0003, before the last trip R0004: the collection being completed


def test_what_the_two_visits_of_a_deployment_say_of_it_is_kept_beside_each_other(tmp_path: Path):
    with _in(tmp_path):
        _field_visits()
        closed = next(d for d in _client().post("/api/visits/deployments", json={"research_project_id": "DONA"}).json()["results"] if d["deployment_id"] == "R0003-DONA_01")

    assert closed["setup_by"] == "Setup: Ana | Retrieval: Luis"
    assert closed["fields"]["habitat"] == "Setup: Pine | Retrieval: Scrub"       # a text both say differently
    assert closed["fields"]["deploymentTags"] == "forest | pine"                 # the tags of both, once each
    assert closed["fields"]["cameraHeight"] == 1.2 and closed["fields"]["baitUse"] is True   # a number as the setup says it
    assert closed["comments"] == "Setup: new camera | Retrieval: pilas; cameraHeight 1.5 (setup 1.2)"


def test_the_logs_of_the_collections_are_written_with_every_deployment_closed_or_open(tmp_path: Path):
    import csv
    with _in(tmp_path):
        _field_visits()
        done = _client().post("/api/visits/field-logs", json={"research_project_id": "DONA"})

    assert done.status_code == 200
    by_collection = {c["collection"]: c for c in done.json()["collections"]}
    assert (by_collection["R0003"]["closed"], by_collection["R0003"]["open"]) == (1, 1)
    stamp = (tmp_path / "DONA" / "R0003" / "R0003_FileTimestampLog.csv").read_text(encoding="utf-8-sig").splitlines()
    assert stamp[1:] == ["r0003-dona_01,2024:09:04,09:00:00,2024:10:12,09:00:00"]            # only the closed one
    with (tmp_path / "DONA" / "R0003" / "R0003_FieldworkLog.csv").open(encoding="utf-8-sig", newline="") as f:
        rows = {r["deploymentID"]: r for r in csv.DictReader(f)}
    assert set(rows) == {"R0003-DONA_01", "R0003-DONA_02"}                                    # the open one too
    assert rows["R0003-DONA_01"]["status"] == "closed" and rows["R0003-DONA_01"]["cardSD"] == "A13" and rows["R0003-DONA_01"]["photosCounted"] == "241"
    assert rows["R0003-DONA_02"]["status"] == "open" and rows["R0003-DONA_02"]["deploymentEnd"] == ""


# ── the folders and the logs made when a visit is registered ────────────────────────────────────────────────────

def test_the_folder_of_a_collection_and_its_logs_are_made_when_a_visit_closes_a_deployment(tmp_path: Path):
    install = {**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "session": "R0003", "date": "2024-09-04", "time": "09:00:00"}
    collect = {**VISIT, "actions": ["Revision"], "sd": "B2", "num_photos": 241, "session": "R0004", "date": "2024-10-12", "time": "09:00:00"}
    with _in(tmp_path):
        _project(archived=(2, 3))
        first = _save(install)
        # a camera left and not collected yet is an open deployment of the collection being completed: its folder and its FieldworkLog are made at once
        folder = tmp_path / "DONA" / "R0003"
        assert first.status_code == 200 and (folder / "collection.json").is_file() and (folder / "R0003_FieldworkLog.csv").is_file()
        assert not (folder / "R0003_FileTimestampLog.csv").exists()                  # nothing is closed yet
        second = _save(collect)

    assert second.json()["field_logs"]["collections"][0]["collection"] == "R0003"
    assert (folder / "R0003_FileTimestampLog.csv").read_text(encoding="utf-8-sig").splitlines()[1] == "r0003-dona_01,2024:09:04,09:00:00,2024:10:12,09:00:00"
    assert "closed" in (folder / "R0003_FieldworkLog.csv").read_text(encoding="utf-8-sig")


def test_the_visits_of_a_csv_make_the_folders_and_the_logs_of_their_collections_when_they_are_kept(tmp_path: Path):
    text = "location_id,date,time,actions,session,num_photos,sd,camera_id\nDONA_01,2024-09-04,09:00,Installation,R0003,,A13,P800\nDONA_01,2024-10-12,09:00,Revision,R0004,241,B2,P800\n"
    shown = _import(tmp_path, text, given_up="2000-01-01")
    assert not (tmp_path / "DONA" / "R0003").exists()                               # only reading: nothing is made
    kept = _import(tmp_path, text, save=True, given_up="2000-01-01").json()

    assert kept["saved"] == 2 and [c["collection"] for c in kept["field_logs"]["collections"]] == ["R0003", "R0004"]
    assert (tmp_path / "DONA" / "R0003" / "R0003_FileTimestampLog.csv").is_file() and (tmp_path / "DONA" / "R0004" / "R0004_FieldworkLog.csv").is_file()
    assert shown.status_code == 200


def test_a_closed_visit_comes_with_what_its_two_visits_say_of_the_deployment_mixed_as_the_log_mixes_them(tmp_path: Path):
    with _in(tmp_path):
        _field_visits()
        closed = _closed()

    details = next(c["details"] for c in closed if c["visit"]["session"] == "R0003" and c["visit"]["location_id"] == "DONA_01")
    assert details["setup_by"] == "Setup: Ana | Retrieval: Luis" and details["camera_id"] == "P800"
    assert details["habitat"] == "Setup: Pine | Retrieval: Scrub" and details["tags"] == ["forest", "pine"]
    assert details["camera_height"] == 1.2 and details["bait_use"] is True                  # the setup's number
    assert details["comments"] == "Setup: new camera | Retrieval: pilas; cameraHeight 1.5 (setup 1.2)"


# ── the settings of the field records, and what the engine of the field records also says ───────────────────────

def _parse(text: str, kept=None, options=None, sites=("DONA_01", "DONA_02", "DONA_03")):
    from wildintel_uploader.core.services import visits_csv
    locations = [{"location_id": s, "timezone": "UTC", "ignore_dst": False, "latitude": 37.0, "longitude": -6.4} for s in sites]
    return visits_csv.parse_visits(text, locations, kept or [], visits_csv.suggest_mapping(text)["mapping"], options)


EPI_HEADER = "created_at,1_Responsable,2_Collection,3_Date,4_Location,5_Camera,6_Action,9_Number_of_pictures,10_SD,14_Hour\n"


def test_the_time_of_a_visit_is_when_its_entry_was_created_or_the_date_and_the_hour_typed(tmp_path: Path):
    text = EPI_HEADER + "2024-09-04T11:10:00.000Z,Ana,R0003,2024-09-04,DONA_01,P800,Installation,,A13,12:30\n"

    created = _parse(text)["visits"][0]
    typed = _parse(text, options={"time_source": "hour"})["visits"][0]

    assert (created["date"], created["time"], created["when"]) == ("2024-09-04", "11:10:00", "2024-09-04T11:10:00Z")
    assert (typed["date"], typed["time"], typed["when"]) == ("2024-09-04", "12:30:00", "2024-09-04T12:30:00Z")   # the hour typed in the form


def test_the_session_numbers_that_jump_are_warned_of_and_the_sites_not_visited_are_told_as_notes():
    kept = [{"location_id": "DONA_01", "session": "R0003", "when": "2024-09-04T09:00:00Z", "date": "2024-09-04", "time": "09:00:00", "actions": ["Installation"], "camera_id": "P800", "sd": "A13"},
            {"location_id": "DONA_02", "session": "R0003", "when": "2024-09-04T10:00:00Z", "date": "2024-09-04", "time": "10:00:00", "actions": ["Installation"], "camera_id": "P900", "sd": "B2"}]
    sites = ("DONA_01", "DONA_02")
    text = (EPI_HEADER + "2024-11-05T09:00:00.000Z,Ana,R0005,2024-11-05,DONA_01,P800,Revision,50,C7,09:00\n"
            "2024-11-05T10:00:00.000Z,Ana,R0005,2024-11-05,DONA_02,P900,Revision,50,D8,10:00\n")   # R0004 is unknown for both: R0005 can start
    result = _parse(text, kept=kept, sites=sites)

    assert "Session numbers jump from R0003 to R0005." in result["warnings"]
    text = EPI_HEADER + "2024-10-12T09:00:00.000Z,Ana,R0004,2024-10-12,DONA_01,P800,Revision,50,C7,09:00\n"
    assert any(n.startswith("The revision R0004 has no visit to DONA_02, which was visited in R0003: the camera stays out in the field") for n in _parse(text, kept=kept, sites=sites)["notes"])


def test_a_row_that_is_a_visit_kept_already_by_its_session_site_camera_and_actions_is_left_as_it_is():
    kept = [{"location_id": "DONA_01", "session": "R0003", "when": "2024-09-04T09:00:00Z", "date": "2024-09-04", "time": "09:00:00", "actions": ["Installation"], "camera_id": "P800", "sd": "A13"}]
    # the same visit, with the time of the entry instead of the one written in the datasheet
    text = EPI_HEADER + "2024-09-04T09:07:00.000Z,Ana,R0003,2024-09-04,DONA_01,P800,Installation,,A13,12:30\n"
    result = _parse(text, kept=kept)

    assert result["visits"] == [] and result["skipped"] == 1


def test_the_seconds_are_cut_from_the_logs_unless_they_are_kept_and_an_import_leaves_its_report(tmp_path: Path, reports: Path):
    from unittest.mock import patch

    from wildintel_uploader.core import config
    text = ("location_id,date,time,actions,session,num_photos,sd,camera_id\nDONA_01,2024-09-04,09:00:41,Installation,R0003,,A13,P800\n"
            "DONA_01,2024-10-12,09:05:17,Revision,R0004,241,B2,P800\n")
    for keep, expected in ((False, "09:00:00,2024:10:12,09:05:00"), (True, "09:00:41,2024:10:12,09:05:17")):
        root = tmp_path / str(keep)
        root.mkdir()
        settings = config.Settings.model_validate({"FIELDLOG": {"keep_seconds": keep}})
        with patch("wildintel_uploader.web.api.routers.visits.config.load_settings", return_value=settings):
            body = _import(root, text, save=True, given_up="2000-01-01").json()
        stamp = (root / "DONA" / "R0003" / "R0003_FileTimestampLog.csv").read_text(encoding="utf-8-sig").splitlines()[1]
        assert stamp.endswith(expected), (keep, stamp)
    # the report is kept with the other reports, with an entry for each row of the file
    from wildintel_uploader.core.services import report_service
    report = report_service.read(body["report"], reports)
    assert report["kind"] == "visits" and report["title"] == "Visits imported to DONA" and report["checked"] == 2 and report["parameters"]["saved"] == 2
    assert [e["identifier"] for e in report["entries"]][:2] == ["Row 2 · DONA_01 · R0003 · 2024-09-04 09:00", "Row 3 · DONA_01 · R0004 · 2024-10-12 09:05"]
    assert not list(root.glob("DONA/visits_import_*"))                                          # nothing is left beside the visits


def test_a_revision_is_of_the_camera_that_is_at_the_site_unless_the_visit_also_installs_another(tmp_path: Path):
    install = {**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "camera_id": "P800", "date": "2024-09-04", "session": "R0003"}
    with _in(tmp_path):
        _project(archived=(2, 3))
        _save(install)
        other = _save({**VISIT, "actions": ["Revision"], "camera_id": "P999", "num_photos": 10, "sd": "B2", "date": "2024-10-12", "session": "R0004"})
        same = _save({**VISIT, "actions": ["Revision"], "camera_id": "p800", "num_photos": 10, "sd": "B2", "date": "2024-10-12", "session": "R0004"})
        two = _save({**VISIT, "actions": ["Revision", "Installation"], "camera_id": "P999", "num_photos": 10, "sd": "C7", "date": "2024-11-12", "session": "R0005"})
        swapped = _save({**VISIT, "actions": ["Revision", "Desinstallation", "Installation"], "camera_id": "P999", "num_photos": 10, "sd": "C7", "date": "2024-11-12", "session": "R0005"})

    assert other.status_code == 422 and "The camera at DONA_01 is P800" in other.json()["detail"] and "add a Desinstallation and an Installation" in other.json()["detail"]
    assert same.status_code == 200                                  # the camera that is there, whatever its case
    assert two.status_code == 422 and "already has a camera: p800" in two.json()["detail"]   # a site has one camera at a time: the old one has to be taken away
    assert swapped.status_code == 200                               # the camera was replaced: the visit takes the old one away and puts the new one up


def test_the_visit_book_gives_each_visit_the_deployment_it_started_closed_or_open(tmp_path: Path):
    with _in(tmp_path):
        _field_visits()
        book = _client().post("/api/visits/book", json={"research_project_id": "DONA"}).json()["results"]

    by = {(v["location_id"], v["session"]): v for v in book}
    assert (by[("DONA_01", "R0003")]["deployment"], by[("DONA_01", "R0003")]["deployment_status"]) == ("R0003-DONA_01", "closed")
    assert (by[("DONA_01", "R0004")]["deployment"], by[("DONA_01", "R0004")]["deployment_status"]) == ("R0004-DONA_01", "open")   # it left a card again: still out
    assert (by[("DONA_02", "R0003")]["deployment"], by[("DONA_02", "R0003")]["deployment_status"]) == ("R0003-DONA_02", "open")
    assert not any(v["not_visited"] for v in book)                                                  # every one of them was made


def test_the_visit_book_says_a_visit_that_could_not_be_made_is_not_visited(tmp_path: Path):
    with _in(tmp_path):
        _project(archived=(2, 3))
        _save({**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "camera_id": "P800", "date": "2024-09-04", "session": "R0001"})
        second = _save({**VISIT, "actions": ["Revision"], "camera_id": "P800", "num_photos": 0, "sd": "B2", "camera_status": "Not revised", "date": "2024-10-12", "session": "R0002"})
        book = _client().post("/api/visits/book", json={"research_project_id": "DONA"}).json()["results"]

    assert second.status_code == 200, second.text
    assert {v["session"]: v["not_visited"] for v in book} == {"R0001": False, "R0002": True}


def test_the_visit_book_has_a_row_for_each_location_that_was_not_visited_in_a_session(tmp_path: Path):
    with _in(tmp_path):
        _field_visits()   # DONA_01 and DONA_02 are visited in R0003, DONA_01 alone in R0004; the project has DONA_01, DONA_02 and DONA_03
        _client().post("/api/deployment-import/locations/save", json={"research_project_id": "DONA", "location": {"location_id": "DONA_04", "timezone": "UTC", "ignore_dst": False, "latitude": 37.4, "longitude": -6.5, "status": "archived"}})
        book = _client().post("/api/visits/book", json={"research_project_id": "DONA"}).json()["results"]

    not_done = sorted((v["session"], v["location_id"]) for v in book if v["not_done"])
    assert not_done == [("R0003", "DONA_03"), ("R0004", "DONA_02"), ("R0004", "DONA_03")]       # DONA_04 is archived: left out
    assert all(v["actions"] == [] and v["date"] == "" for v in book if v["not_done"])
    assert sum(1 for v in book if not v["not_done"]) == 3                                           # the visits are the ones made


def test_the_visit_book_says_which_deployments_are_on_trapper_uploaded_from_here_or_synced(tmp_path: Path):
    import json
    with _in(tmp_path):
        _field_visits()
        for site, deployment in (("DONA_01", "R0003-DONA_01"), ("DONA_02", "R0003-DONA_02")):
            _client().post("/api/visits/link", json={"research_project_id": "DONA", "location_id": site, "date": "2024-09-04" if site == "DONA_01" else "2024-09-05", "time": "09:00:00" if site == "DONA_01" else "09:00:00", "deployment_id": deployment})
        uploaded = tmp_path / "DONA" / "R0003" / "R0003-DONA_01"
        uploaded.mkdir(parents=True)
        (uploaded / "upload.json").write_text(json.dumps({"uploaded_at": "2024-10-20T10:00:00+00:00"}), encoding="utf-8")
        book = {(v["location_id"], v["session"]): v for v in _client().post("/api/visits/book", json={"research_project_id": "DONA"}).json()["results"]}

    assert (book[("DONA_01", "R0003")]["on_trapper"], book[("DONA_01", "R0003")]["uploaded_at"]) == (True, "2024-10-20T10:00:00+00:00")
    assert (book[("DONA_02", "R0003")]["on_trapper"], book[("DONA_02", "R0003")]["uploaded_at"]) == (False, None)   # imported here, not uploaded
    assert book[("DONA_01", "R0004")]["on_trapper"] is False                                                          # no deployment of its own yet


def test_the_deployments_say_where_and_when_each_was_uploaded(tmp_path: Path):
    import json
    with _in(tmp_path):
        _field_visits()
        for site, day in (("DONA_01", "2024-09-04"), ("DONA_02", "2024-09-05")):
            _client().post("/api/visits/link", json={"research_project_id": "DONA", "location_id": site, "date": day, "time": "09:00:00", "deployment_id": f"R0003-{site}"})
        sent = tmp_path / "DONA" / "R0003" / "R0003-DONA_01"
        sent.mkdir(parents=True)
        (sent / "upload.json").write_text(json.dumps({"uploaded_at": "2024-10-20T10:00:00+00:00", "parts": 2, "location_created": True, "deployment_created": True,
                                                       "deployment_url": "https://trapper.example.org/geomap/deployment/detail/7/", "collection_url": "https://trapper.example.org/storage/collection/detail/26/"}), encoding="utf-8")
        kept = tmp_path / "DONA" / "R0003" / "R0003-DONA_02"          # created here and not sent anywhere
        kept.mkdir(parents=True)
        body = _client().post("/api/visits/deployments", json={"research_project_id": "DONA"}).json()

    created = {d["deployment_id"]: d for d in body["results"]}
    assert [(u["destination"], u["kind"], u["uploaded_at"], u["parts"], u["location_created"], u["deployment_created"]) for u in created["R0003-DONA_01"]["uploads"]] == [
        ("trapper", "uploaded", "2024-10-20T10:00:00+00:00", 2, True, True)]
    assert created["R0003-DONA_01"]["uploads"][0]["url"] == "https://trapper.example.org/geomap/deployment/detail/7/"   # the page of the deployment in Trapper
    assert created["R0003-DONA_01"]["start_session"] == "R0003"
    assert created["R0003-DONA_02"]["uploads"] == []                                           # created, not uploaded
    # the upload to each uploader in use is its own state: done where it was, planned where it was not
    assert [(u["destination"], u["state"]) for u in created["R0003-DONA_01"]["upload_states"]] == [("trapper", "done")]
    assert [(u["destination"], u["state"]) for u in created["R0003-DONA_02"]["upload_states"]] == [("trapper", "planned")]


def test_the_deployments_say_whether_their_images_are_stored_and_whether_they_are_on_trapper(tmp_path: Path):
    import json
    with _in(tmp_path):
        _field_visits()
        _client().post("/api/visits/link", json={"research_project_id": "DONA", "location_id": "DONA_01", "date": "2024-09-04", "time": "09:00:00", "deployment_id": "R0003-DONA_01"})
        folder = tmp_path / "DONA" / "R0003" / "R0003-DONA_01"
        folder.mkdir(parents=True)
        (folder / "upload.json").write_text(json.dumps({"uploaded_at": "2024-10-20T10:00:00+00:00"}), encoding="utf-8")
        found = {d["deployment_id"]: d for d in _client().post("/api/visits/deployments", json={"research_project_id": "DONA"}).json()["results"]}

    assert (found["R0003-DONA_01"]["images_stored"], found["R0003-DONA_01"]["on_trapper"], found["R0003-DONA_01"]["uploaded_at"]) == (True, True, "2024-10-20T10:00:00+00:00")
    assert [(u["destination"], u["kind"], u["uploaded_at"]) for u in found["R0003-DONA_01"]["uploads"]] == [("trapper", "uploaded", "2024-10-20T10:00:00+00:00")]
    assert found["R0003-DONA_02"]["uploads"] == []
    assert (found["R0003-DONA_02"]["images_stored"], found["R0003-DONA_02"]["on_trapper"]) == (False, False)


# ── The visits read straight from the Epicollect5 project of the settings ───────────────────────────────────────────────

EPI_INPUTS = [{"ref": f"f_{i}", "label": label} for i, label in enumerate(
    ["setupBy", "Collection", "Date", "locationID", "Status of the camera", "Action", "Card and batteries", "Nº pictures collected", "Date and time OK", "Serial number", "cameraHeight", "SD to insert", "Calibration"])]
EPI_REF = {i["label"]: i["ref"] for i in EPI_INPUTS}
EPI_ENTRIES = [
    {"created_at": "2026-10-02T08:14:05.000Z", EPI_REF["setupBy"]: ["Ana"], EPI_REF["Collection"]: 1, EPI_REF["Date"]: "02/10/2026", EPI_REF["locationID"]: "DONA_01",
     EPI_REF["Status of the camera"]: "New site", EPI_REF["Serial number"]: "A13", EPI_REF["cameraHeight"]: "50", EPI_REF["SD to insert"]: "S1", EPI_REF["Calibration"]: "Yes"},
    {"created_at": "2026-11-05T09:00:00.000Z", EPI_REF["setupBy"]: ["Ana"], EPI_REF["Collection"]: 2, EPI_REF["Date"]: "05/11/2026", EPI_REF["locationID"]: "DONA_01",
     EPI_REF["Status of the camera"]: "OK", EPI_REF["Action"]: "Camera inspection", EPI_REF["Card and batteries"]: "OK", EPI_REF["Nº pictures collected"]: "1620", EPI_REF["Date and time OK"]: "OK"},
]


def test_the_entries_of_epicollect_become_visits_and_an_inspection_is_of_the_camera_at_the_site(tmp_path: Path):
    import pytest  # noqa: PLC0415
    from unittest.mock import patch  # noqa: PLC0415
    from wildintel_uploader.core.services import epicollect_service  # noqa: PLC0415
    with patch.object(epicollect_service, "fetch_form", return_value={"project": {}, "inputs": EPI_INPUTS}), patch.object(epicollect_service, "_all_entries", return_value=EPI_ENTRIES):
        text = epicollect_service.visits_csv()
        done = _import(tmp_path, "", save=True, fmt="epicollect-api", given_up="2000-01-01")
    rows = {r["date"]: r for r in __import__("csv").DictReader(__import__("io").StringIO(text))}
    assert rows["2026-10-02"]["actions"] == "Installation" and rows["2026-10-02"]["camera_height"] == "0.5" and rows["2026-10-02"]["calibration"] == "yes"
    assert rows["2026-11-05"]["actions"] == "Revision" and rows["2026-11-05"]["card_status"] == "OK" and rows["2026-11-05"]["date_time_ok"] == "Yes"
    assert done.status_code == 200, done.text
    kept = done.json()["visits"]
    assert len(kept) == 2 and [v.get("camera_id") for v in kept] == ["A13", None]      # the inspection does not say which camera: it is the one the visit before put up
    with _in(tmp_path):
        told = _client().post("/api/visits/list", json={"research_project_id": "DONA"}).json()["results"]
    assert [v["camera_id"] for v in told] == ["A13", "A13"]                              # and it is told as that one


def test_a_form_that_is_not_the_one_of_a_visit_is_said_plainly():
    import pytest  # noqa: PLC0415
    from unittest.mock import patch  # noqa: PLC0415
    from wildintel_uploader.core.services import epicollect_service  # noqa: PLC0415
    with patch.object(epicollect_service, "fetch_form", return_value={"project": {}, "inputs": [{"ref": "x", "label": "Other"}]}):
        with pytest.raises(epicollect_service.EpicollectError, match="locationID"):
            epicollect_service.visits_csv()


@pytest.mark.gps
def test_a_note_whose_gps_is_far_from_its_location_is_warned_of(tmp_path: Path):
    text = "location_id,date,time,actions,latitude,longitude\nDONA_01,2026-10-02,08:00:00,Installation,37.2,-6.4\nDONA_0001,2026-10-03,08:00:00,Installation,37.1,-6.4\n"
    shown = _import(tmp_path, text).json()
    assert any("DONA_01" in w and "m from the location" in w for w in shown["warnings"])
    assert not any("DONA_0001" in w and "m from the location" in w for w in shown["warnings"])


def test_a_revision_cannot_start_while_the_one_before_it_has_a_location_still_to_be_visited(tmp_path: Path):
    with _in(tmp_path):
        _project(archived=(3,))
        for n in (1, 2):
            _save({**VISIT, "location_id": f"DONA_0{n}", "actions": ["Installation"], "num_photos": None, "sd": f"S{n}", "camera_id": f"C{n}", "date": "2024-09-04", "session": "R0001"})
        # R0001 has DONA_01 and DONA_02 (DONA_03 is archived): R0002 starts with DONA_01, then it has DONA_02 to go
        second = {**VISIT, "actions": ["Revision"], "camera_id": "C1", "num_photos": 10, "sd": "B1", "date": "2024-10-12", "session": "R0002"}
        assert _save(second).status_code == 200
        third = _save({**second, "date": "2024-11-12", "session": "R0003"})

    assert third.status_code == 422 and "R0003 cannot start: R0002 is not finished" in third.json()["detail"] and "DONA_02" in third.json()["detail"]


def test_a_revision_waits_for_the_locations_not_archived_when_the_one_before_it_started(tmp_path: Path):
    with _in(tmp_path):
        _project()
        first = _save({**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "S1", "camera_id": "C1", "date": "2024-09-04", "session": "R0001"})
        _save({**VISIT, "location_id": "DONA_02", "actions": ["Installation"], "num_photos": None, "sd": "S2", "camera_id": "C2", "date": "2024-09-04", "session": "R0001"})
        # DONA_03 is not visited in R0001 and nothing says it was archived: R0002 is refused
        second = _save({**VISIT, "actions": ["Revision"], "camera_id": "C1", "num_photos": 10, "sd": "B1", "date": "2024-10-12", "session": "R0002"})

    assert first.status_code == 200
    assert second.status_code == 422 and "R0001 is not finished" in second.json()["detail"] and "DONA_03" in second.json()["detail"]


def test_a_visit_that_archives_a_location_takes_the_camera_away_and_archives_it_from_that_day(tmp_path: Path):
    install = {**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "camera_id": "P800", "date": "2024-09-04", "session": "R0001"}
    with _in(tmp_path):
        _project(archived=(2, 3))
        _save(install)
        # the camera is still out: the location cannot be given up
        refused = _save({**VISIT, "actions": ["Archive"], "camera_id": None, "date": "2024-10-12", "session": "R0002"})
        done = _save({**VISIT, "actions": ["Revision", "Desinstallation", "Archive"], "camera_id": "P800", "num_photos": 10, "sd": None, "comments": "site abandoned", "date": "2024-10-12", "session": "R0002"})
        locations = _client().post("/api/deployment-import/locations/list", json={"research_project_id": "DONA"}).json()["results"]
        after = _save({**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "B2", "camera_id": "P800", "date": "2024-11-12", "session": "R0003"})

    assert refused.status_code == 422 and "is still there" in refused.json()["detail"]
    assert done.status_code == 200
    archived = next(l for l in locations if l["location_id"] == "DONA_01")
    assert (archived["status"], archived["status_date"], archived["status_note"]) == ("archived", "2024-10-12", "Archived in the visit R0002: site abandoned")
    assert after.status_code == 422 and "is archived since 2024-10-12" in after.json()["detail"]


def test_a_revision_that_is_not_finished_is_finished_by_marking_what_is_left_as_not_visited(tmp_path: Path):
    install = {**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "camera_id": "P800", "date": "2024-09-04", "session": "R0001"}
    with _in(tmp_path):
        _project(archived=(3,))
        _save(install)                                   # DONA_01 is visited in R0001, DONA_02 is not (DONA_03 is archived)
        blocked = _save({**VISIT, "actions": ["Revision"], "camera_id": "P800", "num_photos": 10, "sd": "B2", "date": "2024-10-12", "session": "R0002"})
        marked = _client().post("/api/visits/mark-not-visited", json={"research_project_id": "DONA", "session": "R0001"})
        book = _client().post("/api/visits/book", json={"research_project_id": "DONA"}).json()["results"]
        next_one = _save({**VISIT, "actions": ["Revision"], "camera_id": "P800", "num_photos": 10, "sd": "B2", "date": "2024-10-12", "session": "R0002"})

    assert blocked.status_code == 422 and "R0001 is not finished" in blocked.json()["detail"]
    assert marked.json() == {"session": "R0001", "marked": ["DONA_02"]}
    assert all(v["actions"] == [] for v in book if v["not_visited"])               # nothing was done at a visit that could not be made
    assert [(v["location_id"], v["not_visited"]) for v in book if v["session"] == "R0001"] == [("DONA_01", False), ("DONA_02", True)]
    assert next_one.status_code == 200


def _create_revision():
    return _client().post("/api/visits/create-revision", json={"research_project_id": "DONA"})


def test_the_next_revision_is_planned_with_a_visit_to_each_location_that_can_be_visited_and_the_one_before_is_checked(tmp_path: Path):
    install = {**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "camera_id": "P800", "date": "2024-09-04", "session": "R0001"}
    with _in(tmp_path):
        _project(archived=(3,))
        _save(install)                                   # DONA_01 is visited in R0001, DONA_02 is not (DONA_03 is archived: no trip goes there)
        created = _create_revision()
        book = _client().post("/api/visits/book", json={"research_project_id": "DONA"}).json()["results"]
        refused = _save({**VISIT, "actions": ["Revision"], "camera_id": "P800", "num_photos": 10, "sd": "B2", "date": "2024-10-12", "session": "R0002"})

    assert created.status_code == 200
    assert created.json() == {"session": "R0002", "planned": ["DONA_01", "DONA_02"], "previous": {"session": "R0001", "missing": ["DONA_02"]}}   # and the one before is not finished: it is told
    planned = sorted((v["location_id"], v["not_done"], v["state"]) for v in book if v["session"] == "R0002")
    assert planned == [("DONA_01", True, "planned"), ("DONA_02", True, "planned")]                          # a planned visit to each, none to the archived one
    assert refused.status_code == 422 and "R0001 is not finished" in refused.json()["detail"]               # the rule of the revisions stands: it is for the person to close R0001


def test_the_revision_before_is_not_told_when_it_is_finished_and_the_next_is_not_planned_until_the_last_has_a_visit(tmp_path: Path):
    with _in(tmp_path):
        _project(archived=(2, 3))
        _save({**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "camera_id": "P800", "date": "2024-09-04", "session": "R0001"})
        first = _create_revision()
        again = _create_revision()                       # R0002 has no visit yet
        visited = _save({**VISIT, "actions": ["Revision"], "camera_id": "P800", "num_photos": 10, "sd": "B2", "date": "2024-10-12", "session": "R0002"})
        third = _create_revision()
        sessions = sorted({v["session"] for v in _client().post("/api/visits/book", json={"research_project_id": "DONA"}).json()["results"]})

    assert first.status_code == 200 and first.json() == {"session": "R0002", "planned": ["DONA_01"], "previous": None}
    assert again.status_code == 409 and "R0002 is planned and has no visit yet" in again.json()["detail"]
    assert visited.status_code == 200
    assert third.status_code == 200 and third.json()["session"] == "R0003" and third.json()["previous"] is None
    assert sessions == ["R0001", "R0002", "R0003"]


def test_the_first_revision_can_be_planned_before_any_visit_and_needs_a_location_that_can_be_visited(tmp_path: Path):
    with _in(tmp_path):
        _project()
        first = _create_revision()
        book = _client().post("/api/visits/book", json={"research_project_id": "DONA"}).json()["results"]
    with _in(tmp_path / "other"):
        _project(archived=(1, 2, 3))
        nothing = _create_revision()

    assert first.status_code == 200 and first.json() == {"session": "R0001", "planned": ["DONA_01", "DONA_02", "DONA_03"], "previous": None}
    assert sorted(v["location_id"] for v in book if v["session"] == "R0001" and v["not_done"]) == ["DONA_01", "DONA_02", "DONA_03"]
    assert nothing.status_code == 409 and "No location can be visited" in nothing.json()["detail"]


def test_a_visit_is_kept_with_its_state_which_changes_when_a_later_visit_collects_its_card(tmp_path: Path):
    def states():
        shown = _client().post("/api/visits/list", json={"research_project_id": "DONA"}).json()["results"]
        return [(v["session"], v.get("state")) for v in shown]

    with _in(tmp_path):
        _project(archived=(2, 3))
        _save({**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "camera_id": "P800", "date": "2024-09-04", "session": "R0001"})
        left = states()
        _save({**VISIT, "actions": ["Revision", "Installation"], "camera_id": "P800", "num_photos": 10, "sd": "B2", "date": "2024-10-12", "session": "R0002"})
        revised = states()
        _save({**VISIT, "actions": ["Stolen"], "camera_id": "P800", "num_photos": None, "sd": None, "date": "2024-11-12", "session": "R0003"})
        stolen = states()

    assert left == [("R0001", "deployed")]                                        # it left a camera that is still out
    assert revised == [("R0001", "collected"), ("R0002", "deployed")]               # a later visit took its card: it is collected, and the new one is out
    assert stolen == [("R0001", "collected"), ("R0002", "stolen"), ("R0003", "no_camera")]   # the camera of the second was found stolen, and the visit that found it left none


def test_a_visit_has_no_actions_only_when_it_could_not_be_made(tmp_path: Path):
    with _in(tmp_path):
        _project(archived=(2, 3))
        _save({**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "camera_id": "P800", "date": "2024-09-04", "session": "R0001"})
        refused = _save({**VISIT, "actions": [], "camera_id": None, "date": "2024-10-12", "session": "R0002"})
        kept = _save({**VISIT, "actions": [], "camera_status": "Not revised", "camera_id": None, "num_photos": None, "sd": None, "date": "2024-10-12", "session": "R0002"})

    assert refused.status_code == 422 and "at least one action" in refused.text
    assert kept.status_code == 200 and kept.json()["actions"] == []


def test_an_upload_is_planned_for_each_deployment_and_each_uploader_in_use_and_a_failed_one_is_tried_again(tmp_path: Path):
    from wildintel_uploader.core import config
    from wildintel_uploader.core.services import local_folder_service

    def states():
        shown = _client().post("/api/visits/deployments", json={"research_project_id": "DONA"}).json()["results"]
        return {d["deployment_id"]: [(u["destination"], u["state"]) for u in d["upload_states"]] for d in shown}

    with _in(tmp_path):
        _project(archived=(2, 3))
        _save({**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "camera_id": "P800", "date": "2024-09-04", "session": "R0001"})
        _save({**VISIT, "actions": ["Revision"], "camera_id": "P800", "num_photos": 10, "sd": "B2", "date": "2024-10-12", "session": "R0002"})
        planned = states()                                   # Trapper is in use and Agouti is not: one upload for each deployment, before anything was created
        settings = config.load_settings()
        settings.AGOUTI.enabled = True
        config.save_settings(settings)
        both = states()
        local_folder_service.set_upload_failure(tmp_path, "DONA", "R0001-DONA_01", "trapper", "Trapper refused it")
        failed = states()
        local_folder_service.set_upload_failure(tmp_path, "DONA", "R0001-DONA_01", "trapper", None)     # it worked on the second try
        retried = states()

    assert planned["R0001-DONA_01"] == [("trapper", "planned")]
    assert both["R0001-DONA_01"] == [("trapper", "planned"), ("agouti", "planned")]    # one upload for each uploader in use
    assert failed["R0001-DONA_01"] == [("trapper", "failed"), ("agouti", "planned")]
    assert retried["R0001-DONA_01"] == [("trapper", "planned"), ("agouti", "planned")]  # the failure is gone: it can be tried again


def test_a_deployment_that_will_not_be_made_has_no_upload_planned(tmp_path: Path):
    with _in(tmp_path):
        _project(archived=(2, 3))
        _save({**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "camera_id": "P800", "date": "2024-09-04", "session": "R0001"})
        _save({**VISIT, "actions": ["Stolen"], "camera_id": "P800", "num_photos": None, "sd": None, "date": "2024-10-12", "session": "R0002"})
        shown = _client().post("/api/visits/deployments", json={"research_project_id": "DONA"}).json()["results"]

    assert [(d["no_images"], d["upload_states"]) for d in shown] == [("stolen", [])]   # the card is gone: nothing to upload


def test_a_visit_that_finds_the_camera_stolen_and_puts_up_another_opens_a_deployment_for_the_new_one(tmp_path: Path):
    with _in(tmp_path):
        _project(archived=(2, 3))
        _save({**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "camera_id": "P800", "date": "2024-09-04", "session": "R0001"})
        _save({**VISIT, "actions": ["Stolen", "Installation"], "num_photos": None, "sd": "B2", "camera_id": "P900", "date": "2024-10-12", "session": "R0002"})
        shown = _client().post("/api/visits/deployments", json={"research_project_id": "DONA"}).json()["results"]
        listed = _client().post("/api/visits/list", json={"research_project_id": "DONA"}).json()["results"]

    by_id = {d["deployment_id"]: d for d in shown}
    assert (by_id["R0001-DONA_01"]["status"], by_id["R0001-DONA_01"]["no_images"]) == ("closed", "stolen")       # the first camera went with its card
    assert by_id["R0002-DONA_01"]["status"] == "open" and by_id["R0002-DONA_01"]["camera_id"] == "P900"          # the new one is out
    assert [(v["session"], v["state"]) for v in listed] == [("R0001", "stolen"), ("R0002", "deployed")]


def test_importing_a_csv_creates_the_locations_cameras_and_sd_cards_it_is_asked_to_and_keeps_them(tmp_path: Path):
    csv = ("site,what,day,hour,lat,lon,llat,llon,tz,cam,model,sd,brand\n"
           "DONA_09,Installation,2026-09-14,11:40,37.1002,-6.4001,37.1,-6.4,Europe/Madrid,CAM9,Browning,S9,SanDisk\n")
    body = {"research_project_id": "DONA", "csv": csv, "format": "mapped", "create": {"locations": True, "cameras": True, "sd_cards": True}, "defaults": {"daylight_saving": "yes"},
            "mapping": {"location_id": "site", "actions": "what", "date": "day", "time": "hour", "latitude": "lat", "longitude": "lon", "location_latitude": "llat", "location_longitude": "llon", "timezone": "tz",
                        "camera_id": "cam", "camera_model": "model", "sd": "sd", "sd_brand": "brand"}}
    with _in(tmp_path):
        _client().post("/api/deployment-import/research-projects/save", json=PROJECT)
        shown = _client().post("/api/visits/import-csv", json=body).json()
        before = _client().post("/api/deployment-import/locations/list", json={"research_project_id": "DONA"}).json()["results"]
        kept = _client().post("/api/visits/import-csv", json={**body, "save": True}).json()
        locations = _client().post("/api/deployment-import/locations/list", json={"research_project_id": "DONA"}).json()["results"]
        cameras = (tmp_path / "DONA" / "cameras.json").read_text(encoding="utf-8")
        cards = (tmp_path / "DONA" / "sd_cards.json").read_text(encoding="utf-8")
        columns = _client().post("/api/visits/csv-columns", json={"csv": csv}).json()

    assert shown["saved"] is None and before == [] and len(shown["create"]["locations"]) == 1   # reading creates nothing
    assert kept["saved"] == 1
    assert [(l["location_id"], l["timezone"], l["latitude"]) for l in locations] == [("DONA_09", "Europe/Madrid", 37.1)]   # the location has its own coordinates, not the visit's
    assert "CAM9" in cameras and "Browning" in cameras and "S9" in cards and "SanDisk" in cards
    sd_brand = next(f for f in columns["fields"] if f["field"] == "sd_brand")
    assert sd_brand["entity"] == "sd_cards" and sd_brand["required_with"] == []
    assert next(f for f in columns["fields"] if f["field"] == "location_latitude")["required_with"] == ["locations"]
    assert next(f for f in columns["fields"] if f["field"] == "latitude")["required_with"] == []


def test_the_entries_of_epicollect_are_downloaded_as_a_csv(monkeypatch):
    from wildintel_uploader.core.services import epicollect_service
    monkeypatch.setattr(epicollect_service, "visits_csv", lambda settings=None: "location_id,date\nA,2026-01-01\n")
    body = _client().post("/api/visits/epicollect-download").json()
    assert body == {"csv": "location_id,date\nA,2026-01-01\n", "count": 1}


def test_a_visit_by_hand_is_after_the_last_one_to_its_site_and_after_the_revisions_before_its_own(tmp_path: Path):
    with _in(tmp_path):
        _project(archived=(2, 3))
        _save({**VISIT, "session": "R0012", "date": "2026-01-10", "actions": ["Installation"], "num_photos": None, "sd": "A13"})
        same_revision = _save({**VISIT, "session": "R0012", "date": "2026-02-10"})            # a revision is one visit to each site
        before = _save({**VISIT, "session": "R0013", "date": "2026-01-05"})                   # not after the last visit to the site
        after = _save({**VISIT, "session": "R0013", "date": "2026-02-10"})

    assert same_revision.status_code == 422 and "already has a visit in R0012" in same_revision.json()["detail"]
    assert before.status_code == 422 and "has to be after the last one, on 2026-01-10" in before.json()["detail"]
    assert after.status_code == 200


def test_a_revision_starts_after_the_last_visit_of_the_one_before(tmp_path: Path):
    with _in(tmp_path):
        _project(archived=(3,))
        first = {**VISIT, "session": "R0012", "actions": ["Installation"], "num_photos": None, "sd": "A13"}
        _save({**first, "date": "2026-01-10"})
        _save({**first, "location_id": "DONA_02", "date": "2026-01-20", "camera_id": "77", "sd": "Z9"})
        too_early = _save({**VISIT, "session": "R0013", "date": "2026-01-15"})   # after its own site's visit, before the last of R0012
        in_time = _save({**VISIT, "session": "R0013", "date": "2026-01-21"})

    assert too_early.status_code == 422 and "R0013 has to be after R0012" in too_early.json()["detail"]
    assert in_time.status_code == 200


def test_a_file_that_starts_after_the_first_revision_leaves_the_ones_before_unknown_and_a_known_visit_takes_the_place(tmp_path: Path):
    from wildintel_uploader.core.services import local_folder_service
    with _in(tmp_path):
        _project(archived=(3,))
        text = ("location_id,actions,date,time,session,camera_id,sd\n"
                "DONA_01,Installation,2026-10-19,11:40:00,R0003,C1,S1\n"
                "DONA_02,Installation,2026-10-19,12:40:00,R0003,C2,S2\n")
        mapping = {"location_id": "location_id", "actions": "actions", "date": "date", "time": "time", "session": "session", "camera_id": "camera_id", "sd": "sd"}
        body = {"research_project_id": "DONA", "csv": text, "format": "mapped", "mapping": mapping}
        shown = _client().post("/api/visits/import-csv", json=body).json()
        assert [(u["location_id"], u["session"]) for u in shown["unknown"]] == [("DONA_01", "R0001"), ("DONA_02", "R0001"), ("DONA_01", "R0002"), ("DONA_02", "R0002")]
        assert local_folder_service.list_unknown(tmp_path, "DONA") == []   # reading keeps nothing
        kept = _client().post("/api/visits/import-csv", json={**body, "save": True}).json()
        assert kept["saved"] == 2 and not kept["problems"]
        assert len(local_folder_service.list_unknown(tmp_path, "DONA")) == 4
        # a visit that is known takes the place of the unknown one of its site in its revision
        local_folder_service.write_visits(tmp_path, "DONA", [{"location_id": "DONA_01", "session": "R0001", "date": "2026-08-01", "time": "10:00:00", "when": "2026-08-01T10:00:00Z", "actions": ["Installation"], "camera_id": "C0"}])
        left = local_folder_service.list_unknown(tmp_path, "DONA")
        assert ("DONA_01", "R0001") not in {(u["location_id"], u["session"]) for u in left} and len(left) == 3


# ── editing a visit ──────────────────────────────────────────────────────────

def _edit(visit: dict, location_id: str = "DONA_01", session: str | None = None):
    return _client().post("/api/visits/update", json={"research_project_id": "DONA", "location_id": location_id, "session": session or visit["session"], "visit": visit})


def _revision(session="R0013", date="2026-02-01", **changes) -> dict:
    return {**VISIT, "session": session, "date": date, "time": "10:00:00", "actions": ["Revision"], "camera_id": "12", "sd": "N1", "num_photos": 100, **changes}


def test_a_visit_is_edited_where_it_is_and_what_does_not_matter_to_the_rules_changes(tmp_path: Path):
    with _in(tmp_path):
        _project(); _installed()
        assert _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": _revision()}).status_code == 200
        edited = _edit(_revision(comments="Rained", num_photos=250))
        assert edited.status_code == 200, edited.text
        kept = next(v for v in _client().post("/api/visits/list", json={"research_project_id": "DONA", "location_id": "DONA_01"}).json()["results"] if v["session"] == "R0013")
        assert (kept["comments"], kept["num_photos"]) == ("Rained", 250)
        assert len(_client().post("/api/visits/list", json={"research_project_id": "DONA"}).json()["results"]) == 4   # none was added


def test_an_edit_that_puts_the_visit_before_the_one_that_precedes_it_is_refused_and_nothing_changes(tmp_path: Path):
    with _in(tmp_path):
        _project(); _installed()
        _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": _revision()})
        refused = _edit(_revision(date="2026-01-05"))
        assert refused.status_code == 422 and "can only be an Installation" in refused.text and "R0012" in refused.text
        kept = next(v for v in _client().post("/api/visits/list", json={"research_project_id": "DONA"}).json()["results"] if v["session"] == "R0013" and v["location_id"] == "DONA_01")
        assert kept["date"] == "2026-02-01"


def test_an_edit_that_makes_a_later_visit_impossible_is_refused_telling_which(tmp_path: Path):
    with _in(tmp_path):
        _project(); _installed()
        _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": _revision()})
        # the camera of the installation changes, and the revision after it is of another one
        install = next(v for v in _client().post("/api/visits/list", json={"research_project_id": "DONA", "location_id": "DONA_01"}).json()["results"] if v["session"] == "R0012")
        refused = _edit({**install, "camera_id": "99"})
        assert refused.status_code == 422 and "R0013" in refused.text and "would no longer be possible" in refused.text


def test_a_visit_that_starts_or_closes_an_imported_deployment_cannot_be_edited(tmp_path: Path):
    with _in(tmp_path):
        _project(); _installed()
        _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": _revision()})
        assert _edit(_revision(comments="before")).status_code == 200
        assert _client().post("/api/visits/link", json={"research_project_id": "DONA", "location_id": "DONA_01", "date": "2026-02-01", "time": "10:00:00", "deployment_id": "R0013-DONA_01"}).status_code == 200
        assert _edit(_revision(comments="after")).status_code == 409
        install = next(v for v in _client().post("/api/visits/list", json={"research_project_id": "DONA", "location_id": "DONA_01"}).json()["results"] if v["session"] == "R0012")
        assert _edit(install).status_code == 409                       # the one that started it
        other = next(v for v in _client().post("/api/visits/list", json={"research_project_id": "DONA", "location_id": "DONA_02"}).json()["results"])
        assert _edit({**other, "comments": "free"}, "DONA_02").status_code == 200   # another site is not touched
        book = _client().post("/api/visits/book", json={"research_project_id": "DONA"}).json()["results"]
        assert {(v["location_id"], v["session"]): v["locked"] for v in book if not v.get("not_done")}[("DONA_01", "R0013")] is True


def test_a_visit_linked_to_its_deployment_where_it_starts_it_locks_the_two_visits_of_the_deployment(tmp_path: Path):
    with _in(tmp_path):
        _project(); _installed()
        _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": _revision()})
        # the app links the deployment on the visit that left the camera: the installation
        assert _client().post("/api/visits/link", json={"research_project_id": "DONA", "location_id": "DONA_01", "date": "2026-01-10", "time": "08:14:05", "deployment_id": "R0012-DONA_01"}).status_code == 200
        book = _client().post("/api/visits/book", json={"research_project_id": "DONA"}).json()["results"]
        locked = {(v["location_id"], v["session"]): v["locked"] for v in book if not v.get("not_done")}
        install = next(v for v in _client().post("/api/visits/list", json={"research_project_id": "DONA", "location_id": "DONA_01"}).json()["results"] if v["session"] == "R0012")
        edits = (_edit(install).status_code, _edit(_revision(comments="after")).status_code)

    assert locked[("DONA_01", "R0012")] is True and locked[("DONA_01", "R0013")] is True and edits == (409, 409)


def test_an_unknown_visit_is_filled_by_a_known_one_where_its_day_puts_it(tmp_path: Path):
    from wildintel_uploader.core.services import local_folder_service
    with _in(tmp_path):
        _project(archived=(2, 3))
        later = {**VISIT, "session": "R0002", "date": "2026-03-01", "time": "10:00:00", "when": "2026-03-01T10:00:00Z", "actions": ["Revision"], "camera_id": "C1", "sd": "S1", "num_photos": 5}
        local_folder_service.write_field_items(tmp_path, "DONA", "cameras", [{"label": "C1", "camera_id": "C1", "camera_model": None, "research_project": "DONA"}])
        local_folder_service.write_field_items(tmp_path, "DONA", "sd_cards", [{"label": label, "research_project": "DONA"} for label in ("S0", "S1")])
        local_folder_service.write_visits(tmp_path, "DONA", [later])
        local_folder_service.write_unknown(tmp_path, "DONA", [{"location_id": "DONA_01", "session": "R0001"}])
        book = _client().post("/api/visits/book", json={"research_project_id": "DONA"}).json()["results"]
        assert any(v.get("unknown") and v["session"] == "R0001" and v["state"] == "unknown" for v in book)
        # a camera put up in R0001 is the one the revision of R0002 finds: the unknown one is filled
        first = {**VISIT, "session": "R0001", "date": "2026-01-10", "actions": ["Installation"], "camera_id": "C1", "num_photos": None, "sd": "S0"}
        saved = _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": first})
        assert saved.status_code == 200, saved.text
        assert local_folder_service.list_unknown(tmp_path, "DONA") == []


@pytest.mark.entities
def test_an_edit_cannot_put_a_camera_an_sd_card_or_a_trapper_that_does_not_exist(tmp_path: Path):
    from wildintel_uploader.core.services import local_folder_service
    with _in(tmp_path):
        _project()
        local_folder_service.write_field_items(tmp_path, "DONA", "cameras", [{"label": c, "camera_id": c, "camera_model": None, "research_project": "DONA"} for c in ("12", "C2", "C3")])
        local_folder_service.write_field_items(tmp_path, "DONA", "sd_cards", [{"label": c, "research_project": "DONA"} for c in ("S1", "S2", "S3", "N1")])
        _installed()
        _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": _revision()})
        for change, said in (({"camera_id": "NOPE"}, "camera NOPE"), ({"sd": "NOPE"}, "SD card NOPE"), ({"trappers": "Nobody"}, "Nobody is not one of the trappers")):
            refused = _edit(_revision(**change))
            assert refused.status_code == 422 and said in refused.text, refused.text
        # what the visit already had stays, as it may have been kept without being listed
        assert _edit(_revision(comments="same camera, same card")).status_code == 200


def test_an_edit_cannot_take_a_visit_past_those_of_another_revision_nor_leave_a_later_one_without_what_it_needed(tmp_path: Path):
    with _in(tmp_path):
        _project(); _installed()
        _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": _revision()})
        _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": _revision(location_id="DONA_02", date="2026-02-05", camera_id="C2")})
        install1 = next(v for v in _client().post("/api/visits/list", json={"research_project_id": "DONA", "location_id": "DONA_01"}).json()["results"] if v["session"] == "R0012")
        # the installation of one site goes past the revision of another: R0012 has to be before R0013
        refused = _edit({**install1, "date": "2026-02-10"})
        assert refused.status_code == 422 and "R0012 has to be before R0013" in refused.text
        # and past the revision of its own site, which would lose the camera it needed
        assert "DONA_01" in refused.text



_COLUMNS = ("location_id", "actions", "date", "time", "session", "camera_id", "sd", "num_photos")


def _read(text: str, save: bool = False) -> dict:
    csv = ",".join(_COLUMNS) + "\n" + text
    return _client().post("/api/visits/import-csv", json={"research_project_id": "DONA", "csv": csv, "save": save, "format": "mapped", "mapping": {c: c for c in _COLUMNS}}).json()


def test_a_site_that_the_revision_given_later_does_not_have_is_put_up_in_the_next_one_and_nothing_is_said_when_it_is(tmp_path: Path):
    with _in(tmp_path):
        _project()
        _read("DONA_01,Revision,2026-03-01,10:00:00,R0002,C1,S2,100\nDONA_02,Revision,2026-03-01,11:00:00,R0002,C2,S2b,100\nDONA_03,Installation,2026-03-01,12:00:00,R0002,C3,S2c,\n", save=True)
        # R1 has two of the three sites: the third is the one that R2 puts up
        said = _read("DONA_01,Installation,2026-01-10,10:00:00,R0001,C1,S1,\nDONA_02,Installation,2026-01-10,11:00:00,R0001,C2,S1b,\n")
        assert not any("DONA_03" in w for w in said["warnings"])


def test_a_site_that_the_revision_given_later_does_not_have_and_the_next_one_only_revises_is_told(tmp_path: Path):
    with _in(tmp_path):
        _project()
        _read("DONA_01,Revision,2026-03-01,10:00:00,R0002,C1,S2,100\nDONA_03,Revision,2026-03-01,12:00:00,R0002,C3,S2c,100\n", save=True)
        said = _read("DONA_01,Installation,2026-01-10,10:00:00,R0001,C1,S1,\nDONA_02,Installation,2026-01-10,11:00:00,R0001,C2,S1b,\n")   # R0001 is finished with the two sites: DONA_03 is unknown in it
        assert any("R0002 DONA_03" in w and "Installation" in w for w in said["warnings"]), said["warnings"]
        assert not any("DONA_01" in w and "has to be put up" in w for w in said["warnings"])


def test_a_visit_of_a_revision_is_after_those_of_the_revisions_before_it_and_before_those_after_it_in_a_file_too(tmp_path: Path):
    with _in(tmp_path):
        _project()
        _read("DONA_01,Revision,2026-03-01,10:00:00,R0002,C1,S2,100\n", save=True)
        late = _read("DONA_02,Installation,2026-05-10,10:00:00,R0001,C2,S1b,\nDONA_03,Installation,2026-01-10,10:00:00,R0001,C3,S1c,\n")
        assert [(p["row"], "R0001 has to be before R0002" in p["message"]) for p in late["problems"]] == [(2, True)]
        assert [v["location_id"] for v in late["visits"]] == ["DONA_03"]
        # in the same file, when two visits are at odds both are told
        both = _read("DONA_02,Installation,2026-05-10,10:00:00,R0001,C2,S1b,\nDONA_03,Revision,2026-04-01,10:00:00,R0002,C3,S2c,5\n")
        assert sorted(p["row"] for p in both["problems"]) == [2, 3]


# ── the new form of Epicollect: its cut headers, the inactive site and the camera removed after a theft ─────────

def test_an_inactive_site_has_a_camera_put_up_again_and_a_camera_removed_after_a_theft_is_a_theft_alone():
    from wildintel_uploader.core.services import epicollect_service
    actions = epicollect_service.visit_actions
    assert actions("New site", None, None) == actions("Inactive site", None, None) == "Installation"
    assert actions("Stolen", None, "Camera replacement") == "Stolen + Installation"
    assert actions("Stolen", None, "Site removal") == "Stolen + Archive"
    assert actions("Stolen", None, "Camera removal") == "Stolen"          # the site stays open
    assert actions("Stolen", None, "None") == "Stolen"                    # the form now says it too: nothing is done after the theft, the site stays open
    assert actions("OK", "Keep the camera", None) == "Revision"
    assert actions("OK", "Camera removal", None) == "Revision + Desinstallation"


def test_the_download_of_the_new_form_is_read_by_its_headers_cut_at_20_characters():
    import csv
    import io

    from wildintel_uploader.core.services import epicollect_service
    folder = Path(__file__).parents[2] / "examples" / "visits_example" / "wildintel_csv" / "wicp_02"

    def read(name: str) -> tuple[str, list[dict]]:
        text = (folder / name).read_text(encoding="utf-8")
        return text, list(csv.DictReader(io.StringIO(epicollect_service.visits_from_csv(text))))

    text, rows = read("revision_5_replacement_removal_and_site_given_up.csv")
    assert all(h in text for h in ("4_Status_of_the_came", "7_N_pictures_collect", "9_Action_after_inspe", "10_Action_after_thef"))   # as Epicollect5 cuts them
    assert [r["actions"] for r in rows] == ["Revision + Desinstallation + Installation", "Revision + Desinstallation", "Installation", "Revision + Desinstallation + Archive"]

    _, rows = read("revision_2_all_revised.csv")
    assert len(rows) == 4 and [r["actions"] for r in rows] == ["Revision"] * 4
    assert (rows[0]["num_photos"], rows[0]["card_status"], rows[2]["card_status"], rows[3]["battery_status"]) == ("1420", "OK", "Full Card", "No batteries")

    _, rows = read("revision_1_installation.csv")
    assert rows[0]["sd"] == "1" and rows[0]["camera_id"] == "BR5071050724" and rows[0]["trappers"] == "Ana Pérez"


def test_a_file_can_close_the_revision_before_its_own_marking_the_locations_still_planned_as_not_visited(tmp_path: Path):
    text = "location_id,session,date,time,actions,num_photos\nDONA_01,R0013,2026-10-02,08:00,Revision,5\n"
    mapping = {c: c for c in ("location_id", "session", "date", "time", "actions", "num_photos")}

    def read(close: bool, save: bool = False) -> dict:
        return _client().post("/api/visits/import-csv", json={"research_project_id": "DONA", "csv": text, "format": "mapped", "mapping": mapping, "close_revisions": close, "save": save}).json()

    with _in(tmp_path):
        _project(archived=(3,))
        _installed((1,))                                    # R0012: only DONA_01 (DONA_03 is archived): DONA_02 is still planned in it
        refused = read(False)
        closing = read(True)
        saved = read(True, save=True)
        marked = [v for v in _client().post("/api/visits/list", json={"research_project_id": "DONA"}).json()["results"] if v.get("camera_status") == "Not revised"]

    assert refused["problems"] and "R0012 is not finished" in refused["problems"][0]["message"]    # without asking, the revision before has to be finished
    assert closing["problems"] == [] and [m["location_id"] for m in closing["closed"]] == ["DONA_02"] and any("marked as not visited" in n for n in closing["notes"])
    assert saved["problems"] == []
    assert [(v["location_id"], v["session"]) for v in marked] == [("DONA_02", "R0012")]


def test_a_site_given_up_in_a_revision_of_the_file_is_not_marked_as_not_visited_in_the_revisions_after_it(tmp_path: Path):
    """A file with several revisions, closing each one before the next: the site archived in one of them is out of use in the revisions after it,
    as it would be if the revisions came in one file each."""
    rows = ["DONA_01,R0013,2026-02-01,08:00,Revision,5", "DONA_02,R0013,2026-02-01,09:00,Revision + Desinstallation + Archive,5",
            "DONA_01,R0014,2026-03-01,08:00,Revision,5", "DONA_01,R0015,2026-04-01,08:00,Revision,5"]
    text = "location_id,session,date,time,actions,num_photos\n" + "\n".join(rows) + "\n"
    mapping = {c: c for c in ("location_id", "session", "date", "time", "actions", "num_photos")}
    with _in(tmp_path):
        _project(archived=(3,))
        _installed((1, 2))
        answer = _client().post("/api/visits/import-csv", json={"research_project_id": "DONA", "csv": text, "format": "mapped", "mapping": mapping, "close_revisions": True}).json()

    assert answer["problems"] == []
    assert [(m["location_id"], m["session"]) for m in answer["closed"]] == []      # DONA_02 was given up in R0013: nothing is waited for it in R0014 nor R0015


def _read_file(rows: list[str], save: bool = False, close: bool = True) -> dict:
    text = "location_id,session,date,time,actions,num_photos\n" + "\n".join(rows) + "\n"
    mapping = {c: c for c in ("location_id", "session", "date", "time", "actions", "num_photos")}
    return _client().post("/api/visits/import-csv", json={"research_project_id": "DONA", "csv": text, "format": "mapped", "mapping": mapping, "close_revisions": close, "save": save}).json()


def test_a_site_whose_camera_was_stolen_and_given_up_is_out_of_use_in_the_revisions_after_it_in_the_file(tmp_path: Path):
    rows = ["DONA_01,R0013,2026-02-01,08:00,Revision,5", "DONA_02,R0013,2026-02-01,09:00,Stolen + Archive,",
            "DONA_01,R0014,2026-03-01,08:00,Revision,5", "DONA_01,R0015,2026-04-01,08:00,Revision,5"]
    with _in(tmp_path):
        _project(archived=(3,))
        _installed((1, 2))
        answer = _read_file(rows)

    assert answer["problems"] == [] and answer["closed"] == []


def test_a_site_given_up_late_in_the_file_is_not_marked_as_not_visited_before_it_either_its_earlier_gap_is_unknown(tmp_path: Path):
    """The site is out of use *from* the revision that gives it up. Before it the file has no visit of it, but a visit of it comes later, so what the revision before has of it is unknown — not a false
    "not visited" — as it is without this fix; and after it nothing is waited for."""
    rows = ["DONA_01,R0013,2026-02-01,08:00,Revision,5",
            "DONA_01,R0014,2026-03-01,08:00,Revision,5", "DONA_02,R0014,2026-03-01,09:00,Revision + Desinstallation + Archive,5",
            "DONA_01,R0015,2026-04-01,08:00,Revision,5"]
    with _in(tmp_path):
        _project(archived=(3,))
        _installed((1, 2))
        answer = _read_file(rows)

    assert answer["problems"] == []
    assert answer["closed"] == []                                                                       # no "not visited" in R0013, R0014 (it gave it up) nor R0015
    assert any("R0013 is created, but there is no data of its visits to DONA_02" in n for n in answer["notes"])


def test_a_site_given_up_in_the_file_does_not_stop_the_revisions_after_it_from_starting_when_the_revision_is_not_closed_by_the_file(tmp_path: Path):
    rows = ["DONA_01,R0013,2026-02-01,08:00,Revision,5", "DONA_02,R0013,2026-02-01,09:00,Revision + Desinstallation + Archive,5",
            "DONA_01,R0014,2026-03-01,08:00,Revision,5"]
    with _in(tmp_path):
        _project(archived=(3,))
        _installed((1, 2))
        answer = _read_file(rows, close=False)

    assert answer["problems"] == []                        # R0013 is finished — DONA_02 is given up, not waited for — so R0014 can start


def test_what_is_kept_of_a_site_given_up_in_the_file_is_the_visits_and_no_false_not_visited_ones(tmp_path: Path):
    rows = ["DONA_01,R0013,2026-02-01,08:00,Revision,5", "DONA_02,R0013,2026-02-01,09:00,Revision + Desinstallation + Archive,5",
            "DONA_01,R0014,2026-03-01,08:00,Revision,5", "DONA_01,R0015,2026-04-01,08:00,Revision,5"]
    with _in(tmp_path):
        _project(archived=(3,))
        _installed((1, 2))
        saved = _read_file(rows, save=True)
        kept = _client().post("/api/visits/list", json={"research_project_id": "DONA"}).json()["results"]

    assert saved["problems"] == []
    assert not [v for v in kept if v.get("camera_status") == "Not revised"]
    assert sorted((v["location_id"], v["session"]) for v in kept if v["session"] in ("R0013", "R0014", "R0015")) == [
        ("DONA_01", "R0013"), ("DONA_01", "R0014"), ("DONA_01", "R0015"), ("DONA_02", "R0013")]


def test_the_locations_as_the_visits_of_a_file_leave_them():
    from wildintel_uploader.core.services.visits_csv import _archived_by

    sites = [{"location_id": "DONA_01", "status": "active"}, {"location_id": "DONA_02", "status": "active"}, {"location_id": "DONA_03", "status": "archived", "status_date": "2026-01-01"},
             {"location_id": "DONA_04", "status": "archived", "status_date": "2026-05-01"}]
    visits = [{"location_id": "dona_02", "date": "2026-03-01", "actions": ["Archive"]}, {"location_id": "DONA_02", "date": "2026-02-01", "actions": ["Revision", "Archive"]},
              {"location_id": "DONA_01", "date": "2026-02-01", "actions": ["Revision"]}, {"location_id": "DONA_03", "date": "2026-06-01", "actions": ["Archive"]},
              {"location_id": "DONA_04", "date": "2026-03-01", "actions": ["Archive"]}]

    left = {l["location_id"]: l for l in _archived_by(sites, visits)}

    assert left["DONA_01"] is sites[0]                                                         # a visit that does not archive changes nothing
    assert (left["DONA_02"]["status"], left["DONA_02"]["status_date"]) == ("archived", "2026-02-01")   # the earliest of its visits, whatever the case of the id
    assert left["DONA_03"] is sites[2]                                                         # archived before: as it was
    assert left["DONA_04"]["status_date"] == "2026-03-01"                                      # archived later than the file says it was given up: the earlier day is the one
    assert sites[1]["status"] == "active"                                                      # the locations that were given are not changed


def test_only_one_save_of_visits_runs_at_a_time_for_a_research_project(tmp_path: Path):
    """Pressing Add again while the visits are being saved does not start a second save that would keep them twice: it is refused, and reading is not."""
    from wildintel_uploader.web.api.routers import visits as router
    text = "location_id,session,date,time,actions,num_photos\nDONA_01,R0013,2026-02-01,08:00,Revision,5\n"
    mapping = {c: c for c in ("location_id", "session", "date", "time", "actions", "num_photos")}
    body = {"research_project_id": "DONA", "csv": text, "format": "mapped", "mapping": mapping, "close_revisions": True}
    with _in(tmp_path):
        _project(archived=(3,))
        _installed((1, 2))
        lock = router._save_lock("DONA")
        lock.acquire()                                       # a save of DONA is running
        try:
            busy = _client().post("/api/visits/import-csv", json={**body, "save": True})
            read = _client().post("/api/visits/import-csv", json=body)
        finally:
            lock.release()
        saved = _client().post("/api/visits/import-csv", json={**body, "save": True})

    assert busy.status_code == 409 and "already being saved" in busy.json()["detail"]
    assert read.status_code == 200
    assert saved.status_code == 200 and saved.json()["saved"]


def test_the_save_lock_is_let_go_when_a_save_fails_and_each_research_project_has_its_own(tmp_path: Path, monkeypatch):
    from fastapi.testclient import TestClient

    from wildintel_uploader.web.api.routers import visits as router
    from wildintel_uploader.web.main import app
    text = "location_id,session,date,time,actions,num_photos\nDONA_01,R0013,2026-02-01,08:00,Revision,5\n"
    mapping = {c: c for c in ("location_id", "session", "date", "time", "actions", "num_photos")}
    body = {"research_project_id": "DONA", "csv": text, "format": "mapped", "mapping": mapping, "close_revisions": True, "save": True}
    real = router._import_visits_csv

    def broken(req):
        raise RuntimeError("the disk is full")

    with _in(tmp_path):
        _project(archived=(3,))
        _installed((1, 2))
        monkeypatch.setattr(router, "_import_visits_csv", broken)
        failed = TestClient(app, raise_server_exceptions=False).post("/api/visits/import-csv", json=body)
        monkeypatch.setattr(router, "_import_visits_csv", real)
        again = _client().post("/api/visits/import-csv", json=body)
        # a save of one research project does not hold the others, and its name is the same whatever its case
        lock = router._save_lock("DONA")
        free = lock.acquire(blocking=False)          # a save that failed left it free (a test that waits here forever would be the lock kept)
        try:
            other = router._save_lock("OTHER").acquire(blocking=False)
            same = router._save_lock("dona").acquire(blocking=False)
        finally:
            if free:
                lock.release()
            if other:
                router._save_lock("OTHER").release()

    assert failed.status_code == 500
    assert free and again.status_code == 200 and again.json()["saved"]    # the failed save did not keep the next ones out
    assert other is True and same is False


def test_saving_the_same_file_again_keeps_nothing_twice_not_even_the_not_visited_visits_that_closing_a_revision_made(tmp_path: Path):
    """The *already kept* check covers what the closing of the revision before creates too: a second save of the file — pressed again, or after a failure — adds nothing."""
    rows = ["DONA_01,R0013,2026-02-01,08:00,Revision,5"]
    with _in(tmp_path):
        _project(archived=(3,))
        _installed((1,))                                    # R0012: only DONA_01, so closing it marks DONA_02 as not visited
        first = _read_file(rows, save=True)
        second = _read_file(rows, save=True)
        kept = _client().post("/api/visits/list", json={"research_project_id": "DONA"}).json()["results"]

    assert first["saved"] == 1 and [(m["location_id"], m["session"]) for m in first["closed"]] == [("DONA_02", "R0012")]
    assert second["saved"] == 0 and second["skipped"] == 1 and second["closed"] == []
    assert sorted((v["location_id"], v["session"], v.get("camera_status")) for v in kept if v["session"] in ("R0012", "R0013")) == [
        ("DONA_01", "R0012", None), ("DONA_01", "R0013", None), ("DONA_02", "R0012", "Not revised")]


def _read_with_gear(rows: list[str], save: bool = False) -> dict:
    text = "location_id,session,date,time,actions,num_photos,camera_id,sd\n" + "\n".join(rows) + "\n"
    mapping = {c: c for c in ("location_id", "session", "date", "time", "actions", "num_photos", "camera_id", "sd")}
    return _client().post("/api/visits/import-csv", json={"research_project_id": "DONA", "csv": text, "format": "mapped", "mapping": mapping, "close_revisions": False, "save": save}).json()


def test_a_site_that_says_site_start_has_nothing_unknown_before_it_and_one_that_does_not_say_it_has(tmp_path: Path):
    started = ["DONA_01,R0013,2026-02-01,08:00,Revision,5,,", "DONA_02,R0013,2026-02-01,09:00,Revision,5,,",
               "DONA_01,R0014,2026-03-01,08:00,Revision,5,,", "DONA_02,R0014,2026-03-01,09:00,Revision,5,,", "DONA_03,R0014,2026-03-01,10:00,Site start + Installation,,C9,S9"]
    plain = [*started[:4], "DONA_03,R0014,2026-03-01,10:00,Installation,,C9,S9"]
    with _in(tmp_path):
        _project()
        _installed((1, 2))
        _client().post("/api/deployment-import/sd-cards/save", json={"research_project_id": "DONA", "card": {"label": "S9"}})
        with_start = _read_with_gear(started)
        without = _read_with_gear(plain)

    assert with_start["problems"] == [] and not any("DONA_03" in n and "unknown" in n for n in with_start["notes"])
    assert without["problems"] == [] and any("DONA_03" in n and "unknown" in n for n in without["notes"])


def test_the_words_site_start_are_an_action_of_a_file():
    from wildintel_uploader.core.services import visits_csv

    assert [visits_csv.ACTIONS[w] for w in ("site start", "sitestart", "site_start", "site setup")] == ["SiteStart"] * 4


def test_a_planned_site_cannot_be_used_not_even_to_start_it_and_a_ready_one_that_starts_stays_ready_or_is_active_with_a_camera(tmp_path: Path):
    def site(n: int, status: str) -> None:
        _client().post("/api/deployment-import/locations/save", json={"research_project_id": "DONA", "location": {"location_id": f"DONA_0{n}", "name": f"Site {n}", "timezone": "UTC", "ignore_dst": False, "latitude": 37.0 + n / 100, "longitude": -6.5, "status": status}})

    def status_of(n: int) -> str:
        found = _client().post("/api/deployment-import/locations/list", json={"research_project_id": "DONA"}).json()["results"]
        return next(l["status"] for l in found if l["location_id"] == f"DONA_0{n}")

    def visit_to(n: int, actions: list[str]):
        return _save({**VISIT, "location_id": f"DONA_0{n}", "session": "R0001", "date": "2026-01-10", "actions": actions, "num_photos": None, "sd": f"S{n}", "camera_id": f"C{n}"})

    with _in(tmp_path):
        _client().post("/api/deployment-import/research-projects/save", json=PROJECT)
        site(4, "planned"); site(5, "ready"); site(6, "ready")
        planned = visit_to(4, ["SiteStart", "Installation"])             # a planned site is only in Settings: it cannot be used, and a start is a use
        only = visit_to(5, ["SiteStart"])                                # a ready site stays ready — nothing is put up
        installed = visit_to(6, ["SiteStart", "Installation"])           # and one that starts with an Installation is active
        result = {n: status_of(n) for n in (4, 5, 6)}

    assert planned.status_code == 422 and "is planned" in planned.json()["detail"]
    assert only.status_code == 200 and installed.status_code == 200
    assert result == {4: "planned", 5: "ready", 6: "active"}


def test_a_pending_site_starts_with_its_first_camera_and_is_ready_or_active_by_what_its_start_does(tmp_path: Path):
    def site(n: int) -> None:
        _client().post("/api/deployment-import/locations/save", json={"research_project_id": "DONA", "location": {"location_id": f"DONA_0{n}", "name": f"Site {n}", "timezone": "UTC", "ignore_dst": False, "latitude": 37.0 + n / 100, "longitude": -6.5, "status": "pending"}})

    def status_of(n: int) -> str:
        found = _client().post("/api/deployment-import/locations/list", json={"research_project_id": "DONA"}).json()["results"]
        return next(l["status"] for l in found if l["location_id"] == f"DONA_0{n}")

    def visit_to(n: int, actions: list[str], session: str = "R0001", day: str = "2026-01-10"):
        return _save({**VISIT, "location_id": f"DONA_0{n}", "session": session, "date": day, "actions": actions, "num_photos": None, "sd": f"S{n}", "camera_id": f"C{n}"})

    with _in(tmp_path):
        _client().post("/api/deployment-import/research-projects/save", json=PROJECT)
        site(4); site(5)
        before = status_of(4)
        first = visit_to(4, ["Installation"])                       # the first camera at a pending site: it says where the site starts
        only = visit_to(5, ["SiteStart"])                           # a start alone makes it ready
        kept = _client().post("/api/visits/list", json={"research_project_id": "DONA"}).json()["results"]
        result = {n: status_of(n) for n in (4, 5)}

    assert before == "pending"
    assert first.status_code == 200 and only.status_code == 200
    assert [v["actions"] for v in kept if v["location_id"] == "DONA_04"] == [["SiteStart", "Installation"]]
    assert result == {4: "active", 5: "ready"}


def test_knocked_down_and_damaged_are_not_accepted_as_the_status_of_a_camera_but_what_was_kept_with_them_is_still_read(tmp_path: Path):
    old = {**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "camera_id": "P800", "date": "2026-01-10", "session": "R0001"}
    with _in(tmp_path):
        _project(archived=(2, 3))
        _save(old)
        refused = [_save({**VISIT, "actions": ["Revision"], "camera_id": "P800", "num_photos": 10, "sd": "B2", "date": "2026-02-10", "session": "R0002", "camera_status": s}) for s in ("Knocked down", "Damaged")]
        accepted = _save({**VISIT, "actions": ["Revision"], "camera_id": "P800", "num_photos": 10, "sd": "B2", "date": "2026-02-10", "session": "R0002", "camera_status": "Altered"})
        # a visit kept before, with a status that is no longer accepted, is read as it was kept
        from wildintel_uploader.core.services import local_folder_service as lfs
        raw = lfs._raw_visits(tmp_path, "DONA")
        raw[-1]["camera_status"] = "Damaged"
        lfs._write_raw_visits(tmp_path, "DONA", raw)
        book = _client().post("/api/visits/book", json={"research_project_id": "DONA"}).json()["results"]

    assert [r.status_code for r in refused] == [422, 422] and all("OK, Altered, Stolen, Not revised, New site or Inactive site" in str(r.json()["detail"]) for r in refused)
    assert accepted.status_code == 200
    assert [v["camera_status"] for v in book if v["session"] == "R0002"] == ["Damaged"]


def test_a_file_with_knocked_down_or_damaged_says_the_status_is_not_one_of_the_ones_accepted(tmp_path: Path):
    text = "location_id,session,date,time,actions,num_photos,camera_status\nDONA_01,R0013,2026-02-01,08:00,Revision,5,Damaged\nDONA_02,R0013,2026-02-01,09:00,Revision,5,Knocked down\n"
    mapping = {c: c for c in ("location_id", "session", "date", "time", "actions", "num_photos", "camera_status")}
    with _in(tmp_path):
        _project(archived=(3,))
        _installed((1, 2))
        answer = _client().post("/api/visits/import-csv", json={"research_project_id": "DONA", "csv": text, "format": "mapped", "mapping": mapping}).json()

    assert answer["visits"] == [] and [p["row"] for p in answer["problems"]] == [2, 3]
    assert all("is not OK, Altered, Stolen, Not revised, New site or Inactive site" in p["message"] for p in answer["problems"])


def test_the_question_action_after_inspection_of_the_form_is_found_whole_and_cut_at_20_characters():
    import csv
    import io

    from wildintel_uploader.core.services import epicollect_service
    for header in ("10_Action_after_insp", "10_Action_after_inspection"):
        text = f"ec5_uuid,created_at,4_locationID,5_Status_of_the_came,{header}\nr1,2026-09-14T08:30:00.000Z,DONA_01,OK,Camera removal\n"
        [row] = list(csv.DictReader(io.StringIO(epicollect_service.visits_from_csv(text))))
        assert row["actions"] == "Revision + Desinstallation"


def test_the_revisions_in_a_row_that_are_unknown_are_told_once(tmp_path: Path):
    text = "location_id,session,date,time,actions,num_photos\nDONA_01,R0005,2026-10-02,08:00,Revision,5\n"
    mapping = {c: c for c in ("location_id", "session", "date", "time", "actions", "num_photos")}
    with _in(tmp_path):
        _project()
        notes = _client().post("/api/visits/import-csv", json={"research_project_id": "DONA", "csv": text, "format": "mapped", "mapping": mapping}).json()["notes"]

    assert [n for n in notes if "unknown visits" in n] == ["The revisions R0001–R0004 are created, but there is no data of their visits to DONA_01: they are created as unknown visits, and the visits after them cannot be checked against them."]


def test_the_examples_of_the_new_form_for_wicp_02_are_imported_in_order_with_no_problem(tmp_path: Path):
    """The six downloads of examples/visits_example/wildintel_csv/wicp_02, one after the other on the entities of examples/entities_example/wicp_02: the last makes a new site."""
    import csv

    from wildintel_uploader.core.services import local_folder_service as lfs
    examples = Path(__file__).parents[2] / "examples"
    rows = lambda name: list(csv.DictReader((examples / "entities_example" / "wicp_02" / name).open(encoding="utf-8")))
    order = ["revision_1_installation", "revision_2_all_revised", "revision_3_theft_replaced", "revision_4_theft_not_replaced", "revision_5_replacement_removal_and_site_given_up", "revision_6_new_site"]
    answers = []
    with _in(tmp_path), patch("wildintel_uploader.web.api.routers.visits._trapper_names", return_value=["Ana Pérez", "Luis Gómez"]):
        _client().post("/api/deployment-import/research-projects/save", json={**PROJECT, "name": "WICP_02", "acronym": "WICP_02"})
        for l in rows("locations.csv"):
            _client().post("/api/deployment-import/locations/save", json={"research_project_id": "WICP_02", "location": {
                "location_id": l["location_id"], "name": l["name"], "timezone": l["timezone"], "ignore_dst": l["ignore_dst"] == "true", "latitude": float(l["latitude"]),
                "longitude": float(l["longitude"]), "coordinate_uncertainty": int(l["coordinate_uncertainty"]), "status": l["status"]}})
        lfs.write_field_items(tmp_path, "WICP_02", "cameras", [{"label": r["label"], "camera_id": r["camera_id"], "camera_model": r["camera_model"], "status": r["status"]} for r in rows("cameras.csv")])
        lfs.write_field_items(tmp_path, "WICP_02", "sd_cards", [{"label": r["label"], "brand": r["brand"], "capacity": r["capacity"], "status": r["status"]} for r in rows("sd_cards.csv")])
        for name in order:
            text = (examples / "visits_example" / "wildintel_csv" / "wicp_02" / f"{name}.csv").read_text(encoding="utf-8")
            extra = {"create": {"locations": True, "cameras": True, "sd_cards": True}, "defaults": {"timezone": "UTC", "daylight_saving": "no"}} if name == order[-1] else {}
            answers.append(_client().post("/api/visits/import-csv", json={"research_project_id": "WICP_02", "csv": text, "format": "epicollect-csv", "save": True, **extra}).json())
        kept = _client().post("/api/visits/list", json={"research_project_id": "WICP_02"}).json()["results"]
        book = _client().post("/api/visits/book", json={"research_project_id": "WICP_02"}).json()["results"]

    assert [(a["problems"], a["saved"]) for a in answers] == [([], 4)] * 6
    # the visit that says New site is where its site starts (the form has no action for it), so the revisions before it have nothing of it: neither visits nor unknown ones
    assert [v["actions"] for v in kept if v["location_id"] == "WICP_02_005"][0][0] == "SiteStart"
    assert [v["session"] for v in book if v["location_id"] == "WICP_02_005"] == ["R0006"]
    made = answers[-1]["create"]
    assert [l["location_id"] for l in made["locations"]] == ["WICP_02_005"] and [c["camera_id"] for c in made["cameras"]] == ["GP1122334455"] and [c["label"] for c in made["sd_cards"]] == ["9"]


def test_a_visit_that_says_new_site_makes_its_site_with_no_need_of_the_switch_and_says_which_timezone_it_has(tmp_path: Path):
    examples = Path(__file__).parents[2] / "examples" / "visits_example" / "wildintel_csv" / "wicp_02"
    text = (examples / "revision_6_new_site.csv").read_text(encoding="utf-8")
    with _in(tmp_path), patch("wildintel_uploader.web.api.routers.visits._trapper_names", return_value=["Ana Pérez", "Luis Gómez"]):
        _client().post("/api/deployment-import/research-projects/save", json={**PROJECT, "name": "WICP_02", "acronym": "WICP_02"})
        asked = _client().post("/api/visits/import-csv", json={"research_project_id": "WICP_02", "csv": text, "format": "epicollect-csv", "create": {"cameras": True, "sd_cards": True}}).json()
        given = _client().post("/api/visits/import-csv", json={"research_project_id": "WICP_02", "csv": text, "format": "epicollect-csv", "create": {"cameras": True, "sd_cards": True},
                                                                 "defaults": {"timezone": "Europe/Madrid", "daylight_saving": "yes"}}).json()

    made = {l["location_id"]: l for l in asked["create"]["locations"]}
    assert list(made) == ["WICP_02_005"] and made["WICP_02_005"]["timezone"] == "UTC" and made["WICP_02_005"]["latitude"] == 37.0602   # the place of its visit
    assert any("WICP_02_005 is made because its visit says New site" in n for n in asked["notes"])
    assert {l["location_id"]: l["timezone"] for l in given["create"]["locations"]} == {"WICP_02_005": "Europe/Madrid"}


def test_the_download_of_the_new_form_needs_no_date_nor_time_a_visit_is_when_its_entry_was_created():
    from wildintel_uploader.core.services import epicollect_service
    text = "ec5_uuid,created_at,1_setupBy,4_locationID,5_Status_of_the_came,10_Action_after_the_\nr1,2026-09-14T08:30:00.000Z,Ana,DONA_01,OK,\n"
    import csv
    import io
    [row] = list(csv.DictReader(io.StringIO(epicollect_service.visits_from_csv(text))))
    assert row["location_id"] == "DONA_01" and row["created_at"] == "2026-09-14T08:30:00.000Z" and not row["date"] and not row["time"]


def test_the_download_of_the_new_form_can_create_what_does_not_exist_with_the_place_of_the_visit_as_the_one_of_a_new_location(tmp_path: Path):
    folder = Path(__file__).parents[2] / "examples" / "visits_example" / "wildintel_csv" / "wicp_02"
    text = (folder / "revision_1_installation.csv").read_text(encoding="utf-8")
    with _in(tmp_path):
        _client().post("/api/deployment-import/research-projects/save", json=PROJECT)
        trappers = {"Ana Pérez", "Luis Gómez"}
        with patch("wildintel_uploader.web.api.routers.visits._trapper_names", return_value=trappers):
            result = _client().post("/api/visits/import-csv", json={"research_project_id": "DONA", "csv": text, "format": "epicollect-csv",
                                                                     "create": {"locations": True, "cameras": True, "sd_cards": True}, "defaults": {"timezone": "Europe/Madrid", "daylight_saving": "yes"}}).json()

    created = result["create"]
    assert [l["location_id"] for l in created["locations"]] == ["WICP_02_001", "WICP_02_002", "WICP_02_003", "WICP_02_004"]
    assert all(l["timezone"] == "Europe/Madrid" and l["ignore_dst"] is False and l["latitude"] is not None for l in created["locations"])
    assert len(created["cameras"]) == 4 and len(created["sd_cards"]) == 4


# ── a visit says a camera, an SD card or a trapper that exist, by hand and in a file ────────────────────────────

@pytest.mark.entities
def test_a_visit_with_a_camera_an_sd_card_or_a_trapper_that_does_not_exist_is_refused_by_hand_and_in_a_file(tmp_path: Path):
    from wildintel_uploader.core.services import local_folder_service
    install = {**VISIT, "session": "R0001", "date": "2026-01-10", "actions": ["Installation"], "camera_id": "NOCAM", "sd": "NOSD", "trappers": "Nobody", "num_photos": None,
               "camera_height": 1, "camera_interval": 5, "camera_tilt": 0, "camera_heading": 90, "bait_use": False}
    with _in(tmp_path):
        _project(archived=(2, 3))
        by_hand = _client().post("/api/visits/save", json={"research_project_id": "DONA", "visit": install})
        text = "location_id,date,time,actions,camera_id,sd,trappers\nDONA_01,2026-10-02,08:00,Installation,NOCAM,NOSD,Nobody\n"
        refused = _import(tmp_path, text).json()
        # what the import is asked to create is not refused (the trappers are always refused: they are the settings')
        created = _client().post("/api/visits/import-csv", json={"research_project_id": "DONA", "csv": text.replace(",Nobody", ",Ana"), "format": "mapped", "create": {"cameras": True, "sd_cards": True},
                                                                  "mapping": {c: c for c in ("location_id", "date", "time", "actions", "camera_id", "sd", "trappers")}}).json()

    assert by_hand.status_code == 422
    for said in ("camera NOCAM", "SD card NOSD", "Nobody is not one of the trappers"):
        assert said in by_hand.text
    assert [p["row"] for p in refused["problems"]] == [2] and "NOCAM" in refused["problems"][0]["message"] and "Nobody" in refused["problems"][0]["message"]
    assert created["problems"] == [] and len(created["visits"]) == 1 and [c["camera_id"] for c in created["create"]["cameras"]] == ["NOCAM"]


def test_a_visit_that_left_no_camera_whether_it_took_it_away_found_it_stolen_or_gave_the_site_up_is_in_the_state_no_camera(tmp_path: Path):
    with _in(tmp_path):
        _project(archived=(2, 3))
        _save({**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "camera_id": "P800", "date": "2024-09-04", "session": "R0001"})
        _save({**VISIT, "actions": ["Revision", "Desinstallation"], "camera_id": "P800", "num_photos": 10, "sd": None, "date": "2024-10-12", "session": "R0002"})
        _save({**VISIT, "actions": ["Archive"], "camera_id": None, "num_photos": None, "sd": None, "date": "2024-11-12", "session": "R0003"})
        shown = _client().post("/api/visits/list", json={"research_project_id": "DONA"}).json()["results"]

    assert [(v["session"], v["state"]) for v in shown] == [("R0001", "collected"), ("R0002", "no_camera"), ("R0003", "no_camera")]


def test_the_cameras_and_the_cards_are_in_the_field_back_to_ready_or_archived_when_stolen(tmp_path: Path):
    from wildintel_uploader.core.services import local_folder_service as svc

    def status(kind: str) -> dict:
        return {i["label"]: (i["status"], i.get("archive_reason")) for i in svc.list_field_items(tmp_path, "DONA", kind)}

    with _in(tmp_path):
        _project(archived=(2, 3))
        svc.write_field_items(tmp_path, "DONA", "cameras", [{"label": l, "camera_id": l, "status": "ready"} for l in ("P800", "P900")])
        svc.write_field_items(tmp_path, "DONA", "sd_cards", [{"label": l, "status": "ready"} for l in ("A13", "B2", "C3")])
        _save({**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "camera_id": "P800", "date": "2024-09-04", "session": "R0001"})
        installed = (status("cameras"), status("sd_cards"))
        site_installed = svc.list_locations(tmp_path, "DONA")[0]["status"]
        _save({**VISIT, "actions": ["Revision"], "camera_id": "P800", "num_photos": 10, "sd": "B2", "date": "2024-10-12", "session": "R0002"})
        revised = status("sd_cards")
        _save({**VISIT, "actions": ["Revision", "Desinstallation"], "camera_id": "P800", "num_photos": 10, "sd": None, "date": "2024-11-12", "session": "R0003"})
        removed = (status("cameras"), status("sd_cards"))
        site_removed = svc.list_locations(tmp_path, "DONA")[0]["status"]
        _save({**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "C3", "camera_id": "P900", "date": "2024-12-12", "session": "R0004"})
        _save({**VISIT, "actions": ["Stolen"], "camera_id": "P900", "num_photos": None, "sd": None, "date": "2025-01-12", "session": "R0005"})
        stolen = (status("cameras"), status("sd_cards"))

    assert (site_installed, site_removed) == ("active", "ready")                                   # the site has a camera while one is up
    assert installed == ({"P800": ("active", None), "P900": ("ready", None)}, {"A13": ("active", None), "B2": ("ready", None), "C3": ("ready", None)})
    assert revised == {"A13": ("ready", None), "B2": ("active", None), "C3": ("ready", None)}      # the card collected is back, the one left is out
    assert removed == ({"P800": ("ready", None), "P900": ("ready", None)}, {"A13": ("ready", None), "B2": ("ready", None), "C3": ("ready", None)})
    assert stolen == ({"P800": ("ready", None), "P900": ("archived", "stolen")}, {"A13": ("ready", None), "B2": ("ready", None), "C3": ("archived", "stolen")})


def test_new_visits_are_only_kept_to_an_active_research_project(tmp_path: Path):
    from wildintel_uploader.core.services import local_folder_service as svc

    with _in(tmp_path):
        _project(archived=(2, 3))
        visit = {**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "camera_id": "P800", "date": "2024-09-04", "session": "R0001"}
        results = {}
        for status in ("planned", "finished", "active"):
            _client().post("/api/deployment-import/research-projects/update", json={"acronym": "DONA", "changes": {"status": status}}) if False else svc.update_research_project(tmp_path, "DONA", {"status": status})
            results[status] = _save(visit)
        refused = results["planned"].json()["detail"]

    assert results["planned"].status_code == 400 and "is planned" in refused
    assert results["finished"].status_code == 400 and "is finished" in results["finished"].json()["detail"]
    assert results["active"].status_code == 200


def test_a_research_project_goes_back_to_planned_only_without_visits_and_an_archived_one_is_never_modified(tmp_path: Path):
    from wildintel_uploader.core.services import local_folder_service as svc

    with _in(tmp_path):
        _project(archived=(2, 3))
        svc.update_research_project(tmp_path, "DONA", {"status": "planned"})               # nothing was done in it: it can go back
        svc.update_research_project(tmp_path, "DONA", {"status": "active"})
        _save({**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "camera_id": "P800", "date": "2024-09-04", "session": "R0001"})
        svc.update_research_project(tmp_path, "DONA", {"status": "finished"})
        svc.update_research_project(tmp_path, "DONA", {"status": "active"})               # a finished one is reopened
        try:
            svc.update_research_project(tmp_path, "DONA", {"status": "planned"})
            back = None
        except svc.LocalFolderError as exc:
            back = str(exc)
        svc.update_research_project(tmp_path, "DONA", {"status": "archived"})
        refused = []
        for change in (lambda: svc.update_research_project(tmp_path, "DONA", {"status": "active"}),
                       lambda: svc.update_research_project(tmp_path, "DONA", {"name": "Other"}),
                       lambda: svc.update_location(tmp_path, "DONA", "DONA_01", {"name": "Other"}),
                       lambda: svc.write_field_items(tmp_path, "DONA", "cameras", []),
                       lambda: svc.delete_research_project(tmp_path, "DONA")):
            try:
                change()
                refused.append(None)
            except svc.LocalFolderError as exc:
                refused.append(str(exc))
        shown = _save({**VISIT, "actions": ["Revision"], "camera_id": "P800", "num_photos": 1, "sd": "B2", "date": "2024-10-12", "session": "R0002"})

    assert back is not None and "has visits" in back
    assert all(r and "archived" in r for r in refused)
    assert shown.status_code == 400 and "archived" in shown.json()["detail"]


def test_a_planned_site_is_not_in_the_app_and_a_ready_one_is(tmp_path: Path):
    from wildintel_uploader.core.services import local_folder_service as svc

    with _in(tmp_path):
        _project(archived=(2, 3))
        svc.update_location(tmp_path, "DONA", "DONA_01", {"status": "planned"})
        planned = _save({**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "camera_id": "P800", "date": "2024-09-04", "session": "R0001"})
        svc.update_location(tmp_path, "DONA", "DONA_01", {"status": "ready"})
        ready = _save({**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "camera_id": "P800", "date": "2024-09-04", "session": "R0001"})

    assert planned.status_code == 422 and "is planned" in planned.json()["detail"]
    assert ready.status_code == 200


def test_the_status_of_a_site_by_hand_follows_what_the_visits_say(tmp_path: Path):
    from wildintel_uploader.core.services import local_folder_service as svc

    def change(status: str):
        try:
            return svc.update_location(tmp_path, "DONA", "DONA_01", {"status": status})["status"]
        except svc.LocalFolderError as exc:
            return str(exc)

    with _in(tmp_path):
        _project(archived=(2, 3))
        empty = (change("planned"), change("ready"), change("active"))                  # nothing has been done at the site
        install = {**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "camera_id": "P800", "date": "2024-09-04", "session": "R0001"}
        _save(install)                                                                  # a camera is put up: the site is active
        out = (change("ready"), change("planned"), change("archived"))                  # a camera is out
        _save({**VISIT, "actions": ["Revision", "Desinstallation"], "camera_id": "P800", "num_photos": 5, "sd": None, "date": "2024-10-12", "session": "R0002"})
        after = (change("active"), change("planned"), change("ready"), change("archived"))

    assert empty[0] == "planned" and empty[1] == "ready" and "a visit puts it up" in empty[2]
    assert all("has a camera out" in o for o in out)
    assert "a visit puts it up" in after[0] and after[1] == "planned" and after[2] == "ready" and after[3] == "archived"


def test_a_site_with_a_visit_still_to_be_made_in_a_revision_that_has_begun_does_not_leave_the_app(tmp_path: Path):
    from wildintel_uploader.core.services import local_folder_service as svc

    with _in(tmp_path):
        _project(archived=(3,))
        for n, day in ((1, "2024-09-04"), (2, "2024-09-05")):
            assert _save({**VISIT, "location_id": f"DONA_0{n}", "actions": ["Installation"], "num_photos": None, "sd": f"S{n}", "camera_id": f"C{n}", "date": day, "session": "R0001"}).status_code == 200
        assert _save({**VISIT, "location_id": "DONA_01", "actions": ["Revision", "Desinstallation"], "camera_id": "C1", "num_photos": 5, "sd": None, "date": "2024-10-12", "session": "R0002"}).status_code == 200
        assert _save({**VISIT, "location_id": "DONA_02", "actions": ["Revision"], "camera_id": "C2", "num_photos": 5, "sd": "S9", "date": "2024-10-13", "session": "R0002"}).status_code == 200
        assert _save({**VISIT, "location_id": "DONA_02", "actions": ["Revision"], "camera_id": "C2", "num_photos": 5, "sd": "S8", "date": "2024-11-13", "session": "R0003"}).status_code == 200
        try:
            svc.update_location(tmp_path, "DONA", "DONA_01", {"status": "planned"})
            refused = None
        except svc.LocalFolderError as exc:
            refused = str(exc)

    assert refused is not None and "still has a visit to be made in R0003" in refused


def test_where_the_camera_was_taken_away_or_stolen_only_an_installation_an_archive_or_a_visit_not_made_can_follow(tmp_path: Path):
    with _in(tmp_path):
        _project(archived=(2, 3))
        _save({**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "camera_id": "P800", "date": "2024-09-04", "session": "R0001"})
        _save({**VISIT, "actions": ["Stolen"], "camera_id": "P800", "num_photos": None, "sd": None, "date": "2024-10-12", "session": "R0002"})
        base = {**VISIT, "date": "2024-11-12", "session": "R0003", "num_photos": 5, "sd": None, "camera_id": "P800"}
        refused = {a: _save({**base, "actions": a.split("+")}) for a in ("Revision", "Desinstallation", "Stolen", "Revision+Desinstallation")}
        not_made = _save({**base, "actions": [], "camera_status": "Not revised", "num_photos": None, "sd": None, "camera_id": None})

    assert all(r.status_code == 422 and "has no camera" in r.json()["detail"] for r in refused.values())
    assert not_made.status_code == 200


def test_where_the_camera_was_taken_away_a_new_one_can_be_put_up_and_the_site_can_be_given_up(tmp_path: Path):
    with _in(tmp_path):
        _project(archived=(2, 3))
        _save({**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "camera_id": "P800", "date": "2024-09-04", "session": "R0001"})
        _save({**VISIT, "actions": ["Stolen"], "camera_id": "P800", "num_photos": None, "sd": None, "date": "2024-10-12", "session": "R0002"})
        again = _save({**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "B2", "camera_id": "P900", "date": "2024-11-12", "session": "R0003"})
        _save({**VISIT, "actions": ["Stolen"], "camera_id": "P900", "num_photos": None, "sd": None, "date": "2024-12-12", "session": "R0004"})
        archive = _save({**VISIT, "actions": ["Archive"], "camera_id": None, "num_photos": None, "sd": None, "date": "2025-01-12", "session": "R0005"})

    assert again.status_code == 200 and archive.status_code == 200


def test_a_stolen_camera_replaced_is_not_said_to_leave_its_card_uncollected(tmp_path: Path):
    with _in(tmp_path):
        _project(archived=(2, 3))
        _save({**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "camera_id": "P800", "date": "2024-09-04", "session": "R0001"})
        stolen = _import(tmp_path, "location_id,session,date,time,actions,camera_id,sd\nDONA_01,R0002,2024-11-12,09:00,Stolen + Installation,P900,B2\n", given_up="2024-01-01").json()

    assert stolen["problems"] == [] and stolen["warnings"] == []          # the card went with the camera: the visit says so


def test_no_card_is_left_where_the_camera_is_taken_away_unless_another_is_put_up(tmp_path: Path):
    with _in(tmp_path):
        _project(archived=(2, 3))
        _save({**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "camera_id": "P800", "date": "2024-09-04", "session": "R0001"})
        leaves = _save({**VISIT, "actions": ["Revision", "Desinstallation"], "camera_id": "P800", "num_photos": 5, "sd": "B2", "date": "2024-10-12", "session": "R0002"})
        away = _save({**VISIT, "actions": ["Revision", "Desinstallation"], "camera_id": "P800", "num_photos": 5, "sd": None, "date": "2024-10-12", "session": "R0002"})

    assert leaves.status_code == 422 and "taken away" in str(leaves.json()["detail"])
    assert away.status_code == 200


def test_a_planned_revision_with_no_visit_is_closed_by_marking_every_location_as_not_visited_and_the_next_can_be_planned(tmp_path: Path):
    with _in(tmp_path):
        _project(archived=(2, 3))
        _save({**VISIT, "actions": ["Installation"], "num_photos": None, "sd": "A13", "camera_id": "P800", "date": "2024-09-04", "session": "R0001"})
        _create_revision()                                                                        # R0002: planned, no visit
        refused = _create_revision()
        marked = _client().post("/api/visits/mark-not-visited", json={"research_project_id": "DONA", "session": "R0002"})
        next_one = _create_revision()
        book = _client().post("/api/visits/book", json={"research_project_id": "DONA"}).json()["results"]

    assert refused.status_code == 409
    assert marked.status_code == 200 and marked.json() == {"session": "R0002", "marked": ["DONA_01"]}
    assert next_one.status_code == 200 and next_one.json()["session"] == "R0003"
    second = [v for v in book if v["session"] == "R0002"]
    assert [(v["location_id"], v["not_visited"], v["not_done"]) for v in second] == [("DONA_01", True, False)]
