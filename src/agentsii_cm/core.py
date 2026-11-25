"""Application service layer: everything the UI does goes through AppCore.

Keeps UI code free of business logic and makes the flows testable headlessly.
"""
from __future__ import annotations

import hashlib
import logging
import os
import shutil
import stat
import sys
from dataclasses import dataclass, field
from pathlib import Path

from . import codex_detect, paths
from .bridge import server as bridge
from .codex_config import Check, CodexConfigManager, ConfigError
from .keystore import SecretStore, SecretStoreError
from .logging_setup import register_secret
from .models import MODE_BRIDGE, Provider, ValidationError
from .settings import AppSettings
from .store import ProviderStore
from .tester import ConnectionTester, TestReport
from .version import HELPER_EXE_NAME

log = logging.getLogger("agentsii.core")


@dataclass
class ConnectResult:
    ok: bool
    messages: list[str] = field(default_factory=list)
    checks: list[Check] = field(default_factory=list)
    error: str = ""
    backup_path: str | None = None


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 16), b""):
            h.update(b)
    return h.hexdigest()


class AppCore:
    def __init__(self, settings: AppSettings | None = None, store: ProviderStore | None = None,
                 keys: SecretStore | None = None):
        self.settings = settings or AppSettings.load()
        self.store = store or ProviderStore()
        self.keys = keys or SecretStore()

    # ------------------------------------------------------------- environment
    @property
    def codex_home(self) -> Path:
        return paths.detect_codex_home(self.settings.codex_home_override or None)[0]

    def detect(self, with_version: bool = True) -> codex_detect.CodexInstall:
        return codex_detect.detect(self.settings.codex_home_override or None, with_version)

    def helper_path(self) -> Path:
        if not getattr(sys, "frozen", False) and os.name == "nt":
            return paths.bin_dir() / "agentsii-helper.cmd"
        return paths.installed_helper_path()

    def config_manager(self) -> CodexConfigManager:
        return CodexConfigManager(self.codex_home, self.settings, self.helper_path(), paths.backups_dir(),
                                  save_settings=lambda s: s.save())

    def save_settings(self) -> None:
        self.settings.save()

    def deploy_helper(self) -> Path:
        """Install agentsii-helper at a stable per-user path that config.toml can reference
        (works the same for the installed and the portable edition)."""
        dest = self.helper_path()
        if getattr(sys, "frozen", False):
            src = paths.bundle_dir() / HELPER_EXE_NAME
            if not src.is_file():
                src = Path(sys.executable).parent / HELPER_EXE_NAME
            if not src.is_file():
                raise ConfigError(f"{HELPER_EXE_NAME} is missing from the application folder. Reinstall the app.")
            if dest.is_file() and _sha256(dest) == _sha256(src):
                return dest
            try:
                shutil.copy2(src, dest)
            except PermissionError:
                # The running bridge locks the file on Windows: stop it, then retry.
                self.stop_bridge()
                import time

                time.sleep(1.0)
                shutil.copy2(src, dest)
            return dest
        # Development mode: a tiny launcher that runs the helper module with this interpreter.
        src_root = Path(__file__).resolve().parent.parent
        if os.name == "nt":
            text = f'@echo off\r\nset "PYTHONPATH={src_root};%PYTHONPATH%"\r\n"{sys.executable}" -m agentsii_cm.helper_cli %*\r\n'
        else:
            text = f'#!/bin/sh\nPYTHONPATH="{src_root}:$PYTHONPATH" exec "{sys.executable}" -m agentsii_cm.helper_cli "$@"\n'
        if not dest.is_file() or dest.read_text() != text:
            dest.write_text(text)
            dest.chmod(dest.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        return dest

    # ------------------------------------------------------------- providers
    def save_provider(self, p: Provider, api_key: str | None, original_id: str | None = None) -> Provider:
        p.validate()
        old = self.store.get(original_id) if original_id else None
        has_key = self.keys.has_key(original_id or p.id)
        if p.needs_key and not (api_key or has_key):
            raise ValidationError({"api_key": "Enter the API key for this provider."})
        was_connected = bool(old and old.codex_connected)
        if old and original_id != p.id:
            if was_connected:
                self.config_manager().remove_provider(original_id)
            self.keys.rename_key(original_id, p.id)
        if api_key:
            register_secret(api_key)
            self.keys.set_key(p.id, api_key)
        if not p.needs_key:
            self.keys.delete_key(p.id)
        p.codex_connected = bool(was_connected and original_id == p.id)
        saved = self.store.upsert(p, original_id=original_id)
        if saved.is_default:
            self.store.set_default(saved.id)
        return saved

    def delete_provider(self, provider_id: str) -> None:
        p = self.store.get(provider_id)
        if p and (p.codex_connected or provider_id in self.settings.managed_codex_providers):
            self.config_manager().remove_provider(provider_id)
        self.keys.delete_key(provider_id)
        self.store.delete(provider_id)

    def set_default(self, provider_id: str, model: str | None = None) -> ConnectResult | None:
        p = self.store.get(provider_id)
        if not p:
            raise ValidationError({"id": "Provider not found."})
        if model:
            if model not in p.models:
                p.models.append(model)
            p.default_model = model
        p.is_default = True
        self.store.upsert(p, original_id=p.id)
        self.store.set_default(p.id)
        if p.codex_connected:
            return self.connect(p.id, make_default=True)
        return None

    # ------------------------------------------------------------- Codex
    def connect(self, provider_id: str, make_default: bool | None = None, overwrite: bool = False) -> ConnectResult:
        p = self.store.get(provider_id)
        if not p:
            return ConnectResult(False, error="Provider not found.")
        if make_default is None:
            make_default = p.is_default
        if p.needs_key and not self.keys.has_key(p.id):
            return ConnectResult(False, error="No API key is saved for this provider. Edit it and enter the key.")
        try:
            self.deploy_helper()
            cm = self.config_manager()
            res = cm.apply_provider(p, make_default=make_default, overwrite=overwrite)
        except (ConfigError, ValidationError, SecretStoreError, OSError) as e:
            log.warning("connect failed: %s", e)
            return ConnectResult(False, error=str(e))
        if make_default:
            self.store.set_default(p.id)
        checks = cm.validate_provider(p, expect_default=make_default)
        if p.connection_mode == MODE_BRIDGE:
            h = bridge.health(self.settings.bridge_port)
            checks.append(Check("bridge", bool(h), "Agentsii Bridge is running on 127.0.0.1:"
                                f"{self.settings.bridge_port}." if h else
                                "Agentsii Bridge is not responding. Check Settings > Bridge port."))
        ok = all(c.ok for c in checks)
        self.store.set_connected(p.id, ok)
        out = ConnectResult(ok, messages=res.messages, checks=checks, backup_path=res.backup_path)
        if not ok:
            out.error = "Codex was configured, but verification failed: " + "; ".join(
                c.message for c in checks if not c.ok)
        return out

    def disconnect(self, provider_id: str) -> ConnectResult:
        try:
            res = self.config_manager().remove_provider(provider_id)
        except (ConfigError, OSError) as e:
            return ConnectResult(False, error=str(e))
        self.store.set_connected(provider_id, False)
        return ConnectResult(True, messages=res.messages, backup_path=res.backup_path)

    # ------------------------------------------------------------- testing
    def test_provider(self, provider_id: str, model: str | None = None, progress=None,
                      override: Provider | None = None, api_key: str | None = None) -> TestReport:
        p = override or self.store.get(provider_id)
        if p is None:
            raise ValidationError({"id": "Provider not found."})
        key = api_key or (self.keys.get_key(p.id) if p.needs_key else None)
        register_secret(key)
        return ConnectionTester(p, key, progress=progress).run(model or p.default_model)

    # ------------------------------------------------------------- bridge
    def bridge_status(self) -> dict | None:
        return bridge.health(self.settings.bridge_port)

    def bridged_connected(self) -> list[Provider]:
        return [p for p in self.store.list() if p.codex_connected and p.connection_mode == MODE_BRIDGE]

    def start_bridge(self) -> bool:
        helper = self.deploy_helper()
        self.keys.get_or_create_bridge_token()
        return bridge.ensure_running(self.settings.bridge_port,
                                     [str(helper), "bridge", "--port", str(self.settings.bridge_port)])

    def stop_bridge(self) -> bool:
        try:
            return bridge.stop(self.settings.bridge_port, self.keys.get_or_create_bridge_token())
        except SecretStoreError:
            return False
