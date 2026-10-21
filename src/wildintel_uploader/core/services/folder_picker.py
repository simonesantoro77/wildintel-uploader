"""Opens the OS's native "choose a folder" dialog for the web UI's
"Browse…" button.

This is a local desktop app whose backend and frontend always run on the
same machine — the browser tab it shows itself in is just how the UI is
drawn (see web.app_entry) — so the backend can pop a native dialog on that
machine's own display. Rather than bundling a GUI toolkit (the PyInstaller
spec deliberately excludes tkinter, which is also awkward to bundle
cross-platform), this shells out to whatever dialog tool the platform
already ships with."""
from __future__ import annotations

import platform
import shutil
import subprocess


class FolderPickerUnavailable(RuntimeError):
    """No native folder dialog could be found or run on this machine."""


def _pick_linux(title: str) -> str | None:
    if shutil.which("zenity"):
        cmd = ["zenity", "--file-selection", "--directory", f"--title={title}"]
    elif shutil.which("kdialog"):
        cmd = ["kdialog", "--getexistingdirectory", ".", f"--title={title}"]
    else:
        raise FolderPickerUnavailable("No folder dialog tool found — install zenity (GNOME) or kdialog (KDE).")
    # A non-zero exit means the dialog was cancelled (also true if it
    # couldn't even open, e.g. no display — nothing to pick either way).
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    return result.stdout.strip() or None if result.returncode == 0 else None


def _pick_macos(title: str) -> str | None:
    script = f'POSIX path of (choose folder with prompt "{_applescript_quote(title)}")'
    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, check=False)
    return result.stdout.strip() or None if result.returncode == 0 else None


def _ps_quote(text: str) -> str:
    """Text for a single-quoted PowerShell string: a quote inside it is doubled ("deployment's" would end it)."""
    return text.replace("'", "''")


def _applescript_quote(text: str) -> str:
    return text.replace("\\", "\\\\").replace('"', '\\"')


def _pick_windows(title: str) -> str | None:
    script = (
        "Add-Type -AssemblyName System.Windows.Forms | Out-Null; "
        "$owner = New-Object System.Windows.Forms.Form; $owner.TopMost = $true; $owner.ShowInTaskbar = $false; $owner.Show(); $owner.Activate(); "
        "$f = New-Object System.Windows.Forms.FolderBrowserDialog; "
        f"$f.Description = '{_ps_quote(title)}'; "
        "$r = $f.ShowDialog($owner); $owner.Close(); "
        "if ($r -eq 'OK') { Write-Output $f.SelectedPath }"
    )
    result = subprocess.run(["powershell", "-NoProfile", "-Command", script], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise FolderPickerUnavailable(result.stderr.strip() or "Could not open the folder dialog.")
    return result.stdout.strip() or None


def pick_folder(title: str = "Select a folder") -> str | None:
    """The folder the user picked, or None if the dialog was cancelled.

    Raises:
        FolderPickerUnavailable: no native dialog tool is available on this
            platform/machine — the caller should let the user type the path
            instead.
    """
    system = platform.system()
    if system == "Linux":
        return _pick_linux(title)
    if system == "Darwin":
        return _pick_macos(title)
    if system == "Windows":
        return _pick_windows(title)
    raise FolderPickerUnavailable(f"No folder dialog support for {system}.")


# ── files ────────────────────────────────────────────────────────────────
#
# The same dialogs, picking a file: patterns are like ["*.csv"] — what the
# dialog offers first; "All files" stays available.

def _pick_file_linux(title: str, patterns: list[str]) -> str | None:
    if shutil.which("zenity"):
        cmd = ["zenity", "--file-selection", f"--title={title}"]
        if patterns:
            cmd.append(f"--file-filter={' '.join(patterns)}")
            cmd.append("--file-filter=*")
    elif shutil.which("kdialog"):
        cmd = ["kdialog", "--getopenfilename", ".", " ".join(patterns) or "*", f"--title={title}"]
    else:
        raise FolderPickerUnavailable("No file dialog tool found — install zenity (GNOME) or kdialog (KDE).")
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    return result.stdout.strip() or None if result.returncode == 0 else None


def _pick_file_macos(title: str, patterns: list[str]) -> str | None:
    kinds = [p.split(".")[-1] for p in patterns if "." in p]
    of_type = f" of type {{{', '.join(chr(34) + k + chr(34) for k in kinds)}}}" if kinds else ""
    script = f'POSIX path of (choose file with prompt "{_applescript_quote(title)}"{of_type})'
    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, check=False)
    return result.stdout.strip() or None if result.returncode == 0 else None


def _pick_file_windows(title: str, patterns: list[str]) -> str | None:
    wanted = ";".join(patterns)
    filter_ = f"{wanted}|{wanted}|All files|*.*" if patterns else "All files|*.*"
    # The dialog gets an owner that stays on top, so it opens in front of the browser instead of behind it.
    script = (
        "Add-Type -AssemblyName System.Windows.Forms, System.Drawing | Out-Null; "
        "$owner = New-Object System.Windows.Forms.Form; $owner.TopMost = $true; $owner.ShowInTaskbar = $false; "
        "$owner.StartPosition = 'CenterScreen'; $owner.Size = New-Object System.Drawing.Size(1, 1); $owner.Show(); $owner.Activate(); "
        "$f = New-Object System.Windows.Forms.OpenFileDialog; "
        f"$f.Title = '{_ps_quote(title)}'; $f.Filter = '{_ps_quote(filter_)}'; "
        "$r = $f.ShowDialog($owner); $owner.Close(); "
        "if ($r -eq 'OK') { Write-Output $f.FileName }"
    )
    result = subprocess.run(["powershell", "-NoProfile", "-STA", "-Command", script], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise FolderPickerUnavailable(result.stderr.strip() or "Could not open the file dialog.")
    return result.stdout.strip() or None


def pick_file(title: str = "Select a file", patterns: list[str] | None = None) -> str | None:
    """The file the user picked, or None if the dialog was cancelled.

    Raises:
        FolderPickerUnavailable: no native dialog tool is available — the caller should let the user type the path.
    """
    patterns = patterns or []
    system = platform.system()
    if system == "Linux":
        return _pick_file_linux(title, patterns)
    if system == "Darwin":
        return _pick_file_macos(title, patterns)
    if system == "Windows":
        return _pick_file_windows(title, patterns)
    raise FolderPickerUnavailable(f"No file dialog support for {system}.")
