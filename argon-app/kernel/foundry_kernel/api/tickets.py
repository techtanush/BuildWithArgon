# OWNER: tanush — seed version; replace/extend freely but keep the public signatures.

"""Ticket inspection and explicit human lifecycle actions."""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field

from .. import bus
from ..api_models import Envelope, Page, Ticket, TicketDetail
from ..errors import ConflictError
from ..ids import utc_now
from ..records import (
    clean,
    create_ticket,
    get_row,
    json_loads,
    list_rows,
    serialize_approval,
    serialize_artifact,
    serialize_run,
    serialize_ticket,
)

router = APIRouter(tags=["tickets"])


class CreateTicket(BaseModel):
    type: str
    department_id: str
    title: str = Field(min_length=1, max_length=500)
    body: str = Field(default="", max_length=100_000)
    payload: dict[str, Any] = Field(default_factory=dict)
    assigned_agent_id: str | None = None
    priority: int = Field(default=2, ge=0, le=3)


@router.get("/v1/ventures/{vid}/tickets", response_model=Envelope[Page[Ticket]])
async def list_tickets(vid: str, request: Request, status: str | None = None, department_id: str | None = None, type: str | None = None, limit: int = Query(50, ge=1, le=200), cursor: str | None = None):
    db = request.app.state.db
    await get_row(db, "ventures", vid)
    rows, cursor = await list_rows(db, "tickets", venture_id=vid, limit=limit, cursor=cursor, filters={"status": status, "department_id": department_id, "type": type})
    return {"data": {"items": [await serialize_ticket(db, row) for row in rows], "next_cursor": cursor}}


@router.get("/v1/tickets/{tid}", response_model=Envelope[TicketDetail])
async def get_ticket(tid: str, request: Request):
    db = request.app.state.db
    result = await serialize_ticket(db, await get_row(db, "tickets", tid))
    result.update(runs=[serialize_run(row) for row in await db.fetch_all("SELECT * FROM runs WHERE ticket_id=? ORDER BY created_at,id", (tid,))],
                  artifacts=[serialize_artifact(row) for row in await db.fetch_all("SELECT * FROM artifacts WHERE ticket_id=? ORDER BY created_at,id", (tid,))],
                  approvals=[serialize_approval(row) for row in await db.fetch_all("SELECT * FROM approvals WHERE ticket_id=? ORDER BY created_at,id", (tid,))],
                  children=[await serialize_ticket(db, row) for row in await db.fetch_all("SELECT * FROM tickets WHERE parent_ticket_id=? ORDER BY created_at,id", (tid,))])
    return {"data": result}


@router.post("/v1/ventures/{vid}/tickets", response_model=Envelope[Ticket])
async def create(vid: str, body: CreateTicket, request: Request):
    async with request.app.state.db.tx() as tx:
        await get_row(tx, "ventures", vid)
        result = await create_ticket(tx, venture_id=vid, **clean(body.model_dump(), request.app.state.settings))
    return {"data": result}


@router.post("/v1/tickets/{tid}/retry", response_model=Envelope[Ticket])
async def retry(tid: str, request: Request):
    async with request.app.state.db.tx() as tx:
        ticket = await get_row(tx, "tickets", tid)
        if ticket["status"] not in ("failed", "blocked", "cancelled"):
            raise ConflictError("Only failed, blocked or cancelled tickets can be retried")
        if await tx.fetch_one("SELECT id FROM approvals WHERE ticket_id=? AND status='pending'", (tid,)):
            raise ConflictError("Decide the pending approval before retrying this ticket")
        payload = json_loads(ticket["payload_json"], {})
        payload.pop("_retry_at", None)
        await tx.execute("UPDATE tickets SET status='open',payload_json=?,updated_at=?,started_at=NULL,completed_at=NULL WHERE id=?", (json.dumps(payload), utc_now(), tid))
        result = await serialize_ticket(tx, await get_row(tx, "tickets", tid))
        await bus.emit(tx, venture_id=ticket["venture_id"], type="ticket.updated", entity_kind="ticket", entity_id=tid, data=result)
    return {"data": result}


@router.post("/v1/tickets/{tid}/cancel", response_model=Envelope[Ticket])
async def cancel(tid: str, request: Request):
    async with request.app.state.db.tx() as tx:
        ticket = await get_row(tx, "tickets", tid)
        if ticket["status"] in ("done", "cancelled"):
            raise ConflictError("A completed or cancelled ticket cannot be cancelled")
        now = utc_now()
        await tx.execute("UPDATE tickets SET status='cancelled',updated_at=?,completed_at=? WHERE id=?", (now, now, tid))
        for run in await tx.fetch_all("SELECT * FROM runs WHERE ticket_id=? AND status IN ('queued','running')", (tid,)):
            await tx.execute("UPDATE runs SET status='cancelled',completed_at=? WHERE id=?", (now, run["id"]))
            await bus.emit(tx, venture_id=ticket["venture_id"], type="run.finished", entity_kind="run", entity_id=run["id"], data=serialize_run(await get_row(tx, "runs", run["id"])))
        for approval in await tx.fetch_all("SELECT * FROM approvals WHERE ticket_id=? AND status='pending'", (tid,)):
            await tx.execute("UPDATE approvals SET status='expired',decided_at=? WHERE id=?", (now, approval["id"]))
            await bus.emit(tx, venture_id=ticket["venture_id"], type="approval.decided", entity_kind="approval", entity_id=approval["id"], data=serialize_approval(await get_row(tx, "approvals", approval["id"])))
        states = await tx.fetch_all("SELECT agent_id FROM agent_state WHERE venture_id=? AND current_ticket_id=?", (ticket["venture_id"], tid))
        await tx.execute("UPDATE agent_state SET status='idle',current_ticket_id=NULL WHERE venture_id=? AND current_ticket_id=?", (ticket["venture_id"], tid))
        for state in states:
            await bus.emit(tx, venture_id=ticket["venture_id"], type="agent.status", entity_kind="agent", entity_id=state["agent_id"], data={"agent_id": state["agent_id"], "status": "idle", "current_ticket_id": None})
        result = await serialize_ticket(tx, await get_row(tx, "tickets", tid))
        await bus.emit(tx, venture_id=ticket["venture_id"], type="ticket.updated", entity_kind="ticket", entity_id=tid, data=result)
    scheduler = getattr(request.app.state, "scheduler", None)
    if scheduler is not None and hasattr(scheduler, "cancel_ticket"):
        await scheduler.cancel_ticket(tid)
    return {"data": result}
