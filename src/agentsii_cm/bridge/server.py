"""Agentsii Bridge: a small local HTTP server (127.0.0.1 only) that lets Codex use
providers it cannot talk to directly:

  * Chat-Completions-only providers  -> translates Responses API <-> Chat Completions
  * Providers needing a custom auth header (e.g. X-API-Key) -> injects the header

Codex authenticates to the bridge with a random per-user bridge token (fetched by
Codex through the helper's `bridge-token` command). The upstream API key is read
from Windows Credential Manager inside the bridge and never leaves this machine
except to the provider itself.
"""
from __future__ import annotations

import hmac
import json
import logging
import os
import ssl
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable

import httpx

from ..models import AUTH_BEARER, AUTH_HEADER, WIRE_RESPONSES, Provider
from ..version import VERSION
from .translate import (ChatStreamTranslator, ReasoningCache, UpstreamStreamError, chat_completion_to_response,
                        iter_sse, responses_to_chat, sse_encode)

log = logging.getLogger("agentsii.bridge")
BRIDGE_APP = "agentsii-bridge"


def make_ssl_context() -> ssl.SSLContext:
    """Prefer the OS trust store (works behind corporate TLS inspection on Windows)."""
    try:
        import truststore

        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    except Exception:  # pragma: no cover
        return ssl.create_default_context()


def upstream_headers(p: Provider, key: str | None) -> dict[str, str]:
    h = {"Content-Type": "application/json", "User-Agent": f"AgentsiiCodexManager/{VERSION}"}
    if key:
        if p.auth_type == AUTH_BEARER:
            h["Authorization"] = f"Bearer {key}"
        elif p.auth_type == AUTH_HEADER and p.auth_header_name:
            h[p.auth_header_name] = key
    return h


class BridgeContext:
    def __init__(self, get_provider: Callable[[str], Provider | None], get_key: Callable[[str], str | None],
                 token: str, port: int, idle_exit: float = 0, client: httpx.Client | None = None):
        self.get_provider = get_provider
        self.get_key = get_key
        self.token = token
        self.port = port
        self.idle_exit = idle_exit
        self.cache = ReasoningCache()
        self.last_activity = time.time()
        self.active = 0
        self.lock = threading.Lock()
        self.client = client or httpx.Client(
            timeout=httpx.Timeout(connect=20.0, read=900.0, write=60.0, pool=30.0),
            verify=make_ssl_context(), follow_redirects=False, trust_env=True)

    def touch(self, delta: int = 0) -> None:
        with self.lock:
            self.last_activity = time.time()
            self.active += delta


def make_handler(ctx: BridgeContext):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = f"AgentsiiBridge/{VERSION}"

        def log_message(self, fmt, *args):  # route to our redacting logger, never stderr
            log.info("%s %s", self.command, self.path.split("?")[0])

        # ---------------------------------------------------------- helpers
        def _json(self, status: int, obj: dict) -> None:
            body = json.dumps(obj).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _error(self, status: int, message: str, typ: str = "bridge_error") -> None:
            self._json(status, {"error": {"message": message, "type": typ, "code": typ}})

        def _chunk(self, data: bytes) -> None:
            if data:
                self.wfile.write(f"{len(data):X}\r\n".encode() + data + b"\r\n")
                self.wfile.flush()

        def _end_chunks(self) -> None:
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()

        def _start_sse(self) -> None:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()

        def _guard(self, need_auth: bool = True) -> bool:
            # Block browsers (DNS-rebinding / CSRF against localhost).
            if self.headers.get("Origin"):
                self._error(403, "Browser requests are not allowed.")
                return False
            host = (self.headers.get("Host") or "").split(":")[0].strip("[]").lower()
            if host not in ("127.0.0.1", "localhost", "::1"):
                self._error(403, "Invalid Host header.")
                return False
            if need_auth:
                auth = self.headers.get("Authorization", "")
                tok = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
                if not tok or not hmac.compare_digest(tok.encode(), ctx.token.encode()):
                    self._error(401, "Missing or invalid Agentsii bridge token.", "invalid_api_key")
                    return False
            return True

        def _route(self) -> tuple[Provider | None, str]:
            parts = self.path.split("?")[0].strip("/").split("/")
            # /p/<provider_id>/v1/<rest...>
            if len(parts) >= 4 and parts[0] == "p" and parts[2] == "v1":
                return ctx.get_provider(parts[1]), "/".join(parts[3:])
            return None, ""

        # ---------------------------------------------------------- verbs
        def do_GET(self):  # noqa: N802
            if self.path.split("?")[0] == "/health":
                if not self._guard(need_auth=False):
                    return
                ctx.touch()
                return self._json(200, {"app": BRIDGE_APP, "version": VERSION, "pid": os.getpid()})
            if not self._guard():
                return
            ctx.touch()
            provider, rest = self._route()
            if provider is None:
                return self._error(404, "Unknown provider. Re-connect it in Agentsii Codex Manager.")
            if rest != "models":
                return self._error(404, "Not found.")
            try:
                r = ctx.client.get(provider.base_url + "/models",
                                   headers=upstream_headers(provider, ctx.get_key(provider.id)), timeout=30)
            except httpx.HTTPError as e:
                return self._error(502, f"Could not reach {provider.name}: {type(e).__name__}")
            body = r.content
            self.send_response(r.status_code)
            self.send_header("Content-Type", r.headers.get("content-type", "application/json"))
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):  # noqa: N802
            path = self.path.split("?")[0]
            if path == "/shutdown":
                if not self._guard():
                    return
                self._json(200, {"ok": True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            if not self._guard():
                return
            ctx.touch(+1)
            try:
                self._post()
            finally:
                ctx.touch(-1)

        def _post(self) -> None:
            provider, rest = self._route()
            if provider is None:
                return self._error(404, "Unknown provider. Re-connect it in Agentsii Codex Manager.")
            if rest != "responses":
                return self._error(404, f"Endpoint /{rest} is not supported by the bridge.")
            try:
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._error(400, "Request body is not valid JSON.")
            if not body.get("model"):
                body["model"] = provider.default_model
            key = ctx.get_key(provider.id) if provider.needs_key else None
            if provider.needs_key and not key:
                return self._error(401, f"No API key is saved for {provider.name}. Add it in Agentsii Codex Manager.",
                                   "invalid_api_key")
            if provider.wire_api == WIRE_RESPONSES:
                return self._passthrough(provider, key, body)
            return self._translate(provider, key, body)

        def _passthrough(self, p: Provider, key: str | None, body: dict) -> None:
            try:
                with ctx.client.stream("POST", p.base_url + "/responses", json=body,
                                       headers=upstream_headers(p, key)) as r:
                    self.send_response(r.status_code)
                    self.send_header("Content-Type", r.headers.get("content-type", "application/json"))
                    self.send_header("Transfer-Encoding", "chunked")
                    self.end_headers()
                    for data in r.iter_raw():
                        self._chunk(data)
                    self._end_chunks()
            except httpx.HTTPError as e:
                self._error(502, f"Could not reach {p.name}: {type(e).__name__}")

        def _translate(self, p: Provider, key: str | None, body: dict) -> None:
            chat_req, custom = responses_to_chat(body, ctx.cache)
            model = chat_req.get("model") or p.default_model
            headers = upstream_headers(p, key)
            url = p.base_url + "/chat/completions"
            stream = chat_req.get("stream", False)
            if not stream:
                try:
                    r = ctx.client.post(url, json=chat_req, headers=headers)
                except httpx.HTTPError as e:
                    return self._error(502, f"Could not reach {p.name}: {type(e).__name__}")
                if r.status_code != 200:
                    return self._upstream_error(r.status_code, r.text, p)
                return self._json(200, chat_completion_to_response(r.json(), model, custom, ctx.cache))

            tr = ChatStreamTranslator(model, custom, ctx.cache)
            started = False
            for attempt in range(2):
                try:
                    with ctx.client.stream("POST", url, json=chat_req, headers=headers) as r:
                        if r.status_code != 200:
                            text = r.read().decode("utf-8", "replace")
                            if attempt == 0 and r.status_code in (400, 422) and "stream_options" in text:
                                chat_req.pop("stream_options", None)
                                continue
                            return self._upstream_error(r.status_code, text, p)
                        self._start_sse()
                        started = True
                        ctype = r.headers.get("content-type", "")
                        if "event-stream" not in ctype:
                            data = json.loads(r.read() or b"{}")
                            for ev, d in tr.feed({"choices": [{"delta": (c.get("message") or {})}
                                                              for c in data.get("choices") or []],
                                                  "usage": data.get("usage")}):
                                self._chunk(sse_encode(ev, d))
                        else:
                            for _ev, data in iter_sse(r.iter_lines()):
                                if data.strip() == "[DONE]":
                                    break
                                try:
                                    chunk = json.loads(data)
                                except json.JSONDecodeError:
                                    continue
                                for ev, d in tr.feed(chunk):
                                    self._chunk(sse_encode(ev, d))
                        for ev, d in tr.finish():
                            self._chunk(sse_encode(ev, d))
                        self._end_chunks()
                        return
                except UpstreamStreamError as e:
                    msg = str(e)
                except (httpx.HTTPError, OSError, ValueError) as e:
                    msg = f"Connection to {p.name} failed: {type(e).__name__}"
                if not started:
                    return self._error(502, msg)
                try:
                    for ev, d in tr.fail(msg):
                        self._chunk(sse_encode(ev, d))
                    self._end_chunks()
                except OSError:
                    pass
                return

        def _upstream_error(self, status: int, text: str, p: Provider) -> None:
            try:
                msg = json.loads(text).get("error", {})
                msg = msg.get("message") if isinstance(msg, dict) else str(msg)
            except (ValueError, AttributeError):
                msg = text[:500]
            hint = {401: "The API key was rejected.", 403: "Access denied by the provider.",
                    404: "Endpoint or model not found at the provider.", 429: "Rate limited by the provider."}
            self._error(status if 400 <= status < 600 else 502,
                        f"{p.name}: {hint.get(status, 'Upstream error.')} {msg or ''}".strip(), "upstream_error")

    return Handler


class BridgeServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = sys.platform != "win32"


def serve(ctx: BridgeContext, host: str = "127.0.0.1") -> None:
    srv = BridgeServer((host, ctx.port), make_handler(ctx))
    log.info("Agentsii Bridge listening on %s:%s", host, ctx.port)
    if ctx.idle_exit > 0:
        def watchdog():
            while True:
                time.sleep(30)
                with ctx.lock:
                    idle = time.time() - ctx.last_activity
                    busy = ctx.active > 0
                if not busy and idle > ctx.idle_exit:
                    log.info("Idle for %.0fs, exiting.", idle)
                    srv.shutdown()
                    return
        threading.Thread(target=watchdog, daemon=True).start()
    try:
        srv.serve_forever(poll_interval=0.5)
    finally:
        srv.server_close()


def start_in_thread(ctx: BridgeContext) -> tuple[BridgeServer, threading.Thread]:
    srv = BridgeServer(("127.0.0.1", ctx.port), make_handler(ctx))
    t = threading.Thread(target=srv.serve_forever, kwargs={"poll_interval": 0.2}, daemon=True)
    t.start()
    return srv, t


# ------------------------------------------------------------------------ lifecycle helpers
def health(port: int, timeout: float = 1.5) -> dict | None:
    try:
        r = httpx.get(f"http://127.0.0.1:{port}/health", timeout=timeout, trust_env=False)
        if r.status_code == 200 and r.json().get("app") == BRIDGE_APP:
            return r.json()
    except (httpx.HTTPError, ValueError):
        pass
    return None


def stop(port: int, token: str) -> bool:
    try:
        r = httpx.post(f"http://127.0.0.1:{port}/shutdown", headers={"Authorization": f"Bearer {token}"},
                       timeout=3, trust_env=False)
        return r.status_code == 200
    except httpx.HTTPError:
        return False


def spawn_detached(argv: list[str]) -> None:
    kwargs: dict = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL,
                    "close_fds": True}
    if os.name == "nt":
        DETACHED, NEW_GROUP, BREAKAWAY = 0x00000008, 0x00000200, 0x01000000
        try:
            subprocess.Popen(argv, creationflags=DETACHED | NEW_GROUP | BREAKAWAY, **kwargs)
            return
        except OSError:
            subprocess.Popen(argv, creationflags=DETACHED | NEW_GROUP, **kwargs)
            return
    subprocess.Popen(argv, start_new_session=True, **kwargs)


def ensure_running(port: int, launcher_argv: list[str], wait: float = 12.0) -> bool:
    if health(port):
        return True
    spawn_detached(launcher_argv)
    deadline = time.time() + wait
    while time.time() < deadline:
        time.sleep(0.3)
        if health(port, timeout=1.0):
            return True
    return False
