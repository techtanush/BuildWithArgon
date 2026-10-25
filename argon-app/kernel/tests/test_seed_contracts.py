# OWNER: frozen contract (change only via docs/contract-requests/<you>.md, applied in the merge session)

"""Seed contract tests — must stay green on every branch and after the merge."""
from __future__ import annotations

import asyncio
import importlib

from foundry_kernel import bus, gates
from foundry_kernel.contracts import HandlerResult
from foundry_kernel.departments import REGISTRY, load_handler
from foundry_kernel.errors import GateNotApproved
from foundry_kernel.ids import new_id, utc_now
from foundry_kernel.llm.fake import FakeLLM
from foundry_kernel.models import JOBS
from tests.fakes import FakeHandlerContext

SPEC_TICKET_TYPES = {
    "brief", "review.skeptic", "spec.write", "plan.request", "research.market", "research.competitors",
    "validation.synthetic_panel", "validation.interview_plan", "decision.review", "eng.design", "eng.build",
    "eng.fix", "eng.review", "qa.verify", "growth.positioning", "growth.launch_plan", "leads.icp",
    "sales.proposal", "finance.budget", "people.hire", "support.issue", "capability.gap", "chat.reply",
    "cos.report", "cos.standup", "agent.request",
}


def test_health(client) -> None:
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["data"]["db"] is True


async def test_roster_seeded(db) -> None:
    assert len(await db.fetch_all("SELECT id FROM departments")) == 13
    assert len(await db.fetch_all("SELECT id FROM agents")) == 29


def test_registry_covers_spec() -> None:
    assert SPEC_TICKET_TYPES == set(REGISTRY)


def test_jobs_have_known_shape() -> None:
    assert JOBS["engineering_build"].background and JOBS["talk"].model == "gemini-3.8-flash"


async def test_fake_engineering_design_creates_tickets(settings) -> None:
    res = await load_handler("eng.design").handle({"type": "eng.design", "title": "Design"}, FakeHandlerContext(settings))
    assert isinstance(res, HandlerResult) and [t.type for t in res.new_tickets] == ["eng.build", "eng.review", "qa.verify"]


async def test_events_publish_after_commit(db) -> None:
    q = bus.BROKER.subscribe(None)
    async with db.tx() as tx:
        await bus.emit(tx, venture_id=None, type="test.event", data={"x": 1})
        assert q.empty()
    event = await asyncio.wait_for(q.get(), 1)
    assert event["type"] == "test.event"


async def test_gate_requires_approval(db) -> None:
    vid = new_id("ven")
    async with db.tx() as tx:
        await tx.execute("INSERT INTO ventures (id, name, slug, idea, founder_name, composio_user_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
                         (vid, "T", "t", "idea", "Alex", f"foundry:{vid}", utc_now(), utc_now()))
        apr = await gates.request_approval(tx, venture_id=vid, gate_type="merge", title="Merge", summary="s")
    try:
        await gates.require_approved(db, apr, "merge")
        raise AssertionError("expected GateNotApproved")
    except GateNotApproved:
        pass
    async with db.tx() as tx:
        await tx.execute("UPDATE approvals SET status='approved' WHERE id=?", (apr,))
    assert (await gates.require_approved(db, apr, "merge"))["id"] == apr


async def test_fake_llm_json() -> None:
    from pydantic import BaseModel

    class Out(BaseModel):
        title: str

    model, _ = await FakeLLM().generate_json("dept_artifact", "x", Out)
    assert model.title


def test_all_modules_import() -> None:
    for name in ["app", "scheduler", "orchestrator", "llm.client", "llm.smoke", "voice.tts", "voice.stt", "computers.loop",
                 "integrations.github_watch", "worldgen.cli", "evals.cli", "conversation.talk"]:
        importlib.import_module(f"foundry_kernel.{name}")


def test_redact(settings) -> None:
    from foundry_kernel.security import redact

    out = redact("key AIza" + "x" * 35 + " and ghp_" + "a" * 30, settings)
    assert "AIza" not in out and "ghp_" not in out and out.count("[REDACTED]") == 2


def test_world_layout_matches_spec_table() -> None:
    import json

    from foundry_kernel.config import KERNEL_DIR
    from foundry_kernel.world_layout import build_manifest

    m = build_manifest(json.loads((KERNEL_DIR / "data" / "roster.json").read_text()))
    assert len(m["roads"]["nodes"]) == 52 and len(m["roads"]["edges"]) == 65 and len(m["npcs"]) == 29
    eng = next(b for b in m["buildings"] if b["department_id"] == "engineering")
    assert abs(eng["plot_center"][0] - 31.59) < 0.05 and abs(eng["plot_center"][1] - 128.16) < 0.05


def test_agent_capabilities_match_roster_and_jobs() -> None:
    import json

    from foundry_kernel.config import KERNEL_DIR

    caps = json.loads((KERNEL_DIR / "data" / "agent_capabilities.json").read_text())
    roster = json.loads((KERNEL_DIR / "data" / "roster.json").read_text())
    assert set(caps["agents"]) == {a["id"] for a in roster["agents"]}
    for agent in roster["agents"]:
        entry = caps["agents"][agent["id"]]
        assert sorted(entry["tools"]) == sorted(agent["tools"])
        for key in ("work_jobs", "conversation_jobs", "coordination_jobs"):
            assert set(entry[key]) <= set(JOBS), (agent["id"], key)
    for system in caps["system_agents"].values():
        assert set(system["jobs"]) <= set(JOBS)
