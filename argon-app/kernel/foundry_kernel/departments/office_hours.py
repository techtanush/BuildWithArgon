# OWNER: tanush
"""Risk-weighted ambiguity review and clarification re-entry."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from ..contracts import HandlerResult, NewApproval, NewArtifact, NewMessage, NewTicket
from .base import approval_payload, generate_json, input_context


class Ambiguity(BaseModel):
    id: str
    issue: str
    proposed: str
    risk_if_wrong: Literal["low", "medium", "high"]
    why: str


class SkepticReview(BaseModel):
    verdict: Literal["clear", "needs_clarification"]
    ambiguities: list[Ambiguity] = Field(default_factory=list, max_length=5)
    summary: str

    @model_validator(mode="after")
    def unique_questions(self):
        if len({q.id for q in self.ambiguities}) != len(self.ambiguities) or any(not q.proposed.strip() for q in self.ambiguities):
            raise ValueError("Questions need unique IDs and concrete proposed interpretations")
        return self


class OfficeHoursHandler:
    ticket_types = ("review.skeptic",)

    async def handle(self, ticket, ctx):
        if ctx.approval_result is not None:
            prior = await approval_payload(ctx, "clarification")
            proposed = {q["id"]: q["proposed"] for q in prior["questions"]}
            answers = ctx.approval_result.get("answers", {})
            if set(answers) - proposed.keys():
                raise ValueError("Clarification answers contain unknown questions")
            note = "Founder declined to clarify; use proposed interpretations."
            if ctx.approval_result["status"] == "approved":
                proposed.update({key: value for key, value in answers.items() if value.strip()})
                note = ctx.approval_result.get("note", "")
            return self.next_spec(ticket, ctx, proposed, note)
        review = await generate_json(ctx, "dept_artifact", await input_context(ticket, ctx), SkepticReview)
        artifact = NewArtifact(kind="doc", title="Brief ambiguity review", summary=review.summary, content_md=review.model_dump_json(indent=2), meta=review.model_dump())
        questions = [q.model_dump() for q in review.ambiguities if q.risk_if_wrong in ("medium", "high")]
        if questions:
            return HandlerResult(outcome="waiting_approval", artifacts=[artifact],
                approval=NewApproval(gate_type="clarification", title=f"Clarify {len(questions)} questions", summary=review.summary, payload={"questions": questions}),
                messages=[NewMessage(channel_slug="dept-office-hours", body=f"@Jun {len(questions)} questions need {ctx.venture['founder_name']}; please frame them.", kind="delegation")])
        result = self.next_spec(ticket, ctx, {q.id: q.proposed for q in review.ambiguities}, "No medium/high risk ambiguities.")
        result.artifacts = [artifact]
        return result

    @staticmethod
    def next_spec(ticket, ctx, answers, note):
        source = {"clarification_answers": answers, "clarification_note": note}
        if ctx.approval_result:
            source["clarification_approval_id"] = ctx.approval_result["approval_id"]
        return HandlerResult(outcome="done", new_tickets=[NewTicket(type="spec.write", title=f"Write spec for {ctx.venture['name']}", payload=source)],
            messages=[NewMessage(channel_slug="dept-intake", body="@Theo spec time — clarifications are in.", kind="handoff", refs=[{"kind": "ticket", "id": ticket["id"]}])])
