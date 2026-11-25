"""Safe, format-preserving edits of Codex's config.toml.

Rules this module enforces:
  * An unparsable config.toml is never modified (the user is told where the error is).
  * A timestamped backup is taken before every write; writes are atomic.
  * Every key and comment that Agentsii does not own is preserved (tomlkit round-trip).
  * API keys are never written. Codex obtains them at runtime through the documented
    command-backed auth contract ([model_providers.<id>.auth] command/args), which runs
    agentsii-helper.exe to read the key from Windows Credential Manager.
  * Only wire_api = "responses" is written: it is the only protocol current Codex releases
    support. Chat-Completions-only providers are routed through the local Agentsii Bridge.
"""
from __future__ import annotations

import shutil
import subprocess
import time
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import tomlkit
from tomlkit.exceptions import TOMLKitError

from .models import AUTH_NONE, MODE_BRIDGE, Provider
from .settings import AppSettings
from .util import atomic_write_text, no_window_flags

MAX_BACKUPS = 40
BACKUP_PREFIX = "config.toml."
PROFILE_PREFIX = "agentsii-"


class ConfigError(Exception):
    pass


class ConfigParseError(ConfigError):
    pass


class ProviderConflictError(ConfigError):
    pass


@dataclass
class ApplyResult:
    ok: bool
    config_path: str
    backup_path: str | None = None
    messages: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class Check:
    name: str
    ok: bool
    message: str


def bridge_base_url(port: int, provider_id: str) -> str:
    return f"http://127.0.0.1:{port}/p/{provider_id}/v1"


class CodexConfigManager:
    def __init__(self, codex_home: Path, settings: AppSettings, helper_path: Path, backups_dir: Path,
                 save_settings: Callable[[AppSettings], None] | None = None):
        self.codex_home = Path(codex_home)
        self.settings = settings
        self.helper_path = Path(helper_path)
        self.backups_dir = Path(backups_dir)
        self._save_settings = save_settings or (lambda s: s.save())

    # ------------------------------------------------------------------ paths
    @property
    def config_path(self) -> Path:
        return self.codex_home / "config.toml"

    def profile_path(self, provider_id: str) -> Path:
        return self.codex_home / f"{PROFILE_PREFIX}{provider_id}.config.toml"

    # ------------------------------------------------------------------ read
    def read_text(self) -> str:
        try:
            return self.config_path.read_text(encoding="utf-8-sig")
        except FileNotFoundError:
            return ""

    def read_document(self) -> tomlkit.TOMLDocument:
        text = self.read_text()
        try:
            return tomlkit.parse(text)
        except TOMLKitError as e:
            raise ConfigParseError(
                f"Codex config.toml is not valid TOML ({e}). It was left untouched. "
                f"Fix it or restore a backup first: {self.config_path}"
            ) from e

    def state(self) -> dict:
        """Plain-dict snapshot of the parts of config.toml this app cares about."""
        try:
            data = tomllib.loads(self.read_text())
        except tomllib.TOMLDecodeError as e:
            return {"error": str(e)}
        return {
            "model": data.get("model"),
            "model_provider": data.get("model_provider"),
            "providers": sorted((data.get("model_providers") or {}).keys()),
        }

    # ------------------------------------------------------------------ backups
    def backup(self, reason: str = "auto") -> Path | None:
        if not self.config_path.is_file():
            return None
        self.backups_dir.mkdir(parents=True, exist_ok=True)
        stamp = time.strftime("%Y%m%d-%H%M%S")
        dest = self.backups_dir / f"{BACKUP_PREFIX}{stamp}.{reason}.bak"
        n = 1
        while dest.exists():
            dest = self.backups_dir / f"{BACKUP_PREFIX}{stamp}-{n}.{reason}.bak"
            n += 1
        shutil.copy2(self.config_path, dest)
        self._prune_backups()
        return dest

    def list_backups(self) -> list[Path]:
        if not self.backups_dir.is_dir():
            return []
        return sorted(self.backups_dir.glob(f"{BACKUP_PREFIX}*.bak"), key=lambda p: p.stat().st_mtime, reverse=True)

    def _prune_backups(self) -> None:
        for old in self.list_backups()[MAX_BACKUPS:]:
            try:
                old.unlink()
            except OSError:
                pass

    def restore_backup(self, backup_path: Path) -> Path | None:
        text = Path(backup_path).read_text(encoding="utf-8-sig")
        try:
            tomllib.loads(text)
        except tomllib.TOMLDecodeError as e:
            raise ConfigParseError(f"The selected backup is not valid TOML: {e}") from e
        safety = self.backup("before-restore")
        atomic_write_text(self.config_path, text)
        return safety

    # ------------------------------------------------------------------ build
    def provider_table(self, p: Provider) -> tomlkit.items.Table:
        t = tomlkit.table()
        bridged = p.connection_mode == MODE_BRIDGE
        t["name"] = f"{p.name} (via Agentsii Bridge)" if bridged else p.name
        t["base_url"] = bridge_base_url(self.settings.bridge_port, p.id) if bridged else p.base_url
        t["wire_api"] = "responses"
        if bridged or p.auth_type != AUTH_NONE:
            auth = tomlkit.table()
            auth["command"] = tomlkit.string(str(self.helper_path), literal="'" not in str(self.helper_path))
            auth["args"] = ["bridge-token"] if bridged else ["token", p.id]
            auth["timeout_ms"] = 90000 if bridged else 30000
            # Direct keys are static: 0 = re-run the helper only after an auth retry.
            # Bridge: refresh every 5 minutes, which also restarts the bridge if it stopped.
            auth["refresh_interval_ms"] = 300000 if bridged else 0
            t["auth"] = auth
        return t

    def _expected(self, p: Provider) -> dict:
        return tomllib.loads(tomlkit.dumps({"x": self.provider_table(p)}))["x"]

    # ------------------------------------------------------------------ write helpers
    def _write_verified(self, doc: tomlkit.TOMLDocument, verify: Callable[[dict], None],
                        backup_path: Path | None) -> None:
        text = tomlkit.dumps(doc)
        try:
            verify(tomllib.loads(text))
        except (tomllib.TOMLDecodeError, AssertionError, KeyError, TypeError) as e:
            raise ConfigError(f"Generated configuration failed validation; nothing was written ({e}).") from e
        self.codex_home.mkdir(parents=True, exist_ok=True)
        atomic_write_text(self.config_path, text)
        try:
            verify(tomllib.loads(self.read_text()))
        except Exception as e:  # pragma: no cover - only on disk corruption / races
            if backup_path:
                shutil.copy2(backup_path, self.config_path)
            raise ConfigError(f"config.toml verification after writing failed; the backup was restored ({e}).") from e

    def _record_original_defaults(self, doc: tomlkit.TOMLDocument) -> None:
        current = doc.get("model_provider")
        if self.settings.original_codex_defaults is None and current not in self.settings.managed_codex_providers:
            self.settings.original_codex_defaults = {
                "model": doc.get("model").unwrap() if doc.get("model") is not None else None,
                "model_provider": current.unwrap() if current is not None else None,
            }

    # ------------------------------------------------------------------ public API
    def apply_provider(self, p: Provider, make_default: bool, overwrite: bool = False) -> ApplyResult:
        p.validate()
        doc = self.read_document()
        mp = doc.get("model_providers")
        if mp is not None and not isinstance(mp, dict):
            raise ConfigError("'model_providers' in config.toml is not a table; refusing to modify it.")
        if mp is not None and p.id in mp and p.id not in self.settings.managed_codex_providers and not overwrite:
            raise ProviderConflictError(
                f"config.toml already defines [model_providers.{p.id}] that was not created by Agentsii."
            )
        backup_path = self.backup("connect")
        if mp is None:
            mp = tomlkit.table(is_super_table=True)
            doc["model_providers"] = mp
        mp[p.id] = self.provider_table(p)
        if make_default:
            self._record_original_defaults(doc)
            doc["model_provider"] = p.id
            doc["model"] = p.default_model
        expected = self._expected(p)

        def verify(data: dict) -> None:
            assert data["model_providers"][p.id] == expected, "provider table mismatch"
            if make_default:
                assert data["model_provider"] == p.id and data["model"] == p.default_model, "defaults mismatch"

        self._write_verified(doc, verify, backup_path)
        if p.id not in self.settings.managed_codex_providers:
            self.settings.managed_codex_providers.append(p.id)
        self._save_settings(self.settings)
        self._write_profile(p)
        res = ApplyResult(ok=True, config_path=str(self.config_path),
                          backup_path=str(backup_path) if backup_path else None)
        res.messages.append(f"[model_providers.{p.id}] written to {self.config_path}")
        if make_default:
            res.messages.append(f"Codex default set to model '{p.default_model}' on provider '{p.id}'.")
        res.messages.append(f"Profile: codex --profile {PROFILE_PREFIX}{p.id}")
        return res

    def set_default(self, p: Provider) -> ApplyResult:
        return self.apply_provider(p, make_default=True, overwrite=p.id in self.settings.managed_codex_providers)

    def _write_profile(self, p: Provider) -> None:
        doc = tomlkit.document()
        doc.add(tomlkit.comment("Generated by Agentsii Codex Manager. Use with: codex --profile "
                                f"{PROFILE_PREFIX}{p.id}"))
        doc["model_provider"] = p.id
        doc["model"] = p.default_model
        try:
            atomic_write_text(self.profile_path(p.id), tomlkit.dumps(doc))
        except OSError:
            pass

    def remove_provider(self, provider_id: str) -> ApplyResult:
        doc = self.read_document()
        mp = doc.get("model_providers")
        res = ApplyResult(ok=True, config_path=str(self.config_path))
        managed = provider_id in self.settings.managed_codex_providers
        in_file = isinstance(mp, dict) and provider_id in mp
        if not in_file and doc.get("model_provider") != provider_id:
            if managed:
                self.settings.managed_codex_providers.remove(provider_id)
                self._save_settings(self.settings)
            self._remove_profile(provider_id)
            res.messages.append("Nothing to remove from config.toml.")
            return res
        if in_file and not managed:
            raise ProviderConflictError(f"[model_providers.{provider_id}] was not created by Agentsii; not removing it.")
        backup_path = self.backup("disconnect")
        res.backup_path = str(backup_path) if backup_path else None
        if in_file:
            del mp[provider_id]
            if len(mp) == 0:
                del doc["model_providers"]
        if doc.get("model_provider") == provider_id:
            self._restore_defaults_into(doc, exclude=provider_id)
            res.messages.append("Codex default model/provider restored to the previous values.")

        def verify(data: dict) -> None:
            assert provider_id not in (data.get("model_providers") or {})
            assert data.get("model_provider") != provider_id

        self._write_verified(doc, verify, backup_path)
        if managed:
            self.settings.managed_codex_providers.remove(provider_id)
        self._save_settings(self.settings)
        self._remove_profile(provider_id)
        res.messages.append(f"[model_providers.{provider_id}] removed from config.toml.")
        return res

    def _restore_defaults_into(self, doc: tomlkit.TOMLDocument, exclude: str) -> None:
        orig = self.settings.original_codex_defaults or {}
        for key in ("model", "model_provider"):
            val = orig.get(key)
            if key == "model_provider" and val == exclude:
                val = None
            if val is None:
                if key in doc:
                    del doc[key]
            else:
                doc[key] = val
        self.settings.original_codex_defaults = None

    def _remove_profile(self, provider_id: str) -> None:
        try:
            self.profile_path(provider_id).unlink()
        except OSError:
            pass

    # ------------------------------------------------------------------ validation
    def validate_provider(self, p: Provider, expect_default: bool,
                          run_helper: Callable[[list[str]], tuple[int, str, str]] | None = None) -> list[Check]:
        checks: list[Check] = []
        try:
            data = tomllib.loads(self.read_text())
            checks.append(Check("config", True, "config.toml is valid TOML."))
        except tomllib.TOMLDecodeError as e:
            return [Check("config", False, f"config.toml is not valid TOML: {e}")]
        table = (data.get("model_providers") or {}).get(p.id)
        if table is None:
            checks.append(Check("provider", False, f"[model_providers.{p.id}] is missing."))
            return checks
        ok = table == self._expected(p)
        checks.append(Check("provider", ok, "Provider entry matches." if ok else "Provider entry differs from the expected values."))
        if expect_default:
            ok = data.get("model_provider") == p.id and data.get("model") == p.default_model
            checks.append(Check("default", ok, "Codex default points to this provider and model." if ok
                                else "Codex default is not set to this provider/model."))
        auth = table.get("auth")
        if auth:
            cmd = Path(auth.get("command", ""))
            if not cmd.is_file():
                checks.append(Check("helper", False, f"Key helper not found at {cmd}."))
                return checks
            runner = run_helper or _run_helper
            code, out, err = runner([str(cmd), *auth.get("args", [])])
            if code == 0 and out.strip():
                checks.append(Check("credential", True, "Codex can retrieve the credential through the helper."))
            else:
                checks.append(Check("credential", False, (err.strip() or "The helper returned no credential.")[:300]))
        return checks


def _run_helper(argv: list[str]) -> tuple[int, str, str]:
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=40, stdin=subprocess.DEVNULL,
                           creationflags=no_window_flags())
        return r.returncode, r.stdout, r.stderr
    except (OSError, subprocess.SubprocessError) as e:
        return 1, "", str(e)
