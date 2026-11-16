"""Statistical postvalidation: is this revision of a location like the ones before it?

A location is visited again and again — R0001-DONA_0006_B, R0002-DONA_0006_B… — so
what the previous revisions of it looked like says what this one should: about as
many photos, about as many sequences, sequences about as long. A revision that
departs a lot (a camera that fired nonstop, one that died early) is worth a look
before it's uploaded.

What the previous revisions looked like is read from the collections folder: the
deployments of the same location in the same research project, with a lower
revision number. Their image dates come from the "images.json" kept beside them
(the camera's time of each image, whether it was imported here or synced from Trapper),
or, for one that has none, from the images' EXIF.

Both "what is a sequence" and "what is similar" are parameters:
  - a sequence starts when the gap to the previous image is at least
    `sequence_gap_seconds`;
  - a value is similar when it is within `tolerance_percent` of the reference —
    the median, the mean or the last of the previous revisions — or, with the
    "range" method, within the range they span, each end widened by the tolerance."""
from __future__ import annotations

import collections
import json
import logging
import re
import statistics
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

from wildintel_uploader.core.services import deployment_import_service as dis, local_folder_service

logger = logging.getLogger(__name__)

Method = Literal["median", "mean", "last", "range"]
METHODS: tuple[str, ...] = ("median", "mean", "last", "range")

_DEPLOYMENT_RE = re.compile(r"^R(\d{4})-(.+)$")
_COLLECTION_RE = re.compile(r"^R\d{4}(_.+)?$")


@dataclass(frozen=True)
class DeploymentTimes:
    """One deployment's images: how many there are, and when each dated one was taken."""

    image_count: int
    times: list[float]  # seconds since the epoch, sorted

    def sequences(self, gap_seconds: float) -> list[int]:
        """The images in each sequence — a new one starts when the gap to the previous image is at least gap_seconds."""
        return sequence_lengths(self.times, gap_seconds)


@dataclass(frozen=True)
class PreviousRevision:
    revision: int
    deployment_id: str
    path: Path


def sequence_lengths(times: list[float], gap_seconds: float) -> list[int]:
    """The number of images in each sequence of the (sorted) times. A gap of exactly
    gap_seconds starts a new one: "at least X seconds"."""
    lengths: list[int] = []
    previous: float | None = None
    for t in sorted(times):
        if previous is None or t - previous >= gap_seconds:
            lengths.append(1)
        else:
            lengths[-1] += 1
        previous = t
    return lengths


def _timestamp(iso: str) -> float | None:
    try:
        parsed = datetime.fromisoformat(iso)
    except (TypeError, ValueError):
        return None
    # Only the gaps between one deployment's images matter, so a naive time can stand as UTC.
    return (parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)).timestamp()


def times_of_folder(source_dir: Path) -> DeploymentTimes:
    """The images of a folder and when each was taken, from their EXIF."""
    images = [p for p in source_dir.rglob("*") if p.is_file() and p.suffix.lower() in dis.IMAGE_EXTENSIONS]
    stamps = []
    for path in images:
        taken = dis._image_datetime(path)
        if taken is not None:
            stamps.append(taken.replace(tzinfo=timezone.utc).timestamp())
    return DeploymentTimes(len(images), sorted(stamps))


def times_of_revision(path: Path) -> DeploymentTimes:
    """A previous revision's images: from the images.json kept beside them — only the "local_time" of each is used —
    else from the EXIF of the images."""
    log = path / local_folder_service.IMAGES_FILE
    if log.is_file():
        try:
            images = json.loads(log.read_text(encoding="utf-8")).get("images", [])
            stamps = [t for t in (_timestamp(i.get("local_time") or "") for i in images) if t is not None]
            return DeploymentTimes(len(images), sorted(stamps))
        except (json.JSONDecodeError, OSError, AttributeError) as exc:
            logger.warning("Could not read %s (%s) — reading the images instead.", log, exc)
    return times_of_folder(path)


def previous_revisions(collections_dir: Path, research_project_id: str, deployment_id: str) -> list[PreviousRevision]:
    """The deployments of the same location, in the same research project, with a lower
    revision number — oldest first. Where is the research project's folder; each
    collection folder (R0001, R0002_winter…) holds that revision's deployments."""
    match = _DEPLOYMENT_RE.match(deployment_id)
    if not match:
        return []
    revision, location = int(match.group(1)), match.group(2).lower()
    project = collections_dir / research_project_id
    if not project.is_dir():
        return []
    found: list[PreviousRevision] = []
    for collection in sorted(project.iterdir()):
        if not (collection.is_dir() and _COLLECTION_RE.match(collection.name)):
            continue
        for deployment in sorted(collection.iterdir()):
            other = _DEPLOYMENT_RE.match(deployment.name)
            if deployment.is_dir() and other and int(other.group(1)) < revision and other.group(2).lower() == location:
                found.append(PreviousRevision(int(other.group(1)), deployment.name, deployment))
    return sorted(found, key=lambda r: (r.revision, r.deployment_id))


def next_revision(collections_dir: Path, research_project_id: str, location_id: str) -> dict:
    """The revision a new deployment at this location is expected to be: one after the highest kept in the research
    project for it (any collection, a location's _suffix not counting), or 1 if there is none. {"last", "next"}."""
    project = collections_dir / research_project_id
    wanted = location_id.strip().lower()
    last: int | None = None
    if wanted and project.is_dir():
        for collection in project.iterdir():
            if not (collection.is_dir() and _COLLECTION_RE.match(collection.name)):
                continue
            for deployment in collection.iterdir():
                match = _DEPLOYMENT_RE.match(deployment.name)
                if deployment.is_dir() and match and match.group(2).lower() == wanted:
                    last = max(last or 0, int(match.group(1)))
    return {"last": last, "next": (last or 0) + 1}


def previous_deployment(collections_dir: Path, research_project_id: str, deployment_id: str) -> dict | None:
    """The details kept for the closest earlier revision of this deployment's location — the
    deployment.json an import leaves — as {"revision", "deployment_id", "deployment"}, or None
    if no earlier revision of the location kept any (R0002-DONA_01 is filled from R0001-DONA_01)."""
    for previous in reversed(previous_revisions(collections_dir, research_project_id, deployment_id)):
        try:
            details = json.loads((previous.path / "deployment.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(details, dict):
            return {"revision": previous.revision, "deployment_id": previous.deployment_id, "deployment": details}
    return None


def _fmt(value: float) -> str:
    return f"{value:.1f}".rstrip("0").rstrip(".") if value != int(value) else str(int(value))


def compare(value: float, previous: list[float], *, method: str, tolerance_percent: float, min_revisions: int) -> dict:
    """Whether `value` is similar to the `previous` revisions' values, and why.

    Returns {"ok", "skipped", "value", "reference", "lower", "upper", "previous"}: skipped
    (and ok) when there aren't min_revisions previous values to go by.
    """
    if method not in METHODS:
        raise dis.DeploymentImportError(f"Unknown method '{method}' — use one of {', '.join(METHODS)}.")
    base = {"value": value, "previous": len(previous), "reference": None, "lower": None, "upper": None}
    if len(previous) < max(min_revisions, 1):
        return {**base, "ok": True, "skipped": True}
    tolerance = tolerance_percent / 100
    reference = {
        "median": lambda: statistics.median(previous), "mean": lambda: statistics.fmean(previous),
        "last": lambda: previous[-1], "range": lambda: statistics.median(previous),
    }[method]()
    if method == "range":
        lower, upper = min(previous) * (1 - tolerance), max(previous) * (1 + tolerance)
    else:
        lower, upper = reference * (1 - tolerance), reference * (1 + tolerance)
    return {**base, "ok": lower <= value <= upper, "skipped": False, "reference": reference, "lower": lower, "upper": upper}


def _describe(label: str, unit: str, result: dict, *, method: str, tolerance_percent: float, min_revisions: int, location: str) -> str:
    if result["skipped"]:
        return (f"Not enough history to judge the {label}: {result['previous']} previous revision(s) of {location} found, "
                f"{max(min_revisions, 1)} needed.")
    allowed = f"{_fmt(result['lower'])}–{_fmt(result['upper'])}"
    how = {"median": "the median of", "mean": "the mean of", "last": "the last of", "range": "the range of"}[method]
    verb = "is similar to" if result["ok"] else "is not similar to"
    return (f"The {label} ({_fmt(result['value'])}{unit}) {verb} {how} the {result['previous']} previous revision(s) of {location} "
            f"(allowed {allowed}, ±{_fmt(tolerance_percent)}%).")


STATISTIC_CHECKS = ("image_count", "sequence_count", "sequence_length")
_LABELS = {"image_count": "number of images", "sequence_count": "number of sequences", "sequence_length": "length of the sequences"}
_UNITS = {"image_count": "", "sequence_count": "", "sequence_length": " images per sequence"}


def _metrics(times: DeploymentTimes, gap_seconds: float) -> dict[str, float]:
    lengths = times.sequences(gap_seconds)
    return {
        "image_count": float(times.image_count),
        "sequence_count": float(len(lengths)),
        "sequence_length": (sum(lengths) / len(lengths)) if lengths else 0.0,  # the mean number of images per sequence
    }


def statistical_checks(
    current: DeploymentTimes, collections_dir: Path, research_project_id: str | None, deployment_id: str, checks: frozenset[str], *,
    sequence_gap_seconds: float, min_revisions: int, method: str, tolerances: dict[str, float],
) -> dict[str, dict]:
    """The statistical checks asked for, by name — each as compare() gives it plus "message" and "history"
    (the value in each previous revision). Without a research project or a location in the deployment
    id there's no history to look at, which also skips them."""
    wanted = [c for c in STATISTIC_CHECKS if c in checks]
    if not wanted:
        return {}
    match = _DEPLOYMENT_RE.match(deployment_id)
    location = match.group(2) if match else deployment_id
    revisions = previous_revisions(collections_dir, research_project_id, deployment_id) if research_project_id else []
    histories = []
    for revision in revisions:
        times = times_of_revision(revision.path)
        if times.image_count > 0:
            histories.append((revision, _metrics(times, sequence_gap_seconds)))
    now = _metrics(current, sequence_gap_seconds)
    out: dict[str, dict] = {}
    for key in wanted:
        previous = [metrics[key] for _, metrics in histories]
        tolerance = tolerances[key]
        result = compare(now[key], previous, method=method, tolerance_percent=tolerance, min_revisions=min_revisions)
        result["message"] = _describe(_LABELS[key], _UNITS[key], result, method=method, tolerance_percent=tolerance, min_revisions=min_revisions, location=location)
        result["history"] = [{"revision": rev.revision, "deployment_id": rev.deployment_id, "value": metrics[key]} for rev, metrics in histories]
        out[key] = result
    return out


# ── Statistics of a collection: every deployment against the previous revisions of its location ──────────

STATS_FILE = "statistics.json"
_CACHE_VERSION = 4


def _fingerprint(log: Path, gap_seconds: float) -> dict:
    stat = log.stat()
    return {"version": _CACHE_VERSION, "size": stat.st_size, "mtime_ns": stat.st_mtime_ns, "gap_seconds": gap_seconds}


def sequence_length_counts(lengths: list[int]) -> list[list[int]]:
    """How many sequences have each number of images — [[1, 180], [2, 138]…], by length — exact, and compact when many sequences share a length."""
    return [[length, n] for length, n in sorted(collections.Counter(lengths).items())]


def longest_sequence(times: list[float], gap_seconds: float) -> dict | None:
    """The longest sequence (the first, if several tie): {"images", "start", "end", "seconds"} — the start and the end as the camera's wall clock (2023-11-06T15:00:46)."""
    ordered = sorted(times)
    best: tuple[int, float, float] | None = None
    start = 0
    for i in range(1, len(ordered) + 1):
        if i == len(ordered) or ordered[i] - ordered[i - 1] >= gap_seconds:
            if best is None or i - start > best[0]:
                best = (i - start, ordered[start], ordered[i - 1])
            start = i
    if best is None:
        return None
    count, first, last = best
    wall = lambda t: datetime.fromtimestamp(t, timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")  # noqa: E731
    return {"images": count, "start": wall(first), "end": wall(last), "seconds": last - first}


def sequences_per_calendar_day(times: list[float], gap_seconds: float) -> list[dict]:
    """The sequences that began each calendar day from the first image's to the last's — [{"date": "2023-11-06", "sequences": 3}] —, a day with none counting 0."""
    ordered = sorted(times)
    starts = [t for i, t in enumerate(ordered) if i == 0 or t - ordered[i - 1] >= gap_seconds]
    return [{"date": d["date"], "sequences": n} for d, n in zip(images_per_calendar_day(ordered), _count_by_day(ordered, starts))] if ordered else []


def _count_by_day(ordered: list[float], starts: list[float]) -> list[int]:
    first = datetime.fromtimestamp(ordered[0], timezone.utc).date()
    last = datetime.fromtimestamp(ordered[-1], timezone.utc).date()
    counts = [0] * ((last - first).days + 1)
    for t in starts:
        counts[(datetime.fromtimestamp(t, timezone.utc).date() - first).days] += 1
    return counts


def images_per_calendar_day(times: list[float]) -> list[dict]:
    """The images of each calendar day from the first image's to the last's — [{"date": "2023-11-06", "images": 12}] —, a day with none
    counting 0. The times are the camera's wall clock (stood as UTC), so the date is the one the camera showed."""
    if not times:
        return []
    counts: dict = {}
    for t in times:
        day = datetime.fromtimestamp(t, timezone.utc).date()
        counts[day] = counts.get(day, 0) + 1
    first, last = min(counts), max(counts)
    return [{"date": (first + timedelta(days=i)).isoformat(), "images": counts.get(first + timedelta(days=i), 0)} for i in range((last - first).days + 1)]


def deployment_metrics(path: Path, gap_seconds: float) -> dict:
    """What a deployment's images look like: the three compared metrics (image_count, sequence_count,
    sequence_length) plus the days it covers (from its first image to its last), images_per_day, the median and the
    longest sequence, the first and last image, and the histograms: "daily" (the images of each calendar day, the days with none included),
    "sequences_daily" (the sequences that began each day) and "sequence_lengths" (how many sequences have each number of images),
    and "longest_sequence" (its images, start, end and duration).

    Kept in `statistics.json` beside the deployment's images.json and read back from there while the
    images.json and the gap are the same, so the history of a location is not read again for each collection.
    A deployment with no images.json is read from its images and not kept (a folder that is still changing)."""
    log = path / local_folder_service.IMAGES_FILE
    cache = path / STATS_FILE
    fingerprint = _fingerprint(log, gap_seconds) if log.is_file() else None
    if fingerprint and cache.is_file():
        try:
            kept = json.loads(cache.read_text(encoding="utf-8"))
            if kept.get("fingerprint") == fingerprint:
                return kept["metrics"]
        except (OSError, json.JSONDecodeError, AttributeError, KeyError):
            pass
    times = times_of_revision(path)
    lengths = times.sequences(gap_seconds)
    days = (times.times[-1] - times.times[0]) / 86400 if len(times.times) > 1 else 0.0
    metrics: dict = {
        **_metrics(times, gap_seconds),
        "days": days if days > 0 else None,
        "images_per_day": (times.image_count / days) if days > 0 else None,
        "daily": images_per_calendar_day(times.times),
        "sequences_daily": sequences_per_calendar_day(times.times, gap_seconds),
        "sequence_lengths": sequence_length_counts(lengths),
        "longest_sequence": longest_sequence(times.times, gap_seconds),
        "sequence_median": float(statistics.median(lengths)) if lengths else 0.0,
        "sequence_max": float(max(lengths)) if lengths else 0.0,
        "first_image": times.times[0] if times.times else None,
        "last_image": times.times[-1] if times.times else None,
    }
    if fingerprint:
        try:
            cache.write_text(json.dumps({"fingerprint": fingerprint, "metrics": metrics}, indent=2), encoding="utf-8")
        except OSError as exc:  # a read-only folder just means no cache
            logger.warning("Could not keep %s (%s).", cache, exc)
    return metrics


def _deployment_path(collections_dir: Path, research_project_id: str, deployment_id: str) -> Path:
    project = collections_dir / research_project_id
    if project.is_dir():
        for collection in sorted(project.iterdir()):
            candidate = collection / deployment_id
            if collection.is_dir() and _COLLECTION_RE.match(collection.name) and candidate.is_dir():
                return candidate
    raise dis.DeploymentImportError(f"The deployment '{deployment_id}' isn't in the research project '{research_project_id}'.")


def collection_statistics(
    collections_dir: Path, research_project_id: str, collection: str, *,
    sequence_gap_seconds: float, min_revisions: int, method: str, tolerances: dict[str, float],
) -> list[dict]:
    """Each deployment of a collection against the previous revisions of its location, one row per deployment:
    {"deployment_id", "location", "revision", "metrics", "checks", "status", "revisions"}. `revisions` has the
    metrics of every revision of the location up to this one, this one last. `checks` is, for each of the
    STATISTIC_CHECKS, what compare() gives plus "message" and "history"; `status` is "review" if any is not
    similar, "insufficient_history" if none could be judged, else "ok"."""
    folder = collections_dir / research_project_id / collection
    if not folder.is_dir():
        raise dis.DeploymentImportError(f"The collection '{collection}' isn't in the research project '{research_project_id}'.")
    rows: list[dict] = []
    for deployment in sorted(folder.iterdir()):
        match = _DEPLOYMENT_RE.match(deployment.name)
        if not (deployment.is_dir() and match):
            continue
        now = deployment_metrics(deployment, sequence_gap_seconds)
        history = []
        for revision in previous_revisions(collections_dir, research_project_id, deployment.name):
            metrics = deployment_metrics(revision.path, sequence_gap_seconds)
            if metrics["image_count"]:
                history.append((revision, metrics))
        checks: dict[str, dict] = {}
        for key in STATISTIC_CHECKS:
            result = compare(now[key], [m[key] for _, m in history], method=method, tolerance_percent=tolerances[key], min_revisions=min_revisions)
            result["message"] = _describe(_LABELS[key], _UNITS[key], result, method=method, tolerance_percent=tolerances[key], min_revisions=min_revisions, location=match.group(2))
            result["history"] = [{"revision": r.revision, "deployment_id": r.deployment_id, "value": m[key]} for r, m in history]
            checks[key] = result
        judged = [c for c in checks.values() if not c["skipped"]]
        status = "insufficient_history" if not judged else ("ok" if all(c["ok"] for c in judged) else "review")
        # Every revision of the location, this one last: what the screen puts side by side.
        def without_daily(m: dict) -> dict:  # the histograms by day are of the deployment of the row only: the revisions keep how many sequences have each length, for the profile of the bursts
            return {k: v for k, v in m.items() if k not in ("daily", "sequences_daily", "longest_sequence")}
        revisions = [{"revision": r.revision, "deployment_id": r.deployment_id, "metrics": without_daily(m)} for r, m in history]
        revisions.append({"revision": int(match.group(1)), "deployment_id": deployment.name, "metrics": without_daily(now)})
        rows.append({"deployment_id": deployment.name, "location": match.group(2), "revision": int(match.group(1)), "metrics": now, "checks": checks, "status": status, "revisions": revisions})
    return rows


def compare_deployments(collections_dir: Path, research_project_id: str, first: str, second: str, *, sequence_gap_seconds: float) -> dict:
    """Two deployments side by side — typically the same location in two revisions (R0002-DONA_0006 and
    R0003-DONA_0006): {"first", "second", "metrics"}, the metrics being {name: {"first", "second", "change_percent"}}.
    change_percent is None when the first is 0 or a value is missing."""
    a = deployment_metrics(_deployment_path(collections_dir, research_project_id, first), sequence_gap_seconds)
    b = deployment_metrics(_deployment_path(collections_dir, research_project_id, second), sequence_gap_seconds)
    out = {}
    for key in ("image_count", "images_per_day", "sequence_count", "sequence_length", "sequence_median", "sequence_max"):
        x, y = a[key], b[key]
        out[key] = {"first": x, "second": y, "change_percent": ((y - x) / x * 100) if x and y is not None else None}
    return {"first": first, "second": second, "metrics": out}
