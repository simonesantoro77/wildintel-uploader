"""
WildINTEL Uploader — CLI de gestión.

Se llama wucli (y no cli) porque wildintel-trapper-sdk, instalado en el mismo
entorno, ya trae su propio módulo y comando "cli".

Uso (o, equivalente, `uv run wildintel-uploader …`):
    uv run wucli dev [--backend-port 8769] [--frontend-port 5176]
    uv run wucli backend serve [dev|prod|debug] [--port 8769]
    uv run wucli backend test [-v] [-k filtro]
    uv run wucli frontend dev|build|preview|test|lint
    uv run wucli docs serve|build|screenshots [nombre …]
    uv run wucli package build [--format auto|appimage|windows|macos] [--version 0.1.0]
"""
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from enum import Enum
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.panel import Panel

from wildintel_uploader.web.settings import settings

# ── Constantes ────────────────────────────────────────────────────────────────

# src/wildintel_uploader/wucli.py → the repository's root.
ROOT_DIR      = Path(__file__).resolve().parents[2]
PACKAGE_DIR   = ROOT_DIR / "src" / "wildintel_uploader"
BUILD_DIR     = ROOT_DIR / "build"
FRONTEND_DIR  = ROOT_DIR / "frontend"
DIST_DIR      = ROOT_DIR / "dist"
MKDOCS_CFG    = ROOT_DIR / "mkdocs.yml"
SPEC_FILE     = ROOT_DIR / "wildintel-uploader.spec"
VERSION_FILE  = PACKAGE_DIR / "_version.py"
ICON          = ROOT_DIR / "docs" / "img" / "wildintel-uploader-icon.png"
APP_NAME      = "wildintel-uploader"
FRONTEND_PORT = 5176
# El clon local de wildintel-trapper-sdk (ver [tool.uv.sources] en
# pyproject.toml) — vigilado también en modo dev, para que editarlo recargue
# el backend en vez de seguir ejecutando el código viejo.
SDK_DIR       = ROOT_DIR.parent / "wildintel-trapper-sdk" / "src"

console = Console()
app     = typer.Typer(help="WildINTEL Uploader — herramienta de gestión.")


# ── Enums ─────────────────────────────────────────────────────────────────────

class ServeMode(str, Enum):
    dev   = "dev"
    prod  = "prod"
    debug = "debug"


class PackageFormat(str, Enum):
    auto     = "auto"
    appimage = "appimage"
    windows  = "windows"
    macos    = "macos"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _run(*args: str, cwd: Path | None = None, env: dict | None = None) -> None:
    result = subprocess.run(list(args), cwd=cwd, env=env)
    if result.returncode != 0:
        raise typer.Exit(result.returncode)


def _require(tool: str, hint: str) -> None:
    if shutil.which(tool) is None:
        console.print(f"[red]✘  '{tool}' no encontrado.[/red]  {hint}")
        raise typer.Exit(1)


def _ensure_frontend_deps() -> None:
    """Ejecuta `npm install` si falta frontend/node_modules, para que un
    'vite: not found' no dependa de haber leído el README."""
    if (FRONTEND_DIR / "node_modules").is_dir():
        return
    console.print("[yellow]No existe frontend/node_modules — instalando dependencias (npm install)...[/yellow]")
    _run("npm", "install", cwd=FRONTEND_DIR)


def _npm(*args: str) -> None:
    _require("npm", "Instala Node.js desde https://nodejs.org/ (v18+)")
    _ensure_frontend_deps()
    _run("npm", *args, cwd=FRONTEND_DIR)


def _uvicorn_args(port: int, *, reload: bool) -> list[str]:
    args = ["uvicorn", "wildintel_uploader.web.main:app", "--port", str(port)]
    if reload:
        reload_dirs = ["--reload-dir", str(PACKAGE_DIR)] + (["--reload-dir", str(SDK_DIR)] if SDK_DIR.is_dir() else [])
        return [*args, "--reload", *reload_dirs, "--log-level", settings.log_level.lower()]
    return [*args, "--log-level", "warning", "--workers", "2"]


# ── docs (manuales de usuario y desarrollador) ───────────────────────────────

docs_app = typer.Typer(help="Genera o sirve los manuales de usuario y desarrollador.")
app.add_typer(docs_app, name="docs")


@docs_app.command("serve")
def docs_serve(
    port: int = typer.Option(8080, "--port", "-p", help="Puerto del servidor de documentación."),
) -> None:
    """Sirve los manuales en local con recarga automática (http://127.0.0.1:<port>)."""
    console.print(f"[green]Documentación en http://127.0.0.1:{port}[/green]\n")
    _run("mkdocs", "serve", "--config-file", str(MKDOCS_CFG), "--dev-addr", f"127.0.0.1:{port}", cwd=ROOT_DIR)


@docs_app.command("build")
def docs_build(
    strict: bool = typer.Option(True, "--strict/--no-strict", help="Falla con avisos (enlaces rotos...), como en CI."),
) -> None:
    """Genera el sitio estático de los manuales en site/."""
    console.print("[green]Generando manuales...[/green]")
    _run("mkdocs", "build", "--config-file", str(MKDOCS_CFG), *(["--strict"] if strict else []), cwd=ROOT_DIR)
    console.print(f"[green]✔  Sitio generado en {ROOT_DIR / 'site'}[/green]")


@docs_app.command("screenshots")
def docs_screenshots(
    names: Optional[list[str]] = typer.Argument(None, help="Solo estas capturas (p. ej. welcome step-details); por defecto, todas."),
    build: bool = typer.Option(True, "--build/--no-build", help="Compilar antes el frontend."),
) -> None:
    """Regenera las capturas del manual web (docs/img/screenshots/) con datos de ejemplo —
    el backend simulado en la página: sin Trapper, sin carpetas ni cuentas reales."""
    if build:
        # vite build, sin el `tsc -b` de `npm run build`: para las capturas basta el bundle.
        _npm("exec", "--", "vite", "build")
    _run(sys.executable, str(ROOT_DIR / "tools" / "screenshots" / "capture.py"), *(names or []), cwd=ROOT_DIR)


# ── backend ───────────────────────────────────────────────────────────────────

backend_app = typer.Typer(help="Gestiona el backend FastAPI.")
app.add_typer(backend_app, name="backend")


@backend_app.command("serve")
def backend_serve(
    mode: ServeMode = typer.Argument(ServeMode.dev, help="Modo de ejecución."),
    port: int       = typer.Option(None, "--port", "-p", help="Puerto (por defecto: WILDINTEL_UPLOADER_WEB_PORT o 8769)."),
) -> None:
    """Arranca el servidor FastAPI en el modo indicado."""
    effective_port = port or settings.port
    console.print(Panel(
        f"[bold]Modo:[/bold] {mode.value}   [bold]Puerto:[/bold] {effective_port}",
        title="WildINTEL Uploader — backend",
    ))

    if mode == ServeMode.debug:
        _require("debugpy", "Instala las dependencias de desarrollo: uv sync --group dev")
        console.print(f"  API:      http://localhost:{effective_port}")
        console.print(f"  Swagger:  http://localhost:{effective_port}/docs")
        console.print("  Debugger: localhost:5679\n")
        _run(
            sys.executable, "-m", "debugpy", "--listen", "5679",
            "-m", "uvicorn", "wildintel_uploader.web.main:app", "--port", str(effective_port),
            "--log-level", "debug",
            cwd=ROOT_DIR,
        )
        return

    console.print(f"  API:     http://localhost:{effective_port}")
    console.print(f"  Swagger: http://localhost:{effective_port}/docs\n")
    _run(*_uvicorn_args(effective_port, reload=mode == ServeMode.dev), cwd=ROOT_DIR)


@backend_app.command("test")
def backend_test(
    verbose: bool       = typer.Option(False, "--verbose", "-v", help="Salida detallada (-v de pytest)."),
    keyword: str | None = typer.Option(None, "--keyword", "-k", help="Filtro de tests por nombre (-k de pytest)."),
) -> None:
    """Ejecuta los tests del backend con pytest."""
    console.print(Panel("backend/tests/unit", title="WildINTEL Uploader — backend tests"))
    cmd = [sys.executable, "-m", "pytest"]
    if verbose:
        cmd.append("-v")
    if keyword:
        cmd.extend(["-k", keyword])
    _run(*cmd, cwd=ROOT_DIR)


# ── frontend ──────────────────────────────────────────────────────────────────

frontend_app = typer.Typer(help="Gestiona el frontend React (npm).")
app.add_typer(frontend_app, name="frontend")


@frontend_app.command("dev")
def frontend_dev(
    port: int = typer.Option(FRONTEND_PORT, "--port", "-p", help="Puerto del servidor de desarrollo."),
) -> None:
    """Arranca el servidor de desarrollo Vite (hot-reload)."""
    console.print(Panel(f"[bold]Frontend:[/bold] http://localhost:{port}", title="WildINTEL Uploader — frontend dev"))
    _npm("run", "dev", "--", "--port", str(port))


@frontend_app.command("build")
def frontend_build() -> None:
    """Compila el frontend para producción → frontend/dist/."""
    console.print("[green]Compilando frontend...[/green]")
    _npm("run", "build")
    console.print(f"[green]✔  Build en {FRONTEND_DIR / 'dist'}[/green]")


@frontend_app.command("preview")
def frontend_preview(
    port: int = typer.Option(4176, "--port", "-p", help="Puerto del servidor de preview."),
) -> None:
    """Sirve el build de producción localmente."""
    console.print(Panel(f"[bold]Preview:[/bold] http://localhost:{port}", title="WildINTEL Uploader — frontend preview"))
    _npm("run", "preview", "--", "--port", str(port))


@frontend_app.command("test")
def frontend_test() -> None:
    """Ejecuta los tests del frontend (Vitest)."""
    console.print(Panel("Ejecutando tests del frontend...", title="WildINTEL Uploader — frontend tests"))
    _npm("run", "test")


@frontend_app.command("lint")
def frontend_lint() -> None:
    """Ejecuta oxlint sobre el código fuente."""
    console.print("[green]Linting...[/green]")
    _npm("run", "lint")


# ── dev (backend + frontend juntos) ──────────────────────────────────────────

@app.command()
def dev(
    backend_port:  int = typer.Option(None, "--backend-port", "-b", help="Puerto del backend (por defecto: WILDINTEL_UPLOADER_WEB_PORT o 8769)."),
    frontend_port: int = typer.Option(FRONTEND_PORT, "--frontend-port", "-f", help="Puerto del frontend Vite."),
) -> None:
    """Arranca backend y frontend simultáneamente en modo desarrollo."""
    _require("npm", "Instala Node.js desde https://nodejs.org/ (v18+)")
    _ensure_frontend_deps()
    effective_port = backend_port or settings.port

    console.print(Panel(
        f"  [bold]Backend:[/bold]  http://localhost:{effective_port}\n"
        f"  [bold]Frontend:[/bold] http://localhost:{frontend_port}\n"
        f"  [bold]API docs:[/bold] http://localhost:{effective_port}/docs\n\n"
        f"  Ctrl+C para detener ambos procesos.",
        title="WildINTEL Uploader — dev",
    ))

    backend_proc = subprocess.Popen(
        _uvicorn_args(effective_port, reload=True), cwd=ROOT_DIR,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    frontend_proc = subprocess.Popen(
        ["npm", "run", "dev", "--", "--port", str(frontend_port)], cwd=FRONTEND_DIR,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )

    def _stream(proc: subprocess.Popen, label: str, color: str) -> None:
        for raw in iter(proc.stdout.readline, b""):
            line = raw.decode(errors="replace").rstrip()
            if line:
                console.print(f"[{color}][{label}][/{color}] {line}")

    for proc, label, color in ((backend_proc, "backend", "cyan"), (frontend_proc, "frontend", "green")):
        threading.Thread(target=_stream, args=(proc, label, color), daemon=True).start()

    try:
        backend_proc.wait()
        frontend_proc.wait()
    except KeyboardInterrupt:
        console.print("\n[yellow]Deteniendo...[/yellow]")
        for proc in (backend_proc, frontend_proc):
            proc.terminate()
        for proc in (backend_proc, frontend_proc):
            proc.wait()
        console.print("[yellow]✔  Parado.[/yellow]")


# ── package ───────────────────────────────────────────────────────────────────

package_app = typer.Typer(help="Construye los paquetes de distribución (.AppImage / .exe / .dmg).")
app.add_typer(package_app, name="package")

# Cada formato se construye en su propio sistema: PyInstaller no hace
# compilación cruzada (en CI, cada uno en su runner — ver release.yml).
_NATIVE = {"linux": PackageFormat.appimage, "win32": PackageFormat.windows, "darwin": PackageFormat.macos}


def _get_version(version: str | None) -> str:
    if version:
        return version
    result = subprocess.run(
        ["git", "describe", "--tags", "--exact-match"], capture_output=True, text=True, cwd=ROOT_DIR,
    )
    if result.returncode == 0:
        return result.stdout.strip().lstrip("v")
    return "0.0.0-dev"


def _pyinstaller(version: str, *, onedir: bool) -> Path:
    """Compila el frontend y el ejecutable, con la versión en _version.py
    (que luego se borra: no se versiona). Devuelve lo generado."""
    _npm("run", "build")
    VERSION_FILE.write_text(f'__version__ = "{version}"\n', encoding="utf-8")
    env = {k: v for k, v in os.environ.items() if k != "WU_ONEDIR"}
    if onedir:
        env["WU_ONEDIR"] = "1"
    try:
        _run(sys.executable, "-m", "PyInstaller", str(SPEC_FILE), "--noconfirm",
             "--distpath", str(BUILD_DIR / "dist"), "--workpath", str(BUILD_DIR / "work"),
             cwd=ROOT_DIR, env=env)
    finally:
        VERSION_FILE.unlink(missing_ok=True)
    return BUILD_DIR / "dist" / (APP_NAME + (".exe" if sys.platform == "win32" and not onedir else ""))


def _report(path: Path) -> None:
    console.print(f"[green]✔  {path}  ({path.stat().st_size // (1024 * 1024)} MB)[/green]")


def _build_appimage(version: str) -> None:
    _require("appimagetool", "Descárgalo de https://github.com/AppImage/appimagetool/releases y ponlo en el PATH.")
    built = _pyinstaller(version, onedir=True)
    with tempfile.TemporaryDirectory() as tmp:
        app_dir = Path(tmp) / "AppDir"
        shutil.copytree(built, app_dir / APP_NAME)
        (app_dir / "AppRun").write_text(f'#!/bin/sh\nexec "$(dirname "$0")/{APP_NAME}/{APP_NAME}" "$@"\n')
        (app_dir / "AppRun").chmod(0o755)
        (app_dir / f"{APP_NAME}.desktop").write_text(
            f"[Desktop Entry]\nType=Application\nName=WildINTEL Uploader\n"
            f"Exec={APP_NAME}\nIcon={APP_NAME}\nTerminal=true\nCategories=Science;\n"
        )
        shutil.copy(ICON, app_dir / f"{APP_NAME}.png")
        out = DIST_DIR / f"{APP_NAME}-{version}-linux-x86_64.AppImage"
        _run("appimagetool", str(app_dir), str(out), env={**os.environ, "ARCH": "x86_64"})
    _report(out)


def _build_windows(version: str) -> None:
    built = _pyinstaller(version, onedir=False)
    out = DIST_DIR / f"{APP_NAME}-{version}-windows-x64.exe"
    shutil.copy(built, out)
    _report(out)


def _build_macos(version: str) -> None:
    _require("hdiutil", "hdiutil solo existe en macOS.")
    built = _pyinstaller(version, onedir=False)
    with tempfile.TemporaryDirectory() as tmp:
        shutil.copy(built, Path(tmp) / APP_NAME)
        out = DIST_DIR / f"{APP_NAME}-{version}-macos-arm64.dmg"
        _run("hdiutil", "create", "-volname", f"WildINTEL Uploader {version}", "-srcfolder", tmp,
             "-ov", "-format", "UDZO", str(out))
    _report(out)


@package_app.command("build")
def package_build(
    fmt: PackageFormat = typer.Option(PackageFormat.auto, "--format", "-f",
                                      help="Formato: auto (el de este sistema), appimage, windows o macos."),
    version: str | None = typer.Option(None, "--version", "-v",
                                       help="Versión (por defecto: el tag de git, o 0.0.0-dev)."),
) -> None:
    """Construye el paquete de este sistema en dist/ — igual que la release."""
    native = _NATIVE.get(sys.platform)
    target = native if fmt == PackageFormat.auto else fmt
    if target is None or target != native:
        console.print(f"[red]✘  {fmt.value} no se puede construir en este sistema ({sys.platform}).[/red]  "
                      "Cada paquete se construye en su propio sistema — o en GitHub, con release.yml.")
        raise typer.Exit(1)

    v = _get_version(version)
    console.print(Panel(f"[bold]Versión:[/bold] {v}   [bold]Formato:[/bold] {target.value}",
                        title="WildINTEL Uploader — package"))
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    {PackageFormat.appimage: _build_appimage, PackageFormat.windows: _build_windows,
     PackageFormat.macos: _build_macos}[target](v)


# ── entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app()
