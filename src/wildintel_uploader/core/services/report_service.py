"""The reports: a record of what a validation, a postvalidation or a preprocessing found and did — what the
screen shows of it and what can be downloaded to look at it in detail afterwards.

A report is a JSON file in config.reports_dir():

    {"id", "kind": "validation" | "postvalidation" | "preprocessing" | "repair", "title", "created_at", "source_dir",
     "deployment_id", "parameters", "checked",
     "checks": {check: {"label", "scope": "images" | "deployment", "ok", "failed"}},
     "totals": {"entries", "ok", "failed", "images_with_issues"},
     "entries": [{"identifier", "check", "status": "ok" | "failed", "message", "tag"?, "taken"?}]}

A failed image's entry also has a short "tag" (what is wrong, in a few words, for a badge) and "taken", its capture date.
An entry is one check of one thing: an image (identified by its path in the source folder) or the whole
deployment ("(deployment)"). A check that looks at every image has an entry for each, the ones that
passed too — so the report says what was checked, not only what failed. The same file gives the CSV."""
from __future__ import annotations

import csv
import io
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

from wildintel_uploader.core import config, parallel
from wildintel_uploader.core.services import deployment_import_service as dis

KINDS = ("validation", "postvalidation", "preprocessing", "repair")
DEPLOYMENT = "(deployment)"
CSV_COLUMNS = ("identifier", "check", "status", "message")

_ID = re.compile(r"^\d{8}-\d{6}_(validation|postvalidation|preprocessing|repair)_[0-9A-Za-z_.-]*$")

LABELS = {
    "corrupted": "Corrupted images", "sequence": "Shooting order vs. filename sequence", "structure": "Folder structure",
    "camera": "Camera", "exif": "Required EXIF fields", "duplicates": "Duplicate images",
    "deployment_id": "Deployment id format", "collection_prefix": "Deployment id starts with its collection",
    "collection_name": "Collection name", "location": "The id's location is the one chosen", "time_range": "Image dates fit the deployment",
    "image_count": "Number of images", "sequence_count": "Number of sequences", "sequence_length": "Length of the sequences",
    "preprocessing": "Prepare images",
    "metadata_files": "Metadata files", "camera_match": "The camera is the deployment's",
    "preprocessing_names": "Names of the preprocessed images", "preprocessing_size": "Size of the preprocessed images",
    "preprocessing_metadata": "XMP metadata of the images", "preprocessing_hash": "Images unchanged since they were preprocessed",
}


class ReportError(ValueError):
    """A report that isn't there, or isn't a report's id — reported to the user."""


# ── building ─────────────────────────────────────────────────────────────────

class _Builder:
    def __init__(self, kind: str, title: str, *, source_dir: str | None, deployment_id: str | None, parameters: dict) -> None:
        self.kind, self.title, self.source_dir, self.deployment_id, self.parameters = kind, title, source_dir, deployment_id, parameters
        self.entries: list[dict] = []
        self.scopes: dict[str, str] = {}
        self.checked = 0

    def add(self, identifier: str, check: str, ok: bool, message: str, *, scope: str = "images", tag: str | None = None) -> None:
        self.scopes.setdefault(check, scope)
        entry = {"identifier": identifier, "check": check, "status": "ok" if ok else "failed", "message": message}
        if not ok and tag:
            entry["tag"] = tag
        self.entries.append(entry)

    def deployment(self, check: str, ok: bool, message: str) -> None:
        self.add(DEPLOYMENT, check, ok, message, scope="deployment")

    def per_image(self, check: str, images: Iterable[str], problems: dict[str, str], ok_message: str, *, tags: dict[str, str] | None = None, tag: str | None = None) -> None:
        """Every image has an entry for the check: its problem, or that it passed. A failed one gets the short tag
        `tags` gives it, or `tag`."""
        self.scopes.setdefault(check, "images")
        for name in images:
            problem = problems.get(name)
            self.add(name, check, problem is None, problem if problem is not None else ok_message, tag=(tags or {}).get(name, tag))

    def build(self) -> dict:
        checks: dict[str, dict] = {}
        for entry in self.entries:
            info = checks.setdefault(entry["check"], {"label": LABELS.get(entry["check"], entry["check"]), "scope": self.scopes[entry["check"]], "ok": 0, "failed": 0})
            info["ok" if entry["status"] == "ok" else "failed"] += 1
        failed = sum(1 for e in self.entries if e["status"] == "failed")
        self._date_the_failures()
        with_issues = {e["identifier"] for e in self.entries if e["status"] == "failed" and checks[e["check"]]["scope"] == "images"}
        return {
            "kind": self.kind, "title": self.title, "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source_dir": self.source_dir, "deployment_id": self.deployment_id, "parameters": self.parameters, "checked": self.checked,
            "checks": checks, "totals": {"entries": len(self.entries), "ok": len(self.entries) - failed, "failed": failed, "images_with_issues": len(with_issues)},
            "entries": self.entries,
        }

    def _date_the_failures(self) -> None:
        """Gives each failed image's entries its capture date, as its EXIF says — the images that are fine aren't opened."""
        if self.source_dir is None:
            return
        root = Path(self.source_dir)
        names = sorted({e["identifier"] for e in self.entries if e["status"] == "failed" and e["identifier"] != DEPLOYMENT})
        taken = dict(zip(names, parallel.pmap(lambda n: dis._image_datetime(root / n), names)))
        for e in self.entries:
            when = taken.get(e["identifier"]) if e["status"] == "failed" else None
            if when is not None:
                e["taken"] = when.isoformat()


def images_of(folder: Path) -> list[str]:
    """The images of a folder, as their paths in it, in natural file-name order."""
    return [str(p.relative_to(folder)) for p in sorted(
        (p for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in dis.IMAGE_EXTENSIONS), key=lambda p: dis._natural_key(p.relative_to(folder)),
    )]


def validation_report(found: dict, source: Path, checks: Iterable[str] | None = None) -> dict:
    """The report of validate_images(source, checks, detail=True)'s result."""
    ran = set(checks) if checks is not None else set(dis.IMAGE_CHECKS)
    images = images_of(source)
    b = _Builder("validation", f"Validation of {source.name}", source_dir=str(source), deployment_id=None, parameters={"checks": sorted(ran)})
    b.checked = found.get("checked_count", len(images))

    if "corrupted" in ran:
        b.per_image("corrupted", images, {i["path"]: i["error"] for i in found.get("corrupted", [])}, "can be read", tag="Corrupted")
    if "sequence" in ran:
        b.per_image("sequence", images, {i["path_b"]: f"dated before {i['path_a']}, which has a lower number" for i in found.get("sequence_issues", [])}, "in order", tag="Out of order")
    if "exif" in ran:
        missing: dict[str, list[str]] = {}
        for field, info in found.get("exif_missing", {}).items():
            for name in info.get("files", []):
                missing.setdefault(name, []).append(field.replace("_", " "))
        b.per_image("exif", images, {name: "no " + ", no ".join(fields) for name, fields in missing.items()}, "has its capture date and camera model",
                    tags={name: ", ".join(f"No {field}" if i == 0 else f"no {field}" for i, field in enumerate(fields)) for name, fields in missing.items()})
    if "duplicates" in ran:
        problems = {name: "same content as " + ", ".join(f for f in g["files"] if f != name) for g in found.get("duplicates", []) for name in g["files"]}
        b.per_image("duplicates", images, problems, "no other image has the same content", tag="Duplicate")
    if "structure" in ran:
        folders = found.get("subdirectories", [])
        b.deployment("structure", not folders, "all the images are in one folder" if not folders else f"images in subfolders: {', '.join(folders)}")
    if "camera" in ran:
        cameras = found.get("cameras", [])
        names = "; ".join(f"{c['model'] or '?'} {c['camera_id'] or '?'} ({c['count']})" for c in cameras)
        without = found.get("cameras_without_info", 0)
        b.deployment("camera", len(cameras) <= 1 and not without, f"{len(cameras)} camera(s): {names or 'none'}" + (f"; {without} image(s) without camera information" if without else ""))
    return b.build()


def postvalidation_report(result: dict, deployment_id: str, source: Path, parameters: dict | None = None) -> dict:
    """The report of validate_deployment_consistency's result — with the statistical checks' added to it, as the
    endpoint does."""
    images = images_of(source)
    b = _Builder("postvalidation", f"Postvalidation of {deployment_id}", source_dir=str(source), deployment_id=deployment_id, parameters=parameters or {})
    b.checked = result.get("checked_count", len(images))
    for check in ("deployment_id", "collection_prefix", "collection_name", "location", "image_count", "sequence_count", "sequence_length"):
        item = result.get(check)
        if isinstance(item, dict):
            b.deployment(check, bool(item.get("ok")) or bool(item.get("skipped")), item.get("message", ""))
    if "out_of_range" in result:
        problems = {i["path"]: f"{i['date']} is out of the range for the {i.get('rule', '')} image ({i.get('expected', '')})" for i in result["out_of_range"]}
        b.per_image("time_range", images, problems, "its date fits the deployment", tag="Out of range")
    if "camera_mismatches" in result:
        problems = {i["path"]: f"camera {i['detected']} is not the deployment's" for i in result["camera_mismatches"]}
        b.per_image("camera", images, problems, "its camera is the deployment's", tag="Other camera")
    return b.build()


def repair_report(deployment_id: str, dest: Path, files: list[tuple[str, bool, str]], seal: dict | None, preprocessing: dict[str, dict[str, str]]) -> dict:
    """What a repair did and found: which metadata files it wrote (files: (name, ok, what)), what the folder's own images
    passed of the validation and the postvalidation — as the seal it wrote says — and of the preprocessing
    (preprocessing: check -> {image: problem}; an image that isn't in a check's dict passed it)."""
    images = images_of(dest)
    b = _Builder("repair", f"Repair of {deployment_id}", source_dir=str(dest), deployment_id=deployment_id, parameters={})
    b.checked = len(images)
    for name, ok, message in files:
        b.add(name, "metadata_files", ok, message, scope="deployment", tag="Not rebuilt")
    if seal is not None:
        entries = seal.get("images", [])
        by_name = {e["name"]: e for e in entries}
        for check in sorted({c for e in entries for c in e.get("validations", {})}):
            b.per_image(check, images, {n: e["validations"][check] for n, e in by_name.items() if e["validations"].get(check, "ok") != "ok"}, "passed",
                        tag={"corrupted": "Corrupted", "sequence": "Out of order", "exif": "Missing EXIF", "duplicates": "Duplicate"}.get(check, check))
        for check in sorted({c for e in entries for c in e.get("postvalidations", {})}):
            key = "camera_match" if check == "camera" else check
            b.per_image(key, images, {n: e["postvalidations"][check] for n, e in by_name.items() if e["postvalidations"].get(check, "ok") != "ok"}, "passed",
                        tag={"time_range": "Out of range", "camera": "Other camera"}.get(check, check))
        for group in ("validations", "postvalidations"):
            for check, result in seal["deployment"].get(group, {}).items():
                if isinstance(result, dict):
                    b.deployment(check, bool(result.get("ok")) or bool(result.get("skipped")), result.get("message", ""))
    for check, problems in preprocessing.items():
        b.per_image(check, images, problems, "passed", tag="Not as preprocessed")
    return b.build()


def preprocessing_report(records: list[dict], skipped: list[dict], deployment_id: str, source: Path, dest: Path, options: dict) -> dict:
    """What preprocessing did to each image — and the ones it couldn't process."""
    b = _Builder("preprocessing", f"Images prepared for {deployment_id}", source_dir=str(source), deployment_id=deployment_id, parameters={**options, "destination": str(dest)})
    b.checked = len(records) + len(skipped)
    for r in records:
        steps = [f"{r['original']} → {r['name']}" if r["name"] != r["original"] else r["original"], f"date {r['date']} ({r['date_source']})"]
        if r.get("resized"):
            steps.append("resized")
        b.add(r["original"], "preprocessing", True, "; ".join(steps))
    for item in skipped:
        b.add(item["name"], "preprocessing", False, item["detail"])
    b.entries.sort(key=lambda e: dis._natural_key(Path(e["identifier"])))
    return b.build()


# ── keeping ──────────────────────────────────────────────────────────────────

def _slug(text: str) -> str:
    return re.sub(r"[^0-9A-Za-z_.-]+", "-", text).strip("-")[:60] or "report"


def save(report: dict, root: Path | None = None) -> str:
    """Writes the report to the reports folder and returns its id — also set in the report."""
    root = root or config.reports_dir()
    root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    name = _slug(report.get("deployment_id") or Path(report.get("source_dir") or "").name or report["kind"])
    report_id, n = f"{stamp}_{report['kind']}_{name}", 1
    while (root / f"{report_id}.json").exists():
        n += 1
        report_id = f"{stamp}_{report['kind']}_{name}-{n}"
    report["id"] = report_id
    tmp = root / f"{report_id}.json.tmp"
    tmp.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(root / f"{report_id}.json")
    return report_id


def _path(report_id: str, root: Path | None) -> Path:
    if not _ID.match(report_id):
        raise ReportError(f"'{report_id}' isn't a report.")
    path = (root or config.reports_dir()) / f"{report_id}.json"
    if not path.is_file():
        raise ReportError(f"There is no report '{report_id}'.")
    return path


def read(report_id: str, root: Path | None = None) -> dict:
    """Raises:
        ReportError: it isn't a report's id, or there is no such report.
    """
    return json.loads(_path(report_id, root).read_text(encoding="utf-8"))


def list_reports(root: Path | None = None) -> list[dict]:
    """What each report says of itself, newest first — without its entries."""
    root = root or config.reports_dir()
    out = []
    for path in sorted(root.glob("*.json"), reverse=True) if root.is_dir() else []:
        try:
            report = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        out.append({k: report.get(k) for k in ("id", "kind", "title", "created_at", "source_dir", "deployment_id", "checked", "totals")})
    return out


def delete(report_id: str, root: Path | None = None) -> None:
    _path(report_id, root).unlink()


def delete_older_than(days: int, root: Path | None = None) -> int:
    """Deletes the reports older than `days` days, and says how many."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    gone = 0
    for item in list_reports(root):
        try:
            if datetime.fromisoformat(item["created_at"]) < cutoff:
                delete(item["id"], root)
                gone += 1
        except (TypeError, ValueError, ReportError):
            continue
    return gone


def to_csv(report: dict) -> str:
    """One row per entry — an image or the deployment, a check, whether it passed and what it says."""
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(CSV_COLUMNS)
    for entry in report["entries"]:
        writer.writerow([entry[c] for c in CSV_COLUMNS])
    return out.getvalue()


# ── the images of a report ───────────────────────────────────────────────────

THUMBNAIL = 320
LARGE = 1280


def image_jpeg(report_id: str, relative: str, size: int = THUMBNAIL, root: Path | None = None) -> bytes:
    """An image a report names, as a JPEG that fits in size × size — to show it without sending the original.
    Only the images the report lists are served, so this is no way to read other files.

    Raises:
        ReportError: there is no such report, it doesn't list the image, or the image can't be read.
    """
    from PIL import Image, ImageOps

    report = read(report_id, root)
    if not report.get("source_dir") or relative not in {e["identifier"] for e in report["entries"]}:
        raise ReportError(f"The report doesn't have the image '{relative}'.")
    folder = Path(report["source_dir"]).resolve()
    path = (folder / relative).resolve()
    if folder not in path.parents or not path.is_file():
        raise ReportError(f"The report doesn't have the image '{relative}'.")
    try:
        with Image.open(path) as img:
            img = ImageOps.exif_transpose(img)
            img.thumbnail((size, size))
            out = io.BytesIO()
            img.convert("RGB").save(out, "JPEG", quality=75)
            return out.getvalue()
    except Exception as exc:
        raise ReportError(f"'{relative}' can't be shown: {exc}") from exc
