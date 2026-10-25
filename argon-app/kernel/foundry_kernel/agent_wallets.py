# OWNER: tanush
"""Approved testnet wallet provisioning; no signing, funding or transfer surface."""
from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from . import gates
from .api_models import Envelope
from .db import json_loads_or
from .errors import ConflictError, KernelError
from .ids import new_id, utc_now
from .records import get_row

router = APIRouter(tags=["agent-wallets"])
NETWORK = "base-sepolia"


class WalletRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AgentWallet(BaseModel):
    agent_id: str
    status: Literal["pending_approval", "provisioning", "ready", "error"]
    wallet_id: str | None
    address: str | None
    approval_id: str
    network: Literal["base-sepolia"]
    created_at: str
    error: str | None


class WalletsView(BaseModel):
    provider: Literal["privy"] = "privy"
    configured: bool
    network: Literal["base-sepolia"] = "base-sepolia"
    chain_id: Literal[84532] = 84532
    mainnet_enabled: Literal[False] = False
    spending_enabled: Literal[False] = False
    wallet_limit: int
    wallets: list[AgentWallet] = Field(default_factory=list)


def wallet_view(row: dict) -> dict:
    return AgentWallet.model_validate(row).model_dump()


def external_identity(venture_id: str, agent_id: str) -> str:
    return "argon-" + hashlib.sha256(f"{venture_id}\0{agent_id}".encode()).hexdigest()[:48]


async def recover_claims(tx) -> None:
    await tx.execute("UPDATE agent_wallets SET status='error',claim_token=NULL,lease_expires_at=NULL,error='Provisioning was interrupted; retry safely.',updated_at=? WHERE status='provisioning' AND lease_expires_at<=?", (utc_now(), utc_now()))
    await tx.execute("UPDATE agent_wallets SET status='error',error='Wallet creation approval was rejected or expired.',updated_at=? WHERE status='pending_approval' AND approval_id IN (SELECT id FROM approvals WHERE status IN ('rejected','expired'))", (utc_now(),))


async def provision_wallet(*, db, provider, configured: bool, wallet_limit: int, venture_id: str, agent_id: str) -> dict:
    """Reserve capacity and bind an integration approval before invoking a provider."""
    claim = None
    async with db.tx() as tx:
        await get_row(tx, "ventures", venture_id)
        agent = await get_row(tx, "agents", agent_id)
        if agent["venture_id"] not in (None, venture_id):
            raise ConflictError("The wallet agent must belong to this venture")
        if not configured:
            raise KernelError(503, "wallet_not_configured", "Privy wallet credentials must be configured on the server")
        await recover_claims(tx)
        row = await tx.fetch_one("SELECT * FROM agent_wallets WHERE venture_id=? AND agent_id=?", (venture_id, agent_id))
        if row and row["status"] in {"ready", "provisioning"}:
            return wallet_view(row)
        approval = await tx.fetch_one("SELECT * FROM approvals WHERE id=?", (row["approval_id"],)) if row else None
        if not approval or approval["status"] in {"rejected", "expired"}:
            count = await tx.fetch_one("SELECT COUNT(*) AS n FROM agent_wallets w LEFT JOIN approvals a ON a.id=w.approval_id WHERE w.status='ready' OR COALESCE(a.status,'pending') NOT IN ('rejected','expired')")
            if count["n"] >= max(0, min(wallet_limit, 50)):
                raise ConflictError("The global agent wallet reservation limit has been reached")
            wid, now = (row["id"] if row else new_id("wal")), utc_now()
            if not row:
                await tx.execute("INSERT INTO agent_wallets(id,venture_id,agent_id,external_id,status,network,created_at,updated_at) VALUES(?,?,?,?,'pending_approval',?,?,?)", (wid, venture_id, agent_id, external_identity(venture_id, agent_id), NETWORK, now, now))
            aid = await gates.request_approval(tx, venture_id=venture_id, gate_type="integration", title=f"Create testnet wallet for {agent['display_name']}",
                summary="Create a Privy wallet for Base Sepolia. Mainnet, funding, signing and spending remain disabled.",
                payload={"purpose": "agent_wallet_create", "provider": "privy", "agent_id": agent_id, "wallet_intent_id": wid, "network": NETWORK}, requested_by_agent_id=agent_id)
            await tx.execute("UPDATE agent_wallets SET approval_id=?,status='pending_approval',error=NULL,updated_at=? WHERE id=?", (aid, now, wid))
            return wallet_view(await tx.fetch_one("SELECT * FROM agent_wallets WHERE id=?", (wid,)))
        if approval["status"] == "pending":
            return wallet_view(row)
        approval = await gates.require_approved(tx, row["approval_id"], "integration")
        payload = json_loads_or(approval["payload_json"], {})
        if approval["venture_id"] != venture_id or payload.get("purpose") != "agent_wallet_create" or payload.get("wallet_intent_id") != row["id"] or payload.get("agent_id") != agent_id or payload.get("provider") != "privy" or payload.get("network") != NETWORK:
            raise ConflictError("Wallet approval must match this exact venture, agent and testnet intent")
        claim = new_id("claim")
        expires = (datetime.now(UTC) + timedelta(minutes=2)).isoformat().replace("+00:00", "Z")
        await tx.execute("UPDATE agent_wallets SET status='provisioning',claim_token=?,lease_expires_at=?,error=NULL,updated_at=? WHERE id=?", (claim, expires, utc_now(), row["id"]))
    try:
        result = await provider.ensure_wallet(external_id=row["external_id"], display_name=agent["display_name"])
        wallet_id, address = result["id"], result["address"]
        if not isinstance(wallet_id, str) or not wallet_id or not isinstance(address, str) or len(address) != 42 or not address.startswith("0x") or any(c not in "0123456789abcdefABCDEF" for c in address[2:]):
            raise ValueError("Provider returned an invalid wallet identity")
        async with db.tx() as tx:
            await tx.execute("UPDATE agent_wallets SET status='ready',wallet_id=?,address=?,claim_token=NULL,lease_expires_at=NULL,error=NULL,updated_at=? WHERE id=? AND claim_token=? AND status='provisioning'", (wallet_id, address, utc_now(), row["id"], claim))
            return wallet_view(await tx.fetch_one("SELECT * FROM agent_wallets WHERE id=?", (row["id"],)))
    except BaseException as exc:
        async with db.tx() as tx:
            await tx.execute("UPDATE agent_wallets SET status='error',claim_token=NULL,lease_expires_at=NULL,error='Wallet provisioning failed or was interrupted; retry safely.',updated_at=? WHERE id=? AND claim_token=?", (utc_now(), row["id"], claim))
        if not isinstance(exc, Exception):
            raise
        raise KernelError(502, "wallet_provider_error", "Privy wallet provisioning failed; the approved intent can be retried safely") from exc


def dependencies(request: Request):
    settings = request.app.state.wallet_settings
    return settings, request.app.state.wallet_provider


@router.get("/v1/ventures/{vid}/wallets", response_model=Envelope[WalletsView])
async def get_wallets(vid: str, request: Request):
    db = request.app.state.db
    settings, _ = dependencies(request)
    async with db.tx() as tx:
        await get_row(tx, "ventures", vid)
        await recover_claims(tx)
        rows = await tx.fetch_all("SELECT * FROM agent_wallets WHERE venture_id=? ORDER BY created_at,id", (vid,))
    return {"data": WalletsView(configured=settings.configured and settings.wallet_mode == "testnet", wallet_limit=min(settings.wallet_limit, 50), wallets=[wallet_view(row) for row in rows]).model_dump()}


@router.post("/v1/ventures/{vid}/agents/{agent_id}/wallet", response_model=Envelope[AgentWallet])
async def create_wallet(vid: str, agent_id: str, body: WalletRequest, request: Request):
    settings, provider = dependencies(request)
    if settings.wallet_mode != "testnet":
        raise KernelError(503, "wallet_disabled", "Agent wallet provisioning is disabled on the server")
    return {"data": await provision_wallet(db=request.app.state.db, provider=provider, configured=settings.configured, wallet_limit=settings.wallet_limit, venture_id=vid, agent_id=agent_id)}
