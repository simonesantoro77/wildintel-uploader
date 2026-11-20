"""Which camera took an image — its model and its id (serial number), read
from the image's metadata.

ExifTool is used when it's available (bundled with the executables, or installed), because the serial number of a camera
trap usually lives in the manufacturer's own MakerNotes, which only ExifTool
decodes across brands. Without it, Pillow still gives the make and model from
the standard EXIF tags (and the serial, when the camera wrote the standard
BodySerialNumber tag) — less complete, but the wizard keeps working. The
result says which one was used."""
from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import ExifTags, Image

from wildintel_uploader.core.services import file_memo

logger = logging.getLogger(__name__)

# What ExifTool is asked for, and the order the serial number is looked for in.
_SERIAL_TAGS = ("SerialNumber", "InternalSerialNumber", "BodySerialNumber", "CameraSerialNumber")
_EXIFTOOL_TIMEOUT_SECONDS = 600
_TAG_IDS = {name: tag for tag, name in ExifTags.TAGS.items()}
_EXIF_IFD = 0x8769


@dataclass(frozen=True)
class CameraInfo:
    model: str | None = None
    camera_id: str | None = None

    @property
    def known(self) -> bool:
        return self.model is not None or self.camera_id is not None


def _bundled_exiftool() -> str | None:
    """The ExifTool shipped inside the packaged executable (see the PyInstaller
    spec), or None when running from source or when none was bundled."""
    if not getattr(sys, "frozen", False):
        return None
    candidate = Path(sys._MEIPASS) / "exiftool" / ("exiftool.exe" if os.name == "nt" else "exiftool")  # type: ignore[attr-defined]
    if not candidate.is_file():
        return None
    if os.name != "nt" and not os.access(candidate, os.X_OK):
        try:
            candidate.chmod(candidate.stat().st_mode | 0o755)
        except OSError:
            return None
    return str(candidate)


def exiftool_path() -> str | None:
    """Where ExifTool is: the bundled one first, then the one on the PATH; None
    if neither exists."""
    return _bundled_exiftool() or shutil.which("exiftool")


def _model(make: object, model: object) -> str | None:
    """"<make> <model>" — the model alone when it already starts with the make ("Canon" / "Canon EOS 5D")."""
    make_text = str(make).strip() if make else ""
    model_text = str(model).strip() if model else ""
    if make_text and model_text.lower().startswith(make_text.lower()):
        make_text = ""
    return " ".join(p for p in (make_text, model_text) if p) or None


def _clean(value: object) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def _read_with_exiftool(exiftool: str, paths: list[Path]) -> dict[Path, CameraInfo]:
    """One ExifTool run over every file — the file names go in on stdin, so a
    folder of thousands of images doesn't overflow the command line."""
    args = [exiftool, "-json", "-charset", "filename=utf8", "-m", "-Make", "-Model", *(f"-{tag}" for tag in _SERIAL_TAGS), "-@", "-"]
    completed = subprocess.run(
        args, input="\n".join(str(p) for p in paths), capture_output=True, text=True, encoding="utf-8",
        timeout=_EXIFTOOL_TIMEOUT_SECONDS, check=False,
    )
    # ExifTool exits non-zero when some file can't be read, but still reports the others.
    rows = json.loads(completed.stdout) if completed.stdout.strip() else []
    by_source = {str(Path(row.get("SourceFile", ""))): row for row in rows}
    cameras: dict[Path, CameraInfo] = {}
    for path in paths:
        row = by_source.get(str(path), {})
        serial = next((s for s in (_clean(row.get(tag)) for tag in _SERIAL_TAGS) if s), None)
        cameras[path] = CameraInfo(model=_model(row.get("Make"), row.get("Model")), camera_id=serial)
    return cameras


def _read_with_pillow(path: Path) -> CameraInfo:
    try:
        with Image.open(path) as img:
            exif = img.getexif()
            make = exif.get(_TAG_IDS.get("Make", 271))
            model = exif.get(_TAG_IDS.get("Model", 272))
            serial = exif.get_ifd(_EXIF_IFD).get(_TAG_IDS.get("BodySerialNumber", 42033))
            return CameraInfo(model=_model(make, model), camera_id=_clean(serial))
    except Exception as exc:  # a corrupt/unreadable file just has no camera information
        logger.debug("No camera information in %s: %s", path, exc)
        return CameraInfo()


def _read(paths: list[Path], exiftool: str | None) -> tuple[dict[Path, CameraInfo], str]:
    if exiftool:
        try:
            return _read_with_exiftool(exiftool, paths), "exiftool"
        except (OSError, subprocess.SubprocessError, json.JSONDecodeError, ValueError) as exc:
            logger.warning("ExifTool failed (%s) — falling back to Pillow for the camera information.", exc)
    return {path: _read_with_pillow(path) for path in paths}, "pillow"


def read_cameras(paths: list[Path]) -> tuple[dict[Path, CameraInfo], str]:
    """The camera model and id of each image, and which reader was used
    ("exiftool" or "pillow"). ExifTool failing for any reason falls back to Pillow.

    What is read is remembered while the image is the same one (see file_memo): the validation of the images, the preprocessing and the seal read the same images, and ExifTool
    takes seconds for a card. A reading by Pillow is made again when ExifTool is there, as it says less."""
    if not paths:
        return {}, "pillow"
    exiftool = exiftool_path()
    stamps = {path: file_memo.stamp(path) for path in paths}
    found: dict[Path, CameraInfo] = {}
    readers: set[str] = set()
    missing: list[Path] = []
    for path in paths:
        remembered = file_memo.CAMERAS.get(stamps[path])
        if remembered is not None and not (exiftool and remembered[1] != "exiftool"):
            found[path] = remembered[0]  # type: ignore[assignment]
            readers.add(remembered[1])
        else:
            missing.append(path)
    if missing:
        read, reader = _read(missing, exiftool)
        for path in missing:
            found[path] = read[path]
            file_memo.CAMERAS.put(stamps[path], (read[path], reader))
        readers.add(reader)
    return {path: found[path] for path in paths}, "exiftool" if readers == {"exiftool"} else "pillow"


def common_value(values: list[str | None]) -> str | None:
    """The one value every image has — None if any is missing or they differ."""
    distinct = set(values)
    return distinct.pop() if len(distinct) == 1 and None not in distinct else None
