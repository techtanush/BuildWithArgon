# OWNER: tanush
"""Budget enforcement tests at the exact cap and through founder decisions."""
import asyncio
import json

import pytest

from foundry_kernel import gates, ledger
from foundry_kernel.errors import GateNotApproved, KernelError
from tests.tanush.helpers import insert_venture


async def test_costs_accumulate_per_venture_and_preserve_usage(db):
    vid = await insert_venture(db, budget=10)
    other = await insert_venture(db, budget=10)
    async with db.tx() as tx:
        await ledger.record(tx, venture_id=vid, kind="model", cost_usd=1.25, model="gemini-4-argon", department_id="engineering", agent_id="eng.builder", units_in=123, units_out=45, estimated=False)
        await ledger.record(tx, venture_id=vid, kind="tool", cost_usd=0.5)
    assert (await db.fetch_one("SELECT spent_usd FROM ventures WHERE id=?", (vid,)))["spent_usd"] == 1.75
    assert (await db.fetch_one("SELECT spent_usd FROM ventures WHERE id=?", (other,)))["spent_usd"] == 0
    entry = await db.fetch_one("SELECT * FROM ledger WHERE venture_id=? AND kind='model'", (vid,))
    assert (entry["units_in"], entry["units_out"], entry["estimated"]) == (123, 45, 0)
    assert not await ledger.over_budget(db, vid)
    assert not await ledger.over_budget(db, "ven_missing")


async def test_exact_budget_threshold_opens_one_spend_gate(db):
    vid = await insert_venture(db, budget=2)
    async with db.tx() as tx:
        await ledger.record(tx, venture_id=vid, kind="model", cost_usd=1)
    assert not await ledger.over_budget(db, vid)
    assert not await db.fetch_all("SELECT id FROM approvals WHERE venture_id=?", (vid,))
    async with db.tx() as tx:
        await ledger.record(tx, venture_id=vid, kind="model", cost_usd=1)
        await ledger.record(tx, venture_id=vid, kind="tool", cost_usd=0.1)
    assert await ledger.over_budget(db, vid)
    approvals = await db.fetch_all("SELECT * FROM approvals WHERE venture_id=? AND gate_type='spend' AND status='pending'", (vid,))
    assert len(approvals) == 1
    payload = json.loads(approvals[0]["payload_json"])
    assert payload["budget_usd"] == 2 and payload["spent_usd"] >= 2
    assert payload["requested_increase_usd"] > 0


async def test_cost_and_spend_gate_roll_back_together(db):
    vid = await insert_venture(db, budget=1)
    with pytest.raises(RuntimeError):
        async with db.tx() as tx:
            await ledger.record(tx, venture_id=vid, kind="model", cost_usd=2)
            raise RuntimeError("caller failed")
    assert (await db.fetch_one("SELECT spent_usd FROM ventures WHERE id=?", (vid,)))["spent_usd"] == 0
    assert await db.fetch_all("SELECT * FROM ledger WHERE venture_id=?", (vid,)) == []
    assert await db.fetch_all("SELECT * FROM approvals WHERE venture_id=?", (vid,)) == []


async def test_global_spend_does_not_change_venture_budget(db):
    vid = await insert_venture(db, budget=1)
    async with db.tx() as tx:
        await ledger.record(tx, venture_id=None, kind="image", cost_usd=5)
    assert (await db.fetch_one("SELECT spent_usd FROM ventures WHERE id=?", (vid,)))["spent_usd"] == 0
    assert (await db.fetch_one("SELECT cost_usd FROM ledger WHERE venture_id IS NULL"))["cost_usd"] == 5


async def test_raise_cap_requires_approved_spend_gate(db):
    vid = await insert_venture(db, budget=2)
    async with db.tx() as tx:
        aid = await gates.request_approval(tx, venture_id=vid, gate_type="spend", title="More budget", summary="Needed", payload={"requested_increase_usd": 3})
    with pytest.raises(GateNotApproved):
        async with db.tx() as tx:
            await ledger.raise_cap(tx, aid)
    assert (await db.fetch_one("SELECT budget_usd FROM ventures WHERE id=?", (vid,)))["budget_usd"] == 2
    await gates.decide(db, aid, decision="approve", decided_by="Tanush")
    assert (await db.fetch_one("SELECT budget_usd FROM ventures WHERE id=?", (vid,)))["budget_usd"] == 5
    async with db.tx() as tx:
        await ledger.raise_cap(tx, aid)
    assert (await db.fetch_one("SELECT budget_usd FROM ventures WHERE id=?", (vid,)))["budget_usd"] == 5


async def test_rejected_spend_gate_pauses_venture_without_raising_cap(db):
    vid = await insert_venture(db, budget=1, status="running")
    async with db.tx() as tx:
        await ledger.record(tx, venture_id=vid, kind="model", cost_usd=1)
    aid = (await db.fetch_one("SELECT id FROM approvals WHERE venture_id=?", (vid,)))["id"]
    await gates.decide(db, aid, decision="reject", decided_by="Tanush")
    row = await db.fetch_one("SELECT status,budget_usd FROM ventures WHERE id=?", (vid,))
    assert row == {"status": "paused", "budget_usd": 1.0}


@pytest.mark.parametrize("cost", [-1.0, float("nan"), float("inf")])
async def test_invalid_cost_never_corrupts_accounting(db, cost):
    vid = await insert_venture(db)
    with pytest.raises((ValueError, TypeError, KernelError)):
        async with db.tx() as tx:
            await ledger.record(tx, venture_id=vid, kind="model", cost_usd=cost)
    assert (await db.fetch_one("SELECT spent_usd FROM ventures WHERE id=?", (vid,)))["spent_usd"] == 0
    assert not await db.fetch_all("SELECT * FROM ledger WHERE venture_id=?", (vid,))


async def test_concurrent_costs_do_not_lose_spend_or_duplicate_pending_gate(db):
    vid = await insert_venture(db, budget=1)

    async def charge():
        async with db.tx() as tx:
            await ledger.record(tx, venture_id=vid, kind="model", cost_usd=0.5)

    await asyncio.gather(*(charge() for _ in range(8)))
    assert (await db.fetch_one("SELECT spent_usd FROM ventures WHERE id=?", (vid,)))["spent_usd"] == 4
    assert len(await db.fetch_all("SELECT id FROM ledger WHERE venture_id=?", (vid,))) == 8
    assert len(await db.fetch_all("SELECT id FROM approvals WHERE venture_id=? AND gate_type='spend' AND status='pending'", (vid,))) == 1


@pytest.mark.parametrize("increase", [0, -1, True, "3", None])
async def test_invalid_budget_increase_rolls_back_approval_decision(db, increase):
    vid = await insert_venture(db, budget=2)
    async with db.tx() as tx:
        aid = await gates.request_approval(tx, venture_id=vid, gate_type="spend", title="More budget", summary="Invalid amount", payload={"requested_increase_usd": increase})
    with pytest.raises(KernelError):
        await gates.decide(db, aid, decision="approve", decided_by="Tanush")
    assert (await db.fetch_one("SELECT status FROM approvals WHERE id=?", (aid,)))["status"] == "pending"
    assert (await db.fetch_one("SELECT budget_usd FROM ventures WHERE id=?", (vid,)))["budget_usd"] == 2
    assert not await db.fetch_all("SELECT id FROM events WHERE entity_id=? AND type='approval.decided'", (aid,))
