# WildINTEL Uploader — User Manual (command line)

The `wildintel-uploader` command does part of what the [web app](user-manual-web.md) does, from a
terminal: test the connection to Trapper, find its ids, change the settings, and import a
deployment.

The command line and the web app are two faces of one application: they share **the same
settings and the same log**, and the deployments they import end up in the same collections
folder. The [common part of the manual](user-manual.md) explains what they share — the
installation, the concepts and the folders and files; `wildintel-uploader config path` prints where
they are on your machine.

!!! warning "The web app does more"
    The command line is the app's first, simpler flow. It **does not** run the validation and
    postvalidation checks, preprocess the images (rename, resize, metadata), seal the deployment,
    import a session, upload the deployment's images, or sync collections. For anything beyond
    a quick import into Trapper, use the [web app](user-manual-web.md).

---

## Table of Contents

1. [Running it](#1-running-it)
2. [Getting started](#2-getting-started)
3. [Settings](#3-settings)
4. [Finding the ids](#4-finding-the-ids)
5. [Importing a deployment](#5-importing-a-deployment)
6. [Command reference](#6-command-reference)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Running it

The command line is in the same package as the web app — see
[Installation](user-manual.md#1-installation) in the common part. Run with no arguments, the
package opens the web app; run with any, it's the command line:

<div class="termy">

```console
// Linux
$ ./wildintel-uploader-X.Y.Z-linux-x86_64.AppImage --help
// Windows
$ wildintel-uploader-X.Y.Z-windows-x64.exe --help
// macOS
$ ./wildintel-uploader --help
```

</div>

Rename it, or link it into your `PATH` as `wildintel-uploader`, to type less. This manual writes
it as `wildintel-uploader`.

From the source code (see the developer manual), `uv run wildintel-uploader …` runs it too.

Every command has its `--help`: `wildintel-uploader import-deployment --help`.

## 2. Getting started

Tell it where Trapper is and who you are — once. The values are saved in `settings.toml`, shared
with the web app:

<div class="termy">

```console
$ wildintel-uploader config set TRAPPER.base_url https://trapper.example.org
✔ TRAPPER.base_url saved.
$ wildintel-uploader config set TRAPPER.user_name field.team@example.org
✔ TRAPPER.user_name saved.
// The password is asked for, and not shown
$ wildintel-uploader config set TRAPPER.user_password
TRAPPER.user_password:
✔ TRAPPER.user_password saved.
$ wildintel-uploader test-connection
✔ Trapper https://trapper.example.org as field.team@example.org — 3 research project(s)
```

</div>

The Trapper username is the **email** of your account — Trapper's import form only accepts that.

## 3. Settings

`wildintel-uploader config` is the command-line face of the web app's ⚙️ page: the same
`settings.toml`.

<div class="termy">

```console
$ wildintel-uploader config show
GENERAL
  GENERAL.log_level   INFO
  GENERAL.workers     4
TRAPPER
  TRAPPER.base_url       https://trapper.example.org
  TRAPPER.user_name      field.team@example.org
  TRAPPER.user_password  (saved)
DATA
  DATA.dir   —
…
/home/me/.config/wildintel-uploader/settings.toml

$ wildintel-uploader config path
Settings:  /home/me/.config/wildintel-uploader/settings.toml
Log:       /home/me/.config/wildintel-uploader/logs/wildintel-uploader.log
Data:      /home/me/Documents/wildintel-uploader
Collections: /home/me/Documents/wildintel-uploader/collections
```

</div>

`config show` lists **every** setting — the password only ever as *(saved)* or *(not set)* — and
the file it read. `config path` says where the settings, the log, the app's data folder and the
collections folder are.

`config set SECTION.field [VALUE]` changes one. Leave the value out to be asked for it — it is the
way to set a password without leaving it in your shell's history. An empty value clears a setting:

<div class="termy">

```console
$ wildintel-uploader config set DATA.dir ~/camera-traps
✔ DATA.dir saved.
$ wildintel-uploader config set PREPROCESSING.resize_width 1920
✔ PREPROCESSING.resize_width saved.
$ wildintel-uploader config set DATA.dir relative/path
✘  Invalid DATA.dir: Value error, must be an absolute path (or start with ~).
```

</div>

The sections are `GENERAL`, `TRAPPER`, `DATA`, `VALIDATION`, `POSTVALIDATION` and
`PREPROCESSING`; each setting is described in the
[web manual's Settings](user-manual-web.md#2-settings). A value is checked before it is saved. The
file can also be edited by hand.

Which settings file is in use (the web app lets you keep several) is the one chosen there; the
command line follows it.

## 4. Finding the ids

`import-deployment` is interactive and asks you to pick from lists, so you rarely need an id. The
`trapper` commands list them — handy for a script, or to check what the account can see:

<div class="termy">

```console
$ wildintel-uploader trapper research-projects
Research projects
┏━━━━┳━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━┓
┃ pk ┃ Name                  ┃ Acronym ┃
┡━━━━╇━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━┩
│ 3  │ Doñana National Park  │ DONA    │
│ 7  │ Sierra Nevada         │ SNEV    │
└────┴───────────────────────┴─────────┘

$ wildintel-uploader trapper classification-projects --rp 3
Classification projects
┏━━━━┳━━━━━━━━━━━━━┳━━━━━━━━┓
┃ pk ┃ Name        ┃ Active ┃
┡━━━━╇━━━━━━━━━━━━━╇━━━━━━━━┩
│ 12 │ DONA-2024   │ True   │
└────┴─────────────┴────────┘

$ wildintel-uploader trapper locations --rp 3
Locations
┏━━━━━┳━━━━━━━━━━━━━┳━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━┓
┃ pk  ┃ Location id ┃ Name         ┃ Timezone      ┃
┡━━━━━╇━━━━━━━━━━━━━╇━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━┩
│ 101 │ dona_01     │ Doñana site 1│ Europe/Madrid │
└─────┴─────────────┴──────────────┴───────────────┘
```

</div>

`--rp` is short for `--research-project`. A value that Trapper doesn't have shows as `—`.

## 5. Importing a deployment

`import-deployment` walks through the import by asking:

<div class="termy">

```console
$ wildintel-uploader import-deployment
╭──────────────────────── Import deployment ────────────────────────╮
│ This copies your images to this app's own data folder before doing │
│ anything else — nothing in the source folder is changed or moved.  │
│                                                                    │
│ Copy the images from the camera's memory card to a local folder    │
│ first — don't point this at the card itself.                       │
╰────────────────────────────────────────────────────────────────────╯
Continue? [Y/n]: y
// Pick from the numbered lists
Research project — number: 1
Classification project (optional) — number: 2
Location — number: 1
Source images folder: ~/Pictures/R0003-DONA_01
  241 file(s), 241 image(s) with a readable date range:
  2024-09-04T13:10:00 → 2024-10-12T07:02:41
Revision number (1, 2, 3…): 3
  Deployment id: R0003-DONA_01
Timezone (IANA, e.g. Europe/Madrid) [Europe/Madrid]:
Latitude (decimal degrees, WGS84, -90..90): 37.0
Longitude (decimal degrees, WGS84, -180..180): -6.4
Start date (local time, YYYY-MM-DDThh:mm:ss) [2024-09-04T13:10:00]:
End date (local time, YYYY-MM-DDThh:mm:ss) [2024-10-12T07:02:41]:
Camera model [Reconyx HyperFire 2]:
Fill in the rest of the deployment fields now? [y/N]: n
╭────────────────────── Ready to import ─────────────────────╮
│ R0003-DONA_01 at DONA_01 — 2024-09-04T13:10:00+02:00 → …   │
╰─────────────────────────────────────────────────────────────╯
Proceed? [Y/n]: y
  [1/241] IMG_0001.JPG
  [2/241] IMG_0002.JPG
  …
  Registering the deployment in Trapper…
✔  Imported — images organized in /home/me/Documents/wildintel-uploader/collections/DONA/R0003/R0003-DONA_01
```

</div>

What it asks, in order:

1. **Research project**, **classification project** (optional — pick *(none)*) and **location**,
   from your Trapper account.
2. **Source images folder** — it reports how many files and images it found, then reads their
   capture dates and camera, and reports the date range and any warnings.
3. **Revision number** — the deployment id (`R0003-DONA_01`) is built from it and the location.
4. **Timezone**, **latitude**, **longitude**, **start** and **end** dates (the camera's local
   time) and **camera model**, with the guesses from the images as defaults. The dates are stamped
   with the timezone's offset.
5. Whether to fill in **the rest of the fields** now — set up by, camera id, coordinate
   uncertainty, delay, height, depth, tilt, heading, detection distance, bait, feature type,
   habitat, deployment groups and comments. Press Enter to leave any of them blank.

Then the images are **copied** into the collections folder —
`collections/<research project>/<R0003>/<deployment id>` — with `deployment.json` and the
collection's own metadata beside them, and the deployment is **registered in Trapper**. The fields
are validated as in the web app: dates in order, coordinates in range, height or depth but not
both.

!!! info "Compared with the web app's import"
    Here the images are **copied as they are**: not renamed, resized or tagged, and none of the
    validation or postvalidation checks is run. The web app's wizard does all of that, seals the
    deployment, and can then upload it. Deployments imported from the command line aren't
    *preprocessed*, so the web app's **Upload** page refuses them.

Exit codes: `0` on success — also if you answer **n** to *Continue?* or *Proceed?* —, `1` on any
error, printed as `✘  …` on the standard error.

## 6. Command reference

| Command | What it does |
|---|---|
| `wildintel-uploader --version` | Shows the version. |
| `wildintel-uploader -v …` | Any command, showing the log's messages as it works (otherwise only warnings). |
| `test-connection` (`tc`) | Tests the connection to Trapper with the account in the settings. |
| `config show` | Shows every setting. |
| `config path` | Where the settings, the log and the data are. |
| `config set KEY [VALUE]` | Changes one setting; asks for the value if it's left out. |
| `trapper research-projects` | The research projects the account can see. |
| `trapper classification-projects --rp PK` | A research project's classification projects. |
| `trapper locations --rp PK` | A research project's locations, with their timezones. |
| `import-deployment` | Imports a deployment, interactively — see [above](#5-importing-a-deployment). |

## 7. Troubleshooting

**`✘  Missing Trapper username, password — …`**
:   A Trapper setting is missing — it names which. Set the URL, the username and the password as in
    [Getting started](#2-getting-started).

**`✘  Incorrect Trapper username or password.`**
:   The username is the **email** of your account. Check with `config show` and set it again.

**`✘  Could not connect to the Trapper server: …`**
:   Wrong URL (it needs `https://`), or the server is down or unreachable from your network.

**`✘  No setting X.y. See: wildintel-uploader config show`**
:   The key doesn't exist: it is `SECTION.field`, in the section's own case — `TRAPPER.base_url`.

**`✘  Nothing to choose from.`**
:   The account sees no research project, or the research project has no location. Create them in
    Trapper first, or check the account's permissions.

**A deployment was copied but Trapper refused it**
:   Trapper refuses a deployment that already exists with that id. What was copied isn't undone: it
    is in the collections folder, and importing the same revision again would be refused locally
    too — choose another revision or move the folder away.

**More detail**
:   Run any command with `-v` to see the log as it works, or read the log file
    (`config path` says where).
