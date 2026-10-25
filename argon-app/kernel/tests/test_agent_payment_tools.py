# OWNER: tanush
"""Agent payment tools keep stable invoice identity and cannot spend in fake mode."""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from foundry_kernel.departments.base import PaymentInstruction, execute_payment_requests, input_context
from foundry_kernel.errors import KernelError
from tests.test_coordination import context

RECIPIENT = "0x" + "2" * 40


def instruction(**updates):
    return PaymentInstruction.model_validate(dict(policy_id="wpol_test", recipient=RECIPIENT,
        amount_minor=123, purpose="Known merchant invoice", reference="invoice-2026-01", **updates))


async def test_invoice_identity_stays_stable_across_runs_and_policy_changes():
    ctx = SimpleNamespace(venture={"id": "ven_one"}, agent={"id": "fp.cfo"},
                          pay=AsyncMock(return_value={"id": "wpm_one", "status": "submitted"}))
    first = await execute_payment_requests(ctx, [instruction()])
    first_key = ctx.pay.await_args.kwargs["idempotency_key"]
    ctx.run_id = "a-different-run"
    second = await execute_payment_requests(ctx, [instruction()])
    assert first == second and ctx.pay.await_args.kwargs["idempotency_key"] == first_key
    assert first[0]["status"] == "submitted"
    ctx.agent["id"] = "gr.positioning-lead"
    await execute_payment_requests(ctx, [instruction()])
    assert ctx.pay.await_args.kwargs["idempotency_key"] != first_key


async def test_blocked_payment_is_not_reported_as_success():
    ctx = SimpleNamespace(venture={"id": "ven_one"}, agent={"id": "fp.cfo"},
                          pay=AsyncMock(side_effect=KernelError(409, "wallet_policy_revoked", "Private detail")))
    result = await execute_payment_requests(ctx, [instruction()])
    assert result == [{"reference": "invoice-2026-01", "status": "blocked", "error": "wallet_policy_revoked"}]


@pytest.mark.parametrize("bad", [True, 0, -1, "100", 1.5])
def test_agent_amount_is_strict_positive_cents(bad):
    with pytest.raises(ValidationError):
        PaymentInstruction(policy_id="p", recipient=RECIPIENT, amount_minor=bad,
                           purpose="Invoice", reference="invoice")


async def test_fake_agent_cannot_call_real_payment_service(db, settings, monkeypatch):
    ctx, _ = await context(db, settings)
    service = AsyncMock()
    monkeypatch.setattr("foundry_kernel.wallet_payments.pay", service)
    with pytest.raises(KernelError) as error:
        await ctx.pay(policy_id="p", recipient=RECIPIENT, amount_minor=100,
                      purpose="Invoice", idempotency_key="stable-invoice-key")
    assert error.value.code == "wallet_agent_fake_mode"
    service.assert_not_awaited()


async def test_live_tool_is_bound_to_current_run_agent_and_venture(db, settings, monkeypatch):
    ctx, _ = await context(db, settings)
    ctx.settings = settings.model_copy(update={"llm_mode": "live"})
    ctx.db._wallet_settings, ctx.db._wallet_provider = object(), object()
    service = AsyncMock(return_value={"id": "wpm_one", "status": "submitted"})
    monkeypatch.setattr("foundry_kernel.wallet_payments.pay", service)
    assert (await ctx.pay(policy_id="p", recipient=RECIPIENT, amount_minor=100,
                         purpose="Invoice", idempotency_key="stable-invoice-key"))["status"] == "submitted"
    call = service.await_args.kwargs
    assert call["run_id"] == ctx.run_id and call["agent_id"] == ctx.agent["id"]
    assert call["venture_id"] == ctx.venture["id"]
    assert call["request"].amount_minor == 100


async def test_context_without_wallet_never_reads_provider(db, settings):
    ctx, _ = await context(db, settings)
    ctx.db._wallet_provider = AsyncMock()
    assert (await ctx.wallet_status())["payments_enabled"] is False
    prompt = await input_context(ctx.ticket, ctx)
    assert '"wallet"' in prompt and '"policies": []' in prompt
    ctx.db._wallet_provider.balances.assert_not_awaited()


async def test_scheduled_payment_ticket_reports_submitted_not_settled():
    from foundry_kernel.departments import load_handler
    from foundry_kernel.records import TICKET_DEFAULTS
    ctx = SimpleNamespace(venture={"id": "ven_one"}, agent={"id": "fp.cfo"},
                          pay=AsyncMock(return_value={"id": "wpay_one", "status": "submitted"}))
    ticket = {"payload": instruction().model_dump()}
    assert TICKET_DEFAULTS["wallet.pay"] == ("finance-people", "fp.cfo")
    result = await load_handler("wallet.pay").handle(ticket, ctx)
    assert result.outcome == "done" and result.result["wallet_payment"]["status"] == "submitted"
    assert "verified chain receipt" in result.messages[0].body


async def test_settlement_monitor_is_read_only_and_one_bad_read_does_not_stop_it(monkeypatch):
    from foundry_kernel import wallet_monitor
    from contextlib import asynccontextmanager
    tx = SimpleNamespace(execute=AsyncMock(), fetch_all=AsyncMock(return_value=[
        {"id": "pay_a", "venture_id": "v", "agent_id": "fp.cfo"},
        {"id": "pay_b", "venture_id": "v", "agent_id": "fp.cfo"}]))
    @asynccontextmanager
    async def transaction():
        yield tx
    provider = SimpleNamespace(send_transfer=AsyncMock())
    app = SimpleNamespace(state=SimpleNamespace(db=SimpleNamespace(tx=transaction), wallet_provider=provider))
    refresh = AsyncMock(side_effect=[RuntimeError("network read unavailable"), {"status": "confirmed"}])
    monkeypatch.setattr(wallet_monitor, "refresh_payment", refresh)
    monkeypatch.setattr(wallet_monitor, "recover_payments", AsyncMock())
    assert await wallet_monitor.reconcile_once(app) == 2
    assert refresh.await_count == 2
    provider.send_transfer.assert_not_awaited()


async def test_settlement_monitor_cancels_cleanly():
    from foundry_kernel import wallet_monitor
    app = SimpleNamespace(state=SimpleNamespace())
    await wallet_monitor.start(app)
    task = app.state.wallet_monitor_task
    await wallet_monitor.stop(app)
    assert task.done() and app.state.wallet_monitor_task is None


async def test_mainnet_api_requires_server_bearer_auth(settings, monkeypatch):
    from fastapi.testclient import TestClient
    from foundry_kernel.app import create_app
    from foundry_kernel.wallet_config import WalletSettings
    cfg = WalletSettings(_env_file=None, wallet_mode="mainnet")
    monkeypatch.setattr("foundry_kernel.app.WalletSettings", lambda: cfg)
    without_auth = settings.model_copy(update={"kernel_token": None})
    with pytest.raises(RuntimeError, match="KERNEL_TOKEN"):
        with TestClient(create_app(without_auth)):
            pass
