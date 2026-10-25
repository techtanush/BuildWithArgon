# OWNER: tanush
"""Global and venture-scoped agent directory."""
from fastapi import APIRouter, Request

from ..api_models import Agent, AgentDetail, Envelope, Page
from ..errors import NotFoundError
from ..records import get_row, serialize_agent, serialize_run, serialize_ticket

router = APIRouter(tags=["agents"])


@router.get("/v1/ventures/{vid}/agents", response_model=Envelope[Page[Agent]])
async def list_agents(vid: str, request: Request):
    db = request.app.state.db
    await get_row(db, "ventures", vid)
    rows = await db.fetch_all("SELECT * FROM agents WHERE venture_id IS NULL OR venture_id=? ORDER BY department_id,is_lead DESC,id", (vid,))
    return {"data": {"items": [await serialize_agent(db, row, vid) for row in rows]}}


@router.get("/v1/ventures/{vid}/agents/{agent_id}", response_model=Envelope[AgentDetail])
async def get_agent(vid: str, agent_id: str, request: Request):
    db = request.app.state.db
    await get_row(db, "ventures", vid)
    agent = await get_row(db, "agents", agent_id)
    if agent["venture_id"] not in (None, vid):
        raise NotFoundError("agent", agent_id)
    result = await serialize_agent(db, agent, vid)
    result["recent_runs"] = [serialize_run(row) for row in await db.fetch_all("SELECT * FROM runs WHERE venture_id=? AND agent_id=? ORDER BY created_at DESC,id DESC LIMIT 20", (vid, agent_id))]
    ticket = await db.fetch_one("SELECT * FROM tickets WHERE venture_id=? AND id=?", (vid, result["state"]["current_ticket_id"]))
    result["current_ticket"] = await serialize_ticket(db, ticket) if ticket else None
    return {"data": result}
