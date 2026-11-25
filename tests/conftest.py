import os
import sys
from pathlib import Path

import keyring
import pytest
from keyring.backend import KeyringBackend

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))


class MemoryKeyring(KeyringBackend):
    priority = 1

    def __init__(self):
        super().__init__()
        self.data = {}

    def set_password(self, service, username, password):
        self.data[(service, username)] = password

    def get_password(self, service, username):
        return self.data.get((service, username))

    def delete_password(self, service, username):
        from keyring.errors import PasswordDeleteError

        if (service, username) not in self.data:
            raise PasswordDeleteError("missing")
        del self.data[(service, username)]


@pytest.fixture(autouse=True)
def isolated_env(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENTSII_CM_HOME", str(tmp_path / "agentsii"))
    monkeypatch.setenv("CODEX_HOME", str(tmp_path / "codex"))
    monkeypatch.setenv("NO_PROXY", "127.0.0.1,localhost")
    kr = MemoryKeyring()
    keyring.set_keyring(kr)
    yield kr


@pytest.fixture
def mem_keyring(isolated_env):
    return isolated_env


@pytest.fixture
def codex_home(tmp_path) -> Path:
    p = tmp_path / "codex"
    p.mkdir(exist_ok=True)
    return p
