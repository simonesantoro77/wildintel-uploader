"""Uploading a deployment kept in the collections folder to Trapper — what
wildintel-tools did in three commands, in one:

  1. the location and the deployment are created in Trapper's research project
     if they aren't there yet (the location from the deployment's own coordinates,
     the deployment from its details);
  2. the deployment's images are packed, as before, into a zip and the yaml that
     describes them (the deployment's resources and when each was recorded),
     split in several parts if the zip would be bigger than a size;
  3. each zip and its yaml are uploaded, and Trapper is told to process them into a
     collection.

The deployment must have been imported through the wizard's preprocessing: the
dates the yaml needs are the ones its preprocessing.json records.

Three modes: "upload" does all of the above; "dry_run" does the same reading
Trapper only — it says what it would create and how it would pack the images,
and changes nothing, in Trapper or on disk; "generate" only writes the files —
the zip(s), the yaml(s) and the collection's <collection>_deployments.csv — and
leaves them, for sending some other way."""
from __future__ import annotations

import ast
import asyncio
import json
import logging
import queue
import re
import threading
import time
import zipfile
from collections.abc import Callable, Iterator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import httpx
from PIL import Image

from wildintel_uploader.core.schemas.requests import DeploymentFields
from wildintel_uploader.core.services import local_folder_service, preprocessing_service, trapper_service
from wildintel_uploader.core.services.deployment_import_service import DeploymentImportError

logger = logging.getLogger(__name__)

PACK_REPORT_EVERY = 25  # images between two pack_progress events

Mode = Literal["upload", "dry_run", "generate"]
MODES: tuple[str, ...] = ("upload", "dry_run", "generate")
UPLOAD_LOG_FILE = "upload.json"
DEPLOYMENTS_CSV_SUFFIX = "_deployments.csv"
PACKAGE_NAME = "package"
DEFAULT_MAX_ZIP_BYTES = 500 * 1024 * 1024
WAIT_FOR_COLLECTION_SECONDS = 900  # Trapper processes the package in the background
POLL_SECONDS = 5

_COLLECTION_RE = re.compile(r"^R\d{4}(_.+)?$")
_DEPLOYMENT_RE = re.compile(r"^R\d{4}-.+$")


class TrapperUploadError(DeploymentImportError):
    """The upload can't go on — and why."""


# ── what can be uploaded ─────────────────────────────────────────────────────

def _read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def list_collections(collections_dir: Path, research_project_id: str) -> list[dict]:
    """The collections kept for a research project, and the deployments in each: how many
    images, whether it was preprocessed (a requirement) and whether it was uploaded."""
    project = local_folder_service.project_dir(collections_dir, research_project_id)
    if not project.is_dir():
        return []
    collections = []
    for collection in sorted(project.iterdir()):
        if not (collection.is_dir() and _COLLECTION_RE.match(collection.name)):
            continue
        deployments = []
        for folder in sorted(collection.iterdir()):
            metadata = _read_json(folder / local_folder_service.DEPLOYMENT_METADATA_FILE) if folder.is_dir() and _DEPLOYMENT_RE.match(folder.name) else None
            if not isinstance(metadata, dict):
                continue
            log = _read_json(folder / preprocessing_service.PREPROCESSING_LOG_FILE)
            upload = _read_json(folder / UPLOAD_LOG_FILE)
            images = log["images"] if isinstance(log, dict) and isinstance(log.get("images"), list) else []
            deployments.append({
                "deployment_id": folder.name,
                "location_id": metadata.get("location_id"),
                "start_date": metadata.get("start_date"),
                "end_date": metadata.get("end_date"),
                "images": len(images),
                "bytes": sum(_size(folder / e["name"]) for e in images if isinstance(e, dict) and e.get("name")),
                "preprocessed": isinstance(log, dict),
                "uploaded_at": upload.get("uploaded_at") if isinstance(upload, dict) else None,
            })
        collections.append({"name": collection.name, "path": str(collection), "deployments": deployments})
    return collections


# ── the package: a zip and the yaml describing it ────────────────────────────

def _date_recorded(iso: str) -> str:
    """The date as the yaml wants it: ISO 8601 in UTC, "2024-07-01T09:00:00+0000"."""
    parsed = datetime.fromisoformat(iso)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S%z")


def _resource(path: Path, name: str, date: str) -> dict:
    try:
        with Image.open(path) as img:
            width, height, mime = img.width, img.height, Image.MIME.get(img.format or "", "application/octet-stream")
    except Exception:
        width, height, mime = None, None, "application/octet-stream"
    return {
        "name": name, "file": name, "date_recorded": _date_recorded(date), "mime_type": mime,
        "file_width": width, "file_height": height, "file_size": path.stat().st_size, "file_fps": None, "file_duration": None,
    }


def split_by_size(files: list[tuple[Path, Any]], max_bytes: int | None) -> list[list[tuple[Path, Any]]]:
    """Groups of files whose sizes add up to at most max_bytes (a file bigger than that goes alone)."""
    if not max_bytes:
        return [files] if files else []
    parts: list[list[tuple[Path, Any]]] = []
    current: list[tuple[Path, Any]] = []
    size = 0
    for item in files:
        file_size = item[0].stat().st_size
        if current and size + file_size > max_bytes:
            parts.append(current)
            current, size = [], 0
        current.append(item)
        size += file_size
    if current:
        parts.append(current)
    return parts


def check_images(deployment_dir: Path, log: dict) -> list[dict]:
    """The images the preprocessing recorded, all of which must be there.

    Raises:
        TrapperUploadError: there are none, or one of them is missing.
    """
    entries = log.get("images", [])
    missing = [e["name"] for e in entries if not (deployment_dir / e["name"]).is_file()]
    if missing:
        raise TrapperUploadError(f"{len(missing)} image(s) recorded when the images were prepared are missing from {deployment_dir}: {', '.join(missing[:3])}…")
    if not entries:
        raise TrapperUploadError(f"There are no images to upload in {deployment_dir}.")
    return entries


def plan_packages(deployment_dir: Path, log: dict, max_zip_bytes: int | None = DEFAULT_MAX_ZIP_BYTES) -> dict:
    """How the images would be packed, without packing anything: {"images", "parts", "bytes"}."""
    entries = check_images(deployment_dir, log)
    files = [(deployment_dir / e["name"], e) for e in entries]
    return {"images": len(entries), "parts": len(split_by_size(files, max_zip_bytes)), "bytes": sum(p.stat().st_size for p, _ in files)}


def upsert_deployments_csv(path: Path, deployment: DeploymentFields, log: dict) -> dict:
    """Puts a deployment's row in its collection's <collection>_deployments.csv — as wildintel-tools'
    preparation wrote it: deploymentID, locationID, deploymentStart, deploymentEnd (the first and the
    last image, in UTC) and cameraModel — plus the location's longitude and latitude at the end, which
    is what Trapper's own deployment import needs to create a location. The rows of the collection's
    other deployments stay; the deployment's own is replaced. Returns {"path", "action", "rows"}."""
    import csv

    fields = ["deploymentID", "locationID", "deploymentStart", "deploymentEnd", "cameraModel", "longitude", "latitude"]
    dates = sorted(_date_recorded(e["date"]) for e in log.get("images", []) if e.get("date"))
    camera = deployment.camera_model or next((e["camera"] for e in log.get("images", []) if e.get("camera")), "")
    row = {
        "deploymentID": deployment.deployment_id, "locationID": deployment.location_id or "",
        "deploymentStart": dates[0] if dates else deployment.start_date, "deploymentEnd": dates[-1] if dates else deployment.end_date,
        "cameraModel": camera or "", "longitude": deployment.longitude, "latitude": deployment.latitude,
    }
    rows: dict[str, dict] = {}
    if path.is_file():
        with path.open(newline="", encoding="utf-8") as f:
            for existing in csv.DictReader(f):
                if existing.get("deploymentID"):
                    rows[existing["deploymentID"]] = existing
    action = "added" if deployment.deployment_id not in rows else "updated"
    rows[deployment.deployment_id] = row
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for key in sorted(rows):
            writer.writerow(rows[key])
    return {"path": str(path), "action": action, "rows": len(rows)}


def build_packages(
    deployment_dir: Path, collection: str, deployment_id: str, log: dict, *, project_id: int, timezone_name: str, ignore_dst: bool,
    output_dir: Path, max_zip_bytes: int | None = DEFAULT_MAX_ZIP_BYTES, stamp: str | None = None, trapper_deployment_id: str | None = None,
    progress: Callable[[int, int], None] | None = None,
) -> list[dict]:
    """Packs a deployment's images — as the preprocessing recorded them — into one or more
    zip + yaml pairs in output_dir. The yaml is what Trapper reads to build the collection:

        collections: [{name, project_id (the classification project's pk), timezone, timezone_ignore_dst, resources_dir,
                       deployments: [{deployment_id, resources: [{name, file, date_recorded, …}]}]}]

    The zip holds <collection>/<deployment>/<file>. The yaml and the zip name the deployment as Trapper has it
    (trapper_deployment_id, else the local id), in lower case — Trapper keeps its ids that way and looks them up as they are.
    Returns [{"yaml", "zip", "files"}], one per part. `progress(done, total)` is called as each image goes into a zip.

    Raises:
        TrapperUploadError: there are no images to pack, or one the log mentions is missing.
    """
    import yaml

    entries = check_images(deployment_dir, log)
    named = (trapper_deployment_id or deployment_id).lower()  # Trapper keeps its ids in lower case and looks them up as they are
    stamp = stamp or datetime.now().strftime("%Y%m%d%H%M%S")
    output_dir.mkdir(parents=True, exist_ok=True)
    files = [(deployment_dir / e["name"], e) for e in entries]
    packages = []
    packed = 0
    for index, part in enumerate(split_by_size(files, max_zip_bytes), start=1):
        base = f"{PACKAGE_NAME}_{project_id}_{stamp}_{collection}_{deployment_id}_part{index:03d}"
        definition = {"collections": [{
            "name": collection, "project_id": project_id, "timezone": timezone_name, "timezone_ignore_dst": ignore_dst,
            "resources_dir": collection,
            "deployments": [{"deployment_id": named, "resources": [_resource(path, entry["name"], entry["date"]) for path, entry in part]}],
        }]}
        yaml_path, zip_path = output_dir / f"{base}.yaml", output_dir / f"{base}.zip"
        yaml_path.write_text(yaml.dump(definition, sort_keys=False, allow_unicode=True), encoding="utf-8")
        with zipfile.ZipFile(zip_path, "w", allowZip64=True) as z:
            for path, _ in part:
                z.write(path, f"{collection}/{named}/{path.name}")
                packed += 1
                if progress:
                    progress(packed, len(files))
        packages.append({"yaml": yaml_path, "zip": zip_path, "files": len(part)})
    return packages


# ── Trapper: finding and creating what the deployment needs ──────────────────

def find_research_project(credentials: tuple[str, str, str], record: dict) -> int:
    """The research project's pk in Trapper: the one it was filled in from, or else the one with its acronym.

    Raises:
        TrapperUploadError: Trapper has no such research project (it isn't created here).
    """
    projects = trapper_service.list_research_projects(*credentials)
    pk = record.get("trapper_pk")
    if pk is not None and any(p["pk"] == pk for p in projects):
        return pk
    acronym = (record.get("acronym") or "").lower()
    match = next((p for p in projects if (p.get("acronym") or "").lower() == acronym), None)
    if match is None:
        raise TrapperUploadError(
            f"Trapper has no research project '{record.get('acronym')}' — create it there first (research projects aren't created from here)."
        )
    return match["pk"]


def resolve_classification_project(credentials: tuple[str, str, str], research_project_pk: int, chosen: int | None = None) -> dict:
    """The classification project the collection's yaml names (its "project_id" — not the research project's pk): the
    one chosen, which must belong to the research project, or else the only one it has.

    Raises:
        TrapperUploadError: the chosen one isn't one of the research project's, or none was chosen and it has none or several.
    """
    projects = trapper_service.list_classification_projects(*credentials, research_project_pk)
    if chosen is not None:
        found = next((p for p in projects if p["pk"] == chosen), None)
        if found is None:
            raise TrapperUploadError(f"The classification project #{chosen} isn't one of the research project's in Trapper.")
        return found
    if not projects:
        raise TrapperUploadError(
            "The research project has no classification project in Trapper, and the collection needs one — create it there first."
        )
    if len(projects) > 1:
        names = ", ".join(f"{p['name']} (#{p['pk']})" for p in projects)
        raise TrapperUploadError(f"The research project has several classification projects — choose which one the collection goes to: {names}.")
    return projects[0]


def _write_locations_csv(path: Path, deployment: DeploymentFields) -> None:
    import csv

    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["locationID", "locationName", "longitude", "latitude", "coordinateUncertainty"])
        writer.writerow([
            deployment.location_id, deployment.location_name or "", deployment.longitude, deployment.latitude,
            deployment.coordinate_uncertainty if deployment.coordinate_uncertainty is not None else "",
        ])


def find_location(credentials: tuple[str, str, str], research_project_pk: int, deployment: DeploymentFields) -> dict | None:
    """The deployment's location as the research project has it in Trapper (found ignoring case) — with its "timezone"
    and "ignore_dst" — or None if it isn't there. Trapper only accepts a package that declares the same timezone and
    summer-time setting as the location the deployment is in.

    Raises:
        TrapperUploadError: the deployment has no location.
    """
    if not deployment.location_id:
        raise TrapperUploadError("The deployment has no location id, so its location can't be looked for or created in Trapper.")
    wanted = deployment.location_id.lower()
    return next((l for l in trapper_service.list_locations(*credentials, research_project_pk) if l["location_id"].lower() == wanted), None)


def _location_time_settings(location: dict | None, timezone_name: str, ignore_dst: bool) -> tuple[str, bool, str]:
    """The timezone and summer-time setting the package declares — the location's own when it has them, else those given —
    and a sentence saying so when they differ from the ones given ("" when they don't)."""
    if location is None:
        return timezone_name, ignore_dst, ""
    zone = location.get("timezone") or timezone_name
    ignores = ignore_dst if location.get("ignore_dst") is None else bool(location["ignore_dst"])
    if (zone, ignores) == (timezone_name, ignore_dst):
        return zone, ignores, ""
    return zone, ignores, f" Its timezone is {zone} and it {'ignores' if ignores else 'does not ignore'} summer time — the package declares that, as Trapper requires."


def location_exists(credentials: tuple[str, str, str], research_project_pk: int, deployment: DeploymentFields) -> bool:
    """Whether the research project already has the deployment's location in Trapper (ignoring case).

    Raises:
        TrapperUploadError: the deployment has no location.
    """
    if not deployment.location_id:
        raise TrapperUploadError("The deployment has no location id, so its location can't be looked for or created in Trapper.")
    wanted = deployment.location_id.lower()
    return any(l["location_id"].lower() == wanted for l in trapper_service.list_locations(*credentials, research_project_pk))


def find_deployment(credentials: tuple[str, str, str], research_project_pk: int, deployment: DeploymentFields) -> str | None:
    """The deployment's id as the research project has it in Trapper (found ignoring case), or None if it isn't there.
    The collection's yaml has to name it exactly like that: Trapper looks the id up as it is."""
    wanted = deployment.deployment_id.lower()
    return next((d["deployment_id"] for d in trapper_service.list_deployments(*credentials, research_project_pk) if (d["deployment_id"] or "").lower() == wanted), None)


def find_deployment_record(credentials: tuple[str, str, str], research_project_pk: int, deployment: DeploymentFields) -> dict | None:
    """The deployment as the research project has it in Trapper (found ignoring case) — its "pk" and "deployment_id" — or None."""
    wanted = deployment.deployment_id.lower()
    return next((d for d in trapper_service.list_deployments(*credentials, research_project_pk) if (d["deployment_id"] or "").lower() == wanted), None)


def trapper_link(credentials: tuple[str, str, str] | None, kind: str, pk: int | None) -> str | None:
    """The page of a location, a deployment or a collection in Trapper's own web interface — to check it there."""
    if credentials is None or pk is None:
        return None
    path = {"location": "geomap/location/detail", "deployment": "geomap/deployment/detail", "collection": "storage/collection/detail"}[kind]
    return f"{credentials[0].rstrip('/')}/{path}/{pk}/"


def deployment_exists(credentials: tuple[str, str, str], research_project_pk: int, deployment: DeploymentFields) -> bool:
    """Whether the research project already has the deployment in Trapper (ignoring case)."""
    return find_deployment(credentials, research_project_pk, deployment) is not None


def ensure_location(credentials: tuple[str, str, str], research_project_pk: int, deployment: DeploymentFields, *, timezone_name: str, ignore_dst: bool, work_dir: Path) -> bool:
    """Creates the deployment's location in Trapper if the research project doesn't have it yet.
    True if it was created.

    Raises:
        TrapperUploadError: the deployment has no location to create.
    """
    if location_exists(credentials, research_project_pk, deployment):
        return False
    csv_path = work_dir / f"{deployment.location_id}_location.csv"
    _write_locations_csv(csv_path, deployment)
    try:
        trapper_service.client(*credentials).locations.import_locations(
            file=csv_path, research_project=research_project_pk, timezone=timezone_name, ignore_dst=ignore_dst,
        )
    finally:
        csv_path.unlink(missing_ok=True)
    return True


def ensure_deployment(credentials: tuple[str, str, str], research_project_pk: int, deployment: DeploymentFields, *, timezone_name: str, ignore_dst: bool, work_dir: Path) -> bool:
    """Creates the deployment in Trapper if the research project doesn't have it yet. True if it was created."""
    if deployment_exists(credentials, research_project_pk, deployment):
        return False
    csv_path = work_dir / f"{deployment.deployment_id}_deployment.csv"
    try:
        trapper_service.import_deployment(*credentials, research_project_pk, None, deployment, timezone_name, csv_path, ignore_dst=ignore_dst)
    finally:
        csv_path.unlink(missing_ok=True)
    return True


# ── uploading ────────────────────────────────────────────────────────────────

def _with_progress(work: Callable[[Callable[[dict], None]], None]) -> Iterator[dict]:
    """Runs `work(report)` — blocking, and calling report(event) as it goes — in a thread, yielding
    what it reports as it does, and re-raising whatever it raises."""
    events: queue.Queue = queue.Queue()
    failure: list[BaseException] = []

    def run() -> None:
        try:
            work(events.put)
        except BaseException as exc:  # noqa: BLE001 — handed to the caller below
            failure.append(exc)
        finally:
            events.put(None)

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    while (event := events.get()) is not None:
        yield event
    thread.join()
    if failure:
        raise failure[0]


def _refused(exc: httpx.HTTPStatusError) -> str:
    """What Trapper's uploader answered — its URL, status and the start of the body — since "Client error '403 Forbidden'"
    alone doesn't say whether the login was refused by the uploader itself or by something in front of it."""
    response = exc.response
    body = " ".join(response.text.split())[:300]
    server = response.headers.get("server")
    hint = ""
    if response.status_code in (401, 403) and response.url.path.endswith("/auth/login"):
        hint = " The login was refused: check the account's permissions on the uploader, or whether a proxy/firewall in front of Trapper blocks this address."
    return (f"Trapper's uploader refused {response.request.method} {response.url}: {response.status_code} {response.reason_phrase}"
            f"{f' (server: {server})' if server else ''}{f' — {body}' if body else ''}.{hint}")


def _trapper_message(exc: Exception) -> str:
    """Trapper answers a refused task with a dict — {'data': {'message': …, 'errors': …}} — that an exception
    shows as its repr; this is what it says, in words. Anything else is its own text."""
    text = str(exc)
    try:
        parsed = ast.literal_eval(text) if text.lstrip().startswith("{") else None
    except (ValueError, SyntaxError):
        parsed = None
    data = parsed.get("data", parsed) if isinstance(parsed, dict) else None
    if isinstance(data, dict) and (data.get("message") or data.get("errors")):
        return " ".join(str(part).rstrip(".") + "." for part in (data.get("message"), data.get("errors")) if part)
    return text


def _session_id(data: object) -> str | None:
    """The session the uploader's login hands out: {"results": [{"sessionid"}]} — or, in other Trapper versions, at the top."""
    if not isinstance(data, dict):
        return None
    results = data.get("results")
    row = results[0] if isinstance(results, list) and results and isinstance(results[0], dict) else data
    session = row.get("sessionid")
    return str(session) if session else None


def _uploader_class():
    """The SDK's HTTPUploader, with a login that copes with what Trapper really answers. The SDK's own expects
    {"results": [{"sessionid": …}]} and fails with a bare KeyError("results") when the answer is anything else."""
    from trapper_client.components.http_uploader import HTTPUploader  # needs the SDK's "upload" extra

    class TrapperUploader(HTTPUploader):
        async def _login(self, http: httpx.AsyncClient) -> None:
            response = await http.post("uploader/auth/login", json={"username": self.client.user_name, "password": self.client.user_password})
            response.raise_for_status()
            try:
                data = response.json()
            except ValueError:
                data = None
            session = _session_id(data)
            if session:
                http.cookies.set("sessionid", session)
            elif not any(cookie.name == "sessionid" for cookie in http.cookies.jar):  # it may only have come as a cookie, kept already
                body = " ".join(response.text.split())[:300]
                raise TrapperUploadError(f"Trapper's uploader accepted the login but gave no session — {response.url} answered {response.status_code}{f': {body}' if body else ''}.")
            if self.progress_callback:
                self.progress_callback("login", {"username": data.get("username") if isinstance(data, dict) else None})

    return TrapperUploader


def _upload_files(client, files: list[Path], report: Callable[[dict], None]) -> None:
    for path in files:
        sent = {"bytes": 0}

        def on_progress(event: str, info: dict, _name: str = path.name, _total: int = path.stat().st_size) -> None:
            if event == "chunk_progress":
                sent["bytes"] += info["bytes"]
                report({"type": "upload_progress", "file": _name, "bytes": sent["bytes"], "total": _total})

        uploader = _uploader_class()(client=client, progress_callback=on_progress)
        try:
            asyncio.run(uploader.upload_file(path, f"/collections/{path.name}"))
        except httpx.HTTPStatusError as exc:
            raise TrapperUploadError(_refused(exc)) from exc
        Path(str(path) + ".uploadmeta.json").unlink(missing_ok=True)


def _uploader_login(credentials: tuple[str, str, str]) -> None:
    """Logs in to Trapper's uploader the way an upload does — and does nothing else.

    Raises:
        httpx.HTTPStatusError: the uploader refused the login.
    """
    client = trapper_service.client(*credentials)

    async def login() -> None:
        async with httpx.AsyncClient(base_url=client.base_url.rstrip("/") + "/", verify=client.verify_ssl) as http:
            await _uploader_class()(client=client)._login(http)

    asyncio.run(login())


def check_access(
    credentials: tuple[str, str, str], research_project: dict, location_ids: list[str] | None = None, *,
    classification_project_pk: int | None = None, describe: Callable[[Exception], str] = str,
) -> list[dict]:
    """Whether this account can do what an upload needs, changing nothing in Trapper — [{"check", "ok", "message"}]:
      - "research_project": the research project is there and can be read;
      - "classification_project": the one the collection will go to — the one chosen, or the only one there is;
      - "location": the research project's locations can be read, and whether each of location_ids (the ones the
        deployments to upload have) is already there or would be created. Skipped if the project couldn't be found;
      - "uploader": the login of the uploader, the endpoint the packages go up through — a different door from the
        rest of Trapper's API, so it can refuse an account the API accepts.
    Each check is independent: one failing doesn't stop the others. describe turns an exception into the message.
    """
    checks: list[dict] = []

    def check(name: str, ok: bool, message: str) -> None:
        checks.append({"check": name, "ok": ok, "message": message})

    project_pk: int | None = None
    try:
        project_pk = find_research_project(credentials, research_project)
        check("research_project", True, f"Research project {research_project.get('acronym')} is #{project_pk} in Trapper.")
    except Exception as exc:
        check("research_project", False, describe(exc))

    if project_pk is None:
        check("classification_project", False, "Not checked: the research project couldn't be found.")
        check("location", False, "Not checked: the research project couldn't be found.")
    else:
        try:
            chosen = resolve_classification_project(credentials, project_pk, classification_project_pk)
            check("classification_project", True, f"The collection will go to the classification project {chosen['name']} (#{chosen['pk']}).")
        except Exception as exc:
            check("classification_project", False, describe(exc))
        try:
            known = {l["location_id"].lower() for l in trapper_service.list_locations(*credentials, project_pk)}
            wanted = sorted({i for i in (location_ids or []) if i}, key=str.lower)
            present = [i for i in wanted if i.lower() in known]
            missing = [i for i in wanted if i.lower() not in known]
            message = f"The {len(known)} location(s) of the research project can be read."
            if present:
                message += f" Already in Trapper: {', '.join(present)}."
            if missing:
                message += f" Would be created: {', '.join(missing)}."
            check("location", True, message)
        except Exception as exc:
            check("location", False, describe(exc))

    try:
        _uploader_login(credentials)
        check("uploader", True, f"Logged in to the uploader at {credentials[0].rstrip('/')}/uploader.")
    except httpx.HTTPStatusError as exc:
        check("uploader", False, _refused(exc))
    except Exception as exc:
        check("uploader", False, describe(exc))
    return checks


def check_selection(credentials: tuple[str, str, str], research_project: dict, collection: str, *, describe: Callable[[Exception], str] = str) -> list[dict]:
    """What the account sees of the research project and the collection about to be uploaded, changing nothing —
    [{"check": "research_project" | "collection", "ok", "message"}] — the collection's also says whether it was "found" in Trapper. The collection is "ok" whether it is already in Trapper
    (the upload adds to it) or isn't yet (the upload creates it): what matters is that the account can read the research
    project's collections."""
    checks: list[dict] = []
    try:
        project_pk = find_research_project(credentials, research_project)
    except Exception as exc:
        message = describe(exc)
        return [{"check": "research_project", "ok": False, "message": message}, {"check": "collection", "ok": False, "message": "Not checked: the research project couldn't be found."}]
    checks.append({"check": "research_project", "ok": True, "message": f"You have access to the research project {research_project.get('acronym')} (#{project_pk}) in Trapper."})
    try:
        client = trapper_service.client(*credentials)
        found = [c for c in client.collections.where(research_projects=project_pk, search=collection) if c.name == collection]
        if found:
            message = f"You have access to the collection {collection} (#{found[0].pk}): it is already in Trapper, so the upload adds to it."
        else:
            message = f"You can read the collections of the research project; {collection} isn't in Trapper yet, so the upload creates it."
        checks.append({"check": "collection", "ok": True, "found": bool(found), "message": message})
    except Exception as exc:
        checks.append({"check": "collection", "ok": False, "message": describe(exc)})
    return checks


def _wait_for_collection(client, research_project_pk: int, name: str, *, timeout: float, poll: float):
    """The collection, once Trapper has it (waiting up to `timeout` seconds), or None if it didn't appear."""
    deadline = time.monotonic() + timeout
    while True:
        found = next((c for c in client.collections.where(research_projects=research_project_pk, search=name) if c.name == name), None)
        if found is not None:
            return found
        if time.monotonic() >= deadline:
            return None
        time.sleep(poll)


def _megabytes(size: float) -> str:
    return f"{size / (1024 * 1024):.1f}"


def upload_stream(
    credentials: tuple[str, str, str] | None, research_project: dict, collection_dir: Path, deployment_id: str, packages_dir: Path, *,
    mode: Mode = "upload", max_zip_bytes: int | None = DEFAULT_MAX_ZIP_BYTES, remove_zip: bool = True,
    wait_seconds: float | None = None, poll_seconds: float | None = None, classification_project_pk: int | None = None,
) -> Iterator[dict]:
    """Uploads one deployment of a collection to Trapper — or, as `mode` says, only shows what that
    would do ("dry_run"), or only writes the files ("generate"). Events:
      - {"type": "step", "step", "status": "running" | "done" | "skipped", "message"}, for the steps
        "connect", "classification", "uploader", "location", "deployment", "package", "csv", "upload", "process" and "wait";
      - {"type": "upload_progress", "file", "bytes", "total"} while a file goes up;
      - {"type": "pack_progress", "index", "total"} while the images are packed (every few images);
      - {"type": "package_ready", "images", "parts", "bytes"} once they are packed — the bytes there are to send;
      - {"type": "done", "mode", "collection", "deployment_id", …}: for "upload", "location_created",
        "deployment_created" and "parts"; for "dry_run", "would_create_location",
        "would_create_deployment" and "parts"; for "generate", "parts", "output_dir", "files", "images" and "file_sizes" (each file's bytes).

    A dry run changes nothing — in Trapper it only reads, and it writes no file. Generating needs no
    connection to Trapper when the research project's pk there is already known (it was filled in from
    Trapper); credentials may then be None.

    Raises:
        TrapperUploadError: whatever stops it — the deployment isn't preprocessed, Trapper has no
            such research project, a package is missing images… (Trapper's own errors pass through).
    """
    if mode not in MODES:
        raise TrapperUploadError(f"Unknown mode '{mode}' — use one of {', '.join(MODES)}.")
    wait_seconds = WAIT_FOR_COLLECTION_SECONDS if wait_seconds is None else wait_seconds
    poll_seconds = POLL_SECONDS if poll_seconds is None else poll_seconds
    deployment_dir = collection_dir / deployment_id
    collection = collection_dir.name
    metadata = _read_json(deployment_dir / local_folder_service.DEPLOYMENT_METADATA_FILE)
    log = _read_json(deployment_dir / preprocessing_service.PREPROCESSING_LOG_FILE)
    if not isinstance(metadata, dict):
        raise TrapperUploadError(f"{deployment_id} isn't a deployment kept in {collection}: it has no deployment.json.")
    if not isinstance(log, dict) or not log.get("images"):
        raise TrapperUploadError(f"{deployment_id} wasn't preprocessed (no {preprocessing_service.PREPROCESSING_LOG_FILE}): import it again through the wizard first.")
    if mode != "generate" and credentials is None:
        raise TrapperUploadError("The Trapper account isn't set up: save its URL, username and password in the settings.")
    deployment = DeploymentFields.model_validate(metadata)
    options = log.get("options", {})
    timezone_name, ignore_dst = options.get("timezone") or "UTC", bool(options.get("ignore_dst", True))
    dry = mode == "dry_run"

    def step(name: str, status: str, message: str, url: str | None = None) -> dict:
        event = {"type": "step", "step": name, "status": status, "message": message}
        if url:
            event["url"] = url  # where to look at it in Trapper
        return event

    # ── the research project's pk in Trapper ──
    project_pk: int | None = None
    if mode == "generate":
        project_pk = research_project.get("trapper_pk")
        if project_pk is None and credentials is not None:
            yield step("connect", "running", "Looking for the research project's pk in Trapper…")
            project_pk = find_research_project(credentials, research_project)
            yield step("connect", "done", f"Research project {research_project.get('acronym')} is #{project_pk} in Trapper.")
        if project_pk is None:
            raise TrapperUploadError(
                f"The yaml needs the research project's pk in Trapper, and {research_project.get('acronym')} has none yet — "
                "save the Trapper account in the settings so it can be looked up, or add the research project again from Trapper."
            )
    else:
        yield step("connect", "running", "Connecting to Trapper…")
        project_pk = find_research_project(credentials, research_project)  # type: ignore[arg-type]
        yield step("connect", "done", f"Connected — research project {research_project.get('acronym')} is #{project_pk} in Trapper.")

    # ── the classification project the collection goes to: the yaml's project_id ──
    classification_pk: int | None = classification_project_pk
    if credentials is not None:
        yield step("classification", "running", "Looking for the classification project…")
        chosen = resolve_classification_project(credentials, project_pk, classification_project_pk)
        classification_pk = chosen["pk"]
        yield step("classification", "done", f"The collection goes to the classification project {chosen['name']} (#{classification_pk}).")
    elif classification_pk is None:
        raise TrapperUploadError("The yaml needs the classification project's pk in Trapper — choose one, which needs the Trapper account saved in the settings.")
    else:
        yield step("classification", "done", f"The collection goes to the classification project #{classification_pk}.")

    work_dir = packages_dir
    location_created = deployment_created = False
    trapper_deployment_id: str | None = None  # the deployment's id as Trapper has it, once known

    # ── the uploader's door: a different one from the API's, so it can refuse an account the API accepts — found out before anything is created ──
    if mode != "generate":
        yield step("uploader", "running", "Checking that Trapper's uploader accepts the account…")
        try:
            _uploader_login(credentials)  # type: ignore[arg-type]
        except httpx.HTTPStatusError as exc:
            raise TrapperUploadError(_refused(exc)) from exc
        except Exception as exc:
            raise TrapperUploadError(f"Could not log in to Trapper's uploader: {_trapper_message(exc)}") from exc
        yield step("uploader", "done", "Trapper's uploader accepts the account.")

    # ── what has to exist in Trapper ──
    if mode != "generate":
        yield step("location", "running", f"Looking for the location {deployment.location_id} in Trapper…")
        if dry:
            found = find_location(credentials, project_pk, deployment)  # type: ignore[arg-type]
            location_created = found is None
            note = _location_time_settings(found, timezone_name, ignore_dst)[2]
            yield step("location", "done", f"Location {deployment.location_id} would be created." if location_created else f"Location {deployment.location_id} is already in Trapper.{note}",
                       trapper_link(credentials, "location", (found or {}).get("pk")))
        else:
            work_dir.mkdir(parents=True, exist_ok=True)
            location_created = ensure_location(credentials, project_pk, deployment, timezone_name=timezone_name, ignore_dst=ignore_dst, work_dir=work_dir)  # type: ignore[arg-type]
            # The package has to declare the timezone and summer-time setting of the location it goes to.
            location = find_location(credentials, project_pk, deployment)  # type: ignore[arg-type]
            timezone_name, ignore_dst, note = _location_time_settings(location, timezone_name, ignore_dst)
            yield step("location", "done", f"Location {deployment.location_id} {'created' if location_created else 'was already in Trapper'}.{note}",
                       trapper_link(credentials, "location", (location or {}).get("pk")))

        yield step("deployment", "running", f"Looking for the deployment {deployment_id} in Trapper…")
        if dry:
            existing = find_deployment_record(credentials, project_pk, deployment)  # type: ignore[arg-type]
            deployment_created = existing is None
            yield step("deployment", "done", f"Deployment {deployment_id} would be created." if deployment_created else f"Deployment {deployment_id} is already in Trapper.",
                       trapper_link(credentials, "deployment", (existing or {}).get("pk")))
        else:
            deployment_created = ensure_deployment(credentials, project_pk, deployment, timezone_name=timezone_name, ignore_dst=ignore_dst, work_dir=work_dir)  # type: ignore[arg-type]
            record = find_deployment_record(credentials, project_pk, deployment)  # type: ignore[arg-type]
            trapper_deployment_id = record["deployment_id"] if record else None
            message = f"Deployment {deployment_id} {'created' if deployment_created else 'was already in Trapper'}"
            if trapper_deployment_id and trapper_deployment_id != deployment_id:
                message += f", as {trapper_deployment_id} — the package uses that id"
            yield step("deployment", "done", message + ".", trapper_link(credentials, "deployment", (record or {}).get("pk")))

    elif credentials is not None:  # only generating: what the location says is read — nothing is created
        timezone_name, ignore_dst, note = _location_time_settings(find_location(credentials, project_pk, deployment), timezone_name, ignore_dst)  # type: ignore[arg-type]
        if note:
            yield step("location", "done", f"Location {deployment.location_id} is in Trapper.{note}")

    # ── the package ──
    if dry:
        plan = plan_packages(deployment_dir, log, max_zip_bytes)
        yield step("package", "done", f"Would pack {plan['images']} image(s) into {plan['parts']} package(s) of about {_megabytes(plan['bytes'] / plan['parts'])} MB each.")
        for name, message in [("upload", "Nothing is uploaded in a dry run."), ("process", "Trapper isn't asked to process anything."), ("wait", "No collection is waited for.")]:
            yield step(name, "skipped", message)
        yield {
            "type": "done", "mode": mode, "collection": collection, "deployment_id": deployment_id, "would_create_location": location_created,
            "would_create_deployment": deployment_created, "parts": plan["parts"],
        }
        return

    if mode == "generate":
        yield step("check", "running", f"Checking {len(log['images'])} image(s)…")
        check_images(deployment_dir, log)
        yield step("check", "done", f"{len(log['images'])} image(s) are there.")
    yield step("package", "running", f"Packing {len(log['images'])} image(s)…")
    output_dir = work_dir / collection
    built: list[list[dict]] = []

    def pack(report: Callable[[dict], None]) -> None:
        def on_packed(done: int, total: int) -> None:
            if done == total or done % PACK_REPORT_EVERY == 0:
                report({"type": "pack_progress", "index": done, "total": total})

        built.append(build_packages(
            deployment_dir, collection, deployment_id, log, project_id=classification_pk, timezone_name=timezone_name, ignore_dst=ignore_dst,
            trapper_deployment_id=trapper_deployment_id, output_dir=output_dir, max_zip_bytes=max_zip_bytes, progress=on_packed,
        ))

    yield from _with_progress(pack)
    packages = built[0]
    package_bytes = sum(_size(p[k]) for p in packages for k in ("zip", "yaml"))
    yield {"type": "package_ready", "images": sum(p["files"] for p in packages), "parts": len(packages), "bytes": package_bytes}
    yield step("package", "done", f"{len(packages)} package(s) of {sum(p['files'] for p in packages)} image(s).")

    if mode == "generate":
        yield step("csv", "running", f"Writing the deployments of {collection}…")
        csv_result = upsert_deployments_csv(output_dir / f"{collection}{DEPLOYMENTS_CSV_SUFFIX}", deployment, log)
        yield step("csv", "done", f"{Path(csv_result['path']).name}: {csv_result['action']} {deployment_id} ({csv_result['rows']} deployment(s)).")
        written = [p[k] for p in packages for k in ("zip", "yaml")] + [Path(csv_result["path"])]
        yield {
            "type": "done", "mode": mode, "collection": collection, "deployment_id": deployment_id, "parts": len(packages),
            "output_dir": str(output_dir), "files": [f.name for f in written], "images": sum(p["files"] for p in packages),
            "file_sizes": {f.name: f.stat().st_size for f in written},
        }
        return

    client = trapper_service.client(*credentials)  # type: ignore[misc]
    for number, package in enumerate(packages, start=1):
        yield step("upload", "running", f"Uploading package {number} of {len(packages)}…")
        yield from _with_progress(lambda report, p=package: _upload_files(client, [p["zip"], p["yaml"]], report))
        yield step("upload", "done", f"Package {number} of {len(packages)} uploaded.")
        yield step("process", "running", "Asking Trapper to process the package…")
        try:
            client.collections.trigger_collection(
                payload={"yaml_file": package["yaml"].name, "zip_file": package["zip"].name, "remove_zip": remove_zip}, raise_on_error=True,
            )
        except Exception as exc:
            raise TrapperUploadError(f"Trapper refused to process the package: {_trapper_message(exc)}") from exc
        yield step("process", "done", "Trapper is processing the package.")

    yield step("wait", "running", f"Waiting for the collection {collection} to appear in Trapper…")
    found_collection = _wait_for_collection(client, project_pk, collection, timeout=wait_seconds, poll=poll_seconds)
    if found_collection is None:
        raise TrapperUploadError(f"The collection {collection} didn't appear in Trapper within {int(wait_seconds)} seconds — it may still be processing.")
    yield step("wait", "done", f"Collection {collection} is in Trapper.", trapper_link(credentials, "collection", getattr(found_collection, "pk", None)))

    for package in packages:  # what went up is on Trapper now
        package["zip"].unlink(missing_ok=True)
        package["yaml"].unlink(missing_ok=True)
    (deployment_dir / UPLOAD_LOG_FILE).write_text(json.dumps({
        "uploaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "research_project_pk": project_pk, "classification_project_pk": classification_pk, "collection": collection,
        "parts": len(packages), "location_created": location_created, "deployment_created": deployment_created,
    }, indent=2), encoding="utf-8")
    yield {
        "type": "done", "mode": mode, "collection": collection, "deployment_id": deployment_id, "location_created": location_created,
        "deployment_created": deployment_created, "parts": len(packages),
        "images": sum(p["files"] for p in packages), "bytes": package_bytes,
    }
