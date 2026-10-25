# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.

"""Engineering & QA handler (eng.design, eng.build, eng.fix, eng.review, qa.verify).
Spec: 03-company-kernel/02-autonomous-engineering-loop.md. Seed: LLM_MODE=fake behaviour only, so the
company DAG can run end to end on every branch. KEEP the fake-mode branch when implementing live mode."""
from __future__ import annotations

from typing import Any

from ..contracts import (
    HandlerContext,
    HandlerResult,
    NewApproval,
    NewArtifact,
    NewMessage,
    NewTicket,
)


class EngineeringHandler:
    ticket_types = ("eng.design", "eng.build", "eng.fix", "eng.review", "qa.verify")

    async def handle(self, ticket: dict[str, Any], ctx: HandlerContext) -> HandlerResult:
        if ctx.settings.llm_mode == "fake":
            return self._fake(ticket, ctx)
        raise NotImplementedError("ayan: live engineering loop — see WORKORDER_AYAN.md")

    def _fake(self, ticket: dict[str, Any], ctx: HandlerContext) -> HandlerResult:
        t = ticket["type"]
        if t == "eng.design":
            return HandlerResult(
                outcome="done",
                artifacts=[NewArtifact(kind="plan", title="Architecture (fake)", summary="One task.", content_md="## Overview\nFake design.")],
                new_tickets=[
                    NewTicket(type="eng.build", title="T1 (fake build)", ref="build:T1", assigned_agent_id="eng.builder"),
                    NewTicket(type="eng.review", title="Review T1", ref="review:T1", depends_on=["ref:build:T1"], assigned_agent_id="eng.reviewer"),
                    NewTicket(type="qa.verify", title="Verify T1", depends_on=["ref:review:T1"], assigned_agent_id="eng.qa"),
                ],
                messages=[NewMessage(channel_slug="dept-engineering", body="@Zara T1 is yours (fake).", kind="delegation")])
        if t in ("eng.build", "eng.fix"):
            return HandlerResult(outcome="done", result={"iterations": 1, "first_pass_passed": True, "tests_passed": 3, "tests_failed": 0},
                                 artifacts=[NewArtifact(kind="code", title=f"{ticket['title']} — code (fake)"),
                                            NewArtifact(kind="test_report", title="3/3 tests (fake)")])
        if t == "eng.review":
            return HandlerResult(outcome="done", artifacts=[NewArtifact(kind="doc", title="Review: approve (fake)")])
        if t == "qa.verify":
            if ctx.approval_result is None:
                return HandlerResult(outcome="waiting_approval",
                                     approval=NewApproval(gate_type="merge", title="Merge T1 (fake)", summary="3/3 tests, reviewed, verified.",
                                                          payload={"local": True, "tests": {"passed": 3, "failed": 0}}))
            return HandlerResult(outcome="done", note="merged (fake)")
        return HandlerResult(outcome="failed", note=f"unknown type {t}")
