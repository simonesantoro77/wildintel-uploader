"""What every command of the command-line app shares: the console, friendly
errors, and credentials (settings.toml's — see `config`)."""
from __future__ import annotations

from collections.abc import Callable
from typing import TypeVar

import httpx
import typer
from rich.console import Console
from trapper_client import err

from wildintel_uploader.core.services import trapper_service

console = Console()
err_console = Console(stderr=True)

T = TypeVar("T")


def describe(exc: BaseException) -> str:
    """What went wrong, for a person — the web routers' own mapping."""
    if isinstance(exc, err.UnauthorizedError):
        return "Incorrect TRAPPER username or password."
    if isinstance(exc, err.ForbiddenError):
        return "You don't have permission to access this TRAPPER resource."
    if isinstance(exc, err.NotFoundError):
        return "TRAPPER resource not found."
    if isinstance(exc, httpx.ConnectError):
        return f"Could not connect to the TRAPPER server: {exc}"
    if isinstance(exc, httpx.TimeoutException):
        return f"Timed out connecting to the TRAPPER server: {exc}"
    return str(exc) or type(exc).__name__


def fail(message: str, code: int = 1) -> typer.Exit:
    err_console.print(f"[red]✘  {message}[/red]")
    return typer.Exit(code)


def call(fn: Callable[[], T]) -> T:
    """fn(), its errors as a clean message and exit code 1."""
    try:
        return fn()
    except typer.Exit:
        raise
    except Exception as exc:
        raise fail(describe(exc)) from exc


def trapper_credentials(url: str | None = None) -> tuple[str, str, str]:
    try:
        return trapper_service.resolve_credentials(url, None, None)
    except ValueError as exc:
        raise fail(f"{exc} Set it with: wildintel-uploader config set TRAPPER.<field> …") from exc
