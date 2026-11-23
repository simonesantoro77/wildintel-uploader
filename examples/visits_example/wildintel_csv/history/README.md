# A field history, before and after

A made-up research project, `EXAM`, with 5 sites and 5 revisions (`R0001` to `R0005`, March to July 2025), to go with [the guide for the field history](../../../../docs/guide-visits-history.md).

- `old_datasheet.csv`: the history as the common WildINTEL field datasheet keeps it (23 rows, local time of Poland).
- `converted.csv`: the same history in the format of the WildINTEL Epicollect form (21 visits, UTC), made with `tools/convert_field_datasheet.py old_datasheet.csv converted.csv Europe/Warsaw`.

Load `converted.csv` with *Register the visits › WildINTEL Epicollect CSV* on a research project with no visits, with every switch of *Import & auto-creation rules* on: the locations, cameras, SD cards and trappers are created, and the 21 visits are kept with no problems.

What it has:

| Revision | Site | Datasheet | Converted |
|---|---|---|---|
| R0001 | EXAM_0001 to EXAM_0004 | Installation | New site |
| R0002 | EXAM_0001 | Revision, 812 images | OK, Keep the camera |
| R0002 | EXAM_0002 | Revision, card full, no count | OK, Full Card, Keep the camera |
| R0002 | EXAM_0003 | Revision, camera altered, clock wrong | Altered, Keep the camera |
| R0002 | EXAM_0004 | Revision, no batteries | OK, No batteries, Keep the camera |
| R0003 | EXAM_0001 | Stolen + Installation | Stolen, Camera replacement |
| R0003 | EXAM_0002 | Desinstallation + Installation | OK, Camera replacement |
| R0003 | EXAM_0003 | Revision, images not counted (*NA*) | OK, Keep the camera, count empty |
| R0003 | EXAM_0004 | Desinstallation, visited again later | OK, Camera removal |
| R0004 | EXAM_0002 | Revision, camera knocked down | Altered, Keep the camera |
| R0004 | EXAM_0003 | Desinstallation, never visited again | OK, Site removal |
| R0004 | EXAM_0004 | Installation after the removal | Inactive site |
| R0004 | EXAM_0005 | Installation of a new site | New site |
| R0005 | EXAM_0001 | Stolen, nothing put up | Stolen, None |

The time of each visit is in `created_at`, in UTC: one hour less than the datasheet in March, two from April to July.
