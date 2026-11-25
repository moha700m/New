import json
import os
import socket
import subprocess
import sys
import time
import tomllib
from pathlib import Path

import httpx
import pytest

from .mock_upstream import API_KEY, MockState, make_server

ROOT = Path(__file__).resolve().parents[1]


def test_ui_selftest(tmp_path):
    env = {**os.environ, "QT_QPA_PLATFORM": "offscreen", "PYTHONPATH": str(ROOT / "src")}
    out = tmp_path / "st.json"
    r = subprocess.run([sys.executable, "-m", "agentsii_cm.app", "--selftest", "--selftest-out", str(out)],
                       env=env, capture_output=True, text=True, timeout=120)
    data = json.loads(out.read_text(encoding="utf-8"))
    assert r.returncode == 0 and data["ok"], data.get("error")
    assert data["pages"] == 8


def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


@pytest.fixture
def file_keyring(tmp_path, monkeypatch):
    import keyring
    from .file_keyring import FileKeyring
    monkeypatch.setenv("AGENTSII_TEST_KEYRING_FILE", str(tmp_path / "kr.json"))
    monkeypatch.setenv("PYTHON_KEYRING_BACKEND", "tests.file_keyring.FileKeyring")
    monkeypatch.setenv("PYTHONPATH", str(ROOT))
    kr = FileKeyring()
    keyring.set_keyring(kr)
    return kr


def test_end_to_end_chat_provider_through_spawned_bridge(codex_home, file_keyring):
    """Full path Codex would take: config.toml -> helper bridge-token (spawns bridge) -> bridge -> provider."""
    from agentsii_cm.core import AppCore
    from agentsii_cm.models import WIRE_CHAT, Provider

    st = MockState()
    up = make_server(st)
    base = f"http://127.0.0.1:{up.server_address[1]}/v1"
    core = AppCore()
    core.settings.bridge_port = _free_port()
    core.save_settings()
    core.save_provider(Provider(id="dsk", name="DeepSeek-like", base_url=base, wire_api=WIRE_CHAT,
                                models=["mock-chat"], default_model="mock-chat", is_default=True), API_KEY)
    try:
        res = core.connect("dsk")
        assert res.ok, res.error
        cfg = tomllib.loads((codex_home / "config.toml").read_text(encoding="utf-8"))
        table = cfg["model_providers"]["dsk"]
        # Do exactly what Codex does: run the auth command, then call base_url/responses with the token.
        r = subprocess.run([table["auth"]["command"], *table["auth"]["args"]], capture_output=True, text=True,
                           timeout=60, stdin=subprocess.DEVNULL)
        assert r.returncode == 0, r.stderr
        token = r.stdout.strip()
        assert token.startswith("agb_") and API_KEY not in r.stdout
        body = {"model": cfg["model"], "instructions": "be brief", "stream": True,
                "input": [{"type": "message", "role": "user", "content": [{"type": "input_text", "text": "hi"}]}]}
        resp = httpx.post(table["base_url"] + "/responses", json=body, headers={"Authorization": f"Bearer {token}"},
                          timeout=30, trust_env=False)
        assert resp.status_code == 200
        assert "response.completed" in resp.text and '"delta":"O"' in resp.text
        assert st.requests[-1]["headers"]["Authorization"] == f"Bearer {API_KEY}"
    finally:
        core.stop_bridge()
        up.shutdown()
