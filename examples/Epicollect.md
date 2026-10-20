# The Epicollect5 form this example expects

WildINTEL Uploader can fill a deployment's period, camera, site and notes from an entry of an
[Epicollect5](https://five.epicollect.net) project (Settings › Epicollect5). This is the structure of the
form it is built around — the one the project is defined with right now — and an entry for `wicp_0001`, a deployment of the example
`session_example_timestamp_log_wicp`.

**One form, one row per deployment.** The app looks for the entry whose *Location id* is the location of the deployment and
whose *Revision* is the revision being imported (the newest one if there are several). Everything is in one
form — no branches, no child forms. The groups are only for tidiness: the app ignores them.

## The form

| Group | Question | Epicollect5 type | Fills | Notes |
|---|---|---|---|---|
| **When** | Revision | Integer | revision | `3` for `R0003`. Needed to tell the visits to one location apart. |
| | Start date | Date | start date | The day the camera started recording. |
| | Start time | Time | start time | A day and a time are asked apart: Epicollect5 has no date-and-time question. |
| | End date | Date | end date | |
| | End time | Time | end time | Without a time, a day means its whole length: from 00:00:00 (start) to 23:59:59 (end). |
| **Where** | Location id | Search single | location id | Its options are the ids of the research project's locations (`wicp_0001`, …). **Required to find the entry.** It is matched ignoring case. |
| | Location name | Text | — | Mapped, but never taken: the location's data come from the location chosen. |
| | Location (GPS) | Location | — | Same: not taken. |
| **Camera** | Camera model | Text | camera model | Written as the camera's make and model, as the images' EXIF says. Only completes what the images didn't give. |
| | Camera id | Text | camera id | The serial number. Same: only completes. |
| | Camera delay | Integer | camera delay (s) | Seconds between triggers. |
| | Detection distance | Decimal | detection distance (m) | |
| | Camera height | Decimal | camera height (m) | Not together with *Camera depth*. |
| | Camera depth | Decimal | camera depth (m) | |
| | Camera tilt | Integer | camera tilt (°) | −90 to 90. |
| | Camera heading | Integer | camera heading (°) | 0 to 360. |
| **Site** | Feature type | Dropdown | feature type | One of Camtrap DP's: `roadPaved`, `roadDirt`, `trailHiking`, `trailGame`, `roadUnderpass`, `roadOverpass`, `roadBridge`, `culvert`, `burrow`, `nestSite`, `carcass`, `waterSource`. |
| | Habitat | Text | habitat | |
| | Setup by | Text | set up by | Who placed the camera. |
| | Bait used | Radio (`yes`, `no`) | bait used | |
| | Timestamps have issues | Radio (`yes`, `no`) | timestamp issues | |
| **Notes** | Deployment groups | Text | deployment groups | e.g. `season:spring 2025 \| grid:A1`. |
| | Tags | Text | tags | A comma-separated list. |
| | Comments | Textarea | comments | |

Then, in **Settings › Epicollect5**: type the project's *slug* (the name in its URL), the *client id* and *secret* if the
project is private, press **Suggest a mapping** — the questions are named so that it relates each one to its field — and
**Save**. Turn on **Import deployment information from Epicollect5**. *Test connection* checks the project.

Only *Location id* and the dates are needed; every other question can be left out of the form, or left blank in an entry.

## An entry for `wicp_0001`

The deployment `R0003-wicp_0001` of `session_example_timestamp_log_wicp`, as someone in the field would have answered the form:

| Question | Answer |
|---|---|
| Revision | `3` |
| Start date | `29/04/2025` |
| Start time | `09:15:00` |
| End date | `04/05/2025` |
| End time | `17:30:00` |
| Location id | `wicp_0001` |
| Camera model | `Example` |
| Camera id | *(blank)* |
| Feature type | `trailGame` |
| Habitat | `Mediterranean scrubland` |
| Setup by | `A. Perez` |
| Bait used | `no` |
| Timestamps have issues | `no` |
| Deployment groups | `season:spring 2025` |
| Comments | `Camera set up on a fence post.` |

(Location name, location GPS, delay, distance, height, depth, tilt, heading and tags are left blank.)

### Why these answers

The three places that know the dates of `wicp_0001` say different things, to show how a source is picked:

| Source | Start | End |
|---|---|---|
| Epicollect5 entry (above) | 2025-04-29 09:15 | 2025-05-04 17:30 |
| `R0003_FileTimestampLog.csv` (in that example) | 2025-04-28 08:00 | 2025-05-05 18:00 |
| The images' EXIF (first and last photo) | 2025-05-01 05:02 | 2025-05-02 05:43 |

In an *Import session*, the dates are taken from Epicollect5 first, then from the log, then from the images — so
`wicp_0001` takes the entry's, and `wicp_0002`, which has no entry, takes the log's. You can pick another source for any row.

The camera comes from the images: their EXIF has only the **make** — `Example` — and no model nor serial number, so the camera
model is `Example` and there is no camera id; the entry says the same and leaves the id blank. If the entry gave another model, the
images' would still prevail: Epicollect5 only completes what they don't give.

## Trying it

1. Add `wicp_0001` to the options of *Location id* in your Epicollect5 project (and the research project's location, with
   its timezone, to the collections folder).
2. Submit the entry above.
3. Import `session_example_timestamp_log_wicp` as a session (**📷 Import session**), revision `3`. The *When was it collected?* step offers
   **Import from Epicollect5**, and the period of `wicp_0001` says *From Epicollect5*.
