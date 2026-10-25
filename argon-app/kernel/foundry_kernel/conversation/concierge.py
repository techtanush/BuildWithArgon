# OWNER: tanush — seed version; replace/extend freely but keep the public signatures.
"""Concierge answers + route cards (05-world/08-concierge.md).
Called by api/conversation.py (tanush) and by the grounding eval — keep this signature."""
from __future__ import annotations

from typing import Any

from ..contracts import ConciergeResponse, TalkRequest
from ..errors import NotImplementedYet


async def ask(*, db: Any, llm: Any, settings: Any, venture_id: str, req: TalkRequest) -> ConciergeResponse:
    raise NotImplementedYet("conversation.concierge not implemented yet (owner: tanush)")
