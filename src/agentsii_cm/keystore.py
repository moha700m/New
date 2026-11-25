"""API key storage in the operating system's credential vault.

On Windows this is the Windows Credential Manager (DPAPI-protected, per user).
Keys are never written to config.toml, providers.json, exports, backups or logs.
"""
from __future__ import annotations

import secrets as _pysecrets  # stdlib
import sys

import keyring
from keyring.errors import KeyringError, PasswordDeleteError

from .version import KEYRING_SERVICE

BRIDGE_TOKEN_USER = "bridge-token"
_INSECURE_BACKENDS = ("PlaintextKeyring", "EncryptedKeyring", "Null", "fail.Keyring", "ChainerBackend:empty")


class SecretStoreError(RuntimeError):
    pass


def _configure_backend() -> None:
    if sys.platform == "win32":
        # PyInstaller builds may not discover backends through entry points, leaving the
        # "fail" or an empty chainer backend: pin Windows Credential Manager in that case.
        from keyring.backends.Windows import WinVaultKeyring

        current = keyring.get_keyring()
        name = type(current).__module__ + "." + type(current).__name__
        empty_chainer = "Chainer" in name and not getattr(current, "backends", None)
        if getattr(sys, "frozen", False) or "fail" in name or empty_chainer:
            if not isinstance(current, WinVaultKeyring):
                keyring.set_keyring(WinVaultKeyring())


class SecretStore:
    def __init__(self, service: str = KEYRING_SERVICE):
        self.service = service
        _configure_backend()

    @staticmethod
    def backend_name() -> str:
        kr = keyring.get_keyring()
        return f"{type(kr).__module__}.{type(kr).__name__}"

    def _check_backend(self) -> None:
        name = self.backend_name()
        if any(bad in name for bad in _INSECURE_BACKENDS):
            raise SecretStoreError(
                "No secure credential store is available on this system; refusing to store API keys."
            )

    @staticmethod
    def _user(provider_id: str) -> str:
        return f"provider:{provider_id}"

    def set_key(self, provider_id: str, key: str) -> None:
        key = (key or "").strip()
        if not key:
            raise SecretStoreError("The API key is empty.")
        if "\n" in key or "\r" in key:
            raise SecretStoreError("The API key must be a single line.")
        self._check_backend()
        try:
            keyring.set_password(self.service, self._user(provider_id), key)
        except KeyringError as e:  # pragma: no cover - OS specific
            raise SecretStoreError(f"Could not save the key to the credential store: {e}") from e

    def get_key(self, provider_id: str) -> str | None:
        try:
            return keyring.get_password(self.service, self._user(provider_id))
        except KeyringError as e:  # pragma: no cover
            raise SecretStoreError(f"Could not read the credential store: {e}") from e

    def has_key(self, provider_id: str) -> bool:
        try:
            return bool(self.get_key(provider_id))
        except SecretStoreError:
            return False

    def delete_key(self, provider_id: str) -> None:
        try:
            keyring.delete_password(self.service, self._user(provider_id))
        except PasswordDeleteError:
            pass
        except KeyringError:  # pragma: no cover
            pass

    def rename_key(self, old_id: str, new_id: str) -> None:
        if old_id == new_id:
            return
        k = self.get_key(old_id)
        if k:
            self.set_key(new_id, k)
            self.delete_key(old_id)

    def get_or_create_bridge_token(self) -> str:
        tok = keyring.get_password(self.service, BRIDGE_TOKEN_USER)
        if not tok:
            self._check_backend()
            tok = "agb_" + _pysecrets.token_urlsafe(32)
            keyring.set_password(self.service, BRIDGE_TOKEN_USER, tok)
        return tok
