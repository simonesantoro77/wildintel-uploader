"""Session-directory primitives for the "Import deployment" wizard — the
same design wildintel-zooniverse's own web backend uses (services/
session_store.py there).

A "session" is one wizard run's own persistent directory under
get_sessions_dir()/<task_id>, holding a session.json manifest. Writers merge
their own section into whatever's already on disk, so no phase ever erases
another's. "phase" says how far the run got, and is offered back on the
"resume?" screen until the run finishes (its directory is then removed —
see discard_session, called once the import stream reaches "done").

Phases, in the order the wizard asks for them:
  - "scanned": the local source folder is chosen and scanned — see
    write_scan_phase. Creates the session; everything else is added to it.
  - "selected": the research project, classification project and location
    to register the deployment under are chosen too — see
    write_selection_phase.
  - "ready": the deployment's own fields (dates, camera setup, etc.) and
    timezone are filled in too — see write_details_phase. Everything the
    "Import deployment" button needs; if the import itself fails or is
    interrupted, the session stays at this phase so it can be retried.

Never writes credentials: Trapper's username/password never reach this
module, so resuming always asks for them again (though the URL/username
saved in settings.toml still pre-fill the form)."""
from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from wildintel_uploader.core import config


class InvalidTaskId(ValueError):
    """A task_id that is not one the app makes: it names no session, and it is never used as a folder."""


def new_task_id() -> str:
    return str(uuid.uuid4())


def valid_task_id(task_id: object) -> bool:
    """Whether it is a task_id as the app makes them: the canonical form of a UUID — so it is the name of one folder, and nothing else."""
    try:
        return isinstance(task_id, str) and str(uuid.UUID(task_id)) == task_id
    except ValueError:
        return False


def session_dir(task_id: str) -> Path:
    """The folder of a session, inside the sessions folder.

    Raises:
        InvalidTaskId: the id is not one the app makes."""
    if not valid_task_id(task_id):
        raise InvalidTaskId(f"{task_id!r} is not the id of a session.")
    return config.get_sessions_dir() / task_id


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_manifest(task_id: str) -> dict[str, Any] | None:
    """The manifest of a session — None when there is none, or the id is not one of a session."""
    if not valid_task_id(task_id):
        return None
    path = session_dir(task_id) / "session.json"
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def write_manifest(task_id: str, manifest: dict[str, Any]) -> None:
    """Atomic write (.tmp + replace), so a crash never leaves a half-written
    session.json behind."""
    d = session_dir(task_id)
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / "session.json.tmp"
    tmp.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(d / "session.json")


def write_scan_phase(task_id: str | None, *, source_dir: str, scan: dict) -> dict[str, Any]:
    """Creates or updates a session once its source folder is chosen and
    scanned — the wizard's first step, so this is what starts a new run
    (task_id is None then)."""
    task_id = task_id or new_task_id()
    existing = read_manifest(task_id) or {}
    manifest = {
        **existing,
        "task_id": task_id,
        "created_at": existing.get("created_at") or now_iso(),
        "updated_at": now_iso(),
        "phase": "scanned",
        "task": "deployment",
        "source_dir": source_dir,
        "scan": scan,
    }
    write_manifest(task_id, manifest)
    return manifest


def write_selection_phase(task_id: str, *, selection: dict) -> dict[str, Any]:
    """`selection` must already be secret-free.

    Raises:
        LookupError: no session with that task_id.
    """
    existing = read_manifest(task_id)
    if existing is None:
        raise LookupError(f"Session {task_id} not found.")
    manifest = {**existing, "updated_at": now_iso(), "phase": "selected", "selection": selection}
    write_manifest(task_id, manifest)
    return manifest


def write_details_phase(task_id: str, *, deployment: dict) -> dict[str, Any]:
    """Raises:
        LookupError: no session with that task_id.
    """
    existing = read_manifest(task_id)
    if existing is None:
        raise LookupError(f"Session {task_id} not found.")
    manifest = {
        **existing, "updated_at": now_iso(), "phase": "ready",
        "deployment": deployment,
    }
    write_manifest(task_id, manifest)
    return manifest


def migrate_legacy_sessions() -> None:
    """Moves the sessions kept where they used to be (<documents>/wildintel-uploader/sessions) to where they are kept now, the
    ones that are not there already; the old folder goes when it is empty. Nothing happens when they are the same folder."""
    old, new = config.legacy_sessions_dir(), config.get_sessions_dir()
    if not old.is_dir() or old.resolve() == new.resolve():
        return
    for entry in old.iterdir():
        if entry.is_dir() and valid_task_id(entry.name) and (entry / "session.json").is_file() and not (new / entry.name).exists():
            new.mkdir(parents=True, exist_ok=True)
            shutil.move(str(entry), str(new / entry.name))
    try:
        old.rmdir()
    except OSError:
        pass


def list_sessions() -> list[dict[str, Any]]:
    """Every session left on disk, newest first."""
    migrate_legacy_sessions()
    root = config.get_sessions_dir()
    if not root.is_dir():
        return []
    sessions = []
    for entry in root.iterdir():
        manifest = read_manifest(entry.name)
        if manifest is None:
            continue
        sessions.append(manifest)
    return sorted(sessions, key=lambda m: m.get("updated_at") or m.get("created_at") or "", reverse=True)


def discard_session(task_id: str) -> None:
    """Removes the folder of a session.

    Raises:
        InvalidTaskId: the id is not one the app makes: nothing is removed."""
    shutil.rmtree(session_dir(task_id), ignore_errors=True)
