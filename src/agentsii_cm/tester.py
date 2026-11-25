"""Provider connection tests.

HTTP 200 alone does not prove Codex compatibility, so the tester also checks
streaming, the chosen protocol and tool (function) calling, which Codex needs.
The final proof is `verify_with_codex`, which runs the real Codex CLI.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from typing import Callable
from urllib.parse import urlparse

import httpx

from .bridge.server import make_ssl_context, upstream_headers
from .bridge.translate import iter_sse
from .models import WIRE_CHAT, WIRE_RESPONSES, Provider
from .util import no_window_flags

PASS, WARN, FAIL, SKIP = "pass", "warn", "fail", "skip"
PING_TOOL = "agentsii_ping"


@dataclass
class CheckResult:
    key: str
    status: str
    message: str
    detail: str = ""


@dataclass
class TestReport:
    provider_id: str
    model: str
    checks: list[CheckResult] = field(default_factory=list)
    detected_models: list[str] = field(default_factory=list)
    elapsed: float = 0.0

    @property
    def overall(self) -> str:
        st = [c.status for c in self.checks]
        if FAIL in st:
            return FAIL
        if WARN in st:
            return WARN
        return PASS

    def add(self, key: str, status: str, message: str, detail: str = "") -> CheckResult:
        c = CheckResult(key, status, message, detail[:600])
        self.checks.append(c)
        return c


def _err_text(r: httpx.Response) -> str:
    try:
        e = r.json().get("error")
        if isinstance(e, dict):
            return str(e.get("message") or e)
        if e:
            return str(e)
    except (ValueError, AttributeError):
        pass
    return r.text[:300]


def _http_failure(status: int) -> str:
    return {
        400: "The provider rejected the request (400). The model ID or request format may be wrong.",
        401: "The API key was rejected (401). Check that it is correct and active.",
        402: "The provider reports a billing problem (402): add credit to the account.",
        403: "Access denied (403). The key may lack permission for this model.",
        404: "Endpoint not found (404). Check the Base URL (usually ends with /v1) and the protocol.",
        408: "The provider timed out (408).",
        429: "Rate limited or out of quota (429).",
    }.get(status, f"The provider returned HTTP {status}.")


class ConnectionTester:
    def __init__(self, provider: Provider, api_key: str | None, timeout: float = 30.0,
                 client: httpx.Client | None = None, progress: Callable[[str], None] | None = None):
        self.p = provider
        self.key = api_key
        self.timeout = timeout
        self.client = client or httpx.Client(timeout=httpx.Timeout(timeout, connect=min(timeout, 15.0)),
                                             verify=make_ssl_context(), trust_env=True)
        self.progress = progress or (lambda s: None)

    @property
    def headers(self) -> dict:
        return upstream_headers(self.p, self.key)

    # ----------------------------------------------------------------- steps
    def check_url(self, rep: TestReport) -> bool:
        u = urlparse(self.p.base_url)
        if u.scheme not in ("http", "https") or not u.hostname:
            rep.add("url", FAIL, "The Base URL is not a valid http(s) URL.")
            return False
        try:
            socket.getaddrinfo(u.hostname, u.port or (443 if u.scheme == "https" else 80))
        except socket.gaierror:
            rep.add("url", FAIL, f"The host '{u.hostname}' could not be resolved. Check the URL and your internet connection.")
            return False
        rep.add("url", PASS, f"Base URL is valid and {u.hostname} resolves.")
        return True

    def _request(self, rep: TestReport, key: str, method: str, url: str, **kw) -> httpx.Response | None:
        try:
            return self.client.request(method, url, headers=self.headers, **kw)
        except httpx.TimeoutException:
            rep.add(key, FAIL, f"Timed out after {self.timeout:.0f}s waiting for the provider.")
        except httpx.ConnectError as e:
            msg = str(e)
            if "CERTIFICATE" in msg.upper() or "SSL" in msg.upper():
                rep.add(key, FAIL, "TLS/SSL certificate error while connecting.", msg)
            else:
                rep.add(key, FAIL, "Could not connect to the provider (network error or firewall).", msg)
        except httpx.HTTPError as e:
            rep.add(key, FAIL, f"Connection error: {type(e).__name__}", str(e))
        return None

    def check_models(self, rep: TestReport) -> None:
        self.progress("models")
        r = self._request(rep, "auth", "GET", self.p.base_url + "/models")
        if r is None:
            return
        if r.status_code in (401, 403):
            rep.add("auth", FAIL, _http_failure(r.status_code), _err_text(r))
            return
        if r.status_code != 200:
            rep.add("auth", WARN, f"The /models endpoint returned HTTP {r.status_code}; the key will be checked "
                                  "by the generation test.", _err_text(r))
            return
        try:
            data = r.json()
            items = data.get("data") if isinstance(data, dict) else data
            ids = [str(m.get("id")) for m in items or [] if isinstance(m, dict) and m.get("id")]
        except (ValueError, AttributeError):
            ids = []
        rep.detected_models = ids
        rep.add("auth", PASS, "The provider accepted the request." if self.p.needs_key else "Endpoint reachable.")
        if ids:
            if rep.model in ids:
                rep.add("model", PASS, f"Model '{rep.model}' is listed by the provider.")
            else:
                rep.add("model", WARN, f"Model '{rep.model}' is not in the provider's list of {len(ids)} models. "
                                       "Check the spelling (the generation test below is authoritative).")

    def check_responses(self, rep: TestReport) -> None:
        self.progress("responses")
        body = {"model": rep.model, "input": "Reply with the single word: OK", "stream": True,
                "max_output_tokens": 64}
        t0 = time.time()
        try:
            with self.client.stream("POST", self.p.base_url + "/responses", headers=self.headers, json=body) as r:
                if r.status_code != 200:
                    r.read()
                    st = FAIL
                    msg = _http_failure(r.status_code)
                    if r.status_code in (404, 405):
                        msg = ("This provider does not offer the Responses API at this URL. "
                               "Switch the protocol to 'Chat Completions' (Agentsii Bridge).")
                    rep.add("protocol", st, msg, _err_text(r))
                    return
                completed, text = False, ""
                for ev, data in iter_sse(r.iter_lines()):
                    try:
                        d = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    typ = d.get("type") or ev
                    if typ == "response.output_text.delta":
                        text += d.get("delta", "")
                    elif typ == "response.completed":
                        completed = True
                    elif typ in ("response.failed", "error"):
                        rep.add("protocol", FAIL, "The provider reported an error while streaming.", json.dumps(d)[:400])
                        return
        except httpx.TimeoutException:
            rep.add("protocol", FAIL, "Timed out while streaming from the Responses API.")
            return
        except httpx.HTTPError as e:
            rep.add("protocol", FAIL, f"Connection error: {type(e).__name__}", str(e))
            return
        if completed:
            rep.add("protocol", PASS, f"Responses API streaming works ({time.time() - t0:.1f}s).", text[:120])
        else:
            rep.add("protocol", WARN, "Stream ended without 'response.completed'; Codex may report errors.")

    def check_chat(self, rep: TestReport) -> None:
        self.progress("chat")
        body = {"model": rep.model, "messages": [{"role": "user", "content": "Reply with the single word: OK"}],
                "stream": True, "max_tokens": 64}
        t0 = time.time()
        try:
            with self.client.stream("POST", self.p.base_url + "/chat/completions", headers=self.headers,
                                    json=body) as r:
                if r.status_code != 200:
                    r.read()
                    msg = _http_failure(r.status_code)
                    if r.status_code in (404, 405):
                        msg = "Chat Completions endpoint not found at this URL. Check the Base URL."
                    rep.add("protocol", FAIL, msg, _err_text(r))
                    return
                chunks, text, done = 0, "", False
                if "event-stream" not in r.headers.get("content-type", ""):
                    data = json.loads(r.read() or b"{}")
                    text = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
                    rep.add("protocol", WARN, "The provider ignored streaming and returned one response; "
                                              "the bridge handles this but output appears all at once.", text[:120])
                    return
                for _ev, data in iter_sse(r.iter_lines()):
                    if data.strip() == "[DONE]":
                        done = True
                        break
                    try:
                        d = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if d.get("error"):
                        rep.add("protocol", FAIL, "The provider reported an error while streaming.", json.dumps(d)[:400])
                        return
                    chunks += 1
                    for c in d.get("choices") or []:
                        text += (c.get("delta") or {}).get("content") or ""
        except httpx.TimeoutException:
            rep.add("protocol", FAIL, "Timed out while streaming from Chat Completions.")
            return
        except httpx.HTTPError as e:
            rep.add("protocol", FAIL, f"Connection error: {type(e).__name__}", str(e))
            return
        if chunks:
            rep.add("protocol", PASS, f"Chat Completions streaming works ({time.time() - t0:.1f}s)"
                                      f"{'' if done else ', no [DONE] marker'}.", text[:120])
        else:
            rep.add("protocol", FAIL, "The stream contained no data.")

    def check_tools(self, rep: TestReport) -> None:
        """Codex works by calling tools (shell, apply_patch...). Verify function calling."""
        self.progress("tools")
        prompt = f"Call the {PING_TOOL} tool with value 'hello'. Do not answer in text."
        params = {"type": "object", "properties": {"value": {"type": "string"}}, "required": ["value"]}
        if self.p.wire_api == WIRE_RESPONSES:
            body = {"model": rep.model, "input": prompt, "max_output_tokens": 256,
                    "tools": [{"type": "function", "name": PING_TOOL, "description": "Connectivity test.",
                               "parameters": params}]}
            r = self._request(rep, "tools", "POST", self.p.base_url + "/responses", json=body)
            if r is None:
                return
            ok = r.status_code == 200 and any(
                isinstance(o, dict) and o.get("type") == "function_call" for o in (r.json().get("output") or []))
        else:
            body = {"model": rep.model, "messages": [{"role": "user", "content": prompt}], "max_tokens": 256,
                    "tools": [{"type": "function", "function": {"name": PING_TOOL, "description": "Connectivity test.",
                                                                "parameters": params}}]}
            r = self._request(rep, "tools", "POST", self.p.base_url + "/chat/completions", json=body)
            if r is None:
                return
            try:
                ok = r.status_code == 200 and bool(
                    ((r.json().get("choices") or [{}])[0].get("message") or {}).get("tool_calls"))
            except (ValueError, AttributeError):
                ok = False
        if ok:
            rep.add("tools", PASS, "Tool (function) calling works — required for Codex to edit files and run commands.")
        elif r.status_code != 200:
            rep.add("tools", FAIL, "The provider rejected a request with tools: this model may not support "
                                   "function calling, which Codex requires.", _err_text(r))
        else:
            rep.add("tools", WARN, "The model answered without calling the tool. It may not support function "
                                   "calling reliably; Codex could be limited to chat.")

    # ----------------------------------------------------------------- run
    def run(self, model: str | None = None, include_tools: bool = True) -> TestReport:
        t0 = time.time()
        rep = TestReport(self.p.id, model or self.p.default_model)
        if self.p.needs_key and not self.key:
            rep.add("auth", FAIL, "No API key is saved for this provider.")
            return rep
        if self.check_url(rep):
            self.check_models(rep)
            if not any(c.key == "auth" and c.status == FAIL for c in rep.checks):
                if self.p.wire_api == WIRE_RESPONSES:
                    self.check_responses(rep)
                else:
                    self.check_chat(rep)
                if include_tools and not any(c.key == "protocol" and c.status == FAIL for c in rep.checks):
                    self.check_tools(rep)
        rep.elapsed = time.time() - t0
        return rep

    def detect_protocols(self, model: str) -> dict[str, bool]:
        """Probe which protocols the provider supports for this model."""
        out = {}
        for wire in (WIRE_RESPONSES, WIRE_CHAT):
            p = Provider.from_dict({**self.p.to_dict(), "wire_api": wire})
            t = ConnectionTester(p, self.key, self.timeout, self.client)
            rep = TestReport(p.id, model)
            t.check_responses(rep) if wire == WIRE_RESPONSES else t.check_chat(rep)
            out[wire] = any(c.key == "protocol" and c.status in (PASS, WARN) for c in rep.checks)
        return out


# --------------------------------------------------------------------- real Codex check
# The expected answer never appears in the prompt, so an echoed prompt cannot pass.
CODEX_PROMPT = "Compute 17*3. Reply only with the word AGENTSII, a hyphen, and the number. Do not run any commands."
CODEX_MARKER = "AGENTSII-51"


def verify_with_codex(cli_path: str, provider_id: str, model: str, timeout: float = 240.0) -> tuple[bool, str]:
    """Run a real one-shot Codex request through the configured provider."""
    with tempfile.TemporaryDirectory(prefix="agentsii-codex-check-") as wd:
        argv = [cli_path, "exec", "--skip-git-repo-check", "--sandbox", "read-only",
                "-c", f"model_provider={provider_id}", "-m", model,
                CODEX_PROMPT]
        try:
            r = subprocess.run(argv, cwd=wd, capture_output=True, text=True, timeout=timeout,
                               stdin=subprocess.DEVNULL, creationflags=no_window_flags(),
                               env={**os.environ, "NO_COLOR": "1"}, encoding="utf-8", errors="replace")
        except subprocess.TimeoutExpired:
            return False, f"Codex did not finish within {timeout:.0f}s."
        except OSError as e:
            return False, f"Could not start Codex: {e}"
        out = (r.stdout or "") + "\n" + (r.stderr or "")
        if CODEX_MARKER in out.replace(" ", ""):
            return True, "Codex answered through this provider."
        tail = "\n".join(line for line in out.strip().splitlines()[-12:])
        return False, tail or f"Codex exited with code {r.returncode}."
