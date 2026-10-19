# WildINTEL Uploader

Import camera-trap deployments into [Trapper](https://gitlab.com/trapper-project/trapper) from a
local folder of images — as a web app or from the command line.

Sibling project of [wildintel-zooniverse](https://github.com/wildintelproject/wildintel-zooniverse),
same architecture: a FastAPI backend with a React frontend, packaged into one executable per
platform.

**What it does:**

- **Import deployment / session** — pick a local folder of images (copied off the camera's memory
  card first, not the card itself), validate them, fill in the deployment's details (the same
  fields Trapper's own deployment form asks for, most guessed or optional), and organize them
  locally — renamed, resized and tagged with authorship and license metadata. The source folder
  is never touched.
- **Upload to Trapper** — send the deployments kept locally: location and deployment are created in
  Trapper if missing, and the images go up in zips. With a dry run.
- **Utils** — repair local deployments, and sync the local collections folder with what Trapper holds.

The command line is a smaller flow: connection test, settings, Trapper lookups and a quick import.

See the [documentation](https://wildintelproject.github.io/wildintel-uploader/) for the user manual (installation, concepts and folders), the web and
command-line manuals and the developer manual.

## Quick start

```
./setup.sh
uv run wucli dev
```

Or, once packaged, download the executable for your platform from the
[releases page](https://github.com/wildintelproject/wildintel-uploader/releases) — no
installation needed.

## License

GPL-3.0-or-later — see [LICENSE](LICENSE).
