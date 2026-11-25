"""Filesystem locations used by the app, the helper and the bridge.

Everything lives on the user's own machine:
  * roaming data  (%APPDATA%\\Agentsii\\CodexManager)      providers.json, settings.json, backups, logs
  * local data    (%LOCALAPPDATA%\\Agentsii\\CodexManager) bin\\agentsii-helper.exe (stable path for Codex)

Set AGENTSII_CM_HOME to relocate both (used by tests and the portable "self-contained" mode).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

IS_WINDOWS = sys.platform == "win32"


def _override() -> Path | None:
    v = os.environ.get("AGENTSII_CM_HOME")
    return Path(v) if v else None


def app_data_dir() -> Path:
    o = _override()
    if o:
        p = o / "roaming"
    elif IS_WINDOWS:
        p = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming") / "Agentsii" / "CodexManager"
    else:
        p = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "agentsii-codex-manager"
    p.mkdir(parents=True, exist_ok=True)
    return p


def local_data_dir() -> Path:
    o = _override()
    if o:
        p = o / "local"
    elif IS_WINDOWS:
        p = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "Agentsii" / "CodexManager"
    else:
        p = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "agentsii-codex-manager"
    p.mkdir(parents=True, exist_ok=True)
    return p


def providers_file() -> Path:
    return app_data_dir() / "providers.json"


def settings_file() -> Path:
    return app_data_dir() / "settings.json"


def backups_dir() -> Path:
    p = app_data_dir() / "backups"
    p.mkdir(parents=True, exist_ok=True)
    return p


def logs_dir() -> Path:
    p = app_data_dir() / "logs"
    p.mkdir(parents=True, exist_ok=True)
    return p


def bin_dir() -> Path:
    p = local_data_dir() / "bin"
    p.mkdir(parents=True, exist_ok=True)
    return p


def installed_helper_path() -> Path:
    name = "agentsii-helper.exe" if IS_WINDOWS else "agentsii-helper"
    return bin_dir() / name


def bundle_dir() -> Path:
    """Directory holding bundled resources (PyInstaller aware)."""
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent


def _registry_user_env(name: str) -> str | None:
    if not IS_WINDOWS:
        return None
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
            val, _ = winreg.QueryValueEx(k, name)
            return os.path.expandvars(str(val)) or None
    except OSError:
        return None


def detect_codex_home(override: str | None = None) -> tuple[Path, str]:
    """Return (CODEX_HOME, source) following Codex's own rule: $CODEX_HOME, else ~/.codex.

    The user-level registry value is also consulted because a GUI process started
    before the variable was set would not see it in os.environ.
    """
    if override:
        return Path(os.path.expandvars(override)).expanduser(), "settings"
    env = os.environ.get("CODEX_HOME")
    if env:
        return Path(env).expanduser(), "CODEX_HOME"
    reg = _registry_user_env("CODEX_HOME")
    if reg:
        return Path(reg).expanduser(), "CODEX_HOME (user environment)"
    return Path.home() / ".codex", "default"
