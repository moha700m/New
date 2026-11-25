import json

from agentsii_cm.bridge.translate import (ChatStreamTranslator, ReasoningCache, chat_completion_to_response,
                                          iter_sse, responses_to_chat)

CODEX_LIKE_REQUEST = {
    "model": "deepseek-chat",
    "instructions": "You are Codex.",
    "input": [
        {"type": "message", "role": "developer", "content": [{"type": "input_text", "text": "Sandbox: read-only"}]},
        {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "list files"}]},
        {"type": "reasoning", "id": "rs_1", "summary": [{"type": "summary_text", "text": "I should run ls"}]},
        {"type": "function_call", "name": "shell", "arguments": "{\"command\":[\"ls\"]}", "call_id": "call_1"},
        {"type": "function_call_output", "call_id": "call_1", "output": "a.txt\nb.txt"},
        {"type": "custom_tool_call", "name": "apply_patch", "input": "*** Begin Patch", "call_id": "call_2"},
        {"type": "custom_tool_call_output", "call_id": "call_2", "output": "Done"},
        {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Two files."}]},
        {"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": "what is this?"},
            {"type": "input_image", "image_url": "data:image/png;base64,AAA"}]},
    ],
    "tools": [
        {"type": "function", "name": "shell", "description": "Run", "strict": False,
         "parameters": {"type": "object", "properties": {"command": {"type": "array"}}}},
        {"type": "custom", "name": "apply_patch", "description": "Patch files",
         "format": {"type": "grammar", "syntax": "lark", "definition": "start: x"}},
        {"type": "web_search"},
    ],
    "tool_choice": "auto", "parallel_tool_calls": False, "stream": True, "store": False,
    "reasoning": {"effort": "medium", "summary": "auto"}, "include": [], "prompt_cache_key": "abc",
}


def test_request_conversion():
    req, custom = responses_to_chat(CODEX_LIKE_REQUEST)
    m = req["messages"]
    assert m[0] == {"role": "system", "content": "You are Codex.\n\nSandbox: read-only"}
    assert m[1] == {"role": "user", "content": "list files"}
    assert m[2]["role"] == "assistant" and m[2]["reasoning_content"] == "I should run ls"
    assert m[2]["tool_calls"][0]["function"]["name"] == "shell"
    assert m[3] == {"role": "tool", "tool_call_id": "call_1", "content": "a.txt\nb.txt"}
    assert json.loads(m[4]["tool_calls"][0]["function"]["arguments"]) == {"input": "*** Begin Patch"}
    assert m[5]["tool_call_id"] == "call_2"
    assert m[6] == {"role": "assistant", "content": "Two files."}
    assert m[7]["content"][1] == {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAA"}}
    assert custom == {"apply_patch"}
    names = [t["function"]["name"] for t in req["tools"]]
    assert names == ["shell", "apply_patch"]  # web_search is OpenAI-hosted, dropped
    assert "lark" in req["tools"][1]["function"]["description"]
    assert req["stream"] and req["stream_options"] == {"include_usage": True}
    for k in ("store", "include", "reasoning", "prompt_cache_key", "parallel_tool_calls"):
        assert k not in req


def test_missing_tool_output_is_repaired():
    req, _ = responses_to_chat({"model": "m", "input": [
        {"type": "message", "role": "user", "content": "hi"},
        {"type": "function_call", "name": "shell", "arguments": "{}", "call_id": "c1"},
        {"type": "message", "role": "user", "content": "continue"},
    ]})
    roles = [x["role"] for x in req["messages"]]
    assert roles == ["user", "assistant", "tool", "user"]


def test_string_input():
    req, _ = responses_to_chat({"model": "m", "input": "hello"})
    assert req["messages"] == [{"role": "user", "content": "hello"}]


def _run(chunks, custom=None, cache=None):
    tr = ChatStreamTranslator("m", custom, cache)
    events = []
    for c in chunks:
        events += tr.feed(c)
    events += tr.finish()
    return events


def test_stream_text():
    ev = _run([{"choices": [{"delta": {"content": "Hel"}}]}, {"choices": [{"delta": {"content": "lo"}}]},
               {"choices": [], "usage": {"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5}}])
    types = [e[0] for e in ev]
    assert types[0] == "response.created" and types[-1] == "response.completed"
    done = [d for t, d in ev if t == "response.output_item.done"]
    assert done[0]["item"]["content"][0]["text"] == "Hello"
    comp = ev[-1][1]["response"]
    assert comp["usage"]["input_tokens"] == 3 and comp["usage"]["output_tokens"] == 2
    seq = [d["sequence_number"] for _, d in ev]
    assert seq == sorted(seq)


def test_stream_reasoning_and_tools_with_cache():
    cache = ReasoningCache()
    ev = _run([
        {"choices": [{"delta": {"reasoning_content": "think"}}]},
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_9", "function": {"name": "shell", "arguments": "{\"a\""}}]}}]},
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": ":1}"}}]}}]},
        {"choices": [{"delta": {"tool_calls": [{"index": 1, "id": "call_10", "function": {"name": "apply_patch", "arguments": "{\"input\":\"PATCH\"}"}}]}}]},
    ], custom={"apply_patch"}, cache=cache)
    items = [d["item"] for t, d in ev if t == "response.output_item.done"]
    assert [i["type"] for i in items] == ["reasoning", "function_call", "custom_tool_call"]
    assert items[0]["summary"][0]["text"] == "think"
    assert items[1]["arguments"] == '{"a":1}' and items[1]["call_id"] == "call_9"
    assert items[2]["input"] == "PATCH"
    idx = [d["output_index"] for t, d in ev if t == "response.output_item.done"]
    assert idx == [0, 1, 2]
    assert cache.get("call_9") == "think"
    # On the next request the reasoning is passed back even if Codex dropped it.
    req, _ = responses_to_chat({"model": "m", "input": [
        {"type": "function_call", "name": "shell", "arguments": "{}", "call_id": "call_9"},
        {"type": "function_call_output", "call_id": "call_9", "output": "ok"}]}, cache)
    assert req["messages"][0]["reasoning_content"] == "think"


def test_non_stream_conversion():
    r = chat_completion_to_response({"choices": [{"index": 0, "message": {"role": "assistant", "content": "Hi"}}],
                                     "usage": {"prompt_tokens": 1, "completion_tokens": 1}}, "m")
    assert r["status"] == "completed" and r["output"][0]["content"][0]["text"] == "Hi"


def test_iter_sse():
    lines = ["event: a", "data: {\"x\":1}", "", ": comment", "data: [DONE]", ""]
    assert list(iter_sse(lines)) == [("a", '{"x":1}'), (None, "[DONE]")]
