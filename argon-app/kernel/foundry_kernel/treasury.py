# OWNER: tanush
"""Approval-only treasury proposals. This module cannot execute money movement."""
from __future__ import annotations

import hashlib
import json
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import gates
from .api_models import Envelope
from .db import json_loads_or
from .errors import ConflictError, NotFoundError
from .ids import new_id, utc_now
from .records import get_row

router = APIRouter(tags=["treasury"])
PER_PAYMENT_MINOR = 2500
DAILY_LIMIT_MINOR = 10000


class TreasuryProposalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    agent_id: str = Field(min_length=1, max_length=160)
    amount_minor: int = Field(gt=0, le=9_000_000_000_000_000)
    currency: Literal["USD"] = "USD"
    recipient: str = Field(min_length=1, max_length=320)
    purpose: str = Field(min_length=1, max_length=2000)
    idempotency_key: str = Field(min_length=8, max_length=128)

    @field_validator("agent_id", "recipient", "purpose", "idempotency_key")
    @classmethod
    def text_required(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Text must contain a non-space character")
        return value


class TreasuryProposal(BaseModel):
    id: str
    venture_id: str
    agent_id: str
    amount_minor: int
    currency: Literal["USD"]
    recipient: str
    purpose: str
    idempotency_key: str
    status: Literal["pending_approval", "approved_pending_provider", "rejected"]
    approval_id: str
    created_at: str
    decided_at: str | None


class TreasuryPolicy(BaseModel):
    per_payment_minor: int = PER_PAYMENT_MINOR
    daily_limit_minor: int = DAILY_LIMIT_MINOR
    requires_approval: Literal[True] = True


class TreasuryView(BaseModel):
    status: Literal["not_connected"] = "not_connected"
    provider: Literal["stripe"] = "stripe"
    available_balance: None = None
    currency: Literal["USD"] = "USD"
    policy: TreasuryPolicy = Field(default_factory=TreasuryPolicy)
    allocations: list[dict] = Field(default_factory=list)
    reserved_today_minor: int
    proposals: list[TreasuryProposal]


def proposal_view(row: dict) -> dict:
    return TreasuryProposal.model_validate(row).model_dump()


async def get_proposal(db_or_tx, proposal_id: str) -> dict:
    row = await db_or_tx.fetch_one("SELECT * FROM treasury_proposals WHERE id=?", (proposal_id,))
    if row is None:
        raise NotFoundError("treasury proposal", proposal_id)
    return row


async def reserved_today(db_or_tx, venture_id: str, *, excluding: str | None = None, day: str | None = None) -> int:
    row = await db_or_tx.fetch_one("SELECT COALESCE(SUM(amount_minor),0) AS total FROM treasury_proposals WHERE venture_id=? AND reserved_day=? AND status IN ('pending_approval','approved_pending_provider') AND id<>?",
                                  (venture_id, day or utc_now()[:10], excluding or ""))
    return row["total"]


async def propose_payment(*, db, venture_id: str, request: TreasuryProposalRequest) -> dict:
    """Reserve a bounded payment proposal and request approval atomically; never pay."""
    request = TreasuryProposalRequest.model_validate(request.model_dump() if isinstance(request, TreasuryProposalRequest) else request)
    fingerprint = hashlib.sha256(json.dumps(request.model_dump(), sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    key_hash = hashlib.sha256(request.idempotency_key.encode()).hexdigest()
    async with db.tx() as tx:
        now = utc_now()
        await get_row(tx, "ventures", venture_id)
        existing = await tx.fetch_one("SELECT * FROM treasury_proposals WHERE venture_id=? AND idempotency_hash=?", (venture_id, key_hash))
        if existing:
            if existing["request_hash"] != fingerprint:
                raise ConflictError("This idempotency key already identifies a different payment proposal")
            return proposal_view(existing)
        agent = await get_row(tx, "agents", request.agent_id)
        if agent["venture_id"] not in (None, venture_id):
            raise ConflictError("The treasury agent must belong to this venture")
        if request.amount_minor > PER_PAYMENT_MINOR:
            raise ConflictError("Payment exceeds the per-payment treasury limit")
        if await reserved_today(tx, venture_id, day=now[:10]) + request.amount_minor > DAILY_LIMIT_MINOR:
            raise ConflictError("Payment exceeds the daily treasury reservation limit")
        pid = new_id("pay")
        await tx.execute("INSERT INTO treasury_proposals(id,venture_id,agent_id,amount_minor,currency,recipient,purpose,idempotency_key,idempotency_hash,request_hash,status,reserved_day,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'pending_approval',?,?)",
                         (pid, venture_id, request.agent_id, request.amount_minor, request.currency, request.recipient, request.purpose, request.idempotency_key, key_hash, fingerprint, now[:10], now))
        approval_id = await gates.request_approval(tx, venture_id=venture_id, gate_type="spend", title=f"Approve treasury payment: {request.amount_minor / 100:.2f} USD",
            summary="Approval reserves this proposal for a future Stripe adapter. No funds will move.",
            payload={"purpose": "treasury_payment", "proposal_id": pid, "amount_minor": request.amount_minor,
                     "currency": request.currency, "recipient": request.recipient, "purpose_text": request.purpose},
            requested_by_agent_id=request.agent_id)
        await tx.execute("UPDATE treasury_proposals SET approval_id=? WHERE id=?", (approval_id, pid))
        return proposal_view(await get_proposal(tx, pid))


async def apply_decision(tx, approval: dict, decision: str) -> None:
    """Called only inside gates.decide's transaction after the gate decision write."""
    payload = json_loads_or(approval["payload_json"], {})
    now = utc_now()
    proposal = await get_proposal(tx, payload.get("proposal_id", ""))
    if proposal["venture_id"] != approval["venture_id"] or proposal["approval_id"] != approval["id"] or proposal["status"] != "pending_approval":
        raise ConflictError("Treasury approval must match its pending proposal")
    if any(payload.get(key) != proposal[column] for key, column in (
        ("amount_minor", "amount_minor"), ("currency", "currency"),
        ("recipient", "recipient"), ("purpose_text", "purpose"),
    )):
        raise ConflictError("Treasury approval details must match the stored proposal exactly")
    if decision == "approve" and await reserved_today(tx, approval["venture_id"], excluding=proposal["id"], day=now[:10]) + proposal["amount_minor"] > DAILY_LIMIT_MINOR:
        raise ConflictError("Approving this proposal would exceed today's treasury limit")
    status = "approved_pending_provider" if decision == "approve" else "rejected"
    await tx.execute("UPDATE treasury_proposals SET status=?,reserved_day=?,decided_at=? WHERE id=?", (status, now[:10], now, proposal["id"]))


@router.get("/v1/ventures/{vid}/treasury", response_model=Envelope[TreasuryView])
async def get_treasury(vid: str, request: Request):
    db = request.app.state.db
    async with db.tx() as tx:
        await get_row(tx, "ventures", vid)
        rows = await tx.fetch_all("SELECT * FROM treasury_proposals WHERE venture_id=? ORDER BY created_at DESC,id DESC LIMIT 100", (vid,))
        return {"data": TreasuryView(reserved_today_minor=await reserved_today(tx, vid), proposals=[proposal_view(row) for row in rows]).model_dump()}


@router.post("/v1/ventures/{vid}/treasury/proposals", response_model=Envelope[TreasuryProposal])
async def create_proposal(vid: str, body: TreasuryProposalRequest, request: Request):
    return {"data": await propose_payment(db=request.app.state.db, venture_id=vid, request=body)}
