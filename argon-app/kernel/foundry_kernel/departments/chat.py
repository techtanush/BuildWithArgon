# OWNER: tanush
"""Cited chat replies with a narrow, Chief-of-Staff-only action surface."""
from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field

from .. import bus
from ..contracts import Citation, HandlerResult, NewMessage
from ..ids import utc_now
from ..records import serialize_ticket
from .base import generate_json, input_context, payload
from .requests import validate_citations


class Reprioritize(BaseModel):
    type: Literal["reprioritize"]
    ticket_id: str
    priority: int = Field(ge=0, le=3)


class RequestAction(BaseModel):
    type: Literal["agent.request"]
    department_id: str
    need: str
    why: str = ""


class ChatReply(BaseModel):
    text: str
    citations: list[Citation] = Field(default_factory=list)
    actions: list[Annotated[Reprioritize | RequestAction, Field(discriminator="type")]] = Field(default_factory=list)


class ChatReplyHandler:
    ticket_types = ("chat.reply",)

    async def handle(self, ticket, ctx):
        data = payload(ticket)
        channel = await ctx.db.fetch_one("SELECT * FROM channels WHERE id=? AND venture_id=?", (data["channel_id"], ctx.venture["id"]))
        root = await ctx.db.fetch_one("SELECT id FROM messages WHERE id=? AND channel_id=? AND thread_root_id IS NULL", (data["thread_root_id"], data["channel_id"]))
        if channel is None or root is None:
            raise ValueError("Chat replies require a valid venture channel and thread root")
        output = await generate_json(ctx, "concierge" if ctx.agent["id"] == "concierge" else "talk", await input_context(ticket, ctx) + "\nReply with citations. Only Rhea may return actions reprioritize or agent.request. Never execute gated actions; point to the approval.", ChatReply)
        await validate_citations(ctx, output.citations)
        if output.actions and ctx.agent["id"] != "cos.orchestrator":
            raise ValueError("Only the Chief of Staff may apply chat actions")
        applied = []
        # Validate every action before mutating any state.
        for action in output.actions:
            if isinstance(action, Reprioritize):
                row = await ctx.db.fetch_one("SELECT id FROM tickets WHERE id=? AND venture_id=? AND status='open'", (action.ticket_id, ctx.venture["id"]))
                if row is None:
                    raise ValueError("Priorities may target only this venture's open tickets")
            elif not await ctx.db.fetch_one("SELECT id FROM departments WHERE id=?", (action.department_id,)):
                raise ValueError("Request target department does not exist")
        async with ctx.db.tx() as tx:
            for action in output.actions:
                if isinstance(action, Reprioritize):
                    await tx.execute("UPDATE tickets SET priority=?,updated_at=? WHERE id=?", (action.priority, utc_now(), action.ticket_id))
                    row = await tx.fetch_one("SELECT * FROM tickets WHERE id=?", (action.ticket_id,))
                    await bus.emit(tx, venture_id=ctx.venture["id"], type="ticket.updated", entity_kind="ticket", entity_id=action.ticket_id, data=await serialize_ticket(tx, row))
                    applied.append(f"Set {action.ticket_id} priority to {action.priority}.")
        for action in output.actions:
            if isinstance(action, RequestAction):
                tid = await ctx.request(action.department_id, action.need, action.why)
                applied.append(f"Created request {tid} for {action.department_id}.")
        text = output.text + ("\n\n" + "\n".join(applied) if applied else "")
        return HandlerResult(outcome="done", result={"citations": [c.model_dump() for c in output.citations], "actions": applied}, messages=[NewMessage(channel_slug=channel["slug"], body=text, refs=[{"kind": c.kind, "id": c.id} for c in output.citations], kind="reply", thread_root_id=data["thread_root_id"])])
