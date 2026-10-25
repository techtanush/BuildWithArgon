# OWNER: ayan
"""Executor selection (ADR-011; 03-company-kernel/02-autonomous-engineering-loop.md §3).
AntigravityExecutor when ENGINEERING_EXECUTOR=antigravity and kv['executor.override'] != 'local';
otherwise LocalLoopExecutor. Both return contracts.ExecutorResult."""
from __future__ import annotations

from typing import Any

from ..config import Settings
from ..contracts import Executor, ExecutorInput, ExecutorResult
from .antigravity import KV_OVERRIDE, AntigravityExecutor, kv_get
from .local_loop import LocalLoopExecutor

__all__ = ["AntigravityExecutor", "Executor", "ExecutorInput", "ExecutorResult", "LocalLoopExecutor", "executor_name",
           "get_executor"]


async def executor_name(settings: Settings, db: Any = None, *, kv_override: str | None = None) -> str:
    override = kv_override if kv_override is not None else await kv_get(db, KV_OVERRIDE)
    if settings.engineering_executor == "antigravity" and override != "local":
        return "antigravity"
    return "local"


async def get_executor(settings: Settings, llm: Any, db: Any = None, *, kv_override: str | None = None) -> Any:
    if await executor_name(settings, db, kv_override=kv_override) == "antigravity":
        return AntigravityExecutor(settings, llm, db)
    return LocalLoopExecutor(settings, llm)
