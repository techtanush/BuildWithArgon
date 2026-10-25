# OWNER: tanush
"""Founder approval, denial, and re-entry invariants from K-07/K-08."""
import asyncio
import json

import pytest

from foundry_kernel import gates
from foundry_kernel.errors import GateNotApproved, KernelError
from tests.tanush.helpers import execute, insert_ticket, insert_venture


GATE_TYPES = ["clarification", "pivot", "spend", "outreach", "merge", "deploy", "integration", "new_capability", "computer_action"]


@pytest.mark.parametrize("gate_type", GATE_TYPES)
async def test_request_stays_pending_and_cannot_authorize_action(db, gate_type):
    vid = await insert_venture(db)
    async with db.tx() as tx:
        aid = await gates.request_approval(tx, venture_id=vid, gate_type=gate_type, title="Founder decision", summary="Review this action", payload={"reason": "Consequential"})
    row = await db.fetch_one("SELECT * FROM approvals WHERE id=?", (aid,))
    assert row["status"] == "pending"
    assert json.loads(row["payload_json"])["reason"] == "Consequential"
    with pytest.raises(GateNotApproved):
        await gates.require_approved(db, aid, gate_type)
    assert await db.fetch_one("SELECT id FROM events WHERE type='approval.requested' AND entity_id=?", (aid,))


@pytest.mark.parametrize("approval_id", [None, "apr_missing"])
async def test_unknown_approval_does_not_authorize_action(db, approval_id):
    with pytest.raises(GateNotApproved):
        await gates.require_approved(db, approval_id, "merge")


async def test_approval_is_specific_to_gate_type_and_status(db):
    vid = await insert_venture(db)
    async with db.tx() as tx:
        aid = await gates.request_approval(tx, venture_id=vid, gate_type="merge", title="Merge", summary="Ready")
    for status in ("rejected", "expired"):
        await execute(db, "UPDATE approvals SET status=? WHERE id=?", (status, aid))
        with pytest.raises(GateNotApproved):
            await gates.require_approved(db, aid, "merge")
    await execute(db, "UPDATE approvals SET status='approved' WHERE id=?", (aid,))
    with pytest.raises(GateNotApproved):
        await gates.require_approved(db, aid, "outreach")
    async with db.tx() as tx:
        assert (await gates.require_approved(tx, aid, "merge"))["id"] == aid


@pytest.mark.parametrize("decision,status", [("approve", "approved"), ("reject", "rejected")])
async def test_decision_reopens_waiting_ticket_with_answers_and_preserves_attempts(db, decision, status):
    vid = await insert_venture(db)
    tid = await insert_ticket(db, vid, status="waiting_approval", attempts=2, payload='{"keep":"existing"}')
    async with db.tx() as tx:
        aid = await gates.request_approval(tx, venture_id=vid, gate_type="clarification", title="Question", summary="Resolve uncertainty", payload={"questions": [{"id": "q1", "proposed": "Default"}]}, ticket_id=tid)
    result = await gates.decide(db, aid, decision=decision, decided_by="Tanush", note="Use public data", answers={"q1": "Public sources"})
    assert result["status"] == status
    approval = await db.fetch_one("SELECT * FROM approvals WHERE id=?", (aid,))
    assert approval["decided_by"] == "Tanush" and approval["decided_at"]
    assert approval["decision_note"] == "Use public data"
    ticket = await db.fetch_one("SELECT * FROM tickets WHERE id=?", (tid,))
    assert ticket["status"] == "open" and ticket["attempts"] == 2
    payload = json.loads(ticket["payload_json"])
    assert payload["keep"] == "existing"
    assert payload["_approval"] == {"approval_id": aid, "status": status, "note": "Use public data", "answers": {"q1": "Public sources"}}
    assert len(await db.fetch_all("SELECT * FROM events WHERE type='approval.decided' AND entity_id=?", (aid,))) == 1


async def test_deciding_gate_does_not_resurrect_cancelled_ticket(db):
    vid = await insert_venture(db)
    tid = await insert_ticket(db, vid, status="cancelled")
    async with db.tx() as tx:
        aid = await gates.request_approval(tx, venture_id=vid, gate_type="merge", title="Merge", summary="Ready", ticket_id=tid)
    await gates.decide(db, aid, decision="reject", decided_by="Tanush")
    assert (await db.fetch_one("SELECT status FROM tickets WHERE id=?", (tid,)))["status"] == "cancelled"


async def test_gate_text_and_nested_payload_are_redacted_before_storage(db):
    vid = await insert_venture(db)
    secret = "ghp_" + "a" * 30
    async with db.tx() as tx:
        aid = await gates.request_approval(tx, venture_id=vid, gate_type="clarification", title=secret, summary=secret, payload={"questions": [{"proposed": secret}]})
    await gates.decide(db, aid, decision="approve", decided_by="Tanush", note=secret, answers={"q": secret})
    rows = await db.fetch_all("SELECT * FROM approvals WHERE id=?", (aid,))
    events = await db.fetch_all("SELECT * FROM events WHERE entity_id=?", (aid,))
    assert secret not in json.dumps([rows, events])
    assert "[REDACTED]" in json.dumps(rows)


async def test_concurrent_decisions_allow_exactly_one_founder_result(db):
    vid = await insert_venture(db)
    tid = await insert_ticket(db, vid, status="waiting_approval")
    async with db.tx() as tx:
        aid = await gates.request_approval(tx, venture_id=vid, gate_type="clarification", title="Scope", summary="Choose", ticket_id=tid)
    results = await asyncio.gather(
        gates.decide(db, aid, decision="approve", decided_by="Tanush"),
        gates.decide(db, aid, decision="reject", decided_by="Tanush"),
        return_exceptions=True,
    )
    errors = [r for r in results if isinstance(r, Exception)]
    assert len(errors) == 1 and isinstance(errors[0], KernelError) and errors[0].status_code == 409
    stored = await db.fetch_one("SELECT status FROM approvals WHERE id=?", (aid,))
    payload = json.loads((await db.fetch_one("SELECT payload_json FROM tickets WHERE id=?", (tid,)))["payload_json"])
    assert payload["_approval"]["status"] == stored["status"]
    assert len(await db.fetch_all("SELECT id FROM events WHERE entity_id=? AND type='approval.decided'", (aid,))) == 1


async def test_gate_cannot_reference_another_ventures_ticket(db):
    first, second = await insert_venture(db), await insert_venture(db)
    tid = await insert_ticket(db, first)
    with pytest.raises(KernelError):
        async with db.tx() as tx:
            await gates.request_approval(tx, venture_id=second, gate_type="merge", title="Unsafe reference", summary="Cross-venture", ticket_id=tid)
    assert not await db.fetch_all("SELECT id FROM approvals WHERE venture_id=?", (second,))


async def test_gate_reentry_preserves_agent_working_on_another_ticket(db):
    vid = await insert_venture(db)
    waiting = await insert_ticket(db, vid, status="waiting_approval")
    current = await insert_ticket(db, vid, status="in_progress")
    async with db.tx() as tx:
        aid = await gates.request_approval(tx, venture_id=vid, gate_type="clarification", title="Clarify older work", summary="Scope", ticket_id=waiting)
        await tx.execute("INSERT INTO agent_state(venture_id,agent_id,status,current_ticket_id) VALUES(?,?,'working',?)", (vid, "oh.skeptic", current))
    await gates.decide(db, aid, decision="approve", decided_by="Tanush")
    assert (await db.fetch_one("SELECT status FROM tickets WHERE id=?", (waiting,)))["status"] == "open"
    assert (await db.fetch_one("SELECT status FROM tickets WHERE id=?", (current,)))["status"] == "in_progress"
    assert await db.fetch_one("SELECT status,current_ticket_id FROM agent_state WHERE venture_id=? AND agent_id=?", (vid, "oh.skeptic")) == {"status": "working", "current_ticket_id": current}
    assert not await db.fetch_all("SELECT id FROM events WHERE venture_id=? AND type='agent.status'", (vid,))
