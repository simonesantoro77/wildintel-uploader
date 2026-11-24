"""The rules a visit to a camera trap has to follow — the one place they live, for the form and for a CSV file: a visit that breaks them is refused
in both. The only thing a file is excused is what cannot be checked because the revisions before are unknown (see `refusals`).

  * what is asked of a visit depends on what was done at it (an Installation needs the camera and the card it leaves, a Revision the photos
    it collected…) — `required_errors`;
  * where the cameras and the SD cards are, worked out from the visits before: a camera is put up at a site until a visit takes it away or
    finds it stolen, a card is in a camera until a visit collects it — `availability_errors`;
  * the history of a site: two Revisions or two Installations in one session, a visit that is not after the one before, a Revision with no
    photos, an Installation while the card left before was not collected, a camera or a card at two sites in a session — `history_warnings`;
  * a site that is not a location of the research project, told apart from one misnamed — `new_site`.
"""
from __future__ import annotations

import re
from bisect import bisect_left
from datetime import datetime
from functools import lru_cache
from math import asin, cos, radians, sin, sqrt

ACTIONS = ("SiteStart", "Installation", "Revision", "Desinstallation", "Stolen", "Archive")
#: The action that says a site starts — said once, in its first visit, as Archive says it ends. What was before is not expected: the revisions before it do not wait for a visit to the
#: site, and nothing of them is unknown. A site with no such visit has a start nobody knows: what came before it is unknown.
SITE_START = "SiteStart"
# What each action asks: the camera, the card left, the photos collected, and how the camera was found — "required" or "optional". Only an Installation says which camera: the
# others — a Revision, a Desinstallation, a Stolen camera — are of the one that was there, which the visit before says.
_ASKED = {
    "SiteStart": {},  # the site begins here: nothing else is asked (the camera is put up by an Installation, which it can come with)
    "Installation": {"camera": "required", "sd": "required"},
    "Revision": {"sd": "optional", "photos": "required", "camera_status": "optional"},
    "Desinstallation": {"photos": "required", "camera_status": "optional"},
    "Stolen": {},
    "Archive": {},  # the location is given up: nothing else is asked
}
_LABELS = {"camera": "The camera", "sd": "The SD card left in the camera", "photos": "The number of images on the card collected", "camera_status": "The status of the camera"}
def unusual_card_id(label: str) -> bool:
    """Whether the id of an SD card is out of the ordinary: it has spaces or signs — `84 (10)`, `85(78)`, `38_B` — where ids are letters and digits, like `A13`, `47b` or `693`. It is said, not refused:
    the label on a card is whatever was written on it."""
    return re.fullmatch(r"[A-Za-z0-9]+", str(label).strip()) is None


def unusual_card_message(label: str) -> str:
    return f"The SD card '{label}' has an unusual id, with spaces or signs: ids are usually letters and digits, like A13, 47b or 693. Check that it is written as it is on the card; it is kept as written."


NOT_REVISED = ("not revised", "no revisada", "no revisado")
# The status of the camera a visit may say ("Knocked down" and "Damaged" are no longer accepted: what was kept with them is still read): how it was found, Stolen when it was gone, Not revised when the visit could not be made, and what the field form says of a site that is
# new or was inactive (a camera is put up there).
CAMERA_STATUSES = ("OK", "Altered", "Stolen", "Not revised", "New site", "Inactive site")


def camera_status_code(value) -> str | None:
    """The status of the camera as it is written — found ignoring case and spaces (and "No revisada" as Not revised) —, or None when it is not one of CAMERA_STATUSES."""
    word = " ".join(str(value).split()).lower()
    if word in NOT_REVISED:
        return "Not revised"
    return next((s for s in CAMERA_STATUSES if s.lower() == word), None)


class Reason(str):
    """Why a visit is refused — the text, and `code`: which rule it is, for the label of the error (see visits_csv.ERROR_LABELS)."""
    code: str = "visit_refused"


def _reason(code: str, text: str) -> Reason:
    reason = Reason(text)
    reason.code = code
    return reason


@lru_cache(maxsize=None)
def _site_key(name: str) -> str:
    return name.strip().lower()


def _same(a, b) -> bool:
    """The same site: read whatever its case (it is the name of a folder, and Trapper keeps its ids in lower case)."""
    return _site_key(str(a or "")) == _site_key(str(b or ""))


def _same_gear(a, b) -> bool:
    """The same camera or SD card: as written — `7b` and `7B` are two."""
    return str(a or "").strip() == str(b or "").strip()


# How the batteries and the SD card were, each in a field of its own: the batteries are OK or there were none (NoBatteries), the card is OK or was full (CardFull).
BATTERY_STATUSES = ("OK", "NoBatteries")
CARD_STATUSES = ("OK", "CardFull")
# What one code told of both, before they were two fields (and as the datasheet wrote them: SinPilas, CarFullSinPilas), and what it tells now: (batteries, card)
_BOTH = {"ok": ("OK", "OK"), "carfull": ("OK", "CardFull"), "cardfull": ("OK", "CardFull"), "nobatteries": ("NoBatteries", "OK"), "sinpilas": ("NoBatteries", "OK"),
         "carfullnobatteries": ("NoBatteries", "CardFull"), "cardfullnobatteries": ("NoBatteries", "CardFull"), "carfullsinpilas": ("NoBatteries", "CardFull")}


def split_card_batteries(code) -> tuple[str | None, str | None]:
    """The status of the batteries and the one of the card from the single code that told both (OK, CarFull, NoBatteries, CarFullNoBatteries…): (None, None) when it is not one."""
    return _BOTH.get("".join(str(code or "").split()).lower().replace("_", "").replace("-", ""), (None, None))


def battery_status_code(value) -> str | None:
    """The status of the batteries as it is written — OK or NoBatteries, found ignoring case and spaces (and "sin pilas" or "no battery" as NoBatteries) — or None when it is neither."""
    word = "".join(str(value).split()).lower().replace("_", "").replace("-", "")
    return {"ok": "OK", "nobatteries": "NoBatteries", "nobattery": "NoBatteries", "sinpilas": "NoBatteries", "sinbateria": "NoBatteries", "sinbaterias": "NoBatteries"}.get(word)


def card_status_code(value) -> str | None:
    """The status of the SD card as it is written — OK or CardFull, found ignoring case and spaces (and "CarFull", "tarjeta llena" as CardFull) — or None when it is neither."""
    word = "".join(str(value).split()).lower().replace("_", "").replace("-", "")
    return {"ok": "OK", "cardfull": "CardFull", "fullcard": "CardFull", "carfull": "CardFull", "full": "CardFull", "tarjetallena": "CardFull"}.get(word)


def with_site_start(visit: dict, kept: list[dict], location: dict | None) -> dict:
    """A New site explicitly starts the site; otherwise its first Installation starts it only when it is pending."""
    actions = list(visit.get("actions") or [])
    if SITE_START in actions:
        return visit
    if camera_status_code(visit.get("camera_status")) == "New site":
        return {**visit, "actions": [SITE_START, *actions]}
    if not location or location.get("status") != "pending" or "Installation" not in actions or is_not_revised(visit):
        return visit
    if _site_visits(kept, visit["location_id"]):
        return visit
    return {**visit, "actions": [SITE_START, *actions]}


def _in_play(location: dict, *visits: list[dict] | None) -> bool:
    """Whether a location is in play — waited for in the revisions, drawn in the visit book: a *pending* one has not started, so until a visit to it is known it is not."""
    if location.get("status") != "pending":
        return True
    site = str(location.get("location_id") or "")
    return any(_same(v.get("location_id"), site) for group in visits for v in group or [])


def site_start_number(site: str, visits: list[dict]) -> int | None:
    """The revision in which a site starts — that of its visit that says SiteStart — or None when no visit says it: its start is not known."""
    numbers = [n for v in visits if _same(v.get("location_id"), site) and SITE_START in (v.get("actions") or []) for n in [_session_number(v.get("session"))] if n is not None]
    return min(numbers) if numbers else None


def site_starts(visits: list[dict]) -> dict[str, int]:
    """The revision in which each site starts (the site, lower case), for the sites whose start is known."""
    out: dict[str, int] = {}
    for v in visits:
        n = _session_number(v.get("session"))
        if SITE_START in (v.get("actions") or []) and n is not None:
            site = str(v.get("location_id") or "").lower()
            out[site] = min(n, out.get(site, n))
    return out


def _stamp(v: dict) -> str:
    """When a visit was, to order visits: its instant (`when`, ISO 8601 UTC) — the wall clock of its location only when it has none."""
    return v.get("when") or f"{v.get('date')}T{v.get('time')}"


def _seconds(v: dict) -> float:
    return datetime.fromisoformat(_stamp(v)).timestamp()


def _takes_away(v: dict) -> bool:
    return bool({"Desinstallation", "Stolen"} & set(v.get("actions") or []))


def is_not_revised(v: dict) -> bool:
    """A visit that could not be made: its status says it was not revised, so nothing was looked at, collected or left."""
    return str(v.get("camera_status") or "").lower() in NOT_REVISED


def _leaves_camera(v: dict) -> bool:
    """Whether a visit leaves a camera at its site: it puts one up, or it looks at the one that is there and does not take it away."""
    actions = set(v.get("actions") or [])
    return "Installation" in actions or ("Revision" in actions and not _takes_away(v) and not is_not_revised(v))


def _collects_card(v: dict) -> bool:
    return _takes_away(v) or ("Revision" in (v.get("actions") or []) and not is_not_revised(v))


def _leaves_card(v: dict) -> bool:
    return bool({"Installation", "Revision"} & set(v.get("actions") or []))


class History(list):
    """The visits so far, to which more are added (and nothing is taken away or changed), kept also by site and by revision.

    The rules ask the same things of the visits again and again — the visits to a site, those of a revision, the last of the revisions before one — and a plain list
    answers each by looking through all of them: reading a file of a few thousand visits is then slow, as the work grows with the square of the visits. The rules below
    use these indexes when they are given a History, and look through the list when they are given any other list: the answers are the same."""

    def __init__(self, visits=()):
        super().__init__()
        self._by_site: dict[str, list[dict]] = {}       # the visits to each site (lower case), as they came
        self._by_time: dict[str, list[dict]] = {}       # the same, by their instants — made when asked, and again after another visit to the site came
        self._by_session: dict[str, list[dict]] = {}    # the visits of each revision, as they came, by what their `session` says
        self._latest: dict[int, tuple[tuple, dict]] = {}   # of each revision number, its last visit by its instant (the first that came when two are at once)
        self._pos: dict[int, int] = {}                  # where each visit came: the order that ties between sites are told by
        self._memo: dict[str, dict[tuple, object]] = {}   # what was worked out of a site at an instant, until another visit to the site comes
        self.extend(visits)

    def append(self, visit: dict) -> None:
        self._pos.setdefault(id(visit), len(self))
        super().append(visit)
        site = _site_key(str(visit.get("location_id") or ""))
        self._by_site.setdefault(site, []).append(visit)
        self._by_time.pop(site, None)
        self._memo.pop(site, None)
        self._by_session.setdefault(visit.get("session"), []).append(visit)
        number = _session_number(visit.get("session"))
        if number:   # a visit with no number, or 0, is of no revision before another
            key = (_stamp(visit), -self._pos[id(visit)])
            if number not in self._latest or key > self._latest[number][0]:
                self._latest[number] = (key, visit)

    def extend(self, visits) -> None:
        for visit in visits:
            self.append(visit)

    def _frozen(self, *args, **kwargs):
        raise TypeError("A History is only added to: its indexes would not follow what is taken away or changed.")

    __setitem__ = __delitem__ = __iadd__ = __imul__ = insert = remove = pop = clear = sort = reverse = _frozen

    def at_site(self, site) -> list[dict]:
        return self._by_site.get(_site_key(str(site or "")), [])

    def at_site_by_time(self, site) -> list[dict]:
        key = _site_key(str(site or ""))
        if key not in self._by_time:
            self._by_time[key] = sorted(self._by_site.get(key, ()), key=_stamp)
        return self._by_time[key]

    def sites_by_time(self):
        for key in self._by_site:
            yield self.at_site_by_time(key)

    def remembered(self, what: str, site, when: str, work_out):
        """What `work_out()` gives for a site at an instant: worked out once, and again after another visit to the site came. It is given as it was kept: not to be changed."""
        cache = self._memo.setdefault(_site_key(str(site or "")), {})
        if (what, when) not in cache:
            cache[(what, when)] = work_out()
        return cache[(what, when)]

    def of_session(self, session) -> list[dict]:
        return self._by_session.get(session, [])

    def latest_before(self, number: int) -> dict | None:
        """The last, by its instant, of the visits of the revisions before `number`."""
        best = max((entry for n, entry in self._latest.items() if n < number), key=lambda entry: entry[0], default=None)
        return best[1] if best else None


def _site_visits(visits: list[dict], site) -> list[dict]:
    """The visits to a site, as they came."""
    return visits.at_site(site) if isinstance(visits, History) else [v for v in visits if _same(v.get("location_id"), site)]


def _site_visits_by_time(visits: list[dict], site) -> list[dict]:
    """The visits to a site, by their instants."""
    return visits.at_site_by_time(site) if isinstance(visits, History) else sorted((v for v in visits if _same(v.get("location_id"), site)), key=_stamp)


def _session_visits(visits: list[dict], session) -> list[dict]:
    """The visits whose `session` says exactly this, as they came."""
    return visits.of_session(session) if isinstance(visits, History) else [v for v in visits if v.get("session") == session]


def _latest_before(visits: list[dict], number: int) -> dict | None:
    """The last, by its instant, of the visits of the revisions before `number` (the first that came when two are at once)."""
    if isinstance(visits, History):
        return visits.latest_before(number)
    return max((v for v in visits if (_session_number(v.get("session")) or number) < number), key=_stamp, default=None)


def _last_touch(group: list[dict], when: str, touches) -> dict | None:
    """Of the visits to a site, by their instants, the last before `when` that does something to a camera or a card (`touches`)."""
    for i in range(bisect_left(group, when, key=_stamp) - 1, -1, -1):
        if touches(group[i]):
            return group[i]
    return None


def _touches_camera(v: dict) -> bool:
    return _takes_away(v) or bool(_leaves_camera(v) and v.get("camera_id"))


def _touches_card(v: dict) -> bool:
    return _collects_card(v) or bool(v.get("sd") and _leaves_card(v))


def asked(actions: list[str]) -> dict[str, str]:
    """Each field a visit may be asked, as strongly as any of its actions asks it."""
    out: dict[str, str] = {}
    for action in actions:
        for field, how in _ASKED.get(action, {}).items():
            if how == "required" or field not in out:
                out[field] = how
    return out


def required_errors(visit: dict, photos_optional: bool = False) -> dict[str, str]:
    """What a visit lacks of what its actions ask of it, by field (camera, sd, photos, camera_status) — nothing when it is complete. With `photos_optional` the count of the photos is not asked:
    what an old datasheet never had — the deployment is then not checked against it."""
    errors = {}
    if is_not_revised(visit):
        return errors  # nothing was done at it: nothing is asked
    actions = visit.get("actions") or []
    value = {"camera": visit.get("camera_id"), "sd": visit.get("sd"), "photos": visit.get("num_photos"), "camera_status": visit.get("camera_status")}
    # With the card full the photos are not counted: the count is not asked (it may still be given).
    full_card = visit.get("card_status") == "CardFull"
    for field, how in asked(actions).items():
        if field == "photos" and (full_card or photos_optional):
            continue
        if how == "required" and (value[field] is None or str(value[field]).strip() == ""):
            by = " + ".join(a for a in actions if _ASKED.get(a, {}).get(field) == "required")
            errors[field] = _reason("required_field", f"{_LABELS[field]} is required for {by}.")
    return errors


def _stale(at: dict | None, site: str, unknown: list[dict] | None, number: int | None) -> bool:
    """Whether what a visit left at a site — where a camera is, which card is in it — cannot be trusted at revision `number`: a revision of that site between them is
    unknown, and nobody knows what was done in it. What cannot be known cannot be checked."""
    if not at or not unknown or number is None:
        return False
    since = _session_number(at.get("session"))
    return since is not None and any(_same(u.get("location_id"), site) and (n := _session_number(u.get("session"))) is not None and since < n < number for u in unknown)


def camera_at(visits: list[dict], camera: str, when: str, unknown: list[dict] | None = None, number: int | None = None) -> dict | None:
    """The site a camera is put up at on a given moment — None when it is nowhere: never put up, uninstalled or stolen, or when it cannot be told (an unknown revision of
    its site came after). What is at a site is what its last visit left: a visit that takes the camera away or finds it stolen leaves none, and one that also puts another up — a
    replacement — leaves that one."""
    if isinstance(visits, History):
        # what each site's last visit that did something to a camera left there; when two sites have this camera, the one that was touched first is told
        best = None
        for group in visits.sites_by_time():
            last = _last_touch(group, when, _touches_camera)
            if last is None or not (_leaves_camera(last) and last.get("camera_id") and _same_gear(last["camera_id"], camera)):
                continue
            first = next(v for v in group if _touches_camera(v))
            key = (_stamp(first), visits._pos[id(first)])
            if best is None or key < best[0]:
                best = (key, last)
        at = {"site": best[1]["location_id"], "date": best[1]["date"], "session": best[1].get("session")} if best else None
        return None if at is None or _stale(at, at["site"], unknown, number) else at
    here: dict[str, dict | None] = {}
    for v in sorted((v for v in visits if _stamp(v) < when), key=_stamp):
        site = str(v["location_id"]).lower()
        if _takes_away(v):
            here[site] = None
        if _leaves_camera(v) and v.get("camera_id"):
            here[site] = {"camera": v["camera_id"], "site": v["location_id"], "date": v["date"], "session": v.get("session")}
    at = next(({"site": h["site"], "date": h["date"], "session": h["session"]} for h in here.values() if h and _same_gear(h["camera"], camera)), None)
    return None if at is None or _stale(at, at["site"], unknown, number) else at


def camera_at_site(visits: list[dict], site: str, when: str, unknown: list[dict] | None = None, number: int | None = None) -> dict | None:
    """The camera that is put up at a site on a given moment — None when none is known: nothing was installed there, or it was taken away or stolen, or an unknown revision
    of the site came after what is known. A visit that takes the camera away and puts another up leaves the other."""
    def work_out():
        at = None
        for v in _site_visits_by_time(visits, site):
            if _stamp(v) >= when:
                break
            if _takes_away(v):
                at = None
            if _leaves_camera(v) and v.get("camera_id"):
                at = {"camera": v["camera_id"], "date": v["date"], "session": v.get("session")}
        return at
    at = visits.remembered("camera", site, when, work_out) if isinstance(visits, History) else work_out()
    return None if _stale(at, site, unknown, number) else at


def site_without_camera(visits: list[dict], site: str, when: str, unknown: list[dict] | None = None, number: int | None = None) -> dict | None:
    """The visit that left a site with no camera — a Desinstallation, a Stolen camera — when it is the last that did something there before `when` and nothing is unknown after it: what the
    site has none of is known. None when it has a camera, when it has had none of its own (no visit before: the first visit puts one up), or when it cannot be told (an unknown revision of the site came after)."""
    at, last = None, None
    for v in _site_visits_by_time(visits, site):
        if _stamp(v) >= when:
            break
        if is_not_revised(v):
            continue
        if _takes_away(v):
            at, last = None, v
        if _leaves_camera(v) and v.get("camera_id"):
            at, last = v, v
    if at is not None or last is None or _stale({"session": last.get("session")}, site, unknown, number):
        return None
    return last


def card_at(visits: list[dict], label: str, when: str, unknown: list[dict] | None = None, number: int | None = None) -> dict | None:
    """The site whose camera holds a card on a given moment — None when it is in none: never left, or collected, or when it cannot be told (an unknown revision of
    that site came after)."""
    if isinstance(visits, History):
        best = None
        for group in visits.sites_by_time():
            last = _last_touch(group, when, _touches_card)
            if last is None or not (last.get("sd") and _leaves_card(last) and _same_gear(last["sd"], label)):
                continue
            # a site is put in the order when a card is left where none was — after the last visit that collected one, or the first — and keeps its place until one is collected
            end = bisect_left(group, when, key=_stamp)
            start = next((i for i in range(end - 1, -1, -1) if _collects_card(group[i])), 0)
            first = next(v for v in group[start:end] if v.get("sd") and _leaves_card(v))
            key = (_stamp(first), visits._pos[id(first)])
            if best is None or key < best[0]:
                best = (key, last)
        found = {"site": best[1]["location_id"], "date": best[1]["date"], "session": best[1].get("session")} if best else None
        return None if found and _stale(found, found["site"], unknown, number) else found
    in_site: dict[str, dict] = {}
    for v in sorted((v for v in visits if _stamp(v) < when), key=_stamp):
        site = str(v["location_id"]).lower()
        if _collects_card(v):
            in_site.pop(site, None)
        if v.get("sd") and _leaves_card(v):
            in_site[site] = {"label": v["sd"], "date": v["date"], "site": v["location_id"], "session": v.get("session")}
    found = next(({"site": c["site"], "date": c["date"], "session": c["session"]} for c in in_site.values() if _same_gear(c["label"], label)), None)
    return None if found and _stale(found, found["site"], unknown, number) else found


def card_at_site(visits: list[dict], site: str, when: str, unknown: list[dict] | None = None, number: int | None = None) -> dict | None:
    """The card the camera at a site holds on a given moment — None when it holds none: never left, or collected, or an unknown revision of the site came after."""
    def work_out():
        at = None
        for v in _site_visits_by_time(visits, site):
            if _stamp(v) >= when:
                break
            if _collects_card(v):
                at = None
            if v.get("sd") and _leaves_card(v):
                at = {"label": v["sd"], "date": v["date"], "session": v.get("session")}
        return at
    at = visits.remembered("card", site, when, work_out) if isinstance(visits, History) else work_out()
    return None if _stale(at, site, unknown, number) else at


def card_block(kept: list[dict], visit: dict, cards: list[dict] | None = None, unknown: list[dict] | None = None) -> str | None:
    """Why a visit cannot leave the card it says in the camera — None when it can, or when it leaves none. A card cannot be left when it is archived (from the
    day it was; with no day, for good), when it is in the camera of another site, when it is the one the visit collects, or when a visit of the same revision
    collected it."""
    card = str(visit.get("sd") or "").strip()
    actions = visit.get("actions") or []
    installs, revises = "Installation" in actions, "Revision" in actions
    if not (installs or revises) or not card:
        return None
    when = _stamp(visit)
    site = str(visit["location_id"]).strip()
    collects = revises or "Desinstallation" in actions or "Stolen" in actions
    settings = next((c for c in cards or [] if _same_gear(c.get("label"), card)), None)
    if settings and settings.get("status") == "archived" and (not settings.get("status_date") or str(settings["status_date"]) <= str(visit.get("date"))):
        since = f" since {settings['status_date']}" if settings.get("status_date") else ""
        reason = f" ({settings['archive_reason']})" if settings.get("archive_reason") else ""
        return _reason("card_archived", f"SD card {card} is not available{since}: it is archived{reason}.")
    number = _session_number(visit.get("session"))
    there = card_at(kept, card, when, unknown, number)
    if there and collects and _same(there["site"], site):
        return _reason("card_is_the_one_collected", f"SD card {card} is the one this visit collects (left on {there['date']}): the card left in the camera has to be another.")
    if there:
        return _reason("card_in_another_camera", f"SD card {card} is in the camera at {there['site']} (left on {there['date']}): it has to be collected before it is left here.")
    session = visit.get("session")
    if session:
        for w in _session_visits(kept, session):
            if w is not visit and _collects_card(w):
                held = card_at_site(kept, w["location_id"], _stamp(w), unknown, _session_number(w.get("session")))
                if held and _same_gear(held["label"], card):
                    return _reason("card_collected_in_revision", f"SD card {card} was collected at {w['location_id']} in this revision ({session}): it cannot be left again in the same revision.")
    return None


def availability_errors(kept: list[dict], visit: dict, cards: list[dict] | None = None, unknown: list[dict] | None = None) -> dict[str, str]:
    """What stops a visit for where its camera or its card is: the camera put up while it is somewhere else, a card left in a camera while it is
    in another one — or the very one the visit collects. Nothing is said while the visit does not say which."""
    errors: dict[str, str] = {}
    when = _stamp(visit)
    site = str(visit["location_id"]).strip()
    actions = visit.get("actions") or []
    installs, revises = "Installation" in actions, "Revision" in actions
    collects = revises or "Desinstallation" in actions or "Stolen" in actions
    number = _session_number(visit.get("session"))   # what an unknown revision between hides cannot be checked

    camera = visit.get("camera_id")
    # A visit that does not put a camera up — a Revision, a Desinstallation, a Stolen camera — is of the camera that is at the site.
    if camera and not installs and (collects or revises):
        there = camera_at_site(kept, site, when, unknown, number)
        if there and not _same_gear(there["camera"], camera):
            what = " + ".join(x for x in actions if x in ACTIONS)
            errors["camera"] = _reason("camera_not_at_the_site", f"The camera at {site} is {there['camera']} (since {there['date']}): a {what} is of that camera. If it was replaced, add a Desinstallation and an Installation to the visit.")
    if installs and camera:
        there = camera_at(kept, camera, when, unknown, number)
        # A visit that also revises may find the camera in the very site it puts it up at.
        if there and not (revises and _same(there["site"], site)):
            errors["camera"] = (
                _reason("camera_installed_here", f"Camera {camera} is already installed here (since {there['date']}): it has to be uninstalled first.")
                if _same(there["site"], site) else
                _reason("camera_installed_elsewhere", f"Camera {camera} is installed at {there['site']} (since {there['date']}): it has to be uninstalled there before it is installed here.")
            )
    # Where a visit took the camera away or found it stolen, the site has none: there is nothing to look at, to take away or to find stolen — only an Installation, an Archive or a visit that is not made can follow.
    if {"Revision", "Desinstallation", "Stolen"} & set(actions) and not is_not_revised(visit) and "camera" not in errors:
        empty = site_without_camera(kept, site, when, unknown, number)
        if empty:
            errors["camera"] = _reason("site_without_camera", f"{site} has no camera: it was taken away or found stolen in {empty.get('session')} (on {empty['date']}). Only an Installation, an Archive or a visit not made can follow.")
    # A site has one camera at a time: another cannot be put up where one is, unless this visit takes it away (a Desinstallation, or a Stolen camera).
    if installs and not {"Desinstallation", "Stolen"} & set(actions) and "camera" not in errors:
        here = camera_at_site(kept, site, when, unknown, number)
        if here and not _same_gear(here["camera"], camera) and not (revises and _same_gear(here["camera"], camera)):
            errors["camera"] = _reason("site_has_a_camera", f"{site} already has a camera: {here['camera']} (since {here['date']}). It has to be taken away — a Desinstallation, or a Stolen visit — before another is put up.")
    sd = card_block(kept, visit, cards, unknown)
    if sd:
        errors["sd"] = sd
    return errors


def entity_changes(visit: dict, before: list[dict]) -> list[dict]:
    """What a visit does to the cameras, the SD cards and the site, given the visits kept before it: {"kind": "cameras" | "sd_cards" | "locations", "name", "status": "active" | "ready" | "archived", "reason"}.
    A camera or a card put in the field is active, and so is the site that has a camera; a site that starts is ready; the one taken away — the camera that was at the site, the card that was in it — is ready again; a camera found stolen is archived
    (stolen), and its card with it. A visit that could not be made changes nothing."""
    if is_not_revised(visit):
        return []
    actions = set(visit.get("actions") or [])
    when, site = _stamp(visit), str(visit["location_id"])
    there = camera_at_site(before, site, when)
    held = card_at_site(before, site, when)
    old = there["camera"] if there else (visit.get("camera_id") if actions & {"Desinstallation", "Stolen"} and "Installation" not in actions else None)
    out: list[dict] = []

    def put(kind: str, name, status: str, reason: str | None = None) -> None:
        if name:
            out.append({"kind": kind, "name": str(name), "status": status, "reason": reason})

    if "Stolen" in actions:
        put("cameras", old, "archived", "stolen")
        put("sd_cards", held["label"] if held else None, "archived", "stolen")
    else:
        if {"Desinstallation"} & actions or ("Installation" in actions and old and not _same_gear(old, visit.get("camera_id"))):
            put("cameras", old, "ready")
        if held and ({"Revision", "Desinstallation"} & actions):
            put("sd_cards", held["label"], "ready")
    if "Installation" in actions:
        put("cameras", visit.get("camera_id"), "active")
        put("locations", site, "active")
    elif {"Desinstallation", "Stolen"} & actions:
        put("locations", site, "ready")        # no camera is there now: the site is ready to have one
    elif SITE_START in actions:
        put("locations", site, "ready")        # the site starts: it is ready to have a camera (a site that starts with an Installation is active)
    if visit.get("sd") and _leaves_card(visit):
        put("sd_cards", visit["sd"], "active")
    return out


def history_warning_items(new: list[dict], kept: list[dict], cards: list[dict] | None = None, unknown: list[dict] | None = None, photos_optional: bool = False) -> list[tuple[str, list[dict]]]:
    """What is odd in the visits of a file, among them and with the ones already kept — each said once, with the session and the site, and with the visits of the
    file that it is about (the ones that make it odd). They are questions for the one who knows the field, not reasons to refuse a visit."""
    items: dict[str, list[dict]] = {}
    everything = History(sorted([*kept, *new], key=_stamp))   # a visit is asked about with all of them, itself too: only what is before its instant counts

    def say(message: str, *visits: dict) -> None:
        about = items.setdefault(message, [])
        about += [v for v in visits if not any(v is w for w in about)]

    def label(v: dict) -> str:
        return f"{v.get('session')} {v['location_id']}"

    # Per session and site: the same thing done twice.
    count: dict[tuple, list[dict]] = {}
    for v in new:
        for action in ("Installation", "Revision"):
            if action in v["actions"]:
                count.setdefault((v["session"], v["location_id"].lower(), action), []).append(v)
    for (session, site, action), of in sorted(count.items(), key=lambda kv: kv[0]):
        if len(of) > 1:
            hint = " (typo in the location number?)" if action == "Installation" else ""
            say(f"{session}: {site} has {len(of)} \"{action}\" entries in the same revision{hint}.", *of)

    for v in new:
        here = [e for e in _site_visits(everything, v["location_id"]) if e is not v]
        # Not after the visit of an earlier session.
        older = [e for e in here if str(e.get("session", "")) < str(v.get("session", "")) and _stamp(e) >= _stamp(v)]
        if older:
            say(f"{label(v)}: the visit time {v['date']} {v['time']} is not after the visit of {older[0].get('session')} ({older[0]['date']} {older[0]['time']}).", v)
        if "Revision" in v["actions"] and v.get("num_photos") is not None and v["num_photos"] <= 0:
            say(f"{label(v)}: Revision with 0 images; no deployment will be produced for it.", v)
        for message in required_errors(v, photos_optional).values():
            say(f"{label(v)}: {message}", v)
        # Where its camera and its card are, with what came before it — the visits of the file included.
        for message in availability_errors(everything, v, cards, unknown).values():
            say(f"{label(v)}: {message}", v)
        # An Installation while the card left at the visit before was not collected: nothing closes that deployment — unless the visit itself takes the card (a Revision, a
        # Desinstallation) or the camera went with it (a Stolen camera: its card is lost with it, and that is said by the visit).
        if "Installation" in v["actions"] and not {"Revision", "Desinstallation", "Stolen"} & set(v["actions"]):
            last = max((e for e in here if _stamp(e) < _stamp(v) and str(e.get("camera_status") or "").lower() not in NOT_REVISED), key=_stamp, default=None)
            if last and _leaves_card(last) and not _takes_away(last) and last.get("sd") and _seconds(v) - _seconds(last) >= 86400:
                say(f"{label(v)}: Installation on {v['date']} while the card left there on {last['date']} ({last.get('session')} {' + '.join(last['actions'])}) "
                    "was not collected — no Revision or Desinstallation before it, so that card has no deployment. Check the field data.", v)

    # A camera or a card at more than one site in a session.
    for what, key in (("Camera", "camera_id"), ("Card", "sd")):
        by: dict[tuple, list[dict]] = {}
        for v in new:
            value = v.get(key)
            if value in (None, ""):
                continue
            by.setdefault((v["session"], str(value).strip(), str(value).strip()), []).append(v)   # as written: 7b and 7B are two
        for (session, _, shown), of in sorted(by.items(), key=lambda kv: kv[0]):
            sites = {v["location_id"] for v in of}
            if len(sites) > 1:
                say(f"{session}: {what.lower()} {shown} is at {len(sites)} locations ({', '.join(sorted(sites))}).", *of)
    return list(items.items())


def history_warnings(new: list[dict], kept: list[dict], cards: list[dict] | None = None) -> list[str]:
    """What is odd in the visits of a file — see history_warning_items — as the messages only."""
    return [message for message, _ in history_warning_items(new, kept, cards)]


# The farthest the GPS of a note may be from its location before the site is doubted.
GPS_TOLERANCE_M = 1000


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """The distance between two points on the Earth, in metres (haversine)."""
    dlat, dlon = radians(lat2 - lat1), radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * 6371000 * asin(sqrt(a))


def one_apart(a: str, b: str) -> bool:
    """Whether two ids differ by one character — typed, missed or swapped: TATR_0004 / TATR_0005, but DONA_0022 / DONA_0022_B is not."""
    a, b = a.lower(), b.lower()
    if a == b or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        diff = [i for i in range(len(a)) if a[i] != b[i]]
        return len(diff) == 1 or (len(diff) == 2 and diff[1] == diff[0] + 1 and a[diff[0]] == b[diff[1]] and a[diff[1]] == b[diff[0]])
    short, long_ = (a, b) if len(a) < len(b) else (b, a)
    return any(long_[:i] + long_[i + 1:] == short for i in range(len(long_)))


def new_site(site: str, visits: list[dict], known: list[dict]) -> dict:
    """A site of a file that is not a location of the research project, with what helps tell a really new site from a misnamed one: the coordinates of
    its first visit, the nearest location kept and how far it is, and the ids one character apart from its own."""
    first = min(visits, key=_stamp)
    lat, lon = first.get("latitude"), first.get("longitude")
    nearest = None
    if lat is not None and lon is not None:
        distances = [(distance_m(lat, lon, float(l["latitude"]), float(l["longitude"])), l["location_id"])
                     for l in known if l.get("latitude") is not None and l.get("longitude") is not None]
        if distances:
            metres, location_id = min(distances)
            nearest = {"location_id": location_id, "distance_m": round(metres)}
    return {
        "site": site, "session": first.get("session"), "actions": first["actions"], "date": first["date"], "time": first["time"],
        "latitude": lat, "longitude": lon, "visits": len(visits), "nearest": nearest,
        "similar": sorted(str(l["location_id"]) for l in known if one_apart(site, str(l["location_id"]))),
    }


def refusals(visit: dict, kept: list[dict], locations: list[dict], cards: list[dict] | None = None, unknown: list[dict] | None = None,
             gate: bool = True, first_may_be_any: bool = False, photos_optional: bool = False) -> list[str]:
    """Why a visit made by hand cannot be kept (the same rules apply to the visits of a file; `gate` off leaves the check of the revision before to the caller, and
    `first_may_be_any` lets the first visit to a site in a revision after R0001 be any: what came before is unknown, so it cannot be told that the camera was not put up): its site is not a location of the research project, it is already kept (the same site, day and time),
    it is the first to its site and not an Installation, it lacks what its actions ask, or its camera or card are not where it says. Empty when it can be kept."""
    reasons = []
    if not any(_same(l.get("location_id"), visit["location_id"]) for l in locations):
        reasons.append(_reason("site_not_a_location", f"'{visit['location_id']}' is not a location of the research project."))
    if any(v.get("date") == visit["date"] and v.get("time") == visit["time"] for v in _site_visits(kept, visit["location_id"])):
        reasons.append(_reason("visit_at_the_same_time", f"There is already a visit to {visit['location_id']} on {visit['date']} at {visit['time']}."))
    reasons += order_errors(visit, kept)
    # The first visit to a site puts the camera up: nothing else can be done where no camera is known to be.
    unknown_before = first_may_be_any and (_session_number(visit.get("session")) or 1) > 1
    if not unknown_before and not is_not_revised(visit) and not any(_stamp(v) < _stamp(visit) for v in _site_visits(kept, visit["location_id"])) and not (visit.get("actions") and set(visit["actions"]) <= {"Installation", SITE_START}):
        reasons.append(_reason("first_visit_not_installation", f"The first visit to {visit['location_id']} can only be an Installation."))
    reasons += site_start_errors(visit, kept)
    reasons += required_errors(visit, photos_optional).values()
    reasons += availability_errors(kept, visit, cards, unknown).values()
    reasons += archive_errors(visit, kept, next((l for l in locations if _same(l.get("location_id"), visit["location_id"])), None), unknown)
    if gate:
        reasons += [why for _, why in revision_gate([visit], kept, locations, unknown)]
    return reasons


def site_start_errors(visit: dict, kept: list[dict]) -> list[str]:
    """What stops a visit that says a site starts: a site starts once, and with its first visit — one that comes after others to its site is not its start."""
    if SITE_START not in (visit.get("actions") or []):
        return []
    site = str(visit["location_id"]).strip()
    here = _site_visits(kept, site)
    before = [v for v in here if _stamp(v) < _stamp(visit)]
    if any(SITE_START in (v.get("actions") or []) for v in here):
        return [_reason("site_start_repeated", f"{site} has started already: a location starts once.")]
    if before:
        return [_reason("site_start_not_first", f"The start of {site} has to be its first visit: it has visits before ({before[0].get('session')} on {before[0]['date']}).")]
    return []


def order_errors(visit: dict, kept: list[dict]) -> list[str]:
    """What stops a visit for when it was: a site has one visit in a revision, and a visit is after the last one to its site and after every visit of the revisions
    before its own — a revision starts when the one before it is finished (see revision_gate)."""
    errors: list[str] = []
    number = _session_number(visit.get("session"))
    site = str(visit["location_id"]).strip()
    here = _site_visits(kept, site)
    if number is not None and any(_session_number(v.get("session")) == number for v in here):
        errors.append(_reason("visit_repeated", f"{site} already has a visit in R{number:04d}: a revision is one visit to each location."))
    last = max(here, key=_stamp, default=None)
    if last is not None and _stamp(last) >= _stamp(visit):
        errors.append(_reason("visit_not_after_the_last", f"The visit to {site} has to be after the last one, on {last['date']} at {last['time']} ({last.get('session')})."))
    if number is not None:
        latest = _latest_before(kept, number)
        if latest is not None and _stamp(latest) >= _stamp(visit) and not (last is not None and latest is last):
            errors.append(_reason("revision_order", f"R{number:04d} has to be after R{_session_number(latest.get('session')):04d}: its last visit was to {latest['location_id']} on {latest['date']} at {latest['time']}."))
    return errors


def _replay(visit: dict, others: list[dict], locations: list[dict], cards: list[dict] | None, unknown: list[dict] | None, touched: set[str]) -> list[tuple[tuple[str, str] | None, str]]:
    """Why `visit` could not be where its instant puts it among `others`: what its own rules refuse, given the visits before it, and what the visits after it
    that it touches (those to its site, with its camera or with its card) would refuse once it is there — each with the visit it is about (None for its own)."""
    stamp = _stamp(visit)
    number = _session_number(visit.get("session"))
    found: list[tuple[tuple[str, str] | None, str]] = []
    if number is not None and any(_same(v["location_id"], visit["location_id"]) and _session_number(v.get("session")) == number for v in others):
        found.append((None, _reason("visit_repeated", f"{visit['location_id']} already has a visit in R{number:04d}: a revision is one visit to each location.")))
    found += [(None, why) for why in refusals(visit, [v for v in others if _stamp(v) < stamp], locations, cards, unknown)]
    # a site starts once, with its first visit: the visits after this one say it, or this one is before the visit that says it
    site_later = [v for v in others if _same(v["location_id"], visit["location_id"]) and _stamp(v) > stamp]
    if SITE_START in (visit.get("actions") or []) and any(SITE_START in (v.get("actions") or []) for v in others if _same(v["location_id"], visit["location_id"])):
        found.append((None, _reason("site_start_repeated", f"{visit['location_id']} has started already: a location starts once.")))
    elif SITE_START not in (visit.get("actions") or []) and any(SITE_START in (v.get("actions") or []) for v in site_later):
        found.append((None, _reason("visit_before_site_start", f"{visit['location_id']} starts after this visit: a visit before the start of its location cannot be kept.")))
    # a revision is after the one before it and before the one after it, whichever the site: a visit cannot go past the visits of another revision
    if number is not None:
        for other in others:
            n = _session_number(other.get("session"))
            if n is None or n == number:
                continue
            if n < number and _stamp(other) >= stamp:
                found.append((None, _reason("revision_order", f"R{number:04d} has to be after R{n:04d}: its visit to {other['location_id']} was on {other['date']} at {other['time']}.")))
            elif n > number and _stamp(other) <= stamp:
                found.append((None, _reason("revision_order", f"R{number:04d} has to be before R{n:04d}: its visit to {other['location_id']} was on {other['date']} at {other['time']}.")))
    # the visits it touches — to its site, with its camera or with its card — are checked again with it where it is, those after it and those before it too: one that
    # was after it may be before it now, and has lost what it needed
    for other in sorted(others, key=_stamp):
        if not ({str(other["location_id"]).lower(), str(other.get("camera_id") or ""), str(other.get("sd") or "")} - {""}) & touched:
            continue
        earlier = [v for v in [*others, visit] if v is not other and _stamp(v) < _stamp(other)]
        key = (str(other["location_id"]).lower(), str(other.get("session") or "").upper())
        found += [(key, _reason(getattr(why, "code", "visit_refused"), f"{other.get('session')} {other['location_id']} on {other['date']} at {other['time']} would no longer be possible: {why}"))
                  for why in refusals(other, earlier, locations, cards, unknown)]
    return found


def edit_errors(old: dict | None, new: dict, others: list[dict], locations: list[dict], cards: list[dict] | None = None, unknown: list[dict] | None = None) -> list[str]:
    """What stops a visit from being edited — or, with no `old`, from filling the place of an unknown one — to `new`, among the other visits `others`: it has to pass
    the rules of a visit where it will be, and the visits after it that it touches have to pass them with it there. What was wrong already, in `old` and in the
    visits after it, is not said again: only what the edit makes wrong."""
    # the site is read whatever its case; a camera and an SD card as written (7b and 7B are two)
    touched = {str(x).lower() for v in (old, new) if v for x in (v.get("location_id"),) if x} | {str(x) for v in (old, new) if v for x in (v.get("camera_id"), v.get("sd")) if x}
    now = _replay(new, others, locations, cards, unknown, touched)
    before = set(_replay(old, others, locations, cards, unknown, touched)) if old else set()
    return list(dict.fromkeys(why for key, why in now if (key, why) not in before))


@lru_cache(maxsize=None)
def _number_of(session: str) -> int | None:
    m = re.search(r"\d+", session)
    return int(m.group(0)) if m else None


def _session_number(session) -> int | None:
    return _number_of(str(session or ""))


def archive_errors(visit: dict, kept: list[dict], location: dict | None, unknown: list[dict] | None = None) -> list[str]:
    """What stops a visit for the state of its location: an archived location is archived for good, so nothing is done there after the day it was archived;
    and a visit that archives it leaves no camera there — it takes the one that is out away, or finds it stolen — and does not put one up."""
    errors: list[str] = []
    site = str(visit["location_id"]).strip()
    if location and location.get("status") == "planned":
        errors.append(_reason("site_planned", f"{site} is planned: it is only in Settings, and no visit is kept for it until it is ready."))
    if location and location.get("status") == "archived" and (not location.get("status_date") or str(visit.get("date")) > str(location["status_date"])):
        errors.append(_reason("site_archived", f"{site} is archived{' since ' + str(location['status_date']) if location.get('status_date') else ''}: no visit is kept for it after that."))
    actions = visit.get("actions") or []
    if "Archive" in actions:
        if "Installation" in actions:
            errors.append(_reason("archive_with_installation", f"A visit that archives {site} cannot put a camera up there."))
        there = camera_at_site(kept, site, _stamp(visit), unknown, _session_number(visit.get("session")))
        if there and not _takes_away(visit):
            errors.append(_reason("archive_camera_still_there", f"The camera at {site} ({there['camera']}) is still there: take it away (Desinstallation) or say it was stolen in the visit that archives the location."))
    return errors


def not_visited_records(previous: int, visits: list[dict], locations: list[dict], unknown: list[dict] | None = None, on: str | None = None, closes: tuple[str, str] | None = None) -> list[dict]:
    """The visits that finish revision `previous` as not visited: one for each location that is not archived when it starts and has no visit in it —
    status "Not revised", on the last day of the revision, with the camera that is at the site (none is asked of them). A revision with no visit at all — a planned
    one — is marked on the day `on`, when it is given. `closes` is the day and the time the revision is closed on, when it is said: the marks are of then."""
    of = [v for v in visits if _session_number(v.get("session")) == previous]
    if not of and not on:
        return []
    start, last = (min(str(v["date"]) for v in of), max(str(v["date"]) for v in of)) if of else (str(on), str(on))
    # a site that is unknown in the revision is not marked: nothing is known of it, and it counts as visited
    visited = {str(v["location_id"]).lower() for v in of} | {site for n, site in _unknown_keys(unknown) if n == previous}
    records = []
    starts = site_starts(visits)
    for l in locations:
        site = str(l.get("location_id") or "")
        if not site or site.lower() in visited or l.get("status") == "planned" or starts.get(site.lower(), 0) > previous or not _in_play(l, visits) or (l.get("status") == "archived" and (not l.get("status_date") or str(l["status_date"]) <= start)):
            continue
        camera = camera_at_site(visits, site, f"{last}T23:59:59")
        day, time = closes or (last, "23:59:00")
        camera = camera_at_site(visits, site, f"{day}T23:59:59") if closes else camera
        records.append({"location_id": site, "session": f"R{previous:04d}", "date": day, "time": time, "actions": [], "camera_status": "Not revised",
                        "camera_id": camera["camera"] if camera else None, "comments": "Marked as not visited when the next revision was started."})
    return records


def shifted(day: str, amount: int, unit: str) -> str:
    """The day `amount` days, weeks or months after `day` (YYYY-MM-DD): a month is a month of the calendar, and the 31st of a month that has fewer days is its last day."""
    import calendar  # noqa: PLC0415
    import datetime as dt  # noqa: PLC0415
    start = dt.date.fromisoformat(day)
    if unit == "days":
        return (start + dt.timedelta(days=amount)).isoformat()
    if unit == "weeks":
        return (start + dt.timedelta(weeks=amount)).isoformat()
    month = start.month - 1 + amount
    year, month = start.year + month // 12, month % 12 + 1
    return dt.date(year, month, min(start.day, calendar.monthrange(year, month)[1])).isoformat()


def _unknown_keys(unknown: list[dict] | None) -> set[tuple[int | None, str]]:
    return {(_session_number(u.get("session")), str(u["location_id"]).lower()) for u in unknown or []}


def unknown_records(new: list[dict], kept: list[dict], unknown: list[dict] | None = None) -> list[dict]:
    """The visits that are unknown: for each visit of `new` to a site, every revision before its own — back to R0001 — in which that site has no visit, kept, new or
    unknown already. Nothing is known of them — no day, no camera, no card —, so nothing is checked against them, but they count as visits to finish a revision:
    {"location_id", "session"}. A real visit that comes later takes the place of its unknown one."""
    have = {(_session_number(v.get("session")), str(v["location_id"]).lower()) for v in [*kept, *new]} | _unknown_keys(unknown)
    made: dict[tuple[int, str], dict] = {}
    starts = site_starts([*kept, *new])
    for v in new:
        number = _session_number(v.get("session"))
        if number is None:
            continue
        # a site that starts in a revision was not there before it: nothing is unknown of the revisions before its start
        for before in range(starts.get(str(v["location_id"]).lower(), 1), number):
            key = (before, str(v["location_id"]).lower())
            if key not in have and key not in made:
                made[key] = {"location_id": str(v["location_id"]), "session": f"R{before:04d}"}
    return sorted(made.values(), key=lambda u: (u["session"], u["location_id"].lower()))


def revision_order_conflicts(new: list[dict], kept: list[dict]) -> list[tuple[dict, str]]:
    """The visits of `new` that are out of the order of the revisions — each with why: every visit of a revision is after all those of the revisions before it and before
    all those of the revisions after it, whichever the site. When two visits of a file are at odds, both are told."""
    out = []
    # the earliest and the latest instants of each revision: a visit is at odds with another revision only when one before it ends after it starts, or one after it starts before it ends
    first: dict[int, str] = {}
    last: dict[int, str] = {}
    for w in [*kept, *new]:
        n = _session_number(w.get("session"))
        if n is not None:
            first[n] = min(first.get(n, _stamp(w)), _stamp(w))
            last[n] = max(last.get(n, _stamp(w)), _stamp(w))
    for v in new:
        number = _session_number(v.get("session"))
        if number is None:
            continue
        stamp = _stamp(v)
        if not any(n < number and last[n] >= stamp or n > number and first[n] <= stamp for n in first):
            continue
        for other in (w for w in [*kept, *new] if w is not v):
            n = _session_number(other.get("session"))
            if n is None or n == number:
                continue
            if n < number and _stamp(other) >= _stamp(v):
                out.append((v, f"R{number:04d} has to be after R{n:04d}: its visit to {other['location_id']} was on {other['date']} at {other['time']}, and this one is on {v['date']} at {v['time']}."))
                break
            if n > number and _stamp(other) <= _stamp(v):
                out.append((v, f"R{number:04d} has to be before R{n:04d}: its visit to {other['location_id']} was on {other['date']} at {other['time']}, and this one is on {v['date']} at {v['time']}."))
                break
    return out


def _camera_out_before(visits: list[dict], site: str, number: int) -> bool:
    """Whether the camera of a site was out there when the revision `number` came: what its last visit before that revision left — a camera put up, or looked at and left —, not
    taken away nor stolen."""
    out = False
    before = [v for v in visits if _same(v["location_id"], site) and (_session_number(v.get("session")) or 0) < number and not is_not_revised(v)]
    for v in sorted(before, key=_stamp):
        if _takes_away(v):
            out = False
        if _leaves_camera(v):
            out = True
    return out


def unknown_installation_warnings(new: list[dict], kept: list[dict], unknown: list[dict] | None) -> list[str]:
    """A warning for each site that has no visit in a revision the file gives — it is still unknown there: the site had no visit in it — and whose visit in the next
    revision does not put a camera up. The revision before it says nothing of the site, so the camera has to be put up in that one (an Installation) — unless the site had a camera
    out before the gap: a revision after a site was skipped is fine while its deployment is still open."""
    given = {n for n in (_session_number(v.get("session")) for v in new) if n is not None}
    everything = [*kept, *new]
    said = []
    for u in sorted(unknown or [], key=lambda u: (str(u["session"]), str(u["location_id"]).lower())):
        number = _session_number(u.get("session"))
        if number not in given or any(_same(v["location_id"], u["location_id"]) and _session_number(v.get("session")) == number for v in new):
            continue
        if _camera_out_before(everything, u["location_id"], number):
            continue
        for after in (v for v in everything if _same(v["location_id"], u["location_id"]) and _session_number(v.get("session")) == number + 1):
            if "Installation" not in (after.get("actions") or []) and not is_not_revised(after):
                said.append(f"R{number + 1:04d} {u['location_id']}: the location has no visit in R{number:04d}, so the camera has to be put up in R{number + 1:04d} (an Installation), and this visit does not.")
    return list(dict.fromkeys(said))


def revision_missing(number: int, visits: list[dict], locations: list[dict], day: str = "", unknown: list[dict] | None = None, starting: list[dict] | None = None) -> list[str]:
    """The locations still to be visited in revision `number`: those that are not archived when it starts (the day of its first visit, or `day` if it has none)
    and have no visit in it, and whose site has started by then. Empty when the revision is complete — closed. `starting` are visits that are not kept yet — the ones being added —
    that say where a site starts."""
    of = [v for v in visits if _session_number(v.get("session")) == number]
    start = min((str(v["date"]) for v in of), default=day)
    starts = site_starts([*visits, *(starting or [])])
    expected = [str(l["location_id"]) for l in locations
                if l.get("location_id") and l.get("status") != "planned" and not (l.get("status") == "archived" and (not l.get("status_date") or str(l["status_date"]) <= start))
                and starts.get(str(l["location_id"]).lower(), 0) <= number and _in_play(l, visits, starting)]   # a site that starts after this revision is not waited for in it
    visited = {str(v["location_id"]).lower() for v in of} | {site for n, site in _unknown_keys(unknown) if n == number}
    return sorted(s for s in expected if s.lower() not in visited)


def is_closed_revision(session: str | None, visits: list[dict], locations: list[dict]) -> bool:
    """Whether the revision has a visit — kept — and every location that is not archived has its visit in it: nothing new can be added to it."""
    number = _session_number(session)
    return number is not None and any(_session_number(v.get("session")) == number for v in visits) and not revision_missing(number, visits, locations)


def unfinished_revision(number: int, visits: list[dict], locations: list[dict], floor: int, day: str = "", unknown: list[dict] | None = None, starting: list[dict] | None = None) -> str | None:
    """Why revision `number` cannot be started: the one before it is not finished. A revision is one visit to each of the locations that are not archived
    when it starts (the day of its first visit; an archived location with no date is archived for good); the first revision of the visits (`floor`) has none before it."""
    previous = number - 1
    if previous < floor:
        return None
    missing = revision_missing(previous, visits, locations, day, unknown, starting)
    if not missing:
        return None
    return _reason("revision_not_finished", f"R{number:04d} cannot start: R{previous:04d} is not finished, {len(missing)} location(s) still to be visited in it: {', '.join(missing)}.")


def revision_gate(new: list[dict], kept: list[dict], locations: list[dict], unknown: list[dict] | None = None) -> list[tuple[dict, str]]:
    """The visits of `new` that cannot be kept because the revision before theirs is not finished — each with why. The revisions are taken in order, so a
    revision that is refused does not finish the one after it."""
    numbers = [n for n in (_session_number(v.get("session")) for v in [*kept, *new]) if n is not None]
    if not numbers:
        return []
    floor, accepted, refused = min(numbers), list(kept), []
    for number in sorted({n for n in (_session_number(v.get("session")) for v in new) if n is not None}):
        group = [v for v in new if _session_number(v.get("session")) == number]
        reason = unfinished_revision(number, accepted, locations, floor, min(str(v["date"]) for v in group), unknown, new)
        if reason:
            refused += [(v, reason) for v in group]
        else:
            accepted += group
    return refused


def session_jump_items(new: list[dict], kept: list[dict]) -> list[tuple[str, list[dict]]]:
    """A warning when the sessions of the visits of a file start after the one next to the last kept: a trip is missing — with the visits of the session that starts after the gap."""
    last = max((n for n in (_session_number(v.get("session")) for v in kept) if n is not None), default=None)
    first = min((n for n in (_session_number(v.get("session")) for v in new) if n is not None), default=None)
    if last is not None and first is not None and first > last + 1:
        return [(f"Revision numbers jump from R{last:04d} to R{first:04d}.", [v for v in new if _session_number(v.get("session")) == first])]
    return []


def session_jump(new: list[dict], kept: list[dict]) -> list[str]:
    """A warning when the sessions of the visits of a file start after the one next to the last kept: a trip is missing."""
    return [message for message, _ in session_jump_items(new, kept)]


def history_notes(new: list[dict], kept: list[dict]) -> list[str]:
    """What is worth knowing of the visits of a file, without being wrong: the sites visited on the trip before and not on this one — their cameras are still out,
    their deployments stay open —, the visits where nothing was collected (status "Not revised") and the ones with no photo count."""
    notes: list[str] = []
    everything = [*kept, *new]
    for session in sorted({n for n in (_session_number(v.get("session")) for v in new) if n is not None}):
        here = {str(v["location_id"]).lower() for v in everything if _session_number(v.get("session")) == session}
        # a site that was archived, or whose camera was taken away or stolen, in the trip before has nothing left out in the field: it is not waited for
        before = {str(v["location_id"]) for v in everything if _session_number(v.get("session")) == session - 1
                  and not ({"Archive"} & set(v.get("actions") or []) or _takes_away(v))}
        missing = sorted(s for s in before if s.lower() not in here)
        if missing:
            plural = len(missing) > 1
            notes.append(f"The revision R{session:04d} has no visit to {', '.join(missing)}, which {'were' if plural else 'was'} visited in R{session - 1:04d}: "
                         f"the camera{'s stay' if plural else ' stays'} out in the field and the deployment{'s stay' if plural else ' stays'} open until a visit collects the card.")
        current = [v for v in new if _session_number(v.get("session")) == session]
        skipped = sorted(v["location_id"] for v in current if str(v.get("camera_status") or "").lower() in NOT_REVISED)
        if skipped:
            notes.append(f"R{session:04d}: {len(skipped)} visit(s) with status \"Not revised\", ignored (no card collected): {', '.join(skipped)}.")
        nocount = sorted(v["location_id"] for v in current if {"Revision", "Desinstallation"} & set(v["actions"]) and v.get("num_photos") is None
                         and v.get("card_status") != "CardFull" and str(v.get("camera_status") or "").lower() not in NOT_REVISED)
        if nocount:
            notes.append(f"R{session:04d}: {len(nocount)} visit(s) without image count (count forgotten), counted as the end of the collection: {', '.join(nocount)}.")
    return notes
