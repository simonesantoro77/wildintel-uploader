# Example CSV files

For trying the CSV options of the app. They are in two folders, and each folder has a README that says what is in it:

- [`visits_example`](visits_example) — **visits** (Register the visits → From a CSV file), by the option they are for (Custom CSV, WildINTEL Epicollect CSV) and made to fit the entities of `WICP_02`.
- [`entities_example`](entities_example) — **entities** (Settings → Entities, one tab each), for the research project `WICP_02` (four locations) and for `DONA` (the real history of Doñana, anonymised: 89 locations, 119 cameras and 215 SD cards).

The entities are in five files:

- `research_projects.csv` — Research projects → Import CSV (kept at once in the collections folder). They can also be taken from TRAPPER.
- `locations.csv` — Locations → pick a research project first → Import CSV: the ones it has are updated, the others added. They can also be taken from TRAPPER, when the research project was.
- `trappers.csv` — Trappers → Import CSV (the trappers are not tied to a research project): `username` (required and unique), `name` (the full name, required), `affiliation` and `email` (both optional).
- `sd_cards.csv` and `cameras.csv` — SD cards / Cameras → pick a research project first → Import CSV: they are added to that project. Then press Save.


Import the entities first, then load the visits that are made for them.
