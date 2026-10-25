# OWNER: tanush
"""Idea intake and validated engineering acceptance criteria."""
from __future__ import annotations

import re

from pydantic import BaseModel, Field, model_validator

from ..contracts import HandlerResult, NewArtifact, NewMessage, NewTicket
from .base import ArtifactOutput, generate_json, input_context, payload


class AcceptanceCriterion(BaseModel):
    id: str
    text: str


class SpecOutput(ArtifactOutput):
    acceptance_criteria: list[AcceptanceCriterion] = Field(min_length=5, max_length=15)

    @model_validator(mode="after")
    def observable_criteria(self):
        for n, ac in enumerate(self.acceptance_criteria, 1):
            if ac.id != f"AC-{n}":
                raise ValueError("Acceptance criteria must use consecutive AC-1..AC-n IDs")
            if len(ac.text.strip()) < 20 or not re.search(r"\b(when|given|if|input|click|submit|request|user)\b", ac.text, re.IGNORECASE) or not re.search(r"\b(return[s]?|display[s]?|show[s]?|render[s]?|save[s]?|contain[s]?|reject[s]?|create[s]?|update[s]?|remove[s]?|redirect[s]?|visible|equal[s]?|respond[s]?)\b", ac.text, re.IGNORECASE):
                raise ValueError(f"{ac.id} must state an observable input and expected output")
        return self


class IntakeHandler:
    ticket_types = ("brief", "spec.write")

    async def handle(self, ticket, ctx):
        prompt = await input_context(ticket, ctx)
        if ticket["type"] == "brief":
            files = await ctx.db.fetch_all("SELECT name,excerpt FROM files WHERE venture_id=? ORDER BY created_at,id", (ctx.venture["id"],))
            prompt += "\nFOUNDER CONTEXT:\n" + "\n".join(f"FILE {r['name']}\n{r['excerpt']}" for r in files)[:200_000]
            output = await generate_json(ctx, "dept_artifact", prompt, ArtifactOutput)
            return HandlerResult(outcome="done", artifacts=[NewArtifact(kind="brief", title=output.title, summary=output.summary, content_md=output.content_md)],
                new_tickets=[NewTicket(type="review.skeptic", title=f"Review brief for {ctx.venture['name']}", payload={"generation": ticket.get("generation", 1)})],
                messages=[NewMessage(channel_slug="dept-office-hours", body="@Mara the brief is ready for review.", kind="handoff", refs=[{"kind": "ticket", "id": ticket["id"]}])])
        output = await write_spec(ticket, ctx, prompt)
        return HandlerResult(outcome="done", artifacts=[NewArtifact(kind="spec", title=output.title, summary=output.summary, content_md=output.content_md,
            meta={"acceptance_criteria": [a.model_dump() for a in output.acceptance_criteria], "clarification_answers": payload(ticket).get("clarification_answers", {}), "clarification_note": payload(ticket).get("clarification_note", "")})],
            new_tickets=[NewTicket(type="plan.request", title=f"Plan company work for {ctx.venture['name']}")],
            messages=[NewMessage(channel_slug="exec", body=f"@Rhea spec is ready: {len(output.acceptance_criteria)} acceptance criteria.", kind="handoff", refs=[{"kind": "ticket", "id": ticket["id"]}])])


async def write_spec(ticket, ctx, prompt: str):
    """Write the specification after recording clarification interpretations."""
    from ..errors import ConflictError
    from ..gates import require_approved

    if await ctx.db.fetch_one("SELECT id FROM approvals WHERE venture_id=? AND gate_type='clarification' AND status='pending'", (ctx.venture["id"],)):
        raise ConflictError("The founder must decide pending clarifications before specification work")
    approval_id = payload(ticket).get("clarification_approval_id")
    if approval_id:
        approval = await ctx.db.fetch_one("SELECT * FROM approvals WHERE id=? AND venture_id=? AND gate_type='clarification'", (approval_id, ctx.venture["id"]))
        if approval is None or approval["status"] not in ("approved", "rejected"):
            raise ConflictError("Specification requires the recorded clarification decision")
        if approval["status"] == "approved":
            await require_approved(ctx.db, approval_id, "clarification")
        # Rejected clarification deliberately uses the recorded proposed answers.
        else:
            import json
            questions = json.loads(approval["payload_json"]).get("questions", [])
            if payload(ticket).get("clarification_answers") != {q["id"]: q["proposed"] for q in questions}:
                raise ConflictError("Rejected clarification must use the recorded proposed interpretations")
    return await generate_json(ctx, "spec_write", prompt + "\nClarification answers: " + str(payload(ticket).get("clarification_answers", {})), SpecOutput)
