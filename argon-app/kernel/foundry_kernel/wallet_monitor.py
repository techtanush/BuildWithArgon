# OWNER: tanush
"""Read-only background settlement; unresolved sends are never rebroadcast."""
from __future__ import annotations

import asyncio
import logging

from .wallet_payments import recover_payments, refresh_payment

_LOG = logging.getLogger(__name__)


async def reconcile_once(app) -> int:
    db = app.state.db
    async with db.tx() as tx:
        await recover_payments(tx)
        rows = await tx.fetch_all("SELECT id,venture_id,agent_id FROM wallet_payments WHERE status IN ('submitted','uncertain') AND tx_hash IS NOT NULL ORDER BY updated_at,id LIMIT 20")
    for row in rows:
        try:
            await refresh_payment(db=db, provider=app.state.wallet_provider,
                venture_id=row["venture_id"], agent_id=row["agent_id"], payment_id=row["id"])
        except Exception as exc:  # noqa: BLE001 - one failed read must not stop settlement.
            _LOG.warning("Wallet receipt refresh unavailable (%s)", type(exc).__name__)
    return len(rows)


async def _loop(app):
    while True:
        try:
            await reconcile_once(app)
        except Exception as exc:  # noqa: BLE001 - recover on the next polling interval.
            _LOG.warning("Wallet settlement monitor unavailable (%s)", type(exc).__name__)
        await asyncio.sleep(5)


async def start(app):
    app.state.wallet_monitor_task = asyncio.create_task(_loop(app), name="wallet-settlement")


async def stop(app):
    task = getattr(app.state, "wallet_monitor_task", None)
    if task:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        app.state.wallet_monitor_task = None
