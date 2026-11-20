"""Copying a camera's memory card to a temporary folder of this computer.

The images of a deployment can be on the card itself: it is copied — never changed, it is only read — to a temporary folder, and what is done after is done to
that folder as to any other local one. The copy is named like the card, so the folder name says what the card was; it is removed when the import is over
(`discard`), and the ones that were left behind by an import that never finished are removed the next time a card is copied (`clean_stale`)."""

from __future__ import annotations

import logging
import platform
import re
import shutil
import subprocess
import tempfile
import time
from collections.abc import Iterator
from pathlib import Path

logger = logging.getLogger(__name__)

# The folder the copies are made in: inside the temporary folder of the system, so that nothing else is ever removed.
BASE_NAME = "wildintel-sd"
# A copy that was not removed after this long is a leftover.
STALE_SECONDS = 24 * 3600


class CardCopyError(Exception):
    """The card could not be copied."""


def base_dir() -> Path:
    return Path(tempfile.gettempdir()) / BASE_NAME


def _files(source: Path) -> list[Path]:
    return sorted(p for p in source.rglob("*") if p.is_file())


def clean_stale(now: float | None = None) -> int:
    """Removes the copies left behind longer than STALE_SECONDS ago; returns how many."""
    base = base_dir()
    if not base.is_dir():
        return 0
    limit = (now if now is not None else time.time()) - STALE_SECONDS
    removed = 0
    for entry in base.iterdir():
        try:
            if entry.is_dir() and entry.stat().st_mtime < limit:
                shutil.rmtree(entry)
                removed += 1
        except OSError as exc:
            logger.warning("Could not remove the old copy of a card %s: %s", entry, exc)
    return removed


def copy_card(source_dir: str) -> Iterator[dict]:
    """Copies the files of the card at `source_dir` to a new temporary folder, named like the card. Events: {"type": "start", "files", "bytes"},
    {"type": "progress", "copied", "files", "bytes_copied", "bytes"} after each file and {"type": "done", "path", "files", "bytes"} — `path` is the copy.

    Raises:
        CardCopyError: the card is not a folder that can be read, or has nothing on it, or a file could not be copied (what was copied is removed)."""
    source = Path(source_dir).expanduser()
    if not source.is_dir():
        raise CardCopyError(f"The SD card '{source_dir}' is not a folder that can be read.")
    try:
        files = _files(source)
    except OSError as exc:
        raise CardCopyError(f"The SD card '{source_dir}' cannot be read: {exc}") from exc
    if not files:
        raise CardCopyError(f"There is nothing on the SD card '{source_dir}'.")
    clean_stale()
    base_dir().mkdir(parents=True, exist_ok=True)
    holder = Path(tempfile.mkdtemp(prefix="card-", dir=base_dir()))
    # named like the card: its folder name, or its label
    destination = holder / (source.name or "card")
    sizes = [f.stat().st_size for f in files]
    total = sum(sizes)
    yield {"type": "start", "files": len(files), "bytes": total}
    copied_bytes = 0
    try:
        for n, (file, size) in enumerate(zip(files, sizes), start=1):
            target = destination / file.relative_to(source)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, target)
            copied_bytes += size
            yield {"type": "progress", "copied": n, "files": len(files), "bytes_copied": copied_bytes, "bytes": total}
    except OSError as exc:
        shutil.rmtree(holder, ignore_errors=True)
        raise CardCopyError(f"The SD card could not be copied: {exc}") from exc
    yield {"type": "done", "path": str(destination), "files": len(files), "bytes": total}


def discard(path: str) -> bool:
    """Removes a copy made by copy_card — only one inside its own folder, whatever the path says. Returns whether something was removed."""
    base = base_dir().resolve()
    target = Path(path).expanduser().resolve()
    if base not in target.parents:
        return False
    holder = target
    while holder.parent != base:
        holder = holder.parent
    if not holder.is_dir():
        return False
    shutil.rmtree(holder, ignore_errors=True)
    return True


def _run(command: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(command, capture_output=True, text=True, check=False)


def _eject_windows(path: Path) -> dict:
    drive = path.drive  # "E:"
    if not drive:
        return {"ejected": False, "message": "The card is not on a drive of its own."}
    import ctypes
    if ctypes.windll.kernel32.GetDriveTypeW(f"{drive}\\") != 2:  # DRIVE_REMOVABLE
        return {"ejected": False, "message": f"{drive} is not a removable drive: nothing ejected."}
    script = f"(New-Object -ComObject Shell.Application).Namespace(17).ParseName('{drive}').InvokeVerb('Eject')"
    result = _run(["powershell", "-NoProfile", "-STA", "-Command", script])
    if result.returncode != 0:
        return {"ejected": False, "message": f"Could not eject {drive}: {result.stderr.strip()}"}
    return {"ejected": True, "message": f"{drive} ejected: you can take the card out."}


def _eject_macos(path: Path) -> dict:
    parts = path.resolve().parts
    if len(parts) < 3 or parts[1] != "Volumes":
        return {"ejected": False, "message": "The card is not a mounted volume."}
    volume = Path("/", parts[1], parts[2])
    result = _run(["diskutil", "eject", str(volume)])
    if result.returncode != 0:
        return {"ejected": False, "message": f"Could not eject {volume.name}: {result.stderr.strip()}"}
    return {"ejected": True, "message": f"{volume.name} ejected: you can take the card out."}


def _udisks_removable(disk: str) -> bool:
    """Whether udisks does not take the drive for a system one — the reader of a laptop (an mmcblk) is neither removable nor hotplug for lsblk, yet it holds cards."""
    info = _run(["udisksctl", "info", "-b", disk]).stdout.lower()
    hint = re.search(r"hintsystem:\s*(\w+)", info)
    removable = re.search(r"\bremovable:\s*(\w+)", info)
    return bool((hint and hint.group(1) == "false") or (removable and removable.group(1) == "true"))


def _eject_linux(path: Path) -> dict:
    """Unmounts the partition the folder is on and powers the drive off, with udisks — only when the system says the drive is removable."""
    mount = _run(["findmnt", "-n", "-o", "SOURCE,TARGET", "--target", str(path.resolve())])
    fields = mount.stdout.strip().split(maxsplit=1)
    if mount.returncode != 0 or len(fields) != 2 or not fields[0].startswith("/dev/"):
        return {"ejected": False, "message": "The card is not a mounted volume."}
    device, target = fields
    parent = _run(["lsblk", "-no", "PKNAME", device]).stdout.strip().splitlines()
    disk = f"/dev/{parent[0].strip()}" if parent and parent[0].strip() else device
    flags = _run(["lsblk", "-dno", "RM,HOTPLUG", disk]).stdout.split()
    if "1" not in flags and not _udisks_removable(disk):
        return {"ejected": False, "message": f"{target} is not on a removable drive: nothing ejected."}
    unmounted = _run(["udisksctl", "unmount", "-b", device])
    if unmounted.returncode != 0:
        return {"ejected": False, "message": f"Could not eject {target}: {(unmounted.stderr or unmounted.stdout).strip()}"}
    _run(["udisksctl", "power-off", "-b", disk])  # not every reader can be powered off: unmounted is enough to take the card out
    return {"ejected": True, "message": f"{target} ejected: you can take the card out."}


def eject(source: str) -> dict:
    """Ejects the removable drive a card was copied from, so it can be taken out: {"ejected", "message"}. Only a drive the system says is
    removable is ejected, never a folder of a fixed disk. It never raises: when it cannot, it says why."""
    path = Path(source).expanduser()
    system = platform.system()
    try:
        if system == "Windows":
            return _eject_windows(path)
        if system == "Darwin":
            return _eject_macos(path)
        if system == "Linux":
            return _eject_linux(path)
    except (OSError, subprocess.SubprocessError) as exc:
        return {"ejected": False, "message": f"Could not eject the card: {exc}"}
    return {"ejected": False, "message": "Eject the card from the system before taking it out."}
