"""Persistent provider list (no secrets ever stored here)."""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path

from . import paths
from .models import Provider, ValidationError
from .util import read_json, write_json

SCHEMA_VERSION = 1
EXPORT_KIND = "agentsii-codex-manager/providers"

# Keys that must never appear in a providers file or export.
_FORBIDDEN_KEYS = {"api_key", "apikey", "key", "secret", "token", "password", "bearer_token",
                   "experimental_bearer_token"}


class ProviderStore:
    def __init__(self, path: Path | None = None):
        self.path = Path(path) if path else paths.providers_file()
        self._lock = threading.RLock()

    # ---- persistence -------------------------------------------------
    def _load(self) -> list[Provider]:
        data = read_json(self.path, {"schema": SCHEMA_VERSION, "providers": []})
        out = []
        for d in data.get("providers", []):
            try:
                out.append(Provider.from_dict(d))
            except TypeError:
                continue
        return out

    def _save(self, providers: list[Provider]) -> None:
        write_json(self.path, {"schema": SCHEMA_VERSION, "providers": [p.to_dict() for p in providers]})

    # ---- queries -----------------------------------------------------
    def list(self) -> list[Provider]:
        with self._lock:
            return self._load()

    def get(self, provider_id: str) -> Provider | None:
        return next((p for p in self.list() if p.id == provider_id), None)

    def default(self) -> Provider | None:
        return next((p for p in self.list() if p.is_default), None)

    # ---- mutations ---------------------------------------------------
    def upsert(self, provider: Provider, original_id: str | None = None) -> Provider:
        provider.validate()
        with self._lock:
            items = self._load()
            # original_id None = create a new provider; otherwise update the one with that ID.
            key = original_id or provider.id
            existing = next((p for p in items if p.id == key), None) if original_id else None
            if (original_id is None or provider.id != original_id) and any(p.id == provider.id for p in items):
                raise ValidationError({"id": f"A provider with ID '{provider.id}' already exists."})
            provider.updated_at = time.time()
            if existing:
                provider.created_at = existing.created_at
                items = [provider if p.id == key else p for p in items]
            else:
                items.append(provider)
            if provider.is_default:
                for p in items:
                    if p.id != provider.id:
                        p.is_default = False
            self._save(items)
            return provider

    def delete(self, provider_id: str) -> bool:
        with self._lock:
            items = self._load()
            new = [p for p in items if p.id != provider_id]
            if len(new) == len(items):
                return False
            self._save(new)
            return True

    def set_default(self, provider_id: str | None) -> None:
        with self._lock:
            items = self._load()
            for p in items:
                p.is_default = p.id == provider_id
            self._save(items)

    def set_connected(self, provider_id: str, connected: bool) -> None:
        with self._lock:
            items = self._load()
            for p in items:
                if p.id == provider_id:
                    p.codex_connected = connected
            self._save(items)

    # ---- import / export (never includes keys) --------------------------
    def export_json(self) -> str:
        providers = []
        for p in self.list():
            d = p.to_dict()
            d["codex_connected"] = False
            providers.append(d)
        return json.dumps({"kind": EXPORT_KIND, "schema": SCHEMA_VERSION, "providers": providers,
                           "note": "API keys are intentionally not included."}, indent=2, ensure_ascii=False)

    @staticmethod
    def parse_export(text: str) -> list[Provider]:
        data = json.loads(text)
        if not isinstance(data, dict) or data.get("kind") != EXPORT_KIND:
            raise ValueError("This file is not an Agentsii Codex Manager providers export.")
        out = []
        for d in data.get("providers", []):
            if not isinstance(d, dict):
                continue
            d = {k: v for k, v in d.items() if k.lower() not in _FORBIDDEN_KEYS}
            p = Provider.from_dict(d)
            p.codex_connected = False
            p.validate()
            out.append(p)
        return out

    def import_providers(self, providers: list[Provider], overwrite: bool = False) -> tuple[list[str], list[str]]:
        """Returns (imported_ids, skipped_ids)."""
        imported, skipped = [], []
        with self._lock:
            items = self._load()
            ids = {p.id for p in items}
            for p in providers:
                if p.id in ids and not overwrite:
                    skipped.append(p.id)
                    continue
                p.is_default = False
                items = [x for x in items if x.id != p.id] + [p]
                imported.append(p.id)
            self._save(items)
        return imported, skipped
