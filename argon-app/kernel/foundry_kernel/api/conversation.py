# OWNER: tanush
"""Conversation endpoints shared by dashboard, world and voice sessions."""
from fastapi import APIRouter, Request
from pydantic import BaseModel

from ..api_models import Envelope
from ..contracts import (
    AnswerCheck,
    Citation,
    ConciergeResponse,
    TalkRequest,
    TalkResponse,
)
from ..conversation.concierge import ask
from ..conversation.talk import talk
from ..records import json_loads

router=APIRouter(tags=["conversation"])


class AnswerInfo(BaseModel):
    id: str
    text: str
    citations: list[Citation]
    check: AnswerCheck
    run_id: str | None = None
    model: str | None = None
    run_status: str | None = None


@router.post("/v1/ventures/{vid}/agents/{agent_id}/talk",response_model=Envelope[TalkResponse])
async def agent_talk(vid: str,agent_id: str,body: TalkRequest,request: Request):
    return {"data":await talk(db=request.app.state.db,llm=request.app.state.llm,settings=request.app.state.settings,venture_id=vid,agent_id=agent_id,req=body)}


@router.post("/v1/ventures/{vid}/concierge/ask",response_model=Envelope[ConciergeResponse])
async def concierge_ask(vid: str,body: TalkRequest,request: Request):
    return {"data":await ask(db=request.app.state.db,llm=request.app.state.llm,settings=request.app.state.settings,venture_id=vid,req=body)}


@router.get("/v1/answers/{answer_id}",response_model=Envelope[AnswerInfo])
async def get_answer(answer_id: str,request: Request):
    db=request.app.state.db
    row=await db.fetch_one("SELECT * FROM answers WHERE id=?",(answer_id,))
    if row is None:
        from ..errors import NotFoundError
        raise NotFoundError("answer",answer_id)
    check=AnswerCheck.model_validate(json_loads(row["check_json"],{"status":row["check_status"]}))
    check.status=row["check_status"]
    if check.status == "pending":
        check.reason = "Exact sources checked; claim support is being checked."
    run=await db.fetch_one("SELECT id,model,status FROM runs WHERE id=? AND venture_id=?",(row["run_id"],row["venture_id"]))
    return {"data":{"id":row["id"],"text":row["answer"],"citations":json_loads(row["citations_json"],[]),"check":check,"run_id":run["id"] if run else None,"model":run["model"] if run else None,"run_status":run["status"] if run else None}}
