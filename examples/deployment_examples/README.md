# Example deployments

One deployment is the images of one camera at one site: a folder of JPG files. They are for trying **Import deployment**
(and the validation of its *Check the images* step). All the images are small (1280×720) and made up; none has a real animal.

| Folder | Images | What is in it |
|---|---|---|
| [`valid`](valid) | 24 | A good deployment: numbered in the order they were taken (`IMG_0001.JPG` …), each with its capture date in the EXIF. The reference to start with. It also has `time_corrections.json`, the record of a time correction made on it in the app (see below). |
| [`corrupted`](corrupted) | 20 | Two images cannot be read: `IMG_0009.JPG` is damaged and `IMG_0017.JPG` is empty (0 bytes). The validation reports them as corrupted. |
| [`duplicates`](duplicates) | 20 | The same shot more than once: `IMG_0003 (copy).JPG`, `IMG_0012_bak.JPG` and `backup/IMG_0007.JPG` repeat other images. |
| [`missing_exif`](missing_exif) | 20 | Two images (`IMG_0004.JPG`, `IMG_0009.JPG`) have no capture date in the EXIF, so their time cannot be read. |
| [`mixed_cameras`](mixed_cameras) | 20 | Images of more than one camera: 12 of `P800HG08`, 4 of `P800HG99` and 4 of `BRW-0042`. A deployment is of one camera. |
| [`subfolders`](subfolders) | 24 | The images are in `100CAMERA`, `101CAMERA` and `102CAMERA` (8 each), as a camera writes them, not in one folder. They are read all the same. |
| [`unordered`](unordered) | 20 | Some images are numbered out of the order they were taken in: their capture times do not grow with their names. |
| [`3000`](3000) | 3000 | A long, good deployment: small and all different, in bursts of three shots, with the camera's make, model and serial number and its capture date in the EXIF (a Reconyx HyperFire 2, `P800HG08`). For a long import, the statistical checks or an upload. |
| [`3000_faulty`](3000_faulty) | 3000 | The same 3000 images with about 14 % of problems, for every validation to find: corrupted images, duplicates (`IMG_0123 (copy).JPG`, `IMG_0123_bak.JPG`), shots out of order, no capture date, no camera model or serial number, a second camera (a Bushnell) and some images in a `backup/` subfolder. |

`3000` and `3000_faulty` are made by `tools/make_example_deployment.py` (`--faulty` for the second); run it again to rebuild them.

## The deployments of DONA

The images of the **38 deployments of the first revision of DONA** — the camera that each site was left with in `R0001` and whose card was collected in `R0002` — for the
visits and the entities in [`visits_example/wildintel_csv/dona`](../visits_example/wildintel_csv/dona) and [`entities_example/dona`](../entities_example/dona). **They are not in the
repository** (they are 42218 images): they are made with `tools/make_dona_deployments.py`, and [`DONA`](DONA) says how.

## How to try them

1. **Import deployment** → pick the folder (any of them) → follow the steps. A good one goes through with nothing to say; the others make
   the *Check the images* step report what is wrong, each in its own way.

## About `time_corrections.json`

The folder `valid` also has a `time_corrections.json`: the record the app keeps of a time correction made on the deployment (when, who, what was
done — here, a shift of all 24 images so that the series starts when the deployment started — and why). It is not an image. The correction is
already in the images' capture times; deleting the file does not undo it.
