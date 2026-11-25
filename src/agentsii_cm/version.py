"""Version and product metadata (single source of truth)."""

APP_NAME = "Agentsii Codex Manager"
APP_ID = "agentsii-codex-manager"
PUBLISHER = "Agentsii"
VERSION = "1.0.1"
VERSION_TUPLE = tuple(int(p) for p in VERSION.split("."))
COPYRIGHT = "Copyright (c) 2026 Agentsii. All rights reserved."

# Public update manifest. The app only performs a plain GET of this JSON file;
# nothing about the user, their providers or their keys is ever sent.
RELEASES_REPO = "moha700m/New"
# Always points at the newest published release's manifest (a real, public file once released).
UPDATE_MANIFEST_URL = f"https://github.com/{RELEASES_REPO}/releases/latest/download/latest.json"
DOWNLOAD_PAGE_URL = f"https://github.com/{RELEASES_REPO}/releases/latest"

HELPER_EXE_NAME = "agentsii-helper.exe"
KEYRING_SERVICE = "Agentsii Codex Manager"
DEFAULT_BRIDGE_PORT = 47821
