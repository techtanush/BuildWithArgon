# OWNER: tanush — seed version; replace/extend freely but keep the public signatures.

"""Approvals. Every consequential action calls require_approved(). Spec: 03-company-kernel/05-approval-gates.md."""
from __future__ import annotations

import json
from typing import Any

from . import bus
from .errors import GateNotApproved
from .ids import new_id, utc_now


async def request_approval(tx: Any, *, venture_id: str, gate_type: str, title: str, summary: str,
                           payload: dict[str, Any] | None = None, ticket_id: str | None = None,
                           run_id: str | None = None, requested_by_agent_id: str | None = None) -> str:
    approval_id = new_id("apr")
    await tx.execute(
        "INSERT INTO approvals (id, venture_id, ticket_id, run_id, requested_by_agent_id, gate_type, title, summary, payload_json, status, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?, 'pending', ?)",
        (approval_id, venture_id, ticket_id, run_id, requested_by_agent_id, gate_type, title, summary,
         json.dumps(payload or {}), utc_now()))
    await bus.emit(tx, venture_id=venture_id, type="approval.requested", entity_kind="approval", entity_id=approval_id,
                   data={"gate_type": gate_type, "title": title})
    return approval_id


async def require_approved(db_or_tx: Any, approval_id: str | None, gate_type: str) -> dict[str, Any]:
    """Raise GateNotApproved unless `approval_id` exists, has `gate_type` and status 'approved'."""
    if not approval_id:
        raise GateNotApproved(None, gate_type)
    row = await db_or_tx.fetch_one("SELECT * FROM approvals WHERE id = ?", (approval_id,))
    if row is None or row["gate_type"] != gate_type or row["status"] != "approved":
        raise GateNotApproved(approval_id, gate_type)
    return row
