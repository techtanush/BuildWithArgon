# OWNER: tanush — seed version; replace/extend freely but keep the public signatures.

"""Validated Chief-of-Staff plans, with the contractual DAG as a visible fallback."""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from .contracts import HandlerResult, NewArtifact, NewMessage, NewTicket
from .llm.jsonout import parse_model
from .records import TICKET_DEFAULTS
from .seed import load_roster

SKELETON: dict[str, tuple[str, ...]] = {
    "finance.budget": (), "research.market": (), "research.competitors": (),
    "validation.synthetic_panel": (), "validation.interview_plan": (),
    "decision.review": ("research.market", "research.competitors", "validation.synthetic_panel"),
    "eng.design": ("decision.review",), "growth.positioning": ("decision.review",),
    "leads.icp": ("growth.positioning",),
    "sales.proposal": ("growth.positioning", "leads.icp"),
    "growth.launch_plan": ("growth.positioning",),
    "cos.report": (),
}
SKELETON["cos.report"] = tuple(key for key in SKELETON if key != "cos.report")


class PlanTicket(BaseModel):
    ref: str = Field(min_length=1, max_length=100)
    type: str
    title: str = Field(min_length=1, max_length=200)
    body: str = ""
    depends_on: list[str] = Field(default_factory=list)
    priority: int = Field(default=2, ge=0, le=3)
    requires_capability: str | None = None


class CompanyPlan(BaseModel):
    summary: str = ""
    tickets: list[PlanTicket] = Field(min_length=12, max_length=40)


def skeleton_plan(name: str) -> dict[str, Any]:
    return {"summary": "The contractual company plan (model output did not pass validation).",
            "tickets": [{"ref": kind, "type": kind, "title": f"{kind.replace('.', ' ').title()} for {name}",
                         "body": f"Complete {kind} for the founder's stated idea and cite the provided records.",
                         "depends_on": list(deps), "priority": 2, "requires_capability": None}
                        for kind, deps in SKELETON.items()]}


def validate_plan(plan: dict[str, Any] | CompanyPlan) -> CompanyPlan:
    parsed = plan if isinstance(plan, CompanyPlan) else CompanyPlan.model_validate(plan)
    refs = {ticket.ref: ticket for ticket in parsed.tickets}
    if len(refs) != len(parsed.tickets):
        raise ValueError("Plan refs must be unique")
    counts = Counter(ticket.type for ticket in parsed.tickets)
    if any(counts[kind] != 1 for kind in SKELETON):
        raise ValueError("Every skeleton ticket type must appear exactly once")
    if any(ticket.type not in TICKET_DEFAULTS for ticket in parsed.tickets):
        raise ValueError("The plan contains an unknown ticket type")
    by_type = {ticket.type: ticket.ref for ticket in parsed.tickets}
    for ticket in parsed.tickets:
        if any(ref not in refs for ref in ticket.depends_on):
            raise ValueError("Plan dependency does not resolve to a ref")
        required = SKELETON.get(ticket.type, ())
        if ticket.type == "cos.report":
            required_refs = set(refs) - {ticket.ref}
        else:
            required_refs = {by_type[kind] for kind in required}
        if not required_refs.issubset(ticket.depends_on):
            raise ValueError(f"{ticket.type} does not respect the skeleton dependencies")
    done: set[str] = set()
    visiting: set[str] = set()

    def visit(ref: str) -> None:
        if ref in visiting:
            raise ValueError("Plan dependencies form a cycle")
        if ref in done:
            return
        visiting.add(ref)
        for dependency in refs[ref].depends_on:
            visit(dependency)
        visiting.remove(ref)
        done.add(ref)

    for ref in refs:
        visit(ref)
    return parsed


async def build_plan(ctx: Any) -> tuple[dict[str, Any], list[NewTicket]]:
    roster = load_roster()
    capabilities: dict[str, list[str]] = {}
    for agent in roster["agents"]:
        capabilities.setdefault(agent["department_id"], []).extend(agent.get("capabilities", []))
    capabilities = {key: sorted(set(values)) for key, values in capabilities.items()}
    prompt_path = Path(__file__).parent / "departments" / "prompts" / "cos.orchestrator.md"
    system = prompt_path.read_text() if prompt_path.exists() else "Plan the company's work as a dependency graph. Return only JSON."
    prompt = json.dumps({"venture": ctx.venture, "context": await ctx.context_for(["brief", "spec"]),
                         "capabilities_by_department": capabilities, "skeleton": SKELETON,
                         "required_output": CompanyPlan.model_json_schema()}, default=str)
    parsed: CompanyPlan | None = None
    previous = None
    for attempt in range(2):
        result = await ctx.llm.generate("orchestrate_plan", prompt, system=system, previous_interaction_id=previous)
        previous = result.interaction_id
        try:
            parsed = validate_plan(parse_model(result.text, CompanyPlan))
            break
        except ValueError as exc:
            await ctx.log("warn", f"Plan validation attempt {attempt + 1}: {exc}")
            prompt = f"Correct your previous plan. Validation failed: {exc}. Return ONLY valid JSON. Schema: {CompanyPlan.model_json_schema()}. Required skeleton: {json.dumps(SKELETON)}"
    if parsed is None:
        parsed = validate_plan(skeleton_plan(ctx.venture["name"]))
        await ctx.log("warn", "Using the contractual skeleton after one model repair attempt")
    tickets = [NewTicket(type=t.type, title=t.title, body=t.body, priority=t.priority, ref=t.ref,
                         depends_on=[f"ref:{ref}" for ref in t.depends_on],
                         payload={"requires_capability": t.requires_capability} if t.requires_capability else {})
               for t in parsed.tickets]
    return parsed.model_dump(), tickets


async def plan(ticket: dict[str, Any], ctx: Any) -> HandlerResult:
    document, tickets = await build_plan(ctx)
    departments = {TICKET_DEFAULTS[t.type][0] for t in tickets}
    first = [t.title for t in tickets if not t.depends_on][:3]
    return HandlerResult(outcome="done", note=document["summary"], result={"plan": document},
        artifacts=[NewArtifact(kind="plan", title=f"Company plan for {ctx.venture['name']}", summary=document["summary"][:280],
                               content_md="## Company plan\n\n" + document["summary"] + "\n\n" + "\n".join(f"- {t.title}" for t in tickets), meta=document)],
        new_tickets=tickets, messages=[NewMessage(channel_slug="exec", kind="decision",
            body=f"Plan for \"{ctx.venture['name']}\": {len(tickets)} tickets across {len(departments)} departments. First up: {', '.join(first)}.")])
