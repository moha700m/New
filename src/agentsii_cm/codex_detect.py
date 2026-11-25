"""Detect Codex installations (CLI, desktop app, IDE extension) without changing anything."""
from __future__ import annotations

import glob
import os
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from .paths import IS_WINDOWS, detect_codex_home
from .util import no_window_flags


@dataclass
class CodexInstall:
    cli_path: str | None = None
    cli_version: str | None = None
    desktop_app: str | None = None
    ide_extensions: list[str] = field(default_factory=list)
    codex_home: str = ""
    codex_home_source: str = ""
    config_path: str = ""
    config_exists: bool = False

    @property
    def any_found(self) -> bool:
        return bool(self.cli_path or self.desktop_app or self.ide_extensions)


def _candidate_cli_paths() -> list[str]:
    names = ["codex.cmd", "codex.exe", "codex.ps1", "codex"] if IS_WINDOWS else ["codex"]
    found: list[str] = []
    for n in names:
        w = shutil.which(n)
        if w:
            found.append(w)
    if IS_WINDOWS:
        appdata = os.environ.get("APPDATA", "")
        local = os.environ.get("LOCALAPPDATA", "")
        for p in [
            os.path.join(appdata, "npm", "codex.cmd"),
            os.path.join(local, "Microsoft", "WinGet", "Links", "codex.exe"),
            os.path.join(local, "Programs", "codex", "codex.exe"),
            os.path.join(local, "pnpm", "codex.cmd"),
            os.path.join(os.path.expanduser("~"), "scoop", "shims", "codex.exe"),
        ]:
            if p and os.path.isfile(p):
                found.append(p)
    else:
        for p in [os.path.expanduser("~/.npm-global/bin/codex"), "/usr/local/bin/codex", "/opt/homebrew/bin/codex"]:
            if os.path.isfile(p):
                found.append(p)
    seen, out = set(), []
    for p in found:
        k = os.path.normcase(os.path.abspath(p))
        if k not in seen and not k.endswith(".ps1"):
            seen.add(k)
            out.append(p)
    return out


def cli_version(path: str, timeout: float = 15.0) -> str | None:
    try:
        r = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=timeout,
                           creationflags=no_window_flags(), stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.search(r"(\d+\.\d+\.\d+[\w.\-]*)", (r.stdout or "") + (r.stderr or ""))
    return m.group(1) if m else None


def _find_desktop_app() -> str | None:
    if not IS_WINDOWS:
        return None
    local = os.environ.get("LOCALAPPDATA", "")
    patterns = [
        os.path.join(local, "Packages", "OpenAI.Codex*"),
        os.path.join(local, "Programs", "Codex*"),
        os.path.join(local, "Programs", "codex-desktop*"),
        os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "WindowsApps", "OpenAI.Codex*"),
    ]
    for pat in patterns:
        try:
            hits = glob.glob(pat)
        except OSError:
            hits = []
        if hits:
            return hits[0]
    return None


def _find_ide_extensions() -> list[str]:
    home = Path.home()
    out = []
    for d in [".vscode", ".vscode-insiders", ".cursor", ".windsurf"]:
        ext = home / d / "extensions"
        try:
            for p in ext.glob("openai.chatgpt-*"):
                out.append(str(p))
        except OSError:
            continue
    return out


def detect(codex_home_override: str | None = None, with_version: bool = True) -> CodexInstall:
    home, source = detect_codex_home(codex_home_override)
    info = CodexInstall(codex_home=str(home), codex_home_source=source)
    cfg = home / "config.toml"
    info.config_path = str(cfg)
    info.config_exists = cfg.is_file()
    clis = _candidate_cli_paths()
    if clis:
        info.cli_path = clis[0]
        if with_version:
            info.cli_version = cli_version(clis[0])
    info.desktop_app = _find_desktop_app()
    info.ide_extensions = _find_ide_extensions()
    return info
