"""agentsii-helper: the small console program Codex runs to obtain credentials.

    agentsii-helper token <provider_id>   print that provider's API key (from Credential Manager)
    agentsii-helper bridge-token          make sure the local bridge runs, print the bridge token
    agentsii-helper bridge [--port N]     run the Agentsii Bridge in the foreground
    agentsii-helper bridge-stop           stop a running bridge
    agentsii-helper version

Contract (Codex command-backed auth): no stdin, token on stdout, exit code 0.
Errors go to stderr only and never contain secrets.
"""
from __future__ import annotations

import argparse
import sys

from .version import VERSION

EXIT_OK, EXIT_ERR, EXIT_NO_KEY = 0, 1, 2


def _launcher_argv(extra: list[str]) -> list[str]:
    if getattr(sys, "frozen", False):
        return [sys.executable, *extra]
    return [sys.executable, "-m", "agentsii_cm.helper_cli", *extra]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="agentsii-helper", add_help=True)
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("token")
    t.add_argument("provider_id")
    sub.add_parser("bridge-token")
    b = sub.add_parser("bridge")
    b.add_argument("--port", type=int, default=None)
    b.add_argument("--idle-exit", type=float, default=4 * 3600)
    sub.add_parser("bridge-stop")
    sub.add_parser("version")
    args = ap.parse_args(argv)

    if args.cmd == "version":
        print(VERSION)
        return EXIT_OK

    from .keystore import SecretStore, SecretStoreError
    from .settings import AppSettings

    try:
        keys = SecretStore()
    except Exception as e:  # pragma: no cover
        print(f"agentsii-helper: credential store unavailable: {type(e).__name__}", file=sys.stderr)
        return EXIT_ERR

    if args.cmd == "token":
        try:
            key = keys.get_key(args.provider_id)
        except SecretStoreError as e:
            print(f"agentsii-helper: {e}", file=sys.stderr)
            return EXIT_ERR
        if not key:
            print(f"agentsii-helper: no API key saved for provider '{args.provider_id}'. "
                  "Open Agentsii Codex Manager and add it.", file=sys.stderr)
            return EXIT_NO_KEY
        sys.stdout.write(key + "\n")
        sys.stdout.flush()
        return EXIT_OK

    settings = AppSettings.load()
    port = getattr(args, "port", None) or settings.bridge_port

    if args.cmd == "bridge-token":
        from .bridge.server import ensure_running

        token = keys.get_or_create_bridge_token()
        if not ensure_running(port, _launcher_argv(["bridge", "--port", str(port)])):
            print(f"agentsii-helper: the Agentsii Bridge could not start on 127.0.0.1:{port} "
                  "(port in use?). Change the port in Agentsii Codex Manager > Settings.", file=sys.stderr)
            return EXIT_ERR
        sys.stdout.write(token + "\n")
        sys.stdout.flush()
        return EXIT_OK

    if args.cmd == "bridge-stop":
        from .bridge.server import stop

        return EXIT_OK if stop(port, keys.get_or_create_bridge_token()) else EXIT_ERR

    if args.cmd == "bridge":
        from .bridge.server import BridgeContext, health, serve
        from .logging_setup import register_secret, setup_logging
        from .store import ProviderStore

        setup_logging("bridge")
        if health(port):
            return EXIT_OK  # already running
        store = ProviderStore()
        token = keys.get_or_create_bridge_token()
        register_secret(token)

        def get_key(pid: str) -> str | None:
            k = keys.get_key(pid)
            register_secret(k)
            return k

        ctx = BridgeContext(store.get, get_key, token, port, idle_exit=args.idle_exit)
        try:
            serve(ctx)
        except OSError as e:
            print(f"agentsii-helper: cannot listen on 127.0.0.1:{port}: {e.strerror}", file=sys.stderr)
            return EXIT_ERR
        return EXIT_OK
    return EXIT_ERR


if __name__ == "__main__":
    sys.exit(main())
