# OWNER: tanush — seed version; replace/extend freely but keep the public signatures.

"""Cost accounting. llm/client.py calls record() after every model call (ayan wires that)."""
from __future__ import annotations

from typing import Any

from . import bus
from .ids import new_id, utc_now


async def record(tx: Any, *, venture_id: str | None, kind: str, cost_usd: float, model: str | None = None,
                 run_id: str | None = None, department_id: str | None = None, agent_id: str | None = None,
                 units_in: int = 0, units_out: int = 0, estimated: bool = True) -> None:
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


async def over_budget(db: Any, venture_id: str) -> bool:
    row = await db.fetch_one("SELECT spent_usd, budget_usd FROM ventures WHERE id = ?", (venture_id,))
    return bool(row and row["spent_usd"] >= row["budget_usd"])
