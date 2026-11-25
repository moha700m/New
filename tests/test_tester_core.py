import hashlib
import json
import subprocess
import sys
import tomllib
import zipfile

import httpx
import pytest

from agentsii_cm import backup, updater
from agentsii_cm.core import AppCore
from agentsii_cm.models import WIRE_CHAT, WIRE_RESPONSES, Provider
from agentsii_cm.tester import FAIL, PASS, WARN, ConnectionTester

from .mock_upstream import API_KEY, MockState, make_server


@pytest.fixture
def upstream():
    st = MockState()
    srv = make_server(st)
    yield st, f"http://127.0.0.1:{srv.server_address[1]}/v1"
    srv.shutdown()


def prov(base, wire=WIRE_CHAT, model="mock-chat"):
    return Provider(id="mock", name="Mock", base_url=base, wire_api=wire, models=[model], default_model=model)


def client():
    return httpx.Client(trust_env=False, timeout=10)


def test_tester_chat_pass(upstream):
    st, base = upstream
    st.mode = "tool"
    rep = ConnectionTester(prov(base), API_KEY, client=client()).run()
    statuses = {c.key: c.status for c in rep.checks}
    assert statuses == {"url": PASS, "auth": PASS, "model": PASS, "protocol": PASS, "tools": PASS}, rep.checks
    assert rep.overall == PASS and "mock-reasoner" in rep.detected_models


def test_tester_bad_key(upstream):
    _, base = upstream
    rep = ConnectionTester(prov(base), "sk-wrong", client=client()).run()
    assert rep.overall == FAIL and any(c.key == "auth" and "401" in c.message for c in rep.checks)


def test_tester_unknown_model_and_no_tools(upstream):
    st, base = upstream
    st.mode = "text"
    rep = ConnectionTester(prov(base, model="typo-model"), API_KEY, client=client()).run()
    s = {c.key: c.status for c in rep.checks}
    assert s["model"] == WARN and s["tools"] == WARN


def test_tester_responses_not_supported(upstream):
    _, base = upstream
    rep = ConnectionTester(prov(base, WIRE_RESPONSES), API_KEY, client=client()).run()
    proto = next(c for c in rep.checks if c.key == "protocol")
    assert proto.status == FAIL and "Chat Completions" in proto.message


def test_tester_responses_supported(upstream):
    st, base = upstream
    st.supports_responses = True
    rep = ConnectionTester(prov(base, WIRE_RESPONSES), API_KEY, client=client()).run()
    assert {c.key: c.status for c in rep.checks}["protocol"] == PASS


def test_detect_protocols(upstream):
    _, base = upstream
    assert ConnectionTester(prov(base), API_KEY, client=client()).detect_protocols("mock-chat") == \
        {"responses": False, "chat": True}


def test_tester_unreachable():
    rep = ConnectionTester(prov("https://nonexistent.invalid/v1"), API_KEY, timeout=3, client=client()).run()
    assert rep.overall == FAIL


def test_tester_timeout():
    import socket
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    s.listen(1)  # accepts but never answers
    base = f"http://127.0.0.1:{s.getsockname()[1]}/v1"
    rep = ConnectionTester(prov(base), API_KEY, timeout=1.5, client=httpx.Client(trust_env=False, timeout=1.5)).run()
    s.close()
    assert any("Timed out" in c.message for c in rep.checks)


# ---------------------------------------------------------------- core end-to-end
@pytest.fixture
def file_keyring(tmp_path, monkeypatch):
    import keyring
    from pathlib import Path
    from .file_keyring import FileKeyring
    monkeypatch.setenv("AGENTSII_TEST_KEYRING_FILE", str(tmp_path / "kr.json"))
    monkeypatch.setenv("PYTHON_KEYRING_BACKEND", "tests.file_keyring.FileKeyring")
    monkeypatch.setenv("PYTHONPATH", str(Path(__file__).resolve().parents[1]))
    kr = FileKeyring()
    keyring.set_keyring(kr)
    return kr


def test_core_connect_flow_with_real_helper(upstream, codex_home, file_keyring):
    _, base = upstream
    core = AppCore()
    (codex_home / "config.toml").write_text('model = "gpt-5.5"\n[features]\nx = true\n')
    p = Provider(id="mockdirect", name="Mock Direct", base_url=base, wire_api=WIRE_RESPONSES,
                 models=["mock-chat"], default_model="mock-chat", is_default=True)
    core.save_provider(p, API_KEY)
    res = core.connect("mockdirect")
    assert res.ok, res.error
    data = tomllib.loads((codex_home / "config.toml").read_text())
    assert data["features"]["x"] is True
    assert data["model_provider"] == "mockdirect"
    helper = data["model_providers"]["mockdirect"]["auth"]["command"]
    # Codex runs exactly this command; it must print the key from the keyring.
    # (The subprocess has its own keyring, so test the module entry with the same process.)
    from agentsii_cm import helper_cli
    import io, contextlib
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        assert helper_cli.main(["token", "mockdirect"]) == 0
    assert buf.getvalue().strip() == API_KEY
    assert API_KEY not in (codex_home / "config.toml").read_text()
    assert core.store.get("mockdirect").codex_connected
    # switching model
    core.set_default("mockdirect", "mock-reasoner")
    assert tomllib.loads((codex_home / "config.toml").read_text())["model"] == "mock-reasoner"
    # disconnect restores
    core.disconnect("mockdirect")
    data = tomllib.loads((codex_home / "config.toml").read_text())
    assert data["model"] == "gpt-5.5" and "model_providers" not in data
    core.delete_provider("mockdirect")
    assert file_keyring.get_password("Agentsii Codex Manager", "provider:mockdirect") is None


def test_core_connect_reports_failure_honestly(codex_home, mem_keyring, monkeypatch):
    core = AppCore()
    p = Provider(id="x1", name="X", base_url="https://api.example.com/v1", wire_api=WIRE_RESPONSES,
                 models=["m"], default_model="m")
    core.save_provider(p, "sk-abcdefghijklmnop")
    # Helper launcher works but the subprocess has no access to the in-memory test keyring -> fails
    res = core.connect("x1", make_default=False)
    assert not res.ok and "verification failed" in res.error
    assert not core.store.get("x1").codex_connected


def test_save_requires_key(mem_keyring):
    from agentsii_cm.models import ValidationError
    core = AppCore()
    with pytest.raises(ValidationError):
        core.save_provider(Provider(id="k1", name="K", base_url="https://a.example/v1", models=["m"],
                                    default_model="m"), None)


def test_helper_cli_missing_key_exit_code():
    from agentsii_cm import helper_cli
    assert helper_cli.main(["token", "nobody"]) == 2


def test_helper_subprocess_version():
    r = subprocess.run([sys.executable, "-m", "agentsii_cm.helper_cli", "version"], capture_output=True, text=True,
                       env={**__import__("os").environ, "PYTHONPATH": "src"})
    assert r.returncode == 0 and r.stdout.strip()


# ---------------------------------------------------------------- updater / backup
def test_manifest_validation():
    good = {"version": "9.0.0", "installer": {"url": "https://x.example/a.exe", "sha256": "a" * 64}}
    info = updater.parse_manifest(good)
    assert info.newer
    with pytest.raises(updater.UpdateError):
        updater.parse_manifest({**good, "installer": {"url": "http://x/a.exe", "sha256": "a" * 64}})
    with pytest.raises(updater.UpdateError):
        updater.parse_manifest({"version": "1"})
    assert not updater.parse_manifest({**good, "version": "0.9.9"}).newer


def test_download_verifies_checksum(tmp_path):
    payload = b"MZ fake installer"
    sha = hashlib.sha256(payload).hexdigest()

    def handler(req):
        return httpx.Response(200, content=payload)

    c = httpx.Client(transport=httpx.MockTransport(handler))
    info = updater.parse_manifest({"version": "2.0.0", "installer": {"url": "https://x.example/a.exe", "sha256": sha}})
    path = updater.download(info, tmp_path, client=c)
    assert path.read_bytes() == payload
    bad = updater.parse_manifest({"version": "2.0.0", "installer": {"url": "https://x.example/a.exe", "sha256": "0" * 64}})
    with pytest.raises(updater.UpdateError):
        updater.download(bad, tmp_path / "b", client=c)
    assert not list((tmp_path / "b").glob("*.exe")) if (tmp_path / "b").exists() else True


def test_check_manifest_over_http():
    def handler(req):
        return httpx.Response(200, json={"version": "1.0.0", "installer": {"url": "https://x.example/a.exe",
                                                                          "sha256": "b" * 64}})
    info = updater.check("https://x.example/latest.json", client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert info.version == "1.0.0" and not info.newer


def test_backup_roundtrip(tmp_path):
    pf = tmp_path / "providers.json"
    pf.write_text(json.dumps({"providers": []}))
    sf = tmp_path / "settings.json"
    sf.write_text("{}")
    cf = tmp_path / "config.toml"
    cf.write_text('model = "x"\n')
    z = backup.create_backup(tmp_path / "b.zip", pf, sf, cf)
    data = backup.read_backup(z)
    assert set(data) == {"providers.json", "settings.json", "codex/config.toml"}
    with zipfile.ZipFile(tmp_path / "evil.zip", "w") as zz:
        zz.writestr("hello.txt", "x")
    with pytest.raises(ValueError):
        backup.read_backup(tmp_path / "evil.zip")
