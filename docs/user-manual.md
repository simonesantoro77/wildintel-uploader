# WildINTEL Uploader — User Manual

**WildINTEL Uploader** is an application for camera-trap projects. It takes a set of images — copied off the camera's 
memory card —, checks them, organizes them in a local folder with their metadata (renamed, resized, tagged with 
authorship and license and sealed), and sends them to different camera-trap projects like [Trapper](https://gitlab.com/trapper-project/trapper). 
It runs on your own  computer, nothing leaves it but what you send to the Trapper server you configure, and it comes in
two faces that share the same settings, the same log and the same collections folder:

- a **web application**, with a guided interface in your browser — the complete one;
- a **command line**, for the quick jobs.

---

## Table of Contents

1. [Installation](#1-installation)
2. [General concepts: deployments, locations, revisions and collections](#2-general-concepts-deployments-locations-revisions-and-collections)
3. [The folders and files it creates](#3-the-folders-and-files-it-creates)
4. [Where to go next](#4-where-to-go-next)

---

## 1. Installation

Download the file for your system from the
[releases page](https://github.com/wildintelproject/wildintel-uploader/releases). 

=== "Linux"

    Download `wildintel-uploader-X.Y.Z-linux-x86_64.AppImage`, make it executable and run it:

    <div class="termy">

    ```console
    $ chmod +x wildintel-uploader-X.Y.Z-linux-x86_64.AppImage
    $ ./wildintel-uploader-X.Y.Z-linux-x86_64.AppImage
    ```

    </div>

=== "Windows"

    Download `wildintel-uploader-X.Y.Z-windows-x64.exe` and double-click it. If Windows SmartScreen
    warns that the publisher is unknown, choose **More info → Run anyway**.

=== "macOS"

    Download `wildintel-uploader-X.Y.Z-macos-arm64.dmg` (Apple Silicon), open it and copy
    `wildintel-uploader` out of it to a folder of your own (for example *Applications* or your home folder).

    !!! warning "The app isn't signed by an Apple developer"
        macOS blocks what it can't verify, so the first time it will refuse to open it ("Apple could not
        verify…"). Either:

        - Try to open it once, then go to **System Settings › Privacy & Security**, scroll down to the
          message about `wildintel-uploader` and press **Open Anyway**; or
        - remove the quarantine mark from a terminal, once, and run it:

        <div class="termy">

        ```console
        $ xattr -d com.apple.quarantine ./wildintel-uploader
        $ chmod +x ./wildintel-uploader
        $ ./wildintel-uploader
        ```

        </div>

!!! tip "Running it from the source code"
    To run the app from its source code — or to change it — see the
    [developer manual](developer-manual.md#2-development-setup).

One download gives you both the web application and the command line.

## 2. General concepts: deployments, locations, revisions and collections

Before explaining how the application works, it is necessary to clarify the following concepts.

A **deployment** is the set of images taken by one camera placed at a **location** — some GPS
coordinates and a timezone — under specific configuration conditions (height, tilt, delay between
triggers…), between the day it was set up and the day it was collected. A location is visited again
and again, so each visit is a **revision** — the 1st, the 2nd, the 3rd one. All the deployments of a
revision form a **collection**: *collection* and *revision* are synonyms. The app names everything after that:

| | Example | |
|---|---|---|
| Revision | `3` | |
| Location id | `DONA_01` | |
| **Deployment id** | `R0003-DONA_01` | `R` + the revision as four digits + `-` + the location id |
| **Collection** | `R0003` | the name of a revision: `R` + its number as four digits — all its deployments |
| Research project | `DONA` | the project they all belong to, by its acronym |

The deployment id is never typed: you give the revision and the location, and the app builds it.

### The location owns the timezone

A camera's clock has no timezone of its own: its images say "13:10", and the same camera,
elsewhere, would say it too. So the **timezone** (and whether the cameras there **ignore summer
time**) belongs to the **location**, never to a deployment. They are asked for when a location is
added, and every deployment there is read in them. The deployment's details say it before you fill anything in. A location
without a timezone is reported — the app doesn't guess one.

## 3. The folders and files it creates

As said before, the application runs locally and stores all the information it needs in a series of files and folders.

### The collections folder

Imported deployments are kept in your **collections folder** until they are uploaded — by default
`Documents/wildintel-uploader/collections`:

```text
collections/
└── DONA/                                   ← research project
    ├── research_project.json
    ├── locations.json                      ← its locations, with timezone and coordinates
    └── R0003/                              ← collection (one revision)
        ├── collection.json
        ├── R0003_FileTimestampLog.csv      ← the start and end of each deployment
        └── R0003-DONA_01/                  ← deployment
            ├── R0003-DONA_01__20240904_1.JPEG …    the images
            ├── deployment.json             ← its details
            ├── images.json                 ← what is known of each image
            ├── preprocessing.json          ← what was done to each image
            ├── seal.json                   ← what was checked, tied to the content
            └── upload.json                 ← written once it has been uploaded
```

Your **source folder is never touched**: the images are copied, and the copy is what gets renamed,
resized and tagged.

!!! warning "Copy the images off the camera's memory card first"
    Point the app at a folder on your computer, not at the memory card. The app only *reads* the
    source folder, but working from the card is slow and risks losing files if it is removed
    half-way.

### The rest of the app's folders

| What | Where |
|---|---|
| Settings | `settings.toml` in the app's config folder: `~/.config/wildintel-uploader/` (Linux), `%APPDATA%\wildintel-uploader\` (Windows), `~/Library/Application Support/wildintel-uploader/` (macOS). More configs in `configs/` there. |
| Log | `logs/wildintel-uploader.log` next to it. |
| Collections | `Documents/wildintel-uploader/collections/` (or *Images folder* of the settings). |
| Packages to upload | `Documents/wildintel-uploader/packages/`. |
| Unfinished runs | `Documents/wildintel-uploader/sessions/`. |
| Reports | `Documents/wildintel-uploader/reports/` — one JSON file each. |

## 4. Where to go next

| If you want to… | Read |
|---|---|
| Do everything — import, upload, repair, sync — with a guided interface | [User manual — web app](user-manual-web.md) |
| Test the connection, change the settings, look up Trapper's ids or make a quick import from a terminal | [User manual — command line](user-manual-cli.md) |
| Know what the application does, in detail | [Features](features.md) |
