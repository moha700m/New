import json
import socket

import httpx
import pytest

from agentsii_cm.bridge import server as bridge
from agentsii_cm.bridge.translate import iter_sse
from agentsii_cm.models import AUTH_HEADER, WIRE_CHAT, WIRE_RESPONSES, Provider

from .mock_upstream import API_KEY, MockState, make_server

TOKEN = "agb_test_token_value_123456"


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture
def env():
    st = MockState()
    up = make_server(st)
    base = f"http://127.0.0.1:{up.server_address[1]}/v1"
    providers = {
        "ds": Provider(id="ds", name="DS", base_url=base, wire_api=WIRE_CHAT, models=["mock-chat"],
                       default_model="mock-chat"),
        "or": Provider(id="or", name="OR", base_url=base, wire_api=WIRE_RESPONSES, auth_type=AUTH_HEADER,
                       auth_header_name="X-API-Key", models=["mock-chat"], default_model="mock-chat"),
    }
    port = free_port()
    ctx = bridge.BridgeContext(providers.get, lambda pid: API_KEY, TOKEN, port,
                               client=httpx.Client(trust_env=False, timeout=10))
    srv, _ = bridge.start_in_thread(ctx)
    yield st, port
    srv.shutdown()
    up.shutdown()


def post(port, path, body, token=TOKEN, headers=None):
    h = {"Authorization": f"Bearer {token}"}
    h.update(headers or {})
    return httpx.post(f"http://127.0.0.1:{port}{path}", json=body, headers=h, timeout=10, trust_env=False)


def events_of(resp):
    out = []
    for ev, data in iter_sse(resp.text.splitlines()):
        out.append((ev, json.loads(data)))
    return out


def test_health_and_auth(env):
    _, port = env
    assert bridge.health(port)["app"] == "agentsii-bridge"
    r = post(port, "/p/ds/v1/responses", {"input": "hi"}, token="wrong")
    assert r.status_code == 401
    r = post(port, "/p/ds/v1/responses", {"input": "hi"}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    r = post(port, "/p/nope/v1/responses", {"input": "hi"})
    assert r.status_code == 404


def test_stream_text_translation(env):
    st, port = env
    r = post(port, "/p/ds/v1/responses", {"model": "mock-chat", "input": "hi", "stream": True})
    assert r.status_code == 200 and "event-stream" in r.headers["content-type"]
    ev = events_of(r)
    assert ev[-1][0] == "response.completed"
    text = "".join(d["delta"] for e, d in ev if e == "response.output_text.delta")
    assert text == "OK"
    assert ev[-1][1]["response"]["usage"]["total_tokens"] == 14
    up = st.requests[-1]
    assert up["path"] == "/v1/chat/completions"
    assert up["headers"]["Authorization"] == f"Bearer {API_KEY}"
    assert TOKEN not in json.dumps(up)  # bridge token never forwarded upstream


def test_stream_tool_call_translation(env):
    st, port = env
    st.mode = "reasoning_tool"
    body = {"model": "mock-chat", "stream": True, "input": [{"type": "message", "role": "user", "content": "ls"}],
            "tools": [{"type": "function", "name": "shell", "parameters": {"type": "object"}}]}
    ev = events_of(post(port, "/p/ds/v1/responses", body))
    items = [d["item"] for e, d in ev if e == "response.output_item.done"]
    assert [i["type"] for i in items] == ["reasoning", "function_call"]
    assert items[1]["name"] == "shell" and json.loads(items[1]["arguments"]) == {"command": ["ls"]}
    # follow-up request carries reasoning_content back to the provider
    body2 = dict(body, input=body["input"] + [items[1], {"type": "function_call_output", "call_id": items[1]["call_id"],
                                                         "output": "a.txt"}])
    st.mode = "text"
    post(port, "/p/ds/v1/responses", body2)
    msgs = st.requests[-1]["body"]["messages"]
    assert msgs[1]["reasoning_content"] == "Let me think. Run ls."


def test_stream_options_retry(env):
    st, port = env
    st.mode = "no_stream_options"
    ev = events_of(post(port, "/p/ds/v1/responses", {"input": "hi", "stream": True}))
    assert ev[-1][0] == "response.completed"
    assert "stream_options" not in st.requests[-1]["body"]


def test_upstream_401_is_passed_through(env):
    st, port = env
    st.mode = "error401"
    r = post(port, "/p/ds/v1/responses", {"input": "hi", "stream": True})
    assert r.status_code == 401 and "rejected" in r.json()["error"]["message"]


def test_non_stream(env):
    _, port = env
    r = post(port, "/p/ds/v1/responses", {"input": "hi"})
    assert r.status_code == 200 and r.json()["output"][0]["content"][0]["text"] == "OK"


def test_passthrough_with_custom_header(env):
    st, port = env
    st.supports_responses = True
    ev = events_of(post(port, "/p/or/v1/responses", {"input": "hi", "stream": True}))
    assert ev[-1][1]["type"] == "response.completed"
    assert st.requests[-1]["headers"]["X-API-Key"] == API_KEY
    assert "Authorization" not in st.requests[-1]["headers"]


def test_models_proxy(env):
    _, port = env
    r = httpx.get(f"http://127.0.0.1:{port}/p/ds/v1/models", headers={"Authorization": f"Bearer {TOKEN}"},
                  trust_env=False)
    assert r.json()["data"][0]["id"] == "mock-chat"


def test_shutdown(env):
    _, port = env
    assert bridge.stop(port, TOKEN)
