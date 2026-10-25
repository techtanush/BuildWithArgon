# OWNER: tanush
"""Ledger-backed projections and explicitly approved capability registration."""
from __future__ import annotations

import json
import re

from pydantic import BaseModel, Field, model_validator

from .. import bus
from ..contracts import HandlerResult, NewApproval, NewArtifact, NewMessage
from ..ids import utc_now
from ..records import json_loads, serialize_ticket
from .base import (
    ArtifactOutput,
    approval_payload,
    generate_json,
    input_context,
    payload,
)

SAFE_TOOLS = frozenset({"antigravity", "github", "antigravity_web", "cua", "directory_search", "ledger", "registry", "deep_research"})


class SmokeTest(BaseModel):
    input: str = Field(min_length=1)
    expected_properties: list[str] = Field(min_length=1)


class AgentDesign(BaseModel):
    id: str
    display_name: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=120)
    role_summary: str
    persona: str
    greeting: str = "Hello. I can help with my approved specialty."
    voice_hint: str = "clear, conversational"
    model_job: str = "dept_artifact"
    tools: list[str] = Field(default_factory=list)
    capabilities: list[str] = Field(min_length=1)
    instructions_md: str = Field(min_length=1)
    smoke_test: SmokeTest

    @model_validator(mode="after")
    def safe_definition(self):
        if not re.fullmatch(r"gen\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*", self.id):
            raise ValueError("Generated agent ID must be gen.department.slug")
        if self.model_job != "dept_artifact":
            raise ValueError("Generated hires use the approved dept_artifact default job")
        if set(self.tools) - SAFE_TOOLS:
            raise ValueError("Generated tools must belong to the safe tool set")
        return self


class BudgetOutput(ArtifactOutput):
    projected_total_usd: float = Field(ge=0, allow_inf_nan=False)


async def validate_design(ctx, design: AgentDesign, department: str):
    if design.id.split(".")[1] != department:
        raise ValueError("Generated agent must belong to the blocked department")
    members = await ctx.db.fetch_all("SELECT tools_json FROM agents WHERE department_id=? AND (venture_id IS NULL OR venture_id=?)", (department, ctx.venture["id"]))
    allowed = {tool for member in members for tool in json_loads(member["tools_json"], [])}
    if set(design.tools) - allowed:
        raise ValueError("Generated tools must be a subset of department tools")


class FinancePeopleHandler:
    ticket_types = ("finance.budget", "people.hire")

    async def handle(self, ticket, ctx):
        if ticket["type"] == "people.hire":
            return await self.hire(ticket, ctx)
        if ctx.approval_result is not None:
            await approval_payload(ctx, "spend")
            return HandlerResult(outcome="done", note="Budget decision recorded by the founder.")
        ledger = await ctx.db.fetch_all("SELECT department_id,model,SUM(cost_usd) AS cost_usd FROM ledger WHERE venture_id=? GROUP BY department_id,model", (ctx.venture["id"],))
        output = await generate_json(ctx, "dept_artifact", await input_context(ticket, ctx) + "\nACTUAL LEDGER:\n" + json.dumps(ledger) + f"\nBudget={ctx.venture['budget_usd']}; spent={ctx.venture['spent_usd']}. Project total; label assumptions.", BudgetOutput)
        spent = sum(r["cost_usd"] for r in ledger)
        artifact = NewArtifact(kind="budget", title=output.title, summary=output.summary, content_md=output.content_md + "\n\n## Actual ledger\n" + json.dumps(ledger), meta={"budget_usd": ctx.venture["budget_usd"], "spent_usd": spent, "projected_total_usd": output.projected_total_usd, "breakdown": ledger})
        if output.projected_total_usd < spent:
            raise ValueError("Projected total cannot be less than actual spend")
        if output.projected_total_usd > ctx.venture["budget_usd"]:
            return HandlerResult(outcome="waiting_approval", artifacts=[artifact], approval=NewApproval(gate_type="spend", title="Approve projected budget increase", summary=output.summary, payload={"budget_usd": ctx.venture["budget_usd"], "spent_usd": spent, "requested_increase_usd": output.projected_total_usd-ctx.venture["budget_usd"], "breakdown": ledger}))
        return HandlerResult(outcome="done", artifacts=[artifact])

    async def hire(self, ticket, ctx):
        data = payload(ticket)
        if ctx.approval_result is None:
            design = AgentDesign.model_validate(data["agent"])
            blocked = await ctx.db.fetch_one("SELECT * FROM tickets WHERE id=? AND venture_id=?", (data["blocked_ticket_id"], ctx.venture["id"]))
            if blocked is None:
                raise ValueError("Hire must reference a blocked ticket in this venture")
            await validate_design(ctx, design, blocked["department_id"])
            smoke = data.get("smoke_test_result", {})
            if smoke.get("passed") is not True:
                raise ValueError("A failed or missing smoke test cannot be submitted for hiring")
            summary = await generate_json(ctx, "dept_artifact", await input_context(ticket, ctx) + "\nDescribe this proposed hire, safe tools, smoke test evidence and cost implications.\n" + json.dumps(data), ArtifactOutput)
            return HandlerResult(outcome="waiting_approval", approval=NewApproval(gate_type="new_capability", title=f"Hire {design.display_name}: {design.title}", summary=summary.summary, payload={"agent": design.model_dump(), "smoke_test_result": smoke, "blocked_ticket_id": blocked["id"]}))
        prior = await approval_payload(ctx, "new_capability")
        design = AgentDesign.model_validate(prior["agent"])
        blocked = await ctx.db.fetch_one("SELECT * FROM tickets WHERE id=? AND venture_id=?", (prior["blocked_ticket_id"], ctx.venture["id"]))
        if blocked is None:
            raise ValueError("Blocked ticket no longer exists")
        await validate_design(ctx, design, blocked["department_id"])
        now = utc_now()
        async with ctx.db.tx() as tx:
            if ctx.approval_result["status"] != "approved":
                await tx.execute("UPDATE tickets SET status='failed',result_json=?,updated_at=?,completed_at=? WHERE id=?", (json.dumps({"note": "Founder rejected the capability hire"}), now, now, blocked["id"]))
            else:
                if prior.get("smoke_test_result", {}).get("passed") is not True:
                    raise ValueError("Approved hire is missing its passed smoke test")
                used = {r["npc_slot"] for r in await tx.fetch_all("SELECT npc_slot FROM agents WHERE department_id=? AND (venture_id IS NULL OR venture_id=?)", (blocked["department_id"], ctx.venture["id"]))}
                slot = next((f"{blocked['department_id']}.s{n}" for n in range(5, 7) if f"{blocked['department_id']}.s{n}" not in used), None)
                if slot is None:
                    n = 1
                    while f"plaza.overflow-{n}" in used:
                        n += 1
                    slot = f"plaza.overflow-{n}"
                await register_agent(tx, approval_id=ctx.approval_result["approval_id"], ctx=ctx, design=design, department_id=blocked["department_id"], slot=slot, now=now)
                approved = payload(blocked)
                approved["granted_capabilities"] = list(dict.fromkeys([*approved.get("granted_capabilities", []), *design.capabilities]))
                await tx.execute("UPDATE tickets SET status='open',assigned_agent_id=?,payload_json=?,updated_at=?,completed_at=NULL WHERE id=?", (design.id, json.dumps(approved), now, blocked["id"]))
                await bus.emit(tx, venture_id=ctx.venture["id"], type="agent.status", entity_kind="agent", entity_id=design.id, data={"agent_id": design.id, "status": "idle", "current_ticket_id": None})
            updated = await tx.fetch_one("SELECT * FROM tickets WHERE id=?", (blocked["id"],))
            await bus.emit(tx, venture_id=ctx.venture["id"], type="ticket.updated", entity_kind="ticket", entity_id=blocked["id"], data=await serialize_ticket(tx, updated))
        if ctx.approval_result["status"] != "approved":
            return HandlerResult(outcome="done", note="Hire rejected; blocked ticket failed.", messages=[NewMessage(channel_slug="exec", body="Capability hire rejected; blocked work needs a new plan.", refs=[{"kind": "ticket", "id": blocked["id"]}])])
        return HandlerResult(outcome="done", result={"agent_id": design.id}, messages=[NewMessage(channel_slug="all-hands", body=f"Welcome {design.display_name}, our new {design.title}.", kind="announcement", refs=[{"kind": "agent", "id": design.id}])])


async def register_agent(tx, *, approval_id: str, ctx, design: AgentDesign, department_id: str, slot: str, now: str):
    """The gated boundary for registering any generated capability."""
    from ..gates import require_approved
    approval = await require_approved(tx, approval_id, "new_capability")
    if approval["venture_id"] != ctx.venture["id"]:
        raise ValueError("Hire approval belongs to another venture")
    approved = json_loads(approval["payload_json"], {}).get("agent")
    if approved != design.model_dump():
        raise ValueError("Only the exact approved agent design can be registered")
    existing = await tx.fetch_one("SELECT venture_id FROM agents WHERE id=?", (design.id,))
    if existing:
        saved = await tx.fetch_one("SELECT value_json FROM kv WHERE key=?", (f"agent.design.{design.id}",))
        if existing["venture_id"] != ctx.venture["id"] or saved is None or json_loads(saved["value_json"], {}) != design.model_dump():
            raise ValueError("Generated agent ID is already registered to a different design")
        return  # Startup recovery may re-enter a hire committed before its ticket result.
    await tx.execute("INSERT INTO agents(id,venture_id,department_id,display_name,title,role_summary,model_job,tools_json,persona,npc_slot,is_lead,generated,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,1,?)", (design.id, ctx.venture["id"], department_id, design.display_name, design.title, design.role_summary, design.model_job, json.dumps(design.tools), design.persona, slot, now))
    await tx.execute("INSERT INTO agent_state(venture_id,agent_id,status) VALUES(?,?,'idle')", (ctx.venture["id"], design.id))
    await tx.execute("INSERT INTO kv(key,value_json,updated_at) VALUES(?,?,?)", (f"agent.design.{design.id}", design.model_dump_json(), now))
