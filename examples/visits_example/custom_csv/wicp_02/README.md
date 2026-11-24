# Custom CSV examples for WICP_02

Visits for trying **Register the visits → From a CSV file → Custom CSV**, made to fit the entities in
[`../../entities_example/wicp_02`](../../../entities_example/wicp_02) (import them first, with the research project **WICP_02** picked):

| Entity | What the visits use |
|---|---|
| Locations | `WICP_02_001` … `WICP_02_004` (UTC; `WICP_02_004` is *ready*, like the others: no camera yet) |
| Cameras | `BR5071050724`, `RE5699252753`, `RE1161042648`, `SP1776213899` |
| SD cards | `1` … `8` |
| Trappers | `Ana Pérez`, `Luis Gómez` |

Every visit has its **coordinates** (`latitude`, `longitude`: where the trapper was when the visit was noted, a few metres from the location), which a file must always give.
The coordinates of the **location** are another pair (`location_latitude`, `location_longitude`) that is only asked for to create a location (see `create_entities.csv`).

Load each file on a research project with no visits yet. A revision is one visit to **every** location, so each revision visits the four sites.
Where it says **auto**, the headers are the names of the fields and nothing has to be mapped. Every card left is another one than the card collected
in the same revision, and no card is archived: the rules of the cards are only broken where a file says so.

| File | Source step | Expected |
|---|---|---|
| `valid.csv` | auto | `R0001` installs the four cameras (cards 1–4); `R0002` revises them, collects 1–4 and leaves 5–8. **8 visits, no warnings.** |
| `template.csv` | auto | What **Download a template** gives (the same file is in `frontend/src/visitsTemplate.csv`, and a test keeps them equal): the story of the four sites in five revisions, with the visits that say **several actions**. `R0001` installs, `R0002` and `R0003` revise; at `WICP_02_002` the camera is stolen and replaced (`Stolen + Installation`); in `R0004` the camera of `WICP_02_003` is stolen and nothing is put up (`Stolen`); in `R0005` `001` replaces its camera (`Revision + Desinstallation + Installation`), `002` has it taken away (`Revision + Desinstallation`), `003` gets one (`Installation`) and `004` is given up (`Revision + Desinstallation + Archive`). **20 visits, no warnings.** |
| `three_revisions.csv` | auto | As `valid.csv` plus `R0003`, which collects 5–8 and leaves 1–4 again (they were collected in `R0002`, so they can be reused). **12 visits, no warnings.** |
| `revision_6.csv` | auto | A Revision at the four sites in `R0006`. Made for a project with `R0001` and `R0002` where `WICP_02_004` was not visited in `R0002` (its card 4 is still in its camera, and cards 5, 6 and 7 are in the other three): it collects 5, 6, 7 and 4, and leaves 1, 2, 3 and 8. `R0003`–`R0005` have no visit, so they are **unknown** — nothing is checked against them — and the page warns that the revision numbers jump. **4 visits, 0 problems, 1 warning.** The card left has to be another than the one collected: leaving 5 at `WICP_02_001` would be refused. |
| `revisions_10_to_20.csv` | auto | A Revision at the four sites in each of the eleven revisions from `R0010` to `R0020`, every two weeks from 2027-02-01: many revisions in one file, for trying the selection of revisions of the results. Nothing is kept before `R0010`, so `R0001` to `R0009` are *unknown* and the first visit to each site may be a Revision. Each revision collects the cards the one before left and leaves the other four (1–4, then 5–8, and so on). **44 visits, no warnings.** |
| `columns_to_map.csv` | map by hand | Semicolons, Spanish headers, dates day first, a column not used, and no revision of `WICP_02_004` in `R0002`. Pick `Lugar` → site, `Dia` → date, `Tarea` → actions, `Quien` → who went, `Fotos` → images, `Tarjeta` → SD card; `Hora`, `Camara`, `Observaciones`, `Latitud` and `Longitud` match by themselves. **7 visits.** |
| `create_entities.csv` | auto | Made to **create the locations** (and the cameras and SD cards) from the file: import only the research project and the trappers of the entities (Settings → Entities → *Research projects* and *Trappers*), not their locations, cameras or SD cards, and in the step *Create what does not exist yet* turn on **locations**, **cameras** and **SD cards**. It has the two pairs of coordinates — the visit's (`latitude`, `longitude`) and the location's (`location_latitude`, `location_longitude`) — and what a location needs besides: `timezone`, `daylight_saving` (`no`: its cameras ignore summer time), and optionally `location_name` and `coordinate_uncertainty`; the camera model, and the brand and capacity of the SD card, are optional too. `R0001` installs the four cameras. **4 visits, 4 locations, 4 cameras and 4 SD cards created, no warnings.** |
| `not_visited.csv` | auto | In `R0002`, `WICP_02_003` has status `Not revised` (it could not be reached). **8 visits, no warnings**; the visit book shows it as *Not visited*, with no date. |
| `theft_and_archive.csv` | auto | In `R0002` the camera of `WICP_02_003` is stolen and the site given up (`Stolen + Archive`). **8 visits, no warnings.** |
| `card_rules.csv` | auto | Two visits are refused, as the form would — **6 visits, 2 problems**: card `1` is left at `WICP_02_002` after being collected at `WICP_02_001` in the same revision; card `5` is left in a second camera while it is still in the first. |
| `unknown_sites.csv` | auto | `WICP_02_005` is a new site (offered as a location) and `WICP_02_O03` (letter O) looks like a misprint of `WICP_02_003`. **2 visits kept, 2 new sites.** |
| `row_errors.csv` | auto | The four Installations are right; the four Revisions each have a mistake (an action that does not exist, `31/02/2026`, the card code `Full`, images `many`). **4 visits, 4 problems.** |
