"""Makes the deployments of a revision of the project DONA — the folders of images a camera would give — from the visits of its examples.

    uv run python tools/make_dona_deployments.py                  # revision 1: examples/deployment_examples/DONA/R0001/R0001-DONA_0006 …
    uv run python tools/make_dona_deployments.py --revision 2
    uv run python tools/make_dona_deployments.py --only DONA_0038 DONA_0026

A deployment is of the visit that left the camera at a site and the one of the next revision that collected its card (the visits of
`examples/visits_example/wildintel_csv/dona`). Each folder is named as the app names it — `R0001-DONA_0038` — and inside a collection
folder, `R0001`, as the app keeps them. Its images are small, different from each other, made up, and numbered in the order they were taken
(`IMG_0001.JPG` …). They agree with what the visits say, so that every check passes:

  - as many as the visit that collected the card counted (1111 in these examples; between 1000 and 5000 when it counted none);
  - the first one is taken when the camera was left and the last one when the card was collected, in bursts of three shots a second apart,
    on the camera's wall clock — the locations are in UTC;
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
BURST = 3
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


def capture_times(count: int, start: datetime, end: datetime, rng: random.Random) -> list[datetime]:
    """`count` times in order, from five minutes after the camera was left to five minutes before its card was collected: bursts of BURST shots, a second apart."""
    first, last = start + timedelta(minutes=5), end - timedelta(minutes=5)
    bursts = -(-count // BURST)
    shots_in_last = count - (bursts - 1) * BURST
    last_start = last - timedelta(seconds=shots_in_last - 1)
    span = int((last_start - first).total_seconds())
    starts = [first] + sorted(first + timedelta(seconds=rng.randrange(1, span)) for _ in range(bursts - 2)) + [last_start]
    for i in range(1, bursts):   # a burst never overlaps the one before: the order of the names is the order in time
        starts[i] = max(starts[i], starts[i - 1] + timedelta(seconds=BURST + 1))
    times = [s + timedelta(seconds=k) for s in starts[:-1] for k in range(BURST)] + [starts[-1] + timedelta(seconds=k) for k in range(shots_in_last)]
    assert times[-1] <= last + timedelta(seconds=1)
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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--revision", type=int, default=1, help="the revision whose deployments are made (default 1: the camera left in R0001, collected in R0002)")
    parser.add_argument("--only", nargs="*", help="only these sites")
    parser.add_argument("--output", type=Path, default=ROOT / "deployment_examples" / "DONA")
    args = parser.parse_args()

    total = 0
    for d in read_visits(args.revision):
        if args.only and d["site"] not in args.only:
            continue
        rng = random.Random(int(hashlib.sha256(d["id"].encode()).hexdigest()[:12], 16))   # the same images every time
        count = d["counted"] if d["counted"] and 1000 <= d["counted"] <= 5000 else rng.randrange(1000, 5001)
        folder = args.output / d["collection"] / d["id"]
        folder.mkdir(parents=True, exist_ok=True)
        for number, taken in enumerate(capture_times(count, d["start"], d["end"], rng), start=1):
            make_image(folder / f"IMG_{number:04d}.JPG", number, taken, d["camera"], rng)
        total += count
        print(f"{d['id']}: {count} images, camera {d['camera'] or '—'}, {d['start']:%Y-%m-%d %H:%M} → {d['end']:%Y-%m-%d %H:%M}")
    print(f"{total} images in {args.output}")


if __name__ == "__main__":
    main()
