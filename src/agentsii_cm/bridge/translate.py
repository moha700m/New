"""Translation between the OpenAI Responses API (what Codex speaks) and the
Chat Completions API (what many OpenAI-compatible providers speak).

Pure functions / small state machines with no I/O, so they are fully unit-tested.
"""
from __future__ import annotations

import json
import threading
import time
import uuid
from collections import OrderedDict
from typing import Any, Iterable, Iterator

CUSTOM_TOOL_ARG = "input"


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:24]}"


class ReasoningCache:
    """Remembers reasoning text per tool call_id.

    Some providers (e.g. DeepSeek thinking mode) require the assistant's
    reasoning_content to be sent back on later requests that carry tools.
    Codex keeps reasoning items in its history, but this cache is a fallback.
    """

    def __init__(self, max_items: int = 2000):
        self._d: OrderedDict[str, str] = OrderedDict()
        self._max = max_items
        self._lock = threading.Lock()

    def put(self, call_id: str, text: str) -> None:
        if not call_id or not text:
            return
        with self._lock:
            self._d[call_id] = text
            self._d.move_to_end(call_id)
            while len(self._d) > self._max:
                self._d.popitem(last=False)

    def get(self, call_id: str) -> str | None:
        with self._lock:
            return self._d.get(call_id)


# --------------------------------------------------------------------------- request
def _content_to_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        content = [content]
    parts = []
    for c in content:
        if isinstance(c, str):
            parts.append(c)
        elif isinstance(c, dict):
            t = c.get("type")
            if t in ("input_text", "output_text", "text", "summary_text", "reasoning_text", "refusal"):
                parts.append(c.get("text") or c.get("refusal") or "")
            elif t in ("input_image", "image_url"):
                parts.append("[image omitted]")
    return "\n".join(p for p in parts if p)


def _user_content(content: Any) -> Any:
    """User content may carry images; keep them as Chat Completions image parts."""
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        content = [content]
    parts, has_image = [], False
    for c in content or []:
        if not isinstance(c, dict):
            continue
        t = c.get("type")
        if t in ("input_text", "output_text", "text"):
            parts.append({"type": "text", "text": c.get("text", "")})
        elif t == "input_image":
            url = c.get("image_url") or (c.get("image") or {}).get("url")
            if isinstance(url, dict):
                url = url.get("url")
            if url:
                has_image = True
                parts.append({"type": "image_url", "image_url": {"url": url}})
    if not has_image:
        return "\n".join(p["text"] for p in parts if p.get("text"))
    return parts


def _reasoning_text(item: dict) -> str:
    txt = _content_to_text(item.get("content"))
    if not txt:
        txt = _content_to_text(item.get("summary"))
    return txt


def convert_tools(tools: list | None) -> tuple[list[dict], set[str]]:
    """Responses tools -> Chat tools. Returns (chat_tools, custom_tool_names)."""
    out, custom = [], set()
    for t in tools or []:
        if not isinstance(t, dict):
            continue
        typ = t.get("type")
        if typ == "function":
            fn = {"name": t["name"], "parameters": t.get("parameters") or {"type": "object", "properties": {}}}
            if t.get("description"):
                fn["description"] = t["description"]
            out.append({"type": "function", "function": fn})
        elif typ == "custom":
            custom.add(t["name"])
            desc = t.get("description") or ""
            fmt = t.get("format") or {}
            if fmt.get("type") == "grammar" and fmt.get("definition"):
                desc += ("\n\nThe `input` argument must follow this " + str(fmt.get("syntax", "grammar")) +
                         " grammar:\n" + str(fmt["definition"]))
            out.append({"type": "function", "function": {
                "name": t["name"], "description": desc.strip() or t["name"],
                "parameters": {"type": "object", "properties": {CUSTOM_TOOL_ARG: {
                    "type": "string", "description": "Raw tool input."}}, "required": [CUSTOM_TOOL_ARG]}}})
        # web_search / local_shell / image_generation etc. are OpenAI-hosted: not translatable.
    return out, custom


def responses_to_chat(body: dict, cache: ReasoningCache | None = None) -> tuple[dict, set[str]]:
    """Convert a Responses API request body to a Chat Completions request body."""
    system_parts: list[str] = []
    if body.get("instructions"):
        system_parts.append(str(body["instructions"]))
    messages: list[dict] = []
    pending_reasoning = ""
    assistant: dict | None = None  # assistant message being accumulated

    def flush_assistant() -> None:
        nonlocal assistant
        if assistant is not None:
            if not assistant.get("tool_calls"):
                assistant.pop("tool_calls", None)
            if assistant.get("content") is None and not assistant.get("tool_calls"):
                assistant["content"] = ""
            messages.append(assistant)
            assistant = None

    def ensure_assistant() -> dict:
        nonlocal assistant, pending_reasoning
        if assistant is None:
            assistant = {"role": "assistant", "content": None, "tool_calls": []}
            if pending_reasoning:
                assistant["reasoning_content"] = pending_reasoning
                pending_reasoning = ""
        return assistant

    items = body.get("input")
    if isinstance(items, str):
        items = [{"type": "message", "role": "user", "content": items}]
    for it in items or []:
        if not isinstance(it, dict):
            continue
        typ = it.get("type") or ("message" if "role" in it else None)
        if typ == "message":
            role = it.get("role", "user")
            if role in ("system", "developer"):
                txt = _content_to_text(it.get("content"))
                if txt:
                    system_parts.append(txt)
                continue
            if role == "assistant":
                a = ensure_assistant()
                txt = _content_to_text(it.get("content"))
                if a.get("tool_calls"):
                    # text after tool calls starts a new assistant message
                    flush_assistant()
                    a = ensure_assistant()
                a["content"] = ((a.get("content") or "") + ("\n" if a.get("content") else "") + txt) or a.get("content")
                continue
            flush_assistant()
            pending_reasoning = ""
            messages.append({"role": "user", "content": _user_content(it.get("content"))})
        elif typ == "reasoning":
            txt = _reasoning_text(it)
            if txt:
                if assistant is not None and not assistant.get("reasoning_content"):
                    assistant["reasoning_content"] = txt
                else:
                    flush_assistant()
                    pending_reasoning = txt
        elif typ in ("function_call", "custom_tool_call"):
            a = ensure_assistant()
            call_id = it.get("call_id") or it.get("id") or _new_id("call")
            if typ == "function_call":
                args = it.get("arguments") or "{}"
            else:
                args = json.dumps({CUSTOM_TOOL_ARG: it.get("input", "")}, ensure_ascii=False)
            a["tool_calls"].append({"id": call_id, "type": "function",
                                    "function": {"name": it.get("name", ""), "arguments": args}})
            if cache and not a.get("reasoning_content"):
                cached = cache.get(call_id)
                if cached:
                    a["reasoning_content"] = cached
        elif typ in ("function_call_output", "custom_tool_call_output"):
            flush_assistant()
            out = it.get("output")
            if isinstance(out, dict) and "content" in out:
                out = out.get("content")
            text = out if isinstance(out, str) else _content_to_text(out) if out is not None else ""
            messages.append({"role": "tool", "tool_call_id": it.get("call_id", ""), "content": text})
        # local_shell_call, web_search_call, item_reference, ... are skipped
    flush_assistant()
    messages = _sanitize_tool_pairs(messages)
    if system_parts:
        messages.insert(0, {"role": "system", "content": "\n\n".join(system_parts)})

    chat_tools, custom = convert_tools(body.get("tools"))
    req: dict = {"model": body.get("model"), "messages": messages, "stream": bool(body.get("stream", False))}
    if req["stream"]:
        req["stream_options"] = {"include_usage": True}
    if chat_tools:
        req["tools"] = chat_tools
        tc = body.get("tool_choice")
        if tc in ("auto", "none", "required"):
            req["tool_choice"] = tc
        elif isinstance(tc, dict) and tc.get("name"):
            req["tool_choice"] = {"type": "function", "function": {"name": tc["name"]}}
    if body.get("max_output_tokens"):
        req["max_tokens"] = int(body["max_output_tokens"])
    for k in ("temperature", "top_p"):
        if body.get(k) is not None:
            req[k] = body[k]
    return req, custom


def _sanitize_tool_pairs(messages: list[dict]) -> list[dict]:
    """Chat Completions requires every tool_call to be answered by a tool message
    (and no orphan tool messages). Codex histories can be truncated, so repair them."""
    out: list[dict] = []
    i = 0
    while i < len(messages):
        m = messages[i]
        if m["role"] == "tool":
            # orphan tool message (no preceding assistant tool call): keep as user text
            out.append({"role": "user", "content": f"[tool output]\n{m.get('content', '')}"})
            i += 1
            continue
        out.append(m)
        i += 1
        if m["role"] == "assistant" and m.get("tool_calls"):
            wanted = [tc["id"] for tc in m["tool_calls"]]
            got: dict[str, dict] = {}
            while i < len(messages) and messages[i]["role"] == "tool":
                got[messages[i].get("tool_call_id", "")] = messages[i]
                i += 1
            for cid in wanted:
                out.append(got.pop(cid, None) or {"role": "tool", "tool_call_id": cid,
                                                   "content": "(no output was recorded for this call)"})
            for extra in got.values():
                out.append({"role": "user", "content": f"[tool output]\n{extra.get('content', '')}"})
    return out


# --------------------------------------------------------------------------- response
def _usage(u: dict | None) -> dict:
    u = u or {}
    inp = int(u.get("prompt_tokens") or 0)
    outp = int(u.get("completion_tokens") or 0)
    cached = int((u.get("prompt_tokens_details") or {}).get("cached_tokens") or u.get("prompt_cache_hit_tokens") or 0)
    reasoning = int((u.get("completion_tokens_details") or {}).get("reasoning_tokens") or 0)
    return {"input_tokens": inp, "input_tokens_details": {"cached_tokens": cached},
            "output_tokens": outp, "output_tokens_details": {"reasoning_tokens": reasoning},
            "total_tokens": int(u.get("total_tokens") or inp + outp)}


class ChatStreamTranslator:
    """Feeds Chat Completions stream chunks and yields Responses API SSE events."""

    def __init__(self, model: str, custom_tools: set[str] | None = None, cache: ReasoningCache | None = None):
        self.model = model
        self.custom = custom_tools or set()
        self.cache = cache
        self.resp_id = _new_id("resp")
        self.created = int(time.time())
        self.output: list[dict] = []
        self.usage: dict | None = None
        self._seq = 0
        self._reason: dict | None = None
        self._msg: dict | None = None
        self._tools: dict[int, dict] = {}
        self._reasoning_all = ""
        self._started = False
        self._done = False

    # -- helpers
    def _ev(self, typ: str, **data) -> tuple[str, dict]:
        self._seq += 1
        return typ, {"type": typ, "sequence_number": self._seq, **data}

    def _resp(self, status: str) -> dict:
        r = {"id": self.resp_id, "object": "response", "created_at": self.created, "status": status,
             "model": self.model, "output": self.output if status != "in_progress" else []}
        if status == "completed":
            r["usage"] = _usage(self.usage)
        return r

    def start(self) -> list[tuple[str, dict]]:
        if self._started:
            return []
        self._started = True
        return [self._ev("response.created", response=self._resp("in_progress")),
                self._ev("response.in_progress", response=self._resp("in_progress"))]

    def _close_reasoning(self) -> list:
        if not self._reason:
            return []
        r = self._reason
        self._reason = None
        text = r["_text"]
        item = {"type": "reasoning", "id": r["id"], "summary": [{"type": "summary_text", "text": text}]}
        idx = r["index"]
        self.output.append(item)
        return [self._ev("response.reasoning_summary_text.done", item_id=r["id"], output_index=idx,
                         summary_index=0, text=text),
                self._ev("response.reasoning_summary_part.done", item_id=r["id"], output_index=idx,
                         summary_index=0, part={"type": "summary_text", "text": text}),
                self._ev("response.output_item.done", output_index=idx, item=item)]

    def _close_message(self) -> list:
        if not self._msg:
            return []
        m = self._msg
        self._msg = None
        text = m["_text"]
        part = {"type": "output_text", "text": text, "annotations": []}
        item = {"type": "message", "id": m["id"], "role": "assistant", "status": "completed", "content": [part]}
        idx = m["index"]
        self.output.append(item)
        return [self._ev("response.output_text.done", item_id=m["id"], output_index=idx, content_index=0, text=text),
                self._ev("response.content_part.done", item_id=m["id"], output_index=idx, content_index=0, part=part),
                self._ev("response.output_item.done", output_index=idx, item=item)]

    def _next_index(self) -> int:
        n = len(self.output) + (1 if self._reason else 0) + (1 if self._msg else 0) + len(self._tools)
        return n

    # -- main entry
    def feed(self, chunk: dict) -> list[tuple[str, dict]]:
        events = self.start()
        if chunk.get("usage"):
            self.usage = chunk["usage"]
        if chunk.get("error"):
            raise UpstreamStreamError(_err_message(chunk["error"]))
        for choice in chunk.get("choices") or []:
            delta = choice.get("delta") or choice.get("message") or {}
            rtxt = delta.get("reasoning_content") or delta.get("reasoning") or ""
            if isinstance(rtxt, str) and rtxt:
                if self._reason is None:
                    events += self._close_message()
                    rid = _new_id("rs")
                    self._reason = {"id": rid, "index": self._next_index(), "_text": ""}
                    events.append(self._ev("response.output_item.added", output_index=self._reason["index"],
                                           item={"type": "reasoning", "id": rid, "summary": []}))
                    events.append(self._ev("response.reasoning_summary_part.added", item_id=rid,
                                           output_index=self._reason["index"], summary_index=0,
                                           part={"type": "summary_text", "text": ""}))
                self._reason["_text"] += rtxt
                self._reasoning_all += rtxt
                events.append(self._ev("response.reasoning_summary_text.delta", item_id=self._reason["id"],
                                       output_index=self._reason["index"], summary_index=0, delta=rtxt))
            content = delta.get("content")
            if isinstance(content, str) and content:
                events += self._close_reasoning()
                if self._msg is None:
                    mid = _new_id("msg")
                    self._msg = {"id": mid, "index": self._next_index(), "_text": ""}
                    events.append(self._ev("response.output_item.added", output_index=self._msg["index"],
                                           item={"type": "message", "id": mid, "role": "assistant",
                                                 "status": "in_progress", "content": []}))
                    events.append(self._ev("response.content_part.added", item_id=mid,
                                           output_index=self._msg["index"], content_index=0,
                                           part={"type": "output_text", "text": "", "annotations": []}))
                self._msg["_text"] += content
                events.append(self._ev("response.output_text.delta", item_id=self._msg["id"],
                                       output_index=self._msg["index"], content_index=0, delta=content))
            for tc in delta.get("tool_calls") or []:
                events += self._close_reasoning()
                events += self._close_message()
                i = tc.get("index", len(self._tools))
                fn = tc.get("function") or {}
                st = self._tools.get(i)
                if st is None:
                    st = {"index": self._next_index(), "id": _new_id("fc"), "call_id": tc.get("id") or _new_id("call"),
                          "name": fn.get("name") or "", "args": ""}
                    self._tools[i] = st
                    events.append(self._ev("response.output_item.added", output_index=st["index"],
                                           item={"type": "function_call", "id": st["id"], "call_id": st["call_id"],
                                                 "name": st["name"], "arguments": "", "status": "in_progress"}))
                else:
                    if tc.get("id") and not st["call_id"]:
                        st["call_id"] = tc["id"]
                    if fn.get("name") and not st["name"]:
                        st["name"] = fn["name"]
                if fn.get("arguments"):
                    st["args"] += fn["arguments"]
                    events.append(self._ev("response.function_call_arguments.delta", item_id=st["id"],
                                           output_index=st["index"], delta=fn["arguments"]))
        return events

    def _close_tools(self) -> list:
        events = []
        for _, st in sorted(self._tools.items(), key=lambda kv: kv[1]["index"]):
            if self.cache and self._reasoning_all:
                self.cache.put(st["call_id"], self._reasoning_all)
            if st["name"] in self.custom:
                try:
                    inp = json.loads(st["args"] or "{}").get(CUSTOM_TOOL_ARG, "")
                except (ValueError, AttributeError):
                    inp = st["args"]
                item = {"type": "custom_tool_call", "id": st["id"], "call_id": st["call_id"], "name": st["name"],
                        "input": inp if isinstance(inp, str) else json.dumps(inp), "status": "completed"}
            else:
                item = {"type": "function_call", "id": st["id"], "call_id": st["call_id"], "name": st["name"],
                        "arguments": st["args"] or "{}", "status": "completed"}
                events.append(self._ev("response.function_call_arguments.done", item_id=st["id"],
                                       output_index=st["index"], arguments=item["arguments"]))
            self.output.append(item)
            events.append(self._ev("response.output_item.done", output_index=st["index"], item=item))
        self._tools = {}
        return events

    def finish(self) -> list[tuple[str, dict]]:
        if self._done:
            return []
        self._done = True
        events = self.start()
        events += self._close_reasoning()
        events += self._close_message()
        events += self._close_tools()
        events.append(self._ev("response.completed", response=self._resp("completed")))
        return events

    def fail(self, message: str, code: str = "upstream_error") -> list[tuple[str, dict]]:
        self._done = True
        events = self.start()
        r = self._resp("failed")
        r["error"] = {"code": code, "message": message}
        events.append(self._ev("response.failed", response=r))
        return events


class UpstreamStreamError(RuntimeError):
    pass


def _err_message(err: Any) -> str:
    if isinstance(err, dict):
        return str(err.get("message") or err)
    return str(err)


def chat_completion_to_response(data: dict, model: str, custom: set[str] | None = None,
                                cache: ReasoningCache | None = None) -> dict:
    """Non-streaming conversion."""
    tr = ChatStreamTranslator(model, custom, cache)
    tr.feed({"choices": [{"delta": (c.get("message") or {})} | {"index": c.get("index", 0)}
                         for c in data.get("choices") or []], "usage": data.get("usage")})
    tr.finish()
    return tr._resp("completed")


def iter_sse(lines: Iterable[str]) -> Iterator[tuple[str | None, str]]:
    """Parse Server-Sent Events from an iterator of text lines. Yields (event, data)."""
    event, data = None, []
    for raw in lines:
        line = raw.rstrip("\r\n")
        if line == "":
            if data:
                yield event, "\n".join(data)
            event, data = None, []
            continue
        if line.startswith(":"):
            continue
        field, _, value = line.partition(":")
        value = value[1:] if value.startswith(" ") else value
        if field == "event":
            event = value
        elif field == "data":
            data.append(value)
    if data:
        yield event, "\n".join(data)


def sse_encode(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, separators=(',', ':'))}\n\n".encode("utf-8")
