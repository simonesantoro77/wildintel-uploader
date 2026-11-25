"""The records as JSON files in the collections folder — how the app has always kept them:

    <collections folder>/<research project id>/research_project.json
    <collections folder>/<research project id>/locations.json
    <collections folder>/<research project id>/visits.json      (and unknown_visits.json, planned_revisions.json, cameras.json, sd_cards.json, roles.json, upload_failures.json)
    <collections folder>/trappers.json                              (the people: they belong to no research project)
    <collections folder>/<research project id>/<R0003>/<deployment id>/…      (the images, and what is kept with them: not records)

A file is put in place at once: it is never left half written.
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
import time
from pathlib import Path

from wildintel_uploader.core.storage.base import GLOBAL_KINDS, RECORD_KINDS, ProjectStore, StorageError, valid_project_id

logger = logging.getLogger(__name__)

PROJECT_FILE = "research_project.json"
RECORD_FILES = {
    "locations": "locations.json", "visits": "visits.json", "unknown_visits": "unknown_visits.json", "planned_revisions": "planned_revisions.json",
    "cameras": "cameras.json", "sd_cards": "sd_cards.json", "roles": "roles.json", "upload_failures": "upload_failures.json", "status_history": "status_history.json",
}
GLOBAL_FILES = {"trappers": "trappers.json"}   # beside the folders of the research projects, in the collections folder itself
assert set(RECORD_FILES) == set(RECORD_KINDS) and set(GLOBAL_FILES) == set(GLOBAL_KINDS)


# One lock for each file: a read and a write — or two writes — of the same file in this process do not coincide. On Windows a file that is open cannot be replaced (a PermissionError), and a
# read has it open for a moment. It is reentrant: what holds it may take it again.
_locks: dict[str, threading.RLock] = {}
_locks_guard = threading.Lock()

# What is waited, in seconds, between the tries to put a file in place when the system says it is in use — by an antivirus, the indexer… — and not by this process.
REPLACE_RETRIES = (0.02, 0.05, 0.1, 0.2, 0.4)


def _lock_of(path: Path) -> threading.RLock:
    with _locks_guard:
        return _locks.setdefault(str(path.resolve()).lower(), threading.RLock())


def read_json(path: Path):
    """What a JSON file says, or None when it is not there or cannot be read."""
    with _lock_of(path):
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None


def _replace(tmp: str, path: Path) -> None:
    """Puts the written file in place of `path`, trying again a few times when the system refuses because the file is in use."""
    for wait in (*REPLACE_RETRIES, None):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if wait is None:
                raise
            logger.debug("%s is in use: trying again in %.2f s", path, wait)
            time.sleep(wait)


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with _lock_of(path):
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(data, handle, indent=2, ensure_ascii=False, default=str)
            _replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise


class JsonFolderStore(ProjectStore):
    def __init__(self, root: Path):
        self.root = Path(root)

    def _folder(self, research_project_id: str) -> Path:
        return self.root / valid_project_id(research_project_id)

    @staticmethod
    def _missing(research_project_id: str) -> StorageError:
        return StorageError(f"The research project '{research_project_id}' isn't in the collections folder.")

    # ── the research projects ────────────────────────────────────────────────────────────────────────────────────────────

    def list_projects(self) -> list[dict]:
        if not self.root.is_dir():
            return []
        # Two folders can say the same acronym (one renamed by hand, say): the project is listed once, from the folder the app itself
        # would look in — the one named by the acronym — or else the first.
        projects: dict[str, tuple[dict, bool]] = {}
        for entry in sorted(self.root.iterdir(), key=lambda e: e.name.lower()):
            metadata = read_json(entry / PROJECT_FILE) if entry.is_dir() else None
            if not isinstance(metadata, dict):
                continue
            key = str(metadata.get("acronym") or entry.name).lower()
            named_by_acronym = entry.name == metadata.get("acronym")
            if key in projects:
                logger.warning("The research project %s is in more than one folder of %s (%s too): it is listed once.", key, self.root, entry.name)
                if not named_by_acronym or projects[key][1]:
                    continue
            projects[key] = (metadata, named_by_acronym)
        return [metadata for metadata, _ in projects.values()]

    def has_project(self, research_project_id: str) -> bool:
        return (self._folder(research_project_id) / PROJECT_FILE).is_file()

    def get_project(self, research_project_id: str) -> dict | None:
        project = read_json(self._folder(research_project_id) / PROJECT_FILE)
        return project if isinstance(project, dict) else None

    def add_project(self, project: dict) -> None:
        folder = self._folder(project["acronym"])
        if (folder / PROJECT_FILE).is_file():
            raise StorageError(f"The research project '{project['acronym']}' already exists.")
        write_json(folder / PROJECT_FILE, project)

    def save_project(self, research_project_id: str, project: dict) -> None:
        if not self.has_project(research_project_id):
            raise self._missing(research_project_id)
        write_json(self._folder(research_project_id) / PROJECT_FILE, project)

    def delete_project(self, research_project_id: str) -> None:
        folder = self._folder(research_project_id)
        for name in self.owned_names(research_project_id):
            (folder / name).unlink(missing_ok=True)

    def owned_names(self, research_project_id: str) -> set[str]:
        return {PROJECT_FILE, *RECORD_FILES.values()}

    # ── the records ──────────────────────────────────────────────────────────────────────────────────────────────────────

    def _file(self, research_project_id: str, kind: str) -> Path:
        if kind not in RECORD_FILES:
            raise StorageError(f"'{kind}' is not a kind of record: {', '.join(RECORD_KINDS)}.")
        return self._folder(research_project_id) / RECORD_FILES[kind]

    def read_records(self, research_project_id: str, kind: str) -> list[dict]:
        records = read_json(self._file(research_project_id, kind))
        return [r for r in records if isinstance(r, dict)] if isinstance(records, list) else []

    def write_records(self, research_project_id: str, kind: str, records: list[dict]) -> None:
        path = self._file(research_project_id, kind)
        if not path.parent.is_dir():
            raise self._missing(research_project_id)
        write_json(path, records)

    def has_records(self, research_project_id: str, kind: str) -> bool:
        return self._file(research_project_id, kind).is_file()

    def delete_records(self, research_project_id: str, kind: str) -> None:
        self._file(research_project_id, kind).unlink(missing_ok=True)

    # ── the records that belong to no research project ───────────────────────────────────────────────────────────────────

    def _global_file(self, kind: str) -> Path:
        if kind not in GLOBAL_FILES:
            raise StorageError(f"'{kind}' is not a kind of record without a research project: {', '.join(GLOBAL_KINDS)}.")
        return self.root / GLOBAL_FILES[kind]

    def read_global(self, kind: str) -> list[dict]:
        records = read_json(self._global_file(kind))
        return [r for r in records if isinstance(r, dict)] if isinstance(records, list) else []

    def write_global(self, kind: str, records: list[dict]) -> None:
        write_json(self._global_file(kind), records)
