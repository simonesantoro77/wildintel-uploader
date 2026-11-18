# Deployments of DONA

The folders of images of the deployments of the project **DONA**, for the visits and the entities in
[`visits_example/wildintel_csv/dona`](../../visits_example/wildintel_csv/dona) and [`entities_example/dona`](../../entities_example/dona).
**They are not kept in the repository** — they are many images —: they are made here with a script, the same every time.

## Make them

From the root of the repository:

```
uv run python tools/make_dona_deployments.py                 # the 38 deployments of R0001, in DONA/R0001
uv run python tools/make_dona_deployments.py --revision 2    # those of the next revision, in DONA/R0002
uv run python tools/make_dona_deployments.py --only DONA_0038 DONA_0026
```

It takes about ten seconds and makes `DONA/R0001/R0001-DONA_0006` … `DONA/R0001/R0001-DONA_0043`: 38 folders with 1111 images each, about 60 MB. It needs Pillow, which the
project already has. The images are ignored by git (`.gitignore` in this folder).

## What they are

- A deployment is of the visit that left the camera at a site and the one of the next revision that collected its card. Each folder is named as the app names it, `R0001-DONA_0038`,
  and is in the folder of its collection, `R0001`, as the app keeps them.
- **1111 images** each — the photos the visit that collected the card counted —, `IMG_0001.JPG` … `IMG_1111.JPG`, small (96×54), all different and made up. When a visit did
  not count them, the script makes between 1000 and 5000.
- The first one is taken five minutes after the camera was left and the last one five minutes before its card was collected (the dates of the visits, in UTC, as the locations
  are), in bursts of three shots a second apart.
- Their EXIF says the camera that took them: the **serial number is the id of the camera that was at the site** (`38` for `DONA_0038`; at `DONA_0027` and `DONA_0030`, whose camera
  was replaced in `R0002`, the one that was there in `R0001`), with the same make and model in all of them — the entities do not give the model.

## Try them

1. Import the entities, then the visits of `R0001` and `R0002` (`revision_1.csv` and `revision_2.csv`).
2. **Import deployment** offers the 38 closed visits. Pick one and, in the step of the images, the folder `DONA/R0001/R0001-DONA_0038` (or any of them).

Every check passes: the images (corrupted, duplicates, sequence, structure, camera and EXIF) and the postvalidation (naming, dates, camera, and the card and the photos the visit
counted).
