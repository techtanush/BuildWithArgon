# OWNER: tanush
"""Treasury reservations and founder decisions cannot move funds or alter LLM budgets."""
import asyncio
import json

import pytest
from pydantic import SecretStr, ValidationError

from foundry_kernel import gates, ledger
from foundry_kernel.db import json_loads_or
from foundry_kernel.errors import ConflictError
from foundry_kernel.treasury import (
    TreasuryProposalRequest,
    get_proposal,
    propose_payment,
    reserved_today,
)
from tests.tanush.helpers import insert_venture


def proposal(key="payment-key-1", amount=2500, **kwargs):
    return TreasuryProposalRequest(agent_id="fp.cfo", amount_minor=amount, recipient="Vendor", purpose="Hackathon hosting", idempotency_key=key, **kwargs)


async def test_proposal_is_durable_idempotent_and_approval_never_claims_payment(db):
    vid = await insert_venture(db, budget=10, status="running")
    result = await propose_payment(db=db, venture_id=vid, request=proposal())
    assert result["status"] == "pending_approval" and result["amount_minor"] == 2500
    assert await propose_payment(db=db, venture_id=vid, request=proposal()) == result
    with pytest.raises(ConflictError, match="different"):
        await propose_payment(db=db, venture_id=vid, request=proposal(amount=2400))
    approval = await db.fetch_one("SELECT * FROM approvals WHERE id=?", (result["approval_id"],))
    payload = json_loads_or(approval["payload_json"], {})
    assert payload["purpose"] == "treasury_payment" and payload["purpose_text"] == "Hackathon hosting"
    await gates.decide(db, result["approval_id"], decision="approve", decided_by="Tanush")
    assert (await get_proposal(db, result["id"]))["status"] == "approved_pending_provider"
    venture = await db.fetch_one("SELECT status,budget_usd,spent_usd FROM ventures WHERE id=?", (vid,))
    assert venture == {"status": "running", "budget_usd": 10.0, "spent_usd": 0.0}
    assert not await db.fetch_all("SELECT id FROM ledger WHERE venture_id=?", (vid,))


async def test_rejection_releases_reservation_without_pausing_or_raising_budget(db):
    vid = await insert_venture(db, budget=1, status="running")
    result = await propose_payment(db=db, venture_id=vid, request=proposal())
    assert await reserved_today(db, vid) == 2500
    await gates.decide(db, result["approval_id"], decision="reject", decided_by="Tanush")
    assert await reserved_today(db, vid) == 0
    assert (await get_proposal(db, result["id"]))["status"] == "rejected"
    assert (await db.fetch_one("SELECT status FROM ventures WHERE id=?", (vid,)))["status"] == "running"


async def test_atomic_daily_limit_and_per_payment_limit(db):
    vid = await insert_venture(db)
    with pytest.raises(ConflictError, match="per-payment"):
        await propose_payment(db=db, venture_id=vid, request=proposal(amount=2501))
    results = await asyncio.gather(*(propose_payment(db=db, venture_id=vid, request=proposal(key=f"payment-key-{i}")) for i in range(6)), return_exceptions=True)
    assert sum(isinstance(result, dict) for result in results) == 4
    assert sum(isinstance(result, ConflictError) for result in results) == 2
    assert await reserved_today(db, vid) == 10000
    assert len(await db.fetch_all("SELECT id FROM approvals WHERE venture_id=?", (vid,))) == 4


async def test_concurrent_retries_reserve_exactly_once_and_budget_gate_is_separate(db):
    vid = await insert_venture(db, budget=1)
    results = await asyncio.gather(*(propose_payment(db=db, venture_id=vid, request=proposal()) for _ in range(5)))
    assert len({result["id"] for result in results}) == 1
    async with db.tx() as tx:
        await ledger.record(tx, venture_id=vid, kind="model", cost_usd=1)
    approvals = await db.fetch_all("SELECT * FROM approvals WHERE venture_id=? AND gate_type='spend'", (vid,))
    assert len(approvals) == 2
    budget = next(row for row in approvals if json_loads_or(row["payload_json"], {}).get("purpose") != "treasury_payment")
    await gates.decide(db, budget["id"], decision="approve", decided_by="Tanush")
    assert (await db.fetch_one("SELECT budget_usd FROM ventures WHERE id=?", (vid,)))["budget_usd"] == 2
    assert (await get_proposal(db, results[0]["id"]))["status"] == "pending_approval"


async def test_old_pending_approval_rechecks_current_day_cap_and_rolls_back(db):
    vid = await insert_venture(db)
    old = await propose_payment(db=db, venture_id=vid, request=proposal(key="old-payment-key"))
    async with db.tx() as tx:
        await tx.execute("UPDATE treasury_proposals SET reserved_day='2000-01-01' WHERE id=?", (old["id"],))
    for i in range(4):
        await propose_payment(db=db, venture_id=vid, request=proposal(key=f"new-payment-key-{i}"))
    with pytest.raises(ConflictError, match="today"):
        await gates.decide(db, old["approval_id"], decision="approve", decided_by="Tanush")
    assert (await get_proposal(db, old["id"]))["status"] == "pending_approval"
    assert (await db.fetch_one("SELECT status FROM approvals WHERE id=?", (old["approval_id"],)))["status"] == "pending"


async def test_cross_venture_agent_is_rejected_and_stored_text_is_redacted(db, settings):
    vid = await insert_venture(db)
    other = await insert_venture(db)
    async with db.tx() as tx:
        await tx.execute("UPDATE agents SET venture_id=? WHERE id='fp.cfo'", (other,))
    with pytest.raises(ConflictError, match="belong"):
        await propose_payment(db=db, venture_id=vid, request=proposal())
    async with db.tx() as tx:
        await tx.execute("UPDATE agents SET venture_id=NULL WHERE id='fp.cfo'")
    secret = "test-only-private-treasury-token"
    db.settings = settings.model_copy(update={"gemini_api_key": SecretStr(secret)})
    req = proposal().model_copy(update={"purpose": f"Host {secret}", "idempotency_key": secret})
    result = await propose_payment(db=db, venture_id=vid, request=req)
    assert secret not in str(result)
    # Even a redacted opaque idempotency key remains retryable through its digest.
    assert await propose_payment(db=db, venture_id=vid, request=req) == result
    approval = await db.fetch_one("SELECT payload_json FROM approvals WHERE id=?", (result["approval_id"],))
    assert secret not in approval["payload_json"]


async def test_idempotency_compares_original_request_even_when_secrets_redact_identically(db, settings):
    vid = await insert_venture(db)
    first_secret, second_secret = "sk-" + "a" * 32, "sk-" + "b" * 32
    db.settings = settings.model_copy(update={"gemini_api_key": SecretStr(first_secret), "kernel_token": SecretStr(second_secret)})
    first = proposal().model_copy(update={"purpose": first_secret})
    stored = await propose_payment(db=db, venture_id=vid, request=first)
    assert stored["purpose"] == "[REDACTED]"
    with pytest.raises(ConflictError, match="different"):
        await propose_payment(db=db, venture_id=vid, request=first.model_copy(update={"purpose": second_secret}))


@pytest.mark.parametrize(("field", "value"), [("amount_minor", 1), ("currency", "EUR"), ("recipient", "Different vendor"), ("purpose_text", "Different purpose")])
async def test_tampered_payment_approval_rolls_back_decision(db, field, value):
    vid = await insert_venture(db)
    result = await propose_payment(db=db, venture_id=vid, request=proposal())
    async with db.tx() as tx:
        approval = await tx.fetch_one("SELECT payload_json FROM approvals WHERE id=?", (result["approval_id"],))
        payload = json.loads(approval["payload_json"])
        payload[field] = value
        await tx.execute("UPDATE approvals SET payload_json=? WHERE id=?", (json.dumps(payload), result["approval_id"]))
    with pytest.raises(ConflictError, match="exactly"):
        await gates.decide(db, result["approval_id"], decision="approve", decided_by="Tanush")
    assert (await db.fetch_one("SELECT status FROM approvals WHERE id=?", (result["approval_id"],)))["status"] == "pending"
    assert (await get_proposal(db, result["id"]))["status"] == "pending_approval"


@pytest.mark.parametrize("amount", [True, "100", 1.5, 0, -1])
def test_money_requires_positive_integer_minor_units(amount):
    with pytest.raises(ValidationError):
        proposal(amount=amount)


def test_currency_and_extra_fields_are_rejected():
    with pytest.raises(ValidationError):
        proposal(currency="EUR")
    with pytest.raises(ValidationError):
        proposal(execute=True)
