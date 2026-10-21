"""services.trapper_upload_service — creating what a deployment needs in Trapper, packing its
images into a zip and a yaml, and uploading them. Trapper itself is faked (no network)."""
import json
import sys
import types
import zipfile
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import httpx
import pytest
import yaml
from PIL import Image

from wildintel_uploader.core.schemas.requests import DeploymentFields
from wildintel_uploader.core.services import preprocessing_service, trapper_service
from wildintel_uploader.core.services import trapper_upload_service as up

CREDENTIALS = ("https://trapper.example.org", "alice@example.org", "s3cret")
RECORD = {"name": "Doñana", "acronym": "DONA", "trapper_pk": 2}
DEPLOYMENT_ID = "R0003-DONA_0006_B"


def _jpeg(path: Path, taken: str, size=(40, 20)) -> None:
    img = Image.new("RGB", size, "red")
    exif = img.getexif()
    exif.get_ifd(0x8769)[36867] = taken
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, exif=exif)


def _deployment(**overrides) -> DeploymentFields:
    base = {
        "deployment_id": DEPLOYMENT_ID, "location_id": "DONA_0006_B", "location_name": "Doñana site 6B", "latitude": 37.0, "longitude": -6.5,
        "coordinate_uncertainty": 100, "start_date": "2024-07-01T00:00:00+02:00", "end_date": "2024-07-31T00:00:00+02:00",
    }
    return DeploymentFields.model_validate({**base, **overrides})


def _imported(tmp_path: Path, images: int = 3, *, deployment=None) -> Path:
    """A deployment imported through the wizard's preprocessing: returns its collection folder."""
    source = tmp_path / "source"
    for i in range(images):
        _jpeg(source / f"IMG_{i:04d}.JPG", f"2024:07:0{i + 1} 10:00:00")
    collection = tmp_path / "collections" / "DONA" / "R0003"
    list(preprocessing_service.preprocess_stream(
        str(source), str(collection), "R0003", deployment or _deployment(), preprocessing_service.PreprocessOptions(metadata=False, resize=False, timezone="Europe/Madrid"),
    ))
    return collection


# ── what can be uploaded ─────────────────────────────────────────────────────

def test_the_collections_and_deployments_kept_for_a_research_project_are_listed(tmp_path: Path):
    collection = _imported(tmp_path, 3)
    (collection / DEPLOYMENT_ID / "upload.json").write_text(json.dumps({"uploaded_at": "2024-08-01T10:00:00+00:00"}), encoding="utf-8")
    old = collection.parent / "R0001" / "R0001-DONA_01"  # imported before the preprocessing existed
    old.mkdir(parents=True)
    (old / "deployment.json").write_text(json.dumps({"deployment_id": "R0001-DONA_01", "location_id": "DONA_01", "start_date": "2024-01-01T00:00:00+01:00", "end_date": "2024-02-01T00:00:00+01:00"}), encoding="utf-8")
    (collection.parent / "not_a_collection").mkdir()
    (collection.parent / "R0004").mkdir()  # an empty collection

    result = up.list_collections(tmp_path / "collections", "DONA")

    assert [c["name"] for c in result] == ["R0001", "R0003", "R0004"]
    r1, r3, r4 = result
    assert r1["deployments"] == [{
        "deployment_id": "R0001-DONA_01", "location_id": "DONA_01", "start_date": "2024-01-01T00:00:00+01:00", "end_date": "2024-02-01T00:00:00+01:00",
        "images": 0, "bytes": 0, "preprocessed": False, "uploaded_at": None,
    }]
    [dep] = r3["deployments"]
    assert (dep["deployment_id"], dep["images"], dep["preprocessed"], dep["uploaded_at"]) == (DEPLOYMENT_ID, 3, True, "2024-08-01T10:00:00+00:00")
    assert r4["deployments"] == []
    assert r3["path"] == str(collection)


def test_a_research_project_with_nothing_kept_has_no_collections(tmp_path: Path):
    assert up.list_collections(tmp_path, "NOPE") == []


def test_a_research_project_id_that_is_not_a_folder_name_is_refused(tmp_path: Path):
    with pytest.raises(local_folder_service_error()):
        up.list_collections(tmp_path, "../x")


def local_folder_service_error():
    from wildintel_uploader.core.services.local_folder_service import LocalFolderError
    return LocalFolderError


# ── the package ──────────────────────────────────────────────────────────────

def _build(tmp_path: Path, collection: Path, **kw):
    log = json.loads((collection / DEPLOYMENT_ID / "preprocessing.json").read_text())
    params = {"project_id": 2, "timezone_name": "Europe/Madrid", "ignore_dst": True, "output_dir": tmp_path / "packages" / "R0003", "stamp": "20260101000000", **kw}
    return up.build_packages(collection / DEPLOYMENT_ID, "R0003", DEPLOYMENT_ID, log, **params)


def test_the_package_is_a_zip_of_the_images_and_a_yaml_describing_them_as_in_wildintel_tools(tmp_path: Path):
    collection = _imported(tmp_path, 3)

    [package] = _build(tmp_path, collection)

    assert package["yaml"].name == f"package_2_20260101000000_R0003_{DEPLOYMENT_ID}_part001.yaml"
    assert package["zip"].name == f"package_2_20260101000000_R0003_{DEPLOYMENT_ID}_part001.zip"
    assert package["files"] == 3
    names = sorted(f.name for f in (collection / DEPLOYMENT_ID).glob("*.JPEG"))
    with zipfile.ZipFile(package["zip"]) as z:
        assert sorted(z.namelist()) == [f"R0003/{DEPLOYMENT_ID.lower()}/{n}" for n in names]  # Trapper keeps its deployment ids in lower case
    definition = yaml.safe_load(package["yaml"].read_text(encoding="utf-8"))
    [col] = definition["collections"]
    assert (col["name"], col["project_id"], col["timezone"], col["timezone_ignore_dst"], col["resources_dir"]) == ("R0003", 2, "Europe/Madrid", True, "R0003")
    [dep] = col["deployments"]
    assert dep["deployment_id"] == DEPLOYMENT_ID.lower() and [r["file"] for r in dep["resources"]] == names


def test_each_resource_says_when_it_was_recorded_in_utc_and_what_it_is(tmp_path: Path):
    collection = _imported(tmp_path, 1)

    [package] = _build(tmp_path, collection)

    [resource] = yaml.safe_load(package["yaml"].read_text(encoding="utf-8"))["collections"][0]["deployments"][0]["resources"]
    image = collection / DEPLOYMENT_ID / resource["file"]
    assert resource["date_recorded"] == "2024-07-01T09:00:00+0000"  # 10:00 at +01:00 (summer time ignored), in UTC
    assert resource["name"] == resource["file"]
    assert resource["mime_type"] == "image/jpeg"
    assert (resource["file_width"], resource["file_height"], resource["file_size"]) == (40, 20, image.stat().st_size)
    assert resource["file_fps"] is None and resource["file_duration"] is None


def test_a_package_too_big_is_split_into_parts_each_with_its_own_yaml(tmp_path: Path):
    collection = _imported(tmp_path, 4)
    size = next((collection / DEPLOYMENT_ID).glob("*.JPEG")).stat().st_size

    packages = _build(tmp_path, collection, max_zip_bytes=size * 2 + 10)  # two images a part

    assert [p["files"] for p in packages] == [2, 2]
    assert [p["yaml"].name[-12:] for p in packages] == ["part001.yaml", "part002.yaml"]
    first = yaml.safe_load(packages[0]["yaml"].read_text(encoding="utf-8"))["collections"][0]["deployments"][0]["resources"]
    second = yaml.safe_load(packages[1]["yaml"].read_text(encoding="utf-8"))["collections"][0]["deployments"][0]["resources"]
    assert len(first) == len(second) == 2 and not {r["file"] for r in first} & {r["file"] for r in second}
    for package in packages:
        with zipfile.ZipFile(package["zip"]) as z:
            assert len(z.namelist()) == 2


def test_an_image_bigger_than_the_limit_goes_in_a_part_of_its_own(tmp_path: Path):
    collection = _imported(tmp_path, 2)

    assert [p["files"] for p in _build(tmp_path, collection, max_zip_bytes=1)] == [1, 1]


def test_without_a_limit_everything_is_one_package(tmp_path: Path):
    collection = _imported(tmp_path, 3)

    assert [p["files"] for p in _build(tmp_path, collection, max_zip_bytes=None)] == [3]


def test_an_image_the_preprocessing_recorded_but_is_missing_is_refused(tmp_path: Path):
    collection = _imported(tmp_path, 2)
    next((collection / DEPLOYMENT_ID).glob("*.JPEG")).unlink()

    with pytest.raises(up.TrapperUploadError, match="1 image\\(s\\) recorded when the images were prepared are missing"):
        _build(tmp_path, collection)


def test_a_deployment_with_no_images_has_nothing_to_pack(tmp_path: Path):
    with pytest.raises(up.TrapperUploadError, match="no images to upload"):
        up.build_packages(tmp_path, "R0003", DEPLOYMENT_ID, {"images": []}, project_id=2, timezone_name="UTC", ignore_dst=True, output_dir=tmp_path / "out")


# ── Trapper: what exists ─────────────────────────────────────────────────────

class FakeTrapper:
    """Just enough of the SDK's client: what a research project has, and what gets created and uploaded."""

    def __init__(self, *, projects=None, locations=(), deployments=(), collections_appear=True, classification_projects=None):
        self.projects = projects if projects is not None else [SimpleNamespace(pk=2, name="Doñana", acronym="DONA")]
        self.location_rows = list(locations)
        self.deployment_rows = list(deployments)
        self.collections_appear = collections_appear
        self.imported_locations: list[dict] = []
        self.imported_deployments: list[dict] = []
        self.triggered: list[dict] = []
        self.research_projects = SimpleNamespace(where=lambda **kw: list(self.projects))
        self.classification_rows = classification_projects if classification_projects is not None else [SimpleNamespace(pk=7, name="Doñana classification", is_active=True)]
        self.classification_projects = SimpleNamespace(where=lambda **kw: list(self.classification_rows))
        self.location_settings: dict[str, tuple[str, bool]] = {}  # a location's (timezone, ignore_dst) in Trapper — the import options' own (Europe/Madrid, ignoring summer time) by default
        self.locations = SimpleNamespace(where=lambda **kw: [SimpleNamespace(pk=i, location_id=l, name=None, timezone=self.location_settings.get(l, ("Europe/Madrid", True))[0]) for i, l in enumerate(self.location_rows, 1)],
                                         export=lambda query=None: [SimpleNamespace(pk=i, latitude=None, longitude=None, ignore_dst=self.location_settings.get(l, ("Europe/Madrid", True))[1]) for i, l in enumerate(self.location_rows, 1)],
                                         import_locations=self._import_locations)
        self.deployments = SimpleNamespace(export=lambda query=None: [self._export(d) for d in self.deployment_rows], import_deployments=self._import_deployments)
        self.collections = SimpleNamespace(where=lambda **kw: [SimpleNamespace(name=kw["search"], pk=26)] if self.collections_appear else [], trigger_collection=self._trigger)

    @staticmethod
    def _export(deployment_id):
        names = ["deployment_id", "location_id", "location_name", "latitude", "longitude", "coordinate_uncertainty", "start_date", "end_date", "setup_by",
                 "camera_id", "camera_model", "camera_interval", "camera_height", "camera_depth", "camera_tilt", "camera_heading", "detection_distance",
                 "bait_use", "timestamp_issues", "feature_type", "habitat", "deployment_groups", "comments", "tags"]
        return SimpleNamespace(**{**{n: None for n in names}, "pk": 1, "deployment_id": deployment_id, "tags": []})

    def _import_locations(self, **kw):
        kw["rows"] = Path(kw["file"]).read_text(encoding="utf-8").splitlines()  # the file is removed afterwards
        self.imported_locations.append(kw)
        return True

    def _import_deployments(self, **kw):
        kw["rows"] = Path(kw["file"]).read_text(encoding="utf-8").splitlines()
        self.imported_deployments.append(kw)
        return True

    def _trigger(self, payload, raise_on_error=True):
        self.triggered.append(payload)


@pytest.fixture
def uploader_login(monkeypatch: pytest.MonkeyPatch):
    """The uploader's login is a different door from the API's: stood in for by one that accepts every account (the tests of the refusal replace it)."""
    logins: list[tuple] = []
    monkeypatch.setattr(up, "_uploader_login", lambda credentials: logins.append(credentials))
    return logins


@pytest.fixture
def fake_uploader(monkeypatch: pytest.MonkeyPatch, uploader_login):
    """The SDK's HTTPUploader needs aiofiles and blake3 (its "upload" extra): a stand-in with the same shape."""
    uploads: list[tuple[str, str]] = []

    class FakeUploader:
        fail_on: str | None = None
        error: Exception | None = None

        def __init__(self, client, progress_callback=None):
            self.progress_callback = progress_callback

        async def upload_file(self, file_path: Path, remote_path: str) -> None:
            if FakeUploader.fail_on and FakeUploader.fail_on in file_path.name:
                raise FakeUploader.error or RuntimeError("connection reset by peer")
            uploads.append((file_path.name, remote_path))
            size = file_path.stat().st_size
            if self.progress_callback:
                half = size // 2
                self.progress_callback("chunk_progress", {"bytes": half})
                self.progress_callback("chunk_progress", {"bytes": size - half})
            Path(str(file_path) + ".uploadmeta.json").write_text("{}")

    module = types.ModuleType("trapper_client.components.http_uploader")
    module.HTTPUploader = FakeUploader
    monkeypatch.setitem(sys.modules, "trapper_client.components.http_uploader", module)
    FakeUploader.uploads = uploads
    return FakeUploader


def _with(fake: FakeTrapper):
    return patch.object(trapper_service, "_client", return_value=fake)


def test_the_research_project_is_the_one_it_was_filled_in_from_or_else_the_one_with_its_acronym():
    fake = FakeTrapper(projects=[SimpleNamespace(pk=2, name="Doñana", acronym="DONA"), SimpleNamespace(pk=9, name="Sierra", acronym="SINE")])
    with _with(fake):
        assert up.find_research_project(CREDENTIALS, {"acronym": "XXXX", "trapper_pk": 9}) == 9   # by its pk
        assert up.find_research_project(CREDENTIALS, {"acronym": "dona", "trapper_pk": None}) == 2  # by acronym, ignoring case
        assert up.find_research_project(CREDENTIALS, {"acronym": "SINE", "trapper_pk": 123}) == 9  # its pk isn't there: the acronym is


def test_a_research_project_trapper_does_not_have_is_not_created_here():
    with _with(FakeTrapper()), pytest.raises(up.TrapperUploadError, match="Trapper has no research project 'NOPE' — create it there first"):
        up.find_research_project(CREDENTIALS, {"acronym": "NOPE", "trapper_pk": None})


def test_a_location_trapper_does_not_have_is_created_from_the_deployments_coordinates(tmp_path: Path):
    fake = FakeTrapper(locations=["DONA_0001"])
    with _with(fake):
        created = up.ensure_location(CREDENTIALS, 2, _deployment(), timezone_name="Europe/Madrid", ignore_dst=True, work_dir=tmp_path)

    assert created is True
    [call] = fake.imported_locations
    assert (call["research_project"], call["timezone"], call["ignore_dst"]) == (2, "Europe/Madrid", True)
    assert call["rows"] == ["locationID,locationName,longitude,latitude,coordinateUncertainty", "DONA_0006_B,Doñana site 6B,-6.5,37.0,100"]
    assert not list(tmp_path.glob("*.csv"))  # the csv is only for the import


def test_a_location_trapper_already_has_is_left_alone_ignoring_case(tmp_path: Path):
    fake = FakeTrapper(locations=["dona_0006_b"])
    with _with(fake):
        created = up.ensure_location(CREDENTIALS, 2, _deployment(), timezone_name="UTC", ignore_dst=False, work_dir=tmp_path)

    assert created is False and fake.imported_locations == []


def test_a_location_without_coordinates_or_name_is_still_created_with_what_there_is(tmp_path: Path):
    fake = FakeTrapper()
    with _with(fake):
        up.ensure_location(CREDENTIALS, 2, _deployment(location_name=None, coordinate_uncertainty=None), timezone_name="UTC", ignore_dst=False, work_dir=tmp_path)

    assert fake.imported_locations[0]["rows"][1] == "DONA_0006_B,,-6.5,37.0,"


def test_a_deployment_without_a_location_cannot_have_one_created(tmp_path: Path):
    with _with(FakeTrapper()), pytest.raises(up.TrapperUploadError, match="no location id"):
        up.ensure_location(CREDENTIALS, 2, _deployment(location_id=None), timezone_name="UTC", ignore_dst=False, work_dir=tmp_path)


def test_a_deployment_trapper_does_not_have_is_created_from_its_details(tmp_path: Path):
    fake = FakeTrapper(deployments=["R0003-DONA_0001"])
    with _with(fake):
        created = up.ensure_deployment(CREDENTIALS, 2, _deployment(), timezone_name="Europe/Madrid", ignore_dst=True, work_dir=tmp_path)

    assert created is True
    [call] = fake.imported_deployments
    assert (call["research_project"], call["timezone"], call["ignore_dst"]) == (2, "Europe/Madrid", True)
    assert call["rows"][1].startswith(f'"{DEPLOYMENT_ID}","DONA_0006_B"')
    assert not list(tmp_path.glob("*.csv"))


def test_a_deployment_trapper_already_has_is_left_alone(tmp_path: Path):
    fake = FakeTrapper(deployments=[DEPLOYMENT_ID.lower()])
    with _with(fake):
        created = up.ensure_deployment(CREDENTIALS, 2, _deployment(), timezone_name="UTC", ignore_dst=False, work_dir=tmp_path)

    assert created is False and fake.imported_deployments == []


# ── the whole upload ─────────────────────────────────────────────────────────

def _upload(tmp_path: Path, collection: Path, fake: FakeTrapper, **kw) -> list[dict]:
    with _with(fake):
        return list(up.upload_stream(
            CREDENTIALS, RECORD, collection, DEPLOYMENT_ID, tmp_path / "packages" / "DONA", wait_seconds=0.2, poll_seconds=0.05, **kw,
        ))


def test_the_upload_creates_the_location_and_the_deployment_then_packs_uploads_and_processes(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 3)
    fake = FakeTrapper()

    events = _upload(tmp_path, collection, fake)

    steps = [(e["step"], e["status"]) for e in events if e["type"] == "step"]
    assert steps == [
        ("connect", "running"), ("connect", "done"), ("classification", "running"), ("classification", "done"), ("uploader", "running"), ("uploader", "done"), ("location", "running"), ("location", "done"), ("deployment", "running"), ("deployment", "done"),
        ("package", "running"), ("package", "done"), ("upload", "running"), ("upload", "done"), ("process", "running"), ("process", "done"),
        ("wait", "running"), ("wait", "done"),
    ]
    assert events[-1] == {
        "type": "done", "mode": "upload", "collection": "R0003", "deployment_id": DEPLOYMENT_ID, "location_created": True, "deployment_created": True, "parts": 1,
        "images": 3, "bytes": events[-1]["bytes"], "files_deleted": True,
    }
    assert events[-1]["bytes"] > 0
    ready = next(e for e in events if e["type"] == "package_ready")
    assert ready == {"type": "package_ready", "images": 3, "parts": 1, "bytes": events[-1]["bytes"]}
    assert len(fake.imported_locations) == 1 and len(fake.imported_deployments) == 1  # both created, the location first (it has to exist)


def test_the_yaml_names_the_classification_project_and_not_the_research_project(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 2)
    fake = FakeTrapper(classification_projects=[SimpleNamespace(pk=7, name="A", is_active=True), SimpleNamespace(pk=8, name="B", is_active=True)])

    events = _upload(tmp_path, collection, fake, classification_project_pk=8)

    assert next(e for e in events if e.get("step") == "classification" and e["status"] == "done")["message"] == "The collection goes to the classification project B (#8)."
    assert json.loads((collection / DEPLOYMENT_ID / "upload.json").read_text())["classification_project_pk"] == 8
    # what went up is deleted afterwards, so the yaml itself is looked at when only generating
    _upload(tmp_path / "again", _imported(tmp_path / "again", 2), fake, mode="generate", classification_project_pk=8)
    yaml_file = next((tmp_path / "again" / "packages" / "DONA" / "R0003").glob("*.yaml"))
    assert yaml.safe_load(yaml_file.read_text(encoding="utf-8"))["collections"][0]["project_id"] == 8  # the research project is #2


def test_the_classification_project_has_to_be_chosen_when_there_are_several_and_must_exist():
    several = FakeTrapper(classification_projects=[SimpleNamespace(pk=7, name="A", is_active=True), SimpleNamespace(pk=8, name="B", is_active=True)])
    with _with(several):
        with pytest.raises(up.TrapperUploadError, match=r"several classification projects.*A \(#7\), B \(#8\)"):
            up.resolve_classification_project(CREDENTIALS, 2)
        assert up.resolve_classification_project(CREDENTIALS, 2, 7)["name"] == "A"
        with pytest.raises(up.TrapperUploadError, match="isn't one of the research project's"):
            up.resolve_classification_project(CREDENTIALS, 2, 99)
    with _with(FakeTrapper()):
        assert up.resolve_classification_project(CREDENTIALS, 2)["pk"] == 7  # the only one
    with _with(FakeTrapper(classification_projects=[])), pytest.raises(up.TrapperUploadError, match="has no classification project"):
        up.resolve_classification_project(CREDENTIALS, 2)


def test_the_package_declares_the_timezone_and_summer_time_of_the_location_it_goes_to(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 2)
    fake = FakeTrapper(locations=["DONA_0006_B"], deployments=[DEPLOYMENT_ID.lower()])
    fake.location_settings["DONA_0006_B"] = ("Europe/Madrid", False)  # the import's options say Europe/Madrid, ignoring summer time
    seen = []
    real = up.build_packages
    with patch.object(up, "build_packages", side_effect=lambda *a, **kw: seen.append((kw["timezone_name"], kw["ignore_dst"])) or real(*a, **kw)):
        events = _upload(tmp_path, collection, fake)

    assert seen == [("Europe/Madrid", False)]
    message = next(e for e in events if e.get("step") == "location" and e["status"] == "done")["message"]
    assert "Its timezone is Europe/Madrid and it does not ignore summer time — the package declares that" in message


def test_a_location_with_the_same_settings_says_nothing_about_them(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 2)
    fake = FakeTrapper(locations=["DONA_0006_B"])  # Europe/Madrid, ignoring summer time — what the import's options say too

    events = _upload(tmp_path, collection, fake)

    assert next(e for e in events if e.get("step") == "location" and e["status"] == "done")["message"] == "Location DONA_0006_B was already in Trapper."


def test_generating_with_an_account_also_uses_the_locations_settings(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 2)
    fake = FakeTrapper(locations=["DONA_0006_B"])
    fake.location_settings["DONA_0006_B"] = ("Europe/Madrid", False)

    events = _run(tmp_path, collection, fake, "generate")

    assert any("Its timezone is Europe/Madrid" in e.get("message", "") for e in events)
    assert fake.imported_locations == [] and fake.triggered == []  # read, not created


def test_the_package_names_the_deployment_as_trapper_has_it_not_as_it_is_kept_here(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 2)
    stored = DEPLOYMENT_ID.lower()  # Trapper matches ignoring case, but its yaml lookup does not
    assert stored != DEPLOYMENT_ID
    fake = FakeTrapper(locations=["DONA_0006_B"], deployments=[stored])
    seen = []
    real = up.build_packages
    with patch.object(up, "build_packages", side_effect=lambda *a, **kw: seen.append(kw["trapper_deployment_id"]) or real(*a, **kw)):
        events = _upload(tmp_path, collection, fake)

    assert seen == [stored]
    assert f"was already in Trapper, as {stored} — the package uses that id" in next(e for e in events if e.get("step") == "deployment" and e["status"] == "done")["message"]


def test_a_package_names_the_deployment_it_was_given_and_puts_its_files_in_that_folder(tmp_path: Path):
    collection = _imported(tmp_path, 2)
    log = json.loads((collection / DEPLOYMENT_ID / "preprocessing.json").read_text(encoding="utf-8"))

    [package] = up.build_packages(collection / DEPLOYMENT_ID, "R0003", DEPLOYMENT_ID, log, project_id=7, timezone_name="UTC", ignore_dst=True,
                                  output_dir=tmp_path / "out", trapper_deployment_id="r0003-dona_0006_b")

    assert yaml.safe_load(package["yaml"].read_text(encoding="utf-8"))["collections"][0]["deployments"][0]["deployment_id"] == "r0003-dona_0006_b"
    with zipfile.ZipFile(package["zip"]) as z:
        assert all(name.startswith("R0003/r0003-dona_0006_b/") for name in z.namelist())


def test_a_package_names_the_deployment_in_lower_case_even_when_trapper_was_not_asked(tmp_path: Path):
    collection = _imported(tmp_path, 2)
    log = json.loads((collection / DEPLOYMENT_ID / "preprocessing.json").read_text(encoding="utf-8"))

    [package] = up.build_packages(collection / DEPLOYMENT_ID, "R0003", DEPLOYMENT_ID, log, project_id=7, timezone_name="UTC", ignore_dst=True, output_dir=tmp_path / "out")

    assert DEPLOYMENT_ID != DEPLOYMENT_ID.lower()
    assert yaml.safe_load(package["yaml"].read_text(encoding="utf-8"))["collections"][0]["deployments"][0]["deployment_id"] == DEPLOYMENT_ID.lower()
    with zipfile.ZipFile(package["zip"]) as z:
        assert all(name.startswith(f"R0003/{DEPLOYMENT_ID.lower()}/") for name in z.namelist())


def test_trappers_refusal_to_process_the_package_is_said_in_words_not_as_a_dict(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 2)
    fake = FakeTrapper()

    def refuse(payload, raise_on_error=True):
        raise RuntimeError("{'data': {'message': 'The YAML collection definition file is invalid.', 'errors': 'Deployment X does not exist.', 'task_id': None}}")

    fake.collections.trigger_collection = refuse
    with pytest.raises(up.TrapperUploadError, match=r"refused to process the package: The YAML collection definition file is invalid\. Deployment X does not exist\.$"):
        _upload(tmp_path, collection, fake)


def test_the_zip_goes_up_first_then_its_yaml_and_trapper_is_told_to_process_them(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 2)
    fake = FakeTrapper()

    _upload(tmp_path, collection, fake)

    [zip_name, yaml_name] = [name for name, _ in fake_uploader.uploads]
    assert zip_name.endswith("_part001.zip") and yaml_name == zip_name[:-4] + ".yaml"
    assert [remote for _, remote in fake_uploader.uploads] == [f"/collections/{zip_name}", f"/collections/{yaml_name}"]
    assert fake.triggered == [{"yaml_file": yaml_name, "zip_file": zip_name, "remove_zip": True}]


def test_the_upload_reports_how_much_of_each_file_has_gone_up(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 2)

    events = _upload(tmp_path, collection, FakeTrapper())

    progress = [e for e in events if e["type"] == "upload_progress"]
    zips = [e for e in progress if e["file"].endswith(".zip")]
    assert [e["bytes"] for e in zips][-1] == zips[-1]["total"]  # ends at the whole file
    assert zips[0]["bytes"] < zips[0]["total"] and {e["file"].rsplit(".", 1)[1] for e in progress} == {"zip", "yaml"}


def test_what_is_already_in_trapper_is_not_created_again(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 2)
    fake = FakeTrapper(locations=["DONA_0006_B"], deployments=[DEPLOYMENT_ID])

    events = _upload(tmp_path, collection, fake)

    assert fake.imported_locations == [] and fake.imported_deployments == []
    assert [e["message"] for e in events if e["type"] == "step" and e["status"] == "done"][3:5] == [
        "Location DONA_0006_B was already in Trapper.", f"Deployment {DEPLOYMENT_ID} was already in Trapper.",
    ]
    assert events[-1]["location_created"] is False and events[-1]["deployment_created"] is False


def test_the_package_is_split_when_it_is_bigger_than_the_limit_and_each_part_is_uploaded_and_processed(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 3)
    fake = FakeTrapper()

    events = _upload(tmp_path, collection, fake, max_zip_bytes=1)

    assert events[-1]["parts"] == 3
    assert len(fake.triggered) == 3 and len(fake_uploader.uploads) == 6
    assert [t["zip_file"][-11:] for t in fake.triggered] == ["part001.zip", "part002.zip", "part003.zip"]


def test_once_uploaded_the_local_packages_are_removed_and_the_deployment_is_marked(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 2)

    _upload(tmp_path, collection, FakeTrapper())

    assert not list((tmp_path / "packages").rglob("*.zip")) and not list((tmp_path / "packages").rglob("*.yaml"))
    assert not list((tmp_path / "packages").rglob("*.uploadmeta.json"))
    log = json.loads((collection / DEPLOYMENT_ID / "upload.json").read_text())
    assert log["research_project_pk"] == 2 and log["collection"] == "R0003" and log["parts"] == 1
    assert log["location_created"] is True and datetime.fromisoformat(log["uploaded_at"])
    assert len(list((collection / DEPLOYMENT_ID).glob("*.JPEG"))) == 2  # the images themselves stay


def test_the_package_files_are_kept_when_they_are_not_to_be_deleted_and_the_deployments_csv_is_written(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 2)

    events = _upload(tmp_path, collection, FakeTrapper(), delete_after_upload=False)

    packages = tmp_path / "packages" / "DONA" / "R0003"
    assert len(list(packages.glob("*.zip"))) == 1 and len(list(packages.glob("*.yaml"))) == 1
    csv_file = packages / "R0003_deployments.csv"
    assert DEPLOYMENT_ID in csv_file.read_text(encoding="utf-8")
    done = events[-1]
    assert done["files_deleted"] is False and done["output_dir"] == str(packages)
    assert sorted(done["files"]) == sorted(p.name for p in packages.iterdir() if not p.name.endswith(".uploadmeta.json"))
    assert (collection / DEPLOYMENT_ID / "upload.json").is_file()  # it is marked as uploaded all the same


def test_deleting_the_files_takes_the_deployments_row_out_of_the_csv_and_leaves_the_others(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 2)
    csv_file = tmp_path / "packages" / "DONA" / "R0003" / "R0003_deployments.csv"
    csv_file.parent.mkdir(parents=True)
    csv_file.write_text("deploymentID,locationID,deploymentStart,deploymentEnd,cameraModel,longitude,latitude\nR0003-OTHER,OTHER,a,b,c,1,2\n", encoding="utf-8")

    _upload(tmp_path, collection, FakeTrapper(), delete_after_upload=True)

    assert csv_file.read_text(encoding="utf-8").splitlines()[1:] == ["R0003-OTHER,OTHER,a,b,c,1,2"]
    assert not list(csv_file.parent.glob("*.zip"))


def test_deleting_the_files_leaves_no_csv_when_it_had_no_other_row(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 2)

    _upload(tmp_path, collection, FakeTrapper(), delete_after_upload=True)

    assert not list((tmp_path / "packages").rglob("*.csv"))


def test_a_deployment_that_was_uploaded_shows_so_in_the_list(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 2)
    _upload(tmp_path, collection, FakeTrapper())

    [dep] = up.list_collections(tmp_path / "collections", "DONA")[0]["deployments"]

    assert dep["uploaded_at"] is not None


def test_a_failure_while_uploading_keeps_the_packages_for_another_try_and_does_not_mark_it(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 2)
    fake_uploader.fail_on = ".yaml"

    with pytest.raises(RuntimeError, match="connection reset"):
        _upload(tmp_path, collection, FakeTrapper())

    assert list((tmp_path / "packages").rglob("*.zip"))
    assert not (collection / DEPLOYMENT_ID / "upload.json").exists()
    fake_uploader.fail_on = None


def test_the_uploader_refusing_the_account_stops_the_upload_before_anything_is_created(tmp_path: Path, fake_uploader, monkeypatch: pytest.MonkeyPatch):
    import httpx

    collection = _imported(tmp_path, 2)
    request = httpx.Request("POST", "https://trapper.example.org/uploader/auth/login")
    response = httpx.Response(403, request=request, text="Forbidden")

    def refuse(credentials):
        raise httpx.HTTPStatusError("403", request=request, response=response)

    monkeypatch.setattr(up, "_uploader_login", refuse)
    fake = FakeTrapper()

    for mode in ("upload", "dry_run"):
        with pytest.raises(up.TrapperUploadError, match="uploader refused POST .*403 Forbidden"):
            _run(tmp_path, collection, fake, mode)

    assert fake.imported_locations == [] and fake.imported_deployments == [] and fake.triggered == []
    assert not (tmp_path / "packages").exists()  # nothing was packed either


def test_generating_does_not_log_in_to_the_uploader(tmp_path: Path, fake_uploader, uploader_login):
    collection = _imported(tmp_path, 2)

    _run(tmp_path, collection, FakeTrapper(), "generate")

    assert uploader_login == []


def test_a_refused_login_says_who_refused_it_and_what_it_answered(tmp_path: Path, fake_uploader):
    import httpx

    collection = _imported(tmp_path, 2)
    request = httpx.Request("POST", "https://trapper.example.org/uploader/auth/login")
    response = httpx.Response(403, request=request, headers={"server": "Coraza"}, text="Forbidden by\nthe WAF")
    fake_uploader.fail_on, fake_uploader.error = ".zip", httpx.HTTPStatusError("403", request=request, response=response)

    try:
        with pytest.raises(up.TrapperUploadError) as caught:
            _upload(tmp_path, collection, FakeTrapper())
    finally:
        fake_uploader.fail_on = fake_uploader.error = None

    message = str(caught.value)
    assert "POST https://trapper.example.org/uploader/auth/login: 403 Forbidden (server: Coraza) — Forbidden by the WAF." in message
    assert "The login was refused" in message


def test_when_the_collection_never_appears_in_trapper_it_says_so(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 2)

    with pytest.raises(up.TrapperUploadError, match="didn't appear in Trapper within 0 seconds"):
        _upload(tmp_path, collection, FakeTrapper(collections_appear=False))

    assert not (collection / DEPLOYMENT_ID / "upload.json").exists()


def test_a_deployment_that_was_not_preprocessed_is_refused_before_anything_happens_in_trapper(tmp_path: Path):
    collection = tmp_path / "collections" / "DONA" / "R0003"
    folder = collection / DEPLOYMENT_ID
    folder.mkdir(parents=True)
    (folder / "deployment.json").write_text(_deployment().model_dump_json(), encoding="utf-8")
    fake = FakeTrapper()

    with pytest.raises(up.TrapperUploadError, match="wasn't preprocessed"):
        _upload(tmp_path, collection, fake)

    assert fake.imported_locations == [] and fake.imported_deployments == []


def test_a_folder_that_is_not_a_deployment_is_refused(tmp_path: Path):
    collection = tmp_path / "R0003"
    (collection / DEPLOYMENT_ID).mkdir(parents=True)

    with pytest.raises(up.TrapperUploadError, match="no deployment.json"):
        _upload(tmp_path, collection, FakeTrapper())


def test_a_missing_research_project_stops_before_the_location_is_touched(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 2)
    fake = FakeTrapper(projects=[])

    with pytest.raises(up.TrapperUploadError, match="create it there first"):
        _upload(tmp_path, collection, fake)

    assert fake.imported_locations == []


def test_the_timezone_and_the_dst_rule_the_images_were_preprocessed_with_are_the_ones_used(tmp_path: Path, fake_uploader):
    source = tmp_path / "source"
    _jpeg(source / "a.JPG", "2024:07:01 10:00:00")
    collection = tmp_path / "collections" / "DONA" / "R0003"
    list(preprocessing_service.preprocess_stream(
        str(source), str(collection), "R0003", _deployment(), preprocessing_service.PreprocessOptions(metadata=False, timezone="Atlantic/Canary", ignore_dst=False),
    ))
    fake = FakeTrapper()

    _upload(tmp_path, collection, fake)

    assert (fake.imported_locations[0]["timezone"], fake.imported_locations[0]["ignore_dst"]) == ("Atlantic/Canary", False)
    assert fake.imported_deployments[0]["timezone"] == "Atlantic/Canary"


# ── dry run: what it would do, changing nothing ─────────────────────────────

def _run(tmp_path: Path, collection: Path, fake: FakeTrapper, mode: str, credentials=CREDENTIALS, **kw) -> list[dict]:
    with _with(fake):
        return list(up.upload_stream(credentials, RECORD, collection, DEPLOYMENT_ID, tmp_path / "packages" / "DONA", mode=mode, wait_seconds=0.2, poll_seconds=0.05, **kw))


def _tree(root: Path) -> set[str]:
    return {str(p.relative_to(root)) for p in root.rglob("*")} if root.exists() else set()


def test_a_dry_run_says_what_would_be_created_and_how_it_would_be_packed(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 3)

    events = _run(tmp_path, collection, FakeTrapper(), "dry_run")

    steps = {(e["step"], e["status"]): e["message"] for e in events if e["type"] == "step"}
    assert steps[("location", "done")] == "Location DONA_0006_B would be created."
    assert steps[("deployment", "done")] == f"Deployment {DEPLOYMENT_ID} would be created."
    assert steps[("package", "done")].startswith("Would pack 3 image(s) into 1 package(s) of about ")
    assert [e["step"] for e in events if e["type"] == "step" and e["status"] == "skipped"] == ["upload", "process", "wait"]
    assert events[-1] == {
        "type": "done", "mode": "dry_run", "collection": "R0003", "deployment_id": DEPLOYMENT_ID,
        "would_create_location": True, "would_create_deployment": True, "parts": 1,
    }


def test_the_steps_link_to_the_location_the_deployment_and_the_collection_in_trapper(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 3)
    fake = FakeTrapper(locations=["DONA_0006_B"], deployments=[DEPLOYMENT_ID])

    events = _run(tmp_path, collection, fake, "upload")

    urls = {e["step"]: e.get("url") for e in events if e["type"] == "step" and e["status"] == "done"}
    assert urls["location"] == "https://trapper.example.org/geomap/location/detail/1/"
    assert urls["deployment"] == "https://trapper.example.org/geomap/deployment/detail/1/"
    assert urls["wait"] == "https://trapper.example.org/storage/collection/detail/26/"
    assert urls["package"] is None and urls["classification"] is None  # only what exists in Trapper has a page


def test_a_dry_run_links_to_what_is_already_there_and_not_to_what_would_be_created(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 3)

    new = {e["step"]: e.get("url") for e in _run(tmp_path, collection, FakeTrapper(), "dry_run") if e["type"] == "step" and e["status"] == "done"}
    there = {e["step"]: e.get("url") for e in _run(tmp_path, collection, FakeTrapper(locations=["DONA_0006_B"], deployments=[DEPLOYMENT_ID]), "dry_run")
             if e["type"] == "step" and e["status"] == "done"}

    assert new["location"] is None and new["deployment"] is None
    assert there["location"].endswith("/geomap/location/detail/1/") and there["deployment"].endswith("/geomap/deployment/detail/1/")


def test_a_dry_run_changes_nothing_in_trapper_nor_on_disk(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 3)
    before = _tree(tmp_path)
    fake = FakeTrapper()

    _run(tmp_path, collection, fake, "dry_run")

    assert fake.imported_locations == [] and fake.imported_deployments == [] and fake.triggered == []
    assert fake_uploader.uploads == []
    assert _tree(tmp_path) == before  # not even the packages folder
    assert not (collection / DEPLOYMENT_ID / "upload.json").exists()


def test_a_dry_run_says_what_is_already_in_trapper(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 2)

    events = _run(tmp_path, collection, FakeTrapper(locations=["dona_0006_b"], deployments=[DEPLOYMENT_ID]), "dry_run")

    messages = [e["message"] for e in events if e["type"] == "step" and e["status"] == "done"]
    assert "Location DONA_0006_B is already in Trapper." in messages and f"Deployment {DEPLOYMENT_ID} is already in Trapper." in messages
    assert events[-1]["would_create_location"] is False and events[-1]["would_create_deployment"] is False


def test_a_dry_run_counts_the_packages_a_size_limit_would_make(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 4)

    events = _run(tmp_path, collection, FakeTrapper(), "dry_run", max_zip_bytes=1)

    assert events[-1]["parts"] == 4
    assert any("into 4 package(s)" in e.get("message", "") for e in events)


def test_a_dry_run_still_finds_the_problems_a_real_upload_would(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 2)
    next((collection / DEPLOYMENT_ID).glob("*.JPEG")).unlink()

    with pytest.raises(up.TrapperUploadError, match="missing"):
        _run(tmp_path, collection, FakeTrapper(), "dry_run")
    with pytest.raises(up.TrapperUploadError, match="create it there first"):
        _run(tmp_path, _imported(tmp_path / "other", 2), FakeTrapper(projects=[]), "dry_run")


def test_a_dry_run_needs_the_trapper_account_to_look_at_what_is_there(tmp_path: Path):
    with pytest.raises(up.TrapperUploadError, match="isn't set up"):
        _run(tmp_path, _imported(tmp_path, 2), FakeTrapper(), "dry_run", credentials=None)


# ── only generating the files ───────────────────────────────────────────────

def test_generating_writes_the_zip_the_yaml_and_the_deployments_csv_and_leaves_them(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 3)
    fake = FakeTrapper()

    events = _run(tmp_path, collection, fake, "generate")

    out = tmp_path / "packages" / "DONA" / "R0003"
    assert sorted(p.suffix for p in out.iterdir()) == [".csv", ".yaml", ".zip"]
    assert events[-1]["type"] == "done" and events[-1]["mode"] == "generate"
    assert events[-1]["output_dir"] == str(out) and events[-1]["parts"] == 1
    assert sorted(events[-1]["files"]) == sorted(p.name for p in out.iterdir())
    assert "R0003_deployments.csv" in events[-1]["files"]
    assert events[-1]["images"] == 3
    assert events[-1]["file_sizes"] == {p.name: p.stat().st_size for p in out.iterdir()}
    progress = [e for e in events if e["type"] == "pack_progress"]
    assert progress and progress[-1] == {"type": "pack_progress", "index": 3, "total": 3}
    # nothing was sent, created or recorded as uploaded
    assert fake.imported_locations == [] and fake.imported_deployments == [] and fake.triggered == []
    assert fake_uploader.uploads == []
    assert not (collection / DEPLOYMENT_ID / "upload.json").exists()


def test_generating_does_not_touch_trapper_when_the_research_project_pk_is_known(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 2)

    events = _run(tmp_path, collection, FakeTrapper(projects=[]), "generate", credentials=None, classification_project_pk=9)  # no account, and Trapper has no projects either

    assert events[-1]["type"] == "done"
    assert [e["step"] for e in events if e["type"] == "step"] == ["classification", "check", "check", "package", "package", "csv", "csv"]  # no connect, location or deployment
    yaml_file = next((tmp_path / "packages" / "DONA" / "R0003").glob("*.yaml"))
    assert yaml.safe_load(yaml_file.read_text(encoding="utf-8"))["collections"][0]["project_id"] == 9  # the classification project's pk, not the research project's


def test_generating_looks_the_pk_up_in_trapper_when_it_is_not_known_and_there_is_an_account(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 2)
    fake = FakeTrapper(projects=[SimpleNamespace(pk=77, name="Doñana", acronym="DONA")])

    with _with(fake):
        events = list(up.upload_stream(CREDENTIALS, {**RECORD, "trapper_pk": None}, collection, DEPLOYMENT_ID, tmp_path / "packages" / "DONA", mode="generate"))

    assert [e["step"] for e in events if e["type"] == "step"][:2] == ["connect", "connect"]
    yaml_file = next((tmp_path / "packages" / "DONA" / "R0003").glob("*.yaml"))
    assert yaml.safe_load(yaml_file.read_text(encoding="utf-8"))["collections"][0]["project_id"] == 7  # the classification project of research project #77, not #77 itself


def test_generating_without_an_account_needs_the_classification_project_chosen(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 2)

    with pytest.raises(up.TrapperUploadError, match="classification project's pk"):
        _run(tmp_path, collection, FakeTrapper(), "generate", credentials=None)


def test_generating_without_a_known_pk_nor_an_account_says_what_to_do(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 2)

    with pytest.raises(up.TrapperUploadError, match="research project's pk in Trapper"):
        list(up.upload_stream(None, {**RECORD, "trapper_pk": None}, collection, DEPLOYMENT_ID, tmp_path / "packages" / "DONA", mode="generate"))


def test_generating_splits_the_zips_like_an_upload_would(tmp_path: Path, fake_uploader):
    collection = _imported(tmp_path, 3)

    events = _run(tmp_path, collection, FakeTrapper(), "generate", max_zip_bytes=1)

    out = tmp_path / "packages" / "DONA" / "R0003"
    assert events[-1]["parts"] == 3 and len(list(out.glob("*.zip"))) == 3 and len(list(out.glob("*.yaml"))) == 3


def test_an_unknown_mode_is_refused(tmp_path: Path):
    with pytest.raises(up.TrapperUploadError, match="Unknown mode"):
        _run(tmp_path, _imported(tmp_path, 1), FakeTrapper(), "send_it")


# ── the collection's deployments csv ────────────────────────────────────────

def _csv_rows(path: Path) -> list[dict]:
    import csv

    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def test_the_csv_has_wildintel_tools_columns_in_its_order_and_the_coordinates_at_the_end(tmp_path: Path):
    collection = _imported(tmp_path, 3)
    log = json.loads((collection / DEPLOYMENT_ID / "preprocessing.json").read_text())

    up.upsert_deployments_csv(tmp_path / "R0003_deployments.csv", _deployment(camera_model="RECONYX HF2"), log)

    header = (tmp_path / "R0003_deployments.csv").read_text(encoding="utf-8").splitlines()[0]
    assert header == "deploymentID,locationID,deploymentStart,deploymentEnd,cameraModel,longitude,latitude"
    [row] = _csv_rows(tmp_path / "R0003_deployments.csv")
    assert row == {
        "deploymentID": DEPLOYMENT_ID, "locationID": "DONA_0006_B",
        "deploymentStart": "2024-07-01T09:00:00+0000", "deploymentEnd": "2024-07-03T09:00:00+0000",  # the first and the last image, in UTC
        "cameraModel": "RECONYX HF2", "longitude": "-6.5", "latitude": "37.0",
    }


def test_the_csv_takes_the_camera_from_the_images_when_the_deployment_does_not_declare_it(tmp_path: Path):
    collection = _imported(tmp_path, 2)
    log = json.loads((collection / DEPLOYMENT_ID / "preprocessing.json").read_text())
    log["images"][0]["camera"] = "Bushnell Trophy Cam"

    up.upsert_deployments_csv(tmp_path / "R0003_deployments.csv", _deployment(), log)

    assert _csv_rows(tmp_path / "R0003_deployments.csv")[0]["cameraModel"] == "Bushnell Trophy Cam"


def test_the_csv_keeps_the_other_deployments_of_the_collection_sorted_and_replaces_its_own(tmp_path: Path):
    log = {"images": [{"name": "a", "date": "2024-07-01T09:00:00+00:00"}, {"name": "b", "date": "2024-07-05T09:00:00+00:00"}]}
    path = tmp_path / "R0003_deployments.csv"

    first = up.upsert_deployments_csv(path, _deployment(deployment_id="R0003-DONA_0009", location_id="DONA_0009"), log)
    second = up.upsert_deployments_csv(path, _deployment(deployment_id="R0003-DONA_0001", location_id="DONA_0001"), log)
    third = up.upsert_deployments_csv(path, _deployment(deployment_id="R0003-DONA_0009", location_id="DONA_0009", longitude=-6.4), log)

    assert (first["action"], second["action"], third["action"]) == ("added", "added", "updated")
    assert third["rows"] == 2
    rows = _csv_rows(path)
    assert [r["deploymentID"] for r in rows] == ["R0003-DONA_0001", "R0003-DONA_0009"]  # sorted, like wildintel-tools
    assert rows[1]["longitude"] == "-6.4"


def test_a_csv_wildintel_tools_wrote_is_kept_and_extended(tmp_path: Path):
    path = tmp_path / "R0003_deployments.csv"
    path.write_text(
        "deploymentID,locationID,deploymentStart,deploymentEnd,cameraModel\nR0003-DONA_0001,DONA_0001,2024-06-01T00:00:00+0000,2024-06-30T00:00:00+0000,Reconyx\n", encoding="utf-8",
    )

    up.upsert_deployments_csv(path, _deployment(), {"images": [{"name": "a", "date": "2024-07-01T09:00:00+00:00"}]})

    rows = _csv_rows(path)
    assert [r["deploymentID"] for r in rows] == ["R0003-DONA_0001", DEPLOYMENT_ID]
    assert rows[0]["cameraModel"] == "Reconyx" and rows[0]["longitude"] == ""  # theirs, as it was


# ── checking the access ──────────────────────────────────────────────────────

def _refusing_login(monkeypatch: pytest.MonkeyPatch, status: int | None) -> None:
    import httpx

    def login(credentials):
        if status is not None:
            request = httpx.Request("POST", "https://trapper.example.org/uploader/auth/login")
            raise httpx.HTTPStatusError(str(status), request=request, response=httpx.Response(status, request=request, text="nope"))

    monkeypatch.setattr(up, "_uploader_login", login)


def test_checking_the_access_reports_the_project_the_locations_and_the_uploader(monkeypatch: pytest.MonkeyPatch):
    _refusing_login(monkeypatch, None)
    fake = FakeTrapper(locations=["DONA_0001"])

    with _with(fake):
        checks = up.check_access(CREDENTIALS, {"acronym": "DONA", "trapper_pk": 2}, ["DONA_0001", "dona_0002", ""])

    assert [c["check"] for c in checks] == ["research_project", "classification_project", "location", "uploader"]
    assert all(c["ok"] for c in checks)
    assert "Doñana classification (#7)" in checks[1]["message"]
    assert "Already in Trapper: DONA_0001" in checks[2]["message"] and "Would be created: dona_0002" in checks[2]["message"]
    assert fake.imported_locations == [] and fake.imported_deployments == []  # nothing was created


def test_each_access_check_fails_on_its_own(monkeypatch: pytest.MonkeyPatch):
    _refusing_login(monkeypatch, 403)

    with _with(FakeTrapper(locations=["DONA_0001"])):
        checks = up.check_access(CREDENTIALS, {"acronym": "DONA", "trapper_pk": 2})
    assert [c["ok"] for c in checks] == [True, True, True, False]
    assert "403 Forbidden" in checks[3]["message"] and "The login was refused" in checks[3]["message"]

    with _with(FakeTrapper(projects=[])):
        checks = up.check_access(CREDENTIALS, {"acronym": "NOPE", "trapper_pk": None})
    assert [c["ok"] for c in checks] == [False, False, False, False]
    assert "create it there first" in checks[0]["message"] and "Not checked" in checks[1]["message"]

    with _with(FakeTrapper(classification_projects=[])):
        checks = up.check_access(CREDENTIALS, {"acronym": "DONA", "trapper_pk": 2})
    assert [c["ok"] for c in checks] == [True, False, True, False]
    assert "has no classification project" in checks[1]["message"]


def test_checking_the_selection_says_whether_the_collection_is_there_or_would_be_created():
    with _with(FakeTrapper(collections_appear=True)):
        there = up.check_selection(CREDENTIALS, {"acronym": "DONA", "trapper_pk": 2}, "R0003")
    with _with(FakeTrapper(collections_appear=False)):
        new = up.check_selection(CREDENTIALS, {"acronym": "DONA", "trapper_pk": 2}, "R0003")
    with _with(FakeTrapper(projects=[])):
        nothing = up.check_selection(CREDENTIALS, {"acronym": "NOPE", "trapper_pk": None}, "R0003")

    assert [(c["check"], c["ok"]) for c in there] == [("research_project", True), ("collection", True)]
    assert "R0003 (#26)" in there[1]["message"] and "already in Trapper" in there[1]["message"]
    assert "creates it" in new[1]["message"] and new[1]["ok"]
    assert there[1]["found"] is True and new[1]["found"] is False
    assert [c["ok"] for c in nothing] == [False, False] and "Not checked" in nothing[1]["message"]


# ── the uploader's login ─────────────────────────────────────────────────────

def _login(handler) -> httpx.Request | None:
    """Runs the uploader's login against a fake Trapper answering with `handler`; returns what the page was left with."""
    import asyncio

    uploader = up._uploader_class()(client=SimpleNamespace(user_name="alice", user_password="secret"))

    async def run():
        async with httpx.AsyncClient(base_url="https://trapper.example.org/", transport=httpx.MockTransport(handler)) as http:
            await uploader._login(http)
            return next((c.value for c in http.cookies.jar if c.name == "sessionid"), None)

    return asyncio.run(run())


def test_the_uploader_login_takes_the_session_from_results():
    assert _login(lambda request: httpx.Response(200, json={"results": [{"sessionid": "abc"}]})) == "abc"


def test_the_uploader_login_takes_the_session_from_the_top_of_the_answer_or_from_its_cookie():
    assert _login(lambda request: httpx.Response(200, json={"sessionid": "top"})) == "top"
    assert _login(lambda request: httpx.Response(200, json={"detail": "ok"}, headers={"set-cookie": "sessionid=cookie; Path=/"})) == "cookie"


def test_the_uploader_login_says_what_trapper_answered_when_it_gives_no_session():
    with pytest.raises(up.TrapperUploadError, match=r'gave no session.*200: \{"status":"ok"\}'):
        _login(lambda request: httpx.Response(200, json={"status": "ok"}))
    with pytest.raises(up.TrapperUploadError, match="gave no session.*Welcome"):
        _login(lambda request: httpx.Response(200, text="<html>Welcome</html>"))


def test_a_location_of_someone_else_is_explained_not_refused():
    theirs = {"location_id": "dona-001", "owner": "bob@x.org", "can_manage": False}
    problem = up.location_access_problem(theirs, "alice@x.org")
    assert problem and "bob@x.org" in problem and "dona-001" in problem


def _someone_elses_location(monkeypatch: pytest.MonkeyPatch):
    row = {"pk": 1, "location_id": "DONA_0006_B", "name": None, "timezone": "Europe/Madrid", "ignore_dst": True, "owner": "bob@x.org", "can_manage": False}
    monkeypatch.setattr(up.trapper_service, "list_locations", lambda *a, **k: [row])


def test_a_dry_run_warns_that_the_location_may_not_be_usable_but_goes_on(tmp_path: Path, fake_uploader, monkeypatch: pytest.MonkeyPatch):
    collection = _imported(tmp_path, 3)
    _someone_elses_location(monkeypatch)

    events = _run(tmp_path, collection, FakeTrapper(locations=["DONA_0006_B"]), "dry_run")

    message = next(e["message"] for e in events if e["type"] == "step" and e["step"] == "deployment" and e["status"] == "done")
    assert "would be created" in message and "Warning" in message and "bob@x.org" in message
    assert events[-1]["type"] == "done"


def test_when_trapper_refuses_the_deployment_the_error_says_who_owns_the_location(tmp_path: Path, fake_uploader, monkeypatch: pytest.MonkeyPatch):
    collection = _imported(tmp_path, 3)
    _someone_elses_location(monkeypatch)
    fake = FakeTrapper(locations=["DONA_0006_B"])

    def refuse(**kw):
        raise RuntimeError("The object does not exist in the database.")

    fake.deployments.import_deployments = refuse

    with pytest.raises(up.TrapperUploadError, match="does not exist in the database.*bob@x.org"):
        _run(tmp_path, collection, fake, "upload")


def test_the_owner_a_manager_or_an_unknown_location_is_not_a_problem():
    assert up.location_access_problem({"location_id": "a", "owner": "Alice@x.org", "can_manage": False}, "alice@x.org") is None
    assert up.location_access_problem({"location_id": "a", "owner": "bob", "can_manage": True}, "alice") is None
    assert up.location_access_problem({"location_id": "a", "owner": "bob", "can_manage": None}, "alice") is None
    assert up.location_access_problem(None, "alice") is None
