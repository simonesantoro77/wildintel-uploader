"""Preprocessing the images as they are imported into their collection — what
wildintel-tools' prepare_collections_for_trapper did, and a bit more:

  - dates: each image's capture date is read from its EXIF (DateTimeOriginal,
    then the digitized date, then DateTime, then the file's own date), taken as
    the camera's local time in the deployment's timezone — optionally ignoring
    summer time — and converted to UTC.
  - rename: <DEPLOYMENT>__<YYYYMMDD>_<n>.<EXT>, all upper case, .jpg as .jpeg;
    n is the image's place in natural file-name order.
  - resize: to a width, keeping the proportions. Unlike wildintel-tools, where the
    resized image only ever fed the identifier's hash and the original was what
    got copied, the resized image is what is kept. Images no wider than the
    width are left as they are, and the EXIF and colour profile are kept.
  - metadata: XMP authorship, rights and license, written with ExifTool —
    including the hash of the original (Source) and of the image kept (Identifier).

A "preprocessing.json" beside the images records what was done to each one."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import subprocess
import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from datetime import datetime, timezone as datetime_timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from PIL import Image, ImageOps, JpegImagePlugin

from wildintel_uploader.core import config
from wildintel_uploader.core.schemas.requests import DeploymentFields
from wildintel_uploader.core.services import camera_info, deployment_import_service, local_folder_service, report_service
from wildintel_uploader.core.services.deployment_import_service import DeploymentImportError

logger = logging.getLogger(__name__)

PREPROCESSING_LOG_FILE = "preprocessing.json"
_EXIF_IFD = 0x8769
_DATE_TAGS = (("exif", 36867), ("exif", 36868), ("main", 306))  # DateTimeOriginal, DateTimeDigitized, DateTime
_NO_DATA = {"0000:00:00 00:00:00"}
_XMP_BATCH = 200  # files per ExifTool run
EXIFTOOL_TMP_SUFFIX = "_exiftool_tmp"  # what ExifTool adds to a file's name while it rewrites it
_JPEG_QUALITY = 90  # only when the original's own JPEG settings can't be read


@dataclass(frozen=True)
class PreprocessOptions:
    """What to do to the images, and the values it uses."""

    rename: bool = True
    resize: bool = True
    resize_width: int = 2400
    metadata: bool = True
    owner: str = ""
    publisher: str = ""
    coverage: str = ""
    license_url: str = "https://creativecommons.org/licenses/by-nc/4.0/"
    # The research project's name, for the creator metadata.
    research_project: str = ""
    timezone: str = "UTC"
    ignore_dst: bool = True
    convert_to_utc: bool = True


def zone_of(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise DeploymentImportError(f"Unknown timezone: {name}") from exc


def localize(naive: datetime, zone: ZoneInfo, *, ignore_dst: bool) -> datetime:
    """A camera's wall-clock time in a timezone. Ignoring summer time uses the
    zone's standard offset all year, as for a camera whose clock was never changed."""
    if ignore_dst:
        offset, dst = zone.utcoffset(naive), zone.dst(naive)
        if offset is None or dst is None:
            raise ValueError(f"Invalid timezone information for {zone}")
        return naive.replace(tzinfo=datetime_timezone(offset - dst))
    return naive.replace(tzinfo=zone)


def _exif_date(path: Path) -> datetime | None:
    try:
        with Image.open(path) as img:
            exif = img.getexif()
            sub = exif.get_ifd(_EXIF_IFD)
            for where, tag in _DATE_TAGS:
                raw = (sub if where == "exif" else exif).get(tag)
                if raw and str(raw).strip() not in _NO_DATA:
                    return datetime.strptime(str(raw).strip()[:19], "%Y:%m:%d %H:%M:%S")
    except Exception as exc:  # unreadable metadata: fall back to the file's date
        logger.debug("No EXIF date in %s: %s", path, exc)
    return None


def _camera_time(path: Path, options: PreprocessOptions) -> tuple[datetime, datetime, str]:
    """The image's capture time as the camera's wall clock, the same in its timezone, and where it came from:
    "exif", or "file" when the image has no date and its modification time stands in."""
    naive, source = _exif_date(path), "exif"
    if naive is None:
        naive, source = datetime.fromtimestamp(path.stat().st_mtime).replace(microsecond=0), "file"
    return naive, localize(naive, zone_of(options.timezone), ignore_dst=options.ignore_dst), source


def capture_datetime(path: Path, options: PreprocessOptions) -> tuple[datetime, str]:
    """The image's capture date — in UTC if asked — and where it came from:
    "exif", or "file" when the image has no date and its modification time stands in."""
    _, aware, source = _camera_time(path, options)
    return (aware.astimezone(datetime_timezone.utc) if options.convert_to_utc else aware), source


def new_name(deployment_id: str, date: datetime, index: int, suffix: str) -> str:
    """<DEPLOYMENT>__<YYYYMMDD>_<n>.<EXT>, upper case, .jpg as .jpeg."""
    suffix = suffix.lower()
    if suffix == ".jpg":
        suffix = ".jpeg"
    return f"{deployment_id}__{date.strftime('%Y%m%d')}_{index}{suffix}".upper()


def _sha1(path: Path) -> str:
    digest = hashlib.sha1()  # noqa: S324 — an identifier, not a security measure; what wildintel-tools used
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _jpeg_settings(img: Image.Image) -> dict:
    """The original's JPEG quantization tables and chroma subsampling, so the resized
    image is saved at the quality it already had instead of a fixed one (which
    could make it heavier than the original). Falls back to a fixed quality."""
    tables = getattr(img, "quantization", None)
    if img.format != "JPEG" or not tables:
        return {"quality": _JPEG_QUALITY}
    settings: dict = {"qtables": tables}
    try:
        sampling = JpegImagePlugin.get_sampling(img)
        if sampling != -1:
            settings["subsampling"] = sampling
    except Exception:
        pass
    return settings


def resize_to_width(source: Path, dest: Path, width: int) -> bool:
    """Writes source to dest, resized to `width` pixels wide keeping its proportions —
    or just copies it if it isn't wider than that. True if it was resized."""
    with Image.open(source) as img:
        if img.width <= width:
            shutil.copy2(source, dest)
            return False
        height = max(1, round(img.height * width / img.width))
        resized = img.resize((width, height), Image.LANCZOS)
        keep = {key: img.info[key] for key in ("exif", "icc_profile") if key in img.info}
        fmt = img.format or "JPEG"
        if fmt == "JPEG":
            resized = resized.convert("RGB") if resized.mode not in ("RGB", "L") else resized
            resized.save(dest, format="JPEG", **_jpeg_settings(img), **keep)
        else:
            resized.save(dest, format=fmt, **keep)
    return True


def _mime(path: Path) -> str:
    try:
        with Image.open(path) as img:
            return Image.MIME.get(img.format or "", "application/octet-stream")
    except Exception:
        return "application/octet-stream"


def xmp_tags(options: PreprocessOptions, deployment: DeploymentFields, *, camera: str | None, date: datetime, mime: str,
             source_hash: str, image_hash: str, year: int | None = None) -> dict[str, str]:
    """The XMP tags one image gets. A blank owner or publisher is "Unknown",
    and a blank coverage is the deployment's location."""
    owner = options.owner or "Unknown"
    publisher = options.publisher or "Unknown"
    place = options.coverage or deployment.location_name or deployment.location_id or "an unspecified place"
    # As wildintel-tools wrote it: the camera's make and model in lower case, then the research project's name.
    creator = f"CT ({camera.lower() if camera else '(unknown) (unknown)'} {options.research_project or 'Unknown'})"
    return {
        "XMP-dc:Creator": creator,
        "XMP-dc:Date": date.isoformat(),
        "XMP-dc:Format": mime,
        "XMP-dc:Identifier": f"WildINTEL:{image_hash}",
        "XMP-dc:Source": f"WildINTEL:{source_hash}",
        "XMP-dc:Publisher": publisher,
        "XMP-dc:Rights": f"© {owner}, {year or datetime.now().year}. All rights reserved.",
        "XMP-dc:Coverage": f"This image was taken at {place}, as part of the WildINTEL project. https://wildintel.eu/",
        "XMP-xmpRights:Marked": "true",
        "XMP-xmpRights:Owner": owner,
        "XMP-xmpRights:WebStatement": options.license_url,
    }


def write_xmp(exiftool: str, items: list[tuple[Path, dict[str, str]]]) -> None:
    """Writes each file's own tags, in place, with one ExifTool run per batch — the
    files and their tags go in on stdin, so no command line limit is in the way.

    ExifTool writes each file to a "<file>_exiftool_tmp" and renames it over the original; one it was
    interrupted in the middle of (a failure, the app being stopped) is left behind, so those are
    removed however this ends."""
    try:
        for start in range(0, len(items), _XMP_BATCH):
            lines: list[str] = []
            for path, tags in items[start:start + _XMP_BATCH]:
                lines += [f"-{tag}={value.replace(chr(10), ' ')}" for tag, value in tags.items()]
                lines += [str(path), "-execute"]
            completed = subprocess.run(
                [exiftool, "-@", "-", "-common_args", "-overwrite_original", "-charset", "filename=utf8", "-charset", "utf8"],
                input="\n".join(lines) + "\n", capture_output=True, text=True, encoding="utf-8", check=False,
            )
            if completed.returncode != 0 or "error" in completed.stderr.lower():
                raise DeploymentImportError(f"ExifTool could not write the metadata: {(completed.stderr or completed.stdout).strip()[:300]}")
    finally:
        for folder in {path.parent for path, _ in items}:
            for leftover in folder.glob(f"*{EXIFTOOL_TMP_SUFFIX}"):
                leftover.unlink(missing_ok=True)


def _image_entry(record: dict) -> dict:
    """What images.json keeps of a preprocessed image: its name and when it was taken (the camera's wall clock) and, as
    extras, its original name, the instant and its epoch seconds, the camera, the file's size and pixels and its hashes."""
    target: Path = record["_target"]
    width, height = _dimensions(target)
    return local_folder_service.image_entry(record["name"], record["_local"].isoformat(), "local", {
        "original": record["original"], "taken_at": record["date"], "timestamp": record["_date"].timestamp(), "date_source": record["date_source"],
        "camera": record["camera"], "width": width, "height": height, "size_bytes": target.stat().st_size,
        "resized": record["resized"], "sha1": record["final_hash"], "source_sha1": record["source_hash"],
    })


def _dimensions(path: Path) -> tuple[int | None, int | None]:
    try:
        with Image.open(path) as img:
            return img.width, img.height
    except Exception:
        return None, None


def _process(index: int, path: Path, source_dir: Path, dest: Path, deployment: DeploymentFields, options: PreprocessOptions,
             cameras: dict[Path, camera_info.CameraInfo]) -> dict:
    """One image: date, name, resize (or copy) and hashes."""
    naive, aware, date_source = _camera_time(path, options)
    date = aware.astimezone(datetime_timezone.utc) if options.convert_to_utc else aware
    relative = path.relative_to(source_dir)
    name = new_name(deployment.deployment_id, date, index, path.suffix) if options.rename else str(relative)
    target = dest / name
    target.parent.mkdir(parents=True, exist_ok=True)
    source_hash = _sha1(path)
    if options.resize:
        resized = resize_to_width(path, target, options.resize_width)
    else:
        shutil.copy2(path, target)
        resized = False
    return {
        "original": str(relative), "name": name, "date": date.isoformat(), "date_source": date_source, "resized": resized,
        "source_hash": source_hash, "hash": _sha1(target), "camera": cameras[path].model, "_target": target, "_date": date, "_local": naive,
    }


# Where a deployment is prepared: <collection>/.staging/<deployment id>, inside its own collection so that moving it to its place is one rename on the same
# volume — atomic, and instant however many images it has. The collection has nothing of the deployment until it is saved; what is left in .staging by a run that
# was interrupted is cleared when the deployment is prepared again.
STAGING_DIR = ".staging"
# On Windows a file that is open for a moment (the antivirus, the indexer, a viewer, ExifTool finishing) keeps a folder from being renamed: it is tried again.
PUBLISH_TRIES = 20
PUBLISH_WAIT = 0.5


def staging_dir(collection: Path, deployment_id: str) -> Path:
    """The folder where the deployment of `collection` is prepared until it is saved."""
    return collection / STAGING_DIR / deployment_id


def _hide(path: Path) -> None:
    """Marks a folder as hidden on Windows, where a name that starts with a dot does not hide it. Best effort: nothing depends on it."""
    if os.name != "nt":
        return
    try:
        import ctypes
        ctypes.windll.kernel32.SetFileAttributesW(str(path), 0x2)  # type: ignore[attr-defined]  # FILE_ATTRIBUTE_HIDDEN
    except Exception:  # noqa: BLE001
        pass


def publish(work: Path, dest: Path) -> None:
    """Moves a prepared deployment from its staging folder to its place in the collection, in one rename.

    Raises:
        DeploymentImportError: the deployment's folder could not be moved — after trying again for a few seconds, as an open file may be the cause.
    """
    if dest.is_dir() and not any(dest.iterdir()):
        dest.rmdir()  # an empty folder in the way: Windows refuses to replace it, and nothing is lost
    last: OSError | None = None
    for attempt in range(PUBLISH_TRIES):
        try:
            os.replace(work, dest)  # not rename: on Windows that fails when the destination exists
            last = None
            break
        except PermissionError as exc:  # Windows: something has a file of the folder open — it usually lets go in a moment
            last = exc
            time.sleep(PUBLISH_WAIT)
        except OSError as exc:
            raise DeploymentImportError(f"Could not move {work.name} into its collection: {exc}") from exc
    if last is not None:
        raise DeploymentImportError(f"Could not move {work.name} into its collection — a file in it is in use by another program: {last}") from last
    try:
        work.parent.rmdir()  # .staging, when nothing else is being prepared
    except OSError:
        pass


def preprocess_stream(
    source_dir: str, collection_dir: str, collection_name: str | None, deployment: DeploymentFields, options: PreprocessOptions,
    consolidate: bool = True,
) -> Iterator[dict]:
    """Imports source_dir's images, preprocessed as `options` says, with the collection's and deployment's metadata beside them.
    They are prepared in collection_dir/.staging/<deployment_id> — the collection has nothing of the deployment until it is saved —
    and, with consolidate, moved to collection_dir/<deployment_id> and sealed there.
    With consolidate False it stops after preparing them — the images, their images.json and preprocessing.json — leaving the
    deployment *pending* in .staging: unsealed and not yet in the collection, so it can be preprocessed again, until consolidate_stream
    moves it to its place and freezes it.
    Events, as the other imports': {"type": "copy", index, total, name} per file,
    {"type": "skipped", name, detail} for one that couldn't be processed (the rest go
    on), {"type": "metadata", total} once the XMP is being written, and finally
    {"type": "done", dest_dir, processed, skipped} — dest_dir is where the deployment is: its place in the collection once it is
    saved, its staging folder while it is pending.

    Raises:
        DeploymentImportError: bad source/destination paths, an unknown timezone,
            metadata asked for without ExifTool, or the deployment's folder already there.
    """
    source = Path(source_dir).expanduser()
    collection = Path(collection_dir).expanduser()
    dest = collection / deployment.deployment_id
    work = staging_dir(collection, deployment.deployment_id)
    deployment_import_service.check_paths(source, dest)
    zone_of(options.timezone)
    exiftool = camera_info.exiftool_path()
    if options.metadata and exiftool is None:
        raise DeploymentImportError("Adding metadata needs ExifTool, and it isn't installed.")
    if deployment_import_service.is_pending(dest) and not local_folder_service.is_synced(dest):
        shutil.rmtree(dest)  # preprocessed before, by a version that did it in the collection, and never consolidated: nothing froze it, so it is done again
    deployment_import_service.check_not_kept(dest)
    if work.exists():
        shutil.rmtree(work)  # prepared before and not saved, or interrupted: it is done again

    def events() -> Iterator[dict]:
        local_folder_service.write_collection_metadata(collection, collection_name)
        files = sorted((p for p in source.rglob("*") if p.is_file()), key=lambda p: deployment_import_service._natural_key(p.relative_to(source)))
        images = [p for p in files if p.suffix.lower() in deployment_import_service.IMAGE_EXTENSIONS]
        image_set = set(images)
        others = [p for p in files if p not in image_set]
        total = len(files)
        cameras, _ = camera_info.read_cameras(images)
        index_of = {path: i for i, path in enumerate(images, start=1)}

        records: list[dict] = []
        skipped = 0
        skipped_items: list[dict] = []
        done = 0
        work.mkdir(parents=True, exist_ok=True)
        _hide(work.parent)
        with ThreadPoolExecutor(max_workers=config.workers()) as pool:
            futures = [(path, pool.submit(_process, index_of[path], path, source, work, deployment, options, cameras)) for path in images]
            for path, future in futures:  # in order, so the events are too
                done += 1
                try:
                    record = future.result()
                except Exception as exc:  # one bad image doesn't stop the rest
                    skipped += 1
                    logger.warning("Could not preprocess %s: %s", path, exc)
                    skipped_items.append({"name": str(path.relative_to(source)), "detail": str(exc)})
                    yield {"type": "skipped", "name": str(path.relative_to(source)), "detail": str(exc)}
                    continue
                records.append(record)
                yield {"type": "copy", "index": done, "total": total, "name": record["name"]}
        for path in others:  # anything that isn't an image goes across as it is
            target = work / path.relative_to(source)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
            done += 1
            yield {"type": "copy", "index": done, "total": total, "name": str(path.relative_to(source))}

        if options.metadata and records:
            yield {"type": "metadata", "total": len(records)}
            items = [
                (r["_target"], xmp_tags(options, deployment, camera=r["camera"], date=r["_date"], mime=_mime(r["_target"]),
                                        source_hash=r["source_hash"], image_hash=r["hash"]))
                for r in records
            ]
            write_xmp(exiftool, items)  # type: ignore[arg-type] — checked above

        for r in records:  # the file as it ends up, metadata included — what sha1sum gives; the XMP can't hold its own hash
            r["final_hash"] = _sha1(r["_target"])

        local_folder_service.write_images_file(work, deployment.deployment_id, [_image_entry(r) for r in records])
        public = [{k: v for k, v in r.items() if not k.startswith("_")} for r in records]
        (work / PREPROCESSING_LOG_FILE).write_text(
            json.dumps({"options": asdict(options), "processed": len(records), "skipped": skipped, "images": public}, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        sealed = None
        if consolidate:
            yield {"type": "sealing"}
            publish(work, dest)  # from now on it is in the collection: its metadata and its seal are written there, where the seal's checks look for the rest of the project
            local_folder_service.write_deployment_metadata(dest, deployment.model_dump())
            sealed = deployment_import_service.seal_deployment(
                source, dest, deployment, originals={r["name"]: r["original"] for r in records},
                source_hashes={r["original"]: r["source_hash"] for r in records}, preprocessing=asdict(options),
            )
        where = dest if consolidate else work
        logger.info("Deployment %s preprocessed in %s (%d image(s), %d skipped)", deployment.deployment_id, where, len(records), skipped)
        report_id = None
        try:
            report_id = report_service.save(report_service.preprocessing_report(records, skipped_items, deployment.deployment_id, source, dest, asdict(options)))
        except Exception as exc:  # the import is done: not having its report is no reason to fail it
            logger.warning("Could not write the report of the preprocessing of %s: %s", deployment.deployment_id, exc)
        yield {"type": "done", "dest_dir": str(where), "processed": len(records), "skipped": skipped, "sealed": sealed, "report_id": report_id}

    return events()


def consolidate_stream(source_dir: str, collection_dir: str, deployment: DeploymentFields) -> Iterator[dict]:
    """Saves a preprocessed (pending) deployment: moves it from its staging folder to its place in the collection, writes its
    deployment.json and seals it — from then on the app notices any change to it. Events: {"type": "sealing"} and
    {"type": "done", dest_dir, processed, skipped, sealed}.

    A deployment that an earlier version left pending in the collection itself is sealed where it is.

    Raises:
        DeploymentImportError: the deployment wasn't preprocessed, or is already sealed or synced from Trapper, or its place in the
            collection is taken.
    """
    source = Path(source_dir).expanduser()
    collection = Path(collection_dir).expanduser()
    dest = collection / deployment.deployment_id
    work = staging_dir(collection, deployment.deployment_id)
    if local_folder_service.is_synced(dest):
        raise DeploymentImportError(f"{dest.name} was synced from TRAPPER, so it can't be modified here.")
    if (dest / "seal.json").exists():
        raise DeploymentImportError(f"{dest.name} is already consolidated.")
    staged = (work / PREPROCESSING_LOG_FILE).is_file()
    log_file = (work if staged else dest) / PREPROCESSING_LOG_FILE
    if not log_file.is_file():
        raise DeploymentImportError(f"{dest.name} has not been preprocessed yet.")
    if staged:
        deployment_import_service.check_not_kept(dest)
    try:
        log = json.loads(log_file.read_text(encoding="utf-8"))
        images = log["images"]
        options = log["options"]
    except (json.JSONDecodeError, OSError, KeyError, TypeError) as exc:
        raise DeploymentImportError(f"Could not read {log_file}: {exc}") from exc

    def events() -> Iterator[dict]:
        yield {"type": "sealing"}
        if staged:
            publish(work, dest)
        local_folder_service.write_deployment_metadata(dest, deployment.model_dump())
        sealed = deployment_import_service.seal_deployment(
            source, dest, deployment, originals={r["name"]: r["original"] for r in images},
            source_hashes={r["original"]: r["source_hash"] for r in images}, preprocessing=options,
        )
        logger.info("Deployment %s consolidated in %s", deployment.deployment_id, dest)
        yield {"type": "done", "dest_dir": str(dest), "processed": log.get("processed", len(images)), "skipped": log.get("skipped", 0), "sealed": sealed}

    return events()
