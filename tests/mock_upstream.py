"""A tiny fake OpenAI-compatible provider used by the tests."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API_KEY = "sk-test-0123456789abcdef"


class MockState:
    def __init__(self):
        self.requests = []
        self.mode = "text"  # text | tool | reasoning_tool | error401 | no_stream_options
        self.supports_responses = False
        self.reply = "OK"


def make_server(state: MockState):
    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):
            pass

        def _auth_ok(self):
            return self.headers.get("Authorization") == f"Bearer {API_KEY}" or \
                self.headers.get("X-API-Key") == API_KEY

        def _send(self, status, obj):
            b = json.dumps(obj).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            if not self._auth_ok():
                return self._send(401, {"error": {"message": "Invalid API key"}})
            if self.path.endswith("/models"):
                return self._send(200, {"data": [{"id": "mock-chat"}, {"id": "mock-reasoner"}]})
            self._send(404, {"error": {"message": "nope"}})

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            state.requests.append({"path": self.path, "body": body, "headers": dict(self.headers)})
            if not self._auth_ok() or state.mode == "error401":
                return self._send(401, {"error": {"message": "Invalid API key"}})
            if self.path.endswith("/responses"):
                if not state.supports_responses:
                    return self._send(404, {"error": {"message": "Not found"}})
                return self._responses(body)
            if not self.path.endswith("/chat/completions"):
                return self._send(404, {"error": {"message": "Not found"}})
            if state.mode == "no_stream_options" and "stream_options" in body:
                return self._send(400, {"error": {"message": "unknown field stream_options"}})
            wants_tool = bool(body.get("tools")) and state.mode in ("tool", "reasoning_tool")
            if not body.get("stream"):
                msg = {"role": "assistant", "content": state.reply}
                if wants_tool:
                    msg = {"role": "assistant", "content": None, "tool_calls": [
                        {"id": "call_1", "type": "function",
                         "function": {"name": body["tools"][0]["function"]["name"], "arguments": '{"value":"hello"}'}}]}
                return self._send(200, {"choices": [{"index": 0, "message": msg, "finish_reason": "stop"}],
                                        "usage": {"prompt_tokens": 5, "completion_tokens": 1, "total_tokens": 6}})
            chunks = []
            if state.mode == "reasoning_tool":
                chunks.append({"choices": [{"index": 0, "delta": {"reasoning_content": "Let me think. "}}]})
                chunks.append({"choices": [{"index": 0, "delta": {"reasoning_content": "Run ls."}}]})
            if wants_tool:
                name = body["tools"][0]["function"]["name"]
                chunks.append({"choices": [{"index": 0, "delta": {"tool_calls": [
                    {"index": 0, "id": "call_abc", "type": "function", "function": {"name": name, "arguments": ""}}]}}]})
                chunks.append({"choices": [{"index": 0, "delta": {"tool_calls": [
                    {"index": 0, "function": {"arguments": '{"command": ["ls"'}}]}}]})
                chunks.append({"choices": [{"index": 0, "delta": {"tool_calls": [
                    {"index": 0, "function": {"arguments": "]}"}}]}}]})
                chunks.append({"choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}]})
            else:
                for piece in [state.reply[:1], state.reply[1:]]:
                    chunks.append({"choices": [{"index": 0, "delta": {"content": piece}}]})
                chunks.append({"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]})
            chunks.append({"choices": [], "usage": {"prompt_tokens": 11, "completion_tokens": 3, "total_tokens": 14}})
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Connection", "close")
            self.end_headers()
            for c in chunks:
                self.wfile.write(f"data: {json.dumps(c)}\n\n".encode())
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
            self.close_connection = True

        def _responses(self, body):
            item = {"type": "message", "id": "msg_1", "role": "assistant", "status": "completed",
                    "content": [{"type": "output_text", "text": state.reply, "annotations": []}]}
            usage = {"input_tokens": 5, "input_tokens_details": {"cached_tokens": 0}, "output_tokens": 2,
                     "output_tokens_details": {"reasoning_tokens": 0}, "total_tokens": 7}
            events = [
                {"type": "response.created", "response": {"id": "r1", "status": "in_progress", "output": []}},
                {"type": "response.output_item.added", "output_index": 0,
                 "item": {**item, "status": "in_progress", "content": []}},
                {"type": "response.output_text.delta", "item_id": "msg_1", "output_index": 0, "content_index": 0,
                 "delta": state.reply},
                {"type": "response.output_item.done", "output_index": 0, "item": item},
                {"type": "response.completed", "response": {"id": "r1", "status": "completed", "output": [item],
                                                            "usage": usage}},
            ]
            if not body.get("stream"):
                out = [{"type": "message", "content": [{"type": "output_text", "text": state.reply}]}]
                if body.get("tools"):
                    out = [{"type": "function_call", "name": body["tools"][0]["name"], "arguments": "{}",
                            "call_id": "c1"}]
                return self._send(200, {"id": "r1", "output": out})
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Connection", "close")
            self.end_headers()
            for e in events:
                self.wfile.write(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n".encode())
            self.wfile.flush()
            self.close_connection = True

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv
