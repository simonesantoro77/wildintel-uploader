# WildINTEL Epicollect examples for WICP_02 (the new form)

One download of the Epicollect5 form `Cameratrap visit` for each revision, as Epicollect5 writes it — `created_by` and `title` too, which the app ignores — with the number of
the question, an underscore and its text, **cut at 20 characters** (`4_Status_of_the_came`, `7_N_pictures_collect`, `9_Action_after_inspe`, `10_Action_after_thef`), and the answers
as the form gives them. They are those of the project `minuevotestinaki`. Made for the entities in [`../../../entities_example/wicp_02`](../../../entities_example/wicp_02) — import
them first, with the research project **WICP_02** picked — and loaded **in order** on a research project with no visits yet, with **Register the visits → From a CSV file → WildINTEL
Epicollect CSV** (no mapping is asked).

The form has **no date and no time**: a visit happened when its entry was created (`created_at`, UTC), and it is told in the timezone of its location. Each revision is one visit to every
site that is not archived.

What the form asks, as these files answer it:

- **The site is written** (`3_locationID`: `WICP_02_001`…) and so is **the card** (`22_SD_to_insert`: `SD 1`, `sd-1` or `1` — the app reads the number of the card).
- **Status of the camera** (`4_Status_of_the_came`): *OK*, *Altered*, *Stolen*, **New site** (a site made on the spot, with its camera) or **Inactive site** (a site that has no camera and
  gets one: the form asks the set-up of the camera, not an action).
- **The batteries and the card are two questions** (`5_Batteries_Status`: *OK*, *No batteries*; `6_Card_Status`: *OK*, *Full Card*). With the card full the images are not counted:
  `7_N_pictures_collect` is empty.
- **After the inspection** (`9_Action_after_inspe`): *Keep the camera* — the card is changed —, *Camera replacement*, *Camera removal* or *Site removal*. **After a theft**
  (`10_Action_after_thef`): *Camera replacement*, *Site removal* or *None* — not replaced: the site stays open, with no camera.
- **The place of the visit** (`lat_25_Coordinates`, `long_25_Coordinates`): the only coordinates the form has. A site that is made from a visit takes them.

| File | What happens | Expected |
|---|---|---|
| `revision_1_installation.csv` | `R0001` (2026-09-14): the four cameras are put up (*New site*), cards 1–4. | **4 visits, no warnings.** |
| `revision_2_all_revised.csv` | `R0002` (2026-10-19): the four are revised and kept (*Keep the camera*), cards 1–4 collected and 5–8 left. `001` is as it should be; `002` is *Altered* (put back in place); `003` has the **card full** (images not counted); `004` has **no batteries** (changed). | **4 visits, no warnings.** |
| `revision_3_theft_replaced.csv` | `R0003` (2026-11-23): at `WICP_02_002` the camera is found **stolen** and replaced (*Stolen*, *Camera replacement*: a *Stolen + Installation* with the new camera `SP2468013579`, card 2). The others are revised: `003` and `004` *Altered*. | **4 visits.** The stolen camera and its card are archived. |
| `revision_4_theft_not_replaced.csv` | `R0004` (2026-12-28): at `WICP_02_003` the camera is found **stolen and nothing is done after it** (*Stolen*, *None*: the site stays open, with no camera). The other three are revised (the new camera of `WICP_02_002` included). | **4 visits.** |
| `revision_5_replacement_removal_and_site_given_up.csv` | `R0005` (2027-02-01), what is done after an inspection: `001` *Camera replacement* (a *Revision + Desinstallation + Installation*, with the new camera `GA3344556677`); `002` *Camera removal* (the camera is taken away: the site stays open); `003` *Inactive site* (it gets the camera taken from `001`); `004` *Site removal* (the camera is taken away and the site is given up). | **4 visits.** `004` is archived. |
| `revision_5_refused.csv` | An alternative `R0005` that breaks the rules of the sites, to see what the app says: `002` says *Inactive site* where a camera is still up, and `003` is revised although its camera was stolen in `R0004`. `001` and `004` are right. | **2 visits kept and 2 refused**, each row saying why. |
| `revision_6_new_site.csv` | `R0006` (2027-02-15), after `revision_5_replacement_removal_and_site_given_up.csv`: `001` and `003` are revised, `002` gets a camera again (*Inactive site*, the one taken away in `R0005`) and **`WICP_02_005` is a new site**, with its own camera and card. Load it with **Create the locations, the cameras and the SD cards that do not exist** on and a timezone for the new location (the form does not say it). | **4 visits.** Creates the location `WICP_02_005` — at the place of its visit —, the camera `GP1122334455` and the SD card `9`. |

The new cameras (`CAM-005`, `CAM-006`) are in the cameras of the entities of the group.
