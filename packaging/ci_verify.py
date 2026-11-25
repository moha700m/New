"""Post-build verification on a real Windows machine (GitHub Actions windows runner).

Uses the *built* executables, the *real* Windows Credential Manager and, when available,
the *real* Codex CLI against a local mock provider:

 1. GUI exe --selftest (all 8 pages, EN + AR) and helper bundled.
 2. Credential Manager round trip through the frozen agentsii-helper.exe.
 3. Bridge started by the frozen helper, health check, stop.
 4. Codex CLI end-to-end (if `codex` is on PATH):
      a) Chat-Completions provider through the Agentsii Bridge
      b) Responses provider connected directly with command-backed auth
Writes a JSON report to dist/release/verify-report.json; exits non-zero on failure.
"""
from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))

from agentsii_cm.version import VERSION  # noqa: E402

report: dict = {"version": VERSION, "checks": []}


def check(name: str, ok: bool, detail: str = "") -> None:
    report["checks"].append({"name": name, "ok": bool(ok), "detail": detail[-2500:]})
    print(("PASS " if ok else "FAIL ") + name + (f": {detail[-600:]}" if detail and not ok else ""), flush=True)


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def main() -> int:
    work = Path(tempfile.mkdtemp(prefix="agentsii-ci-"))
    os.environ["AGENTSII_CM_HOME"] = str(work / "home")
    os.environ["CODEX_HOME"] = str(work / "codex")
    (work / "codex").mkdir(parents=True)
    os.environ["NO_PROXY"] = "127.0.0.1,localhost"
    app_exe = DIST / "AgentsiiCodexManager" / "AgentsiiCodexManager.exe"
    helper = DIST / "agentsii-helper.exe"

    # 1 -------------------------------------------------------------- GUI selftest
    out = work / "selftest.json"
    p = subprocess.run([str(app_exe), "--selftest", "--selftest-out", str(out)], timeout=180)
    data = json.loads(out.read_text()) if out.is_file() else {"ok": False, "error": f"exit {p.returncode}"}
    check("gui_selftest", data.get("ok") and data.get("helper_bundled"), json.dumps(data))
    check("gui_keyring_backend_is_windows", "Windows" in str(data.get("keyring")), str(data.get("keyring")))
    portable = next(DIST.glob("AgentsiiCodexManager-Portable-*.exe"), None)
    if portable:
        out2 = work / "selftest-portable.json"
        subprocess.run([str(portable), "--selftest", "--selftest-out", str(out2)], timeout=240)
        d2 = json.loads(out2.read_text()) if out2.is_file() else {"ok": False}
        check("portable_selftest", d2.get("ok") and d2.get("helper_bundled"), json.dumps(d2))

    # 2 -------------------------------------------------------------- Credential Manager via frozen helper
    import keyring
    from keyring.backends.Windows import WinVaultKeyring

    keyring.set_keyring(WinVaultKeyring())
    from agentsii_cm.keystore import SecretStore

    keys = SecretStore()
    secret = "sk-ci-" + os.urandom(8).hex()
    keys.set_key("ci-test", secret)
    r = subprocess.run([str(helper), "token", "ci-test"], capture_output=True, text=True, timeout=60)
    check("helper_reads_credential_manager", r.returncode == 0 and r.stdout.strip() == secret, r.stderr)
    r = subprocess.run([str(helper), "token", "does-not-exist"], capture_output=True, text=True, timeout=60)
    check("helper_missing_key_exit_2", r.returncode == 2 and not r.stdout, r.stderr)
    keys.delete_key("ci-test")

    # 3 -------------------------------------------------------------- bridge via frozen helper
    from agentsii_cm.settings import AppSettings

    s = AppSettings.load()
    s.bridge_port = free_port()
    s.save()
    t0 = time.time()
    r = subprocess.run([str(helper), "bridge-token"], capture_output=True, text=True, timeout=90)
    check("helper_bridge_token_starts_bridge", r.returncode == 0 and r.stdout.strip().startswith("agb_"),
          f"{r.stderr} ({time.time() - t0:.1f}s)")
    from agentsii_cm.bridge.server import health

    check("bridge_health", bool(health(s.bridge_port)))
    r = subprocess.run([str(helper), "bridge-stop"], capture_output=True, text=True, timeout=30)
    time.sleep(1.5)
    check("bridge_stop", r.returncode == 0 and not health(s.bridge_port), r.stderr)

    # 4 -------------------------------------------------------------- real Codex CLI end-to-end
    codex = shutil.which("codex.cmd") or shutil.which("codex")
    if not codex:
        check("codex_cli_present", False, "codex CLI not installed on runner")
    else:
        ver = subprocess.run([codex, "--version"], capture_output=True, text=True, timeout=60)
        report["codex_version"] = (ver.stdout or ver.stderr).strip()
        print("Codex:", report["codex_version"], flush=True)
        codex_e2e(codex, helper)

    # leave the machine clean
    for pid in ("ci-chat", "ci-resp"):
        keys.delete_key(pid)
    try:
        from agentsii_cm.bridge.server import stop

        stop(AppSettings.load().bridge_port, keys.get_or_create_bridge_token())
    except Exception:  # noqa: BLE001
        pass
    report["ok"] = all(c["ok"] for c in report["checks"])
    (DIST / "release").mkdir(parents=True, exist_ok=True)
    (DIST / "release" / "verify-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return 0 if report["ok"] else 1


def codex_e2e(codex: str, helper: Path) -> None:
    from agentsii_cm import core as core_mod
    from agentsii_cm.models import WIRE_CHAT, WIRE_RESPONSES, Provider
    from agentsii_cm.tester import CODEX_MARKER, verify_with_codex
    from tests.mock_upstream import API_KEY, MockState, make_server

    st = MockState()
    st.reply = CODEX_MARKER
    st.supports_responses = True
    up = make_server(st)
    base = f"http://127.0.0.1:{up.server_address[1]}/v1"
    bin_helper = core_mod.paths.installed_helper_path()
    shutil.copy2(helper, bin_helper)

    class CICore(core_mod.AppCore):
        def helper_path(self):
            return bin_helper

        def deploy_helper(self):
            return bin_helper

    c = CICore()
    c.save_provider(Provider(id="ci-chat", name="CI Chat", base_url=base, wire_api=WIRE_CHAT,
                             models=["mock-chat"], default_model="mock-chat"), API_KEY)
    c.save_provider(Provider(id="ci-resp", name="CI Responses", base_url=base, wire_api=WIRE_RESPONSES,
                             models=["mock-chat"], default_model="mock-chat"), API_KEY)
    for pid in ("ci-chat", "ci-resp"):
        try:
            res = c.connect(pid, make_default=(pid == "ci-chat"))
            check(f"connect_{pid}", res.ok, res.error + " | " + "; ".join(x.message for x in res.checks))
            n0 = len(st.requests)
            ok, msg = verify_with_codex(codex, pid, "mock-chat", timeout=240)
            paths_seen = sorted({r["path"] for r in st.requests[n0:]})
            check(f"codex_exec_{pid}", ok, f"{msg}\nupstream paths: {paths_seen}")
        except Exception:  # noqa: BLE001
            check(f"codex_exec_{pid}", False, traceback.format_exc())
    report["config_toml"] = (Path(os.environ["CODEX_HOME"]) / "config.toml").read_text()
    up.shutdown()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        report["fatal"] = traceback.format_exc()
        (DIST / "release").mkdir(parents=True, exist_ok=True)
        (DIST / "release" / "verify-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        sys.exit(1)
