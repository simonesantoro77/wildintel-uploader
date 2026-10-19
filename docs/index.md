# WildINTEL Uploader

![WildINTEL](img/wildIntel_logo.webp){ style="display: block; margin: 0 auto;" }

**WildINTEL Uploader** is an open-source desktop web application that takes the images of a
camera-trap deployment — copied off the camera's memory card — checks them, organizes them in a
local collections folder, and sends them to [Trapper](https://gitlab.com/trapper-project/trapper),
the WildINTEL project's camera-trap platform.

It runs on your own computer, with a guided interface in your browser — and a command line for the
quick jobs:

- **Import deployments** — one folder of images, or a session with one subfolder per deployment.
  The images are validated (corrupted, duplicated, out of order, mixed cameras…), the deployment's
  details are filled in and checked against the earlier revisions of its location, and the images
  are renamed, resized and tagged with authorship and license metadata. Your source folder is never
  touched.
- **Upload to Trapper** — pick a collection kept locally and send its deployments: the location and
  the deployment are created in Trapper if they are missing, and the images go up in zips for Trapper
  to process. A dry run says what would happen first.
- **Utils** — maintenance of the local collections: **Repair local deployments** checks which deployments are
  still valid and writes the metadata of the others again from what their folders hold, and **Sync local
  collections** brings the collections folder up to date with what Trapper already holds for a
  classification project.

## Documentation Map

### [User Manual](user-manual.md)

What the web app and the command line have in common: installation, the general concepts
(deployment, revision, location, collection) and the folders and files the app creates. Start here.

### [User Manual — web app](user-manual-web.md)

Settings, and a step-by-step guide to every task in the web interface: importing a
deployment or a session, uploading to Trapper and syncing.

### [User Manual — command line](user-manual-cli.md)

The `wildintel-uploader` command: connection test, settings, Trapper lookups and a quick
interactive import.

### [Developer Manual](developer-manual.md)

Architecture, development setup, backend and frontend structure, the files a deployment keeps, API
reference, how to add a check, testing, building executables, documentation and the release
process.

### [Features](features.md)

What the application does, in detail — and how it differs from wildintel-tools.

### [Changelog](changelog.md)

What changed in each release.

### [About](about.md)

The WildINTEL project and its funding.
