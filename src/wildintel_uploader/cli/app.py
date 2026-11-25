"""WildINTEL Uploader — the command-line app: import a camera-trap
deployment into Trapper from a local folder, on the same core (and the
same settings.toml) as the web app.

    wildintel-uploader --help
"""
from __future__ import annotations

from pathlib import Path
from typing import Annotated, Optional

import typer
from pydantic import ValidationError
from rich.panel import Panel
from rich.prompt import Confirm, FloatPrompt, IntPrompt, Prompt
from rich.table import Table

from wildintel_uploader.cli.common import call, console, err_console, fail, trapper_credentials
from wildintel_uploader.core import config
from wildintel_uploader.core.schemas.requests import DeploymentFields
from wildintel_uploader.core.services import deployment_import_service, statistics_service, trapper_service
from wildintel_uploader.core.version import current_version

app = typer.Typer(
    name="wildintel-uploader",
    help="WildINTEL Uploader — import camera-trap deployments into TRAPPER.",
    no_args_is_help=True,
    rich_markup_mode="rich",
)


def _show_version(value: bool) -> None:
    if value:
        console.print(current_version())
        raise typer.Exit()


@app.callback()
def main(
    verbose: Annotated[bool, typer.Option("--verbose", "-v", help="Show the log's messages as it works.")] = False,
    version: Annotated[bool, typer.Option("--version", help="Show the version and exit.", is_eager=True, callback=_show_version)] = False,
) -> None:
    from wildintel_uploader.core import logging_setup

    logging_setup.configure(console_level="DEBUG" if verbose else "WARNING")


# ── Connection ───────────────────────────────────────────────────────────────

@app.command("test-connection")
def test_connection() -> None:
    """Test the connection to TRAPPER (settings.toml's account)."""
    trapper = trapper_credentials()
    result = call(lambda: trapper_service.test_connection(*trapper))
    console.print(f"[green]✔[/green] TRAPPER {trapper[0]} as {trapper[1]} — {result['research_projects_count']} research project(s)")


app.command("tc", hidden=True, help="Alias for test-connection.")(test_connection)


# ── config ────────────────────────────────────────────────────────────────────

config_app = typer.Typer(help="Show or change the settings — the same settings.toml as the web app's ⚙️ page.", no_args_is_help=True)
app.add_typer(config_app, name="config")

# every setting marked secret in the schema of the settings: never shown, and hidden while it is typed
_SECRET = frozenset(config.secret_fields())


@config_app.command("show")
def config_show() -> None:
    """Show every setting (the passwords and the secrets never shown)."""
    settings = config.load_settings()
    for section, values in settings.model_dump().items():
        table = Table(title=section, title_justify="left", show_header=False, box=None, padding=(0, 2))
        for key, value in values.items():
            shown = ("(saved)" if value else "(not set)") if (section, key) in _SECRET else ("—" if value is None else str(value))
            table.add_row(f"{section}.{key}", shown)
        console.print(table)
    console.print(f"[dim]{config.active_config_file()}[/dim]")


@config_app.command("path")
def config_path() -> None:
    """Where settings.toml, the log and the app's documents are."""
    from wildintel_uploader.core import logging_setup

    console.print(f"Settings:  {config.active_config_file()}")
    console.print(f"Log:       {logging_setup.log_file()}")
    console.print(f"Data:      {config.data_dir()}")
    console.print(f"Collections: {config.collections_dir()}")


@config_app.command("set")
def config_set(
    key: Annotated[str, typer.Argument(help="SECTION.field — e.g. TRAPPER.base_url, TRAPPER.user_password, DATA.dir.")],
    value: Annotated[Optional[str], typer.Argument(help="The new value — asked for (hidden for a password or a secret) if left out.")] = None,
) -> None:
    """Change one setting."""
    section, _, field = key.partition(".")
    settings = config.load_settings()
    data = settings.model_dump()
    if section not in data or field not in data[section]:
        raise fail(f"No setting {key}. See: wildintel-uploader config show")
    if value is None:
        value = typer.prompt(key, hide_input=(section, field) in _SECRET)
    data[section][field] = value if value != "" else None
    try:
        new = config.Settings.model_validate(data)
    except ValidationError as exc:
        raise fail(f"Invalid {key}: {exc.errors()[0]['msg']}.") from exc
    config.save_settings(new)
    console.print(f"[green]✔[/green] {key} saved.")


# ── Trapper lookups ───────────────────────────────────────────────────────────

trapper_app = typer.Typer(help="Find the TRAPPER ids the other commands take.", no_args_is_help=True)
app.add_typer(trapper_app, name="trapper")


def _cell(value) -> str:
    if value is None:
        return "—"
    return str(value)


def _table(title: str, columns: list[str], rows: list[list]) -> None:
    table = Table(*columns, title=title, title_justify="left")
    for row in rows:
        table.add_row(*[_cell(c) for c in row])
    console.print(table)


@trapper_app.command("research-projects")
def trapper_research_projects() -> None:
    """The research projects you can access."""
    trapper = trapper_credentials()
    rows = call(lambda: trapper_service.list_research_projects(*trapper))
    _table("Research projects", ["pk", "Name", "Acronym"], [[r["pk"], r["name"], r["acronym"]] for r in rows])


@trapper_app.command("classification-projects")
def trapper_classification_projects(rp: Annotated[int, typer.Option("--rp", "--research-project", help="Research project pk.")]) -> None:
    """A research project's classification projects."""
    trapper = trapper_credentials()
    rows = call(lambda: trapper_service.list_classification_projects(*trapper, rp))
    _table("Classification projects", ["pk", "Name", "Active"], [[r["pk"], r["name"], r["is_active"]] for r in rows])


@trapper_app.command("locations")
def trapper_locations(rp: Annotated[int, typer.Option("--rp", "--research-project", help="Research project pk.")]) -> None:
    """A research project's locations."""
    trapper = trapper_credentials()
    rows = call(lambda: trapper_service.list_locations(*trapper, rp))
    _table("Locations", ["pk", "Location id", "Name", "Timezone"], [[r["pk"], r["location_id"], r["name"], r["timezone"]] for r in rows])


# ── import-deployment (the wizard) ───────────────────────────────────────────

def _pick(prompt: str, items: list[dict], label_fn) -> dict:
    if not items:
        raise fail("Nothing to choose from.")
    _table(prompt, ["#", "Choice"], [[i + 1, label_fn(item)] for i, item in enumerate(items)])
    choice = typer.prompt(f"{prompt} — number", type=int)
    if not 1 <= choice <= len(items):
        raise fail("Invalid choice.")
    return items[choice - 1]


def _optional_prompt(label: str, default: str | None = None) -> Optional[str]:
    value = Prompt.ask(label, default=default or "")
    return value or None


@app.command("import-deployment")
def import_deployment() -> None:
    """Import a deployment: organize a folder of camera-trap images locally,
    then register the deployment in TRAPPER. Does not upload the images to
    TRAPPER yet — that's a separate step this app doesn't have."""
    trapper = trapper_credentials()

    console.print(Panel(
        "This copies your images to this app's own data folder before doing "
        "anything else — nothing in the source folder is changed or moved.\n\n"
        "[yellow]Copy the images from the camera's SD card to a local folder "
        "first — don't point this at the card itself.[/yellow]",
        title="Import deployment",
    ))
    if not Confirm.ask("Continue?", default=True):
        raise typer.Exit()

    rp = _pick("Research project", call(lambda: trapper_service.list_research_projects(*trapper)),
               lambda p: f"{p['acronym'] + ' — ' if p['acronym'] else ''}{p['name']}")

    cps = call(lambda: trapper_service.list_classification_projects(*trapper, rp["pk"]))
    cp = _pick("Classification project (optional)", [{"pk": None, "name": "(none)"}] + cps, lambda p: p["name"]) if cps else None

    locations = call(lambda: trapper_service.list_locations(*trapper, rp["pk"]))
    location = _pick("Location", locations, lambda l: f"{l['location_id']} — {l['name'] or ''}")

    source_dir = Prompt.ask("Source images folder")
    scan = call(lambda: deployment_import_service.scan_folder(Path(source_dir).expanduser()))
    console.print(f"  {scan['file_count']} file(s), {scan['image_count']} image(s)")
    for warning in scan["warnings"]:
        console.print(f"  [yellow]⚠ {warning}[/yellow]")
    # What the form starts from — the images' date range and camera.
    guess = call(lambda: deployment_import_service.guess_details(Path(source_dir).expanduser()))
    console.print(f"  Capture dates: {guess['start_date'] or '—'} → {guess['end_date'] or '—'}")
    for warning in guess["warnings"]:
        console.print(f"  [yellow]⚠ {warning}[/yellow]")

    revision = IntPrompt.ask("Revision number (1, 2, 3…)")
    deployment_id = call(lambda: deployment_import_service.deployment_id_for(revision, location["location_id"]))
    console.print(f"  Deployment id: [bold]{deployment_id}[/bold]")
    timezone = Prompt.ask("Timezone (IANA, e.g. Europe/Madrid)", default=location["timezone"] or "")
    latitude = FloatPrompt.ask("Latitude (decimal degrees, WGS84, -90..90)")
    longitude = FloatPrompt.ask("Longitude (decimal degrees, WGS84, -180..180)")
    start_date = Prompt.ask("Start date (local time, YYYY-MM-DDThh:mm:ss)", default=guess["start_date"] or "")
    end_date = Prompt.ask("End date (local time, YYYY-MM-DDThh:mm:ss)", default=guess["end_date"] or "")
    camera_model = _optional_prompt("Camera model", guess["camera_model"])

    # Camtrap DP wants the dates with a timezone designator (±hh:mm).
    start_date = call(lambda: deployment_import_service.with_timezone(start_date, timezone))
    end_date = call(lambda: deployment_import_service.with_timezone(end_date, timezone))

    fields: dict = {
        "deployment_id": deployment_id, "location_id": location["location_id"], "location_name": location["name"],
        "latitude": latitude, "longitude": longitude,
        "start_date": start_date, "end_date": end_date, "camera_model": camera_model,
    }
    if Confirm.ask("Fill in the rest of the deployment fields now (camera setup, habitat, bait, comments...)?", default=False):
        for key, label in [
            ("setup_by", "Set up by"), ("camera_id", "Camera id"),
            ("coordinate_uncertainty", "Coordinate uncertainty (m)"),
            ("camera_interval", "Camera delay (seconds)"), ("camera_height", "Camera height (m)"),
            ("camera_depth", "Camera depth (m)"),
            ("camera_tilt", "Camera tilt (degrees)"), ("camera_heading", "Camera heading (degrees)"),
            ("detection_distance", "Detection distance (m)"), ("bait_use", "Bait used (true/false)"),
            ("feature_type", "Feature type"), ("habitat", "Habitat"),
            ("deployment_groups", "Deployment groups"), ("comments", "Comments"),
        ]:
            fields[key] = _optional_prompt(label)

    try:
        deployment = DeploymentFields.model_validate(fields)
    except ValidationError as exc:
        raise fail(exc.errors()[0]["msg"]) from exc

    console.print(Panel(
        f"[bold]{deployment.deployment_id}[/bold] at {deployment.location_id} — "
        f"{deployment.start_date} → {deployment.end_date or '?'}",
        title="Ready to import",
    ))
    if not Confirm.ask("Proceed?", default=True):
        raise typer.Exit()

    def run():
        for event in deployment_import_service.import_stream(
            *trapper, rp["pk"], cp["pk"] if cp else None, source_dir, deployment, timezone,
            research_project_id=str(rp.get("acronym") or rp["pk"]),
        ):
            if event["type"] == "copy":
                console.print(f"  [{event['index']}/{event['total']}] {event['name']}")
            elif event["type"] == "registering":
                console.print("  Registering the deployment in TRAPPER…")
            elif event["type"] == "done":
                console.print(f"[green]✔  Imported — images organized in {event['dest_dir']}[/green]")

    call(run)


# ── statistics ────────────────────────────────────────────────────────────────

statistics_app = typer.Typer(help="Compare the deployments with the previous revisions of their location.", no_args_is_help=True)
app.add_typer(statistics_app, name="statistics")


def _statistics_args(settings) -> dict:
    post = settings.POSTVALIDATION
    return {"sequence_gap_seconds": post.sequence_gap_seconds}


def _num(value, digits: int = 1) -> str:
    return "—" if value is None else (str(int(value)) if float(value) == int(value) else f"{value:.{digits}f}")


@statistics_app.command("collection")
def statistics_collection(
    research_project: Annotated[str, typer.Argument(help="The research project's id (its folder in the collections folder).")],
    collection: Annotated[str, typer.Argument(help="The collection, e.g. R0028.")],
) -> None:
    """Each deployment of a collection against the previous revisions of its location, with the thresholds of POSTVALIDATION."""
    settings = config.load_settings()
    post = settings.POSTVALIDATION
    rows = call(lambda: statistics_service.collection_statistics(
        config.collections_dir(settings), research_project, collection,
        sequence_gap_seconds=post.sequence_gap_seconds, min_revisions=post.min_revisions, method=post.similarity_method,
        tolerances={"image_count": post.image_count_tolerance, "sequence_count": post.sequence_count_tolerance, "sequence_length": post.sequence_length_tolerance},
    ))
    table = Table(title=f"{research_project} / {collection}", title_justify="left")
    for column in ("Deployment", "Images", "Per day", "Sequences", "Seq. length", "Longest", "Previous", "Status"):
        table.add_column(column, justify="left" if column in ("Deployment", "Status") else "right")
    styles = {"ok": "green", "review": "red", "insufficient_history": "yellow"}
    for row in rows:
        m = row["metrics"]
        previous = row["checks"]["image_count"]["previous"]
        table.add_row(row["deployment_id"], _num(m["image_count"]), _num(m["images_per_day"]), _num(m["sequence_count"]), _num(m["sequence_length"]),
                      _num(m["sequence_max"]), str(previous), f"[{styles[row['status']]}]{row['status']}[/]")
    console.print(table)
    for row in rows:
        for check in row["checks"].values():
            if not check["skipped"] and not check["ok"]:
                console.print(f"  [red]✘[/red] {row['deployment_id']}: {check['message']}")
    if not rows:
        console.print("[yellow]No deployments in that collection.[/yellow]")


@statistics_app.command("compare")
def statistics_compare(
    research_project: Annotated[str, typer.Argument(help="The research project's id.")],
    first: Annotated[str, typer.Argument(help="The deployment to compare from, e.g. R0002-DONA_0006.")],
    second: Annotated[str, typer.Argument(help="The deployment to compare to, e.g. R0003-DONA_0006.")],
) -> None:
    """Two deployments side by side — for the same location in two revisions."""
    settings = config.load_settings()
    result = call(lambda: statistics_service.compare_deployments(
        config.collections_dir(settings), research_project, first, second, **_statistics_args(settings)))
    table = Table(title=f"{first} → {second}", title_justify="left")
    for column in ("Metric", first, second, "Change"):
        table.add_column(column, justify="left" if column == "Metric" else "right")
    for key, values in result["metrics"].items():
        change = values["change_percent"]
        table.add_row(key, _num(values["first"]), _num(values["second"]), "—" if change is None else f"{change:+.0f}%")
    console.print(table)


def run() -> None:
    app()
