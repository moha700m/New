"""Full app backups (zip): providers, settings, Codex config. API keys are never included."""
from __future__ import annotations

import json
import time
import tomllib
import zipfile
from pathlib import Path

from .version import APP_NAME, VERSION

KIND = "agentsii-codex-manager/backup"
_MEMBERS = {"providers.json", "settings.json", "codex/config.toml"}


def create_backup(dest: Path, providers_file: Path, settings_file: Path, codex_config: Path) -> Path:
    dest = Path(dest)
    manifest = {"kind": KIND, "app": APP_NAME, "version": VERSION, "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "note": "API keys are not included. Re-enter them after restoring on a new PC."}
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, indent=2))
        if Path(providers_file).is_file():
            z.write(providers_file, "providers.json")
        if Path(settings_file).is_file():
            z.write(settings_file, "settings.json")
        if Path(codex_config).is_file():
            z.write(codex_config, "codex/config.toml")
    return dest


def read_backup(src: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(src) as z:
        try:
            manifest = json.loads(z.read("manifest.json"))
        except (KeyError, ValueError) as e:
            raise ValueError("This is not an Agentsii Codex Manager backup.") from e
        if manifest.get("kind") != KIND:
            raise ValueError("This is not an Agentsii Codex Manager backup.")
        out = {}
        for name in z.namelist():
            if name in _MEMBERS:
                out[name] = z.read(name)
    if "codex/config.toml" in out:
        tomllib.loads(out["codex/config.toml"].decode("utf-8-sig"))  # raises if invalid
    if "providers.json" in out:
        json.loads(out["providers.json"])
    return out
