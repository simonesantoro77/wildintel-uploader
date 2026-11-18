# <img src="docs/img/wildIntel_logo.webp" alt="WildINTEL Logo" height="60"> wildintel-uploader

![License](https://img.shields.io/badge/license-GPLv3-blue.svg)
[![WildINTEL](https://img.shields.io/badge/WildINTEL-v1.0-blue)](https://wildintel.eu/)
[![Trapper](https://img.shields.io/badge/Trapper-Server-green)](https://gitlab.com/trapper-project/trapper)

<hr>

## Web tool to keep the field work of WildINTEL camera traps and upload its deployments to Trapper

**wildintel-uploader** is an open-source application that takes the camera-trap work of the
[WildINTEL](https://wildintel.eu/) project from the field to [Trapper](https://gitlab.com/trapper-project/trapper).
It keeps the **visits** to the cameras — who went, when and what was done —, and from the visits it works out the
**deployments** of each revision: a camera is left with a card in a visit and its card is collected in the next one.

Each deployment is then imported from a local folder of images (copied off the camera's memory card, which is never
touched): the images are validated, the details of the deployment are filled in from the visits, and the images are
organized renamed, resized and tagged with authorship and license metadata. The deployments are finally uploaded to
Trapper — creating the location and the deployment there if they are missing —, with a dry run first.

<table>
  <tr>
    <td align="center"><img src="docs/img/screenshots/welcome.png" alt="Welcome screen" width="100%"></td>
    <td align="center"><img src="docs/img/screenshots/visit-book.png" alt="Visit dashboard" width="100%"></td>
    <td align="center"><img src="docs/img/screenshots/deployments-status.png" alt="Deployments dashboard" width="100%"></td>
    <td align="center"><img src="docs/img/screenshots/upload.png" alt="Upload to Trapper" width="100%"></td>
  </tr>
  <tr>
    <td align="center">Welcome screen</td>
    <td align="center">Visit dashboard</td>
    <td align="center">Deployments dashboard</td>
    <td align="center">Upload to Trapper</td>
  </tr>
</table>

## 🚀 Quick start

```bash
git clone https://github.com/wildintelproject/wildintel-uploader.git
cd wildintel-uploader
./setup.sh
source .venv/bin/activate
uv run wucli dev
```

Or, once packaged, download the executable for your platform from the
[releases page](https://github.com/wildintelproject/wildintel-uploader/releases) — no
installation needed.

## ✨ Features

**Field work**

The app controls the **life cycle** of the visits, the deployments, the SD cards and the cameras, to minimise the typical errors of the field sheets. Locations, cameras and SD cards
are *planned*, *ready*, *active* or *archived*, and what a visit does moves them — an Installation makes the site, the camera and the card active; taking them away makes them ready again; a
theft archives the camera and its card —, so where each camera and each card is, is always worked out from the visits. A visit — entered by hand, or read from a file — is refused, with the reason, when it
breaks any of these controls:

- the site is not a location of the research project, or there is already a visit to it at that time;
- a site is visited twice in a revision, a visit is not after the last one to its site, or a revision is out of order;
- a revision starts before the one before it is finished (every location that is not archived has to have its visit), or is added to once it is closed;
- the first visit to a site is not an Installation;
- what its actions ask is missing: the camera and the card an Installation leaves, the photos a Revision or a Desinstallation collected (not when the card was full);
- the camera is not the one at the site, is put up where it already is, or is at another site; the camera or the SD card does not exist in the research project; the person who went is not in the settings;
- the SD card left is archived, is the one the visit collects, is in the camera of another site, or was collected in the same revision;
- a visit comes after the site was archived, or an archiving visit leaves a camera up.

And it warns, keeping the visit, of what is only odd: a Revision with no photos, a camera or a card at two sites in a revision, a visit whose GPS is more than a kilometre from its site. What an unknown revision hides —
one before the first visit kept to a site — is not checked, and a later visit takes its place.

- Register visits by hand, or read them from a CSV file — with the columns matched by hand — or from the CSV of a WildINTEL Epicollect5 project, creating the locations, cameras and SD cards that do not exist (a *New site* makes its site on the spot)
- Visit dashboard by revision and state — planned, deployed, collected, stolen, not visited, unknown —, with a panel for each visit and the deployment it gives; the deployments are worked out from the visits

**Deployments**

The images go through a series of **quality controls** before anything is copied, to avoid the errors that a deployment carries from the field into Trapper. Each control can be run or not, and a required
one that does not pass stops the import:

- *validation*, over the images alone: corrupted images, the shooting order against the order of the file names, the folder structure, one camera for all the images, the required EXIF fields and duplicates;
- *postvalidation*, once the deployment is known: the format of its id, its collection and its location, the camera, and the dates of the images against the start and the end of the deployment;
- *statistical* checks against the earlier revisions of the same location — the number of images, the number of sequences and how long they are —, so that a camera that fired non-stop or died early shows up before it is uploaded.

The images are then **modified** in the copy kept in the collections folder — the source is never touched: the dates are read from the EXIF as the camera's local time and converted to UTC, the
images are renamed after the deployment and resized, and **authorship metadata** — creator, owner, publisher, rights, license and coverage — is written into each one as XMP, with ExifTool. The deployment is sealed afterwards, so that any later change of an image or of its details is noticed.

- Import a deployment, or a session of several at once, from a local folder, with the dates taken from the visits, the images or the timestamp log of the collection, and a form with the details Trapper's own deployment form asks
- Dashboard of the deployments with their visit, card and images, and a browser of their photos; repair of the ones that are not valid any more

**Upload to Trapper**

- Creates the location and the deployment in Trapper if they are missing and sends the images in zips, with a dry run and the progress of each deployment
- Dashboard of the uploads by revision, with where each deployment is and what failed

**General**

- Utilities: sync the collections folder with what Trapper holds, backups that the browser downloads and their restoration, reports of every check and import
- Settings for the entities of each research project — locations, cameras, SD cards and trappers — and for the checks
- A guided web app and a smaller command line (`wucli`), on the same core and settings; a sibling of [wildintel-zooniverse](https://github.com/wildintelproject/wildintel-zooniverse), with the same architecture
- One executable per platform, or a development mode with hot reload

## 📋 Requirements

**To run it**

- Python 3.12+ with [uv](https://docs.astral.sh/uv/)
- Node.js 22+ / npm (to build the frontend)
- [ExifTool](https://exiftool.org/) — reads the camera's make, model and serial number from the maker notes and writes the authorship metadata (XMP) into the images. It is bundled in the packaged executables; from source it has to be on the `PATH` (e.g. `sudo apt install libimage-exiftool-perl`). Without it the camera id isn't read and the metadata step is skipped
- The [Trapper SDK](https://github.com/wildintelproject/wildintelproject-trapper-sdk), which `setup.sh` clones next to this repository

**Technology stack**

| Layer | Technologies |
|---|---|
| Backend | [FastAPI](https://fastapi.tiangolo.com/) served by [Uvicorn](https://www.uvicorn.org/), [Pydantic](https://docs.pydantic.dev/) 2, [Dynaconf](https://www.dynaconf.com/) (settings), [HTTPX](https://www.python-httpx.org/) |
| Command line | [Typer](https://typer.tiangolo.com/) and [Rich](https://rich.readthedocs.io/) |
| Images and metadata | [Pillow](https://python-pillow.org/) (resize, fallback reader), [ExifTool](https://exiftool.org/) (camera id, XMP authorship) |
| Integrations | WildINTEL's Trapper SDK (uploads to [Trapper](https://trapper-project.readthedocs.io/)), [pyepicollect](https://github.com/ybarge/pyEpiCollect) (Epicollect5 forms) |
| Frontend | [React](https://react.dev/) 19, [TypeScript](https://www.typescriptlang.org/), [Vite](https://vite.dev/), [Tailwind CSS](https://tailwindcss.com/) 4, [Leaflet](https://leafletjs.com/) (maps) |
| Testing and quality | [pytest](https://pytest.org/), [Vitest](https://vitest.dev/) with Testing Library, [Playwright](https://playwright.dev/python/) (screenshots), [oxlint](https://oxc.rs/docs/guide/usage/linter) |
| Packaging and docs | [PyInstaller](https://pyinstaller.org/) (executables), [MkDocs Material](https://squidfunk.github.io/mkdocs-material/) with mike, GitHub Actions |

## 📚 Documentation

Full documentation is available at  **https://wildintelproject.github.io/wildintel-uploader/**

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

To report a bug or request a new feature, please open an [issue](https://github.com/wildintelproject/wildintel-uploader/issues).

## 🏛️ Funding

This work is part of the [WildINTEL project](https://wildintel.eu/), funded by the [Biodiversa+](https://www.biodiversa.eu/) Joint Research Call 2022-2023 "Improved
transnational monitoring of biodiversity and ecosystem change for science and society (BiodivMon)". Biodiversa+ is the
European co-funded biodiversity partnership supporting excellent research on biodiversity with an impact for policy and
society. Biodiversa+ is part of the European Biodiversity Strategy for 2030 that aims to put Europe's biodiversity on a
path to recovery by 2030 and is co-funded by the European Commission.

WildINTEL has been co-funded by the [European Commission](https://commission.europa.eu/) (GA No. 101052342) and the following funding organisations: [Agencia Estatal de Investigación](https://www.aei.gob.es/) (Spain, PCI2023-145963-2, PCI2024-153489), [National Science Centre](https://www.ncn.gov.pl/?language=en) (Poland, UMO-2023/05/Y/NZ8/00104), the [Research Council of Norway](https://www.forskningsradet.no/en/) (Norway, NFR350962) and the [German Research Foundation](https://www.dfg.de/en/) (Germany).

## 📝 License

This project is licensed under the GNU General Public License v3.0 or later - see the [LICENSE](LICENSE) file for details.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License
as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
