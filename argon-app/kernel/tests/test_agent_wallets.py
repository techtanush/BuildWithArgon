# OWNER: tanush
"""Provider calls require exact approvals; test stubs never represent funded wallets."""
import asyncio
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI

from foundry_kernel import gates
from foundry_kernel.agent_wallets import (
    external_identity,
    provision_wallet,
    recover_claims,
    router,
)
from foundry_kernel.errors import ConflictError, KernelError
from tests.tanush.helpers import insert_venture


class ProviderStub:
    def __init__(self):
        self.calls = []
        self.failure = None

    async def ensure_wallet(self, **kwargs):
        self.calls.append(kwargs)
        if self.failure:
            raise self.failure
        return {"id": "test-provider-wallet", "address": "0x" + "1" * 40, "chain_type": "ethereum"}


async def create(db, provider, vid, agent="fp.cfo", **kwargs):
    return await provision_wallet(db=db, provider=provider, configured=kwargs.pop("configured", True), wallet_limit=kwargs.pop("wallet_limit", 50), venture_id=vid, agent_id=agent, **kwargs)


async def test_missing_configuration_has_no_provider_call_or_fake_row(db):
    vid, provider = await insert_venture(db), ProviderStub()
    with pytest.raises(KernelError) as exc:
        await create(db, provider, vid, configured=False)
    assert exc.value.status_code == 503
    assert not provider.calls and not await db.fetch_all("SELECT * FROM agent_wallets")


async def test_approved_creation_uses_stable_identity_and_never_moves_money(db):
    vid, provider = await insert_venture(db), ProviderStub()
    pending = await create(db, provider, vid)
    assert pending["status"] == "pending_approval" and pending["address"] is None
    assert await create(db, provider, vid) == pending and not provider.calls
    await gates.decide(db, pending["approval_id"], decision="approve", decided_by="Tanush")
    ready = await create(db, provider, vid)
    assert ready["status"] == "ready" and ready["wallet_id"] == "test-provider-wallet"
    agent = await db.fetch_one("SELECT display_name FROM agents WHERE id='fp.cfo'")
    assert provider.calls == [{"external_id": external_identity(vid, "fp.cfo"), "display_name": agent["display_name"]}]
    assert await create(db, provider, vid) == ready and len(provider.calls) == 1
    assert not await db.fetch_all("SELECT * FROM ledger WHERE venture_id=?", (vid,))


async def test_global_limit_is_atomic_and_rejection_releases_reservation(db):
    first, second, provider = await insert_venture(db), await insert_venture(db), ProviderStub()
    results = await asyncio.gather(create(db, provider, first, wallet_limit=1), create(db, provider, second, wallet_limit=1), return_exceptions=True)
    assert sum(isinstance(row, ConflictError) for row in results) == 1
    pending = next(row for row in results if isinstance(row, dict))
    await gates.decide(db, pending["approval_id"], decision="reject", decided_by="Tanush")
    loser = second if isinstance(results[1], ConflictError) else first
    assert (await create(db, provider, loser, wallet_limit=1))["status"] == "pending_approval"
    assert not provider.calls


async def test_failure_and_cancel_preserve_approval_and_retry_identity(db):
    vid, provider = await insert_venture(db), ProviderStub()
    pending = await create(db, provider, vid)
    await gates.decide(db, pending["approval_id"], decision="approve", decided_by="Tanush")
    for failure in (RuntimeError("private provider details"), asyncio.CancelledError()):
        provider.failure = failure
        with pytest.raises((KernelError, asyncio.CancelledError)):
            await create(db, provider, vid)
        row = await db.fetch_one("SELECT * FROM agent_wallets WHERE venture_id=?", (vid,))
        assert row["status"] == "error" and row["approval_id"] == pending["approval_id"]
        assert "private" not in row["error"]
    provider.failure = None
    assert (await create(db, provider, vid))["status"] == "ready"
    assert len({call["external_id"] for call in provider.calls}) == 1


async def test_concurrent_provisioning_claim_calls_provider_once_and_stale_claim_recovers(db):
    vid, provider = await insert_venture(db), ProviderStub()
    pending = await create(db, provider, vid)
    await gates.decide(db, pending["approval_id"], decision="approve", decided_by="Tanush")
    entered, release = asyncio.Event(), asyncio.Event()
    original = provider.ensure_wallet
    async def blocked(**kwargs):
        entered.set()
        await release.wait()
        return await original(**kwargs)
    provider.ensure_wallet = blocked
    first = asyncio.create_task(create(db, provider, vid))
    try:
        await entered.wait()
        assert (await create(db, provider, vid))["status"] == "provisioning"
        release.set()
        assert (await first)["status"] == "ready"
        assert len(provider.calls) == 1
    finally:
        release.set()
        await asyncio.gather(first, return_exceptions=True)
    async with db.tx() as tx:
        await tx.execute("UPDATE agent_wallets SET status='provisioning',lease_expires_at='2000-01-01',claim_token='stale' WHERE venture_id=?", (vid,))
        await recover_claims(tx)
    assert (await db.fetch_one("SELECT status FROM agent_wallets WHERE venture_id=?", (vid,)))["status"] == "error"


async def test_foreign_agent_and_mismatched_approval_are_rejected_before_provider(db):
    vid, other, provider = await insert_venture(db), await insert_venture(db), ProviderStub()
    async with db.tx() as tx:
        await tx.execute("UPDATE agents SET venture_id=? WHERE id='fp.cfo'", (other,))
    with pytest.raises(ConflictError):
        await create(db, provider, vid)
    async with db.tx() as tx:
        await tx.execute("UPDATE agents SET venture_id=NULL WHERE id='fp.cfo'")
    pending = await create(db, provider, vid)
    await gates.decide(db, pending["approval_id"], decision="approve", decided_by="Tanush")
    async with db.tx() as tx:
        await tx.execute("UPDATE approvals SET venture_id=? WHERE id=?", (other, pending["approval_id"]))
    with pytest.raises(ConflictError):
        await create(db, provider, vid)
    assert not provider.calls


async def test_routes_expose_honest_status_and_strict_creation_only_body(db):
    vid, provider = await insert_venture(db), ProviderStub()
    app = FastAPI()
    app.state.db, app.state.wallet_provider = db, provider
    app.state.wallet_settings = SimpleNamespace(configured=True, wallet_mode="testnet", wallet_limit=50)
    app.include_router(router)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        view = (await client.get(f"/v1/ventures/{vid}/wallets")).json()["data"]
        assert view == {"provider": "privy", "configured": True, "network": "base-sepolia", "chain_id": 84532,
                        "mainnet_enabled": False, "spending_enabled": False, "wallet_limit": 50, "wallets": []}
        path = f"/v1/ventures/{vid}/agents/fp.cfo/wallet"
        assert (await client.post(path, json={"send": 1})).status_code == 422
        pending = (await client.post(path, json={})).json()["data"]
        assert pending["address"] is None and not provider.calls
        await gates.decide(db, pending["approval_id"], decision="approve", decided_by="Tanush")
        assert (await client.post(path, json={})).json()["data"]["status"] == "ready"
        assert (await client.post(path + "/send", json={})).status_code == 404
