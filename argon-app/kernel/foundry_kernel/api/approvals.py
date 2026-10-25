# OWNER: tanush — seed version; replace/extend freely but keep the public signatures.

"""Approval decisions are atomic and re-enter the ticket through the scheduler."""
from typing import Literal

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field

from .. import gates
from ..api_models import Approval, Envelope, Page
from ..records import get_row, serialize_approval

router = APIRouter(tags=["approvals"])


class Decision(BaseModel):
    decision: Literal["approve", "reject"]
    decided_by: str = Field(min_length=1, max_length=100)
    note: str = Field(default="", max_length=10000)
    answers: dict[str, str] = Field(default_factory=dict)


@router.get("/v1/ventures/{vid}/approvals", response_model=Envelope[Page[Approval]])
async def list_approvals(request: Request, vid: str,
                         status: Literal["pending", "approved", "rejected", "expired"] | None = None,
                         limit: int = Query(50, ge=1, le=200), cursor: str | None = None):
    db = request.app.state.db
    await get_row(db, "ventures", vid)
    from ..records import list_rows
    rows, next_cursor = await list_rows(db, "approvals", venture_id=vid, limit=limit, cursor=cursor,
                                       filters={"status": status})
    return {"data": {"items": [serialize_approval(row) for row in rows], "next_cursor": next_cursor}}


@router.post("/v1/approvals/{aid}/decision", response_model=Envelope[Approval])
async def decision(request: Request, aid: str, body: Decision):
    return {"data": await gates.decide(request.app.state.db, aid, **body.model_dump())}
