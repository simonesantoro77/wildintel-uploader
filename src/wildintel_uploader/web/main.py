"""
WildINTEL Uploader — FastAPI backend entry point.

Creates the app, registers middleware and routers, mounts the built frontend.
"""
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from wildintel_uploader.web.api.routers import app_settings, deployment_import, epicollect, fieldlog, health, ingest, repair, reports, sessions, sync, trapper, upload
from wildintel_uploader.web.settings import configure_logging, settings

configure_logging()

app = FastAPI(title="WildINTEL Uploader API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

for _router in [health.router, trapper.router, deployment_import.router, app_settings.router, sessions.router, upload.router, sync.router, reports.router, repair.router, epicollect.router, fieldlog.router, ingest.router]:
    app.include_router(_router)


def _static_dir() -> Path | None:
    if getattr(sys, "frozen", False):
        candidate = Path(sys._MEIPASS) / "static"  # type: ignore[attr-defined]
    else:
        # src/wildintel_uploader/web/main.py → the repository's frontend/dist
        candidate = Path(__file__).resolve().parents[3] / "frontend" / "dist"
    return candidate if candidate.exists() else None


_sd = _static_dir()
if _sd is not None:
    app.mount("/", StaticFiles(directory=str(_sd), html=True), name="static")
