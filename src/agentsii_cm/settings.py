"""Application settings (local JSON, no secrets)."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path

from . import paths
from .util import read_json, write_json
from .version import DEFAULT_BRIDGE_PORT


@dataclass
class AppSettings:
    language: str = "en"  # "en" | "ar"
    codex_home_override: str = ""
    bridge_port: int = DEFAULT_BRIDGE_PORT
    check_updates_on_startup: bool = True
    # Codex's top-level model / model_provider before Agentsii first changed them,
    # so "Disconnect" can put them back exactly as they were.
    original_codex_defaults: dict | None = None
    managed_codex_providers: list[str] = field(default_factory=list)

    @classmethod
    def load(cls, path: Path | None = None) -> "AppSettings":
        data = read_json(Path(path) if path else paths.settings_file(), {})
        known = set(cls.__dataclass_fields__)  # type: ignore[attr-defined]
        s = cls(**{k: v for k, v in data.items() if k in known})
        if s.language not in ("en", "ar"):
            s.language = "en"
        try:
            s.bridge_port = int(s.bridge_port)
        except (TypeError, ValueError):
            s.bridge_port = DEFAULT_BRIDGE_PORT
        if not 1024 <= s.bridge_port <= 65535:
            s.bridge_port = DEFAULT_BRIDGE_PORT
        return s

    def save(self, path: Path | None = None) -> None:
        write_json(Path(path) if path else paths.settings_file(), asdict(self))
