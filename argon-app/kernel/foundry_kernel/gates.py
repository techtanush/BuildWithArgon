# OWNER: tanush — seed version; replace/extend freely but keep the public signatures.

"""Approvals. Every consequential action calls require_approved(). Spec: 03-company-kernel/05-approval-gates.md."""
from __future__ import annotations

import json
from typing import Any

from . import bus
from .errors import ConflictError, GateNotApproved, NotFoundError
from .ids import new_id, utc_now


async def request_approval(tx: Any, *, venture_id: str, gate_type: str, title: str, summary: str,
                           payload: dict[str, Any] | None = None, ticket_id: str | None = None,
                           run_id: str | None = None, requested_by_agent_id: str | None = None) -> str:
    for table, identifier in (("tickets", ticket_id), ("runs", run_id)):
        if identifier:
            parent = await tx.fetch_one(f"SELECT venture_id FROM {table} WHERE id=?", (identifier,))
            if parent is None or parent["venture_id"] != venture_id:
                raise ConflictError("Approval references must belong to the same venture")
    if requested_by_agent_id:
        agent = await tx.fetch_one("SELECT venture_id FROM agents WHERE id=?", (requested_by_agent_id,))
        if agent is None or agent["venture_id"] not in (None, venture_id):
            raise ConflictError("Approval requester must belong to this venture")
    approval_id = new_id("apr")
    await tx.execute(
        "INSERT INTO approvals (id, venture_id, ticket_id, run_id, requested_by_agent_id, gate_type, title, summary, payload_json, status, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?, 'pending', ?)",
        (approval_id, venture_id, ticket_id, run_id, requested_by_agent_id, gate_type, title, summary,
         json.dumps(payload or {}), utc_now()))
    from .records import serialize_approval
    row = await tx.fetch_one("SELECT * FROM approvals WHERE id=?", (approval_id,))
    await bus.emit(tx, venture_id=venture_id, type="approval.requested", entity_kind="approval", entity_id=approval_id,
                   data=serialize_approval(row))
    await post_gate_message(tx, venture_id, approval_id, f"Waiting on {{founder}}: {title}")
    return approval_id


async def require_approved(db_or_tx: Any, approval_id: str | None, gate_type: str) -> dict[str, Any]:
    """Raise GateNotApproved unless `approval_id` exists, has `gate_type` and status 'approved'."""
    if not approval_id:
        raise GateNotApproved(None, gate_type)
    row = await db_or_tx.fetch_one("SELECT * FROM approvals WHERE id = ?", (approval_id,))
    if row is None or row["gate_type"] != gate_type or row["status"] != "approved":
        raise GateNotApproved(approval_id, gate_type)
    return row


async def post_gate_message(tx: Any, venture_id: str, approval_id: str, body: str) -> None:
    """Keep the founder's decision trail in the same transaction as the gate."""
    from .records import serialize_message
    channel = await tx.fetch_one("SELECT id FROM channels WHERE venture_id=? AND slug='exec'", (venture_id,))
    if channel is None:
        return  # Low-level callers may create approvals before channels are seeded.
    venture = await tx.fetch_one("SELECT founder_name FROM ventures WHERE id=?", (venture_id,))
    message_id = new_id("msg")
    body = body.replace("{founder}", venture["founder_name"] if venture else "founder")
    await tx.execute(
        "INSERT INTO messages(id,venture_id,channel_id,author_kind,author_id,body,refs_json,meta_json,created_at) "
        "VALUES(?,?,?,'system','system',?,?,?,?)",
        (message_id, venture_id, channel["id"], body, json.dumps([{"kind": "approval", "id": approval_id}]),
         json.dumps({"kind": "gate"}), utc_now()))
    row = await tx.fetch_one("SELECT * FROM messages WHERE id=?", (message_id,))
    await bus.emit(tx, venture_id=venture_id, type="message.posted", entity_kind="message", entity_id=message_id,
                   data=serialize_message(row))


async def decide(db: Any, approval_id: str, *, decision: str, decided_by: str,
                 note: str = "", answers: dict[str, str] | None = None) -> dict[str, Any]:
    from . import ledger
    from .records import serialize_approval, serialize_ticket, serialize_venture
    if decision not in {"approve", "reject"}:
        raise ConflictError("Decision must be approve or reject")
    status = "approved" if decision == "approve" else "rejected"
    async with db.tx() as tx:
        approval = await tx.fetch_one("SELECT * FROM approvals WHERE id=?", (approval_id,))
        if approval is None:
            raise NotFoundError("approval", approval_id)
        if approval["status"] != "pending":
            raise ConflictError("This approval already has a decision")
        await tx.execute("UPDATE approvals SET status=?,decided_by=?,decision_note=?,decided_at=? WHERE id=?",
                         (status, decided_by, note, utc_now(), approval_id))
        if approval["gate_type"] == "spend":
            if decision == "approve":
                await ledger.raise_cap(tx, approval_id)
            else:
                await tx.execute("UPDATE ventures SET status='paused',updated_at=? WHERE id=?",
                                 (utc_now(), approval["venture_id"]))
                venture = await tx.fetch_one("SELECT * FROM ventures WHERE id=?", (approval["venture_id"],))
                await bus.emit(tx, venture_id=approval["venture_id"], type="venture.updated", entity_kind="venture",
                               entity_id=approval["venture_id"], data=serialize_venture(venture))
        if approval["ticket_id"]:
            ticket = await tx.fetch_one("SELECT * FROM tickets WHERE id=?", (approval["ticket_id"],))
            if ticket and ticket["venture_id"] != approval["venture_id"]:
                raise ConflictError("Approval and ticket must belong to the same venture")
            if ticket and ticket["status"] == "waiting_approval":
                payload = json.loads(ticket["payload_json"])
                payload["_approval"] = {"approval_id": approval_id, "status": status,
                                        "note": note, "answers": answers or {}}
                await tx.execute("UPDATE tickets SET status='open',payload_json=?,updated_at=? WHERE id=?",
                                 (json.dumps(payload), utc_now(), ticket["id"]))
                ticket = await tx.fetch_one("SELECT * FROM tickets WHERE id=?", (ticket["id"],))
                await bus.emit(tx, venture_id=approval["venture_id"], type="ticket.updated", entity_kind="ticket",
                               entity_id=ticket["id"], data=await serialize_ticket(tx, ticket))
                if ticket["assigned_agent_id"]:
                    await tx.execute("UPDATE agent_state SET status='idle',current_ticket_id=NULL WHERE venture_id=? AND agent_id=?",
                                     (approval["venture_id"], ticket["assigned_agent_id"]))
                    await bus.emit(tx, venture_id=approval["venture_id"], type="agent.status", entity_kind="agent",
                                   entity_id=ticket["assigned_agent_id"], data={"agent_id": ticket["assigned_agent_id"],
                                   "status": "idle", "current_ticket_id": None})
        row = await tx.fetch_one("SELECT * FROM approvals WHERE id=?", (approval_id,))
        result = serialize_approval(row)
        await bus.emit(tx, venture_id=approval["venture_id"], type="approval.decided", entity_kind="approval",
                       entity_id=approval_id, data=result)
        await post_gate_message(tx, approval["venture_id"], approval_id,
                                f"{decided_by} {status}: {approval['title']}" + (f" — {note}" if note else ""))
    return result
