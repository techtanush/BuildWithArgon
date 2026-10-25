# OWNER: tanush
"""Handler contracts: grounded output, gate re-entry and constrained delegation."""
from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from foundry_kernel import gates
from foundry_kernel.contracts import ComputerTaskResult
from foundry_kernel.departments.base import SYNTHETIC_LABEL, ArtifactHandler
from foundry_kernel.departments.chat import ChatReplyHandler
from foundry_kernel.departments.chief_of_staff import ChiefOfStaffHandler
from foundry_kernel.departments.finance_people import FinancePeopleHandler
from foundry_kernel.departments.intake import IntakeHandler, SpecOutput
from foundry_kernel.departments.office_hours import OfficeHoursHandler
from foundry_kernel.departments.pivot import PivotHandler
from foundry_kernel.departments.requests import RequestHandler
from foundry_kernel.ids import new_id, utc_now
from foundry_kernel.llm.fake import FakeLLM
from foundry_kernel.records import (
    TICKET_DEFAULTS,
    create_ticket,
    json_loads,
    serialize_runtime,
)


@pytest.fixture
async def context(db, settings):
    now, vid = utc_now(), new_id("ven")
    async with db.tx() as tx:
        await tx.execute("INSERT INTO ventures(id,name,slug,idea,founder_name,composio_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)", (vid, "Pantry Pal", vid, "Track pantry items", "Tanush", vid, now, now))
        await tx.execute("INSERT INTO agent_state(venture_id,agent_id) SELECT ?,id FROM agents", (vid,))
        for slug in ["exec", "all-hands", "incidents"] + ["dept-"+r["id"] for r in await tx.fetch_all("SELECT id FROM departments")]:
            kind = "department" if slug.startswith("dept-") else {"exec":"exec", "all-hands":"all_hands", "incidents":"incident"}[slug]
            await tx.execute("INSERT INTO channels(id,venture_id,slug,name,kind,created_at) VALUES(?,?,?,?,?,?)", (new_id("chn"),vid,slug,slug,kind,now))
    venture = await db.fetch_one("SELECT * FROM ventures WHERE id=?", (vid,))
    ctx = SimpleNamespace(db=db, settings=settings, llm=FakeLLM(), venture=venture, approval_result=None, run_id=None,
        context_for=AsyncMock(return_value="Known venture records only"), log=AsyncMock(), request=AsyncMock(return_value="tkt_request"),
        ask_agent=AsyncMock(), use_computer=AsyncMock(return_value=ComputerTaskResult(status="skipped", reason="No provider")))
    async def post(slug, body, refs=None, kind="status", thread_root_id=None):
        from foundry_kernel.departments.coordination import post_message
        async with db.tx() as tx:
            return await post_message(tx, venture_id=vid, channel_slug=slug, body=body, author_id=ctx.agent["id"], kind=kind, refs=refs, thread_root_id=thread_root_id)
    ctx.post = post
    return ctx


async def ticket(ctx, kind, *, payload=None, agent_id=None, department=None):
    dept, agent = TICKET_DEFAULTS.get(kind, (department, agent_id))
    async with ctx.db.tx() as tx:
        created = await create_ticket(tx,venture_id=ctx.venture["id"],type=kind,department_id=dept,title="Test task",payload=payload or {},assigned_agent_id=agent_id or agent)
    row = await ctx.db.fetch_one("SELECT * FROM tickets WHERE id=?", (created["id"],))
    ctx.agent = await ctx.db.fetch_one("SELECT * FROM agents WHERE id=?", (row["assigned_agent_id"],))
    ctx.ticket = row
    return row


async def decided(ctx, row, gate, payload, decision="approve", answers=None):
    async with ctx.db.tx() as tx:
        aid = await gates.request_approval(tx,venture_id=ctx.venture["id"],gate_type=gate,title="Decision",summary="Review",payload=payload,ticket_id=row["id"])
        await tx.execute("UPDATE tickets SET status='waiting_approval' WHERE id=?", (row["id"],))
    await gates.decide(ctx.db,aid,decision=decision,decided_by="Tanush",answers=answers)
    ctx.approval_result={"approval_id":aid,"status":"approved" if decision=="approve" else "rejected","answers":answers or {},"note":""}


async def test_brief_reads_context_files_and_hands_off(context):
    ctx=context
    row=await ticket(ctx,"brief")
    async with ctx.db.tx() as tx:
        await tx.execute("INSERT INTO files(id,venture_id,name,mime,size_bytes,path,excerpt,created_at) VALUES(?,?,?,'text/plain',1,'unused',?,?)", (new_id("fil"),ctx.venture["id"],"notes.txt","No barcode scanning",utc_now()))
    result=await IntakeHandler().handle(row,ctx)
    assert result.artifacts[0].kind=="brief" and result.new_tickets[0].type=="review.skeptic"
    assert "No barcode scanning" in ctx.llm.calls[0][1]


async def test_spec_carries_testable_acceptance_criteria(context):
    row=await ticket(context,"spec.write",payload={"clarification_answers":{"q1":"Local only"}})
    result=await IntakeHandler().handle(row,context)
    assert result.artifacts[0].kind=="spec" and len(result.artifacts[0].meta["acceptance_criteria"])==5
    assert result.artifacts[0].meta["clarification_answers"]=={"q1":"Local only"}
    assert result.new_tickets[0].type=="plan.request"


def test_spec_rejects_vague_or_duplicate_criteria():
    base={"title":"Spec","content_md":"Spec", "acceptance_criteria":[{"id":f"AC-{n}","text":"It should feel fast and useful."} for n in range(1,6)]}
    with pytest.raises(ValidationError,match="observable"):
        SpecOutput.model_validate(base)
    base["acceptance_criteria"]=[{"id":"AC-1","text":"When a user submits an item, the app displays the item."}]*5
    with pytest.raises(ValidationError,match="consecutive"):
        SpecOutput.model_validate(base)


async def test_skeptic_gates_medium_risk_then_uses_approved_answers_once(context):
    row=await ticket(context,"review.skeptic")
    review={"verdict":"needs_clarification","summary":"Scope matters","ambiguities":[{"id":"q1","issue":"Storage unclear","proposed":"Local storage","risk_if_wrong":"medium","why":"Affects scope"}]}
    context.llm.script("dept_artifact",[review])
    first=await OfficeHoursHandler().handle(row,context)
    assert first.outcome=="waiting_approval" and first.approval.gate_type=="clarification"
    await decided(context,row,"clarification",first.approval.payload,answers={"q1":"SQLite"})
    before=len(context.llm.calls)
    second=await OfficeHoursHandler().handle(row,context)
    assert len(context.llm.calls)==before
    assert second.new_tickets[0].payload["clarification_answers"]=={"q1":"SQLite"}


async def test_declined_clarification_keeps_proposed_interpretation(context):
    row=await ticket(context,"review.skeptic")
    await decided(context,row,"clarification",{"questions":[{"id":"q1","proposed":"Local only"}]},"reject",{"q1":"Unapproved override"})
    result=await OfficeHoursHandler().handle(row,context)
    assert result.new_tickets[0].payload["clarification_answers"]=={"q1":"Local only"}
    assert "declined" in result.new_tickets[0].payload["clarification_note"].lower()


async def test_pivot_revise_requires_gate_and_rejected_gate_restarts_generation(context):
    row=await ticket(context,"decision.review")
    context.llm.script("decision_review",[{"verdict":"revise","confidence":.6,"reasons_for":[],"reasons_against":["Scope too broad"],"evidence":[],"proposed_revision":"Start with manual entry only.","summary":"Reduce scope"}])
    first=await PivotHandler().handle(row,context)
    assert first.outcome=="waiting_approval" and first.approval.gate_type=="pivot"
    await decided(context,row,"pivot",first.approval.payload,"reject")
    second=await PivotHandler().handle(row,context)
    assert second.new_tickets[0].type=="brief" and second.new_tickets[0].payload["generation"]==2
    assert second.result["supersedes_generation"]==1


async def test_pivot_rejected_kill_pauses_venture(context):
    row=await ticket(context,"decision.review")
    await decided(context,row,"pivot",{"verdict":"kill"},"reject")
    await PivotHandler().handle(row,context)
    assert (await context.db.fetch_one("SELECT status FROM ventures WHERE id=?", (context.venture["id"],)))["status"]=="paused"


async def test_pivot_rejects_invented_evidence(context):
    row=await ticket(context,"decision.review")
    context.llm.script("decision_review",[{"verdict":"proceed","confidence":.8,"reasons_for":[],"reasons_against":[],"evidence":[{"kind":"artifact","id":"art_invented"}],"summary":"Unsupported"}])
    with pytest.raises(ValueError,match="existing venture artifacts"):
        await PivotHandler().handle(row,context)


async def test_projection_over_budget_opens_spend_gate(context):
    row=await ticket(context,"finance.budget")
    context.llm.script("dept_artifact",[{"title":"Budget","summary":"Estimate exceeds budget","content_md":"Estimated total","projected_total_usd":30}])
    result=await FinancePeopleHandler().handle(row,context)
    assert result.approval.gate_type=="spend" and result.approval.payload["requested_increase_usd"]==5
    assert result.artifacts[0].meta["spent_usd"]==0


async def test_synthetic_panel_has_exact24_rows_and_explicit_labels(context):
    row=await ticket(context,"validation.synthetic_panel")
    result=await ArtifactHandler().handle(row,context)
    dataset,report=result.artifacts
    assert len(dataset.meta["rows"])==24
    assert dataset.content_md.startswith(SYNTHETIC_LABEL) and report.content_md.startswith(SYNTHETIC_LABEL)
    assert {name for name,_ in context.llm.calls}=={"dept_artifact","panel_simulation"}


async def test_panel_rejects_wrong_persona_mapping(context):
    row=await ticket(context,"validation.synthetic_panel")
    from foundry_kernel.llm.fake import FIXTURES
    output=json.loads((FIXTURES/"panel_simulation.json").read_text())[0]
    output["rows"][0]["profile"]="Wrong persona"
    context.llm.script("panel_simulation",[output])
    with pytest.raises(ValueError,match="match the designed personas"):
        await ArtifactHandler().handle(row,context)


async def test_interview_gate_keeps_email_unsent(context):
    row=await ticket(context,"validation.interview_plan")
    result=await ArtifactHandler().handle(row,context)
    assert result.outcome=="waiting_approval" and len(result.approval.payload["drafts"])==2
    await decided(context,row,"outreach",result.approval.payload)
    done=await ArtifactHandler().handle(row,context)
    assert done.result["sent"] is False and "sending is not enabled" in done.note


async def test_deep_research_failure_is_honest_and_model_cannot_override_mode(context):
    row=await ticket(context,"research.market")
    original=context.llm.generate
    async def generate(name,*args,**kwargs):
        if name=="deep_research":
            raise TimeoutError("Provider unavailable")
        return await original(name,*args,**kwargs)
    context.llm.generate=generate
    context.llm.script("dept_artifact",[{"title":"Report","summary":"No research","content_md":"Known records only","meta":{"research_mode":"live","sources":["https://invented.invalid"]}}])
    result=await ArtifactHandler().handle(row,context)
    assert result.artifacts[0].meta["research_mode"]=="no live web research"
    assert result.artifacts[0].meta["sources"]==[]
    assert result.artifacts[0].content_md.startswith("**No live web research.")


async def test_cua_pending_gate_is_adopted_without_retrying_provider(context):
    row=await ticket(context,"research.competitors")
    async with context.db.tx() as tx:
        aid=await gates.request_approval(tx,venture_id=context.venture["id"],gate_type="computer_action",title="Login",summary="Decision",ticket_id=row["id"])
    context.use_computer.return_value=ComputerTaskResult(status="waiting_approval",task_id="ctk_example")
    result=await ArtifactHandler().handle(row,context)
    assert result.outcome=="blocked" and result.result["waiting_existing_approval"]==aid
    assert not context.llm.calls


async def test_cua_skipped_uses_managed_agent_without_claiming_live_fake_results(context):
    row=await ticket(context,"research.competitors")
    result=await ArtifactHandler().handle(row,context)
    context.use_computer.assert_awaited_once()
    assert any(name=="antigravity" for name,_ in context.llm.calls)
    assert result.artifacts[0].meta["research_mode"]=="fake"


async def test_request_lead_can_delegate_only_to_own_subagents(context):
    row=await ticket(context,"agent.request",department="market-research",agent_id="mr.research-lead",payload={"from_agent_id":"gr.positioning-lead","need":"Competitor data"})
    context.llm.script("agent_request",[{"decision":"delegate","tickets":[{"type":"research.competitors","assign_to":"mr.competitor-analyst","title":"Profile competitor"}]}])
    result=await RequestHandler().handle(row,context)
    assert result.outcome=="done" and result.result["waiting_children"] is True
    assert result.new_tickets[0].assigned_agent_id=="mr.competitor-analyst"
    context.llm.script("agent_request",[{"decision":"delegate","tickets":[{"type":"eng.build","assign_to":"eng.builder","title":"Do someone else work"}]}])
    with pytest.raises(ValueError,match="own sub-agents"):
        await RequestHandler().handle(row,context)


async def test_chat_nonchief_cannot_reprioritize(context):
    row=await ticket(context,"chat.reply",department="engineering",agent_id="eng.builder")
    cid=(await context.db.fetch_one("SELECT id FROM channels WHERE venture_id=? AND slug='exec'", (context.venture["id"],)))["id"]
    mid=await context.post("exec","Question",kind="human")
    row["payload_json"]=json.dumps({"channel_id":cid,"thread_root_id":mid})
    context.llm.script("talk",[{"text":"Changing priority","citations":[],"actions":[{"type":"reprioritize","ticket_id":row["id"],"priority":0}]}])
    with pytest.raises(ValueError,match="Only the Chief"):
        await ChatReplyHandler().handle(row,context)
    assert (await context.db.fetch_one("SELECT priority FROM tickets WHERE id=?", (row["id"],)))["priority"]==2


async def test_chat_citation_must_be_exact_and_same_venture(context):
    row=await ticket(context,"chat.reply",department="engineering",agent_id="eng.builder")
    cid=(await context.db.fetch_one("SELECT id FROM channels WHERE venture_id=? AND slug='exec'", (context.venture["id"],)))["id"]
    mid=await context.post("exec","Question",kind="human")
    row["payload_json"]=json.dumps({"channel_id":cid,"thread_root_id":mid})
    context.llm.script("talk",[{"text":"Invented claim","citations":[{"kind":"ticket","id":row["id"],"quote":"Invented completed work","label":"ticket"}]}])
    with pytest.raises(ValueError,match="exact, nonempty"):
        await ChatReplyHandler().handle(row,context)


async def test_hire_is_gated_then_registers_safe_agent_and_unblocks_work(context):
    blocked=await ticket(context,"eng.build",payload={"requires_capability":"pdf_export"})
    async with context.db.tx() as tx:
        await tx.execute("UPDATE tickets SET status='blocked' WHERE id=?", (blocked["id"],))
    gap=await ticket(context,"capability.gap",payload={"capability":"pdf_export","description":"Export needed","blocked_ticket_id":blocked["id"],"blocked_department":"engineering"})
    design=await ChiefOfStaffHandler().handle(gap,context)
    hire=await ticket(context,"people.hire",payload=design.new_tickets[0].payload)
    first=await FinancePeopleHandler().handle(hire,context)
    assert first.outcome=="waiting_approval"
    assert await context.db.fetch_one("SELECT id FROM agents WHERE id='gen.engineering.pdf-export'") is None
    await decided(context,hire,"new_capability",first.approval.payload)
    result=await FinancePeopleHandler().handle(hire,context)
    agent=await context.db.fetch_one("SELECT * FROM agents WHERE id=?", (result.result["agent_id"],))
    assert agent["model_job"]=="dept_artifact" and agent["npc_slot"]=="engineering.s5"
    assert serialize_runtime(agent)["jobs"][0]["job"]=="dept_artifact"
    work=await context.db.fetch_one("SELECT * FROM tickets WHERE id=?", (blocked["id"],))
    assert work["status"]=="open" and work["assigned_agent_id"]==agent["id"]
    assert "pdf_export" in json_loads(work["payload_json"],{})["granted_capabilities"]
    assert await context.db.fetch_one("SELECT value_json FROM kv WHERE key=?", (f"agent.design.{agent['id']}",))


async def test_failed_capability_smoke_test_never_opens_hire(context):
    blocked=await ticket(context,"eng.build")
    gap=await ticket(context,"capability.gap",payload={"capability":"pdf_export","description":"Export","blocked_ticket_id":blocked["id"],"blocked_department":"engineering"})
    context.llm.script("check_citation",[{"passed":False,"reason":"Missing expected document"}])
    result=await ChiefOfStaffHandler().handle(gap,context)
    assert result.outcome=="failed" and not result.new_tickets


async def test_standup_authors_real_lead_updates_and_persists_thread(context):
    await ticket(context,"brief")
    row=await ticket(context,"cos.standup")
    result=await ChiefOfStaffHandler().handle(row,context)
    root=result.result["root_message_id"]
    replies=await context.db.fetch_all("SELECT * FROM messages WHERE thread_root_id=?", (root,))
    assert {r["author_id"] for r in replies}>={"intake.brief-lead","cos.orchestrator"}
    assert {name for name,_ in context.llm.calls}>={"standup_update","cos_report"}
    marker=await context.db.fetch_one("SELECT value_json FROM kv WHERE key=?", (f"standup.latest.{context.venture['id']}",))
    assert json_loads(marker["value_json"],{})["root_message_id"]==root


async def test_spec_cannot_bypass_pending_clarification_gate(context):
    review=await ticket(context,"review.skeptic")
    async with context.db.tx() as tx:
        await gates.request_approval(tx,venture_id=context.venture["id"],gate_type="clarification",title="Medium risk scope",summary="Decide first",ticket_id=review["id"],payload={"questions":[{"id":"q1","proposed":"Local only"}]})
    direct=await ticket(context,"spec.write")
    from foundry_kernel.errors import ConflictError
    with pytest.raises(ConflictError,match="pending clarifications"):
        await IntakeHandler().handle(direct,context)
    assert not context.llm.calls
