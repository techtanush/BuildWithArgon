# OWNER: tanush
"""Durable USDC spending grants and fail-closed payment dispatch/reconciliation."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from . import bus, gates
from .api_models import Envelope
from .db import json_loads_or
from .errors import ConflictError, KernelError, NotFoundError
from .ids import new_id, utc_now
from .records import get_row
from .wallet_chain import address, chain, quantity, transaction_fields

router = APIRouter(tags=["wallet-payments"])
HELD = "('preparing','dispatching','submitted','confirmed','uncertain')"
INFLIGHT = "('preparing','dispatching','submitted','uncertain')"
HASH = re.compile(r"0x[0-9a-fA-F]{64}\Z")


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def digest(value) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
        raise ValueError("A UTC timestamp is required")
    return parsed


class PolicyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    chain_id: Literal[84532, 8453]
    recipients: list[str] = Field(min_length=1, max_length=32)
    per_payment_minor: int = Field(gt=0, le=2500)
    daily_limit_minor: int = Field(gt=0, le=10000)
    total_limit_minor: int = Field(gt=0, le=100000)
    max_gas_fee_wei: str = Field(pattern=r"^[0-9]{1,16}$")
    expires_at: str

    @field_validator("recipients")
    @classmethod
    def allowed_recipients(cls, values):
        return sorted({address(item) for item in values})

    @field_validator("expires_at")
    @classmethod
    def future_expiry(cls, value):
        expiry, now = timestamp(value), datetime.now(UTC)
        if not now < expiry <= now + timedelta(days=30):
            raise ValueError("Policy expiry must be in the next 30 days")
        return expiry.isoformat().replace("+00:00", "Z")

    @model_validator(mode="after")
    def consistent_limits(self):
        if not 0 < int(self.max_gas_fee_wei) <= 10**15:
            raise ValueError("Gas fee limit must be positive and at most 1000000000000000 wei")
        if self.per_payment_minor > self.daily_limit_minor or self.daily_limit_minor > self.total_limit_minor:
            raise ValueError("Payment, daily and total limits must be increasing")
        self.max_gas_fee_wei = str(int(self.max_gas_fee_wei))
        return self


class PaymentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    policy_id: str = Field(min_length=1, max_length=160)
    recipient: str
    amount_minor: int = Field(gt=0, le=2500)
    purpose: str = Field(min_length=1, max_length=1000)
    idempotency_key: str = Field(min_length=8, max_length=128)

    @field_validator("recipient")
    @classmethod
    def recipient_address(cls, value):
        return address(value)

    @field_validator("purpose", "idempotency_key")
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError("Text must contain a non-space character")
        return value


class EmptyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RefreshRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    tx_hash: str | None = Field(default=None, pattern=r"^0x[0-9a-fA-F]{64}$")


async def wallet(tx, venture_id, agent_id):
    await get_row(tx, "ventures", venture_id)
    agent = await get_row(tx, "agents", agent_id)
    if agent["venture_id"] not in (None, venture_id):
        raise ConflictError("Agent wallet must belong to this venture")
    row = await tx.fetch_one("SELECT * FROM agent_wallets WHERE venture_id=? AND agent_id=?", (venture_id, agent_id))
    if not row or row["status"] != "ready" or not row["wallet_id"] or not row["address"]:
        raise ConflictError("This agent needs a ready provider wallet before requesting a spending policy")
    return row


def require_mode(settings, chain_id):
    expected = "mainnet" if chain_id == 8453 else "testnet"
    if not settings.payments_enabled or settings.wallet_mode != expected or settings.chain_id != chain_id:
        raise KernelError(503, "wallet_payments_disabled", "Wallet spending is disabled or the requested chain is not enabled on this server")


async def policy_row(tx, policy_id):
    row = await tx.fetch_one("SELECT * FROM wallet_spending_policies WHERE id=?", (policy_id,))
    if row is None:
        raise NotFoundError("wallet policy", policy_id)
    return row


async def policy_view(tx, row):
    approval = await tx.fetch_one("SELECT status FROM approvals WHERE id=?", (row["approval_id"],))
    terms = json_loads_or(row["policy_json"], {})
    status = "pending_approval"
    if row["revoked_at"]:
        status = "revoked"
    elif timestamp(terms["expires_at"]) <= datetime.now(UTC):
        status = "expired"
    elif approval and approval["status"] == "approved":
        status = "active"
    elif approval and approval["status"] in {"rejected", "expired"}:
        status = "rejected"
    return {"id": row["id"], "wallet_id": row["wallet_id"], **terms, "status": status,
            "approval_id": row["approval_id"], "policy_hash": row["policy_hash"], "created_at": row["created_at"]}


async def create_policy(*, db, settings, venture_id, agent_id, request: PolicyRequest):
    request = PolicyRequest.model_validate(request.model_dump() if isinstance(request, PolicyRequest) else request)
    terms, now = request.model_dump(), utc_now()
    require_mode(settings, request.chain_id)
    async with db.tx() as tx:
        owner = await wallet(tx, venture_id, agent_id)
        if owner["address"].lower() in request.recipients or chain(request.chain_id)["usdc"].lower() in request.recipients:
            raise ConflictError("Policy recipients must be distinct from the wallet and USDC contract")
        hashed = digest(terms)
        old = await tx.fetch_one("SELECT * FROM wallet_spending_policies WHERE wallet_intent_id=? AND policy_hash=?", (owner["id"], hashed))
        if old:
            return await policy_view(tx, old)
        pid = new_id("wpol")
        await tx.execute("INSERT INTO wallet_spending_policies(id,venture_id,agent_id,wallet_intent_id,wallet_id,policy_json,policy_hash,created_at) VALUES(?,?,?,?,?,?,?,?)", (pid, venture_id, agent_id, owner["id"], owner["wallet_id"], canonical(terms), hashed, now))
        aid = await gates.request_approval(tx, venture_id=venture_id, gate_type="integration", title="Authorize agent USDC spending policy",
            summary=f"Allow autonomous USDC payments to {len(request.recipients)} approved recipients, up to {request.total_limit_minor / 100:.2f} USDC total, until {request.expires_at}. Real funds may move after approval.",
            payload={"purpose": "agent_wallet_spending", "policy_id": pid, "policy_hash": hashed, "agent_id": agent_id, "wallet_id": owner["wallet_id"], "chain_id": request.chain_id, "policy": terms}, requested_by_agent_id=agent_id)
        await tx.execute("UPDATE wallet_spending_policies SET approval_id=? WHERE id=?", (aid, pid))
        result = await policy_view(tx, await policy_row(tx, pid))
        await bus.emit(tx, venture_id=venture_id, type="wallet.policy.updated", entity_kind="wallet_policy", entity_id=pid, data=result)
        return result


async def approved_policy(tx, *, settings, owner, policy_id):
    row = await policy_row(tx, policy_id)
    if row["venture_id"] != owner["venture_id"] or row["agent_id"] != owner["agent_id"] or row["wallet_intent_id"] != owner["id"] or row["wallet_id"] != owner["wallet_id"]:
        raise ConflictError("Spending policy must match this exact venture, agent and wallet")
    terms = json_loads_or(row["policy_json"], {})
    if row["revoked_at"] or timestamp(terms["expires_at"]) <= datetime.now(UTC):
        raise ConflictError("Spending policy has been revoked or expired")
    require_mode(settings, terms["chain_id"])
    approval = await gates.require_approved(tx, row["approval_id"], "integration")
    expected = {"purpose": "agent_wallet_spending", "policy_id": row["id"], "policy_hash": row["policy_hash"], "agent_id": row["agent_id"], "wallet_id": row["wallet_id"], "chain_id": terms["chain_id"], "policy": terms}
    if digest(terms) != row["policy_hash"] or approval["venture_id"] != row["venture_id"] or json_loads_or(approval["payload_json"], {}) != expected:
        raise ConflictError("Spending approval does not match the immutable policy exactly")
    return row, terms


async def recover_payments(tx):
    now = utc_now()
    stale = await tx.fetch_all("SELECT id FROM wallet_payments WHERE status IN ('preparing','dispatching') AND lease_expires_at<=?", (now,))
    await tx.execute("UPDATE wallet_payments SET status='failed',error='Preparation was interrupted before dispatch; reservation released.',claim_token=NULL,lease_expires_at=NULL,updated_at=? WHERE status='preparing' AND lease_expires_at<=?", (now, now))
    await tx.execute("UPDATE wallet_payments SET status='uncertain',error='Dispatch was interrupted; reconciliation is required and reservation remains held.',claim_token=NULL,lease_expires_at=NULL,updated_at=? WHERE status='dispatching' AND lease_expires_at<=?", (now, now))
    for row in stale:
        await payment_event(tx, row["id"])


def payment_view(row):
    result = {key: row[key] for key in ("id", "policy_id", "recipient", "amount_minor", "purpose", "idempotency_key", "status", "tx_hash", "error", "created_at", "updated_at", "chain_id", "provider_transaction_id")}
    receipt = json_loads_or(row["receipt_json"], {})
    result.update(fee_wei=receipt.get("fee_wei"), confirmations=receipt.get("confirmations"), error_code=None)
    if row["error"] and ": " in row["error"]:
        result["error_code"] = row["error"].split(": ", 1)[0]
    return result


async def payment_event(tx, payment_id):
    row = await tx.fetch_one("SELECT * FROM wallet_payments WHERE id=?", (payment_id,))
    await bus.emit(tx, venture_id=row["venture_id"], type="wallet.payment.updated", entity_kind="wallet_payment", entity_id=payment_id, data=payment_view(row))


async def payment_row(tx, payment_id, owner):
    row = await tx.fetch_one("SELECT * FROM wallet_payments WHERE id=? AND wallet_intent_id=? AND venture_id=? AND agent_id=?", (payment_id, owner["id"], owner["venture_id"], owner["agent_id"]))
    if row is None:
        raise NotFoundError("wallet payment", payment_id)
    return row


async def limits(tx, owner, policy, terms, amount, recipient, *, excluding=""):
    if recipient not in terms["recipients"] or amount > terms["per_payment_minor"]:
        raise ConflictError("Payment recipient or amount is outside the approved policy")
    daily = await tx.fetch_one(f"SELECT COALESCE(SUM(amount_minor),0) AS n FROM wallet_payments WHERE wallet_intent_id=? AND status IN {HELD} AND reserved_day=? AND id<>?", (owner["id"], utc_now()[:10], excluding))
    total = await tx.fetch_one(f"SELECT COALESCE(SUM(amount_minor),0) AS n FROM wallet_payments WHERE policy_id=? AND status IN {HELD} AND id<>?", (policy["id"], excluding))
    if daily["n"] + amount > terms["daily_limit_minor"] or total["n"] + amount > terms["total_limit_minor"]:
        raise ConflictError("Payment exceeds the approved daily or lifetime spending limit")


async def bound_run(tx, run_id, venture_id, agent_id):
    if run_id:
        run = await get_row(tx, "runs", run_id)
        if run["venture_id"] != venture_id or run["agent_id"] != agent_id or run["status"] != "running":
            raise ConflictError("Agent payment must belong to its current running agent run")


async def pay(*, db, provider, settings, venture_id: str, agent_id: str, request: PaymentRequest, run_id=None) -> dict:
    request = PaymentRequest.model_validate(request.model_dump() if isinstance(request, PaymentRequest) else request)
    fingerprint, key_hash = digest(request.model_dump()), digest(request.idempotency_key)
    async with db.tx() as tx:
        owner = await wallet(tx, venture_id, agent_id)
        await bound_run(tx, run_id, venture_id, agent_id)
        await recover_payments(tx)
        old = await tx.fetch_one("SELECT * FROM wallet_payments WHERE wallet_intent_id=? AND idempotency_hash=?", (owner["id"], key_hash))
        if old:
            if old["request_hash"] != fingerprint:
                raise ConflictError("Idempotency key already identifies a different payment")
            return payment_view(old)
        policy, terms = await approved_policy(tx, settings=settings, owner=owner, policy_id=request.policy_id)
        if await tx.fetch_one(f"SELECT id FROM wallet_payments WHERE wallet_intent_id=? AND status IN {INFLIGHT} LIMIT 1", (owner["id"],)):
            raise ConflictError("Wallet has an unresolved payment; reconcile it before another payment")
        await limits(tx, owner, policy, terms, request.amount_minor, request.recipient)
        pid, claim, now = new_id("wpay"), new_id("claim"), utc_now()
        lease = (datetime.now(UTC) + timedelta(minutes=5)).isoformat().replace("+00:00", "Z")
        await tx.execute("INSERT INTO wallet_payments(id,venture_id,agent_id,wallet_intent_id,policy_id,chain_id,recipient,amount_minor,purpose,idempotency_key,idempotency_hash,request_hash,run_id,status,claim_token,lease_expires_at,reserved_day,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'preparing',?,?,?,?,?)",
                         (pid, venture_id, agent_id, owner["id"], policy["id"], terms["chain_id"], request.recipient, request.amount_minor, request.purpose, request.idempotency_key, key_hash, fingerprint, run_id, claim, lease, now[:10], now, now))
        await payment_event(tx, pid)
    dispatched = False
    try:
        transaction = await provider.prepare_transfer(wallet_address=owner["address"], recipient=request.recipient, amount_units=request.amount_minor * 10000, chain_id=terms["chain_id"], max_gas_fee_wei=int(terms["max_gas_fee_wei"]))
        sender, recipient, units = transaction_fields(transaction, terms["chain_id"])
        if sender != owner["address"].lower() or recipient != request.recipient or units != request.amount_minor * 10000 or quantity(transaction["gas_limit"]) * quantity(transaction["max_fee_per_gas"]) > int(terms["max_gas_fee_wei"]):
            raise ConflictError("Prepared transaction does not match the approved payment and gas limit")
        async with db.tx() as tx:
            current = await payment_row(tx, pid, owner)
            if current["status"] != "preparing" or current["claim_token"] != claim:
                raise ConflictError("Payment preparation claim expired; no transaction was sent")
            fresh_owner = await wallet(tx, venture_id, agent_id)
            await bound_run(tx, run_id, venture_id, agent_id)
            fresh_policy, fresh_terms = await approved_policy(tx, settings=settings, owner=fresh_owner, policy_id=request.policy_id)
            await limits(tx, fresh_owner, fresh_policy, fresh_terms, request.amount_minor, request.recipient, excluding=pid)
            now = utc_now()
            await tx.execute("UPDATE wallet_payments SET status='dispatching',transaction_json=?,reserved_day=?,updated_at=? WHERE id=?", (canonical(transaction), now[:10], now, pid))
            await payment_event(tx, pid)
        # From this durable boundary every failure is ambiguous, including cancellation.
        dispatched = True
        result = await provider.send_transfer(wallet_id=owner["wallet_id"], transaction=transaction, chain_id=terms["chain_id"], idempotency_key=pid)
        if not isinstance(result, dict) or not HASH.fullmatch(str(result.get("hash", ""))) or result.get("caip2") != f"eip155:{terms['chain_id']}":
            raise ValueError("Invalid dispatch identity")
        async with db.tx() as tx:
            await tx.execute("UPDATE wallet_payments SET status='submitted',tx_hash=?,provider_transaction_id=?,claim_token=NULL,lease_expires_at=NULL,error=NULL,updated_at=? WHERE id=? AND status IN ('dispatching','uncertain')", (result["hash"].lower(), result.get("transaction_id"), utc_now(), pid))
            await payment_event(tx, pid)
            return payment_view(await payment_row(tx, pid, owner))
    except BaseException as exc:
        async with db.tx() as tx:
            # A cancelled commit may have succeeded: inspect the durable state.
            current = await payment_row(tx, pid, owner)
            ambiguous = dispatched or current["status"] in {"dispatching", "submitted", "uncertain"}
            if current["status"] not in {"submitted", "confirmed", "reverted"}:
                error = "dispatch_uncertain: Dispatch could not be confirmed; reservation remains held. Reconcile before another payment." if ambiguous else "preparation_failed: Preparation failed before dispatch; no transaction was sent."
                helpful = {"insufficient_usdc": "Wallet has insufficient USDC. Fund the displayed token on the selected chain.", "insufficient_wallet_gas": "Wallet needs native ETH for Base execution and data fees.", "wallet_gas_budget": "Estimated network fees exceed the approved policy gas limit.", "wallet_payments_disabled": "The selected chain or wallet spending is disabled on this server."}
                if not ambiguous and isinstance(exc, KernelError) and exc.code in helpful:
                    error = f"{exc.code}: {helpful[exc.code]}"
                await tx.execute("UPDATE wallet_payments SET status=?,error=?,claim_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?", ("uncertain" if ambiguous else "failed", error, utc_now(), pid))
                await payment_event(tx, pid)
            result = payment_view(await payment_row(tx, pid, owner))
        if not isinstance(exc, Exception):
            raise
        return result


async def revoke_policy(*, db, venture_id, agent_id, policy_id):
    async with db.tx() as tx:
        owner = await wallet(tx, venture_id, agent_id)
        row = await policy_row(tx, policy_id)
        if row["wallet_intent_id"] != owner["id"] or row["venture_id"] != venture_id or row["agent_id"] != agent_id:
            raise ConflictError("Policy does not belong to this agent wallet")
        await tx.execute("UPDATE wallet_spending_policies SET revoked_at=COALESCE(revoked_at,?) WHERE id=?", (utc_now(), policy_id))
        result = await policy_view(tx, await policy_row(tx, policy_id))
        await bus.emit(tx, venture_id=venture_id, type="wallet.policy.updated", entity_kind="wallet_policy", entity_id=policy_id, data=result)
        return result


async def refresh_payment(*, db, provider, venture_id, agent_id, payment_id, tx_hash=None):
    async with db.tx() as tx:
        owner = await wallet(tx, venture_id, agent_id)
        await recover_payments(tx)
        row = await payment_row(tx, payment_id, owner)
    if tx_hash is not None:
        if not isinstance(tx_hash, str) or not HASH.fullmatch(tx_hash):
            raise ConflictError("A complete EVM transaction hash is required")
        tx_hash = tx_hash.lower()
        if row["tx_hash"] and tx_hash != row["tx_hash"].lower():
            raise ConflictError("The payment already has a different transaction hash")
        if not row["tx_hash"] and row["status"] != "uncertain":
            raise ConflictError("A recovery hash is only accepted for an uncertain dispatch")
    candidate = row["tx_hash"] or tx_hash
    if row["status"] not in {"submitted", "uncertain"} or not candidate or not row["transaction_json"]:
        return payment_view(row)
    try:
        proof = await provider.verify_transfer(tx_hash=candidate, transaction=json.loads(row["transaction_json"]), chain_id=row["chain_id"])
        if proof is None:
            # The settlement monitor orders by updated_at. Rotate pending reads so
            # an old unresolved batch cannot starve later wallets indefinitely.
            async with db.tx() as tx:
                await tx.execute("UPDATE wallet_payments SET updated_at=? WHERE id=? AND status IN ('submitted','uncertain')", (utc_now(), row["id"]))
                return payment_view(await payment_row(tx, payment_id, owner))
        if not isinstance(proof, dict) or proof.get("status") not in {"confirmed", "reverted"} or str(proof.get("tx_hash", "")).lower() != candidate.lower() or type(proof.get("confirmations")) is not int or proof["confirmations"] < 2 or type(proof.get("block_number")) is not int or proof["block_number"] < 0 or not str(proof.get("fee_wei", "")).isdigit():
            raise ValueError("Invalid receipt proof")
        async with db.tx() as tx:
            await tx.execute("UPDATE wallet_payments SET status=?,tx_hash=?,receipt_json=?,error=NULL,updated_at=? WHERE id=? AND status IN ('submitted','uncertain')", (proof["status"], candidate.lower(), canonical(proof), utc_now(), row["id"]))
            await payment_event(tx, row["id"])
            return payment_view(await payment_row(tx, payment_id, owner))
    except Exception:  # noqa: BLE001 - a failed chain read must never release reservations
        async with db.tx() as tx:
            await tx.execute("UPDATE wallet_payments SET error='Receipt could not be verified; reservation remains held.',updated_at=? WHERE id=? AND status IN ('submitted','uncertain')", (utc_now(), row["id"]))
            await payment_event(tx, row["id"])
            return payment_view(await payment_row(tx, payment_id, owner))


async def balance_view(*, provider, settings, owner):
    config = chain(settings.chain_id)
    result = {"status": "error", "native_balance_wei": None, "usdc_balance_units": None, "usdc_contract": config["usdc"], "error": None}
    try:
        actual = await provider.balances(owner["address"], settings.chain_id)
        if actual.get("chain_id") != settings.chain_id or str(actual.get("usdc_contract", "")).lower() != config["usdc"].lower() or not all(isinstance(actual.get(key), str) and actual[key].isdigit() for key in ("native_balance_wei", "usdc_balance_units")):
            raise ValueError("Invalid balance response")
        result.update(status="ready", native_balance_wei=actual["native_balance_wei"], usdc_balance_units=actual["usdc_balance_units"])
    except Exception:  # noqa: BLE001 - unavailable balances stay explicitly unknown
        result["error"] = "Live wallet balances could not be read from the configured Base network."
    return result


async def overview(*, db, provider, settings, venture_id, agent_id) -> dict:
    async with db.tx() as tx:
        owner = await wallet(tx, venture_id, agent_id)
        await recover_payments(tx)
        policies = [await policy_view(tx, row) for row in await tx.fetch_all("SELECT * FROM wallet_spending_policies WHERE wallet_intent_id=? ORDER BY created_at DESC,id DESC", (owner["id"],))]
        payments = [payment_view(row) for row in await tx.fetch_all("SELECT * FROM wallet_payments WHERE wallet_intent_id=? ORDER BY created_at DESC,id DESC LIMIT 100", (owner["id"],))]
    return {"wallet": {"wallet_id": owner["wallet_id"], "address": owner["address"], "status": owner["status"]}, "chain_id": settings.chain_id, "network": settings.network, "payments_enabled": settings.payments_enabled,
            "balance": await balance_view(provider=provider, settings=settings, owner=owner), "policies": policies, "payments": payments}


@router.get("/v1/ventures/{vid}/agents/{agent_id}/wallet/payments", response_model=Envelope[dict])
async def get_payments(vid: str, agent_id: str, request: Request):
    return {"data": await overview(db=request.app.state.db, provider=request.app.state.wallet_provider, settings=request.app.state.wallet_settings, venture_id=vid, agent_id=agent_id)}


@router.get("/v1/ventures/{vid}/agents/{agent_id}/wallet/balance", response_model=Envelope[dict])
async def get_balance(vid: str, agent_id: str, request: Request):
    db, provider, settings = request.app.state.db, request.app.state.wallet_provider, request.app.state.wallet_settings
    owner = await wallet(db, vid, agent_id)
    return {"data": {"wallet_id": owner["wallet_id"], "address": owner["address"], "chain_id": settings.chain_id, "network": settings.network, "payments_enabled": settings.payments_enabled,
                     **await balance_view(provider=provider, settings=settings, owner=owner), "asset": "USDC", "native_asset": "ETH", "funding_instructions": "Fund this address on the displayed chain with the displayed USDC contract and native ETH for gas. Confirm the chain before sending funds; the app provides no fiat on-ramp."}}


@router.post("/v1/ventures/{vid}/agents/{agent_id}/wallet/policies", response_model=Envelope[dict])
async def post_policy(vid: str, agent_id: str, body: PolicyRequest, request: Request):
    return {"data": await create_policy(db=request.app.state.db, settings=request.app.state.wallet_settings, venture_id=vid, agent_id=agent_id, request=body)}


@router.post("/v1/ventures/{vid}/agents/{agent_id}/wallet/policies/{policy_id}/revoke", response_model=Envelope[dict])
async def post_revoke(vid: str, agent_id: str, policy_id: str, body: EmptyRequest, request: Request):
    return {"data": await revoke_policy(db=request.app.state.db, venture_id=vid, agent_id=agent_id, policy_id=policy_id)}


@router.post("/v1/ventures/{vid}/agents/{agent_id}/wallet/payments", response_model=Envelope[dict])
async def post_payment(vid: str, agent_id: str, body: PaymentRequest, request: Request):
    return {"data": await pay(db=request.app.state.db, provider=request.app.state.wallet_provider, settings=request.app.state.wallet_settings, venture_id=vid, agent_id=agent_id, request=body)}


@router.post("/v1/ventures/{vid}/agents/{agent_id}/wallet/payments/{payment_id}/refresh", response_model=Envelope[dict])
async def post_refresh(vid: str, agent_id: str, payment_id: str, body: RefreshRequest, request: Request):
    return {"data": await refresh_payment(db=request.app.state.db, provider=request.app.state.wallet_provider, venture_id=vid, agent_id=agent_id, payment_id=payment_id, tx_hash=body.tx_hash)}
