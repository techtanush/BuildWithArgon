# OWNER: tanush
"""No live sends: meaningful payment state machine and standing-policy boundaries."""
import asyncio
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from foundry_kernel import gates
from foundry_kernel.errors import ConflictError, KernelError
from foundry_kernel.ids import new_id, utc_now
from foundry_kernel.wallet_chain import chain
from foundry_kernel.wallet_payments import (
    PaymentRequest,
    PolicyRequest,
    create_policy,
    overview,
    pay,
    recover_payments,
    refresh_payment,
    revoke_policy,
)
from tests.tanush.helpers import insert_venture

OWNER = "0x" + "11" * 20
RECIPIENT = "0x" + "22" * 20


class Provider:
    def __init__(self):
        self.prepares, self.sends = [], []
        self.prepare_hook = self.send_hook = None
        self.proof = "confirmed"

    async def balances(self, owner, chain_id):
        return {"native_balance_wei": "100000000000000000", "usdc_balance_units": "100000000", "chain_id": chain_id, "usdc_contract": chain(chain_id)["usdc"]}

    async def prepare_transfer(self, **kwargs):
        self.prepares.append(kwargs)
        if self.prepare_hook:
            await self.prepare_hook()
        return {"from": kwargs["wallet_address"], "to": chain(kwargs["chain_id"])["usdc"], "value": "0x0",
                "data": "0xa9059cbb" + kwargs["recipient"][2:].zfill(64) + format(kwargs["amount_units"], "064x"),
                "chain_id": kwargs["chain_id"], "gas_limit": hex(50000), "max_fee_per_gas": hex(100), "max_priority_fee_per_gas": hex(10), "nonce": len(self.prepares) - 1}

    async def send_transfer(self, **kwargs):
        self.sends.append(kwargs)
        if self.send_hook:
            await self.send_hook()
        return {"hash": "0x" + format(len(self.sends), "064x"), "caip2": f"eip155:{kwargs['chain_id']}"}

    async def verify_transfer(self, **kwargs):
        if self.proof is None:
            return None
        if isinstance(self.proof, dict):
            return self.proof
        return {"status": self.proof, "tx_hash": kwargs["tx_hash"], "block_number": 20, "confirmations": 2, "fee_wei": "1000"}


async def setup(db, *, approve=True, **limits):
    vid, now = await insert_venture(db), utc_now()
    wid = new_id("wal")
    async with db.tx() as tx:
        await tx.execute("INSERT INTO agent_wallets(id,venture_id,agent_id,external_id,status,wallet_id,address,network,created_at,updated_at) VALUES(?,?,'fp.cfo',?,'ready','privy-test-wallet',?,'base-sepolia',?,?)", (wid, vid, wid, OWNER, now, now))
    settings = SimpleNamespace(payments_enabled=True, wallet_mode="testnet", chain_id=84532, network="base-sepolia")
    req = PolicyRequest(chain_id=84532, recipients=[RECIPIENT], per_payment_minor=100, daily_limit_minor=200, total_limit_minor=300,
        max_gas_fee_wei="100000000000000", expires_at=(datetime.now(UTC) + timedelta(days=1)).isoformat(), **limits)
    policy = await create_policy(db=db, settings=settings, venture_id=vid, agent_id="fp.cfo", request=req)
    if approve:
        await gates.decide(db, policy["approval_id"], decision="approve", decided_by="Founder")
    return vid, settings, Provider(), policy


def payment(policy, key="invoice-key-1", amount=100, **kwargs):
    return PaymentRequest(policy_id=policy["id"], recipient=RECIPIENT, amount_minor=amount, purpose="Supplier invoice", idempotency_key=key, **kwargs)


async def send(db, vid, settings, provider, policy, key="invoice-key-1", amount=100, **kwargs):
    return await pay(db=db, settings=settings, provider=provider, venture_id=vid, agent_id="fp.cfo", request=payment(policy, key, amount), **kwargs)


async def confirm(db, provider, vid, result):
    return await refresh_payment(db=db, provider=provider, venture_id=vid, agent_id="fp.cfo", payment_id=result["id"])


async def test_one_founder_policy_allows_two_autonomous_payments_and_enforces_daily_cap(db):
    vid, settings, provider, policy = await setup(db)
    for i in range(2):
        result = await send(db, vid, settings, provider, policy, key=f"invoice-key-{i}")
        assert result["status"] == "submitted"
        assert (await confirm(db, provider, vid, result))["status"] == "confirmed"
    assert len(provider.sends) == 2
    assert len(await db.fetch_all("SELECT id FROM approvals WHERE venture_id=?", (vid,))) == 1
    with pytest.raises(ConflictError, match="daily"):
        await send(db, vid, settings, provider, policy, key="invoice-key-third")
    view = await overview(db=db, provider=provider, settings=settings, venture_id=vid, agent_id="fp.cfo")
    assert view["balance"]["status"] == "ready" and view["policies"][0]["status"] == "active"
    assert provider.prepares[0]["amount_units"] == 1000000


async def test_policy_requires_exact_approved_gate_and_tampering_fails_before_prepare(db):
    vid, settings, provider, policy = await setup(db, approve=False)
    with pytest.raises(KernelError):
        await send(db, vid, settings, provider, policy)
    await gates.decide(db, policy["approval_id"], decision="approve", decided_by="Founder")
    async with db.tx() as tx:
        row = await tx.fetch_one("SELECT payload_json FROM approvals WHERE id=?", (policy["approval_id"],))
        payload = json.loads(row["payload_json"])
        payload["policy"]["total_limit_minor"] = 999
        await tx.execute("UPDATE approvals SET payload_json=? WHERE id=?", (json.dumps(payload), policy["approval_id"]))
    with pytest.raises(ConflictError, match="immutable"):
        await send(db, vid, settings, provider, policy)
    assert not provider.prepares


async def test_parallel_idempotency_and_nonce_guard_only_allow_one_dispatch(db):
    vid, settings, provider, policy = await setup(db)
    entered, release = asyncio.Event(), asyncio.Event()
    async def pause():
        entered.set()
        await release.wait()
    provider.prepare_hook = pause
    task = asyncio.create_task(send(db, vid, settings, provider, policy))
    try:
        await entered.wait()
        retry = await send(db, vid, settings, provider, policy)
        assert retry["status"] == "preparing"
        with pytest.raises(ConflictError, match="unresolved"):
            await send(db, vid, settings, provider, policy, key="invoice-key-2")
        with pytest.raises(ConflictError, match="different"):
            await send(db, vid, settings, provider, policy, amount=99)
        release.set()
        assert (await task)["status"] == "submitted"
    finally:
        release.set()
        await asyncio.gather(task, return_exceptions=True)
    assert len(provider.sends) == 1


async def test_revocation_during_prepare_prevents_send_and_releases_only_unsent_reservation(db):
    vid, settings, provider, policy = await setup(db)
    async def revoke():
        await revoke_policy(db=db, venture_id=vid, agent_id="fp.cfo", policy_id=policy["id"])
    provider.prepare_hook = revoke
    result = await send(db, vid, settings, provider, policy)
    assert result["status"] == "failed" and not provider.sends
    with pytest.raises(ConflictError, match="revoked"):
        await send(db, vid, settings, provider, policy, key="invoice-key-2")


async def test_policy_expiry_and_chain_mode_are_checked_again_before_dispatch(db):
    vid, settings, provider, policy = await setup(db)
    async def disable():
        settings.wallet_mode = "off"
    provider.prepare_hook = disable
    assert (await send(db, vid, settings, provider, policy))["status"] == "failed"
    assert not provider.sends
    settings.wallet_mode = "mainnet"
    with pytest.raises(KernelError, match="chain"):
        await send(db, vid, settings, provider, policy, key="invoice-key-2")
    settings.wallet_mode = "testnet"
    async with db.tx() as tx:
        row = await tx.fetch_one("SELECT policy_json FROM wallet_spending_policies WHERE id=?", (policy["id"],))
        terms = json.loads(row["policy_json"])
        terms["expires_at"] = "2000-01-01T00:00:00Z"
        await tx.execute("UPDATE wallet_spending_policies SET policy_json=? WHERE id=?", (json.dumps(terms), policy["id"]))
    with pytest.raises(ConflictError, match="expired"):
        await send(db, vid, settings, provider, policy, key="invoice-key-3")


async def test_ambiguous_send_holds_reservation_and_same_key_never_resends(db):
    vid, settings, provider, policy = await setup(db)
    async def fail():
        raise RuntimeError("SDK error after possible broadcast")
    provider.send_hook = fail
    result = await send(db, vid, settings, provider, policy)
    assert result["status"] == "uncertain" and result["tx_hash"] is None
    assert await send(db, vid, settings, provider, policy) == result
    with pytest.raises(ConflictError, match="unresolved"):
        await send(db, vid, settings, provider, policy, key="invoice-key-2")
    assert len(provider.sends) == 1
    assert (await confirm(db, provider, vid, result))["status"] == "uncertain"


@pytest.mark.parametrize("phase", ["prepare", "send"])
async def test_cancellation_releases_only_before_durable_dispatch(db, phase):
    vid, settings, provider, policy = await setup(db)
    entered = asyncio.Event()
    async def block():
        entered.set()
        await asyncio.Event().wait()
    setattr(provider, f"{phase}_hook", block)
    task = asyncio.create_task(send(db, vid, settings, provider, policy))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    row = await db.fetch_one("SELECT * FROM wallet_payments WHERE venture_id=?", (vid,))
    assert row["status"] == ("failed" if phase == "prepare" else "uncertain")
    assert bool(row["transaction_json"]) == (phase == "send")


async def test_stale_prepare_releases_but_stale_dispatch_stays_held(db):
    vid, settings, provider, policy = await setup(db)
    async def fail():
        raise RuntimeError("possible broadcast")
    provider.send_hook = fail
    result = await send(db, vid, settings, provider, policy)
    async with db.tx() as tx:
        await tx.execute("UPDATE wallet_payments SET status='preparing',lease_expires_at='2000-01-01' WHERE id=?", (result["id"],))
        await recover_payments(tx)
    assert (await db.fetch_one("SELECT status FROM wallet_payments WHERE id=?", (result["id"],)))["status"] == "failed"
    async with db.tx() as tx:
        await tx.execute("UPDATE wallet_payments SET status='dispatching',lease_expires_at='2000-01-01' WHERE id=?", (result["id"],))
        await recover_payments(tx)
    assert (await db.fetch_one("SELECT status FROM wallet_payments WHERE id=?", (result["id"],)))["status"] == "uncertain"


async def test_pending_wrong_receipt_and_revert_never_fake_success(db):
    vid, settings, provider, policy = await setup(db)
    result = await send(db, vid, settings, provider, policy)
    provider.proof = None
    async with db.tx() as tx:
        await tx.execute("UPDATE wallet_payments SET updated_at='2000-01-01' WHERE id=?", (result["id"],))
    pending = await confirm(db, provider, vid, result)
    assert pending["status"] == "submitted" and pending["updated_at"] > "2000-01-01"
    provider.proof = {"status": "confirmed", "tx_hash": "0x" + "f" * 64, "block_number": 20, "confirmations": 2, "fee_wei": "100"}
    assert (await confirm(db, provider, vid, result))["status"] == "submitted"
    provider.proof = "reverted"
    assert (await confirm(db, provider, vid, result))["status"] == "reverted"
    assert (await send(db, vid, settings, provider, policy, key="invoice-key-2"))["status"] == "submitted"


async def test_new_policy_cannot_reset_wallet_daily_spend_and_run_scope_is_bound(db):
    vid, settings, provider, policy = await setup(db)
    result = await send(db, vid, settings, provider, policy)
    await confirm(db, provider, vid, result)
    old = await db.fetch_one("SELECT policy_json FROM wallet_spending_policies WHERE id=?", (policy["id"],))
    terms = json.loads(old["policy_json"])
    terms["total_limit_minor"] = 400
    policy2 = await create_policy(db=db, settings=settings, venture_id=vid, agent_id="fp.cfo", request=PolicyRequest(**terms))
    await gates.decide(db, policy2["approval_id"], decision="approve", decided_by="Founder")
    result2 = await send(db, vid, settings, provider, policy2, key="invoice-key-2")
    await confirm(db, provider, vid, result2)
    with pytest.raises(ConflictError, match="daily"):
        await send(db, vid, settings, provider, policy2, key="invoice-key-3")
    rid = new_id("run")
    async with db.tx() as tx:
        await tx.execute("INSERT INTO runs(id,venture_id,agent_id,kind,job,model,status,created_at) VALUES(?,?,'eng.builder','ticket','engineering_build','fake','running',?)", (rid, vid, utc_now()))
    with pytest.raises(ConflictError, match="running agent"):
        await send(db, vid, settings, provider, policy, key="invoice-key-4", run_id=rid)


async def test_lifetime_limit_remains_held_across_days(db):
    vid, settings, provider, policy = await setup(db)
    for i in range(3):
        result = await send(db, vid, settings, provider, policy, key=f"lifetime-key-{i}")
        await confirm(db, provider, vid, result)
        async with db.tx() as tx:
            await tx.execute("UPDATE wallet_payments SET reserved_day='2000-01-01' WHERE id=?", (result["id"],))
    with pytest.raises(ConflictError, match="lifetime"):
        await send(db, vid, settings, provider, policy, key="lifetime-key-4")


async def test_prepared_transaction_must_match_recipient_amount_and_gas(db):
    vid, settings, provider, policy = await setup(db)
    original = provider.prepare_transfer
    async def wrong(**kwargs):
        transaction = await original(**kwargs)
        transaction["data"] = "0xa9059cbb" + RECIPIENT[2:].zfill(64) + format(kwargs["amount_units"] + 1, "064x")
        return transaction
    provider.prepare_transfer = wrong
    result = await send(db, vid, settings, provider, policy)
    assert result["status"] == "failed" and not provider.sends


async def test_cancelled_agent_run_during_prepare_stops_new_payment(db):
    vid, settings, provider, policy = await setup(db)
    rid = new_id("run")
    async with db.tx() as tx:
        await tx.execute("INSERT INTO runs(id,venture_id,agent_id,kind,job,model,status,created_at) VALUES(?,?,'fp.cfo','ticket','dept_artifact','fake','running',?)", (rid, vid, utc_now()))
    async def cancel_run():
        async with db.tx() as tx:
            await tx.execute("UPDATE runs SET status='cancelled' WHERE id=?", (rid,))
    provider.prepare_hook = cancel_run
    result = await send(db, vid, settings, provider, policy, run_id=rid)
    assert result["status"] == "failed" and not provider.sends


async def test_unknown_live_balance_is_error_not_fake_zero(db):
    vid, settings, provider, _ = await setup(db)
    async def unavailable(*args):
        raise RuntimeError("RPC unavailable")
    provider.balances = unavailable
    view = await overview(db=db, provider=provider, settings=settings, venture_id=vid, agent_id="fp.cfo")
    assert view["balance"]["status"] == "error"
    assert view["balance"]["native_balance_wei"] is None and view["balance"]["usdc_balance_units"] is None


async def test_unknown_dispatch_hash_is_only_persisted_after_exact_chain_proof(db):
    vid, settings, provider, policy = await setup(db)
    async def ambiguous():
        raise RuntimeError("connection lost after broadcast")
    provider.send_hook = ambiguous
    result = await send(db, vid, settings, provider, policy)
    candidate = "0x" + "a" * 64
    provider.proof = None
    pending = await refresh_payment(db=db, provider=provider, venture_id=vid, agent_id="fp.cfo", payment_id=result["id"], tx_hash=candidate)
    assert pending["status"] == "uncertain" and pending["tx_hash"] is None
    provider.proof = {"status": "confirmed", "tx_hash": "0x" + "b" * 64, "block_number": 20, "confirmations": 2, "fee_wei": "100"}
    wrong = await refresh_payment(db=db, provider=provider, venture_id=vid, agent_id="fp.cfo", payment_id=result["id"], tx_hash=candidate)
    assert wrong["status"] == "uncertain" and wrong["tx_hash"] is None
    provider.proof = "confirmed"
    confirmed = await refresh_payment(db=db, provider=provider, venture_id=vid, agent_id="fp.cfo", payment_id=result["id"], tx_hash=candidate)
    assert confirmed["status"] == "confirmed" and confirmed["tx_hash"] == candidate
    assert confirmed["fee_wei"] == "1000" and confirmed["confirmations"] == 2
    assert len(provider.sends) == 1


async def test_preparation_funding_error_is_helpful_safe_and_state_changes_are_audited(db):
    vid, settings, provider, policy = await setup(db)
    async def insufficient():
        raise KernelError(409, "insufficient_usdc", "private SDK message must not be copied")
    provider.prepare_hook = insufficient
    result = await send(db, vid, settings, provider, policy)
    assert result["status"] == "failed" and result["error_code"] == "insufficient_usdc"
    assert "Fund" in result["error"] and "private" not in result["error"]
    events = await db.fetch_all("SELECT type,data_json FROM events WHERE venture_id=? AND type LIKE 'wallet.%' ORDER BY id", (vid,))
    assert [event["type"] for event in events] == ["wallet.policy.updated", "wallet.payment.updated", "wallet.payment.updated"]
    assert json.loads(events[-1]["data_json"])["status"] == "failed"


async def test_mainnet_policy_requires_explicit_server_mode_and_cannot_send_on_testnet(db):
    vid, settings, provider, policy = await setup(db)
    old = await db.fetch_one("SELECT policy_json FROM wallet_spending_policies WHERE id=?", (policy["id"],))
    terms = json.loads(old["policy_json"])
    terms["chain_id"] = 8453
    request = PolicyRequest(**terms)
    with pytest.raises(KernelError):
        await create_policy(db=db, settings=settings, venture_id=vid, agent_id="fp.cfo", request=request)
    settings.wallet_mode, settings.chain_id, settings.network = "mainnet", 8453, "base"
    main = await create_policy(db=db, settings=settings, venture_id=vid, agent_id="fp.cfo", request=request)
    await gates.decide(db, main["approval_id"], decision="approve", decided_by="Founder")
    result = await send(db, vid, settings, provider, main)
    assert result["status"] == "submitted" and provider.sends[0]["chain_id"] == 8453
    settings.wallet_mode, settings.chain_id = "testnet", 84532
    # Reconciliation uses the stored chain, even after the server mode changes.
    assert (await confirm(db, provider, vid, result))["status"] == "confirmed"


@pytest.mark.parametrize("amount", [True, "100", 1.5, 0, -1])
def test_request_money_is_strict_integer_cents(amount):
    with pytest.raises(ValidationError):
        PaymentRequest(policy_id="test-policy", recipient=RECIPIENT, amount_minor=amount, purpose="Invoice", idempotency_key="invoice-key-1")


def test_full_app_http_policy_payment_and_verified_receipt_with_real_provider_mock_transport(settings):
    """Exercise auth/envelopes/SQLite/gates/Privy RPC/Base proof with no live network."""
    import httpx
    from fastapi.testclient import TestClient
    from pydantic import SecretStr

    from foundry_kernel.app import create_app
    from foundry_kernel.wallet_config import WalletSettings
    from foundry_kernel.wallet_provider import PrivyClient
    from tests.test_wallet_chain import HASH, Rpc, transaction

    calls = []
    def privy(request):
        calls.append(request)
        assert str(request.url).startswith("https://api.privy.io/v1/wallets/wallet_123")
        if request.method == "GET":
            return httpx.Response(200, json={"id": "wallet_123", "address": OWNER, "chain_type": "ethereum"})
        assert json.loads(request.content) == {"method": "eth_sendTransaction", "chain_type": "ethereum", "caip2": "eip155:84532", "params": {"transaction": transaction()}}
        return httpx.Response(200, json={"method": "eth_sendTransaction", "data": {"hash": HASH, "caip2": "eip155:84532"}})

    app = create_app(settings.model_copy(update={"kernel_token": SecretStr("http-test-only-token")}))
    with TestClient(app) as client:
        wallet_settings = WalletSettings(_env_file=None, privy_app_id="app-test", privy_app_secret="secret-test", wallet_mode="testnet")
        rpc = Rpc()
        app.state.wallet_settings = wallet_settings
        app.state.wallet_provider = PrivyClient(wallet_settings, httpx.MockTransport(privy), chain_transport=httpx.MockTransport(rpc))
        assert client.get("/v1/ventures").status_code == 401
        client.headers["Authorization"] = "Bearer http-test-only-token"
        venture = client.post("/v1/ventures", json={"name": "HTTP Wallet Test", "idea": "Approved supplier payments", "founder_name": "Founder"}).json()["data"]
        vid = venture["id"]

        async def insert_ready_wallet():
            async with app.state.db.tx() as tx:
                now = utc_now()
                await tx.execute("INSERT INTO agent_wallets(id,venture_id,agent_id,external_id,status,wallet_id,address,network,created_at,updated_at) VALUES(?,?,'fp.cfo',?,'ready','wallet_123',?,'base-sepolia',?,?)", (new_id("wal"), vid, new_id("external"), OWNER, now, now))
        client.portal.call(insert_ready_wallet)
        base = f"/v1/ventures/{vid}/agents/fp.cfo/wallet"
        policy_response = client.post(base + "/policies", json={"chain_id": 84532, "recipients": [RECIPIENT], "per_payment_minor": 100, "daily_limit_minor": 200, "total_limit_minor": 300, "max_gas_fee_wei": "20000000", "expires_at": (datetime.now(UTC) + timedelta(days=1)).isoformat()})
        assert policy_response.status_code == 200
        policy = policy_response.json()["data"]
        body = {"policy_id": policy["id"], "recipient": RECIPIENT, "amount_minor": 100, "purpose": "Invoice HTTP-1", "idempotency_key": "invoice-http-1"}
        blocked = client.post(base + "/payments", json=body)
        assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "gate_not_approved"
        assert not calls and not rpc.requests
        assert client.post(f"/v1/approvals/{policy['approval_id']}/decision", json={"decision": "approve", "decided_by": "Founder"}).status_code == 200
        assert client.post(base + "/payments", json={**body, "amount_minor": True}).status_code == 422
        submitted_response = client.post(base + "/payments", json=body)
        assert submitted_response.status_code == 200
        submitted = submitted_response.json()["data"]
        assert submitted["status"] == "submitted" and submitted["tx_hash"] == HASH
        assert client.post(base + "/payments", json=body).json()["data"]["id"] == submitted["id"]
        assert [call.method for call in calls] == ["GET", "POST"]
        checked = client.post(base + f"/payments/{submitted['id']}/refresh", json={}).json()["data"]
        assert checked["status"] == "confirmed" and checked["confirmations"] == 2 and checked["fee_wei"] == "6000110"
        portfolio = client.get(base + "/payments").json()["data"]
        assert portfolio["policies"][0]["status"] == "active" and portfolio["payments"][0]["status"] == "confirmed"
        assert "secret-test" not in json.dumps(portfolio) and "http-test-only-token" not in json.dumps(portfolio)
