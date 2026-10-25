# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.
"""The World Lab live round: capture → critique (video + screenshots) → patch (Antigravity "world architect"
when available) → validate → re-capture → score, for ONE building (05-world/13 §2)."""
from __future__ import annotations

from typing import Any

from ..contracts import LiveRound
from ..errors import NotImplementedYet


async def start_round(*, settings: Any, db: Any, llm: Any, department_id: str, fast: bool = True) -> LiveRound:
    raise NotImplementedYet("live round not implemented yet (owner: ayan)")
