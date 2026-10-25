# OWNER: frozen contract (change only via docs/contract-requests/<you>.md, applied in the merge session)

from __future__ import annotations

from datetime import UTC, datetime

from ulid import ULID


def new_id(prefix: str) -> str:
    """`<prefix>_<ULID>`, e.g. new_id("tkt") -> "tkt_01JB9Z5Q8W3K7T2M4N6P8R0S1V"."""
    return f"{prefix}_{ULID()}"


def utc_now() -> str:
    """ISO-8601 UTC with millisecond precision and a trailing Z."""
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
