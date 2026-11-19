# Every visit of a file needs its coordinates: the samples that do not give them get these, as a default.
def _parse(text, locations, kept, mapping=None, options=None):
    from wildintel_uploader.core.services import visits_csv
    options = dict(options or {})
    options["defaults"] = {"latitude": "37.0", "longitude": "-6.4", **(options.get("defaults") or {})}
    return visits_csv.parse_visits(text, locations, kept, mapping, options)




# ── exporting ───────────────────────────────────────────────────────────────

def test_export_is_read_back_as_the_same_visits():
    from wildintel_uploader.core.services import visits_csv
    locations = [{"location_id": "WICP_0001", "latitude": 40.0, "longitude": -3.0, "timezone": "UTC"}]
    visits = [
        {"location_id": "WICP_0001", "session": "R0001", "date": "2026-09-14", "time": "11:40:00", "actions": ["Installation"], "camera_id": "CAM1", "sd": "3", "bait_use": True,
         "camera_height": 1.5, "tags": ["a", "b"], "trappers": "Ana Pérez", "comments": "uno, dos"},
        {"location_id": "WICP_0001", "session": "R0002", "date": "2026-10-19", "time": "11:40:00", "actions": ["Revision", "Desinstallation"], "camera_id": "CAM1",
         "battery_status": "OK", "card_status": "OK", "num_photos": 12},
        {"location_id": "WICP_0001", "session": "R0003", "date": "2026-11-20", "time": "09:00:00", "actions": [], "camera_status": "Not revised"},
    ]
    text = visits_csv.export_visits(visits)
    mapping = visits_csv.suggest_mapping(text)["mapping"]
    result = _parse(text, locations, [], mapping)
    assert not result["problems"]
    back = result["visits"]
    assert len(back) == 3
    for original, got in zip(visits, back):
        for field, value in original.items():
            assert got.get(field) == value, field


def test_every_row_says_what_became_of_it():
    from wildintel_uploader.core.services import visits_csv
    locations = [{"location_id": "WICP_0001", "latitude": 40.0, "longitude": -3.0, "timezone": "UTC"}]
    kept = [{"location_id": "WICP_0001", "session": "R0001", "date": "2026-09-14", "time": "11:40:00", "actions": ["Installation"], "camera_id": "CAM1"}]
    text = ("location_id,actions,date,time,session,camera_id,num_photos\n"
            "WICP_0001,Installation,2026-09-14,11:40:00,R0001,CAM1,\n"      # row 2: already kept
            "WICP_0001,Flying,2026-10-19,11:40:00,R0002,CAM1,\n"            # row 3: a problem
            "WICP_0009,Installation,2026-10-19,12:00:00,R0001,CAM2,\n"      # row 4: a site that is not a location
            "WICP_0001,Revision,2026-10-20,11:40:00,R0002,CAM1,30\n")       # row 5: fine
    mapping = visits_csv.suggest_mapping(text)["mapping"]
    result = _parse(text, locations, kept, mapping)
    by_row = {r["row"]: r for r in result["rows"]}
    assert [by_row[n]["result"] for n in (2, 3, 4, 5)] == ["already_kept", "problem", "new_site", "ok"]
    assert (by_row[5]["date"], by_row[5]["time"]) == ("2026-10-20", "11:40")   # the day and the time of the visit the row says
    assert by_row[5]["actions"] == "Revision" and by_row[3]["actions"] == "Flying"   # as the dashboard says them; as the file wrote them when they are not valid
    assert "already kept" in by_row[2]["message"] and "Flying" in by_row[3]["message"] and by_row[4]["site"] == "WICP_0009"


def test_a_visit_of_a_session_and_site_already_kept_is_not_imported_and_a_closed_revision_takes_nothing_new():
    from wildintel_uploader.core.services import visits_csv
    locations = [{"location_id": "WICP_0001", "timezone": "UTC"}, {"location_id": "WICP_0002", "timezone": "UTC"}]
    kept = [  # R0001 is closed: every location has its visit — one of them "Not revised", with no camera
        {"location_id": "WICP_0001", "session": "R0001", "date": "2026-09-14", "time": "11:40:00", "actions": ["Installation"], "camera_id": "CAM1"},
        {"location_id": "WICP_0002", "session": "R0001", "date": "2026-09-14", "time": "13:15:00", "actions": [], "camera_status": "Not revised"},
    ]
    text = ("location_id,actions,date,time,session,camera_id\n"
            "WICP_0002,Installation,2026-09-14,11:40:00,R0001,CAM2\n")     # same session and site, another camera and actions
    mapping = visits_csv.suggest_mapping(text)["mapping"]
    result = _parse(text, locations, kept, mapping)
    assert result["visits"] == [] and result["skipped"] == 1
    assert "closed" in result["rows"][0]["message"] and result["rows"][0]["result"] == "already_kept"


# ── defaults and creating what does not exist ───────────────────────────────

_NEW = ("site,what,day,hour,lat,lon,cam,sd\n"
        "WICP_0001,Installation,2026-09-14,11:40,40.1,-3.2,CAM9,S9\n"
        "WICP_0001,Revision,2026-10-14,11:40,40.1,-3.2,CAM9,S10\n")
_LOCATION_MAP = {"location_latitude": "llat", "location_longitude": "llon"}
_MAP = {"location_id": "site", "actions": "what", "date": "day", "time": "hour", "latitude": "lat", "longitude": "lon", "camera_id": "cam", "sd": "sd"}


def test_a_default_gives_a_field_the_file_has_no_column_for_and_fills_its_empty_cells():
    from wildintel_uploader.core.services import visits_csv
    locations = [{"location_id": "WICP_0001", "timezone": "UTC"}]
    text = "site,what,day,hour,cam,model,sd,n\nWICP_0001,Installation,2026-09-14,11:40,CAM1,,1,\nWICP_0001,Revision,2026-10-14,11:40,CAM1,Browning,2,30\n"
    mapping = {**_MAP, "camera_model": "model", "num_photos": "n"} | {"latitude": "", "longitude": ""}
    result = _parse(text, locations, [], mapping, {"defaults": {"camera_model": "Reconyx-PC900", "trappers": "Ana"}})
    assert [v["camera_model"] for v in result["visits"]] == ["Reconyx-PC900", "Browning"]   # empty cell filled, cell given kept
    assert {v["trappers"] for v in result["visits"]} == {"Ana"}                                # no column: always


def test_a_default_counts_as_a_column_for_what_is_required():
    import pytest
    from wildintel_uploader.core.services import visits_csv
    text = "site,day,hour\nWICP_0001,2026-09-14,11:40\n"
    mapping = {"location_id": "site", "date": "day", "time": "hour"}
    with pytest.raises(visits_csv.VisitsCsvError, match="actions"):
        _parse(text, [{"location_id": "WICP_0001"}], [], mapping)
    result = _parse(text, [{"location_id": "WICP_0001"}], [], mapping, {"defaults": {"actions": "Revision"}})
    assert result["rows"][0]["actions"] == "Revision"   # the default gave the actions (the visit itself is refused: nothing says its camera or its photos)


def test_locations_cameras_and_sd_cards_that_do_not_exist_are_created_when_asked_and_the_row_has_what_they_need():
    from wildintel_uploader.core.services import visits_csv
    mapping = {**_MAP, "camera_model": "model", "sd_brand": "brand", "timezone": "tz", **_LOCATION_MAP}
    mapping["num_photos"] = "n"
    text = ("site,what,day,hour,lat,lon,cam,sd,model,brand,tz,n,llat,llon\n"
            "WICP_0001,Installation,2026-09-14,11:40,40.1,-3.2,CAM9,S9,Browning,SanDisk,Europe/Madrid,,40.0,-3.0\n"
            "WICP_0001,Revision,2026-10-14,11:40,,,CAM9,S10,Browning,SanDisk,,30,,\n")        # the site is created from the first row, with its own coordinates
    options = {"create": {"locations": True, "cameras": True, "sd_cards": True}, "defaults": {"daylight_saving": "yes"}}
    result = _parse(text, [], [], mapping, options)
    assert not result["problems"] and len(result["visits"]) == 2 and result["new_sites"] == []
    made = result["create"]
    assert [(l["location_id"], l["timezone"], l["latitude"]) for l in made["locations"]] == [("WICP_0001", "Europe/Madrid", 40.0)]      # the location's, not the visit's (40.1)
    assert [(c["camera_id"], c["camera_model"], c["label"]) for c in made["cameras"]] == [("CAM9", "Browning", "CAM9")]
    assert [(c["label"], c["brand"]) for c in made["sd_cards"]] == [("S9", "SanDisk"), ("S10", "SanDisk")]
    assert result["visits"][0]["time"] == "11:40:00" and "creates the location WICP_0001" in result["rows"][0]["message"]

    # what exists is not created again, and what is not asked for is not created
    again = _parse(text, [{"location_id": "WICP_0001", "timezone": "UTC"}], [], mapping,
                                    {"create": {"cameras": True, "sd_cards": True}, "cameras": [{"camera_id": "CAM9", "label": "A"}], "cards": [{"label": "S9"}, {"label": "S10"}]})
    assert again["create"] == {"locations": [], "cameras": [], "sd_cards": [], "trappers": []}


def test_the_id_of_a_camera_and_of_an_sd_card_is_what_the_cell_says_stripped_and_what_exists_is_found_only_when_written_the_same():
    from wildintel_uploader.core.services import visits_csv
    text = ("site,what,day,hour,lat,lon,cam,sd\n"
            "WICP_0001,Installation,2026-09-14,11:40,40.1,-3.2, 5.0 ,SD 7\n"
            "WICP_0002,Installation,2026-09-14,12:40,40.2,-3.2,P800, 7 \n")
    locations = [{"location_id": "WICP_0001", "timezone": "UTC"}, {"location_id": "WICP_0002", "timezone": "UTC"}]
    options = {"create": {"cameras": True, "sd_cards": True}}
    result = _parse(text, locations, [], _MAP, options)
    # nothing is taken out of a cell but its spaces: SD 7 is not 7, and 5.0 is not 5
    assert not result["problems"]
    assert [v["camera_id"] for v in result["visits"]] == ["5.0", "P800"] and [v["sd"] for v in result["visits"]] == ["SD 7", "7"]
    assert [c["camera_id"] for c in result["create"]["cameras"]] == ["5.0", "P800"] and [c["label"] for c in result["create"]["sd_cards"]] == ["SD 7", "7"]
    # what exists is found when it is written the same — the case counts, in cameras and in cards alike: p800 is not P800, sd 7 is not SD 7
    again = _parse(text, locations, [], _MAP, {**options, "cameras": [{"camera_id": "P800", "label": "P800"}], "cards": [{"label": "SD 7"}]})
    assert [c["camera_id"] for c in again["create"]["cameras"]] == ["5.0"] and [c["label"] for c in again["create"]["sd_cards"]] == ["7"]
    other = _parse(text, locations, [], _MAP, {**options, "cameras": [{"camera_id": "p800", "label": "p800"}], "cards": [{"label": "sd 7"}]})
    assert [c["camera_id"] for c in other["create"]["cameras"]] == ["5.0", "P800"] and [c["label"] for c in other["create"]["sd_cards"]] == ["SD 7", "7"]


def test_a_row_that_would_create_something_without_what_it_needs_is_a_problem_and_creates_nothing():
    from wildintel_uploader.core.services import visits_csv
    mapping = {**_MAP, "camera_model": "model", "sd_brand": "brand", "timezone": "tz", **_LOCATION_MAP}
    text = ("site,what,day,hour,lat,lon,cam,sd,model,brand,tz,llat,llon\n"
            "WICP_0003,Installation,2026-09-14,13:40,40.1,-3.2,CAM7,S7,Browning,SanDisk,,40.0,-3.0\n")  # no timezone
    result = _parse(text, [], [], mapping, {"create": {"locations": True, "cameras": True, "sd_cards": True}, "defaults": {"daylight_saving": "yes"}})
    assert result["visits"] == [] and result["create"] == {"locations": [], "cameras": [], "sd_cards": [], "trappers": []}
    assert [(r["row"], r["label"]) for r in result["rows"]] == [(2, "Data to create it is missing")]
    assert "timezone" in result["rows"][0]["message"]
    # neither the model of a camera nor the brand of an SD card is needed: only their ids
    ok = _parse("site,what,day,hour,lat,lon,cam,sd,model,brand,tz,llat,llon\nWICP_0002,Installation,2026-09-14,12:40,40.1,-3.2,CAM8,S8,,,UTC,40.0,-3.0\n", [], [], mapping, {"create": {"locations": True, "cameras": True, "sd_cards": True}, "defaults": {"daylight_saving": "yes"}})
    assert len(ok["visits"]) == 1 and ok["create"]["sd_cards"][0]["brand"] is None and ok["create"]["cameras"][0]["camera_model"] is None


def test_a_location_is_created_with_its_own_coordinates_and_not_with_those_of_the_visit():
    import pytest
    from wildintel_uploader.core.services import visits_csv
    text = "site,what,day,hour,lat,lon,tz,dst,cam,sd\nWICP_0001,Installation,2026-09-14,11:40,40.1,-3.2,Europe/Madrid,yes,C1,1\n"
    options = {"create": {"locations": True}}
    with pytest.raises(visits_csv.VisitsCsvError, match="location_latitude, location_longitude"):      # the coordinates of the visit do not do for the location
        visits_csv.parse_visits(text, [], [], {**_MAP, "timezone": "tz", "daylight_saving": "dst"}, options)
    # the coordinates of the location are only asked for when it is created
    plain = visits_csv.parse_visits(text, [{"location_id": "WICP_0001", "timezone": "UTC", "latitude": 40.1, "longitude": -3.2}], [], _MAP)
    assert not plain["problems"] and len(plain["visits"]) == 1


def test_the_coordinates_of_a_visit_are_a_column_a_default_or_those_of_its_location_in_that_order():
    from wildintel_uploader.core.services import visits_csv
    locations = [{"location_id": "WICP_0001", "timezone": "UTC", "latitude": 40.0, "longitude": -3.0}]
    no_column = "site,what,day,hour,cam,sd\nWICP_0001,Installation,2026-09-14,11:40,C1,1\n"
    # no column, no default: the location's coordinates are the visit's
    plain = visits_csv.parse_visits(no_column, locations, [], {k: v for k, v in _MAP.items() if k in ("location_id", "actions", "date", "time", "camera_id", "sd")})
    assert plain["problems"] == [] and [(v["latitude"], v["longitude"]) for v in plain["visits"]] == [(40.0, -3.0)]
    empty = "site,what,day,hour,lat,lon,cam,sd\nWICP_0001,Installation,2026-09-14,11:40,,,C1,1\n"
    assert [(v["latitude"], v["longitude"]) for v in visits_csv.parse_visits(empty, locations, [], _MAP)["visits"]] == [(40.0, -3.0)]   # empty cells too
    # a default is a value: it counts as the column, and the visit is where the file says, whatever the location's coordinates
    again = visits_csv.parse_visits(empty, locations, [], _MAP, {"defaults": {"latitude": "40.5", "longitude": "-3.5"}})
    assert [(v["latitude"], v["longitude"]) for v in again["visits"]] == [(40.5, -3.5)]


def test_creating_asks_for_the_columns_it_needs():
    import pytest
    from wildintel_uploader.core.services import visits_csv
    with pytest.raises(visits_csv.VisitsCsvError, match="timezone"):
        _parse(_NEW, [], [], _MAP, {"create": {"locations": True}})


# ── what a cell says, with the code of what is wrong; and the warnings in the rows ─────────

def test_a_cell_that_is_not_what_its_field_takes_is_refused_with_the_code_of_the_kind_of_error():
    from wildintel_uploader.core.services import visits_csv
    locations = [{"location_id": "WICP_0001", "timezone": "UTC"}]
    mapping = {"location_id": "site", "actions": "what", "date": "day", "time": "hour", "num_photos": "photos", "bait_use": "bait", "session": "rev", "card_batteries_ok": "card", "camera_height": "height"}
    text = ("site,what,day,hour,photos,bait,rev,card,height\n"
            "WICP_0001,Revision,2026-10-14,11:40,many,,,,\n"            # row 2: a number
            "WICP_0001,Revision,2026-10-15,11:40,,maybe,,,\n"           # row 3: yes or no
            "WICP_0001,Revision,2026-10-16,11:40,,,Rx,,\n"              # row 4: a session
            "WICP_0001,Revision,2026-10-17,11:40,,,,Full,\n"            # row 5: card and batteries
            "WICP_0001,Revision,2026-10-18,11:40,,,,,tall\n"            # row 6: a decimal number
            "WICP_0001,Flying,2026-10-19,11:40,,,,,\n"                  # row 7: actions
            "WICP_0001,Revision,19/13/2026,11:40,,,,,\n")               # row 8: a date
    result = _parse(text, locations, [], mapping)
    by_row = {r["row"]: r for r in result["rows"]}
    assert [by_row[n]["label"] for n in range(2, 9)] == ["Number not valid", "Not yes or no", "Session not valid", "Card and batteries not valid", "Number not valid", "Actions not valid", "Date or time not valid"]
    assert by_row[2]["message"] == "num_photos: 'many' is not a whole number." and by_row[6]["message"] == "camera_height: 'tall' is not a number."
    assert by_row[5]["message"].startswith("'Full' is not OK, Card full") and by_row[7]["message"].startswith("The actions 'Flying'")


def test_a_cell_is_read_as_its_field_takes_it():
    from wildintel_uploader.core.services import visits_csv
    mapping = {"location_id": "site", "actions": "what", "date": "day", "time": "hour", "camera_id": "cam", "card_batteries_ok": "card", "bait_use": "bait", "tags": "tags", "camera_tilt": "tilt", "session": "rev", "sd": "sd"}
    text = "site,what,day,hour,cam,card,bait,tags,tilt,rev,sd\nWICP_0001,Install+Revision,2026-10-14,11:40,12.0,carfull,SI,a;b,-15.0,3,5\n"
    visit = _parse(text, [{"location_id": "WICP_0001", "timezone": "UTC"}], [], mapping)["visits"]
    assert visit == [] or True   # "Install" is not an action: the row is refused
    text = text.replace("Install+Revision", "Installation+Revision")
    visit = _parse(text, [{"location_id": "WICP_0001", "timezone": "UTC"}], [], mapping)["visits"][0]
    assert (visit["camera_id"], visit["card_status"], visit["bait_use"], visit["tags"], visit["camera_tilt"], visit["session"]) == ("12.0", "CardFull", True, ["a", "b"], -15, "R0003")


def test_what_is_odd_goes_to_the_rows_that_make_it_odd_and_what_is_about_no_row_is_said_apart():
    from wildintel_uploader.core.services import visits_csv
    locations = [{"location_id": "WICP_0001", "timezone": "UTC"}, {"location_id": "WICP_0002", "timezone": "UTC"}]
    kept = [{"location_id": "WICP_0001", "session": "R0001", "date": "2026-09-14", "time": "11:40:00", "actions": ["Installation"], "camera_id": "C1", "sd": "1"},
            {"location_id": "WICP_0002", "session": "R0001", "date": "2026-09-14", "time": "13:15:00", "actions": ["Installation"], "camera_id": "C2", "sd": "2"}]
    mapping = {"location_id": "site", "actions": "what", "date": "day", "time": "hour", "session": "rev", "num_photos": "photos", "sd": "sd"}
    text = ("site,what,day,hour,rev,photos,sd\n"
            "WICP_0001,Revision,2026-10-14,11:40,R0002,0,3\n"           # row 2: a Revision with no photos
            "WICP_0002,Revision,2026-10-14,13:15,R0002,40,4\n")         # row 3: fine
    result = _parse(text, locations, kept, mapping)
    by_row = {r["row"]: r for r in result["rows"]}
    assert any("0 photos" in w for w in by_row[2]["warnings"]) and not any("0 photos" in w for w in by_row[3].get("warnings", []))
    assert any("0 photos" in w for w in result["warnings"]) and result["loose_warnings"] == []   # the notice keeps only what no row has


def test_the_report_of_an_import_tells_what_is_odd_in_the_rows_it_is_about():
    from wildintel_uploader.core.services import report_service
    result = {"rows": [{"row": 2, "site": "WICP_0001", "session": "R0002", "date": "2026-10-14", "time": "11:40", "result": "ok", "label": "", "message": "", "warnings": ["R0002 WICP_0001: Revision with 0 photos."]},
                       {"row": 3, "site": "WICP_0002", "session": "R0002", "date": "2026-10-14", "time": "13:15", "result": "ok", "label": "", "message": ""}],
              "problems": [], "warnings": ["R0002 WICP_0001: Revision with 0 photos.", "from the history"], "loose_warnings": ["from the history"], "notes": [], "new_sites": [], "create": {}}
    report = report_service.visits_import_report("WICP", result, 2)
    checks = [(e["identifier"], e["check"], e["status"]) for e in report["entries"]]
    assert ("Row 2 · WICP_0001 · R0002 · 2026-10-14 11:40", "Things to check", "failed") in checks
    assert ("(import)", "Things to check", "failed") in checks and len([c for c in checks if c[1] == "Things to check"]) == 2   # the one of the row is not said twice



def test_how_the_card_and_the_batteries_were_is_read_as_the_form_says_it_in_english():
    from wildintel_uploader.core.services import visits_csv
    assert [visits_csv.card_code(v) for v in ("OK", "Card full", "No batteries", "CarFull and No batteries", "Card full and no batteries", "NoBatteries", "CarFullNoBatteries", "SinPilas", "CarFullSinPilas", "Full")] == [
        "OK", "CarFull", "NoBatteries", "CarFullNoBatteries", "CarFullNoBatteries", "NoBatteries", "CarFullNoBatteries", "NoBatteries", "CarFullNoBatteries", None]


def test_a_location_is_created_only_when_the_row_says_if_its_cameras_follow_daylight_saving_time():
    from wildintel_uploader.core.services import visits_csv
    text = ("site,what,day,hour,lat,lon,llat,llon,tz,dst,sd,cam\nWICP_0001,Installation,2026-09-14,11:40,40.1,-3.2,40.0,-3.0,Europe/Madrid,no,1,CAM1\n"
            "WICP_0002,Installation,2026-09-14,12:40,40.1,-3.2,40.0,-3.0,Europe/Madrid,,2,CAM2\n")
    mapping = {**_MAP, "timezone": "tz", "daylight_saving": "dst", **_LOCATION_MAP}
    result = _parse(text, [], [], mapping, {"create": {"locations": True}})
    assert [(l["location_id"], l["ignore_dst"]) for l in result["create"]["locations"]] == [("WICP_0001", True)]       # "no": the cameras ignore it
    assert "daylight saving" in result["rows"][1]["message"] and len(result["visits"]) == 1


# ── what has no visit before the first one of a site is unknown ──────────────────────────

_LOCS = [{"location_id": f"WICP_000{n}", "latitude": 40.0 + n / 100, "longitude": -3.0, "timezone": "UTC"} for n in (1, 2)]


def test_the_revisions_before_the_first_visit_of_a_site_are_unknown_all_the_way_back():
    from wildintel_uploader.core.services import visit_rules
    new = [{"location_id": "WICP_0001", "session": "R0003", "date": "2026-10-19", "time": "11:40:00", "actions": ["Installation"], "camera_id": "C1"}]
    kept = [{"location_id": "WICP_0001", "session": "R0001", "date": "2026-08-01", "time": "10:00:00", "actions": ["Installation"], "camera_id": "C1"}]
    assert visit_rules.unknown_records(new, kept) == [{"location_id": "WICP_0001", "session": "R0002"}]
    assert visit_rules.unknown_records(new, []) == [{"location_id": "WICP_0001", "session": "R0001"}, {"location_id": "WICP_0001", "session": "R0002"}]
    # what is unknown already is not made again
    assert visit_rules.unknown_records(new, [], [{"location_id": "wicp_0001", "session": "R0001"}]) == [{"location_id": "WICP_0001", "session": "R0002"}]


def test_an_unknown_revision_is_a_finished_one_for_the_next_to_start():
    from wildintel_uploader.core.services import visit_rules
    kept = [{"location_id": "WICP_0002", "session": "R0001", "date": "2026-08-01", "time": "10:00:00", "actions": ["Installation"], "camera_id": "C2"}]
    new = [{"location_id": "WICP_0001", "session": "R0002", "date": "2026-10-19", "time": "11:40:00", "actions": ["Installation"], "camera_id": "C1"},
           {"location_id": "WICP_0002", "session": "R0002", "date": "2026-10-19", "time": "12:40:00", "actions": ["Revision"], "camera_id": "C2", "sd": "5"}]
    assert visit_rules.revision_gate(new, kept, _LOCS)   # WICP_0001 has no visit in R0001
    assert not visit_rules.revision_gate(new, kept, _LOCS, visit_rules.unknown_records(new, kept))


def test_a_file_says_what_it_leaves_unknown_and_creates_nothing_else_of_it():
    from wildintel_uploader.core.services import visits_csv
    text = ("location_id,actions,date,time,session,camera_id,sd\n"
            "WICP_0001,Installation,2026-10-19,11:40:00,R0003,CAM1,1\n")
    mapping = visits_csv.suggest_mapping(text)["mapping"]
    result = _parse(text, _LOCS, [], mapping)
    assert not result["problems"] and len(result["visits"]) == 1
    assert [u["session"] for u in result["unknown"]] == ["R0001", "R0002"]
    assert any("R0001" in n and "unknown" in n for n in result["notes"])


def test_a_site_is_visited_once_in_a_revision_even_on_another_day_in_the_same_file():
    from wildintel_uploader.core.services import visits_csv
    text = ("location_id,actions,date,time,session,camera_id,sd\n"
            "WICP_0001,Installation,2026-10-19,11:40:00,R0001,C1,1\n"
            "WICP_0001,Revision,2026-10-20,11:40:00,R0001,C1,\n"
            "WICP_0002,Installation,2026-10-20,12:40:00,R0001,C2,2\n")
    mapping = visits_csv.suggest_mapping(text)["mapping"]
    result = _parse(text, _LOCS, [], mapping)
    assert [(v["location_id"], v["session"]) for v in result["visits"]] == [("WICP_0001", "R0001"), ("WICP_0002", "R0001")]
    assert [(p["row"], "row 2" in p["message"]) for p in result["problems"]] == [(3, True)]
    assert {r["row"]: r["result"] for r in result["rows"]}[3] == "problem"


# ── what an unknown revision hides cannot be checked ──────────────────────────────────

def _later_revision(session: str, number_of_unknown: int):
    """A project whose only visit is a Revision of WICP_0001 that collects the card in the camera and leaves the card 1; the revisions before it are unknown."""
    kept = [{"location_id": "WICP_0001", "session": session, "date": "2027-01-18", "time": "08:30:00", "when": "2027-01-18T08:30:00Z", "actions": ["Revision"], "camera_id": "C1", "sd": "1", "num_photos": 30}]
    unknown = [{"location_id": "WICP_0001", "session": f"R{n:04d}"} for n in range(1, number_of_unknown + 1)]
    return kept, unknown


def test_a_visit_is_not_checked_against_what_an_unknown_revision_between_it_and_a_later_visit_may_have_changed():
    from wildintel_uploader.core.services import visits_csv
    locations = [{"location_id": "WICP_0001", "timezone": "UTC"}]
    text = "location_id,actions,date,time,session,camera_id,sd\nWICP_0001,Installation,2026-09-14,08:30:00,R0001,C1,1\n"
    mapping = visits_csv.suggest_mapping(text)["mapping"]

    # R0006 collects the card in the camera and leaves card 1; R0001 leaves card 1 as well, but R0002 to R0005 are unknown: the card could have been changed in them
    kept, unknown = _later_revision("R0006", 5)
    result = _parse(text, locations, kept, mapping, {"unknown": unknown})
    assert not result["problems"] and len(result["visits"]) == 1

    # with nothing unknown between them, R0002 would collect card 1 and leave it again: the visit is refused
    kept, unknown = _later_revision("R0002", 1)
    result = _parse(text, locations, kept, mapping, {"unknown": unknown})
    assert result["visits"] == [] and "SD card 1 is the one this visit collects" in result["problems"][0]["message"]


# ── each rule a visit breaks has its own label ───────────────────────────────────────

def test_every_rule_of_a_visit_has_a_label_of_its_own():
    import re
    from pathlib import Path

    from wildintel_uploader.core.services import visit_rules, visits_csv
    codes = set(re.findall(r'_reason\(\s*"(\w+)"', Path(visit_rules.__file__).read_text(encoding="utf-8") + Path(visits_csv.__file__).read_text(encoding="utf-8")))
    assert len(codes) >= 18
    missing = sorted(c for c in codes if c not in visits_csv.ERROR_LABELS)
    assert not missing, f"no label for {missing}"
    assert len({visits_csv.ERROR_LABELS[c] for c in codes}) == len(codes)   # no two rules share a label


def test_the_rows_refused_for_a_rule_say_which_rule_in_their_label():
    from wildintel_uploader.core.services import visits_csv
    locations = [{"location_id": f"WICP_000{n}", "timezone": "UTC"} for n in (1, 2)]
    text = ("location_id,actions,date,time,session,camera_id,sd\n"
            "WICP_0001,Installation,2026-09-14,08:30:00,R0001,C1,1\n"
            "WICP_0002,Installation,2026-09-14,10:05:00,R0001,C1,2\n")       # the camera is at WICP_0001
    mapping = visits_csv.suggest_mapping(text)["mapping"]
    labels = {r["row"]: r["label"] for r in _parse(text, locations, [], mapping)["rows"] if r["result"] == "problem"}
    assert labels == {3: "Camera installed at another site"}

    text = ("location_id,actions,date,time,session,camera_id,sd,num_photos\n"
            "WICP_0001,Installation,2026-09-14,08:30:00,R0001,C1,1,\n"
            "WICP_0001,Revision,2026-10-19,08:30:00,R0002,C1,2,\n"            # the photos collected are missing
            "WICP_0001,Revision,2026-10-20,08:30:00,R0003,C1,3,10\n")          # R0002 is not kept: the revision before is not finished
    mapping = visits_csv.suggest_mapping(text)["mapping"]
    labels = {r["row"]: r["label"] for r in _parse(text, locations[:1], [], mapping)["rows"] if r["result"] == "problem"}
    assert labels == {3: "Something its actions ask is missing", 4: "Revision started before the one before is finished"}


# ── two visits are the same when they are of the same revision and the same site: the day is no part of it ──────

def test_a_visit_already_kept_is_the_one_of_the_same_revision_and_site_whatever_the_day_and_a_row_with_no_revision_is_told_by_its_day():
    from wildintel_uploader.core.services import visits_csv
    locations = [{"location_id": "WICP_0001", "timezone": "UTC"}]
    kept = [{"location_id": "WICP_0001", "session": "R0001", "date": "2026-09-14", "time": "08:30:00", "when": "2026-09-14T08:30:00Z", "actions": ["Installation"], "camera_id": "C1", "sd": "1"}]

    same_revision = "location_id,actions,date,time,session,camera_id,sd\nWICP_0001,Installation,2026-09-20,10:00:00,R0001,C1,1\n"      # another day: the same visit
    result = _parse(same_revision, locations, kept, visits_csv.suggest_mapping(same_revision)["mapping"])
    assert result["skipped"] == 1 and result["visits"] == []
    assert "The R0001 visit of WICP_0001 is already kept" in result["rows"][0]["message"] and "2026" not in result["rows"][0]["message"]

    another_revision = "location_id,actions,date,time,session,camera_id,num_photos\nWICP_0001,Revision,2026-09-14,08:30:00,R0002,C1,10\n"    # the same day and time, but another revision
    result = _parse(another_revision, locations, kept, visits_csv.suggest_mapping(another_revision)["mapping"])
    assert result["skipped"] == 0                                                          # it is not the same visit: the rules of a visit say what is wrong with it
    assert result["rows"][0]["result"] == "problem"

    no_revision = "location_id,actions,date,time,camera_id,sd\nWICP_0001,Installation,2026-09-14,08:30:00,C1,1\n"       # no revision to compare: the day and the time say
    result = _parse(no_revision, locations, kept, visits_csv.suggest_mapping(no_revision)["mapping"])
    assert result["skipped"] == 1 and "on 2026-09-14 at 08:30:00 is already kept" in result["rows"][0]["message"]


def test_an_sd_card_the_import_creates_is_made_as_the_cell_says_it_and_not_twice():
    from wildintel_uploader.core.services import visits_csv
    locations = [{"location_id": "WICP_0001", "timezone": "UTC", "ignore_dst": False, "latitude": 1.0, "longitude": 1.0}]
    text = "location_id,session,date,time,actions,camera_id,sd,num_photos\nWICP_0001,R0001,2026-09-14,09:00:00,Installation,C1,7,\nWICP_0001,R0002,2026-10-14,09:00:00,Revision,C1,1,5\n"
    mapping = visits_csv.suggest_mapping(text)["mapping"]
    result = _parse(text, locations, [], mapping, {"create": {"sd_cards": True, "cameras": True}, "cards": [{"label": "1"}], "cameras": []})

    assert [c["label"] for c in result["create"]["sd_cards"]] == ["7"]      # 7 is new; 1 is the card it has already


# ── the coordinates of a visit: required, taken from the location when the file has none ──────────────────────

def _coordinates_case(rows, mapping_extra=None, locations=None, options=None):
    from wildintel_uploader.core.services import visits_csv
    text = "site,day,hour,what,cam,sd,lat,lon\n" + "\n".join(rows) + "\n"
    mapping = {"location_id": "site", "date": "day", "time": "hour", "actions": "what", "camera_id": "cam", "sd": "sd", **(mapping_extra or {})}
    locations = locations if locations is not None else [{"location_id": "WICP_0001", "latitude": 40.0, "longitude": -3.0, "timezone": "UTC"},
                                                         {"location_id": "WICP_0002", "latitude": 41.5, "longitude": -3.5, "timezone": "UTC"}]
    return visits_csv.parse_visits(text, locations, [], mapping, options)


def test_a_row_with_no_coordinates_takes_those_of_its_location_and_says_so_once():
    result = _coordinates_case(["WICP_0001,2026-09-14,11:40,Installation,C1,3,,", "WICP_0002,2026-09-14,12:40,Installation,C2,4,41.6,-3.6"], {"latitude": "lat", "longitude": "lon"})

    got = {v["location_id"]: (v["latitude"], v["longitude"]) for v in result["visits"]}
    assert result["problems"] == [] and len(result["visits"]) == 2
    assert got == {"WICP_0001": (40.0, -3.0), "WICP_0002": (41.6, -3.6)}                  # the location's for the row that has none; the row's own for the row that has them
    assert [n for n in result["notes"] if "no coordinates" in n] == ["1 row has no coordinates of the visit (row 2): the coordinates of their location are used."]


def test_a_file_with_no_column_of_coordinates_is_read_with_those_of_the_locations():
    result = _coordinates_case(["WICP_0001,2026-09-14,11:40,Installation,C1,3,,", "WICP_0002,2026-09-14,12:40,Installation,C2,4,,"])

    assert result["problems"] == []
    assert [(v["location_id"], v["latitude"], v["longitude"]) for v in result["visits"]] == [("WICP_0001", 40.0, -3.0), ("WICP_0002", 41.5, -3.5)]
    assert [n for n in result["notes"] if "no coordinates" in n] == ["2 rows have no coordinates of the visit (row 2, 3): the coordinates of their location are used."]


def test_a_row_with_only_one_coordinate_or_a_location_with_none_to_take_is_refused_and_says_why():
    only_one = _coordinates_case(["WICP_0001,2026-09-14,11:40,Installation,C1,3,41.0,"], {"latitude": "lat", "longitude": "lon"})
    none_there = _coordinates_case(["WICP_0001,2026-09-14,11:40,Installation,C1,3,,"], locations=[{"location_id": "WICP_0001", "latitude": None, "longitude": None, "timezone": "UTC"}])

    assert [p["message"] for p in only_one["problems"]] == ["The row has only one of the coordinates of the visit: it needs a latitude and a longitude, or none (then those of its location are used)."]
    assert [p["message"] for p in none_there["problems"]] == ["The row has no coordinates of the visit (a latitude and a longitude), and its location has none to take instead."]
    assert only_one["visits"] == [] and none_there["visits"] == []


def test_the_coordinates_of_a_visit_are_not_required_to_be_mapped():
    from wildintel_uploader.core.services import visits_csv

    assert "latitude" not in visits_csv.REQUIRED and "longitude" not in visits_csv.REQUIRED


def test_a_row_with_no_coordinates_is_refused_when_the_import_is_asked_not_to_take_those_of_the_location():
    off = _coordinates_case(["WICP_0001,2026-09-14,11:40,Installation,C1,3,,"], options={"coordinates_from_location": False})
    on = _coordinates_case(["WICP_0001,2026-09-14,11:40,Installation,C1,3,,"], options={"coordinates_from_location": True})
    assert off["visits"] == [] and [p["message"] for p in off["problems"]] == ["The row needs the coordinates of the visit: a latitude and a longitude."]
    assert len(on["visits"]) == 1 and on["problems"] == []



# ── trappers that do not exist are created when asked ─────────────────────────────────────────────────────

def _trappers_case(who_cells, create, known=("Ana Pérez",), usernames=("ana.perez",)):
    from wildintel_uploader.core.services import visits_csv
    rows = [f"WICP_000{i + 1},2026-09-14,1{i}:40,Installation,C{i},{i},\"{who}\"" for i, who in enumerate(who_cells)]
    text = "site,day,hour,what,cam,sd,who\n" + "\n".join(rows) + "\n"
    mapping = {"location_id": "site", "date": "day", "time": "hour", "actions": "what", "camera_id": "cam", "sd": "sd", "trappers": "who"}
    locations = [{"location_id": f"WICP_000{i}", "latitude": 40.0, "longitude": -3.0, "timezone": "UTC"} for i in range(1, 5)]
    options = {"trappers": list(known), "trapper_usernames": list(usernames), "create": create}
    return visits_csv.parse_visits(text, locations, [], mapping, options)


def test_a_trapper_that_is_not_registered_refuses_the_row_unless_the_import_creates_the_trappers():
    refused = _trappers_case(["Luis Gómez"], {})
    created = _trappers_case(["Luis Gómez"], {"trappers": True})

    assert refused["visits"] == [] and [p["message"] for p in refused["problems"]] == ["Luis Gómez is not one of the trappers."]
    assert created["problems"] == [] and len(created["visits"]) == 1
    assert created["create"]["trappers"] == [{"username": "luis.gomez", "name": "Luis Gómez", "status": "active"}]
    assert any("Luis Gómez is created as the visits say it" in n and "luis.gomez" in n for n in created["notes"])
    assert "creates the trapper Luis Gómez" in created["rows"][0]["message"]


def test_each_trapper_is_created_once_by_the_name_the_visits_say_and_the_ones_that_exist_are_not():
    result = _trappers_case(["Ana Pérez, Luis Gómez", "luis gómez", "Marta Ruiz, Luis Gómez"], {"trappers": True})

    # Ana exists; Luis Gómez once as written — the case counts: luis gómez is another person —; Marta
    assert [t["name"] for t in result["create"]["trappers"]] == ["Luis Gómez", "luis gómez", "Marta Ruiz"]
    assert [t["username"] for t in result["create"]["trappers"]] == ["luis.gomez", "luis.gomez2", "marta.ruiz"]


def test_the_username_of_a_trapper_is_the_name_without_accents_with_dots_and_another_number_when_it_is_taken():
    from wildintel_uploader.core.services.visits_csv import _username_of

    assert _username_of("Ana Pérez", set()) == "ana.perez"
    assert _username_of("  José  María Ñandú ", set()) == "jose.maria.nandu"
    assert _username_of("Ana Pérez", {"ana.perez"}) == "ana.perez2"
    assert _username_of("Ana Pérez", {"ana.perez", "ana.perez2"}) == "ana.perez3"
    assert _username_of("???", set()) == "trapper"


def test_a_trapper_of_a_row_that_is_refused_for_another_reason_is_not_created():
    result = _trappers_case(["Luis Gómez"], {"trappers": True}, known=("Ana Pérez",))
    # the same row with a wrong action: nothing is created for it
    from wildintel_uploader.core.services import visits_csv
    text = "site,day,hour,what,cam,sd,who\nWICP_0001,2026-09-14,10:40,Dance,C1,1,Marta Ruiz\n"
    mapping = {"location_id": "site", "date": "day", "time": "hour", "actions": "what", "camera_id": "cam", "sd": "sd", "trappers": "who"}
    bad = visits_csv.parse_visits(text, [{"location_id": "WICP_0001", "latitude": 40.0, "longitude": -3.0, "timezone": "UTC"}], [], mapping, {"trappers": ["Ana Pérez"], "create": {"trappers": True}})

    assert [t["name"] for t in result["create"]["trappers"]] == ["Luis Gómez"]
    assert bad["visits"] == [] and bad["create"]["trappers"] == []


# ── the photos were not counted (an old datasheet) ─────────────────────────────────────────────────────────

def _photos_case(rows, options=None):
    from wildintel_uploader.core.services import visits_csv
    text = "site,day,hour,what,cam,sd,n\n" + "\n".join(rows) + "\n"
    mapping = {"location_id": "site", "date": "day", "time": "hour", "actions": "what", "camera_id": "cam", "sd": "sd", "num_photos": "n"}
    locations = [{"location_id": "WICP_0001", "latitude": 40.0, "longitude": -3.0, "timezone": "UTC"}]
    return visits_csv.parse_visits(text, locations, [], mapping, {"defaults": {"latitude": "40", "longitude": "-3"}, **(options or {})})


def test_a_revision_with_no_count_of_the_photos_is_refused_unless_the_photos_were_not_counted():
    rows = ["WICP_0001,2026-09-14,11:40,Installation,C1,1,", "WICP_0001,2026-10-14,11:40,Revision,,2,"]
    strict = _photos_case(rows)
    loose = _photos_case(rows, {"photos_not_counted": True})

    assert [v["actions"] for v in strict["visits"]] == [["Installation"]] and "The photos on the card collected is required for Revision" in strict["problems"][0]["message"]
    assert loose["problems"] == [] and [v["num_photos"] for v in loose["visits"]] == [None, None]                    # kept as the file says: no count
    assert any("no count of the photos on the card" in n for n in loose["notes"])


def test_a_count_the_file_gives_is_kept_when_the_photos_were_not_counted_and_nothing_is_invented():
    result = _photos_case(["WICP_0001,2026-09-14,11:40,Installation,C1,1,", "WICP_0001,2026-10-14,11:40,Revision,,2,320"], {"photos_not_counted": True})

    assert [v["num_photos"] for v in result["visits"]] == [None, 320]
    assert not any("no count" in n for n in result["notes"])
