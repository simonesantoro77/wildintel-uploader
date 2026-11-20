# Features

## Visits and revisions

The visits to the camera traps are the field record the deployments are worked out from: who went, when, to
which site and what was done (an installation, a revision, a desinstallation, a stolen camera, a site given
up). They are entered **by hand**, or read from a **CSV file** — a field app's download, or any spreadsheet whose
columns you match to the fields of a visit — and kept in the research project's folder.

### Revisions

A **revision** is one visit to every site of a research project. A site is visited once in each, and a
revision does not start until the one before it is finished. A revision of a site of which nothing is known
(the first visit kept to it is of a later one) is **unknown**: nothing is checked against it, and a later visit
can take its place.

### The rules of a visit

A visit by hand and a visit in a file follow the same rules, and the one that breaks them is refused, with
the reason — each rule has its own label in the results of a file. They compare the visit with the visits
before it, by date: the camera and the SD card must be where the visit says (a camera is not put up where it
already is, a card is not left in two cameras), what the actions ask must be given, the visits of a site go
in order, the camera, the card and who went must exist, and nothing is done at a site after it was given up.
What an unknown revision hides cannot be checked, and is not.

### The visit dashboard

The visits of the research project, revision by revision: what is planned and what is done, the state of
each visit (planned, deployed, collected, stolen, not visited, unknown), the details of a visit, and the
deployments the visits say — the closed ones, whose images can be imported, and the ones whose camera is
still out. The deployments and the uploads have their own dashboards, with the same layout.

## Importing a deployment

### Local first

An import never touches TRAPPER: it organizes the images in a **collections folder** on your
computer — `collections/<research project>/<R0003>/<deployment id>` — and sends them later, from
the upload page. The source folder is only read; the copy is what is renamed, resized and tagged.
Nothing is lost if the SD card — or the app — goes away half-way.

### Checks before anything is copied

**Validation**, over the images alone: corrupted images, shooting order against file-name order,
folder structure, one camera for all, required EXIF fields, and duplicates (same content). Each
check can be run or not, and **required** — a required check that doesn't pass stops you.

**Postvalidation**, once the deployment is known: the id's format, its collection and location,
the camera, and the images' dates against the deployment's start and end (with a tolerance) — wildintel-tools'
own rules — and three **statistical** checks against the **earlier revisions of the same
location**: the number of images, the number of sequences and how long they are. A camera that
fired non-stop or died early shows up before it is uploaded. What a sequence is, what counts as
similar, and whether to compare with the median, the mean, the last revision or the range they
span, are settings. Revisions that were *synced* from TRAPPER count too.

### The location owns the timezone

A camera's clock has no timezone, so the **timezone** — and whether the cameras ignore summer
time — is a property of the **location**, set once and used by every deployment there. It is
never asked for again, and a location without one is reported rather than guessed.

### Deployment details

The same fields as TRAPPER's own deployment form, following
[Camtrap DP](https://camtrap-dp.tdwg.org)'s deployments table and its constraints; only the dates
are required, and the camera model and id and the dates are guessed from the images. The
revision starts as the next one expected for the location, and an earlier revision can **fill the
form in** — everything but the dates. A deployment that already exists is refused, not mixed.

When the collection has a `_FileTimestampLog.csv` — the file wildintel-tools asks for — the
dates come from it, and the app keeps that file up to date.

### Preprocessing

What wildintel-tools did to a collection before uploading it, and a bit more:

- **dates** read from the EXIF as the camera's local time — optionally ignoring summer time —
  and converted to UTC;
- **rename** to `<DEPLOYMENT>__<YYYYMMDD>_<n>.<EXT>`;
- **resize** to a width (2400 px) — and unlike wildintel-tools, the resized image is the one that
  is kept;
- **XMP metadata** with ExifTool: creator, owner, publisher, rights, license, coverage, and the
  hash of the original and of the image kept.

Each step can be switched off per run, and `preprocessing.json` records what happened to every
image.

### Reports

Every validation, postvalidation and preprocessing writes a **report**: what was checked and done, image by image — the
ones that failed, which check and why, and the ones that passed too. The step shows it as it is kept, and it can be
downloaded as a **CSV** (a row per image and check, for a spreadsheet) or as a **JSON** with everything. They are kept in
the `reports` folder, and Settings › Reports lists them to look at again or delete — what wildintel-tools' `reports` command
did with its YAML files, from the interface.

### The seal

Every import writes `seal.json`: which checks each image and the deployment passed, tied by hash
to their content. If something is edited by mistake afterwards, the seal says so. It is not a
signature, and doesn't pretend to be.

### Collections of deployments

A collection folder with one subfolder per deployment, imported in one go: the revision, the checks and the
preprocessing are common, while location, dates and camera are asked for each deployment — with a
filterable list, *next incomplete*, and filling in from the previous revision (one deployment
or all).

### Resumable runs

The wizard saves its progress. A run left unfinished is offered back when the app starts, to
resume or discard. Passwords are never saved with it.

## Uploading to TRAPPER

wildintel-tools' three commands, in one:

- the **location** and the **deployment** are created in TRAPPER if the research project doesn't
  have them — from the deployment's own coordinates and details;
- the images are **packed** in zips, split at a size, with the yaml that describes them;
- each part is **uploaded**, and TRAPPER is told to process them into the collection.

A **dry run** reads TRAPPER only and says what would be created and how the images would be
packed. **Only generate the files** writes the zips, yamls and `_deployments.csv` to leave them
for another route — with no TRAPPER account if the project is known. The upload page says
whether the account reaches the research project and the collection before anything is sent, and
**Test connection** (Settings › Trapper) checks the login.

Progress is shown per deployment, step by step, with a bar while a file goes up; if one
deployment fails the others go on. Ids are matched ignoring case, as TRAPPER keeps them in lower
case.

## Sync

For deployments TRAPPER holds that this computer doesn't know: a classification project's
collections (those starting with `R`), its research project, locations and chosen deployments are
created in the collections folder — nothing is changed in TRAPPER, nothing already there is
overwritten, and no image is downloaded unless asked for (four at a time, only those of the classification project: TRAPPER gives a file's access token only there). Their `images.json`, marked `"source": "trapper"`, is
built from what TRAPPER lists for each image, so they feed the statistical checks of later
revisions. Deployments TRAPPER holds in an invalid way are reported, not fatal.

## Repair

A deployment kept locally is **valid** when its `seal.json` still matches it. For one that isn't — lost metadata files,
images that changed — **Repair** writes `deployment.json`, `preprocessing.json`, `images.json` and `seal.json` again from
what its folder holds: the capture dates and camera of the images, the location's details and the collection's
`FileTimestampLog.csv`, which always prevails over what the images say (a deployment it doesn't have gets its row). The images
are validated, postvalidated and checked against what preprocessing leaves, and a report says what was found.

## Settings

TRAPPER account, data folder, how many images are worked on at once, which checks are shown
and what they mean, the preprocessing — all in `settings.toml`, edited from the ⚙️ page. You can keep
**several configs** (a test server and the real one) and switch between them. The log is
downloadable from there.

## Command line

`wildintel-uploader` shares the settings and log with the web app: test the connection, edit the
settings, look up TRAPPER's ids, and an interactive import that copies a deployment into the
collections folder and registers it in TRAPPER. The checks, the preprocessing, collection imports, upload
and sync are the web app's. See the [command-line manual](user-manual-cli.md).

## Differences from wildintel-tools

| wildintel-tools | WildINTEL Uploader |
|---|---|
| The resized image only fed the identifier's hash; the original was what got copied. | The resized image is the one that is kept. |
| Three commands to prepare, generate and upload a collection. | One upload — with a dry run, or just the files. |
| — | Statistical checks against the location's earlier revisions, and `images.json`, `preprocessing.json` and a seal for what was done. |
