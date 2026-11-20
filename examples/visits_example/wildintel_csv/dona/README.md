# WildINTEL Epicollect examples for DONA (the real history, anonymised)

The visits of the project **DONA** (Doñana) as the form `Cameratrap visit` wrote them — **R0001 to R0043**, 2114 entries —, in the format of the **WildINTEL Epicollect CSV**
(see [`../wicp_02`](../wicp_02) for what each column is). Made for the entities in [`../../../entities_example/dona`](../../../entities_example/dona): import them first, with the
research project **DONA** picked, and then load the visits with **Register the visits → From a CSV file → WildINTEL Epicollect CSV** (no mapping is asked, and nothing has to be created).

**Anonymised.** The coordinates of the sites — in the visits and in the entities — are cut to **two decimals** (about a kilometre) and the other ways the form has to say the place (the
accuracy and the UTM columns) are emptied. The people who went are as the field datasheet has them (first names and initials), and the notes are the field notes.

| File | What it has | Expected |
|---|---|---|
| `revisions_1_to_43.csv` | Every revision, **R0001 to R0043** (2114 visits). | **2114 visits kept**, no row refused, 9 warnings (visits with 0 images: no deployment is made for them). |
| `revisions_1_to_42.csv` | **R0001 to R0042** (2052 visits): the history up to the last trip before R0043. | With **Close the revision before when it has locations still planned** on: **2052 visits kept**, and 4 sites that had no visit in R0041 (`DONA_0026_B`, `DONA_0047`, `DONA_0053`, `DONA_0066`) are marked as not visited. Without it the 58 rows of `R0042` are refused: *R0041 is not finished*. |
| `revision_1.csv` | Only **R0001**: the first trip, 38 visits (the cameras are put up). | **38 visits**, no warnings. |
| `revision_2.csv`, `revision_3.csv`, `revision_4.csv`, `revision_5.csv` | Only that revision, 38 visits each. Loaded alone on a project with no visits, the revisions before it are *unknown*. | **38 visits** each; `revision_4.csv` has 1 warning (a revision with 0 images). |
| `revisions_6_to_10.csv` | **R0006 to R0010**, 175 visits. | **175 visits**, no warnings. |

To follow the history, load `revision_1.csv`, then `revision_2.csv`… in order; or `revisions_6_to_10.csv` after the first five.

**The images counted.** The visits that collect a card say the images they counted (`7_N_pictures_collect`): for the deployments that [`tools/make_dona_deployments.py`](../../../../tools/make_dona_deployments.py) makes — see [`deployment_examples/DONA`](../../../deployment_examples/DONA) — they are the number of images each deployment has, written by the script, so that the postvalidation finds them as many as the visit says.
