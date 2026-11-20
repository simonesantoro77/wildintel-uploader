"""A History — the visits so far, kept also by site and by revision — gives the rules the answers a plain list gives, only faster (#138)."""
import random

import pytest

from wildintel_uploader.core.services import visit_rules

SITES = ["DONA_01", "dona_02", "DONA_03", "DONA_04"]
ACTIONS = [["Installation"], ["Revision"], ["Revision", "Installation"], ["Desinstallation"], ["Stolen"], ["Installation", "Desinstallation"], ["SiteStart", "Installation"]]


def _visits(seed: int, count: int) -> list[dict]:
    """Visits that break the rules in every way — cameras and cards moving between sites, two visits at one instant, revisions out of order, ids in another case — in the order they were
    made up, not the order of their instants."""
    rng = random.Random(seed)
    out = []
    for _ in range(count):
        day = rng.randint(1, 9)
        visit = {"location_id": rng.choice(SITES), "session": f"R{rng.randint(1, 4):04d}", "date": f"2026-06-{day:02d}", "time": f"{rng.choice([8, 9, 9, 10]):02d}:00:00",
                 "actions": rng.choice(ACTIONS), "camera_id": rng.choice(["C1", "C2", "c1", None]), "sd": rng.choice(["A1", "A2", "a1", None]), "num_photos": 5,
                 "camera_status": rng.choice([None, None, None, "Not revised"]), "setup_by": "Ana"}
        visit["when"] = f"{visit['date']}T{visit['time']}"
        out.append(visit)
    return out


def _answers(kept, candidates, cards, unknown):
    answers = []
    for visit in candidates:
        answers.append([
            [str(r) for r in visit_rules.refusals(visit, kept, [{"location_id": s} for s in SITES], cards, unknown, gate=False, first_may_be_any=True)],
            visit_rules.camera_at_site(kept, visit["location_id"], visit["when"], unknown, 2),
            visit_rules.card_at_site(kept, visit["location_id"], visit["when"], unknown, 2),
            visit_rules.site_without_camera(kept, visit["location_id"], visit["when"], unknown, 2),
            visit_rules.camera_at(kept, visit.get("camera_id") or "C1", visit["when"], unknown, 2),
            visit_rules.card_at(kept, visit.get("sd") or "A1", visit["when"], unknown, 2),
            visit_rules.with_site_start(visit, kept, {"location_id": visit["location_id"], "status": "pending"}),
        ])
    return answers


@pytest.mark.parametrize("seed", range(12))
def test_the_rules_say_the_same_with_a_history_as_with_a_list(seed):
    everything = _visits(seed, 60)
    kept, candidates = everything[:45], everything[45:]
    unknown = [{"location_id": "DONA_03", "session": "R0001"}]
    cards = [{"label": "A2", "status": "archived", "status_date": "2026-06-05"}]
    assert _answers(visit_rules.History(kept), candidates, cards, unknown) == _answers(list(kept), candidates, cards, unknown)


@pytest.mark.parametrize("seed", range(6))
def test_a_history_grown_visit_by_visit_says_what_a_list_says(seed):
    """What it remembers of a site is forgotten when another visit to the site comes."""
    everything = _visits(seed, 40)
    history, plain = visit_rules.History(), []
    for visit in everything:
        assert _answers(history, [visit], None, None) == _answers(plain, [visit], None, None)
        history.append(visit)
        plain.append(visit)


def _conflicts_by_looking_at_every_pair(new, kept):
    """What revision_order_conflicts said before it compared the revisions by their first and last instants: each visit against every other."""
    out = []
    for v in new:
        number = visit_rules._session_number(v.get("session"))
        if number is None:
            continue
        for other in (w for w in [*kept, *new] if w is not v):
            n = visit_rules._session_number(other.get("session"))
            if n is None or n == number:
                continue
            if n < number and visit_rules._stamp(other) >= visit_rules._stamp(v) or n > number and visit_rules._stamp(other) <= visit_rules._stamp(v):
                out.append((id(v), id(other)))
                break
    return out


@pytest.mark.parametrize("seed", range(12))
def test_the_revisions_out_of_order_are_the_same_as_looking_at_every_pair(seed):
    new, kept = _visits(seed, 30), _visits(seed + 100, 20)
    told = visit_rules.revision_order_conflicts(new, kept)
    assert [id(v) for v, _ in told] == [pair[0] for pair in _conflicts_by_looking_at_every_pair(new, kept)]
    for visit, why in told:   # and each says the visit that was found first
        other = next(o for v_id, o_id in _conflicts_by_looking_at_every_pair(new, kept) if v_id == id(visit) for o in [*kept, *new] if id(o) == o_id)
        assert f"{other['date']} at {other['time']}" in why


def test_a_history_is_only_added_to():
    history = visit_rules.History(_visits(0, 3))
    history.append(_visits(1, 1)[0])
    history.extend(_visits(2, 2))
    assert len(history) == 6
    with pytest.raises(TypeError):
        history.pop()
    with pytest.raises(TypeError):
        history[0] = {}
    with pytest.raises(TypeError):
        history += [{}]
