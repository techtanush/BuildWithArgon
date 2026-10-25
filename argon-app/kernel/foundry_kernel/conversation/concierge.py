# OWNER: tanush
"""Company-wide grounded answers and route cards built from real directory agents."""
from __future__ import annotations

from typing import Any

from ..contracts import ConciergeResponse, RouteCard, TalkRequest
from .talk import answer


async def ask(*, db: Any, llm: Any, settings: Any, venture_id: str, req: TalkRequest) -> ConciergeResponse:
    result=await answer(db=db,llm=llm,settings=settings,venture_id=venture_id,agent_id="concierge",req=req,company_wide=True)
    suggestion=result["suggestion"];card=None
    if suggestion:
        target=result["directory"][suggestion.agent_id]
        card=RouteCard(agent_id=target["id"],agent_name=target["display_name"],agent_title=target["title"],department_id=target["department_id"],building_id=target["building_id"],building_name=target["building_name"],reason=suggestion.reason,citations=result["citations"])
    return ConciergeResponse(answer_id=result["answer_id"],text=result["text"],citations=result["citations"],check=result["check"],route_card=card,latency_ms=result["latency_ms"])
