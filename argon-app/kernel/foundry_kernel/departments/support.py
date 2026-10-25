# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.

"""support.issue handler. Spec: 03-company-kernel/03-support-and-pr-loop.md. Seed: fake mode only."""
from __future__ import annotations

from typing import Any

from ..contracts import HandlerContext, HandlerResult, NewArtifact


class SupportHandler:
    ticket_types = ("support.issue",)

    async def handle(self, ticket: dict[str, Any], ctx: HandlerContext) -> HandlerResult:
        if ctx.settings.llm_mode == "fake":
            return HandlerResult(outcome="done", artifacts=[NewArtifact(kind="doc", title="Triage (fake): question")])
        raise NotImplementedError("ayan: support loop — see WORKORDER_AYAN.md")
