"""The web manual's screenshots, taken from the built frontend with its
backend faked in the page (mock_api.js) — sample data only: no Trapper, no
real folders, no real account.

    uv run wucli docs screenshots        # builds the frontend first
    uv run python tools/screenshots/capture.py [NAME …]   # only these

Needs Playwright (the dev group) and Chrome/Chromium: the system's, if
found, else Playwright's own (`uv run playwright install chromium`).
Writes docs/img/screenshots/NAME.png."""
from __future__ import annotations

import functools
import http.server
import re
import shutil
import sys
import threading
from collections.abc import Callable
from pathlib import Path

from playwright.sync_api import Locator, Page, expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "frontend" / "dist"
OUT = ROOT / "docs" / "img" / "screenshots"
MOCK = Path(__file__).with_name("mock_api.js")
VIEWPORT = {"width": 1100, "height": 800}

SHOTS: dict[str, Callable[[Page], None]] = {}


def shot(name: str):
    def register(fn: Callable[[Page], None]):
        SHOTS[name] = fn
        return fn
    return register


def _page_y(locator: Locator, edge: str) -> float:
    return locator.evaluate(f"e => e.getBoundingClientRect().{edge} + window.scrollY")


def save(page: Page, name: str, *, top: Locator | None = None, bottom: Locator | None = None) -> None:
    """The whole page — or, for a long one, from top's element to bottom's."""
    page.wait_for_timeout(300)
    path = OUT / f"{name}.png"
    if top is None and bottom is None:
        page.screenshot(path=path, full_page=True)
    else:
        y0 = max(0, _page_y(top, "top") - 24) if top else 0
        y1 = _page_y(bottom, "bottom") + 24 if bottom else page.evaluate("document.documentElement.scrollHeight")
        page.screenshot(path=path, full_page=True, clip={"x": 0, "y": y0, "width": VIEWPORT["width"], "height": y1 - y0})
    print(f"  {name}.png")


def heading(page: Page, text: str) -> Locator:
    return page.get_by_role("heading", name=text, exact=True).first


def button(page: Page, name: str, *, exact: bool = True) -> Locator:
    return page.get_by_role("button", name=name, exact=exact)


def choose(page: Page, combobox_id: str, option: str) -> None:
    """Picks an option of one of the app's searchable pickers."""
    page.locator(f"#{combobox_id}").click()
    page.get_by_role("option", name=re.compile(re.escape(option))).first.click()


# ── Start, menu, settings ────────────────────────────────────────────────────

def start(page: Page) -> None:
    page.goto("/")


@shot("welcome")
def welcome(page: Page) -> None:
    start(page)
    expect(button(page, "Get Started", exact=False)).to_be_visible()
    save(page, "welcome")


@shot("unfinished-runs")
def unfinished_runs(page: Page) -> None:
    page.add_init_script("window.__mock.sessions = window.__mock.unfinished")
    page.goto("/")
    expect(page.get_by_text("Unfinished runs")).to_be_visible()
    save(page, "unfinished-runs")


def to_menu(page: Page) -> None:
    start(page)
    button(page, "Get Started", exact=False).click()
    expect(page.get_by_text("What do you want to do?")).to_be_visible()


@shot("menu")
def menu(page: Page) -> None:
    to_menu(page)
    save(page, "menu")


def open_task(page: Page, title: str) -> None:
    to_menu(page)
    page.locator("button", has=page.locator("strong", has_text=re.compile(f"^{re.escape(title)}$"))).click()


def open_util(page: Page, title: str) -> None:
    """A task of the Utils page, under the menu's last button."""
    open_task(page, "Utils")
    expect(heading(page, "Utilities")).to_be_visible()
    page.locator("button", has=page.locator("strong", has_text=re.compile(f"^{re.escape(title)}$"))).click()


@shot("utils")
def utils(page: Page) -> None:
    open_task(page, "Utils")
    expect(heading(page, "Utilities")).to_be_visible()
    save(page, "utils")


SETTINGS_SECTIONS = {
    "general": "General", "trapper": "Trapper", "epicollect": "Epicollect5", "validation": "Validation",
    "postvalidation": "Postvalidation", "preprocessing": "Preprocessing", "config": "Config",
}


def _settings_shot(key: str, label: str) -> None:
    @shot(f"settings-{key}")
    def take(page: Page) -> None:
        start(page)
        page.get_by_role("button", name="Settings").click()
        page.get_by_role("navigation", name="Settings sections").get_by_text(label, exact=True).click()
        save(page, f"settings-{key}")


for _key, _label in SETTINGS_SECTIONS.items():
    _settings_shot(_key, _label)


# ── Import deployment ────────────────────────────────────────────────────────

SOURCE = "/home/me/Pictures/R0003-DONA_01"


def to_folder(page: Page) -> None:
    open_task(page, "Import deployment")
    expect(heading(page, "Select the folder")).to_be_visible()


def scan(page: Page) -> None:
    page.locator("#source-dir").fill(SOURCE)
    button(page, "Scan").click()
    expect(page.get_by_text("241 images found")).to_be_visible()


@shot("step-folder")
def step_folder(page: Page) -> None:
    to_folder(page)
    scan(page)
    save(page, "step-folder")


def to_checks_choice(page: Page) -> None:
    to_folder(page)
    scan(page)
    button(page, "Continue to the checks").click()
    expect(heading(page, "Choose the checks")).to_be_visible()


@shot("step-validate")
def step_validate(page: Page) -> None:
    to_checks_choice(page)
    save(page, "step-validate")


def run_validation(page: Page) -> None:
    to_checks_choice(page)
    button(page, "Run checks").click()
    expect(page.get_by_role("link", name="Download report")).to_be_visible()


@shot("validation-failures")
def validation_failures(page: Page) -> None:
    run_validation(page)
    page.get_by_role("button", name=re.compile("^Open the failures of Required")).click()
    section = page.get_by_role("region", name=re.compile("^Failures of Required"))
    expect(section.get_by_role("button", name="View details of IMG_0012.JPG")).to_be_visible()
    page.wait_for_load_state("networkidle")
    save(page, "validation-failures", top=heading(page, "Results"), bottom=section)


def to_origin(page: Page) -> None:
    run_validation(page)
    button(page, "Continue").last.click()
    expect(heading(page, "Where was it taken?")).to_be_visible()


@shot("step-origin")
def step_origin(page: Page) -> None:
    to_origin(page)
    choose(page, "origin-research-project", "DONA")
    choose(page, "origin-location", "DONA_01")
    expect(button(page, "Continue to the dates")).to_be_enabled()
    save(page, "step-origin")


def to_details(page: Page) -> None:
    to_origin(page)
    choose(page, "origin-research-project", "DONA")
    choose(page, "origin-location", "DONA_01")
    button(page, "Continue to the dates").click()
    expect(heading(page, "When was it collected?")).to_be_visible()
    button(page, "Continue to more details").click()
    expect(heading(page, "More details")).to_be_visible()


@shot("step-details")
def step_details(page: Page) -> None:
    to_details(page)
    save(page, "step-details")


def to_dates(page: Page) -> None:
    to_origin(page)
    choose(page, "origin-research-project", "DONA")
    choose(page, "origin-location", "DONA_01")
    button(page, "Continue to the dates").click()
    expect(heading(page, "When was it collected?")).to_be_visible()


@shot("step-dates")
def step_dates(page: Page) -> None:
    to_dates(page)
    save(page, "step-dates")


def to_checks(page: Page) -> None:
    to_details(page)
    button(page, "Continue").last.click()
    expect(heading(page, "Check the details")).to_be_visible()


@shot("step-checks")
def step_checks(page: Page) -> None:
    to_checks(page)
    button(page, "Run checks").click()
    expect(page.get_by_text("Every check passed.")).to_be_visible()
    save(page, "step-checks")


def to_preprocessing(page: Page) -> None:
    to_checks(page)
    button(page, "Run checks").click()
    expect(page.get_by_text("Every check passed.")).to_be_visible()
    button(page, "Continue").last.click()
    expect(heading(page, "Prepare and save")).to_be_visible()


@shot("step-preprocessing")
def step_preprocessing(page: Page) -> None:
    to_preprocessing(page)
    save(page, "step-preprocessing")


@shot("step-import")
def step_import(page: Page) -> None:
    to_preprocessing(page)
    button(page, "Start preparing").click()
    expect(button(page, "Continue to save")).to_be_visible()
    button(page, "Continue to save").click()
    button(page, "Save deployment").click()
    expect(page.get_by_text("Deployment saved", exact=True)).to_be_visible()
    save(page, "step-import")


@shot("reports")
def reports(page: Page) -> None:
    start(page)
    page.get_by_role("button", name="Settings").click()
    page.get_by_role("navigation", name="Settings sections").get_by_text("Reports").click()
    page.get_by_role("listitem", name="Validation of R0003-DONA_01").get_by_role("button", name="View").click()
    expect(page.get_by_role("link", name="Download CSV")).to_be_visible()
    save(page, "reports")


# ── Import session ───────────────────────────────────────────────────────────

def to_session_dates(page: Page) -> None:
    open_task(page, "Import session")
    page.locator("input").first.fill("/home/me/Pictures/trip-2024-09")
    button(page, "Scan").click()
    expect(page.get_by_text("tick the ones to import")).to_be_visible()
    button(page, "Continue to the checks").click()
    button(page, "Run checks").click()
    expect(page.get_by_role("link", name="Download report")).to_be_visible()
    button(page, "Continue with 3 folders", exact=False).click()
    choose(page, "origin-research-project", "DONA")
    button(page, "Assign 3").click()
    button(page, "Continue to the details").click()
    expect(heading(page, "When was it collected?")).to_be_visible()


@shot("session-details")
def session_details(page: Page) -> None:
    to_session_dates(page)
    expect(page.get_by_text("Dates from: Epicollect5")).to_be_visible()
    save(page, "session-details", top=heading(page, "When was it collected?"))


@shot("session-dates-log")
def session_dates_log(page: Page) -> None:
    to_session_dates(page)
    page.get_by_role("button", name="Open DONA_02").click()
    expect(page.get_by_text("Dates from: Timestamp log file")).to_be_visible()
    save(page, "session-dates-log", top=heading(page, "When was it collected?"))


# ── Upload ───────────────────────────────────────────────────────────────────

def to_upload(page: Page) -> None:
    open_task(page, "Upload deployment to Trapper")
    choose(page, "upload-research-project", "DONA")
    choose(page, "upload-collection", "R0003")
    expect(page.get_by_label("R0003-DONA_01")).to_be_visible()


@shot("upload")
def upload(page: Page) -> None:
    to_upload(page)
    save(page, "upload")


@shot("upload-mode")
def upload_mode(page: Page) -> None:
    to_upload(page)
    button(page, "Continue to step 2").click()
    expect(heading(page, "Choose what to do")).to_be_visible()
    save(page, "upload-mode")


@shot("upload-running")
def upload_running(page: Page) -> None:
    page.add_init_script("window.__mock.holdSecond = true")
    to_upload(page)
    button(page, "Continue to step 2").click()
    page.get_by_role("radio", name=re.compile("^Upload")).first.check()
    button(page, "Continue to step 3").click()
    expect(page.get_by_text("1 of 2")).to_be_visible()
    save(page, "upload-running", top=heading(page, "Upload to Trapper"))


# ── Repair ───────────────────────────────────────────────────────────────────

@shot("repair")
def repair(page: Page) -> None:
    open_util(page, "Repair local deployments")
    choose(page, "repair-research-project", "DONA")
    choose(page, "repair-collection", "R0003")
    button(page, "Check the deployments").click()
    expect(page.get_by_text("deployment.json is missing")).to_be_visible()
    button(page, "Repair 2 deployments").click()
    expect(page.get_by_text("Valid again").first).to_be_visible()
    save(page, "repair")


# ── Sync ─────────────────────────────────────────────────────────────────────

@shot("sync")
def sync(page: Page) -> None:
    open_util(page, "Sync local collections")
    choose(page, "sync-research-project", "DONA")
    choose(page, "sync-classification-project", "DONA 2024")
    choose(page, "sync-collection", "R0002")
    page.get_by_role("checkbox", name="Select all deployments").check()
    button(page, "Sync", exact=False).last.click()
    expect(page.get_by_label("Sync result")).to_be_visible()
    save(page, "sync")


# ── Main ──────────────────────────────────────────────────────────────────────

PHOTOS = sorted((ROOT / "examples" / "deployment_example").glob("*.JPG"))


def _photo(route) -> None:
    """The pictures of a report: sample photos, a different one per image (the page's own fetch is faked, an <img> isn't)."""
    from urllib.parse import parse_qs, urlparse
    name = parse_qs(urlparse(route.request.url).query).get("path", [""])[0]
    route.fulfill(status=200, content_type="image/jpeg", body=PHOTOS[sum(map(ord, name)) % len(PHOTOS)].read_bytes())


def _browser(p):
    chrome = next((c for c in ("google-chrome", "chromium", "chromium-browser") if shutil.which(c)), None)
    return p.chromium.launch(executable_path=shutil.which(chrome) if chrome else None)


def main(names: list[str]) -> None:
    if not (DIST / "index.html").is_file():
        sys.exit("No frontend/dist — build the frontend first (cd frontend && npx vite build).")
    unknown = set(names) - SHOTS.keys()
    if unknown:
        sys.exit(f"No such screenshot: {', '.join(sorted(unknown))}. Known: {', '.join(SHOTS)}")
    OUT.mkdir(parents=True, exist_ok=True)

    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args) -> None:
            pass

    handler = functools.partial(Handler, directory=str(DIST))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"

    failed: list[str] = []
    for stale in OUT.glob("_failed-*.png"):
        stale.unlink()
    with sync_playwright() as p:
        browser = _browser(p)
        for name in names or SHOTS:
            context = browser.new_context(base_url=base, viewport=VIEWPORT, color_scheme="dark", device_scale_factor=1,
                                          locale="en-GB", timezone_id="Europe/Madrid")
            context.add_init_script(path=str(MOCK))
            context.route("**/api/reports/*/image*", _photo)
            page = context.new_page()
            page.set_default_timeout(8000)
            page.on("console", lambda m: print(f"    [console] {m.text}") if m.type in ("warning", "error") else None)
            try:
                SHOTS[name](page)
            except Exception as exc:
                failed.append(name)
                page.screenshot(path=OUT / f"_failed-{name}.png", full_page=True)
                print(f"  ✘ {name}: {str(exc).splitlines()[0]}")
            context.close()
        browser.close()
    server.shutdown()
    if failed:
        sys.exit(f"Failed: {', '.join(failed)} — see docs/img/screenshots/_failed-*.png")


if __name__ == "__main__":
    main(sys.argv[1:])
