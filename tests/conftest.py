"""Shared pytest setup: HOME/XDG_CONFIG_HOME
redirected to a throwaway directory BEFORE anything imports config.py — so
the tests never read or write the developer's real settings.toml or data
folder."""
import atexit
import os
import shutil
import tempfile
from pathlib import Path


_FAKE_HOME = Path(tempfile.mkdtemp(prefix="wildintel-uploader-test-home-"))
os.environ["HOME"] = str(_FAKE_HOME)
os.environ["XDG_CONFIG_HOME"] = str(_FAKE_HOME / ".config")
os.environ["XDG_STATE_HOME"] = str(_FAKE_HOME / ".local" / "state")
os.environ["XDG_DOCUMENTS_DIR"] = str(_FAKE_HOME / "Documents")
os.environ["APPDATA"] = str(_FAKE_HOME / "AppData" / "Roaming")
atexit.register(shutil.rmtree, _FAKE_HOME, True)
