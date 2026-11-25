import tomllib
from pathlib import Path

import pytest

from agentsii_cm.codex_config import CodexConfigManager, ConfigParseError, ProviderConflictError
from agentsii_cm.models import AUTH_NONE, WIRE_CHAT, WIRE_RESPONSES, Provider
from agentsii_cm.settings import AppSettings

ORIGINAL = """# My personal Codex config — keep this comment!
model = "gpt-5.5"
approval_policy = "on-request"

[mcp_servers.docs]
command = "npx"
args = ["-y", "docs-mcp"]

[model_providers.mine]
name = "Mine"
base_url = "https://mine.example/v1"
env_key = "MINE_KEY"
"""


def provider(**kw):
    d = dict(id="deepseek", name="DeepSeek", base_url="https://api.deepseek.com", wire_api=WIRE_CHAT,
             models=["deepseek-chat", "deepseek-reasoner"], default_model="deepseek-chat")
    d.update(kw)
    return Provider(**d)


@pytest.fixture
def mgr(codex_home, tmp_path):
    (codex_home / "config.toml").write_text(ORIGINAL, encoding="utf-8")
    s = AppSettings()
    helper = tmp_path / "bin dir" / "agentsii-helper.exe"
    helper.parent.mkdir()
    helper.write_text("x")
    return CodexConfigManager(codex_home, s, helper, tmp_path / "backups", save_settings=lambda _s: None)


def load(m):
    return tomllib.loads(m.config_path.read_text())


def test_apply_direct_preserves_everything(mgr):
    p = provider(id="openrouter", name="OpenRouter", base_url="https://openrouter.ai/api/v1",
                 wire_api=WIRE_RESPONSES, models=["openai/gpt-5"], default_model="openai/gpt-5")
    res = mgr.apply_provider(p, make_default=True)
    text = mgr.config_path.read_text()
    assert "# My personal Codex config — keep this comment!" in text
    data = load(mgr)
    assert data["approval_policy"] == "on-request"
    assert data["mcp_servers"]["docs"]["args"] == ["-y", "docs-mcp"]
    assert data["model_providers"]["mine"]["env_key"] == "MINE_KEY"
    t = data["model_providers"]["openrouter"]
    assert t["wire_api"] == "responses"
    assert t["base_url"] == "https://openrouter.ai/api/v1"
    assert t["auth"]["args"] == ["token", "openrouter"]
    assert t["auth"]["command"] == str(mgr.helper_path)
    assert "env_key" not in t and "experimental_bearer_token" not in t
    assert data["model_provider"] == "openrouter" and data["model"] == "openai/gpt-5"
    assert res.backup_path and Path(res.backup_path).read_text() == ORIGINAL
    assert mgr.settings.original_codex_defaults == {"model": "gpt-5.5", "model_provider": None}
    assert mgr.profile_path("openrouter").is_file()


def test_chat_provider_goes_through_bridge(mgr):
    mgr.apply_provider(provider(), make_default=False)
    t = load(mgr)["model_providers"]["deepseek"]
    assert t["base_url"] == f"http://127.0.0.1:{mgr.settings.bridge_port}/p/deepseek/v1"
    assert t["wire_api"] == "responses"  # Codex no longer supports "chat"
    assert t["auth"]["args"] == ["bridge-token"]
    assert load(mgr)["model"] == "gpt-5.5"  # default untouched


def test_no_key_anywhere(mgr, mem_keyring):
    mgr.apply_provider(provider(), make_default=True)
    assert "sk-" not in mgr.config_path.read_text()


def test_no_auth_provider(mgr):
    p = provider(id="local", name="Local", base_url="http://localhost:1234/v1", wire_api=WIRE_RESPONSES,
                 auth_type=AUTH_NONE)
    mgr.apply_provider(p, make_default=False)
    assert "auth" not in load(mgr)["model_providers"]["local"]


def test_conflict_with_user_table(mgr):
    with pytest.raises(ProviderConflictError):
        mgr.apply_provider(provider(id="mine"), make_default=False)
    mgr.apply_provider(provider(id="mine"), make_default=False, overwrite=True)


def test_invalid_toml_is_never_touched(mgr):
    mgr.config_path.write_text("model = [broken\n")
    with pytest.raises(ConfigParseError):
        mgr.apply_provider(provider(), make_default=True)
    assert mgr.config_path.read_text() == "model = [broken\n"


def test_missing_config_is_created(codex_home, tmp_path):
    m = CodexConfigManager(codex_home / "new", AppSettings(), tmp_path / "h.exe", tmp_path / "b",
                           save_settings=lambda s: None)
    m.apply_provider(provider(), make_default=True)
    assert load(m)["model_provider"] == "deepseek"


def test_disconnect_restores_original_defaults(mgr):
    mgr.apply_provider(provider(), make_default=True)
    mgr.apply_provider(provider(id="other", name="O"), make_default=True)
    mgr.remove_provider("other")
    data = load(mgr)
    assert data["model"] == "gpt-5.5" and "model_provider" not in data
    assert "other" not in data["model_providers"] and "deepseek" in data["model_providers"]
    mgr.remove_provider("deepseek")
    data = load(mgr)
    assert set(data["model_providers"]) == {"mine"}
    assert not mgr.profile_path("deepseek").exists()
    assert "keep this comment" in mgr.config_path.read_text()


def test_remove_refuses_foreign_table(mgr):
    with pytest.raises(ProviderConflictError):
        mgr.remove_provider("mine")


def test_switch_default_model(mgr):
    p = provider()
    mgr.apply_provider(p, make_default=True)
    p.default_model = "deepseek-reasoner"
    mgr.set_default(p)
    assert load(mgr)["model"] == "deepseek-reasoner"
    assert mgr.settings.original_codex_defaults["model"] == "gpt-5.5"


def test_backups_and_restore(mgr):
    mgr.apply_provider(provider(), make_default=True)
    backups = mgr.list_backups()
    assert backups
    mgr.restore_backup(backups[-1])
    assert mgr.config_path.read_text() == ORIGINAL


def test_validate_provider(mgr):
    p = provider()
    mgr.apply_provider(p, make_default=True)
    ok = mgr.validate_provider(p, True, run_helper=lambda argv: (0, "agb_token\n", ""))
    assert all(c.ok for c in ok)
    bad = mgr.validate_provider(p, True, run_helper=lambda argv: (2, "", "no key"))
    assert not bad[-1].ok and "no key" in bad[-1].message
