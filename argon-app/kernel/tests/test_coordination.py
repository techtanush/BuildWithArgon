# OWNER: tanush
"""Cited asks, department requests, spend-safe accounting, standups and escalation."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from pydantic import BaseModel

from foundry_kernel import ledger
from foundry_kernel.contracts import HandlerResult, LLMResult, NewTicket
from foundry_kernel.db import json_loads_or
from foundry_kernel.departments.coordination import RuntimeContext, TrackedLLM
from foundry_kernel.errors import ConflictError
from foundry_kernel.ids import new_id, utc_now
from foundry_kernel.llm.fake import FakeLLM
from foundry_kernel.records import create_ticket, get_row
from tests.test_scheduler import add_ticket, company


async def context(db, settings, *, agent_id="gr.positioning-lead", kind="growth.positioning", llm=None):
    vid, scheduler = await company(db, settings, llm)
    agent = await get_row(db, "agents", agent_id)
    async with db.tx() as tx:
        ticket = await create_ticket(tx, venture_id=vid, type=kind, department_id=agent["department_id"], title="Work", assigned_agent_id=agent_id)
        rid = new_id("run")
        await tx.execute("UPDATE tickets SET status='in_progress',attempts=1 WHERE id=?", (ticket["id"],))
        await tx.execute("INSERT INTO runs(id,venture_id,ticket_id,agent_id,kind,job,model,status,created_at) VALUES(?,?,?,?,'ticket','dept_artifact','fake','running',?)", (rid, vid, ticket["id"], agent_id, utc_now()))
    ticket = await get_row(db, "tickets", ticket["id"])
    venture = await get_row(db, "ventures", vid)
    ctx = RuntimeContext(db=db, llm=scheduler.app.state.llm, settings=settings, venture=venture, agent=agent, run_id=rid, ticket=ticket)
    return ctx, scheduler


async def test_asks_produce_cited_threads_and_stop_after_three(db, settings):
    llm = FakeLLM()
    ctx, _ = await context(db, settings, llm=llm)
    aid = new_id("art")
    async with db.tx() as tx:
        await tx.execute("INSERT INTO artifacts(id,venture_id,department_id,kind,title,content_md,created_at) VALUES(?,?,'market-research','research','Pricing','Their price is $2 per month.',?)", (aid, ctx.venture["id"], utc_now()))
    llm.script("talk", [{"text": "Their price is $2 per month.", "citations": [{"kind": "artifact", "id": aid, "quote": "Their price is $2 per month."}]}] * 3)
    for _ in range(3):
        answer = await ctx.ask_agent("mr.research-lead", "What is their price?")
        assert answer.check.status == "verified" and answer.citations[0].id == aid
    with pytest.raises(ConflictError, match="three"):
        await ctx.ask_agent("mr.research-lead", "One more?")
    messages = await db.fetch_all("SELECT * FROM messages WHERE venture_id=? ORDER BY created_at,id", (ctx.venture["id"],))
    roots = [m for m in messages if json_loads_or(m["meta_json"], {})["kind"] == "ask"]
    answers = [m for m in messages if json_loads_or(m["meta_json"], {})["kind"] == "answer"]
    assert len(roots) == len(answers) == 3
    assert {m["thread_root_id"] for m in answers} == {m["id"] for m in roots}
    assert all(aid in m["refs_json"] for m in answers)


async def test_ask_refuses_cross_venture_target_and_never_returns_unsupported_claims(db, settings):
    llm = FakeLLM()
    ctx, _ = await context(db, settings, llm=llm)
    llm.script("talk", [{"text": "Invented claim", "citations": [{"kind": "artifact", "id": "missing", "quote": "claim"}]}])
    answer = await ctx.ask_agent("mr.research-lead", "Unknown fact?")
    assert answer.check.status == "unsupported" and not answer.citations and "Invented claim" not in answer.text


async def test_request_goes_to_target_lead_with_visible_record_and_bounded_redirects(db, settings):
    ctx, _ = await context(db, settings)
    tid = await ctx.request("market-research", "Two pricing sources", "Positioning evidence")
    ticket = await get_row(db, "tickets", tid)
    assert ticket["assigned_agent_id"] == "mr.research-lead" and ticket["created_by"] == ctx.agent["id"]
    data = json_loads_or(ticket["payload_json"], {})
    assert data["from_agent_id"] == ctx.agent["id"] and data["redirects"] == 0
    assert await db.fetch_one("SELECT id FROM messages WHERE venture_id=? AND meta_json LIKE '%request%'", (ctx.venture["id"],))
    ctx.ticket = ticket
    redirected = await ctx.request("outreach", "Need interviews")
    assert json_loads_or((await get_row(db, "tickets", redirected))["payload_json"], {})["redirects"] == 1
    ctx.ticket = await get_row(db, "tickets", redirected)
    second = await ctx.request("sales", "Need examples")
    ctx.ticket = await get_row(db, "tickets", second)
    with pytest.raises(ConflictError, match="twice"):
        await ctx.request("growth", "Loop")


async def test_agent_request_answer_delegate_decline_and_children_wait(db, settings):
    llm = FakeLLM()
    vid, scheduler = await company(db, settings, llm)
    llm.script("agent_request", [
        {"decision": "answer", "text": "No recorded market facts yet", "citations": []},
        {"decision": "decline", "reason": "Outside our department"},
        {"decision": "delegate", "tickets": [{"type": "research.competitors", "assign_to": "mr.competitor-analyst", "title": "Profile competitors"}]},
    ])
    requests = []
    for _ in range(3):
        async with db.tx() as tx:
            req = await create_ticket(tx, venture_id=vid, type="agent.request", department_id="market-research", title="Need evidence", payload={"from_agent_id": "gr.positioning-lead", "need": "Evidence"})
        requests.append(req)
        await scheduler.dispatch(req["id"])
        await scheduler.tasks[req["id"]]
    assert (await get_row(db, "tickets", requests[0]["id"]))["status"] == "done"
    assert (await get_row(db, "tickets", requests[1]["id"]))["status"] == "done"
    delegated = await get_row(db, "tickets", requests[2]["id"])
    assert delegated["status"] == "blocked"
    children = await db.fetch_all("SELECT * FROM tickets WHERE parent_ticket_id=?", (delegated["id"],))
    assert len(children) == 1 and children[0]["assigned_agent_id"] == "mr.competitor-analyst"
    # A failed child still re-enters the lead to report an honest partial result.
    async with db.tx() as tx:
        await tx.execute("UPDATE tickets SET status='failed',completed_at=? WHERE id=?", (utc_now(), children[0]["id"]))
    await scheduler._resolve_dependencies()
    assert (await get_row(db, "tickets", delegated["id"]))["status"] == "open"
    await scheduler.dispatch(delegated["id"])
    await scheduler.tasks[delegated["id"]]
    final = await get_row(db, "tickets", delegated["id"])
    assert final["status"] == "done" and json_loads_or(final["result_json"], {})["partial"] is True
    assert await db.fetch_one("SELECT id FROM messages WHERE venture_id=? AND meta_json LIKE '%handoff%'", (vid,))


async def test_standup_timer_requires_activity_and_escalates_once(db, settings):
    vid, scheduler = await company(db, settings)
    old = (datetime.now(UTC) - timedelta(minutes=40)).isoformat().replace("+00:00", "Z")
    changed = (datetime.now(UTC) - timedelta(minutes=25)).isoformat().replace("+00:00", "Z")
    ticket = await add_ticket(db, vid)
    async with db.tx() as tx:
        await tx.execute("UPDATE ventures SET created_at=? WHERE id=?", (old, vid))
        await tx.execute("UPDATE tickets SET status='blocked',created_at=?,updated_at=? WHERE id=?", (old, changed, ticket["id"]))
    await scheduler.maintenance()
    await scheduler.maintenance()
    assert len(await db.fetch_all("SELECT id FROM tickets WHERE venture_id=? AND type='cos.standup'", (vid,))) == 1
    messages = await db.fetch_all("SELECT body FROM messages WHERE venture_id=? AND body LIKE '@Rhea%'", (vid,))
    assert len(messages) == 1
    blocker = await db.fetch_one("SELECT value_json FROM kv WHERE key=?", (f"standup.blockers.{vid}",))
    assert json_loads_or(blocker["value_json"], [])[0]["ticket_id"] == ticket["id"]
    # An unchanged company does not create another standup after the interval.
    async with db.tx() as tx:
        await tx.execute("UPDATE tickets SET status='done' WHERE venture_id=? AND type='cos.standup'", (vid,))
    await scheduler.maintenance(datetime.now(UTC) + timedelta(minutes=31))
    assert len(await db.fetch_all("SELECT id FROM tickets WHERE venture_id=? AND type='cos.standup'", (vid,))) == 1


async def test_standup_posts_each_active_lead_and_rhea_decisions_with_exact_jobs(db, settings):
    llm = FakeLLM()
    vid, scheduler = await company(db, settings, llm)
    await add_ticket(db, vid, "brief")
    await add_ticket(db, vid, "growth.positioning")
    standup = await add_ticket(db, vid, "cos.standup")
    await scheduler.dispatch(standup["id"])
    await scheduler.tasks[standup["id"]]
    assert (await get_row(db, "tickets", standup["id"]))["status"] == "done"
    marker = await db.fetch_one("SELECT value_json FROM kv WHERE key=?", (f"standup.latest.{vid}",))
    result = json_loads_or(marker["value_json"], {})
    assert {r["agent_id"] for r in result["updates"]} == {"intake.brief-lead", "gr.positioning-lead"}
    assert result["decisions"]["agent_id"] == "cos.orchestrator"
    assert [job for job, _ in llm.calls].count("standup_update") == 2
    assert "cos_report" in [job for job, _ in llm.calls]
    messages = await db.fetch_all("SELECT * FROM messages WHERE thread_root_id=?", (result["root_message_id"],))
    assert len(messages) == 3


async def test_tracked_json_delegates_native_schema_and_preserves_each_adapter_charge(db, settings):
    ctx, _ = await context(db, settings)
    class Output(BaseModel):
        title: str
    calls = []
    class NativeJSONClient:
        async def generate(self, *args, **kwargs):
            raise AssertionError("Native JSON generation must not be replaced by text generation")

        async def generate_json(self, job, prompt, schema, **kwargs):
            calls.append((job, prompt, schema, kwargs))
            # A real adapter owns every provider attempt, including invalid output
            # and a repair. Its public return value describes only the final call.
            for cost in (0.2, 0.3):
                async with db.tx() as tx:
                    await ledger.record(tx, venture_id=kwargs["venture_id"], run_id=kwargs["run_id"],
                        kind="model", model="native", cost_usd=cost, units_in=4, units_out=2, estimated=False)
            result = LLMResult(text='{"title":"Native"}', interaction_id="native-repair", model="native", cost_usd=0.3, tokens_in=4, tokens_out=2)
            return schema(title="Native"), result

    tracked = TrackedLLM(db, NativeJSONClient(), settings, run_id=ctx.run_id, venture_id=ctx.venture["id"])
    output, result = await tracked.generate_json("dept_artifact", "Original task", Output, system="Use native schema")
    assert output.title == "Native" and result.interaction_id == "native-repair"
    assert calls[0][:3] == ("dept_artifact", "Original task", Output)
    assert calls[0][3]["system"] == "Use native schema"
    rows = await db.fetch_all("SELECT * FROM ledger WHERE run_id=?", (ctx.run_id,))
    assert len(rows) == 2 and sum(r["cost_usd"] for r in rows) == 0.5
    run = await get_row(db, "runs", ctx.run_id)
    assert run["interaction_id"] == "native-repair" and run["tokens_in"] == 8 and run["tokens_out"] == 4
    assert run["cost_usd"] == 0.5 and json_loads_or(run["output_text"], {}) == {"title": "Native"}


async def test_tracked_json_without_adapter_accounting_marks_final_only_usage_estimated(db, settings):
    ctx, _ = await context(db, settings)
    class Output(BaseModel):
        title: str
    llm = FakeLLM()
    llm.script("dept_artifact", [{"title": "Fake"}])
    tracked = TrackedLLM(db, llm, settings, run_id=ctx.run_id, venture_id=ctx.venture["id"])
    output, _ = await tracked.generate_json("dept_artifact", "Task", Output)
    assert output.title == "Fake"
    row = await db.fetch_one("SELECT * FROM ledger WHERE run_id=?", (ctx.run_id,))
    assert row["estimated"] == 1 and row["cost_usd"] == 0
    warning = await db.fetch_one("SELECT message FROM run_logs WHERE run_id=? AND level='warn'", (ctx.run_id,))
    assert "repair usage may be missing" in warning["message"]


async def test_tracked_model_accounting_ignores_tool_rows_but_preserves_adapter_charges(db, settings):
    ctx, _ = await context(db, settings)
    class ToolAccountingClient:
        async def generate(self, job, prompt, **kwargs):
            async with db.tx() as tx:
                await ledger.record(tx, venture_id=ctx.venture["id"], run_id=ctx.run_id, kind="tool", cost_usd=0.1)
            return LLMResult(text="ok", interaction_id="tool-call", model="native", cost_usd=0.2, tokens_in=3, tokens_out=2)
    tracked = TrackedLLM(db, ToolAccountingClient(), settings, run_id=ctx.run_id, venture_id=ctx.venture["id"])
    await tracked.generate("dept_artifact", "Tool and model cost separately")
    rows = await db.fetch_all("SELECT * FROM ledger WHERE run_id=?", (ctx.run_id,))
    assert len(rows) == 2 and {r["kind"] for r in rows} == {"tool", "model"}
    assert (await get_row(db, "runs", ctx.run_id))["cost_usd"] == pytest.approx(0.3)

    class AccountingClient:
        async def generate(self, job, prompt, **kwargs):
            async with db.tx() as tx:
                await ledger.record(tx, venture_id=ctx.venture["id"], run_id=ctx.run_id, kind="model", cost_usd=1, units_in=4, units_out=2)
            return LLMResult(text="ok", interaction_id="recorded", model="fake", tokens_in=4, tokens_out=2, cost_usd=1)
    tracked = TrackedLLM(db, AccountingClient(), settings, run_id=ctx.run_id, venture_id=ctx.venture["id"])
    await tracked.generate("dept_artifact", "accounted")
    rows = await db.fetch_all("SELECT * FROM ledger WHERE run_id=?", (ctx.run_id,))
    assert len(rows) == 3 and sum(r["cost_usd"] for r in rows) == pytest.approx(1.3)


async def test_tracked_llm_guard_prevents_raw_calls_after_cap_and_one_spend_gate(db, settings):
    ctx, _ = await context(db, settings)
    calls = []
    class Costly:
        async def generate(self, job, prompt, **kwargs):
            calls.append(prompt)
            return LLMResult(text="expensive", interaction_id="one", model="fake", cost_usd=26)
    tracked = TrackedLLM(db, Costly(), settings, run_id=ctx.run_id, venture_id=ctx.venture["id"])
    await tracked.generate("dept_artifact", "first")
    with pytest.raises(ConflictError, match="budget"):
        await tracked.generate("dept_artifact", "must not reach provider")
    assert calls == ["first"]
    assert len(await db.fetch_all("SELECT id FROM approvals WHERE venture_id=? AND gate_type='spend'", (ctx.venture["id"],))) == 1


async def test_tracked_llm_rejects_misattributed_run_before_contacting_provider(db, settings):
    ctx, _ = await context(db, settings)
    llm = FakeLLM()
    tracked = TrackedLLM(db, llm, settings, run_id=ctx.run_id)
    with pytest.raises(ConflictError, match="same venture"):
        await tracked.generate("dept_artifact", "Cannot charge a venture run globally")
    assert not llm.calls
    assert not await db.fetch_all("SELECT id FROM ledger WHERE run_id=?", (ctx.run_id,))


async def test_standalone_calls_publish_started_and_finished_on_success_and_failure(db, settings):
    tracked = TrackedLLM(db, FakeLLM(), settings)
    await tracked.generate("summarize", "hello")
    events = await db.fetch_all("SELECT type FROM events WHERE entity_kind='run'")
    assert [row["type"] for row in events] == ["run.started", "run.log", "run.finished"]
    class Failing:
        async def generate(self, *args, **kwargs):
            raise RuntimeError("provider unavailable")
    tracked = TrackedLLM(db, Failing(), settings)
    with pytest.raises(RuntimeError):
        await tracked.generate("summarize", "hello")
    runs = await db.fetch_all("SELECT * FROM runs ORDER BY created_at,id")
    assert {r["status"] for r in runs} == {"succeeded", "failed"}
    assert len(await db.fetch_all("SELECT id FROM events WHERE type='run.finished'")) == 2


async def test_no_cycle_after_dynamic_report_or_request_wait_edges(db, settings):
    vid, scheduler = await company(db, settings)
    parent = await add_ticket(db, vid, "eng.design")
    report = await add_ticket(db, vid, "cos.report")
    async with db.tx() as tx:
        await tx.execute("INSERT INTO ticket_deps VALUES(?,?)", (report["id"], parent["id"]))
        await tx.execute("UPDATE tickets SET status='in_progress',attempts=1 WHERE id=?", (parent["id"],))
        rid = new_id("run")
        await tx.execute("INSERT INTO runs(id,venture_id,ticket_id,kind,job,model,status,created_at) VALUES(?,?,?,'ticket','engineering_design','fake','running',?)", (rid, vid, parent["id"], utc_now()))
    with pytest.raises(ValueError, match="cycle"):
        await scheduler.apply_result(await get_row(db, "tickets", parent["id"]), rid, HandlerResult(outcome="done", new_tickets=[NewTicket(type="eng.build", title="Cyclic child", depends_on=[report["id"]])]))
    assert not await db.fetch_all("SELECT id FROM tickets WHERE parent_ticket_id=?", (parent["id"],))
    async with db.tx() as tx:
        request = await create_ticket(tx, venture_id=vid, type="agent.request", department_id="market-research", title="Request", payload={"from_agent_id": "gr.positioning-lead", "need": "Evidence"})
        await tx.execute("UPDATE tickets SET status='in_progress',attempts=1 WHERE id=?", (request["id"],))
        rid = new_id("run")
        await tx.execute("INSERT INTO runs(id,venture_id,ticket_id,kind,job,model,status,created_at) VALUES(?,?,?,'ticket','agent_request','fake','running',?)", (rid, vid, request["id"], utc_now()))
    with pytest.raises(ValueError, match="cycle"):
        await scheduler.apply_result(await get_row(db, "tickets", request["id"]), rid,
            HandlerResult(outcome="done", new_tickets=[NewTicket(type="research.competitors", title="Cyclic request child", depends_on=[request["id"]])]))
    assert not await db.fetch_all("SELECT id FROM tickets WHERE parent_ticket_id=?", (request["id"],))
