"""The history of the states of the locations, the cameras and the SD cards: a line for each time one changed, kept apart from the records in `status_history.json` of the research project.

A line says what changed (`kind`: `locations`, `cameras` or `sd_cards`, and the `name` of the one: the id of a location, the label of a camera or a card), the status it had (`before`, None when
it was just made) and the one it has (`after`), the instant it was written (`at`), the day it is of (`day`: the day of the visit that did it, or the day it was changed) and why (`reason`):
the visit that did it, or a person changing it in the settings.

The reason is not known where a record is written, so whoever knows it says it for what it does — `with because("the visit R0013 to DONA_01", day="2026-10-19"): …` —; what is written with no
reason said is a change by hand.

What was kept before the history was has none: it is rebuilt from the visits kept (`rebuild`), the first time the history of a research project is asked for, and again when it
is asked. Those lines are `reconstructed`."""
from __future__ import annotations

import contextlib
import contextvars
import threading
from pathlib import Path
from typing import Callable, Iterator

from wildintel_uploader.core import storage
from wildintel_uploader.core.services import audit, visit_rules

KINDS = ("locations", "cameras", "sd_cards")
BY_HAND = "Changed by hand in the settings."
# The status of one before the first visit that changed it, in a history rebuilt from the visits: it is not known.
UNKNOWN = "unknown"

_rebuilding = threading.Lock()

_why: contextvars.ContextVar[tuple[str, str | None, dict]] = contextvars.ContextVar("status_history_why", default=(BY_HAND, None, {}))


@contextlib.contextmanager
def because(reason: str, day: str | None = None, each: dict[tuple[str, str], tuple[str, str | None]] | None = None) -> Iterator[None]:
    """What is written inside is a change that has this reason — and is of this day, when it is given. `each` has a reason and a day of its own, for the ones it names: `{(kind, name in lower case): (reason, day)}`."""
    token = _why.set((reason, day, each or {}))
    try:
        yield
    finally:
        _why.reset(token)


def record_changes(root: Path, research_project_id: str, kind: str, before: list[dict], after: list[dict], name_of: Callable[[dict], str], match: Callable[[dict, list[dict]], dict | None]) -> int:
    """Writes a line for each of `after` whose status is not the one it had in `before` (`match` finds it there; None when it is new, which says its status as first). Returns how many."""
    if kind not in KINDS:
        raise ValueError(f"The history is kept for {', '.join(KINDS)}, not for {kind}.")
    reason, day, each = _why.get()
    at = audit.now()
    lines = []
    for item in after:
        if audit.is_deleted(item) or not item.get("status"):
            continue
        old = match(item, before)
        was = old.get("status") if old is not None else None
        if old is not None and was == item["status"]:
            continue
        name = name_of(item)
        why, when = each.get((kind, name.lower()), (reason, day))
        lines.append({"kind": kind, "name": name, "before": was, "after": item["status"], "at": at, "day": when or item.get("status_date") or at[:10], "reason": why if old is not None else "Created."})
    if lines:
        store = storage.open_store(root)
        store.write_records(research_project_id, "status_history", [*store.read_records(research_project_id, "status_history"), *lines])
    return len(lines)


def list_history(root: Path, research_project_id: str, kind: str | None = None, name: str | None = None) -> list[dict]:
    """The lines of the history, the oldest first, of a kind and of one of them when they are given (the name is found ignoring case). A research project that has no history
    yet has it rebuilt from its visits first (see `rebuild`)."""
    store = storage.open_store(root)
    if not store.has_records(research_project_id, "status_history"):
        rebuild(root, research_project_id, only_if_missing=True)
    lines = store.read_records(research_project_id, "status_history")
    return [l for l in lines if (kind is None or l.get("kind") == kind) and (name is None or str(l.get("name", "")).lower() == name.lower())]


def rebuild(root: Path, research_project_id: str, only_if_missing: bool = False) -> int:
    """Rebuilds the history from the visits kept, and adds what it lacks of it: a line for each change a visit made, as `visit_rules.entity_changes` says (as a visit does when it
    is saved), marked `reconstructed`. Nothing of the history is overwritten nor deleted, and a line it already has is not written again — so it can be done again.

    What it cannot know: what was changed by hand, and the status before the first visit — its first line is *unknown → X*. When the visits end in a status that is not the
    one the record has now (it was changed by hand before the history was kept), a last line says so, of the day of its `status_date` — so the history ends in the status of
    today; one that has lines written as they happened is brought to it by them, and has none.

    The history is written even when there is nothing to add, so the first time is done once. `only_if_missing` does nothing when there is one. Returns how many lines it added."""
    store = storage.open_store(root)
    with _rebuilding:
        if only_if_missing and store.has_records(research_project_id, "status_history"):
            return 0
        lines = store.read_records(research_project_id, "status_history")
        recorded = {(l.get("kind"), str(l.get("name", "")).lower()) for l in lines if not l.get("reconstructed")}
        there = {_same(l) for l in lines}
        new = [l for l in _from_the_visits(root, research_project_id, recorded) if _same(l) not in there]
        store.write_records(research_project_id, "status_history", _in_order([*lines, *new]))
        return len(new)


def _same(line: dict) -> tuple:
    """What tells a line from another, whenever it was written: the same change of the same one, the same day and for the same reason."""
    return (line.get("kind"), str(line.get("name", "")).lower(), line.get("after"), line.get("day"), line.get("reason"))


def _in_order(lines: list[dict]) -> list[dict]:
    """The lines by the day they are of, those of the same day as they were; a line that brings one to its status of today goes after the others of it."""
    last: dict[tuple, str] = {}
    for l in lines:
        key = (l.get("kind"), str(l.get("name", "")).lower())
        last[key] = max(last.get(key, ""), str(l.get("day") or ""))
    return sorted(lines, key=lambda l: last[(l.get("kind"), str(l.get("name", "")).lower())] if l.get("to_today") else str(l.get("day") or ""))


def _from_the_visits(root: Path, research_project_id: str, recorded: set[tuple]) -> list[dict]:
    """The lines the visits kept make, oldest first, of the locations, the cameras and the SD cards the research project keeps; `recorded` are those that have lines written as
    they happened (no last line brings them to today)."""
    from wildintel_uploader.core.services import local_folder_service   # noqa: PLC0415 — it uses this module

    items: dict[tuple[str, str], dict] = {}          # (kind, name as it is matched) -> the record
    for l in local_folder_service.list_locations(root, research_project_id):
        items[("locations", str(l["location_id"]).lower())] = {"name": str(l["location_id"]), "status": l.get("status"), "status_date": l.get("status_date")}
    for kind in ("cameras", "sd_cards"):
        for i in local_folder_service.list_field_items(root, research_project_id, kind):
            one = {"name": str(i.get("label") or i.get("camera_id") or ""), "status": i.get("status"), "status_date": i.get("status_date")}
            # a camera is found by its label or by its id, as written (7b and 7B are two), as a visit finds it
            for n in {str(i.get("label") or "").strip()} | ({str(i.get("camera_id") or "").strip()} if kind == "cameras" else set()):
                if n:
                    items.setdefault((kind, n), one)

    def found(kind: str, name: str) -> dict | None:
        return items.get((kind, name.lower() if kind == "locations" else name.strip()))

    at = audit.now()
    status: dict[tuple[str, str], str] = {}          # (kind, name) -> the status the visits give it so far
    out: list[dict] = []
    before: list[dict] = []
    for visit in sorted(audit.alive(local_folder_service.list_visits(root, research_project_id)), key=visit_rules._stamp):
        changes = visit_rules.entity_changes(visit, before)
        if "Archive" in (visit.get("actions") or []):
            changes.append({"kind": "locations", "name": str(visit["location_id"]), "status": "archived"})
        before.append(visit)
        for change in changes:
            one = found(change["kind"], change["name"])
            if one is None:
                continue
            key = (change["kind"], one["name"])
            was = status.get(key)
            # as the visits do it: what is archived is for good, and a site that is planned is not in the app yet
            if was == change["status"] or was == "archived" or (change["kind"] == "locations" and was not in (None, "pending", "ready", "active")):
                continue
            status[key] = change["status"]
            out.append({"kind": change["kind"], "name": one["name"], "before": was or UNKNOWN, "after": change["status"], "at": at, "day": visit.get("date") or at[:10],
                        "reason": f"The visit {visit.get('session')} to {visit['location_id']}.", "reconstructed": True})
    for (kind, name), worked_out in status.items():
        one = found(kind, name)
        now = one.get("status") if one else None
        if not now or now == worked_out or (kind, name.lower()) in recorded:
            continue
        out.append({"kind": kind, "name": name, "before": worked_out, "after": now, "at": at, "day": one.get("status_date") or at[:10],
                    "reason": f"The status is {now}, the visits say {worked_out}.", "reconstructed": True, "to_today": True})
    return out
