"""Provider data model and validation."""
from __future__ import annotations

import re
import time
from dataclasses import asdict, dataclass, field
from urllib.parse import urlparse

WIRE_RESPONSES = "responses"
WIRE_CHAT = "chat"
WIRE_APIS = (WIRE_RESPONSES, WIRE_CHAT)

AUTH_BEARER = "bearer"
AUTH_HEADER = "header"
AUTH_NONE = "none"
AUTH_TYPES = (AUTH_BEARER, AUTH_HEADER, AUTH_NONE)

MODE_DIRECT = "direct"
MODE_BRIDGE = "bridge"

# IDs reserved by Codex for its built-in providers (from the official config docs).
RESERVED_PROVIDER_IDS = frozenset(
    {"openai", "ollama", "lmstudio", "amazon-bedrock", "amazon-bedrock-runtime", "gcp", "oss"}
)

PROVIDER_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,39}$")
HEADER_NAME_RE = re.compile(r"^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$")
MODEL_ID_RE = re.compile(r"^[^\s\"'\\]{1,200}$")


class ValidationError(ValueError):
    def __init__(self, errors: dict[str, str]):
        self.errors = errors
        super().__init__("; ".join(f"{k}: {v}" for k, v in errors.items()))


def slugify_provider_id(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    s = s[:40] or "provider"
    if len(s) < 2:
        s = f"{s}-provider"
    if s in RESERVED_PROVIDER_IDS:
        s = f"{s}-custom"
    return s


def normalize_base_url(url: str) -> str:
    return url.strip().rstrip("/")


def is_local_host(host: str | None) -> bool:
    return (host or "").lower() in {"localhost", "127.0.0.1", "::1", "[::1]"}


@dataclass
class Provider:
    id: str
    name: str
    base_url: str
    wire_api: str = WIRE_CHAT
    auth_type: str = AUTH_BEARER
    auth_header_name: str = ""
    models: list[str] = field(default_factory=list)
    default_model: str = ""
    is_default: bool = False
    codex_connected: bool = False
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    @property
    def connection_mode(self) -> str:
        """Codex speaks only the Responses API with bearer auth. Anything else goes
        through the local Agentsii Bridge, which translates / injects the header."""
        if self.wire_api == WIRE_CHAT or self.auth_type == AUTH_HEADER:
            return MODE_BRIDGE
        return MODE_DIRECT

    @property
    def needs_key(self) -> bool:
        return self.auth_type != AUTH_NONE

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Provider":
        known = {f for f in cls.__dataclass_fields__}  # type: ignore[attr-defined]
        data = {k: v for k, v in d.items() if k in known}
        p = cls(**data)
        p.models = [str(m) for m in (p.models or []) if str(m).strip()]
        if p.default_model and p.default_model not in p.models:
            p.models.insert(0, p.default_model)
        if not p.default_model and p.models:
            p.default_model = p.models[0]
        return p

    def validate(self) -> None:
        errors: dict[str, str] = {}
        if not self.name.strip():
            errors["name"] = "Provider name is required."
        if not PROVIDER_ID_RE.match(self.id or ""):
            errors["id"] = "Use 2-40 lowercase letters, digits, '-' or '_' (must start with a letter or digit)."
        elif self.id in RESERVED_PROVIDER_IDS:
            errors["id"] = f"'{self.id}' is reserved by Codex for a built-in provider."
        u = urlparse(self.base_url or "")
        if u.scheme not in ("http", "https") or not u.netloc:
            errors["base_url"] = "Enter a full URL such as https://api.example.com/v1"
        elif u.scheme == "http" and not is_local_host(u.hostname):
            errors["base_url"] = "Plain http:// is only allowed for localhost. Use https://"
        elif u.query or u.fragment:
            errors["base_url"] = "The base URL must not contain '?' or '#'."
        if self.wire_api not in WIRE_APIS:
            errors["wire_api"] = "Choose Responses or Chat Completions."
        if self.auth_type not in AUTH_TYPES:
            errors["auth_type"] = "Choose an authentication method."
        if self.auth_type == AUTH_HEADER and not HEADER_NAME_RE.match(self.auth_header_name or ""):
            errors["auth_header_name"] = "Enter a valid header name, e.g. X-API-Key"
        if not self.models:
            errors["models"] = "Add at least one model ID."
        for m in self.models:
            if not MODEL_ID_RE.match(m):
                errors["models"] = f"Invalid model ID: {m!r}"
                break
        if self.models and self.default_model not in self.models:
            errors["default_model"] = "The default model must be one of the provider's models."
        if errors:
            raise ValidationError(errors)


# Presets only contain values verified from each provider's public documentation.
# Protocol support changes over time: "Test connection" / "Auto-detect" checks the real endpoint.
PRESETS: list[dict] = [
    {"key": "deepseek", "name": "DeepSeek", "id": "deepseek", "base_url": "https://api.deepseek.com",
     "wire_api": WIRE_CHAT, "auth_type": AUTH_BEARER},
    {"key": "openrouter", "name": "OpenRouter", "id": "openrouter", "base_url": "https://openrouter.ai/api/v1",
     "wire_api": WIRE_RESPONSES, "auth_type": AUTH_BEARER},
    {"key": "venice", "name": "Venice AI", "id": "venice", "base_url": "https://api.venice.ai/api/v1",
     "wire_api": WIRE_CHAT, "auth_type": AUTH_BEARER},
    {"key": "shannon", "name": "Shannon AI", "id": "shannon", "base_url": "",
     "wire_api": WIRE_CHAT, "auth_type": AUTH_BEARER},
    {"key": "custom", "name": "", "id": "", "base_url": "", "wire_api": WIRE_CHAT, "auth_type": AUTH_BEARER},
]
