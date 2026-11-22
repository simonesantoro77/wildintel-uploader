# Guide — Import the visits from the WildINTEL Epicollect CSV

This guide takes you, step by step, from the data collected in the field with the **WildINTEL Epicollect form** to the visits registered in the application. It is the way to register **many visits at once**: a whole revision (one visit to every site) comes in one file.

!!! info "What this guide is, and is not"
    It is a walk-through of one task. What each screen and each rule means is in the [web manual](user-manual-web.md#5-register-the-visits), and the ideas behind it — visits, revisions, deployments — in the [general concepts](user-manual.md#26-visits-and-revisions). For a CSV that does not come from the WildINTEL form, see [the guide for a custom CSV](guide-visits-csv.md).

## Before you start

You need:

- **A research project** with its **locations** already defined. A site named in the file that is not a location of the project is held until you create it (see [step 6](#6-check-the-result)).
- **The trappers, cameras and SD cards** the file names, registered in *Settings › Entities* — or, if you prefer, let the import create them (see [step 4](#4-choose-what-the-import-may-create)).
- **The CSV file downloaded from the Epicollect5 project** of the WildINTEL form, one file per round of visits.

!!! tip "Load the revisions in order"
    A revision does not start until the one before it is finished (every expected site has its visit), and the visits of a revision are after those of the revisions before. So load the files **from the oldest to the newest**.

## The format of the file

The file is the download of the form **Cameratrap visit** of the WildINTEL Epicollect5 project. Knowing what it has helps to read what the application says about a row, and to tell why a row is refused.

### How it is laid out

- **One row is one visit** — one entry of the form: one trip to one camera trap.
- The first row is the header. Epicollect5 writes each question as **its number, an underscore and its text** — `3_locationID`, `4_Status_of_the_came` — and **cuts it at 20 characters**. The application finds each column by the text of its question, ignoring the number, the case, the marks and the cut, so `7_N_pictures_collect` and `7_N_pictures_collected` are the same column.
- A **place** (the question *Coordinates*) comes in several columns: `lat_25_Coordinates`, `long_25_Coordinates`, `accuracy_25_Coordinates` and the UTM ones.
- Epicollect5 adds its own columns to every entry: `ec5_uuid`, `created_at`, `uploaded_at`, `created_by` and `title`.
- The form **has no date and no time**. A visit happened **when its entry was created**: `created_at`, in UTC, as Epicollect writes it (`2026-09-14T08:30:00.000Z`).

!!! warning "The columns a file must have"
    Without a column for **`locationID`**, **`Status of the camera`** and **`created_at`** the file is refused as a whole — it is not the form of a visit. A column that is missing from the rest is a field left blank: the row is kept or refused according to its actions (see [the rules of a visit](user-manual-web.md#the-rules-of-a-visit)).

### The columns, and what each one means

What a blank answer means is always the same: the field is not kept, and the rules of the visit say whether it was needed.

| Column (as Epicollect writes it) | What it is | How the application reads it |
|---|---|---|
| `1_setupBy` | Who went. One or several names, separated by commas. | **Who went** (`trappers`). The first name is also **set up by**. Each must be a trapper of the settings, or be created by the import. |
| `2_Revision` | The round of visits: `R0001`, `R0002`… | The **revision** of the visit. Blank: the next one of its site. |
| `3_locationID` | The site visited, written by hand: `WICP_02_001`. | The **site**. It must be a location of the research project, or be created. Whatever its case. |
| `4_Status_of_the_came` | What was found at the site: **OK**, **Altered**, **Stolen**, **New site** or **Inactive site**. | With the next two columns, it gives the **actions** of the visit (see [below](#from-the-answers-to-the-actions)). **New site** also **starts the site** and, with the import allowed to, creates it. |
| `5_Batteries_Status` | **OK** or **No batteries**. | The state of the **batteries**. |
| `6_Card_Status` | **OK** or **Full Card**. | The state of the **card**. With the card full the images are not counted. |
| `7_N_pictures_collect` | The number of images on the card that was collected. | **Images on the card collected**: a whole number. Empty when the card was full. |
| `8_Date_and_time_OK` | Whether the camera's clock was right. | Yes if the answer begins with *OK*, no otherwise. |
| `9_Action_after_inspe` | What is done once the camera has been inspected: *Keep the camera*, *Camera replacement*, *Camera removal* or *Site removal* (*Camera inspection*, an older name for the first, is read too). | The **actions** (see [below](#from-the-answers-to-the-actions)). |
| `10_Action_after_thef` | What is done after a theft: *Camera replacement*, *Site removal*, *Camera removal* or *None*. | The **actions** after a theft. Only asked when the status is *Stolen*. |
| `11_cameraModel` | The model of the camera put up. | **Camera model**. Used when the camera is created. |
| `12_Camera_name` | The name the camera is known by. | The **camera id**, when there is no serial number. |
| `13_Serial_number` | The serial number of the camera put up. | The **camera id**. It must be a camera of the project, or be created. |
| `14_cameraHeight` | Height of the camera, **in centimetres**. | **Camera height**, kept **in metres**: `120` is `1.2`. |
| `15_cameraDelay` | Delay between triggers, in seconds. | **Camera delay** (s). |
| `16_cameraTilt` | Tilt of the camera, in degrees. | **Camera tilt** (°). |
| `17_cameraHeading` | Heading of the camera, in degrees. | **Camera heading** (°). |
| `18_detectionDistance` | Detection distance, in metres. | **Detection distance** (m). |
| `19_baitUse` | Whether bait is used: *true*/*false*. | **Bait use** (yes/no). |
| `20_featureType` | The kind of place the camera watches: `trailHiking`… | **Feature type**. |
| `21_habitat` | The habitat. | **Habitat**. |
| `22_SD_to_insert` | The card left in the camera, written by hand: `SD 1`, `sd-1` or `1`. | The **SD card left**: only its **number** is kept (`1`), whatever the way it is written. |
| `23_Calibration` | Whether the camera was calibrated: *yes*/*no*. | **Camera calibrated** (yes/no). |
| `24_Observations` | Free notes. | The **notes** of the visit. |
| `lat_25_Coordinates`, `long_25_Coordinates` | Where the trapper was when the visit was noted. | The **coordinates of the visit**. They are the only ones the form has: a site made from a visit takes them as its own. |
| `created_at` | When the entry was created, in UTC. | The **day and the time** of the visit, told in the timezone of its location. |

**The columns that are not read:** `ec5_uuid`, `uploaded_at`, `created_by`, `title`, `accuracy_25_Coordinates`, and the UTM columns. They can be in the file; they are ignored.

!!! note "The numbers in the headers"
    The numbers (`1_`, `2_`…) are those of the form of the example files. Another version of the form may number the questions differently, or change the order: it does not matter, because the number is ignored. What matters is the **text** of the question. A column whose text the application does not know is ignored.

### From the answers to the actions

The form never asks *what was done* as such: the application works it out from three answers, with one rule.

| Status of the camera | Action after the inspection / after the theft | The visit's actions |
|---|---|---|
| **New site** or **Inactive site** | — (not asked) | **Installation** |
| **OK** or **Altered** | *Keep the camera* | **Revision** (the card is collected and another left) |
| **OK** or **Altered** | *Camera replacement* | **Revision + Desinstallation + Installation** |
| **OK** or **Altered** | *Camera removal* | **Revision + Desinstallation** |
| **OK** or **Altered** | *Site removal* | **Revision + Desinstallation + Archive** |
| **Stolen** | *Camera replacement* | **Stolen + Installation** |
| **Stolen** | *Site removal* | **Stolen + Archive** |
| **Stolen** | *Camera removal* or *None* | **Stolen** (the site stays open, with no camera) |

- **New site** is a site that did not exist: it is created on the spot, with its camera. **Inactive site** is a site that exists but **has no camera** — it was taken away before — and gets one. Both ask the same questions: the camera and the card it leaves.
- A status or an action that is none of these leaves the visit **with no actions**, and the row is refused.
- **Altered** says the camera was found altered and put back in place; it does not change the actions.

### What the answers about the card and the batteries do

The batteries and the card are two questions. Their answers are kept as the **state of the batteries** (OK or *No batteries*) and the **state of the card** (OK or *Card full*). When the card is full, the images are not counted: `7_N_pictures_collect` is empty and the deployment is not checked against a count it does not have.

## 1. Download the CSV from Epicollect5

1. Open the project of the WildINTEL form on [Epicollect5](https://five.epicollect.net/) and go to its **data** (the entries).
2. Choose **Download** and, as the format, **CSV**, with the entries of the form that has the visits.
3. Save the file. **Do not edit it, rename its columns or open and save it again in a spreadsheet**: the application finds each column by the label of its question (`3_locationID`, `4_Status_of_the_came`, `22_SD_to_insert`…), and a spreadsheet can change dates, accents and separators.

!!! note "Nothing to map"
    The columns of this form are known, so unlike a custom CSV **no mapping is asked**.

## 2. Turn the source on

Open **Settings › Visit sources › WildINTEL Epicollect CSV** and check that **Use WildINTEL Epicollect CSV** is on (a green dot appears on the tab). A source that is off is not offered when you register the visits. Save the settings.

## 3. Open *Register the visits*

From the task menu press **Register the visits**, pick the **research project** (the default one comes selected) and, as the way the visits come in, **WildINTEL Epicollect CSV**.

Drop the file in the file area, or browse for it. Choosing the file does **not** move on: the step stays open so that you can set the rules of the import.

## 4. Choose what the import may create

The card **Import & auto-creation rules** summarizes the options; **Customize** opens them. They are switches:

| Switch | What it does |
|---|---|
| **Create the locations** | A site the file names that is not a location of the project is created, **at the place of its first visit**. It asks the **timezone of the new locations** — the form does not say it (UTC by default) — and, if it is not UTC, whether **their cameras follow summer time**. |
| **Create the cameras** / **Create the SD cards** | The cameras and cards the file names and the project does not have are made. |
| **Create the trappers** | The people the file says went are made as the row calls them (`Ana Pérez` becomes `ana.perez`); complete them later in *Settings › Trappers*. |
| *The photos were not counted* | Accepts a Revision or a Desinstallation with no image count (an old datasheet), leaving the count empty. |
| *Use the coordinates of the location…* | A row with no coordinates takes those of its location. |
| *Close the revision before…* | When the revision before has locations still planned, they are marked as *Not revised* so the new revision can start. |

For this form **they are all marked at first**; the expanded card has a switch to mark or clear them all. Clear the ones you do not want: for example, with every location, camera and card already in Settings, you may prefer that a misspelt id is **refused** and not created as a new one.

Press **Done** to close the options and **Continue**.

## 5. Wait for the check

The file is checked when you press **Continue**. A long history can take some minutes; while it runs the page shows only that the file is being checked.

!!! info "How a visit gets its date"
    The form has no date or time: a visit happened **when its entry was created** (`created_at`, UTC), and it is told in the timezone of its location.

## 6. Check the result

First the page says what the file holds: *N visits to add · N already kept · N rows with a problem*, the new sites, what is **worth knowing** and what is **odd**. Below, the rows are laid out like a dashboard:

- **Revision selection** — *All revisions* and one card for each revision of the file. Pick one to narrow the rows.
- **Status metrics & filters** — *Rows read*, *Ready*, *Skipped / Existing* and *With problems*. Press one to see only those rows.
- **The table** — search, **Group by** *Row* or *Error*, and, for each row, its **Status**: *Add*, *Add · to check*, *Skipped / Existing*, *Skipped / Ignored* or *Error*. The **chevron** opens the errors of a row; the **eye** opens a panel with the row field by field.

What to do with what you find:

- **A row with a problem is not kept.** Each rule that is broken has a label of its own (*Visit not after the last one of the site*, *Revision started before the one before is finished*, *Not the camera at the site*…): they are listed in [the rules of a visit](user-manual-web.md#the-rules-of-a-visit). Correct the cause — in the project's settings, or in the data in Epicollect — and read the file again.
- **A site that is not a location.** It may be a new site or a misprint. The page shows how far its first visit was from the nearest location and the locations whose id is one character apart. If it is new, turn on **Create the locations** (step 4) or create it in *Settings › Locations*; if it is a misprint, correct the id and read the file again.
- **The revision before is not finished.** A notice says which revision and which sites are missing, and offers **Mark them as not visited and read again**. That closes the revision before, which cannot be changed afterwards.
- **A row already kept** (the same revision and site) is left as it is.

Open **Worth knowing** to read it: sites visited on the trip before but not on this one (their cameras are still out), visits where nothing was collected, and a jump in the revision numbers are told there, and none of them is an error.

When the rows are what you expected, press **Continue to the review**.

## 7. Review and confirm

The last step says **what is going to be saved** — the visits, the revisions and sites, and the locations, cameras, SD cards and trappers that will be created — and warns that **the visits cannot be changed once they are created**. Press **Add N visits**.

Afterwards the step turns green (*Visits saved*). Open **What was saved** for the summary. A **report** of the import is written beside the visits (`visits_import_<day>_<time>.txt`), and the folder of every collection the visits touch is made, with its logs.

## 8. What next

- Open the **Visit dashboard** to see each revision and the state of every visit.
- If the visits **collected** SD cards, the page offers **pick their revision and import their images**, a link to [Import deployment](user-manual-web.md#import-a-deployment) on the research project. **Show the deployments** lists, by collection, the closed deployments and the ones whose camera is still out.
- A mistake in a visit that is already kept is corrected from the dashboard, with the same rules checked.

## Common problems

| What you see | What it means |
|---|---|
| *Luis Gómez is not one of the trappers*, and every revision after it refused | The trapper is not registered. Add it in *Settings › Trappers*, or turn on **Create the trappers**. |
| *Camera not in the research project* / *SD card not in the research project* | Register it in *Settings › Entities*, or turn on the matching switch of step 4. Remember that **the case counts** for a camera and a card: `7b` and `7B` are two cards. |
| *R0043 cannot start: R0042 is not finished* | The revision before has sites with no visit. Load its file first, or use **Mark them as not visited and read again**. |
| *First visit is not an Installation* | The first visit to a site puts the camera up. In the form that is *New site* (or *Inactive site*, for a site that has no camera and gets one). |
| The file is refused as a whole | The columns are not those of the WildINTEL form: it may have been edited, or be from another project. Use [a custom CSV](guide-visits-csv.md) instead. |

## Try it with the examples

The folder [`examples/visits_example/wildintel_csv/wicp_02`](https://github.com/wildintelproject/wildintel-uploader/tree/main/examples/visits_example/wildintel_csv/wicp_02) has one download of the form for each revision — the installation, a revision with no problems, a theft with the camera replaced, a theft with none, what is done after an inspection and a new site made on the spot — with a README that says what to expect from each. They are made for the entities in [`examples/entities_example/wicp_02`](https://github.com/wildintelproject/wildintel-uploader/tree/main/examples/entities_example/wicp_02): import them first, with the research project `WICP_02` picked, and load the files **in order** on a project with no visits.
