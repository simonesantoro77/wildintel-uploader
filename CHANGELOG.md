# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Upcoming release

### Added
- **Import deployment**: organize a folder of camera-trap images into the local collections folder
  (`<Documents>/wildintel-uploader/collections/<research project>/<R000N>/<deployment id>`), in a wizard of four
  stages: images → origin and dates → check details → prepare and save.
  - *Validate*: corrupted images, shooting order vs. filename sequence, folder structure, same camera,
    required EXIF fields and duplicate images — each one optional, and each one can be required to continue.
  - *Origin*: the research project and location, picked from the collections folder, added by hand or
    taken from Trapper.
  - *Details*: the deployment's id from its revision (`R0003-DONA_01`), the period with its timezone and
    Camtrap DP's own fields, validated in the browser and in the backend.
    It says when that deployment already exists in the collections folder, and, when an earlier revision of it
    was kept, offers to fill the form in from it (everything but the start and end dates).
  - *Postvalidation*: the naming and the dates against wildintel-tools' rules, and statistical checks
    (number of images, of sequences and their length) against the previous revisions of the location.
  - *Preprocessing*: renaming, resizing to a width and XMP metadata (as wildintel-tools did), listed before
    the import; `preprocessing.json` records what was done to each image, with its hashes (`source_hash`
    of the original, `hash` of the image kept, `final_hash` of the file with its metadata).
  - The camera model and id are read with ExifTool (Pillow without it) — the executables ship with their
    own copy; the collection's
    `<COLLECTION>_FileTimestampLog.csv` is kept up to date.
  - After a good import, a button opens the folder in the file explorer.
- **Import session**: a folder with one subfolder per deployment. The revision, the checks and the
  preprocessing are common; the location, the dates and the rest of the details are asked for each
  deployment, with a filterable list for big sessions, "next incomplete", and filling the details from the
  previous revision of the same deployment (one or all).
  - If the session folder has a `<COLLECTION>_FileTimestampLog.csv` (the file wildintel-tools asks for beside
    a collection's deployments), the start and end of each deployment it has a row for are taken from it
    instead of from the images' EXIF, and the *Details* step says so. See `examples/session_example_timestamp_log`.
- The timezone and the summer-time ("ignore DST") setting belong to the **location**, never to a deployment: the details
  no longer ask for them, nor does any request carry them. They are said, in bold, in a sentence before the details
  (the location, its GPS coordinates, its timezone and whether it ignores summer time), and the images are read and
  the deployment registered in the ones the location has kept. New locations ask for both; a location without a
  timezone is reported instead of guessing one (`/api/deployment-import/locations/update` still changes them).
- The *revision* of a deployment (and of a session) starts as the next one expected — one after the highest kept for the
  location (`/api/deployment-import/next-revision`) — and says so; it can be changed.
- Once a deployment or a session is imported, an **Upload to Trapper** button goes to the upload page with the research
  project and the collection already chosen. Pressing the title in the navbar goes back to the welcome screen.
- **Upload deployment to Trapper**: pick a collection kept locally and upload its deployments — creating the
  location and the deployment in Trapper if they are missing, packing the images in zip + yaml parts and
  sending them. A *dry run* says what would be done changing nothing, and *only generate the files* writes the
  zips, the yamls and the collection's deployments csv to leave them for later.
  A *Test connection* button checks, changing nothing, that the account reaches the research project, its locations
  (and which of the deployments' own would be created) and the uploader's login, each one reported on its own.
  The collection's yaml names the research project's *classification project* (picked under the deployments, or the only
  one it has; typed by pk when generating without an account) — not the research project's own pk.
  The package names the deployment in lower case, as Trapper keeps it, and declares the timezone and summer-time
  setting of the location it goes to (Trapper refuses a package that disagrees with it).
- **Epicollect5 entries**: when the entry of the Epicollect5 form (one row per deployment) of a location and revision exists — the newest one is used — *When was it collected?* offers to fill in the camera, the site and the notes from it, through the mapping of Settings › Epicollect5 (its *When* group keeps the day and the time apart and maps the revision; *Test connection* tries the project and client type). When Epicollect5 is on but has no entry, a warning says so and opens its settings.
- **Epicollect5 settings**: a switch turns the use of Epicollect5 on or off (off by default), and another sends what an entry answers in inputs with no mapping to the comments of the deployment. *When was it collected?* says when Epicollect5 has an entry for the location and revision.
- **Upload to Trapper**: an option deletes the package files — the zips, the yamls and the deployment's row of the deployments csv — once they are up; without it they are kept (and the csv written) in the packages folder, and the result says where. The deployment's row of a collection's *FileTimestampLog* is written in lower case, as Trapper keeps its ids.
- **Folders**: *Settings › General* sets a folder of their own for the collections, the reports and the packages (`DATA.collections_dir`, `DATA.reports_dir`, `DATA.packages_dir`); blank, each stays in its folder inside the data folder, in Documents. The sessions in progress live in the system's state folder (`~/.local/state/wildintel-uploader/sessions` on Linux) and the log file in its log folder (`~/.local/state/wildintel-uploader/log`); neither can be changed, and what was in Documents or beside `settings.toml` is moved there at start.
- **About the app** (*Settings › General*): the name and the version, the update check and links to report a problem (a GitHub issue that already says the version), the documentation, the source code and the release notes.
- **Session scan and the timestamp log**: the scan says whether it found the `<collection>_FileTimestampLog.csv` (and that its dates are imported), warns when it did not, and — after the table of folders, by name — when entries of it have no folder, and the table of folders has a column saying which are in the log. Messages in boxes (warnings, results, notices) all have the icon of their kind; *Skip*, *Warn* and *Must pass* are blue, yellow and red; every step has its Back beside its Continue.
- **Where the dates come from**: each deployment's start and end are taken from one source, chosen in a picker shared by *Import deployment* (Epicollect5 → the images' EXIF → by hand) and *Import session* (Epicollect5 → the timestamp log → EXIF → by hand). The dates can only be edited with *Manual entry*, and a source the user picked is never replaced by another.
- **Select all / Deselect all** in the lists of Trapper's research projects and locations. Locations that already exist are reused, not created again.
- **Boxed messages** share one component with the icon of their kind (success, info, warning, error); the checks' *Skip*, *Warn* and *Must pass* are blue, yellow and red; every *Continue* has a *Back* beside it, and *Start over* sits with the other buttons.
- **Results of the postvalidation of a session** are laid out like those of the folders: figures, a message, *By deployment* / *By check*, and for each deployment the checks it failed with *View the images* and *Download report*.
- **Upload results**: what was uploaded and what failed are in one list — a failure with its reason —, with counts of the deployments uploaded and failed and of the locations and deployments created in Trapper, the date of the run and a CSV report to download.
- **Locations of someone else**: Trapper only takes a deployment whose location the account owns or manages. The dry run warns when the location may not be usable (it goes by the owner and by whether Trapper offers the account to delete it — the managers are not listed), and when Trapper refuses the deployment the error says who owns the location.
- `examples/session_example_faulty`: a session with a fault in every folder (corrupted, unordered, subfolders, mixed cameras, missing EXIF, duplicates) and a timestamp log that does not fit.
- **Utils** (menu): *Repair local deployments* and *Sync local collections* are kept under one button, apart from the import and upload tasks.
- **Sync local collections**: pick a research project and one of its classification projects in Trapper, and the collections
  folder gets what it lacks — the research project (`research_project.json`) and its `locations.json`, the collections
  starting with R (each with its `collection.json` and `<collection>_FileTimestampLog.csv`) and each deployment's
  `deployment.json`, a deployment going to the collection its id starts with. What is already there is kept as it is, nothing is
  changed in Trapper and no image is downloaded unless asked for (*Also download the images from Trapper*: through the classification project's media, four at a time, the ones already there kept), so no `preprocessing.json` is made. Each deployment also gets an `images.json` made
  from what Trapper holds for its images (names, Trapper's pk, when they were taken, observation types, species and tags — not the
  size, the pixels nor the hashes), marked `"source": "trapper"`.
- Every deployment kept locally gets an **`images.json`** beside its `deployment.json`: the number of images, the first and the
  last, and for each one its name (and the original, when renamed), when it was taken — the camera's wall clock, the instant
  and its epoch seconds — the camera, the size and the pixels, and the hashes, for statistics without opening the images again.
  A deployment copied without preprocessing has the names, the EXIF wall-clock time, the size and the pixels.
- Validating and preprocessing the images use several CPUs at once (Settings › General › Workers; by default the
  CPUs the machine has, up to 4).
- **Settings**: General (data folder, log, update check), Trapper (account and test), Validation and
  Postvalidation (each check an entry with a quick switch, and a gear only where it has settings),
  Preprocessing (steps, width, authorship, license, dates) and Config — several settings files to switch
  between.
- Tables of checks have "all" boxes to run, or require, every check at once.
- A command line (`wildintel-uploader`) sharing the settings with the web app.
- **Documentation**: a web and a command-line user manual, a developer manual, features and about pages, with screenshots
  generated by `uv run wucli docs screenshots` (Playwright over the built frontend and a fake backend).
- `tools/make_example_deployment.py` makes a deployment of any number of sample images (3000 by default), each with the
  camera's make, model and serial number and its capture date in the EXIF.
  With `--faulty` it comes with problems for every validation: corrupted and empty images, duplicates, shots out of order, missing
  EXIF, a second camera and a subfolder.

- **Reports**: every validation, postvalidation and preprocessing writes a report of what was checked and done, image by image
  (`<data folder>/reports/*.json`). Each step shows it — the checks with how many images passed and failed, and the images that
  failed with the check and why — and it downloads as a CSV (a row per image and check) or a JSON. A **Reports** task lists the
  reports to look at again or delete.

### Changed
- **Scan** only counts the files and the images of the folder; it no longer opens them. Their dates and camera are read when the
  deployment details open (`/api/deployment-import/guess-details`), so scanning thousands of images is instant.
- The validation step is a dashboard: when it was last run, the valid images, the images with issues and the tests that failed, a table of tests with
  a badge and the number of failed images each, and — opened from one — the images that failed it as thumbnails, with search, filter by error, sort, a
  grid or a list, pages and a view of everything the report says of an image. A report's images are served as thumbnails
  (`/api/reports/{id}/image`).
- **Preprocessing is a step of its own** (`/api/deployment-import/preprocess`), run like the validations, with the same dashboard: the steps to do, a status for each, the images processed and skipped, and the skipped ones as thumbnails. The deployment is left pending — it can be preprocessed again — until the **Import** step consolidates it (`/api/deployment-import/consolidate`): its `deployment.json` is written and it is sealed.
- **Repair local deployments** (new task): a deployment is valid if its `seal.json` still matches it; for the others the metadata files (`deployment.json`, `preprocessing.json`, `images.json`, `seal.json`) are written again from the folder's own contents, the collection's `FileTimestampLog.csv` prevailing over the images' dates, and the images are validated, postvalidated and checked against what preprocessing leaves (`/api/repair/*`, a `repair` report).
- The reports moved from the menu to **Settings › Reports**.
- The deployment's details keep the period always in view and show the rest one section at a time — Camera, Site, Grouping and notes — from a row of buttons (with a red dot on the one that has a wrong field), instead of the *show all fields* checkbox.
- The steps of an upload link to the location, the deployment and the collection in Trapper (`url` in the step events), to check them there.
- The largest zip of an upload (`TRAPPER.max_zip_mb`, 500 MB by default) is set in Settings › Trapper, no longer on the upload page; the upload endpoint no longer takes it.
- Upload: choosing the research project and the collection says whether the configured Trapper account has access to them (`/api/upload/check-selection`); **Test connection** comes after the classification project.
- The postvalidation step has the same dashboard (Run checks); the images out of range or from another camera open as thumbnails.
- The tables of checks have a first column that shows the check running and then how it ended (✔ passed, ⚠ failed, ✘ failed and
  required), and the plain list of results below them is gone: the report is what is shown.
- Settings › Preprocessing › License is a list — CC0, CC BY and CC BY-NC — and shows the URL that is written into each image.
  A license set by hand in `settings.toml` is kept and shown as *Other*.

### Fixed
- A location with the timezone `UTC` (or any other) is accepted on Windows: the app ships the `tzdata` timezone database, which Windows lacks for
  Python's `zoneinfo`, and the executables bundle it.
- Creating a deployment in Trapper no longer fails with *Type error in the cell … deploymentStart*: the CSV's dates are the wall clock of
  the location's timezone, with no `Z` or offset, as Trapper's import form reads them.
- Adding a research project or a location *from Trapper* no longer asks for the credentials: it connects by itself with the
  account saved in the settings, and says so when there isn't one.
- The `*_exiftool_tmp` files ExifTool leaves when it is interrupted writing the metadata are removed.
- The upload's login to Trapper copes with an answer without `results` (the session at the top, or as a cookie) and, when there is
  no session at all, says what Trapper answered instead of failing with a bare `'results'`.
- The frontend type-checks again (`npm run build`): the resume screen knows every task, the Trapper credentials may be left
  blank, and the tests' fixtures follow `SessionSummary`.
