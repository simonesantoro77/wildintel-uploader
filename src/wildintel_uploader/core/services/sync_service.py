"""Sync the local collections folder with what Trapper has for a research project.

Trapper is read, never changed; the collections folder only gets what it is missing — what is already
there is left as it is, whatever Trapper says:

  <collections folder>/<research project id>/research_project.json
                                            /locations.json
                                            /<R0003>/collection.json
                                                    /<R0003>_FileTimestampLog.csv
                                                    /<deployment id>/deployment.json

The collections are those linked to the research project whose name is a field collection's (R0003, see
is_field_collection); a deployment of the research project goes to the one its id starts with (R0003-DONA_01 → R0003).
The other collections — subsets made in Trapper, whatever their name — are downloaded by their images instead, apart
(see download_collection_stream). A classification project is only needed to download images. The images are not downloaded, so
there is no preprocessing log; images.json is made from what Trapper holds for each deployment's images (names,
when they were taken, what they show) — not the size, the pixels nor the hashes, which Trapper doesn't have.

The images can be downloaded too (download_images): each into its deployment's folder, as the file Trapper holds. They come
through the classification project's media, the only place that gives a file's access token, so what the project doesn't hold
can't be brought. The deployment is still a synced one: not preprocessed, sealed or modified here.
"""
from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import ValidationError

from wildintel_uploader.core.schemas.requests import DeploymentFields, ResearchProjectRecord
from wildintel_uploader.core.services import deployment_import_service, local_folder_service, trapper_service

logger = logging.getLogger(__name__)

DOWNLOAD_WORKERS = 4  # images downloaded at once
PROGRESS_EVERY = 25  # a message each so many images


def is_field_collection(name: str) -> bool:
    """A collection of the field work: named R + four digits (R0033), optionally with a _suffix — the rest are collections made
    in Trapper for some purpose (R0039-SOLONOVIEMBRE, Pilot…)."""
    return bool(deployment_import_service._COLLECTION_NAME_RE.match((name or "")[:1].upper() + (name or "")[1:]))


def project_collections(credentials: tuple[str, str, str], research_project_pk: int) -> list[dict]:
    """Every collection linked to the research project in Trapper, {"pk" (the collection's own), "name"}, sorted by name —
    read from the research project itself, with no classification project involved."""
    client = trapper_service.client(*credentials)
    links = client.research_projects.where_project_collections(research_project_pk, page_size=trapper_service.LIST_PAGE_SIZE)
    seen: dict[str, dict] = {}
    for link in links:
        if link.name and link.name.lower() not in seen:
            seen[link.name.lower()] = {"pk": link.collection_pk or link.pk, "name": link.name}
    return sorted(seen.values(), key=lambda c: c["name"].lower())


def collection_names(credentials: tuple[str, str, str], research_project_pk: int) -> list[str]:
    """The names of the research project's field collections (see is_field_collection), sorted."""
    return [c["name"] for c in project_collections(credentials, research_project_pk) if is_field_collection(c["name"])]


def collections_with_deployments(credentials: tuple[str, str, str], research_project_pk: int, root: Path | None = None, project_id: str | None = None) -> dict:
    """What can be synced, to choose from: {"field": [{"name", "deployments", "local"}], "other": [{"pk", "name", "downloaded"}]}.
    A field collection's deployments are the ids (upper case) of the research project's deployments that start with its name;
    "local" says what the collections folder already has of it: {"exists", "deployments": ids there, "with_images": ids with
    image files}. An other collection is downloaded by its images (see download_collection_stream); "downloaded" is how many
    of them are already in the downloads folder."""
    deployments = trapper_service.list_deployments(*credentials, research_project_pk)
    folder = root / project_id if root and project_id else None
    downloads = downloads_dir(root, project_id) if root and project_id else None
    field, other = [], []
    for collection in project_collections(credentials, research_project_pk):
        name = collection["name"]
        if not is_field_collection(name):
            there = downloads / _safe_name(name) if downloads else None
            count = sum(1 for p in there.rglob("*") if p.is_file()) if there and there.is_dir() else 0
            other.append({"pk": collection["pk"], "name": name, "downloaded": count})
            continue
        ids = sorted(deployment_id for deployment_id, _ in _deployments_of(deployments, name))
        local = {"exists": False, "deployments": [], "with_images": []}
        if folder is not None and (folder / name).is_dir():
            local["exists"] = True
            for deployment_id in ids:
                target = folder / name / deployment_id
                if (target / local_folder_service.DEPLOYMENT_METADATA_FILE).is_file():
                    local["deployments"].append(deployment_id)
                if target.is_dir() and any(p.suffix.lower() in deployment_import_service.IMAGE_EXTENSIONS for p in target.iterdir()):
                    local["with_images"].append(deployment_id)
        field.append({"name": name, "deployments": ids, "local": local})
    return {"field": field, "other": other}


def downloads_dir(root: Path, project_id: str) -> Path:
    """Where the collections that are not field collections are downloaded: beside the collections folder, in
    downloads/<research project>/ — apart, so they never mix with the collections of the field work."""
    return root.parent / "downloads" / project_id


def _safe_name(name: str) -> str:
    """A collection's name as a folder name: whatever it is called in Trapper, with the characters no system allows replaced."""
    cleaned = "".join("_" if c in '<>:"/\\|?*' or ord(c) < 32 else c for c in name).strip().rstrip(".")
    return cleaned or "collection"


def download_collection_stream(credentials: tuple[str, str, str], root: Path, project_id: str, classification_project_pk: int, collection: dict) -> Iterator[dict]:
    """Downloads the images of a collection that is not a field one — a subset made in Trapper — through the classification
    project, into downloads/<research project>/<collection>/<deployment>/, the ones already there kept. Yields progress
    messages and returns {"name", "folder", "downloaded", "already", "bytes", "failed"}."""
    target = downloads_dir(root, project_id) / _safe_name(collection["name"])
    client = trapper_service.client(*credentials)
    media = list(client.classification_media.where_collection_media(classification_project_pk, collection["pk"], page_size=trapper_service.LIST_PAGE_SIZE))
    todo = []
    for m in media:
        folder = target / _safe_name((m.deploymentID or "no-deployment").upper())
        if Path(m.fileName).name == m.fileName and not (folder / m.fileName).is_file():
            todo.append((str(m.filePath), folder / m.fileName))
    result = {"name": collection["name"], "folder": str(target), "downloaded": 0, "already": len(media) - len(todo), "bytes": 0, "failed": []}
    yield {"type": "progress", "message": f"{collection['name']}: {len(todo)} image(s) to download" + (f", {result['already']} already here." if result["already"] else ".")}
    if not todo:
        return result
    download = trapper_service.file_downloader(*credentials)
    pool = ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS)
    try:
        for _, path in todo:
            path.parent.mkdir(parents=True, exist_ok=True)
        futures = {pool.submit(download, url, path): path.name for url, path in todo}
        for count, future in enumerate(as_completed(futures), 1):
            try:
                result["bytes"] += future.result()
                result["downloaded"] += 1
            except Exception as exc:
                logger.warning("%s: downloading %s failed: %s", collection["name"], futures[future], exc)
                result["failed"].append({"deployment_id": collection["name"], "name": futures[future], "error": str(exc)})
            if count % PROGRESS_EVERY == 0 and count < len(todo):
                yield {"type": "progress", "message": f"{collection['name']}: {count}/{len(todo)} images ({result['bytes'] / 1e6:.1f} MB)."}
    finally:
        pool.shutdown(wait=True, cancel_futures=True)
    yield {"type": "progress", "message": f"{collection['name']}: {result['downloaded']} image(s) downloaded ({result['bytes'] / 1e6:.1f} MB)."}
    return result


def _deployments_of(deployments: list[dict], collection: str) -> list[tuple[str, dict]]:
    """The (id in upper case, deployment) pairs whose id starts with the collection's code."""
    found = []
    for deployment in deployments:
        deployment_id = (deployment["deployment_id"] or "").upper()  # Trapper has it in lower case
        try:
            code = deployment_import_service.collection_code(deployment_id)
        except deployment_import_service.DeploymentImportError:
            continue
        if code.lower() == collection.lower():
            found.append((deployment_id, deployment))
    return found


def wall_clock(value: str, timezone_name: str | None, ignore_dst: bool) -> datetime:
    """The camera's wall-clock time of an ISO 8601 moment Trapper holds: in the location's timezone, on its standard
    time all year when it ignores summer time. Without a timezone, the time as written."""
    moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if moment.tzinfo is None or not timezone_name:
        return moment.replace(tzinfo=None)
    try:
        zone = ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError):
        return moment.replace(tzinfo=None)
    local = moment.astimezone(zone)
    return local.replace(tzinfo=None) - (local.dst() or timedelta(0) if ignore_dst else timedelta(0))


def deployment_fields(deployment: dict, deployment_id: str) -> DeploymentFields:
    """A deployment as Trapper exports it, as DeploymentFields: the empty values are left out (Trapper gives "" for what
    it doesn't have), the dates' offset is written ±hh:mm (it gives +0000) and the ids are in upper case.

    Raises:
        pydantic.ValidationError: what is left is not a valid deployment.
    """
    given = {k: v for k, v in deployment.items() if k != "pk" and v is not None and v != "" and v != []}
    for key in ("start_date", "end_date"):
        if isinstance(given.get(key), str):
            try:
                given[key] = datetime.fromisoformat(given[key].replace("Z", "+00:00")).isoformat()
            except ValueError:
                pass  # left as it is: the validation says what is wrong
    if given.get("location_id"):
        given["location_id"] = given["location_id"].upper()
    return DeploymentFields.model_validate({**given, "deployment_id": deployment_id})


def image_entries(resources: list[dict], timezone_name: str | None, ignore_dst: bool) -> list[dict]:
    """What images.json keeps of the images Trapper holds for a deployment, in order of when they were taken:
    the name and when (the camera's wall clock in the location's timezone) and, as extras, Trapper's pk, the instant as
    Trapper has it and its epoch seconds, the mime and what they show."""
    entries = []
    for r in resources:
        taken = r.get("date_recorded")
        local = stamp = None
        if taken:
            try:
                local = wall_clock(str(taken), timezone_name, ignore_dst).isoformat()
                moment = datetime.fromisoformat(str(taken).replace("Z", "+00:00"))
                stamp = moment.timestamp() if moment.tzinfo else None
            except ValueError:
                pass
        entries.append(local_folder_service.image_entry(r["name"], local, "trapper", {
            "trapper_pk": r["pk"], "taken_at": taken, "timestamp": stamp, "mime": r.get("mime"),
            "date_recorded_correct": r.get("date_recorded_correct"), "observation_type": r.get("observation_type", []),
            "species": r.get("species", []), "tags": r.get("tags", []),
        }))
    return sorted(entries, key=lambda e: (e["local_time"] or "", e["name"]))


def _names_in_images_file(deployment_dir: Path) -> list[str]:
    try:
        info = json.loads((deployment_dir / local_folder_service.IMAGES_FILE).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return [i["name"] for i in info.get("images", []) if isinstance(i, dict) and i.get("name")]


def _download_images(
    credentials: tuple[str, str, str], classification_project_pk: int, deployment: dict, deployment_id: str, target: Path, prefix: str,
) -> Iterator[dict]:
    """Downloads into the deployment's folder the images of the deployment the classification project holds and the folder lacks,
    a few at a time — what is there is kept. Yields progress messages and returns {"downloaded", "bytes", "failed": [{"name", "error"}],
    "not_held": [names of the images Trapper lists for the deployment that the project doesn't hold], "already"}."""
    media = trapper_service.list_deployment_media(*credentials, classification_project_pk, deployment["pk"])
    held = {m["name"] for m in media}
    not_held = sorted(set(_names_in_images_file(target)) - held)
    todo = [m for m in media if Path(m["name"]).name == m["name"] and not (target / m["name"]).is_file()]
    already = len(media) - len(todo)
    result: dict = {"downloaded": 0, "bytes": 0, "failed": [], "not_held": not_held, "already": already}
    yield {"type": "progress", "message": f"{prefix}: {len(todo)} image(s) to download" + (f", {already} already here" if already else "")
           + (f", {len(not_held)} not in the classification project" if not_held else "") + "."}
    if not todo:
        return result

    download = trapper_service.file_downloader(*credentials)
    pool = ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS)
    try:
        futures = {pool.submit(download, m["url"], target / m["name"]): m["name"] for m in todo}
        for count, future in enumerate(as_completed(futures), 1):
            name = futures[future]
            try:
                result["bytes"] += future.result()
                result["downloaded"] += 1
            except Exception as exc:  # one image that fails doesn't stop the rest
                logger.warning("%s: downloading %s failed: %s", deployment_id, name, exc)
                result["failed"].append({"name": name, "error": str(exc)})
            if count % PROGRESS_EVERY == 0 and count < len(todo):
                yield {"type": "progress", "message": f"{prefix}: {count}/{len(todo)} images ({result['bytes'] / 1e6:.1f} MB)."}
    finally:
        pool.shutdown(wait=True, cancel_futures=True)  # a stop doesn't leave the rest queued
    yield {"type": "progress", "message": f"{prefix}: {result['downloaded']} image(s) downloaded ({result['bytes'] / 1e6:.1f} MB)"
           + (f", {len(result['failed'])} failed." if result["failed"] else ".")}
    return result


def take_locations(credentials: tuple[str, str, str], root: Path, research_project: dict) -> dict:
    """The research project and its locations, taken from Trapper into the collections folder — what the field records
    need, with no classification project nor collection involved. What is already there is kept; the locations it lacks
    are added. Returns {"research_project", "created": [location ids], "kept": [location ids]}.

    Raises:
        local_folder_service.LocalFolderError: the research project can't be a folder name.
    """
    project_id = research_project.get("acronym") or str(research_project["pk"])
    folder = local_folder_service.project_dir(root, project_id)
    if not (folder / local_folder_service.RESEARCH_PROJECT_METADATA_FILE).is_file():
        record = ResearchProjectRecord.model_construct(name=research_project.get("name") or project_id, acronym=project_id, trapper_pk=research_project["pk"])
        local_folder_service.write_research_project(root, record.model_dump())
    known = {l.get("location_id", "").lower() for l in local_folder_service.list_locations(root, project_id)}
    created, kept = [], []
    for location in trapper_service.list_locations(*credentials, research_project["pk"]):
        if location["location_id"].lower() in known:
            kept.append(location["location_id"].upper())
            continue
        record = {k: location.get(k) for k in ("location_id", "name", "timezone", "ignore_dst", "latitude", "longitude")}
        local_folder_service.write_location(root, project_id, {**record, "location_id": location["location_id"].upper(), "coordinate_uncertainty": None, "trapper_pk": location["pk"]})
        created.append(location["location_id"].upper())
    return {"research_project": project_id, "created": created, "kept": kept}


def sync_stream(
    credentials: tuple[str, str, str], root: Path, research_project: dict, classification_project_pk: int | None = None,
    only: list[str] | None = None, only_deployments: list[str] | None = None, download_images: bool = False,
    other_collections: list[dict] | None = None,
) -> Iterator[dict]:
    """Creates, under root, what Trapper has for the classification project and the folder lacks — one deployment at a time.

    research_project is {"pk", "name", "acronym"} — the one the classification project belongs to.
    only limits the sync to the collections of those names (any case), and only_deployments to the deployments of
    those ids (any case); None syncs them all. download_images also brings the images of the deployments into their folders
    (see _download_images); the "done" event then has a "downloaded" with what came — {"images", "bytes", "deployments":
    {id: count}, "failed": [{"deployment_id", "name", "error"}], "not_held": {id: [names]}}.
    The deployments' and locations' ids, which Trapper keeps in lower case, are written in upper case.

    Yields {"type": "progress", "message"} as each step starts or ends, and last {"type": "done", ...} with the lists
    of what was "created" and what was already there ("kept") for each kind, the deployments no collection of the
    classification project claims ("unassigned"), and those Trapper holds in a way that is not a valid deployment
    ("failed": {"deployment_id", "error"}), which are left out.

    Raises:
        local_folder_service.LocalFolderError: the research project can't be a folder name.
    """
    def say(message: str) -> dict:
        return {"type": "progress", "message": message}

    project_id = research_project.get("acronym") or str(research_project["pk"])
    folder = local_folder_service.project_dir(root, project_id)
    if (download_images or other_collections) and not classification_project_pk:
        raise local_folder_service.LocalFolderError("Downloading images needs a classification project: Trapper only gives the files through one.")
    created: dict[str, list[str]] = {"research_project": [], "locations": [], "collections": [], "deployments": [], "timestamp_log": [], "images": []}
    kept: dict[str, list[str]] = {key: [] for key in created}

    if (folder / local_folder_service.RESEARCH_PROJECT_METADATA_FILE).is_file():
        kept["research_project"].append(project_id)
        yield say(f"Research project {project_id}: already there.")
    else:
        record = ResearchProjectRecord.model_construct(name=research_project.get("name") or project_id, acronym=project_id, trapper_pk=research_project["pk"])
        local_folder_service.write_research_project(root, record.model_dump())
        created["research_project"].append(project_id)
        yield say(f"Research project {project_id}: created.")

    yield say("Reading the locations from Trapper…")
    locations = trapper_service.list_locations(*credentials, research_project["pk"])
    known = {l.get("location_id", "").lower() for l in local_folder_service.list_locations(root, project_id)}
    by_id = {}
    for location in locations:
        by_id[location["location_id"].lower()] = location
        if location["location_id"].lower() in known:
            kept["locations"].append(location["location_id"].upper())
            continue
        record = {k: location.get(k) for k in ("location_id", "name", "timezone", "ignore_dst", "latitude", "longitude")}
        # Trapper keeps the ids in lower case; here they are written as the wizard does, in upper case.
        local_folder_service.write_location(root, project_id, {**record, "location_id": location["location_id"].upper(), "coordinate_uncertainty": None, "trapper_pk": location["pk"]})
        created["locations"].append(location["location_id"].upper())
    yield say(f"Locations: {len(created['locations'])} created, {len(kept['locations'])} already there.")

    yield say("Reading the deployments and collections from Trapper…")
    deployments = trapper_service.list_deployments(*credentials, research_project["pk"])
    names = collection_names(credentials, research_project["pk"])
    if only is not None:
        wanted = {n.lower() for n in only}
        names = [n for n in names if n.lower() in wanted]
    claimed: set[str] = set()
    failed: list[dict] = []
    downloaded: dict = {"images": 0, "bytes": 0, "deployments": {}, "failed": [], "not_held": {}}
    for number, name in enumerate(names, 1):
        collection_dir = folder / name
        if (collection_dir / local_folder_service.COLLECTION_METADATA_FILE).is_file():
            kept["collections"].append(name)
        else:
            local_folder_service.write_collection_metadata(collection_dir, name)
            created["collections"].append(name)
        mine = _deployments_of(deployments, name)
        claimed.update(deployment_id for deployment_id, _ in mine)  # not "unassigned" even if left out here
        if only_deployments is not None:
            wanted_ids = {d.upper() for d in only_deployments}
            mine = [(deployment_id, d) for deployment_id, d in mine if deployment_id in wanted_ids]
        yield say(f"Collection {name} ({number}/{len(names)}): {len(mine)} deployment(s).")
        log_rows = {row["Deployment"].upper() for row in local_folder_service.read_timestamp_log(local_folder_service.timestamp_log_path(collection_dir))}
        for position, (deployment_id, deployment) in enumerate(mine, 1):
            prefix = f"{deployment_id} ({position}/{len(mine)})"
            target = collection_dir / deployment_id
            if (target / local_folder_service.DEPLOYMENT_METADATA_FILE).is_file():
                kept["deployments"].append(deployment_id)
            else:
                try:
                    fields = deployment_fields(deployment, deployment_id)
                except ValidationError as exc:  # one deployment Trapper holds badly doesn't stop the rest
                    error = "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors())
                    failed.append({"deployment_id": deployment_id, "error": error})
                    yield say(f"{prefix}: skipped, Trapper holds it with invalid values ({error}).")
                    continue
                local_folder_service.write_deployment_metadata(target, fields.model_dump())
                created["deployments"].append(deployment_id)
            if (target / local_folder_service.IMAGES_FILE).is_file():
                kept["images"].append(deployment_id)
            else:
                yield say(f"{prefix}: reading its images from Trapper…")
                location = by_id.get((deployment.get("location_id") or "").lower(), {})
                resources = trapper_service.list_deployment_resources(*credentials, deployment["pk"])
                entries = image_entries(resources, location.get("timezone"), bool(location.get("ignore_dst")))
                local_folder_service.write_images_file(target, deployment_id, entries, source="trapper")
                created["images"].append(deployment_id)
            if download_images:
                got = yield from _download_images(credentials, classification_project_pk, deployment, deployment_id, target, prefix)
                downloaded["images"] += got["downloaded"]
                downloaded["bytes"] += got["bytes"]
                if got["downloaded"]:
                    downloaded["deployments"][deployment_id] = got["downloaded"]
                downloaded["failed"] += [{"deployment_id": deployment_id, **f} for f in got["failed"]]
                if got["not_held"]:
                    downloaded["not_held"][deployment_id] = got["not_held"]
            if deployment_id.upper() in log_rows:
                kept["timestamp_log"].append(deployment_id)
            elif deployment.get("start_date") and deployment.get("end_date"):
                location = by_id.get((deployment.get("location_id") or "").lower(), {})
                tz, dst = location.get("timezone"), bool(location.get("ignore_dst"))
                start, end = wall_clock(deployment["start_date"], tz, dst), wall_clock(deployment["end_date"], tz, dst)
                try:
                    local_folder_service.upsert_timestamp_log(collection_dir, deployment_id, start, end)
                    created["timestamp_log"].append(deployment_id)
                except local_folder_service.LocalFolderError as exc:
                    logger.warning("%s: no timestamp log row: %s", deployment_id, exc)
            yield say(f"{prefix}: done.")

    others = []
    for collection in other_collections or []:
        got = yield from download_collection_stream(credentials, root, project_id, classification_project_pk, collection)
        others.append(got)
    unassigned = sorted(d["deployment_id"].upper() for d in deployments if d["deployment_id"] and d["deployment_id"].upper() not in claimed)
    yield {"type": "done", "research_project_id": project_id, "folder": str(folder), "created": created, "kept": kept, "unassigned": unassigned, "failed": failed, "collections": names,
           **({"downloaded": downloaded} if download_images else {}), **({"others": others} if other_collections else {})}


def sync(
    credentials: tuple[str, str, str], root: Path, research_project: dict, classification_project_pk: int | None,
    only: list[str] | None = None, only_deployments: list[str] | None = None, download_images: bool = False,
) -> dict:
    """sync_stream run to its end: what it created and kept, without the progress."""
    result: dict = {}
    for event in sync_stream(credentials, root, research_project, classification_project_pk, only, only_deployments, download_images):
        if event["type"] == "done":
            result = {k: v for k, v in event.items() if k != "type"}
    return result
