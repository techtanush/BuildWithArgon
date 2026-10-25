# OWNER: frozen contract (change only via docs/contract-requests/<you>.md, applied in the merge session)
"""redact() for every stored text (01-architecture/06-security-and-secrets.md §Secrets).
Used by tanush (db writes, logs, events, chat) and ayan (LLM outputs, file blocks, Composio payloads)."""
from __future__ import annotations

import re

from .config import Settings, get_settings

PATTERNS = [
    re.compile(r"AIza[0-9A-Za-z_\-]{30,}"),
    re.compile(r"sk-[A-Za-z0-9_\-]{16,}"),
    re.compile(r"github_pat_[A-Za-z0-9_]{16,}"),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(r"xi-[A-Za-z0-9]{16,}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
]
SECRET_FIELDS = ("gemini_api_key", "composio_api_key", "elevenlabs_api_key", "github_sandbox_token", "kernel_token")


def configured_secrets(settings: Settings | None = None) -> list[str]:
    s = settings or get_settings()
    values = []
    for name in SECRET_FIELDS:
        secret = getattr(s, name, None)
        value = secret.get_secret_value() if secret is not None else ""
        if len(value) >= 8:
            values.append(value)
    return values


def redact(text: str | None, settings: Settings | None = None) -> str:
    if not text:
        return text or ""
    for value in configured_secrets(settings):
        text = text.replace(value, "[REDACTED]")
    for pattern in PATTERNS:
        text = pattern.sub("[REDACTED]", text)
    return text
