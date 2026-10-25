# OWNER: karthik — seed version; replace/extend freely but keep the public signatures.

"""TTS. Contract: always returns a TtsResponse; provider="browser" means the client speaks it."""
from __future__ import annotations

from typing import Any

from ..contracts import TtsResponse


async def synthesize(*, settings: Any, db: Any, agent_id: str, text: str) -> TtsResponse:
    return TtsResponse(provider="browser")
