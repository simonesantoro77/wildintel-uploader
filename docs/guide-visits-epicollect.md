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
