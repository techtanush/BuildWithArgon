# OWNER: tanush
"""Cross-department requests: cited answers, safe internal delegation or decline."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from ..contracts import Citation, HandlerResult, NewMessage, NewTicket
from ..records import TICKET_DEFAULTS
from .base import generate_json, input_context, payload


class Delegation(BaseModel):
    type: str
    assign_to: str
    title: str
    body: str = ""


class RequestResponse(BaseModel):
    decision: Literal["answer", "delegate", "decline"]
    text: str = ""
    citations: list[Citation] = Field(default_factory=list)
    tickets: list[Delegation] = Field(default_factory=list)
    reason: str = ""
    suggest_department: str | None = None


async def validate_citations(ctx, citations):
    tables = {"ticket": "tickets", "run": "runs", "artifact": "artifacts", "approval": "approvals", "message": "messages", "file": "files", "agent": "agents", "department": "departments", "computer_task": "computer_tasks"}
    for ref in citations:
        row = await ctx.db.fetch_one(f"SELECT * FROM {tables[ref.kind]} WHERE id=?", (ref.id,))
        if row is None or ("venture_id" in row and row["venture_id"] not in (None, ctx.venture["id"])):
            raise ValueError("Citations must reference visible venture records")
        searchable = "\n".join(str(value) for value in row.values() if value is not None)
        if not ref.quote.strip() or ref.quote not in searchable:
            raise ValueError("Citation quotes must be exact, nonempty substrings of their record")


class RequestHandler:
    ticket_types = ("agent.request",)

    async def handle(self, ticket, ctx):
        if not ctx.agent["is_lead"]:
            raise ValueError("Cross-department requests are handled by the target lead")
        data = payload(ticket)
        requester = await ctx.db.fetch_one("SELECT * FROM agents WHERE id=? AND (venture_id IS NULL OR venture_id=?)", (data["from_agent_id"], ctx.venture["id"]))
        if requester is None:
            raise ValueError("Requester must belong to this venture")
        children = await ctx.db.fetch_all("SELECT id,title,status,result_json FROM tickets WHERE parent_ticket_id=? ORDER BY created_at,id", (ticket["id"],))
        channel = f"dept-{requester['department_id']}"
        if children:
            if any(c["status"] not in ("done", "failed", "cancelled") for c in children):
                return HandlerResult(outcome="blocked", note="Waiting for delegated child tickets", result={"waiting_children": True})
            failures = [c for c in children if c["status"] == "failed"]
            text = "Delegated request finished: " + "; ".join(f"{c['title']}: {c['status']}" for c in children)
            return HandlerResult(outcome="done", note=text, result={"children": children, "partial": bool(failures)}, messages=[NewMessage(channel_slug=channel, body=text, kind="handoff", refs=[{"kind": "ticket", "id": c["id"]} for c in children])])
        output = await generate_json(ctx, "agent_request", await input_context(ticket, ctx), RequestResponse)
        if output.decision == "answer":
            if not output.text.strip():
                raise ValueError("An answer must contain text")
            await validate_citations(ctx, output.citations)
            return HandlerResult(outcome="done", result=output.model_dump(), messages=[NewMessage(channel_slug=channel, body=output.text, kind="answer", refs=[{"kind": c.kind, "id": c.id} for c in output.citations])])
        if output.decision == "decline":
            if not output.reason.strip():
                raise ValueError("A decline must explain why")
            if output.suggest_department:
                if output.suggest_department == ctx.agent["department_id"] or data.get("redirects", 0) >= 2:
                    raise ValueError("Request redirects must not loop")
                await ctx.request(output.suggest_department, data["need"], output.reason, data.get("context_refs", []))
            return HandlerResult(outcome="done", result=output.model_dump(), messages=[NewMessage(channel_slug=channel, body=output.reason, kind="answer")])
        if not output.tickets:
            raise ValueError("Delegation needs at least one child ticket")
        new = []
        for delegated in output.tickets:
            default = TICKET_DEFAULTS.get(delegated.type)
            assignee = await ctx.db.fetch_one("SELECT * FROM agents WHERE id=? AND department_id=? AND (venture_id IS NULL OR venture_id=?)", (delegated.assign_to, ctx.agent["department_id"], ctx.venture["id"]))
            if not default or default[0] != ctx.agent["department_id"] or assignee is None or assignee["id"] == ctx.agent["id"]:
                raise ValueError("A lead may delegate only to their own sub-agents")
            new.append(NewTicket(type=delegated.type, title=delegated.title, body=delegated.body, assigned_agent_id=delegated.assign_to, payload={"request_id": ticket["id"]}))
        return HandlerResult(outcome="done", note="Delegated request; waiting for child work", result={"waiting_children": True, "text": "Delegated request; waiting for child work", "from_agent_id": requester["id"]}, new_tickets=new)
