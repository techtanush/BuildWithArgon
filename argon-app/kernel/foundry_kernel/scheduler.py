# OWNER: tanush — seed version; replace/extend freely but keep the public signatures.

"""Ticket scheduler (stub). Spec: 01-architecture/05-event-bus-and-orchestration.md §Scheduler."""
from __future__ import annotations

from fastapi import FastAPI


async def start(app: FastAPI) -> None:
    """Start the dispatch loop, standup timer and escalation checks. Seed: no-op."""


async def stop(app: FastAPI) -> None:
    """Cancel running tasks gracefully. Seed: no-op."""
