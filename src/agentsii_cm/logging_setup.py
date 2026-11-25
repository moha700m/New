"""Logging with secret redaction. Logs stay on the local machine."""
from __future__ import annotations

import logging
import re
import threading
from logging.handlers import RotatingFileHandler

from . import paths

_KNOWN_SECRETS: set[str] = set()
_lock = threading.Lock()

_PATTERNS = [
    re.compile(r"(?i)(authorization\s*[:=]\s*)(bearer\s+)?[^\s,'\"}]+"),
    re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]{8,}"),
    re.compile(r"(?i)((?:api[_-]?key|x-api-key|token|secret)\"?\s*[:=]\s*\"?)[^\s,'\"}]+"),
    re.compile(r"\b(sk|rk|pk|or|agb)[-_][A-Za-z0-9_-]{12,}\b"),
]


def register_secret(value: str | None) -> None:
    """Make sure an exact secret value is masked wherever it would be logged."""
    if value and len(value) >= 6:
        with _lock:
            _KNOWN_SECRETS.add(value)


def redact(text: str) -> str:
    if not text:
        return text
    with _lock:
        known = sorted(_KNOWN_SECRETS, key=len, reverse=True)
    for s in known:
        text = text.replace(s, "***")
    for p in _PATTERNS:
        if p.groups >= 1:
            text = p.sub(lambda m: (m.group(1) or "") + "***", text)
        else:
            text = p.sub("***", text)
    return text


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:  # pragma: no cover
            return True
        record.msg = redact(msg)
        record.args = ()
        return True


def setup_logging(name: str = "app") -> logging.Logger:
    root = logging.getLogger("agentsii")
    if getattr(root, "_agentsii_configured", False):
        return root
    root.setLevel(logging.INFO)
    handler = RotatingFileHandler(paths.logs_dir() / f"{name}.log", maxBytes=1_000_000, backupCount=3,
                                  encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    handler.addFilter(RedactingFilter())
    root.addHandler(handler)
    root._agentsii_configured = True  # type: ignore[attr-defined]
    return root
