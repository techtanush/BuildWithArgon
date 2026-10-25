# OWNER: tanush — seed version; replace/extend freely but keep the public signatures.
"""Agent conversation (05-world/07-npc-conversation.md, 03-company-kernel/08-grounding-and-citations.md).
Called by api/conversation.py (tanush) and by the grounding eval — keep this signature."""
from __future__ import annotations

from typing import Any

from ..contracts import TalkRequest, TalkResponse
from ..errors import NotImplementedYet


async def talk(*, db: Any, llm: Any, settings: Any, venture_id: str, agent_id: str, req: TalkRequest) -> TalkResponse:
    raise NotImplementedYet("conversation.talk not implemented yet (owner: tanush)")
