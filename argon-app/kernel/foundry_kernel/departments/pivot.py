# OWNER: tanush
"""Evidence-based proceed/revise/kill decisions under founder control."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .. import bus
from ..contracts import HandlerResult, NewApproval, NewArtifact, NewMessage, NewTicket
from ..ids import utc_now
from ..records import serialize_venture
from .base import (
    ArtifactOutput,
    agent_row,
    approval_payload,
    generate_json,
    input_context,
)


class EvidenceRef(BaseModel):
    kind: Literal["artifact"]
    id: str


class Decision(BaseModel):
    verdict: Literal["proceed", "revise", "kill"]
    confidence: float = Field(ge=0, le=1)
    reasons_for: list[str]
    reasons_against: list[str]
    evidence: list[EvidenceRef]
    proposed_revision: str = ""
    summary: str


class PivotHandler:
    ticket_types = ("decision.review",)

    async def handle(self, ticket, ctx):
        if ctx.approval_result is not None:
            prior = await approval_payload(ctx, "pivot")
            if ctx.approval_result["status"] == "approved":
                return await proceed_override(ctx)
            if prior["verdict"] == "revise":
                return HandlerResult(outcome="done", note="Founder requested a revised brief.", result={"verdict": "revise", "supersedes_generation": ticket.get("generation", 1)}, new_tickets=[NewTicket(type="brief", title="Revised venture brief", body=prior["proposed_revision"], payload={"revision": prior["proposed_revision"], "generation": ticket.get("generation", 1) + 1})])
            async with ctx.db.tx() as tx:
                await tx.execute("UPDATE ventures SET status='paused',updated_at=? WHERE id=?", (utc_now(), ctx.venture["id"]))
                venture = await tx.fetch_one("SELECT * FROM ventures WHERE id=?", (ctx.venture["id"],))
                await bus.emit(tx, venture_id=ctx.venture["id"], type="venture.updated", entity_kind="venture", entity_id=ctx.venture["id"], data=serialize_venture(venture))
            return HandlerResult(outcome="done", note="Venture paused after founder rejected proceeding.", result={"verdict": "kill"})
        prompt = await input_context(ticket, ctx)
        risks = await generate_json(ctx, "dept_artifact", prompt + "\nWrite the risk register first.", ArtifactOutput, agent=await agent_row(ctx, "pv.risk-assessor"))
        decision = await generate_json(ctx, "decision_review", prompt + "\nRISK REGISTER:\n" + risks.content_md, Decision)
        for ref in decision.evidence:
            if not await ctx.db.fetch_one("SELECT id FROM artifacts WHERE id=? AND venture_id=?", (ref.id, ctx.venture["id"])):
                raise ValueError("Decision evidence must reference existing venture artifacts")
        if decision.verdict == "revise" and not decision.proposed_revision.strip():
            raise ValueError("A revise verdict must supply a concrete revision")
        artifacts = [NewArtifact(kind="doc", title=risks.title, summary=risks.summary, content_md=risks.content_md),
                     NewArtifact(kind="decision", title=f"Decision: {decision.verdict}", summary=decision.summary, content_md=decision.model_dump_json(indent=2), meta=decision.model_dump())]
        if decision.verdict in ("revise", "kill"):
            return HandlerResult(outcome="waiting_approval", artifacts=artifacts, approval=NewApproval(gate_type="pivot", title=f"Proceed despite {decision.verdict} recommendation?", summary=decision.summary, payload={"verdict": decision.verdict, "reasons": decision.reasons_against, "evidence": [r.model_dump() for r in decision.evidence], "proposed_revision": decision.proposed_revision}))
        return HandlerResult(outcome="done", artifacts=artifacts, result=decision.model_dump(), messages=[NewMessage(channel_slug="exec", body=f"Decision: proceed ({decision.confidence:.2f}). {decision.summary}", kind="decision")])


async def proceed_override(ctx):
    """Named gate boundary for overriding a revise/kill recommendation."""
    from ..gates import require_approved
    approval = await require_approved(ctx.db, ctx.approval_result["approval_id"], "pivot")
    if approval["venture_id"] != ctx.venture["id"]:
        raise ValueError("Pivot approval belongs to another venture")
    return HandlerResult(outcome="done", note="Founder chose to proceed despite the pivot recommendation.", result={"verdict": "proceed", "override": True})
