"""The history of the states of the locations, the cameras and the SD cards: a line for each time one changed, kept apart from the records in `status_history.json` of the research project.

A line says what changed (`kind`: `locations`, `cameras` or `sd_cards`, and the `name` of the one: the id of a location, the label of a camera or a card), the status it had (`before`, None when
it was just made) and the one it has (`after`), the instant it was written (`at`), the day it is of (`day`: the day of the visit that did it, or the day it was changed) and why (`reason`):
the visit that did it, or a person changing it in the settings.

The reason is not known where a record is written, so whoever knows it says it for what it does — `with because("the visit R0013 to DONA_01", day="2026-10-19"): …` —; what is written with no
reason said is a change by hand."""
from __future__ import annotations

import contextlib
import contextvars
from pathlib import Path
from typing import Callable, Iterator

from wildintel_uploader.core import storage
from wildintel_uploader.core.services import audit

KINDS = ("locations", "cameras", "sd_cards")
BY_HAND = "Changed by hand in the settings."

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
    """The lines of the history, the oldest first, of a kind and of one of them when they are given (the name is found ignoring case)."""
    lines = storage.open_store(root).read_records(research_project_id, "status_history")
    return [l for l in lines if (kind is None or l.get("kind") == kind) and (name is None or str(l.get("name", "")).lower() == name.lower())]
