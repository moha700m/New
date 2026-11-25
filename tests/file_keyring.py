"""File-backed keyring used only by tests so a helper *subprocess* can read keys."""
import json
import os

from keyring.backend import KeyringBackend
from keyring.errors import PasswordDeleteError


class FileKeyring(KeyringBackend):
    priority = 1

    @property
    def _path(self):
        return os.environ["AGENTSII_TEST_KEYRING_FILE"]

    def _load(self):
        try:
            with open(self._path) as f:
                return json.load(f)
        except FileNotFoundError:
            return {}

    def set_password(self, service, username, password):
        d = self._load()
        d[f"{service}|{username}"] = password
        with open(self._path, "w") as f:
            json.dump(d, f)

    def get_password(self, service, username):
        return self._load().get(f"{service}|{username}")

    def delete_password(self, service, username):
        d = self._load()
        if f"{service}|{username}" not in d:
            raise PasswordDeleteError("missing")
        del d[f"{service}|{username}"]
        with open(self._path, "w") as f:
            json.dump(d, f)
