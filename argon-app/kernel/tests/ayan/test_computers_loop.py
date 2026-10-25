# OWNER: ayan
"""Computer-use loop with a fake computer + FakeLLM (CU-02 shape, CU-05 skip)."""
from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from foundry_kernel import gates
from foundry_kernel.computers import cua_client, loop, manager
from foundry_kernel.errors import GateNotApproved
from foundry_kernel.ids import new_id, utc_now
from foundry_kernel.llm.fake import FakeLLM

COMPUTERS: list[cua_client.FakeComputer] = []


@pytest.fixture(autouse=True)
def fake_factory() -> Iterator[None]:
    async def factory(settings: Any, name: str) -> cua_client.FakeComputer:
        c = cua_client.FakeComputer(name)
        COMPUTERS.append(c)
        return c

    COMPUTERS.clear()
    manager.reset()
    manager.set_factory(factory)
    yield
    manager.set_factory(None)
    manager.reset()


@pytest.fixture
def cua_settings(settings: Any) -> Any:
    return settings.model_copy(update={"cua_mode": "sandbox"})


async def make_venture(db: Any) -> str:
    vid = new_id("ven")
    async with db.tx() as tx:
        await tx.execute("INSERT INTO ventures (id, name, slug, idea, founder_name, composio_user_id, created_at, updated_at) "
                         "VALUES (?,?,?,?,?,?,?,?)", (vid, "T", vid.lower(), "idea", "Alex", f"foundry:{vid}", utc_now(), utc_now()))
    return vid


async def run(settings: Any, db: Any, llm: Any, vid: str, start_url: str = "https://acme.com/", **kw: Any) -> Any:
    return await loop.run_task(settings=settings, db=db, llm=llm, venture_id=vid, agent_id="mr.competitor-analyst",
                               ticket_id=None, goal="Capture Acme's pricing", allowed_domains=["acme.com"],
                               start_url=start_url, **kw)


async def test_cua_off_is_skipped_without_db(settings: Any) -> None:
    res = await loop.run_task(settings=settings, db=None, llm=None, venture_id="ven_X", agent_id="eng.qa", ticket_id=None,
                              goal="g", allowed_domains=[], start_url="http://localhost")
    assert res.status == "skipped" and "CUA_MODE=off" in res.reason


async def test_not_installed_is_skipped(cua_settings: Any, db: Any) -> None:
    manager.set_factory(None)
    ok, _ = cua_client.cua_available()
    res = await run(cua_settings, db, FakeLLM(), await make_venture(db))
    assert ok or res.status == "skipped"


async def test_completes_with_screenshots_and_rows(cua_settings: Any, db: Any) -> None:
    vid = await make_venture(db)
    llm = FakeLLM()
    llm.script("computer_step", [
        {"type": "click", "x": 640, "y": 200, "reason": "open the Pricing tab"},
        {"type": "scroll", "dy": -600, "reason": "see all plans"},
        {"type": "done", "reason": "captured", "result": {"plans": [{"name": "Pro", "price": "$20"}]}},
    ])
    res = await run(cua_settings, db, llm, vid)
    assert res.status == "succeeded" and res.steps == 3
    assert res.result == {"plans": [{"name": "Pro", "price": "$20"}]}
    assert len(res.screenshots) == 3
    for rel in res.screenshots:
        assert (Path(cua_settings.data_dir) / rel).read_bytes()[:4] == b"\x89PNG"
    actions = await db.fetch_all("SELECT step, guard FROM computer_actions WHERE task_id=? ORDER BY id", (res.task_id,))
    assert [a["step"] for a in actions] == [0, 1, 2, 3] and {a["guard"] for a in actions} == {"allow"}
    task = await db.fetch_one("SELECT status, steps FROM computer_tasks WHERE id=?", (res.task_id,))
    assert task == {"status": "succeeded", "steps": 3}
    comp = await db.fetch_one("SELECT status, last_screenshot_path FROM computers WHERE venture_id=?", (vid,))
    assert comp["status"] == "ready" and comp["last_screenshot_path"] == res.screenshots[-1]
    assert COMPUTERS[0].actions[:2] == [("open_url", "https://acme.com/"), ("click", (640, 200, "left"))]
    # the same agent reuses its computer
    llm.script("computer_step", [{"type": "done", "reason": "ok", "result": {}}])
    await run(cua_settings, db, llm, vid)
    assert len(COMPUTERS) == 1


async def test_gated_action_waits_for_approval(cua_settings: Any, db: Any) -> None:
    vid = await make_venture(db)
    llm = FakeLLM()
    llm.script("computer_step", [{"type": "type", "text": "hunter2", "reason": "enter the password to log in"}])
    res = await run(cua_settings, db, llm, vid, start_url="https://acme.com/login")
    assert res.status == "waiting_approval"
    apr = await db.fetch_one("SELECT * FROM approvals WHERE id=?", (res.result["approval_id"],))
    assert apr["gate_type"] == "computer_action" and apr["status"] == "pending"
    assert ("type", "hunter2") not in COMPUTERS[0].actions
    with pytest.raises(GateNotApproved):
        await loop.execute_gated_action(db, COMPUTERS[0], approval_id=apr["id"], action=res.result["pending_action"])
    async with db.tx() as tx:
        await tx.execute("UPDATE approvals SET status='approved' WHERE id=?", (apr["id"],))
    await loop.execute_gated_action(db, COMPUTERS[0], approval_id=apr["id"], action=res.result["pending_action"])
    assert ("type", "hunter2") in COMPUTERS[0].actions
    assert await gates.require_approved(db, apr["id"], "computer_action")


async def test_off_allowlist_start_and_repeated_blocks_fail(cua_settings: Any, db: Any) -> None:
    vid = await make_venture(db)
    res = await run(cua_settings, db, FakeLLM(), vid, start_url="https://evil.com/")
    assert res.status == "failed" and "start URL" in res.reason
    llm = FakeLLM()
    llm.script("computer_step", [{"type": "open_url", "url": "https://evil.com/", "reason": "x"}] * 3)
    res = await run(cua_settings, db, llm, vid)
    assert res.status == "failed" and "blocked" in res.reason


async def test_max_steps_and_replan(cua_settings: Any, db: Any) -> None:
    vid = await make_venture(db)
    llm = FakeLLM()
    llm.script("computer_step", [{"type": "scroll", "dy": -300, "reason": "look"}] * 8)
    res = await run(cua_settings, db, llm, vid, max_steps=7)
    assert res.status == "failed" and res.steps == 7 and "max steps" in res.reason
    assert any(job == "computer_plan" for job, _ in llm.calls)


async def test_factory_failures_skip_then_circuit_breaks(cua_settings: Any, db: Any) -> None:
    async def broken(settings: Any, name: str) -> Any:
        raise cua_client.CuaUnavailable("no gVisor")

    manager.set_factory(broken)
    vid = await make_venture(db)
    for _ in range(3):
        res = await run(cua_settings, db, FakeLLM(), vid)
        assert res.status == "skipped" and "no gVisor" in res.reason
    res = await run(cua_settings, db, FakeLLM(), vid)
    assert res.status == "skipped" and "3 times" in res.reason

async def test_computer_approval_cannot_authorize_substituted_action_or_computer(cua_settings: Any, db: Any) -> None:
    vid = await make_venture(db)
    llm = FakeLLM()
    action = {"type": "type", "text": "hunter2", "reason": "enter the password"}
    llm.script("computer_step", [action])
    res = await run(cua_settings, db, llm, vid, start_url="https://acme.com/login")
    apr = res.result["approval_id"]
    async with db.tx() as tx:
        await tx.execute("UPDATE approvals SET status='approved' WHERE id=?", (apr,))
    with pytest.raises(GateNotApproved):
        await loop.execute_gated_action(db, COMPUTERS[0], approval_id=apr,
                                        action={**res.result["pending_action"], "text": "different"})
    with pytest.raises(GateNotApproved):
        await loop.execute_gated_action(db, cua_client.FakeComputer("other"), approval_id=apr,
                                        action=res.result["pending_action"])

async def test_computer_action_is_single_use_even_concurrently(cua_settings: Any, db: Any) -> None:
    import asyncio
    vid = await make_venture(db)
    llm = FakeLLM()
    llm.script("computer_step", [{"type": "type", "text": "hunter2", "reason": "enter password"}])
    res = await run(cua_settings, db, llm, vid, start_url="https://acme.com/login")
    apr = res.result["approval_id"]
    async with db.tx() as tx:
        await tx.execute("UPDATE approvals SET status='approved' WHERE id=?", (apr,))
    results = await asyncio.gather(*(loop.execute_gated_action(db, COMPUTERS[0], approval_id=apr,
                                      action=res.result["pending_action"]) for _ in range(2)), return_exceptions=True)
    assert sum(isinstance(x, GateNotApproved) for x in results) == 1
    assert COMPUTERS[0].actions.count(("type", "hunter2")) == 1

async def test_actual_redirect_outside_allowlist_fails_closed(cua_settings: Any, db: Any) -> None:
    class Redirect(cua_client.FakeComputer):
        async def open_url(self, url):
            await super().open_url(url)
            self.current_url = "https://evil.com/"
    async def factory(settings, name):
        c = Redirect(name)
        COMPUTERS.append(c)
        return c
    manager.set_factory(factory)
    res = await run(cua_settings, db, FakeLLM(), await make_venture(db))
    assert res.status == "failed" and "redirected" in res.reason
    assert len(COMPUTERS[0].actions) == 1

async def test_unknown_actual_browser_url_fails_closed() -> None:
    with pytest.raises(cua_client.CuaUnavailable, match="actual browser URL"):
        await loop._actual_url(object())
