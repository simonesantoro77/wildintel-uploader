# Guide – Convert your field history to the WildINTEL Epicollect CSV

This guide is for a research project that has **visits from before the WildINTEL Epicollect form**, kept in a field datasheet. To load them, the datasheet is written in the **same format the form downloads**, and then read once, as [the guide for the WildINTEL Epicollect CSV](guide-visits-epicollect.md) says. After that, every field trip comes from the form and nothing is converted any more.

!!! info "The examples"
    The folder [`examples/visits_example/wildintel_csv/history`](https://github.com/wildintelproject/wildintel-uploader/tree/development/examples/visits_example/wildintel_csv/history) has a made-up history of 5 sites and 5 revisions with every case of this guide, twice: `old_datasheet.csv`, in the common WildINTEL field datasheet, and `converted.csv`, the same history in the format of the form. The converted file loads with no problems: 21 visits. Open both side by side while you read.

If your datasheet is not the common WildINTEL one (`Trappers, Session, Date, Time, DateTime, Site, Camera, Action, Status, CardBatteriesOK, NumPhotos, SD, DateTimeOK, Notes, Longitude, Latitude`), or a case below does not fit, ask before converting.

## 1. One row per visit

A **visit** is one site in one revision, and it is **one row** of the new file. Group the rows of the datasheet by **Session** and **Site**: most groups are one row. Two rows of the same site and revision (a camera changed: a *Desinstallation* and an *Installation*; or stolen and replaced: *Stolen* and *Installation*) are **one visit**.

What the visit did is said by three columns, as the form says it (see [from the answers to the actions](guide-visits-epicollect.md#from-the-answers-to-the-actions)):

| Rows of the datasheet (same site and revision) | `4_Status_of_the_came` | `9_Action_after_inspe` | `10_Action_after_thef` |
|---|---|---|---|
| *Installation*, the first visit ever to the site | **New site** | | |
| *Installation* at a site whose camera was taken away before | **Inactive site** | | |
| *Revision* | **OK** or **Altered** | **Keep the camera** | |
| *Desinstallation* + *Installation* | **OK** or **Altered** | **Camera replacement** | |
| *Desinstallation*, the site is visited again later | **OK** or **Altered** | **Camera removal** | |
| *Desinstallation*, the site is given up | **OK** or **Altered** | **Site removal** | |
| *Stolen* + *Installation* | **Stolen** | | **Camera replacement** |
| *Stolen*, nothing put up, the site stays open | **Stolen** | | **None** |
| *Stolen*, the site is given up | **Stolen** | | **Site removal** |

!!! warning "Taken away, or given up?"
    In the middle of the history the later rows tell it: if the site is visited again, the camera was only taken away (*Camera removal*, *None*); if not, the site was given up (*Site removal*). In the **last revision** of the history nobody can tell from the file: decide it yourself. A site given up is **archived** and gets no more visits.

For example, in `R0003` the site `EXAM_0002` has two rows in the datasheet: a *Desinstallation* of camera `12` (640 images) and an *Installation* of camera `16` with the card `2c`. The converted file has one row: status **OK**, action **Camera replacement**, `640` images, camera name `16`, card `2c`.

## 2. The columns

Keep the header of `converted.csv` as it is: the names are those Epicollect5 writes. Leave a cell **empty** when it does not apply. What each column means is in [the columns, and what each one means](guide-visits-epicollect.md#the-columns-and-what-each-one-means); here, only what to write from the datasheet.

| Column | What to write | From the datasheet |
|---|---|---|
| `ec5_uuid` | Any text, different in each row. | |
| `created_at` | The date and time of the visit **in UTC**: `2025-04-14T07:10:00.000Z` (see [step 3](#3-the-time-in-utc)). | *Date*, *Time* |
| `uploaded_at`, `created_by`, `title` | Anything, or empty: they are not read. | |
| `1_setupBy` | Who went, separated by commas. | *Trappers* |
| `2_Revision` | `R0001`, `R0002`… | *Session* |
| `3_locationID` | The site, written as the location of the research project. | *Site* |
| `4_Status_of_the_came` | See [step 1](#1-one-row-per-visit). **Altered** also for a camera knocked down: say it in the observations. | *Action*, *Status* |
| `5_Batteries_Status` | **OK** or **No batteries**, when a camera was found. | *CardBatteriesOK* |
| `6_Card_Status` | **OK** or **Full Card**, when a camera was found. | *CardBatteriesOK* |
| `7_N_pictures_collect` | The images on the card collected. **Empty** when the card was full, or nobody counted them. | *NumPhotos* |
| `8_Date_and_time_OK` | **OK** when the clock of the camera was right; anything else when not. | *DateTimeOK* |
| `9_Action_after_inspe`, `10_Action_after_thef` | See [step 1](#1-one-row-per-visit). | *Action* |
| `12_Camera_name` | The camera **put up** by the visit (*New site*, *Inactive site*, *Camera replacement*). Empty in a visit that keeps the camera: the application knows which camera is there. | *Camera* |
| `13_Serial_number` | The serial number of that camera, if you know it: it is then its id. | |
| `11_cameraModel`, `14_cameraHeight` … `21_habitat` | Optional, only when a camera is put up. The height in **centimetres**. | *Notes*, if there |
| `22_SD_to_insert` | The card **left** in the camera. Empty when no camera is left. | *SD* |
| `23_Calibration` | **No**, or **Yes** when calibration images were taken. | |
| `24_Observations` | Free notes. With two rows of the datasheet, both notes. | *Notes* |
| `lat_25_Coordinates`, `long_25_Coordinates` | Where the visit was, in decimal degrees. Empty: those of the location. | *Latitude*, *Longitude* |
| `accuracy_25_Coordinates` and the UTM columns | Empty. | |

## 3. The time in UTC

The form keeps the moment of a visit in `created_at`, **in UTC**. If the times of the datasheet are **local**, they are converted: in Central Europe, **one hour less in winter** (CET) and **two in summer** (CEST, from the last Sunday of March to the last Sunday of October). In the example, 14 April 2025 at 09:10 in Poland is `2025-04-14T07:10:00.000Z`. A datasheet already in UTC only needs the date and the time joined in that format.

In a spreadsheet, with the date in `A2` and the time in `B2` (in summer `2/24` instead of `1/24`; in some languages the separator is `;`):

```text
=TEXT(A2+B2-1/24,"yyyy-mm-dd")&"T"&TEXT(A2+B2-1/24,"hh:mm:ss")&".000Z"
```

Save the result as **CSV in UTF-8**.

!!! tip "The common datasheet, converted for you"
    For the common WildINTEL datasheet, saved as CSV, `tools/convert_field_datasheet.py` does steps 1 to 3 and lists what it could not decide:

    ```bash
    python tools/convert_field_datasheet.py old_datasheet.csv converted.csv Europe/Warsaw
    ```

    The last argument is the timezone the datasheet's times are in (`UTC` if they are in UTC). Check what it lists before loading the file.

## 4. Load it

Load the converted file as any download of the form: [the guide for the WildINTEL Epicollect CSV](guide-visits-epicollect.md), from [step 3](guide-visits-epicollect.md#3-open-register-the-visits). For a history, in **Import & auto-creation rules**:

- **Create the locations, cameras, SD cards and trappers that do not exist**, unless they are all in the settings already;
- **The images were not counted**, if some visits have no count;
- **Close the revision before…**, if a site was not visited in some revision.

The whole history is one file, and it can take some minutes to check. After it, load the downloads of the form as they come.

## Common problems

| What you see | What it means |
|---|---|
| *Site visited twice in a revision* | Two rows of the datasheet were not joined: see [step 1](#1-one-row-per-visit). |
| *First visit is not an Installation* | The first row of a site must be **New site**. |
| *Visit not after the last one of the site* | A time is wrong, or still local: see [step 3](#3-the-time-in-utc). |
| *Not the camera at the site* | A visit names a camera that is not the one put up there: check `12_Camera_name` in the visit that put it up. |
| *SD card in another camera* | The same card name is used twice: `7b` and `7B` are two cards, `7b` twice is one. |
