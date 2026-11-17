"""The start of a site (#36): the action SiteStart says it, once, in the first visit of the site. What came before is not expected — the revisions before it do not wait for a visit to the
site and nothing of them is unknown — and a site with no such visit keeps what it had: what came before it is unknown."""
from wildintel_uploader.core.services import visit_deployments, visit_rules

LOCATIONS = [{"location_id": "DONA_01", "status": "active"}, {"location_id": "DONA_02", "status": "active"}]


def visit(site: str, number: int, actions: list[str], day: str | None = None, **over) -> dict:
    day = day or f"2026-{(number % 12) + 1:02d}-10"
    return {"location_id": site, "session": f"R{number:04d}", "date": day, "time": "09:00:00", "when": f"{day}T09:00:00Z", "actions": actions, "camera_id": "C1", "sd": "A1", "num_photos": 5, **over}


def test_a_site_that_starts_in_a_revision_has_nothing_unknown_before_it_and_one_that_does_not_say_it_has():
    starts = [visit("DONA_02", 20, ["SiteStart", "Installation"])]
    plain = [visit("DONA_02", 20, ["Installation"])]

    assert visit_rules.unknown_records(starts, []) == []
    assert [u["session"] for u in visit_rules.unknown_records(plain, [])] == [f"R{n:04d}" for n in range(1, 20)]      # its start is not known: what came before is


def test_the_revisions_before_the_start_of_a_site_do_not_wait_for_a_visit_to_it_and_the_ones_after_do():
    kept = [visit("DONA_01", 1, ["Installation"]), visit("DONA_01", 2, ["Revision"]), visit("DONA_01", 3, ["Revision"]),
            visit("DONA_02", 3, ["SiteStart", "Installation"], day="2026-03-10")]

    assert visit_rules.revision_missing(1, kept, LOCATIONS) == [] and visit_rules.revision_missing(2, kept, LOCATIONS) == []      # DONA_02 was not there yet
    assert visit_rules.revision_missing(3, kept, LOCATIONS) == []                                                                   # and it has its visit in R0003
    kept.append(visit("DONA_01", 4, ["Revision"]))
    assert visit_rules.revision_missing(4, kept, LOCATIONS) == ["DONA_02"]                                                         # from its start it is waited for
    assert visit_rules.revision_missing(2, kept[:3], LOCATIONS, starting=[kept[3]]) == []                                          # also when its start is among the visits being added


def test_the_locations_not_started_are_not_marked_as_not_visited_in_the_revisions_before_their_start():
    kept = [visit("DONA_01", 1, ["Installation"]), visit("DONA_01", 2, ["Revision"]), visit("DONA_02", 3, ["SiteStart", "Installation"])]

    assert visit_rules.not_visited_records(2, kept, LOCATIONS) == []
    kept[2] = visit("DONA_02", 3, ["Installation"])                                                                                # no start said: it is expected
    assert [r["location_id"] for r in visit_rules.not_visited_records(2, kept, LOCATIONS)] == ["DONA_02"]


def test_the_first_visit_to_a_site_can_be_its_start_alone_or_with_an_installation_and_not_a_revision():
    def first(actions):
        return visit_rules.refusals(visit("DONA_01", 1, actions), [], LOCATIONS)

    assert first(["Installation"]) == [] and first(["SiteStart"]) == [] and first(["SiteStart", "Installation"]) == []
    assert any("can only be an Installation" in why for why in first(["SiteStart", "Revision"]))
    assert any("can only be an Installation" in why for why in first(["Revision"]))


def test_a_site_starts_once_and_with_its_first_visit():
    kept = [visit("DONA_01", 1, ["SiteStart", "Installation"], day="2026-01-10")]
    repeated = visit_rules.refusals(visit("DONA_01", 2, ["SiteStart", "Revision"], day="2026-02-10"), kept, LOCATIONS)
    later = visit_rules.refusals(visit("DONA_02", 2, ["SiteStart", "Revision"], day="2026-02-10"), [visit("DONA_02", 1, ["Installation"], day="2026-01-10")], LOCATIONS)

    assert [getattr(w, "code", None) for w in repeated if getattr(w, "code", "").startswith("site_start")] == ["site_start_repeated"]
    assert [getattr(w, "code", None) for w in later if getattr(w, "code", "").startswith("site_start")] == ["site_start_not_first"]


def test_a_visit_before_the_start_of_its_site_cannot_be_kept_and_the_first_visit_can_be_edited_to_say_the_start():
    start = visit("DONA_01", 3, ["SiteStart", "Installation"], day="2026-03-10")
    before = visit("DONA_01", 2, ["Installation"], day="2026-02-10")
    errors = visit_rules.edit_errors(None, before, [start], LOCATIONS)
    assert any(getattr(w, "code", "") == "visit_before_site_start" for w in errors)

    first = visit("DONA_01", 3, ["Installation"], day="2026-03-10")
    rest = [visit("DONA_01", 4, ["Revision"], day="2026-04-10")]
    assert visit_rules.edit_errors(first, {**first, "actions": ["SiteStart", "Installation"]}, rest, LOCATIONS) == []   # a later visit does not mind: it is after the start
    second = visit("DONA_01", 5, ["Revision"], day="2026-05-10")
    twice = visit_rules.edit_errors(second, {**second, "actions": ["SiteStart", "Revision"]}, [start], LOCATIONS)
    assert any(getattr(w, "code", "") == "site_start_repeated" for w in twice)


def test_the_visit_book_has_nothing_of_a_site_in_the_revisions_before_its_start():
    visits = [visit("DONA_01", 1, ["Installation"]), visit("DONA_01", 2, ["Revision"]), visit("DONA_02", 2, ["SiteStart", "Installation"])]
    book = visit_deployments.visit_book(visits, locations=LOCATIONS, unknown=[{"location_id": "DONA_02", "session": "R0001"}], planned=["R0003"])

    assert [(r["session"], r["location_id"]) for r in book if r["location_id"] == "DONA_02"] == [("R0002", "DONA_02"), ("R0003", "DONA_02")]   # no R0001: neither planned nor unknown
    assert [r["location_id"] for r in book if r["session"] == "R0001"] == ["DONA_01"]


PENDING = {"location_id": "DONA_03", "status": "pending"}


def test_the_first_camera_put_up_at_a_pending_site_is_where_it_starts_and_nothing_else_says_a_start():
    install = visit("DONA_03", 5, ["Installation"])

    assert visit_rules.with_site_start(install, [], PENDING)["actions"] == ["SiteStart", "Installation"]
    assert visit_rules.with_site_start(install, [], {**PENDING, "status": "ready"}) is install                 # a site that is not pending started before, or its start is not known
    assert visit_rules.with_site_start(install, [], None) is install
    assert visit_rules.with_site_start(visit("DONA_03", 5, ["Revision"]), [], PENDING)["actions"] == ["Revision"]   # not a camera put up
    assert visit_rules.with_site_start(install, [visit("DONA_03", 4, ["Revision"])], PENDING) is install        # not the first visit to the site
    said = visit("DONA_03", 5, ["SiteStart", "Installation"])
    assert visit_rules.with_site_start(said, [], PENDING) is said                                               # and it is not said twice
    assert visit_rules.with_site_start(visit("DONA_03", 5, [], camera_status="Not revised"), [], PENDING)["actions"] == []


def test_a_pending_site_is_not_waited_for_until_a_visit_to_it_is_known():
    locations = [*LOCATIONS, PENDING]
    kept = [visit("DONA_01", 1, ["Installation"]), visit("DONA_02", 1, ["Installation"])]

    assert visit_rules.revision_missing(1, kept, locations) == []
    assert visit_rules.not_visited_records(1, kept, locations) == []
    assert [r["location_id"] for r in visit_deployments.visit_book(kept, locations=locations, planned=["R0002"]) if r["session"] == "R0002"] == ["DONA_01", "DONA_02"]   # no row of it

    kept.append(visit("DONA_03", 2, ["Revision"]))                                                              # a visit to it is known: it is in play
    assert "DONA_03" in visit_rules.revision_missing(3, [*kept, visit("DONA_01", 3, ["Revision"])], locations)
