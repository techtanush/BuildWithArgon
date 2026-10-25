# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.

"""Computer-use loop. Contract: NEVER raise for unavailability — return status="skipped" with a reason,
so callers (tanush's HandlerContext.use_computer) fall back cleanly."""
from __future__ import annotations

from typing import Any

from ..contracts import ComputerTaskResult


async def run_task(*, settings: Any, db: Any, llm: Any, venture_id: str, agent_id: str, ticket_id: str | None,
                   goal: str, allowed_domains: list[str], start_url: str, max_steps: int = 30) -> ComputerTaskResult:
    return ComputerTaskResult(status="skipped", reason="cloud computers not available on this branch/config")
