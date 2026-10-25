# OWNER: karthik — seed version; replace/extend freely but keep the public signatures.

"""STT. Contract: provider="none" means the client must use browser speech recognition."""
from __future__ import annotations

from typing import Any

from ..contracts import SttResponse


async def transcribe(*, settings: Any, llm: Any, audio: bytes, mime: str) -> SttResponse:
    return SttResponse(text="", provider="none")
