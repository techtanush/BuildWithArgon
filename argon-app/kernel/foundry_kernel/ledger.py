# OWNER: tanush — seed version; replace/extend freely but keep the public signatures.

"""Cost accounting. llm/client.py calls record() after every model call (ayan wires that)."""
from __future__ import annotations

import json
import math
from typing import Any

from . import bus, gates
from .errors import ConflictError
from .ids import new_id, utc_now


async def record(tx: Any, *, venture_id: str | None, kind: str, cost_usd: float, model: str | None = None,
                 run_id: str | None = None, department_id: str | None = None, agent_id: str | None = None,
                 units_in: int = 0, units_out: int = 0, estimated: bool = True) -> None:
    if not math.isfinite(cost_usd) or cost_usd < 0 or units_in < 0 or units_out < 0:
        raise ConflictError("Cost and usage must be finite and non-negative")
    if run_id:
        run = await tx.fetch_one("SELECT venture_id FROM runs WHERE id=?", (run_id,))
        if run is None or run["venture_id"] != venture_id:
            raise ConflictError("Ledger entry and run must belong to the same venture")
    await tx.execute(
        "INSERT INTO ledger (id, venture_id, run_id, department_id, agent_id, kind, model, units_in, units_out, cost_usd, estimated, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (new_id("led"), venture_id, run_id, department_id, agent_id, kind, model, units_in, units_out, cost_usd,
         1 if estimated else 0, utc_now()))
    if venture_id:
        await tx.execute("UPDATE ventures SET spent_usd = spent_usd + ?, updated_at = ? WHERE id = ?", (cost_usd, utc_now(), venture_id))
        row = await tx.fetch_one("SELECT spent_usd, budget_usd FROM ventures WHERE id = ?", (venture_id,))
        if row:
            await bus.emit(tx, venture_id=venture_id, type="ledger.updated", data=row)
            if row["spent_usd"] >= row["budget_usd"]:
                await ensure_spend_approval(tx, venture_id)


async def over_budget(db: Any, venture_id: str) -> bool:
    row = await db.fetch_one("SELECT spent_usd, budget_usd FROM ventures WHERE id = ?", (venture_id,))
    return bool(row and row["spent_usd"] >= row["budget_usd"])


async def ensure_spend_approval(tx: Any, venture_id: str) -> str:
    """Serialize callers through db.tx(): one open budget decision per venture."""
    pending = await tx.fetch_one("SELECT id FROM approvals WHERE venture_id=? AND gate_type='spend' AND status='pending' AND COALESCE(json_extract(payload_json,'$.purpose'),'')<>'treasury_payment'",
                                 (venture_id,))
    if pending:
        return pending["id"]
    venture = await tx.fetch_one("SELECT budget_usd,spent_usd FROM ventures WHERE id=?", (venture_id,))
    if venture is None:
        raise ConflictError("Cannot request a budget for an unknown venture")
    breakdown = await tx.fetch_all("SELECT department_id,SUM(cost_usd) AS cost_usd FROM ledger WHERE venture_id=? GROUP BY department_id",
                                   (venture_id,))
    return await gates.request_approval(tx, venture_id=venture_id, gate_type="spend", title="Raise the venture budget",
        summary="The venture has reached its spending limit. Approve a budget increase to continue.",
        payload={**venture, "requested_increase_usd": max(venture["budget_usd"],
                 venture["spent_usd"] - venture["budget_usd"] + 1.0), "breakdown": breakdown},
        requested_by_agent_id="fp.cfo")


async def raise_cap(tx: Any, approval_id: str) -> None:
    """Apply an approved spend decision once, inside its caller's transaction."""
    approval = await gates.require_approved(tx, approval_id, "spend")
    marker = f"spend.applied.{approval_id}"
    if await tx.fetch_one("SELECT key FROM kv WHERE key=?", (marker,)):
        return
    payload = json.loads(approval["payload_json"])
    amount = payload.get("requested_increase_usd")
    if isinstance(amount, bool) or not isinstance(amount, (int, float)) or not math.isfinite(amount) or amount <= 0:
        raise ConflictError("A spend approval requires a positive requested_increase_usd")
    await tx.execute("UPDATE ventures SET budget_usd=budget_usd+?,updated_at=? WHERE id=?",
                     (amount, utc_now(), approval["venture_id"]))
    await tx.execute("INSERT INTO kv(key,value_json,updated_at) VALUES(?,?,?)", (marker, "true", utc_now()))
    row = await tx.fetch_one("SELECT * FROM ventures WHERE id=?", (approval["venture_id"],))
    from .records import serialize_venture
    await bus.emit(tx, venture_id=approval["venture_id"], type="venture.updated", entity_kind="venture",
                   entity_id=approval["venture_id"], data=serialize_venture(row))
    await bus.emit(tx, venture_id=approval["venture_id"], type="ledger.updated",
                   data={"spent_usd": row["spent_usd"], "budget_usd": row["budget_usd"]})
