# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.

"""Smoke tests S1–S7 (02-models-and-integrations/02-gemini-interactions-api.md). Seed: S1 only.
Run: uv run python -m foundry_kernel.llm.smoke basic"""
from __future__ import annotations

import asyncio
import sys

from ..config import get_settings
from .client import LLMClient


async def basic() -> None:
    res = await LLMClient(get_settings()).generate("talk", "Reply with exactly: OK")
    print("S1", "PASS" if "OK" in res.text else "FAIL", res.latency_ms, "ms", res.text[:80])


if __name__ == "__main__":
    # Ayan: add S2–S7 and dispatch on sys.argv[1] ("basic" | "all" | ...).
    print("args:", sys.argv[1:] or ["basic"])
    asyncio.run(basic())
