"""Makes the deployments of a revision of the project DONA — the folders of images a camera would give — from the visits of its examples.

    uv run python tools/make_dona_deployments.py                  # revision 1: examples/deployment_examples/DONA/R0001/R0001-DONA_0006 …
    uv run python tools/make_dona_deployments.py --revisions 1-5  # a range: R0001 to R0005, one folder for each
    uv run python tools/make_dona_deployments.py --revision 2
    uv run python tools/make_dona_deployments.py --only DONA_0038 DONA_0026
    uv run python tools/make_dona_deployments.py --keep-visits    # do not write the photos counted in the visits

A deployment is of the visit that left the camera at a site and the one of the next revision that collected its card (the visits of
`examples/visits_example/wildintel_csv/dona`). Each folder is named as the app names it — `R0001-DONA_0038` — and inside a collection
folder, `R0001`, as the app keeps them. Its images are small, different from each other, made up, and numbered in the order they were taken
(`IMG_0001.JPG` …). They agree with what the visits say, so that every check passes:

  - **a random number of them**, from 1000 to 10000 for each site — the same every time: it is worked out from the site —, that **changes little from one revision to the next**
    (up to 20 %), as the photos of a camera do, so that the statistical checks against the previous revisions have something to compare; and the visit that collected the card
    **says that number** as the photos it counted: the script writes it in the visits of the examples, unless `--keep-visits`;
  - they come in **bursts of 5 shots**, a second apart, and the **time between one burst and the next is random** — some come soon after, others much later —, so
    the bursts are not at the same distance;
  - the first one is taken five minutes after the camera was left and the last one five minutes before its card was collected, on the camera's wall clock —
    the locations are in UTC;
  - the camera's make and model are the same in all of them, and its serial number is the id of the camera that was at the site."""
from __future__ import annotations

import argparse
import csv
import hashlib
import random
from datetime import datetime, timedelta
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "examples"
VISITS = ROOT / "visits_example" / "wildintel_csv" / "dona"
MAKE, MODEL = "RECONYX", "HyperFire 2 HF2X"
BURST = 5          # shots of a burst, a second apart
MIN_GAP = 30       # seconds, at least, between the end of a burst and the start of the next
PHOTOS = (1000, 10000)
SIZE = (96, 54)
# EXIF tags: Make, Model, DateTime (IFD0); DateTimeOriginal, DateTimeDigitized, BodySerialNumber (Exif IFD).
MAKE_TAG, MODEL_TAG, DATETIME_TAG = 271, 272, 306
DATETIME_ORIGINAL, DATETIME_DIGITIZED, BODY_SERIAL = 36867, 36868, 42033


def read_visits(revision: int) -> list[dict]:
    """The deployments of a revision: for each site, when the camera was left (revision), when the card was collected (the next one), the camera and the photos counted."""
    rows = list(csv.DictReader(open(VISITS / "revisions_1_to_43.csv", encoding="utf-8", newline="")))
    when = lambda r: datetime.strptime(r["created_at"][:19], "%Y-%m-%dT%H:%M:%S")  # noqa: E731
    session = lambda n: f"R{n:04d}"  # noqa: E731
    camera: dict[str, str] = {}   # the camera at each site, as the visits up to the revision left it
    for r in sorted(rows, key=when):
        if int(r["2_Revision"][1:]) <= revision and r["12_Camera_name"]:
            camera[r["3_locationID"]] = r["12_Camera_name"]
    left = {r["3_locationID"]: r for r in rows if r["2_Revision"] == session(revision)}
    out = []
    for r in rows:
        site = r["3_locationID"]
        if r["2_Revision"] != session(revision + 1) or site not in left:
            continue
        counted = r["7_N_pictures_collect"]
        out.append({"id": f"{session(revision)}-{site}", "collection": session(revision), "site": site, "start": when(left[site]), "end": when(r),
                    "camera": camera.get(site, ""), "counted": int(counted) if counted.isdigit() else None})
    return sorted(out, key=lambda d: d["site"])


def photos_of(site: str, deployment_id: str) -> int:
    """How many photos a deployment has: a number from 1000 to 10000 for the site — the same every time — that changes up to 20 % in each revision, as a camera's photos do."""
    seed = lambda text: random.Random(int(hashlib.sha256(text.encode()).hexdigest()[:12], 16))   # noqa: E731
    base = seed(f"photos:{site}").randint(*PHOTOS)
    return min(PHOTOS[1], max(PHOTOS[0], round(base * seed(f"change:{deployment_id}").uniform(0.8, 1.2))))


def capture_times(count: int, start: datetime, end: datetime, rng: random.Random) -> list[datetime]:
    """`count` times in order, from five minutes after the camera was left to five minutes before its card was collected: bursts of BURST shots, a second apart, and a
    **random time between one burst and the next** — the gaps are drawn from an exponential distribution, as the animals come: many short ones and a few long —, scaled so
    that the last burst ends five minutes before the card was collected."""
    first, last = start + timedelta(minutes=5), end - timedelta(minutes=5)
    bursts = -(-count // BURST)
    shots_in_last = count - (bursts - 1) * BURST
    last_start = last - timedelta(seconds=shots_in_last - 1)
    span = (last_start - first).total_seconds()
    free = span - (bursts - 1) * (BURST + MIN_GAP)      # what is left to share between the gaps, once each has its minimum
    assert free > 0, "too many photos for the time between the visits"
    draws = [rng.expovariate(1.0) for _ in range(bursts - 1)]
    total = sum(draws) or 1.0
    starts = [first]
    for d in draws:
        starts.append(starts[-1] + timedelta(seconds=BURST + MIN_GAP + free * d / total))
    starts[-1] = last_start                              # the sum is exact: this only takes away the rounding
    times = [s0 + timedelta(seconds=k) for s0 in starts[:-1] for k in range(BURST)] + [starts[-1] + timedelta(seconds=k) for k in range(shots_in_last)]
    assert times == sorted(times) and times[-1] <= last + timedelta(seconds=1)
    return times


def make_image(path: Path, number: int, taken: datetime, serial: str, rng: random.Random) -> None:
    shade = rng.randrange(40, 200)
    img = Image.new("RGB", SIZE, (shade, shade + 20 if shade < 180 else shade, shade // 2))
    draw = ImageDraw.Draw(img)
    for _ in range(6):   # something different in every image, so none is a duplicate
        x, y, r = rng.randrange(SIZE[0]), rng.randrange(SIZE[1]), rng.randrange(3, 14)
        draw.ellipse((x - r, y - r, x + r, y + r), fill=tuple(rng.randrange(256) for _ in range(3)))
    exif = img.getexif()
    exif[MAKE_TAG], exif[MODEL_TAG] = MAKE, MODEL
    stamp = taken.strftime("%Y:%m:%d %H:%M:%S")
    exif[DATETIME_TAG] = stamp
    sub = exif.get_ifd(0x8769)
    sub[DATETIME_ORIGINAL] = sub[DATETIME_DIGITIZED] = stamp
    if serial:
        sub[BODY_SERIAL] = serial
    img.save(path, quality=70, exif=exif)


def write_counts(revision: int, counts: dict[str, int]) -> int:
    """Writes in the visits of the examples that collected the cards of the revision the photos they counted — the ones the images have —, so that the postvalidation finds them
    as many as the visit says. A visit that counted none (its card was full) is left as it is."""
    written = 0
    for path in sorted(VISITS.glob("*.csv")):
        with open(path, encoding="utf-8", newline="") as fh:
            reader = csv.DictReader(fh); header = reader.fieldnames; rows = list(reader)
        changed = False
        for r in rows:
            site = r["3_locationID"]
            if r["2_Revision"] == f"R{revision + 1:04d}" and site in counts and r["7_N_pictures_collect"].isdigit() and r["7_N_pictures_collect"] != str(counts[site]):
                r["7_N_pictures_collect"] = str(counts[site]); changed = True; written += 1
        if changed:
            with open(path, "w", encoding="utf-8", newline="") as fh:
                writer = csv.DictWriter(fh, fieldnames=header, lineterminator="\n"); writer.writeheader(); writer.writerows(rows)
    return written


def make_revision(revision: int, args: argparse.Namespace) -> int:
    """The deployments of a revision; returns how many images."""
    total = 0
    counts: dict[str, int] = {}
    for d in read_visits(revision):
        if args.only and d["site"] not in args.only:
            continue
        rng = random.Random(int(hashlib.sha256(d["id"].encode()).hexdigest()[:12], 16))   # the same images every time
        count = photos_of(d["site"], d["id"])
        counts[d["site"]] = count
        folder = args.output / d["collection"] / d["id"]
        folder.mkdir(parents=True, exist_ok=True)
        for number, taken in enumerate(capture_times(count, d["start"], d["end"], rng), start=1):
            make_image(folder / f"IMG_{number:04d}.JPG", number, taken, d["camera"], rng)
        total += count
        print(f"{d['id']}: {count} images, camera {d['camera'] or '—'}, {d['start']:%Y-%m-%d %H:%M} → {d['end']:%Y-%m-%d %H:%M}")
    if counts and not args.keep_visits:
        print(f"R{revision:04d}: photos counted written in {write_counts(revision, counts)} rows of the visits of the examples")
    return total


def revisions_of(text: str) -> list[int]:
    """"3" is the revision 3; "1-5" are the revisions 1 to 5."""
    first, _, last = text.partition("-")
    low, high = int(first), int(last or first)
    if low < 1 or high < low:
        raise argparse.ArgumentTypeError(f"{text!r} is not a revision or a range of them, like 3 or 1-5")
    return list(range(low, high + 1))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--revision", type=int, default=None, help="the revision whose deployments are made (default 1: the camera left in R0001, collected in R0002)")
    parser.add_argument("--revisions", type=revisions_of, default=None, help="a range of revisions, like 1-5: the deployments of each, in the folder of its collection")
    parser.add_argument("--only", nargs="*", help="only these sites")
    parser.add_argument("--output", type=Path, default=ROOT / "deployment_examples" / "DONA")
    parser.add_argument("--keep-visits", action="store_true", help="do not write the photos counted in the visits of the examples")
    args = parser.parse_args()

    revisions = args.revisions or [args.revision or 1]
    total = sum(make_revision(r, args) for r in revisions)
    print(f"{total} images in {args.output} — revisions {', '.join(f'R{r:04d}' for r in revisions)}")


if __name__ == "__main__":
    main()
