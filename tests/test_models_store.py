import json

import pytest

from agentsii_cm.models import (AUTH_HEADER, MODE_BRIDGE, MODE_DIRECT, WIRE_CHAT, WIRE_RESPONSES, Provider,
                                ValidationError, slugify_provider_id)
from agentsii_cm.store import ProviderStore


def mk(**kw):
    d = dict(id="deepseek", name="DeepSeek", base_url="https://api.deepseek.com", wire_api=WIRE_CHAT,
             models=["deepseek-chat"], default_model="deepseek-chat")
    d.update(kw)
    return Provider(**d)


def test_validation_ok():
    mk().validate()


@pytest.mark.parametrize("field,value", [
    ("id", "OpenAI"), ("id", "openai"), ("id", "a"), ("id", "has space"),
    ("base_url", "api.example.com"), ("base_url", "http://example.com/v1"), ("base_url", "https://x.com/v1?a=1"),
    ("wire_api", "chat-completions"), ("models", []),
])
def test_validation_errors(field, value):
    with pytest.raises(ValidationError) as e:
        mk(**{field: value}).validate()
    assert field in e.value.errors or "models" in e.value.errors


def test_http_localhost_allowed():
    mk(base_url="http://localhost:11434/v1").validate()


def test_header_auth_requires_name():
    with pytest.raises(ValidationError):
        mk(auth_type=AUTH_HEADER, auth_header_name="").validate()
    mk(auth_type=AUTH_HEADER, auth_header_name="X-API-Key").validate()


def test_connection_mode():
    assert mk(wire_api=WIRE_CHAT).connection_mode == MODE_BRIDGE
    assert mk(wire_api=WIRE_RESPONSES).connection_mode == MODE_DIRECT
    assert mk(wire_api=WIRE_RESPONSES, auth_type=AUTH_HEADER, auth_header_name="X-K").connection_mode == MODE_BRIDGE


def test_slugify():
    assert slugify_provider_id("Shannon AI") == "shannon-ai"
    assert slugify_provider_id("OpenAI") == "openai-custom"
    assert slugify_provider_id("!") == "provider"


def test_store_crud_and_single_default(tmp_path):
    s = ProviderStore(tmp_path / "p.json")
    s.upsert(mk(is_default=True))
    s.upsert(mk(id="openrouter", name="OR", base_url="https://openrouter.ai/api/v1", is_default=True))
    assert [p.id for p in s.list() if p.is_default] == ["openrouter"]
    with pytest.raises(ValidationError):
        s.upsert(mk(id="openrouter"))  # duplicate new
    p = s.get("deepseek")
    p.models.append("deepseek-reasoner")
    s.upsert(p, original_id="deepseek")
    assert s.get("deepseek").models == ["deepseek-chat", "deepseek-reasoner"]
    p.id = "ds2"
    s.upsert(p, original_id="deepseek")
    assert s.get("deepseek") is None and s.get("ds2")
    assert s.delete("ds2") and not s.delete("ds2")


def test_export_has_no_secrets_and_roundtrips(tmp_path):
    s = ProviderStore(tmp_path / "p.json")
    s.upsert(mk())
    text = s.export_json()
    assert "api_key" not in text
    data = json.loads(text)
    data["providers"][0]["api_key"] = "sk-should-be-dropped"
    imported = ProviderStore.parse_export(json.dumps(data))
    assert imported[0].id == "deepseek"
    assert not hasattr(imported[0], "api_key")
    s2 = ProviderStore(tmp_path / "p2.json")
    ok, skipped = s2.import_providers(imported)
    assert ok == ["deepseek"] and skipped == []
    ok, skipped = s2.import_providers(imported)
    assert skipped == ["deepseek"]
    assert "sk-should-be-dropped" not in (tmp_path / "p2.json").read_text()


def test_parse_export_rejects_other_files():
    with pytest.raises(ValueError):
        ProviderStore.parse_export('{"hello": 1}')
