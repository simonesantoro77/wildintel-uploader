"""The photos of a created deployment — kept in its folder of the collections folder — to look at them: the list, and each one as a JPEG."""
from __future__ import annotations

import io
import json
from pathlib import Path

from wildintel_uploader.core.services import local_folder_service

THUMBNAIL = 320
LARGE = 1280
_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}


class DeploymentPhotosError(Exception):
    """The deployment, or the photo, is not there."""


def _folder(root: Path, research_project_id: str, collection: str, deployment_id: str) -> Path:
    try:
        project = local_folder_service.project_dir(root, research_project_id)
    except local_folder_service.LocalFolderError as exc:
        raise DeploymentPhotosError(str(exc)) from exc
    for part in (collection, deployment_id):
        if not part or "/" in part or "\\" in part or part in {".", ".."}:
            raise DeploymentPhotosError("That is not a deployment.")
    folder = (project / collection / deployment_id).resolve()
    if project.resolve() not in folder.parents or not folder.is_dir():
        raise DeploymentPhotosError(f"The deployment {deployment_id} is not in the collections folder.")
    return folder


def list_photos(root: Path, research_project_id: str, collection: str, deployment_id: str) -> list[dict]:
    """The photos of a deployment, by name: {"name", "taken"} — when each was taken, as the wall clock of its location, when images.json says."""
    folder = _folder(root, research_project_id, collection, deployment_id)
    taken: dict[str, str | None] = {}
    try:
        for image in json.loads((folder / "images.json").read_text(encoding="utf-8")).get("images", []):
            taken[image["name"]] = image.get("local_time")
    except (OSError, ValueError, KeyError, TypeError):
        pass
    names = sorted((p.name for p in folder.iterdir() if p.is_file() and p.suffix.lower() in _IMAGE_SUFFIXES), key=lambda n: (taken.get(n) or "", n))
    return [{"name": n, "taken": taken.get(n)} for n in names]


def photo_jpeg(root: Path, research_project_id: str, collection: str, deployment_id: str, name: str, size: int = THUMBNAIL) -> bytes:
    """A photo of a deployment as a JPEG that fits in size × size. Only the images of the folder are served."""
    from PIL import Image, ImageOps

    folder = _folder(root, research_project_id, collection, deployment_id)
    path = (folder / name).resolve()
    if path.parent != folder or path.suffix.lower() not in _IMAGE_SUFFIXES or not path.is_file():
        raise DeploymentPhotosError(f"The deployment doesn't have the image '{name}'.")
    try:
        with Image.open(path) as img:
            img = ImageOps.exif_transpose(img)
            img.thumbnail((size, size))
            out = io.BytesIO()
            img.convert("RGB").save(out, "JPEG", quality=75)
            return out.getvalue()
    except Exception as exc:
        raise DeploymentPhotosError(f"'{name}' can't be shown: {exc}") from exc
