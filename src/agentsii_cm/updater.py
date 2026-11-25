"""Update check / download / install.

The manifest is a static JSON file published next to the download page:

    {"version": "1.0.1", "released": "2026-12-01", "notes": {"en": "...", "ar": "..."},
     "installer": {"url": "https://...exe", "sha256": "...", "size": 123},
     "portable":  {"url": "https://...exe", "sha256": "...", "size": 123}}

Only a plain GET is made. Downloads must be HTTPS and must match the SHA-256 in the
manifest before anything is run. User data lives in %APPDATA% and is not touched by
the installer, so settings survive updates.
"""
from __future__ import annotations

import hashlib
import os
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

import httpx

from .bridge.server import make_ssl_context
from .util import parse_version
from .version import VERSION


class UpdateError(RuntimeError):
    pass


@dataclass
class UpdateInfo:
    version: str
    notes_en: str
    notes_ar: str
    installer_url: str
    installer_sha256: str
    installer_size: int
    portable_url: str = ""
    portable_sha256: str = ""
    released: str = ""

    @property
    def newer(self) -> bool:
        return parse_version(self.version) > parse_version(VERSION)


def parse_manifest(data: dict) -> UpdateInfo:
    try:
        inst = data["installer"]
        info = UpdateInfo(
            version=str(data["version"]), released=str(data.get("released", "")),
            notes_en=str((data.get("notes") or {}).get("en", "")), notes_ar=str((data.get("notes") or {}).get("ar", "")),
            installer_url=str(inst["url"]), installer_sha256=str(inst["sha256"]).lower(),
            installer_size=int(inst.get("size") or 0),
            portable_url=str((data.get("portable") or {}).get("url", "")),
            portable_sha256=str((data.get("portable") or {}).get("sha256", "")).lower(),
        )
    except (KeyError, TypeError, ValueError) as e:
        raise UpdateError(f"The update manifest is malformed ({e}).") from e
    if urlparse(info.installer_url).scheme != "https":
        raise UpdateError("The update URL is not HTTPS; refusing to use it.")
    if len(info.installer_sha256) != 64:
        raise UpdateError("The update manifest has no valid SHA-256 checksum.")
    return info


def check(manifest_url: str, client: httpx.Client | None = None) -> UpdateInfo:
    c = client or httpx.Client(timeout=15, verify=make_ssl_context(), trust_env=True, follow_redirects=True)
    try:
        r = c.get(manifest_url, headers={"Cache-Control": "no-cache"})
    except httpx.HTTPError as e:
        raise UpdateError(f"Could not check for updates: {type(e).__name__}") from e
    if r.status_code != 200:
        raise UpdateError(f"Update server returned HTTP {r.status_code}.")
    try:
        return parse_manifest(r.json())
    except ValueError as e:
        raise UpdateError("The update manifest is not valid JSON.") from e


def download(info: UpdateInfo, dest_dir: Path | None = None, progress: Callable[[int, int], None] | None = None,
             client: httpx.Client | None = None) -> Path:
    dest_dir = Path(dest_dir or tempfile.mkdtemp(prefix="agentsii-update-"))
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"AgentsiiCodexManager-Setup-{info.version}.exe"
    c = client or httpx.Client(timeout=httpx.Timeout(60, connect=15), verify=make_ssl_context(), trust_env=True,
                               follow_redirects=True)
    h = hashlib.sha256()
    done = 0
    try:
        with c.stream("GET", info.installer_url) as r:
            if r.status_code != 200:
                raise UpdateError(f"Download failed: HTTP {r.status_code}.")
            total = int(r.headers.get("content-length") or info.installer_size or 0)
            with open(dest, "wb") as f:
                for chunk in r.iter_bytes(1 << 16):
                    f.write(chunk)
                    h.update(chunk)
                    done += len(chunk)
                    if progress:
                        progress(done, total)
    except httpx.HTTPError as e:
        raise UpdateError(f"Download failed: {type(e).__name__}") from e
    if h.hexdigest() != info.installer_sha256:
        try:
            dest.unlink()
        except OSError:
            pass
        raise UpdateError("The downloaded file does not match the published checksum; it was deleted.")
    return dest


def launch_installer(path: Path) -> None:
    """Start the verified installer; the app should quit right after so files can be replaced."""
    if os.name != "nt":  # pragma: no cover
        raise UpdateError("Installing updates is only supported on Windows.")
    subprocess.Popen([str(path), "/SP-", "/CLOSEAPPLICATIONS", "/RESTARTAPPLICATIONS"], close_fds=True)
