"""The app's logging: to the console and to a rotating log file in
the log folder of the system (config.get_logs_dir()), at the level the settings page sets
(GENERAL.log_level) — changed on the fly when it's saved (apply_level).

WILDINTEL_UPLOADER_WEB_LOG_LEVEL, when set, wins over the settings page:
handy for a one-off debugging session without touching settings.toml.

At DEBUG, the app logs each step of its work (each file scanned and
copied, each Trapper query, full tracebacks of errors); the libraries' own
byte-level chatter (httpcore, urllib3…) stays at INFO."""
from __future__ import annotations

import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

from wildintel_uploader.core import config

LEVELS = ("ERROR", "WARNING", "INFO", "DEBUG")
LOG_FORMAT = "%(asctime)s  %(levelname)-8s  %(threadName)-18s  %(name)s  %(message)s"
MAX_BYTES = 5 * 1024 * 1024
BACKUP_COUNT = 5
ENV_LEVEL = "WILDINTEL_UPLOADER_WEB_LOG_LEVEL"

# Too chatty below INFO even when debugging the app.
_NOISY = ("httpcore", "urllib3", "multipart", "python_multipart", "watchfiles", "asyncio", "PIL")
# uvicorn's own loggers don't propagate to the root one: they get the
# file handler themselves.
_UVICORN = ("uvicorn", "uvicorn.access")

_MARK = "_wildintel_uploader"


def log_file() -> Path:
    return config.get_logs_dir() / "wildintel-uploader.log"


def migrate_legacy_logs() -> None:
    """Moves the log files kept where they used to be (next to settings.toml) to the log folder of the system — the ones that are
    not there already; the old folder goes when it is empty."""
    old, new = config.legacy_logs_dir(), config.get_logs_dir()
    if not old.is_dir() or old.resolve() == new.resolve():
        return
    try:
        for entry in old.iterdir():
            if entry.is_file() and entry.name.startswith("wildintel-uploader.log") and not (new / entry.name).exists():
                new.mkdir(parents=True, exist_ok=True)
                entry.replace(new / entry.name)
        old.rmdir()
    except OSError:
        pass  # what stays is still there to be read


def env_override() -> str | None:
    """WILDINTEL_UPLOADER_WEB_LOG_LEVEL's level, if it's set to one."""
    env = os.environ.get(ENV_LEVEL, "").strip().upper()
    return env if env in LEVELS else None


def effective_level() -> str:
    """The environment's level if set, else the settings page's."""
    if (env := env_override()) is not None:
        return env
    try:
        return config.load_settings().GENERAL.log_level
    except Exception:  # an unreadable settings.toml mustn't stop logging
        return "INFO"


class _HealthCheckFilter(logging.Filter):
    """Drops the access log's /api/health lines — the frontend polls it every
    10 s — unless debugging."""

    def filter(self, record: logging.LogRecord) -> bool:
        if logging.getLogger().isEnabledFor(logging.DEBUG):
            return True
        args = record.args if isinstance(record.args, tuple) else ()
        return not (len(args) >= 3 and str(args[2]).startswith("/api/health"))


def _ours(handler: logging.Handler) -> bool:
    return getattr(handler, _MARK, False)


def _mark(handler: logging.Handler) -> logging.Handler:
    setattr(handler, _MARK, True)
    handler.setFormatter(logging.Formatter(LOG_FORMAT, datefmt="%Y-%m-%d %H:%M:%S"))
    return handler


def configure(level: str | None = None, *, console_level: str | None = None) -> None:
    """Sets the handlers up — once, however many times it's called — and the
    level. console_level, if given, raises the console's own threshold (the
    command-line app shows only warnings unless --verbose; its log file
    still gets everything at the level set)."""
    root = logging.getLogger()
    for handler in list(root.handlers):
        if type(handler) is logging.StreamHandler and not _ours(handler):
            root.removeHandler(handler)
    if not any(_ours(h) for h in root.handlers):
        console = _mark(logging.StreamHandler(sys.stderr))
        console._wildintel_console = True  # type: ignore[attr-defined]
        root.addHandler(console)
        try:
            migrate_legacy_logs()
            log_file().parent.mkdir(parents=True, exist_ok=True)
            file_handler = _mark(RotatingFileHandler(log_file(), maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT,
                                                     encoding="utf-8", delay=True))
        except OSError as exc:  # a read-only config folder: console only
            logging.getLogger(__name__).warning("Can't write the log file %s: %s", log_file(), exc)
        else:
            root.addHandler(file_handler)
            for name in _UVICORN:
                uvicorn_logger = logging.getLogger(name)
                if not uvicorn_logger.propagate:
                    uvicorn_logger.addHandler(file_handler)
        logging.getLogger("uvicorn.access").addFilter(_HealthCheckFilter())
    for handler in root.handlers:
        if getattr(handler, "_wildintel_console", False):
            handler.setLevel(console_level.upper() if console_level else logging.NOTSET)
    apply_level(level or effective_level())


def apply_level(level: str) -> None:
    """Changes the level on the fly (the settings page's Save)."""
    level = level.upper() if level.upper() in LEVELS else "INFO"
    logging.getLogger().setLevel(level)
    for name in _NOISY:
        logging.getLogger(name).setLevel(max(logging.getLevelName(level), logging.INFO))
    logging.getLogger(__name__).info("Log level: %s — log file: %s", level, log_file())


def debugging() -> bool:
    """Whether to log full tracebacks — logger.warning(..., exc_info=debugging())."""
    return logging.getLogger().isEnabledFor(logging.DEBUG)


def clear_log() -> int:
    """Deletes the log file and its rotated copies — closing the file first
    (Windows can't delete an open file); it's reopened on the next line
    logged. Returns how many files were deleted."""
    for handler in logging.getLogger().handlers:
        if _ours(handler) and isinstance(handler, RotatingFileHandler):
            handler.acquire()
            try:
                handler.close()
            finally:
                handler.release()
    path = log_file()
    deleted = 0
    for candidate in [path, *(path.with_name(f"{path.name}.{i}") for i in range(1, BACKUP_COUNT + 1))]:
        try:
            candidate.unlink()
            deleted += 1
        except FileNotFoundError:
            pass
    logging.getLogger(__name__).info("Log cleared (%d file(s) deleted)", deleted)
    return deleted
