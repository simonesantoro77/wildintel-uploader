"""How the names of the entities are compared.

An SD card, a camera or a person is the same one only when it is written the same: `7b` and `7B` are two SD cards (they were two sites, and each has its own), as are two
cameras or two trappers that differ only in case. The case is kept as it was written *and* it counts.

The ids of the locations and the acronyms of the research projects are still read whatever their case: they are the names of folders — which a file system may not tell apart
— and Trapper keeps its ids in lower case, so two of them that differ only in case would collide there.
"""
from __future__ import annotations

# the kinds of entity that are told by what they are called, and are the same only when written the same
CASE_SENSITIVE = frozenset({"camera", "sd", "trapper"})


def key(kind: str, text) -> str:
    """What a name is compared by: as written (without the spaces around it) when its kind counts the case, else in lower case."""
    text = str(text if text is not None else "").strip()
    return text if kind in CASE_SENSITIVE else text.lower()


def same(kind: str, a, b) -> bool:
    return key(kind, a) == key(kind, b)
