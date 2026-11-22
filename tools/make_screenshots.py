"""Takes the screenshots of the manual (docs/img/screenshots) driving a copy of the app with a browser.

The app is started on a free port with a HOME of its own (a temporary folder), so that what it keeps — the settings, the collections — is not yours, and it is filled
in with the entities of examples/entities_example/wicp_02. Playwright's Chromium takes the pictures: dark theme, 1100 px wide, as the ones already there.

    .venv/bin/python tools/make_screenshots.py                 # all of them
    .venv/bin/python tools/make_screenshots.py settings-entities settings-preprocessing
    .venv/bin/python tools/make_screenshots.py --list
    .venv/bin/python tools/make_screenshots.py --explore "Settings"   # prints the buttons and fields of a page, to write a new one

Needs a browser: Playwright's Chromium (.venv/bin/playwright install chromium) or Google Chrome installed in the system.
"""
from __future__ import annotations

import argparse
import csv
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "img" / "screenshots"
ENTITIES = ROOT / "examples" / "entities_example" / "wicp_02"
SIZE = {"width": 1100, "height": 850}


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def seed(home: Path, base: bool = False) -> None:
    """Keeps the entities of the example in the collections folder of the copy — or, with `base`, only the research project and the trapper Pedro Pérez: what the walk-through has made by then."""
    env = {**os.environ, "HOME": str(home)}
    code = f'''
import csv
from pathlib import Path
from wildintel_uploader.core import config
from wildintel_uploader.core.services import local_folder_service as L
root = config.collections_dir()
d = Path({str(ENTITIES)!r})
rows = lambda n: list(csv.DictReader(open(d / n, encoding="utf-8")))
clean = lambda rs: [{{k: v for k, v in r.items() if v}} for r in rs]
rp = rows("research_projects.csv")[0]
ac = rp["acronym"]
st = config.load_settings()
st.GENERAL.default_research_project = ac
config.save_settings(st)
L.write_research_project(root, {{"name": rp["name"], "acronym": ac, "description": rp["description"], "keywords": rp["keywords"], "status": "active"}})
if {base!r}:
    L.write_trappers(root, [{{"name": "Pedro Pérez", "affiliation": "University of Huelva"}}])
    raise SystemExit
for l in rows("locations.csv"):
    L.write_location(root, ac, {{"location_id": l["location_id"], "name": l["name"], "latitude": float(l["latitude"]), "longitude": float(l["longitude"]),
        "coordinate_uncertainty": float(l["coordinate_uncertainty"]), "timezone": l["timezone"], "ignore_dst": l["ignore_dst"] == "true", "status": l["status"]}})
L.write_field_items(root, ac, "cameras", clean(rows("cameras.csv")))
L.write_field_items(root, ac, "sd_cards", clean(rows("sd_cards.csv")))
L.write_trappers(root, clean(rows("trappers.csv")) + [{{"name": "Pedro Pérez", "affiliation": "University of Huelva"}}])
'''
    subprocess.run([sys.executable, "-c", code], env=env, check=True, cwd=ROOT)


@contextmanager
def app(seeded=True):
    """The app, on a free port, with a home of its own and — if seeded — the example entities. Yields its address."""
    with tempfile.TemporaryDirectory(prefix="wildintel-shots-") as tmp:
        home = Path(tmp)
        if seeded:
            seed(home, base=seeded == "base")
        port = _free_port()
        code = f"import uvicorn; from wildintel_uploader.web.main import app; uvicorn.run(app, host='127.0.0.1', port={port}, log_config=None)"
        proc = subprocess.Popen([sys.executable, "-c", code], env={**os.environ, "HOME": str(home)}, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        url = f"http://127.0.0.1:{port}"
        try:
            for _ in range(60):
                try:
                    urllib.request.urlopen(url, timeout=1)
                    break
                except OSError:
                    time.sleep(0.5)
            else:
                raise RuntimeError("the app did not start")
            yield url
        finally:
            proc.terminate()
            proc.wait(timeout=10)


SHOTS: dict = {}


EMPTY: set = set()   # the shots that are taken in an app with nothing in it: what is filled in is not already there


FRESH: set = set()   # the shots that change what the app keeps (they register visits): each has an app of its own
BASE: set = set()    # the shots taken with only the research project and a trapper in the app


def shot(name: str, empty: bool = False, base: bool = False, fresh: bool = False):
    def register(fn):
        SHOTS[name] = fn
        if empty:
            EMPTY.add(name)
        if base:
            BASE.add(name)
        if fresh:
            FRESH.add(name)
        return fn
    return register


def dump(page) -> None:
    """What can be clicked or filled on the page now."""
    for role in ("button", "link", "tab", "textbox", "combobox", "checkbox", "switch"):
        for el in page.get_by_role(role).all():
            try:
                if el.is_visible():
                    print(f"  {role:9} {(el.inner_text() or el.get_attribute('aria-label') or el.get_attribute('placeholder') or el.input_value() if role in ('textbox',) else el.inner_text() or el.get_attribute('aria-label') or '')[:70]!r}")
            except Exception:
                pass


def launch(pw):
    """Playwright's own Chromium if it is there, or the Google Chrome of the system (nothing to download)."""
    try:
        return pw.chromium.launch()
    except Exception:
        return pw.chromium.launch(channel="chrome")


def start(page, url: str) -> None:
    page.goto(url)
    page.wait_for_load_state("networkidle")
    welcome = page.get_by_role("button", name="Get Started")
    if welcome.count():
        welcome.click()
        page.wait_for_load_state("networkidle")


def save(page, name: str, full_page: bool = True) -> None:
    page.wait_for_timeout(300)
    page.screenshot(path=str(OUT / f"{name}.png"), full_page=full_page)


def settings(page, section: str) -> None:
    """Opens Settings and one of its sections."""
    page.get_by_role("button", name="Settings", exact=True).click()
    page.get_by_role("button", name=section, exact=True).click()
    page.wait_for_load_state("networkidle")


@shot("settings-entities")
def _(page, url):
    """Settings › Entities: the research project WICP_02, as it is kept."""
    settings(page, "Entities")
    save(page, "settings-entities")


@shot("research-project-form", empty=True)
def _(page, url):
    """Settings › Entities › New research project, filled in as the walk-through says."""
    settings(page, "Entities")
    page.get_by_text("New research project").first.click()
    page.get_by_role("textbox", name="Acronym").fill("WICP_02")
    page.get_by_role("textbox", name="Name").fill("WICP_02 Doñana census")
    page.get_by_role("textbox", name="Description").fill("Camera-trap census of Doñana")
    for word in ("census", "mammals"):
        page.get_by_role("textbox", name="New keyword").fill(word)
        page.get_by_role("textbox", name="New keyword").press("Enter")
    page.get_by_role("button", name="systematicRandom").click()
    page.get_by_role("heading", name="New research project").click()
    save(page, "research-project-form")


@shot("trapper-form", empty=True)
def _(page, url):
    """Settings › Entities › Trappers › New trapper, for Pedro Pérez."""
    settings(page, "Entities")
    page.get_by_role("tab", name="Trappers").click()
    page.get_by_text("New trapper").first.click()
    page.get_by_role("textbox", name="Full name").fill("Pedro Pérez")
    page.get_by_role("textbox", name="Affiliation").fill("University of Huelva")
    page.get_by_role("heading", name="New trapper").click()
    save(page, "trapper-form")


def project(page, tab: str) -> None:
    """Settings › Entities, on a tab of those of a research project, with WICP_02 picked."""
    settings(page, "Entities")
    page.get_by_role("tab", name=tab).click()
    page.get_by_role("combobox").first.click()
    page.get_by_text("WICP_02 — WICP_02").first.click()
    page.wait_for_timeout(400)


@shot("location-form", base=True)
def _(page, url):
    """New location: the first site of WICP_02."""
    project(page, "Locations")
    page.get_by_text("New location").first.click()
    page.get_by_placeholder("e.g. DONA_0001").fill("WICP_02_001")
    page.get_by_placeholder("e.g. Doñana site 1").fill("WICP_02 site 1")
    page.get_by_placeholder("e.g. 37.0123").fill("37.0123")
    page.get_by_placeholder("e.g. -6.4412").fill("-6.4412")
    page.get_by_placeholder("e.g. 100").fill("5")
    page.get_by_role("switch", name=re.compile("ignore summer time")).click()   # the time zone is UTC, as it comes
    page.get_by_role("heading", name="New location").click()
    save(page, "location-form")


@shot("camera-form", base=True)
def _(page, url):
    """New camera: CAM-001."""
    project(page, "Cameras")
    page.get_by_text("New camera").first.click()
    page.get_by_placeholder("e.g. CAM-014").fill("CAM-001")
    page.get_by_placeholder("e.g. P800HG08192031").fill("BR5071050724")
    page.get_by_placeholder("e.g. Reconyx-PC800").fill("Browning-BTC-8A")
    page.get_by_role("heading", name="New camera").click()
    save(page, "camera-form")


@shot("sd-card-form", base=True)
def _(page, url):
    """New SD card: the number 1."""
    project(page, "SD cards")
    page.get_by_text("New SD card").first.click()
    page.get_by_placeholder("e.g. SD-014").fill("1")
    page.get_by_role("button", name="SanDisk").click()
    page.get_by_role("button", name="64 GB").click()
    page.get_by_role("heading", name="New SD card").click()
    save(page, "sd-card-form")


# ── the visits of the walk-through: the first revision (an Installation in each of the four sites) and the second (a Revision in each) ──
INSTALLATIONS = [("WICP_02_001", "CAM-001", "1", "2026-09-14T08:30:00"), ("WICP_02_002", "CAM-002", "2", "2026-09-14T10:05:00"),
                 ("WICP_02_003", "CAM-003", "3", "2026-09-14T11:40:00"), ("WICP_02_004", "CAM-004", "4", "2026-09-14T13:15:00")]
REVISIONS = [("WICP_02_001", "5", "1420", "2026-10-19T08:30:00"), ("WICP_02_002", "6", "980", "2026-10-19T10:05:00"),
             ("WICP_02_003", "7", "1105", "2026-10-19T11:40:00"), ("WICP_02_004", "8", "640", "2026-10-19T13:15:00")]


def _pick(page, nth: int, prefix: str) -> None:
    """Opens the nth list of the page and takes the option that starts with this."""
    page.get_by_role("combobox").nth(nth).click()
    page.get_by_role("option", name=re.compile("^" + re.escape(prefix) + r"\b")).first.click()


def _set_when(page, value: str) -> None:
    """Writes the date and time field (a datetime-local one, which cannot be typed in the same way in every browser)."""
    page.locator("input[type=datetime-local]").first.evaluate("""(el, v) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(el, v); el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true}))
    }""", value)


def _until_the_visit(page, url: str, location: str, who: str, when: str) -> None:
    """Register visits › By hand, up to the stage where what was done in the visit is entered."""
    start(page, url)
    page.get_by_role("button", name="Manage visits").first.click()
    page.get_by_role("button", name="Register visits").first.click()
    page.get_by_role("button", name="By hand").first.click()
    _pick(page, 0, location)
    _pick(page, 0, who)
    _set_when(page, when)
    page.get_by_text("Continue →").first.click()
    page.wait_for_timeout(600)


def _installation(page, url: str, row, who: str = "Pedro Pérez", shot_as: str | None = None) -> None:
    location, camera, card, when = row
    _until_the_visit(page, url, location, who, when)
    page.get_by_role("button", name="Camera").first.click()
    page.get_by_role("button", name="SD card").first.click()
    _pick(page, 0, camera)
    page.get_by_role("switch", name="Calibration done").click()
    page.get_by_placeholder("e.g. 1.2").fill("1")
    page.get_by_placeholder("e.g. -90").fill("0")
    page.get_by_placeholder("e.g. 225").fill("0")
    page.get_by_placeholder("e.g. 120").fill("30")
    _pick(page, 1, card)
    if shot_as:
        save(page, shot_as)
    page.get_by_text("Review the visit →").first.click()
    page.get_by_role("button", name="Yes, add the visit").click()
    page.wait_for_timeout(1000)


def _revision(page, url: str, row, who: str = "Pedro Pérez", shot_as: str | None = None) -> None:
    location, card, photos, when = row
    _until_the_visit(page, url, location, who, when)
    page.get_by_text("Yes, I see it").first.click()
    page.get_by_text("All is well").first.click()
    page.get_by_role("button", name="Camera").first.click()
    page.get_by_role("button", name="SD card").first.click()
    page.get_by_role("switch", name="Calibration done").click()
    page.get_by_role("textbox").last.fill(photos)
    _pick(page, 0, card)
    if shot_as:
        save(page, shot_as)
    page.get_by_text("Review the visit →").first.click()
    page.get_by_role("button", name="Yes, add the visit").click()
    page.wait_for_timeout(1000)


def _dashboard(page, url: str, name: str) -> None:
    start(page, url)
    page.get_by_role("button", name="Manage visits").first.click()
    page.get_by_role("button", name="Visit dashboard").first.click()
    page.wait_for_load_state("networkidle")
    save(page, name)


@shot("visits-walkthrough", fresh=True)
def _(page, url):
    """The first revision — the form of the first visit, the dashboard with it and with the four — and the second — the form of its first visit and the dashboard at the end."""
    _installation(page, url, INSTALLATIONS[0], shot_as="visit-installation-form")
    _dashboard(page, url, "dashboard-first-visit")
    for row in INSTALLATIONS[1:]:
        _installation(page, url, row)
    _dashboard(page, url, "dashboard-first-revision")
    _revision(page, url, REVISIONS[0], shot_as="visit-revision-form")
    for row in REVISIONS[1:]:
        _revision(page, url, row)
    _dashboard(page, url, "dashboard-second-revision")


@shot("settings-preprocessing")
def _(page, url):
    """Settings › Preprocessing, with the authorship filled in."""
    settings(page, "Preprocessing")
    for label, value in (("Owner", "University of Huelva"), ("Publisher", "University of Huelva"), ("Coverage", "Parque Nacional de Doñana")):
        page.get_by_role("combobox", name=label).fill(value)
    page.get_by_role("heading", name="Preprocessing").click()   # nothing is left with the focus
    save(page, "settings-preprocessing")


@shot("settings-general")
def _(page, url):
    settings(page, "General")
    save(page, "settings-general")


@shot("settings-trapper")
def _(page, url):
    """Settings › Uploader › Trapper — with no account: nothing private is shown."""
    settings(page, "Uploader")
    tab = page.get_by_role("tab", name="Trapper")
    if tab.count():
        tab.click()
    save(page, "settings-trapper")


@shot("settings-epicollect")
def _(page, url):
    settings(page, "Visit sources")
    page.get_by_role("tab", name="Epicollect", exact=True).click()
    save(page, "settings-epicollect")


@shot("settings-validation")
def _(page, url):
    settings(page, "Validation")
    save(page, "settings-validation")


@shot("settings-postvalidation")
def _(page, url):
    settings(page, "Postvalidation")
    save(page, "settings-postvalidation")


def save_part(page, name: str, top: int, bottom: int | None = None) -> None:
    """A part of the page, from `top` to `bottom` (in pixels): a long page cropped to what matters."""
    page.wait_for_timeout(300)
    height = page.evaluate("document.documentElement.scrollHeight")
    page.screenshot(path=str(OUT / f"{name}.png"), full_page=True, clip={"x": 0, "y": top, "width": SIZE["width"], "height": (bottom or height) - top})


def _register(page, source: str, shot_as: str | None = None) -> None:
    """Menu › Register the visits, and one of the ways the visits come in (with a screenshot of the choice, if `shot_as` says)."""
    page.get_by_role("button", name="Continue with WICP_02").click()
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="Register the visits").first.click()
    page.wait_for_load_state("networkidle")
    if shot_as:
        save_part(page, shot_as, 0, 560)
    page.get_by_role("button", name=source).first.click()
    page.wait_for_load_state("networkidle")


def _file(page, folder: str, name: str) -> None:
    page.locator("input[type=file]").first.set_input_files(str(ROOT / "examples" / "visits_example" / folder / "wicp_02" / name))
    page.wait_for_timeout(800)


def _check_and_save(page, shot: str, review_button: str, press_continue: bool = True) -> None:
    """From the step of the file: the check of the visits, the review and the end — each with its screenshot. (With a custom CSV the check starts when the columns are read.)"""
    if press_continue:
        page.get_by_text("Continue →").first.click()
    page.wait_for_timeout(4000)
    save(page, f"{shot}-check")
    page.get_by_text("Continue to the review").first.click()
    page.wait_for_timeout(1500)
    save_part(page, f"{shot}-review", 0, 960)
    page.get_by_role("button", name=review_button).click()
    page.wait_for_timeout(2500)
    save(page, f"{shot}-saved")


@shot("settings-wildintel-csv")
def _(page, url):
    settings(page, "Visit sources")
    page.get_by_role("tab", name="WildINTEL Epicollect CSV", exact=True).click()
    save(page, "settings-wildintel-csv")


@shot("guide-epicollect", fresh=True)
def _(page, url):
    """Register the visits › WildINTEL Epicollect CSV, from the file to the visits saved (revision_1_installation.csv: the four cameras are put up)."""
    _register(page, "WildINTEL Epicollect CSV", shot_as="guide-visits-source")
    _file(page, "wildintel_csv", "revision_1_installation.csv")
    save_part(page, "guide-epicollect-file", 0, 950)
    page.get_by_role("button", name="Customize").click()
    page.wait_for_timeout(500)
    save_part(page, "guide-epicollect-rules", 360, 1820)
    page.get_by_role("button", name="Done").first.click()
    page.wait_for_timeout(300)
    _check_and_save(page, "guide-epicollect", "Add 4 visits")


@shot("guide-csv", fresh=True)
def _(page, url):
    """Register the visits › Custom CSV, with columns to match by hand (columns_to_map.csv: semicolons, Spanish headers, dates day first)."""
    _register(page, "Custom CSV")
    _file(page, "custom_csv", "columns_to_map.csv")
    save_part(page, "guide-csv-file", 0, 950)
    page.get_by_text("Continue →").first.click()
    page.wait_for_timeout(1500)
    boxes = page.get_by_role("combobox")
    # the order of the fields: who went, actions, site, latitude, longitude, revision, date, time, date and time, created at, SD card left, SD card…
    boxes.nth(11).select_option(label="Not matched")   # "Tarjeta" is the SD card that is left, not its state
    for nth, column in ((0, "Quien"), (1, "Tarea"), (2, "Lugar"), (6, "Dia"), (10, "Tarjeta"), (12, "Fotos")):
        boxes.nth(nth).select_option(label=column)
    save_part(page, "guide-csv-mapping", 190, 1500)
    page.get_by_role("button", name="Read the visits").click()
    _check_and_save(page, "guide-csv", "Add 7 visits", press_continue=False)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("names", nargs="*", help="the screenshots to take (all by default)")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--explore", metavar="BUTTON", nargs="*", help="click these buttons in turn and print what the page offers")
    args = ap.parse_args()
    if args.list:
        print("\n".join(SHOTS))
        return 0
    wanted = args.names or list(SHOTS)
    unknown = [n for n in wanted if n not in SHOTS]
    if unknown and args.explore is None:
        ap.error(f"unknown: {', '.join(unknown)} (see --list)")
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        if args.explore is not None:
            with app() as url:
                browser = launch(pw)
                page = browser.new_context(viewport=SIZE, color_scheme="dark").new_page()
                start(page, url)
                for b in args.explore:
                    page.get_by_role("button", name=b).first.click() if page.get_by_role("button", name=b).count() else page.get_by_text(b).first.click()
                    page.wait_for_load_state("networkidle")
                    print(f"after {b!r}:")
                    dump(page)
                browser.close()
            return 0
        for name in [n for n in wanted if n in FRESH]:
            with app(True) as url:
                browser = launch(pw)
                page = browser.new_context(viewport=SIZE, color_scheme="dark").new_page()
                start(page, url)
                SHOTS[name](page, url)
                print("  ", name)
                browser.close()
        for seeded, names in ((True, [n for n in wanted if n not in EMPTY and n not in BASE and n not in FRESH]), ("base", [n for n in wanted if n in BASE]), (False, [n for n in wanted if n in EMPTY])):
            if not names:
                continue
            with app(seeded) as url:
                browser = launch(pw)
                page = browser.new_context(viewport=SIZE, color_scheme="dark").new_page()
                start(page, url)
                for name in names:
                    start(page, url)   # from the app as it opens: what a shot leaves open is not in the next
                    SHOTS[name](page, url)
                    print("  ", name)
                browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
