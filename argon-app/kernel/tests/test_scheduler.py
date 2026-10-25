# OWNER: tanush
"""Durable dispatch and the actual fake company, including human-controlled gates."""
from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI

from foundry_kernel import gates
from foundry_kernel import scheduler as module
from foundry_kernel.contracts import HandlerResult, NewApproval, NewArtifact
from foundry_kernel.db import json_loads_or
from foundry_kernel.ids import new_id, utc_now
from foundry_kernel.llm.fake import FakeLLM
from foundry_kernel.orchestrator import skeleton_plan, validate_plan
from foundry_kernel.records import TICKET_DEFAULTS, create_ticket, get_row
from foundry_kernel.scheduler import Scheduler


async def company(db, settings, llm=None, status="running"):
    vid, now = new_id("ven"), utc_now()
    async with db.tx() as tx:
        await tx.execute("INSERT INTO ventures(id,name,slug,idea,founder_name,status,composio_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
            (vid, "Pantry Pal", vid, "Track ingredients in a pantry", "Tanush", status, vid, now, now))
        for slug, kind in [("all-hands", "all_hands"), ("exec", "exec"), ("incidents", "incident")] + [(f"dept-{row['id']}", "department") for row in await tx.fetch_all("SELECT id FROM departments")]:
            await tx.execute("INSERT INTO channels(id,venture_id,slug,name,kind,created_at) VALUES(?,?,?,?,?,?)", (new_id("chn"), vid, slug, slug, kind, now))
    app = FastAPI()
    app.state.db, app.state.settings, app.state.llm = db, settings, llm or FakeLLM()
    return vid, Scheduler(app)


async def add_ticket(db, vid, type="brief", **kwargs):
    async with db.tx() as tx:
        return await create_ticket(tx, venture_id=vid, type=type, department_id=TICKET_DEFAULTS[type][0], title=kwargs.pop("title", type), **kwargs)


async def finish_tasks(scheduler):
    await asyncio.gather(*list(scheduler.tasks.values()))
    await scheduler.tick()


class ResultHandler:
    def __init__(self, result):
        self.result = result

    async def handle(self, ticket, ctx):
        return self.result


def test_plan_validator_rejects_missing_cycles_duplicate_refs_and_wrong_skeleton():
    assert len(validate_plan(skeleton_plan("Test")).tickets) == 12
    for mutate in (lambda p: p["tickets"].pop(),
                   lambda p: p["tickets"][0].update(ref=p["tickets"][1]["ref"]),
                   lambda p: p["tickets"][0].update(depends_on=["cos.report"]),
                   lambda p: p["tickets"][5].update(depends_on=[])):
        plan = skeleton_plan("Test")
        mutate(plan)
        with pytest.raises(ValueError):
            validate_plan(plan)


async def test_fake_venture_end_to_end(db, settings):
    vid, scheduler = await company(db, settings)
    await add_ticket(db, vid)
    deadline = asyncio.get_running_loop().time() + 10
    try:
        while asyncio.get_running_loop().time() < deadline:
            await scheduler.tick()
            for approval in await db.fetch_all("SELECT id FROM approvals WHERE venture_id=? AND status='pending'", (vid,)):
                await gates.decide(db, approval["id"], decision="approve", decided_by="test founder")
            report = await db.fetch_one("SELECT * FROM tickets WHERE venture_id=? AND type='cos.report' AND status='done'", (vid,))
            if report:
                break
            await asyncio.sleep(0.01)
        else:
            rows = await db.fetch_all("SELECT type,status,result_json FROM tickets WHERE venture_id=?", (vid,))
            pytest.fail(str(rows))
        tickets = await db.fetch_all("SELECT * FROM tickets WHERE venture_id=?", (vid,))
        assert all(t["status"] in {"done", "cancelled"} for t in tickets)
        qa = next(t for t in tickets if t["type"] == "qa.verify")
        assert report["completed_at"] >= qa["completed_at"]
        assert await db.fetch_one("SELECT id FROM artifacts WHERE venture_id=? AND kind='report'", (vid,))
        assert len(await db.fetch_all("SELECT DISTINCT department_id FROM artifacts WHERE venture_id=?", (vid,))) >= 10
        assert await db.fetch_all("SELECT * FROM ledger WHERE venture_id=?", (vid,))
        assert await db.fetch_one("SELECT id FROM messages WHERE venture_id=? AND meta_json LIKE '%handoff%'", (vid,))
    finally:
        await scheduler.stop()


async def test_limits_global_department_agent_and_one_engineering_build(db, settings, monkeypatch):
    settings.scheduler_concurrency = 4
    vid, scheduler = await company(db, settings)
    gate = asyncio.Event()

    class Blocking:
        async def handle(self, ticket, ctx):
            await gate.wait()
            return HandlerResult(outcome="done")

    monkeypatch.setattr(module, "load_handler", lambda kind: Blocking())
    for kind in ("eng.build", "eng.fix", "eng.review", "qa.verify", "brief", "spec.write", "finance.budget"):
        await add_ticket(db, vid, kind)
    try:
        await scheduler.tick()
        assert len(scheduler.tasks) == 4
        active = list(scheduler.running.values())
        assert sum(t["department_id"] == "engineering" for t in active) <= 2
        assert sum(t["type"] in {"eng.build", "eng.fix"} for t in active) <= 1
        assert len({t["assigned_agent_id"] for t in active}) == 4
    finally:
        await scheduler.stop()


async def test_gate_reentry_preserves_result_and_runs_second_pass(db, settings, monkeypatch):
    vid, scheduler = await company(db, settings)
    ticket = await add_ticket(db, vid)
    seen = []

    class Gated:
        async def handle(self, ticket, ctx):
            seen.append(ctx.approval_result)
            return HandlerResult(outcome="done", note="approved second pass") if ctx.approval_result else HandlerResult(outcome="waiting_approval", approval=NewApproval(gate_type="clarification", title="Clarify", summary="Question"))

    monkeypatch.setattr(module, "load_handler", lambda kind: Gated())
    await scheduler.tick()
    await asyncio.gather(*scheduler.tasks.values())
    approval = await db.fetch_one("SELECT * FROM approvals WHERE ticket_id=?", (ticket["id"],))
    assert (await get_row(db, "tickets", ticket["id"]))["status"] == "waiting_approval"
    await gates.decide(db, approval["id"], decision="approve", decided_by="Tanush", answers={"q1": "yes"})
    await finish_tasks(scheduler)
    await asyncio.gather(*scheduler.tasks.values())
    assert seen[0] is None and seen[1]["answers"] == {"q1": "yes"}
    assert (await get_row(db, "tickets", ticket["id"]))["status"] == "done"


async def test_failed_ticket_retries_with_backoff_then_final_incident(db, settings, monkeypatch):
    vid, scheduler = await company(db, settings)
    ticket = await add_ticket(db, vid)
    monkeypatch.setattr(module, "load_handler", lambda kind: ResultHandler(HandlerResult(outcome="failed", note="bad output")))
    for attempt in range(1, 4):
        await scheduler.tick()
        await asyncio.gather(*scheduler.tasks.values())
        current = await get_row(db, "tickets", ticket["id"])
        assert current["attempts"] == attempt
        if attempt < 3:
            assert current["status"] == "open" and json_loads_or(current["payload_json"], {})["_retry_at"] > utc_now()
            await scheduler.tick()
            assert (await get_row(db, "tickets", ticket["id"]))["attempts"] == attempt
            async with db.tx() as tx:
                await tx.execute("UPDATE tickets SET payload_json='{}' WHERE id=?", (ticket["id"],))
    assert current["status"] == "failed"
    messages = await db.fetch_all("SELECT body FROM messages WHERE venture_id=? AND meta_json LIKE '%incident%'", (vid,))
    assert len(messages) == 1 and "after 3 attempts" in messages[0]["body"]


async def test_cancel_never_applies_late_result_or_overwrites_external_status(db, settings, monkeypatch):
    vid, scheduler = await company(db, settings)
    ticket = await add_ticket(db, vid)
    started, release = asyncio.Event(), asyncio.Event()

    class Late:
        async def handle(self, ticket, ctx):
            started.set()
            await release.wait()
            return HandlerResult(outcome="done", artifacts=[NewArtifact(kind="brief", title="must not commit")])

    monkeypatch.setattr(module, "load_handler", lambda kind: Late())
    await scheduler.tick()
    await started.wait()
    async with db.tx() as tx:
        await tx.execute("UPDATE tickets SET status='cancelled' WHERE id=?", (ticket["id"],))
    release.set()
    await asyncio.gather(*scheduler.tasks.values())
    assert (await get_row(db, "tickets", ticket["id"]))["status"] == "cancelled"
    assert not await db.fetch_all("SELECT id FROM artifacts WHERE ticket_id=?", (ticket["id"],))
    assert (await db.fetch_one("SELECT status FROM runs WHERE ticket_id=?", (ticket["id"],)))["status"] == "cancelled"


async def test_stop_recovers_running_work_to_open_with_attempt_kept(db, settings, monkeypatch):
    vid, scheduler = await company(db, settings)
    ticket = await add_ticket(db, vid)
    started = asyncio.Event()

    class Slow:
        async def handle(self, ticket, ctx):
            started.set()
            await asyncio.Event().wait()

    monkeypatch.setattr(module, "load_handler", lambda kind: Slow())
    await scheduler.tick()
    await started.wait()
    await scheduler.stop()
    current = await get_row(db, "tickets", ticket["id"])
    assert current["status"] == "open" and current["attempts"] == 1
    assert (await db.fetch_one("SELECT status,error FROM runs WHERE ticket_id=?", (ticket["id"],)))["status"] == "failed"


async def test_dynamic_report_dependencies_wait_for_generated_engineering_gates(db, settings, monkeypatch):
    vid, scheduler = await company(db, settings)
    design = await add_ticket(db, vid, "eng.design")
    report = await add_ticket(db, vid, "cos.report")
    async with db.tx() as tx:
        await tx.execute("INSERT INTO ticket_deps VALUES(?,?)", (report["id"], design["id"]))
    from foundry_kernel.departments.engineering import EngineeringHandler
    monkeypatch.setattr(module, "load_handler", lambda kind: ResultHandler(HandlerResult(outcome="done")) if kind == "cos.report" else EngineeringHandler())
    for _ in range(8):
        await scheduler.tick()
        await asyncio.gather(*scheduler.tasks.values())
    qa = await db.fetch_one("SELECT * FROM tickets WHERE type='qa.verify' AND venture_id=?", (vid,))
    assert qa["status"] == "waiting_approval"
    assert (await get_row(db, "tickets", report["id"]))["status"] == "open"
    deps = await db.fetch_all("SELECT depends_on_id FROM ticket_deps WHERE ticket_id=?", (report["id"],))
    assert qa["id"] in {d["depends_on_id"] for d in deps}
    approval = await db.fetch_one("SELECT id FROM approvals WHERE ticket_id=?", (qa["id"],))
    await gates.decide(db, approval["id"], decision="approve", decided_by="Tanush")
    for _ in range(3):
        await scheduler.tick()
        await asyncio.gather(*scheduler.tasks.values())
    assert (await get_row(db, "tickets", report["id"]))["status"] == "done"


async def test_paused_and_over_budget_ventures_never_dispatch(db, settings):
    vid, scheduler = await company(db, settings, status="paused")
    ticket = await add_ticket(db, vid)
    await scheduler.tick()
    assert not scheduler.tasks
    async with db.tx() as tx:
        await tx.execute("UPDATE ventures SET status='running',budget_usd=0 WHERE id=?", (vid,))
    await scheduler.tick()
    await scheduler.tick()
    assert not scheduler.tasks and (await get_row(db, "tickets", ticket["id"]))["attempts"] == 0
    assert len(await db.fetch_all("SELECT id FROM approvals WHERE venture_id=? AND gate_type='spend' AND status='pending'", (vid,))) == 1


async def test_dependency_failure_blocks_then_retry_unblocks(db, settings):
    vid, scheduler = await company(db, settings)
    parent = await add_ticket(db, vid)
    child = await add_ticket(db, vid, "review.skeptic")
    async with db.tx() as tx:
        await tx.execute("UPDATE tickets SET status='failed' WHERE id=?", (parent["id"],))
        await tx.execute("INSERT INTO ticket_deps VALUES(?,?)", (child["id"], parent["id"]))
    await scheduler._resolve_dependencies()
    assert (await get_row(db, "tickets", child["id"]))["status"] == "blocked"
    async with db.tx() as tx:
        await tx.execute("UPDATE tickets SET status='open' WHERE id=?", (parent["id"],))
    await scheduler._resolve_dependencies()
    assert (await get_row(db, "tickets", child["id"]))["status"] == "open"


async def test_capability_precheck_routes_missing_skill_without_calling_handler(db, settings, monkeypatch):
    vid, scheduler = await company(db, settings)
    ticket = await add_ticket(db, vid, "eng.build", payload={"requires_capability": "pdf_export"})
    def forbidden(kind):
        raise AssertionError("The handler cannot run before the missing capability is granted")
    monkeypatch.setattr(module, "load_handler", forbidden)
    await scheduler.tick()
    await asyncio.gather(*scheduler.tasks.values())
    current = await get_row(db, "tickets", ticket["id"])
    assert current["status"] == "blocked"
    gap = await db.fetch_one("SELECT * FROM tickets WHERE type='capability.gap'")
    assert json_loads_or(gap["payload_json"], {})["blocked_ticket_id"] == ticket["id"]


async def test_three_final_failures_pause_department_and_create_incident_report(db, settings, monkeypatch):
    vid, scheduler = await company(db, settings)
    monkeypatch.setattr(module, "load_handler", lambda kind: ResultHandler(HandlerResult(outcome="failed", note="provider unavailable")))
    for _ in range(3):
        ticket = await add_ticket(db, vid)
        async with db.tx() as tx:
            await tx.execute("UPDATE tickets SET max_attempts=1 WHERE id=?", (ticket["id"],))
        await scheduler.dispatch(ticket["id"])
        await asyncio.gather(scheduler.tasks[ticket["id"]])
    paused = await db.fetch_one("SELECT value_json FROM kv WHERE key=?", (f"dept.paused.{vid}.intake",))
    assert json_loads_or(paused["value_json"], False) is True
    report = await db.fetch_one("SELECT payload_json FROM tickets WHERE type='cos.report'")
    assert json_loads_or(report["payload_json"], {})["incident"] is True


async def test_timeout_is_logged_and_retried(db, settings, monkeypatch):
    settings.ticket_timeout_seconds = 0
    vid, scheduler = await company(db, settings)
    ticket = await add_ticket(db, vid)
    class Slow:
        async def handle(self, ticket, ctx):
            await asyncio.Event().wait()
    monkeypatch.setattr(module, "load_handler", lambda kind: Slow())
    await scheduler.tick()
    await asyncio.gather(*scheduler.tasks.values())
    current = await get_row(db, "tickets", ticket["id"])
    assert current["status"] == "open" and current["attempts"] == 1
    assert "TimeoutError" in (await db.fetch_one("SELECT message FROM run_logs WHERE level='error'"))["message"]


async def test_reuses_existing_spend_gate_and_adopts_computer_gate(db, settings, monkeypatch):
    vid, scheduler = await company(db, settings)
    finance = await add_ticket(db, vid, "finance.budget")
    async with db.tx() as tx:
        existing = await module.ledger.ensure_spend_approval(tx, vid)
    monkeypatch.setattr(module, "load_handler", lambda kind: ResultHandler(HandlerResult(outcome="waiting_approval", approval=NewApproval(gate_type="spend", title="Increase", summary="Projected", payload={"requested_increase_usd": 50}))))
    await scheduler.dispatch(finance["id"])
    await scheduler.tasks[finance["id"]]
    approvals = await db.fetch_all("SELECT * FROM approvals WHERE venture_id=?", (vid,))
    assert len(approvals) == 1 and approvals[0]["id"] == existing
    assert json_loads_or(approvals[0]["payload_json"], {})["requested_increase_usd"] == 50
    assert approvals[0]["ticket_id"] == finance["id"]
    research = await add_ticket(db, vid, "research.competitors")
    async with db.tx() as tx:
        gate = await gates.request_approval(tx, venture_id=vid, gate_type="computer_action", title="Confirm", summary="Form", ticket_id=research["id"])
    monkeypatch.setattr(module, "load_handler", lambda kind: ResultHandler(HandlerResult(outcome="blocked", result={"waiting_existing_approval": gate})))
    await scheduler.dispatch(research["id"])
    await scheduler.tasks[research["id"]]
    assert (await get_row(db, "tickets", research["id"]))["status"] == "waiting_approval"
    await gates.decide(db, gate, decision="reject", decided_by="Tanush")
    assert (await get_row(db, "tickets", research["id"]))["status"] == "open"


async def test_existing_computer_decision_before_adoption_reenters_without_losing_decision(db, settings, monkeypatch):
    vid, scheduler = await company(db, settings)
    research = await add_ticket(db, vid, "research.competitors")
    gate = None
    class Computer:
        async def handle(self, ticket, ctx):
            nonlocal gate
            if ctx.approval_result:
                assert ctx.approval_result["status"] == "approved"
                return HandlerResult(outcome="done", note="Decision resumed")
            async with db.tx() as tx:
                gate = await gates.request_approval(tx, venture_id=vid, gate_type="computer_action", title="Confirm", summary="Form", ticket_id=ticket["id"])
            await gates.decide(db, gate, decision="approve", decided_by="Tanush")
            return HandlerResult(outcome="blocked", result={"waiting_existing_approval": gate})
    monkeypatch.setattr(module, "load_handler", lambda kind: Computer())
    await scheduler.tick()
    await asyncio.gather(*scheduler.tasks.values())
    assert (await get_row(db, "tickets", research["id"]))["status"] == "open"
    await scheduler.tick()
    await asyncio.gather(*scheduler.tasks.values())
    assert (await get_row(db, "tickets", research["id"]))["status"] == "done"
    assert len(await db.fetch_all("SELECT id FROM approvals WHERE ticket_id=?", (research["id"],))) == 1


async def test_improvement_loop_approved_hire_preserves_engineering_execution_and_manifest(db, settings):
    from foundry_kernel.seed import load_roster
    from foundry_kernel.world_layout import build_manifest
    vid, scheduler = await company(db, settings)
    blocked = await add_ticket(db, vid, "eng.build", payload={"requires_capability": "pdf_export"})
    approved = []
    try:
        for _ in range(35):
            await scheduler.tick()
            await asyncio.gather(*scheduler.tasks.values())
            for gate in await db.fetch_all("SELECT * FROM approvals WHERE venture_id=? AND status='pending'", (vid,)):
                assert gate["gate_type"] == "new_capability"
                approved.append(gate["id"])
                await gates.decide(db, gate["id"], decision="approve", decided_by="Tanush")
            current = await get_row(db, "tickets", blocked["id"])
            if current["status"] == "done":
                break
        else:
            pytest.fail(str(await db.fetch_all("SELECT type,status,result_json FROM tickets WHERE venture_id=?", (vid,))))
        assert approved and current["assigned_agent_id"] == "gen.engineering.pdf-export"
        generated = await db.fetch_all("SELECT * FROM agents WHERE venture_id=? AND generated=1", (vid,))
        assert len(generated) == 1 and generated[0]["model_job"] == "dept_artifact"
        manifest = build_manifest(load_roster(), extra_agents=generated)
        assert any(npc["agent_id"] == generated[0]["id"] and npc["generated"] for npc in manifest["npcs"])
        resumed = await db.fetch_one("SELECT job,model FROM runs WHERE ticket_id=? AND agent_id=?", (blocked["id"], generated[0]["id"]))
        assert resumed["job"] == "dept_artifact"
        evidence = await db.fetch_all("SELECT kind,title FROM artifacts WHERE ticket_id=?", (blocked["id"],))
        assert {a["kind"] for a in evidence} == {"code", "test_report"}
        assert all("fake" in a["title"] for a in evidence)
        result = json_loads_or(current["result_json"], {})
        assert result["tests_passed"] == 3 and result["tests_failed"] == 0
        assert json_loads_or(current["payload_json"], {})["granted_capabilities"] == ["pdf_export"]
    finally:
        await scheduler.stop()
