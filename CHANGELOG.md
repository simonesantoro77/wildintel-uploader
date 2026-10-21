# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Upcoming release

### Changed (after the second testing of 21 Oct)
- **Menu**: four steps (Field records › Copy SD cards › Process collection › Upload to Trapper). Fixing dates and times is
  no longer a step of its own: Copy SD cards takes you there when a card needs it, and it is in Utils as **Check and fix
  dates and times**. Coming from Copy SD cards while cards are left, its next step is **Back to Copy SD cards**, not
  Process collection.
- **Field records**: the two files are called **Field survey (from App)** (the CSV of the field app) and **Field history**
  (the fieldwork datasheet), each explained under it. The research project is no longer filled in from last time: it is
  chosen, which brings its locations. The sites not visited on this trip are not a warning any more: the deployments still
  open (camera still out) are listed apart. The texts say "the deployments' or collection's FileTimestampLog/FieldworkLog".
- **Camtrap DP fields from the field**: cameraModel, cameraDelay, cameraHeight, cameraDepth, cameraTilt, cameraHeading,
  detectionDistance, timestampIssues, baitUse, featureType, habitat, deploymentGroups and deploymentTags are read from the
  field survey when it has them (a column of the same name, or the one set in Settings › Field records), kept in the field
  history (a column of that name is added when missing) so that a later trip still has them, written to the FieldworkLog
  and filled into each deployment by Process collection. When the setup and the retrieval visit differ: a text is kept as
  `Setup: … | Retrieval: …` (setupBy and habitat), the tags and groups of both are joined, and a number, yes/no, feature
  type or camera model keeps the setup's value, the retrieval's noted in deploymentComments. A value that is not valid
  (a height that is not a number, a feature type not in the list) is left out and pointed out.
- deploymentComments says `Setup: … | Retrieval: …` instead of `Start: … | End: …`.
- **Check and fix dates and times** keeps no second copy of the card: the `originals` folder is gone, and with it "Put back
  as the card was". Every fix is still written down in `time_corrections.json`; images removed are deleted from the copy.
  The setting "Keep the untouched copy of each card" is gone too.
- **Copy SD cards**: on Windows the card is ejected for real (the volume locked, dismounted and ejected, waiting for it,
  with Explorer's Eject as a fallback) and the page only says it is out once the system does; otherwise it says why.
- **Process collection**: the locations step says to check that each folder has the right location, and the tick boxes
  it had (that did nothing visible) are gone. The *Required EXIF fields* check no longer asks for the camera id (it comes
  from the field records): only the capture date and the camera model.
- "Preprocessing" is called **Prepare images** (the steps, the results, the reports and Settings).

### Changed (after the testing of 21 Oct)
- The app opens on the menu: the welcome screen is gone, and the title goes back to the menu. Each step ends with a
  **Next step** button to the one that follows (Field records › Copy SD cards › Fix dates and times › Process collection ›
  Upload to Trapper). "Session" is called **collection** everywhere, and the field app is not named.
- **Field records**: a camera still out is put in the collection its collecting visit will name (it was put in the one
  of the visit that left it, so cards were missing from Copy SD cards); an Installation at a site whose card was not
  collected is pointed out; the old eleven-column FileTimestampLog is no longer written.
- **Copy SD cards**: the label on the card is required. One that is not the label noted in the field is shown in red and
  must be confirmed; the difference goes into the copy record and into `field_corrections.csv`, the list of corrections
  for the field data, shown on the page. Deployments copied or already processed are not offered again. The card is
  ejected once copied (Windows and macOS).
- **Process collection**: the collection is picked from the list of the cards folder (or a folder elsewhere); only the
  deployments not processed yet are ticked. The research project, the locations, the collection number and the dates
  come from the field records with nothing to confirm, and who set it up, the camera id, the tags and the notes fill
  each deployment in (they reach `deployment.json`). The image checks and the details' checks are one step. The camera
  postvalidation check is off by default (the camera id is the field team's, not the camera's).
- **The images' times are never shifted**: they are read as the cameras' clock (Settings › Field records, UTC) whatever
  the location's timezone, which is only kept for Trapper; a location whose timezone is not UTC is pointed out.
- The folder and file dialogs open with a title that has an apostrophe in it (Windows failed to parse it).

### Added
- **Field records** (first in the menu): after a field trip, the Epicollect download (CSV) and the fieldwork datasheet
  (.xlsx) are read together, with the FileTimestamps tool's own engine (Tatra's and Doñana's formats recognised). The
  trip's visits are added to the datasheet — a new file beside the original, named after the new range of sessions —
  and each deployment of the collection gets the two visits it spans: its start and end, **always in UTC** (the time of
  the Epicollect entry), who set it up, its camera and its card, and the photos counted when its card was collected. A
  deployment is *closed* once that visit is recorded and *open* (camera still out) until then, so a collection can be
  completed over several trips: running it again adds nothing twice.
  - Checks before any card is copied: sites that are not among the research project's locations yet (a site
    installed on this trip — add it in Trapper and take the locations again), a camera or a card at two sites in one
    session, and the engine's own (sites not visited, revisions with 0 photos, two installations at one site…).
  - Writes, in the collection's folder, `<R000N>_FileTimestampLog.csv` (each closed deployment's row replaced, the
    others kept) — and, beside the datasheet, the same log in the old eleven-column format of wildintel-tools — and `<R000N>_FieldworkLog.csv`: every deployment with Camtrap DP's field names (`deploymentID`,
    `deploymentStart`/`End` in UTC, `setupBy` and `cameraID` from the start visit, `deploymentComments` from both
    visits' notes as `Start: … | End: …`) and what the field trip says of its card.
  - The research project is chosen among those of the Trapper account (or the ones kept here): choosing it brings its
    locations into the collections folder — the missing ones added, the ones there kept, those saved from the field too —
    with no Sync nor classification project needed. It says when Trapper already has the collection.
  - A new site comes with what tells it from a misnamed one: its installation's coordinates, the nearest location and
    how far, and the ids one character apart. Ticked and confirmed, it is saved as a location (source "field"), and the
    upload creates it in Trapper.
  - **Settings › Field records**: the time of a visit (the entry's, or the date and hour typed), the timezone of the
    cameras' clocks (UTC), the seconds, the format of the updated datasheet, and the Epicollect column of each field
    for forms named otherwise. `/api/fieldlog/*`.
- **Copy SD cards**, guided by the field records: the collection's deployments as the field records say them (camera still
  out, card to copy, copied), and each card looked at before it is copied — its files, its first and last image, its
  camera — and matched to its deployment by the label noted in the field and its dates against each period, with what
  doesn't fit (more or fewer files than photos counted, images outside the period). The card is copied untouched into
  `<images folder>/cards/<research project>/<R000N>/<deployment>/`, flat, each file checked by reading its SHA-256 back,
  with a `card_copy.json` record (which card, when, by whom, every file with its size and checksum). A card copied once
  is recognised and not copied again, into any deployment. The collection's FileTimestampLog goes beside the
  deployments, so that folder is imported as it is with **Import session**.
  - *Folders from elsewhere*: images organized some other way (a folder per site with the collections inside, say)
    are found folder by folder, their collection and site guessed from the path, and copied the same way.
  - **Settings › Field records › SD cards**: how long the untouched copy is kept, and how far the files may be from the
    photos counted. `/api/ingest/*`.

- **Fix dates and times**, for a copied card whose camera clock went wrong: its images in the camera's order with when
  each says it was taken, drawn against the deployment's period, and split where the time goes backwards — each
  segment with an offset suggested when it falls outside the period (the first to start at the deployment's start, a
  later one to go on from the one before). A run of images is shifted by an offset, or by the real time of one image
  (the photo of the field team at the visit, say), with ExifTool; images whose time can't be made right are removed.
  Before the first fix the copy is kept as it came from the card (`<images folder>/originals/…`), every fix is written
  down in the deployment's `time_corrections.json`, and the card can be put back. `/api/timefix/*`.

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
- **Import info from Epicollect5**: in *When was it collected?*, the period, camera, site and notes of the deployment are filled in from the entry of the Epicollect5 form (one row per deployment) of that location and revision, through the mapping of Settings › Epicollect5, whose *When* group keeps the day and the time apart and maps the revision; *Test connection* tries the project and client typed there.
- **Epicollect5 settings**: a switch turns the use of Epicollect5 on or off (off by default), and another sends what an entry answers in inputs with no mapping to the comments of the deployment. *When was it collected?* says when Epicollect5 has an entry for the location and revision.
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
- **Settings**: General (images folder, log, update check), Trapper (account and test), Validation and
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
  (`<images folder>/reports/*.json`). Each step shows it — the checks with how many images passed and failed, and the images that
  failed with the check and why — and it downloads as a CSV (a row per image and check) or a JSON. A **Reports** task lists the
  reports to look at again or delete.

### Changed
- The menu shows the workflow as numbered steps, in the order they are done: 1 Field records, 2 Copy SD cards, 3 Fix dates
  and times (only if needed), 4 Process collection (or a single deployment), 5 Upload to Trapper. *Import deployment* and
  *Import session* are now **Process deployment** and **Process collection**.
- Fix dates and times opens on the deployment where the problem was found: right after a card is copied, when its dates
  don't look right, and from Process collection, when the order or the dates of a deployment's images fail their check.
- The native file and folder dialogs open in front of the browser, and the field records say when the dialog can't open.
  The field data download is no longer named after Epicollect: any field app's CSV will do.
- **Sync local collections** works from the research project's own collections, not a classification project's: nothing is
  ticked to begin with, several collections and deployments can be chosen at once, and each says what is already here. A
  classification project is only asked for to download images (Trapper only gives the files through one). Collections made
  in Trapper for some purpose (R0039-SOLONOVIEMBRE, any name that is not R0000) are downloaded by their images into
  `downloads/<research project>/<collection>/<deployment>/`, apart from the field collections.
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
