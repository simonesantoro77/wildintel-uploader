# Entities of DONA (Doñana)

The research project, its trappers, locations, cameras and SD cards, for the visits in [`../../visits_example/wildintel_csv/dona`](../../visits_example/wildintel_csv/dona). Import them in the
same order as the ones of `wicp_02` (see [`../../CSV.md`](../../CSV.md)): the research project, the trappers, the locations (pick **DONA** first), and the cameras and the SD cards.

- `research_projects.csv` — **DONA**; the datasheet says nothing more of it.
- `trappers.csv` — the 24 people of the field datasheet, as it has them.
- `locations.csv` — **89 locations**, `DONA_0006` … `DONA_0076` and their `_B` ones, as the sites of the visits are written, in `UTC` and **pending** (the first visit starts them), with the coordinates of their first visit **anonymised**: cut to two decimals (about a kilometre). The datasheet gives no name or uncertainty for them, and they are empty.
- `cameras.csv` — **119 cameras**, by the name the field datasheet gives them (`1`…`119`); their model is not known.
- `sd_cards.csv` — **215 SD cards**, by the label written on them (`1`, `1B`, `18Bb`…); some labels are odd, as in the datasheet (`84 (10)`, `FIX-DONA_0070`); their brand and capacity are not known.
