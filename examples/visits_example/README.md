# Example visits (CSV files)

Visits to the camera traps for trying **Register the visits → From a CSV file**, in folders by what they are, all made for the entities of the research project `WICP_02`.
Import the entities first (Settings → Entities, with the research project `WICP_02` picked) and load each file on a research project that has no visits yet.

| Folder | Source step | Made for the entities in | What is in it |
|---|---|---|---|
| [`custom_csv/wicp_02`](custom_csv/wicp_02) | Custom CSV | [`entities_example/wicp_02`](../entities_example/wicp_02) (project `WICP_02`, 4 locations) | The cases of the rules of a visit — all correct, three revisions, the rules of the SD cards, a visit that could not be made, unknown sites, rows that cannot be read, a theft and a site given up, columns to match by hand — eleven revisions in one file (`R0010` to `R0020`), and one that creates the locations, cameras and SD cards it names (`create_entities.csv`, with the two pairs of coordinates: the visit's and the location's). |
| [`wildintel_csv/wicp_02`](wildintel_csv/wicp_02) | WildINTEL Epicollect CSV | [`entities_example/wicp_02`](../entities_example/wicp_02) | The downloads of the Epicollect5 project of the new form, one file for each revision: the installation, a revision with no problems, a theft with the camera replaced, a theft with none, what is done after an inspection, and a new site made on the spot. |

Each folder has its own README that says, for each file, which option to pick and what to expect.
