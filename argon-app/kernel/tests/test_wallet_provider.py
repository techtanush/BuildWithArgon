# OWNER: tanush
import asyncio
import base64
import json

import httpx
import pytest

from foundry_kernel.errors import KernelError
from foundry_kernel.wallet_config import WalletSettings
from foundry_kernel.wallet_provider import (
    PrivyClient,
    WalletDispatchAmbiguous,
    WalletProviderError,
)


def settings(**kwargs):
    return WalletSettings(_env_file=None, privy_app_id="app-test", privy_app_secret="secret-test", **kwargs)


def wallet(**kwargs):
    return {"id": "wallet_123", "address": "0x" + "a" * 40, "chain_type": "ethereum", "external_id": "agent-one", **kwargs}


@pytest.mark.asyncio
async def test_existing_wallet_never_posts():
    requests = []

    def handler(request):
        requests.append(request)
        assert str(request.url) == "https://api.privy.io/v1/wallets/ext_wal_agent-one"
        assert request.headers["authorization"] == "Basic " + base64.b64encode(b"app-test:secret-test").decode()
        assert request.headers["privy-app-id"] == "app-test"
        return httpx.Response(200, json=wallet(extra="discarded"))

    result = await PrivyClient(settings(), httpx.MockTransport(handler)).ensure_wallet("agent-one", "One")
    assert result == wallet()
    assert [r.method for r in requests] == ["GET"]


@pytest.mark.asyncio
async def test_create_has_exact_shape_stable_key_and_external_lookup():
    keys = []

    def handler(request):
        if request.method == "GET":
            return httpx.Response(404)
        keys.append(request.headers["privy-idempotency-key"])
        assert json.loads(request.content) == {"chain_type": "ethereum", "external_id": "agent-one", "display_name": "One"}
        return httpx.Response(200, json=wallet())

    client = PrivyClient(settings(), httpx.MockTransport(handler))
    assert await client.ensure_wallet("agent-one", " One ") == wallet()
    assert await client.ensure_wallet("agent-one", "One") == wallet()
    assert keys[0] == keys[1]


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["timeout", 409, 500])
async def test_ambiguous_creation_recovers_only_by_read(failure):
    requests = []

    def handler(request):
        requests.append(request.method)
        if len(requests) == 1:
            return httpx.Response(404)
        if request.method == "POST":
            if failure == "timeout":
                raise httpx.ReadTimeout("private provider secret body", request=request)
            return httpx.Response(failure, text="private provider secret body")
        return httpx.Response(200, json=wallet())

    assert await PrivyClient(settings(), httpx.MockTransport(handler)).ensure_wallet("agent-one", "One") == wallet()
    assert requests == ["GET", "POST", "GET"]


@pytest.mark.asyncio
async def test_unconfirmed_creation_is_safe_and_does_not_repeat_post():
    requests = []

    def handler(request):
        requests.append(request.method)
        return httpx.Response(404 if request.method == "GET" else 500, text="secret-test")

    with pytest.raises(WalletProviderError) as error:
        await PrivyClient(settings(), httpx.MockTransport(handler)).ensure_wallet("agent-one", "One")
    assert "secret-test" not in str(error.value)
    assert requests == ["GET", "POST", "GET"]


@pytest.mark.asyncio
@pytest.mark.parametrize("change", [
    {"address": "0x123"}, {"id": "../wallet"}, {"external_id": "other"},
    {"chain_type": "solana"}, {"archived_at": 1},
])
async def test_untrusted_provider_record_rejected(change):
    transport = httpx.MockTransport(lambda _: httpx.Response(200, json=wallet(**change)))
    with pytest.raises(WalletProviderError):
        await PrivyClient(settings(), transport).ensure_wallet("agent-one", "One")


@pytest.mark.asyncio
@pytest.mark.parametrize("external_id", ["../escape", "x?url=https://evil", "a" * 65, "", "agent one"])
async def test_invalid_external_id_never_reaches_transport(external_id):
    def handler(_):
        pytest.fail("Invalid identifiers must not reach provider")
    with pytest.raises(KernelError) as error:
        await PrivyClient(settings(), httpx.MockTransport(handler)).ensure_wallet(external_id, "One")
    assert error.value.status_code == 400


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [301, 401, 429, 500])
async def test_lookup_failure_never_creates_or_follows_redirect(status):
    requests = []

    def handler(request):
        requests.append(str(request.url))
        return httpx.Response(status, headers={"Location": "https://evil.test"}, text="secret-test")

    with pytest.raises(WalletProviderError) as error:
        await PrivyClient(settings(), httpx.MockTransport(handler)).ensure_wallet("agent-one", "One")
    assert "secret-test" not in str(error.value)
    assert len(requests) == 1


@pytest.mark.asyncio
async def test_disabled_and_unconfigured_never_contact_provider():
    def handler(_):
        pytest.fail("disabled provider must not be called")
    for cfg in (settings(wallet_mode="off"), WalletSettings(_env_file=None)):
        with pytest.raises(KernelError) as error:
            await PrivyClient(cfg, httpx.MockTransport(handler)).ensure_wallet("agent-one", "One")
        assert error.value.status_code == 503


def test_client_has_only_restricted_payment_and_creation_api():
    public = [name for name in vars(PrivyClient) if not name.startswith("_")]
    assert set(public) == {"ensure_wallet", "balances", "prepare_transfer", "send_transfer", "verify_transfer"}


def payment_transaction():
    return {"from": "0x" + "1" * 40, "to": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "value": "0x0",
        "data": "0xa9059cbb" + ("2" * 40).zfill(64) + format(1_000_000, "064x"), "chain_id": 84532,
        "gas_limit": hex(72_000), "max_fee_per_gas": hex(201), "max_priority_fee_per_gas": "0x1", "nonce": 5}


async def ready(*_):
    pass


@pytest.mark.asyncio
async def test_send_uses_exact_privy_snake_case_fields_and_stable_key(monkeypatch):
    requests = []
    tx = payment_transaction()

    def handler(request):
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(200, json=wallet(address=tx["from"]))
        assert str(request.url) == "https://api.privy.io/v1/wallets/wallet_123/rpc"
        assert request.headers["privy-idempotency-key"] == "stable-payment-id"
        assert json.loads(request.content) == {"method": "eth_sendTransaction", "chain_type": "ethereum", "caip2": "eip155:84532", "params": {"transaction": tx}}
        return httpx.Response(200, json={"method": "eth_sendTransaction", "data": {"hash": "0x" + "a" * 64, "caip2": "eip155:84532", "transaction_id": "tx_123"}})

    client = PrivyClient(settings(), httpx.MockTransport(handler))
    monkeypatch.setattr(client._chain, "_validate_for_dispatch", ready)
    result = await client.send_transfer("wallet_123", tx, 84532, "stable-payment-id")
    assert result == {"hash": "0x" + "a" * 64, "caip2": "eip155:84532", "transaction_id": "tx_123"}
    assert [r.method for r in requests] == ["GET", "POST"]


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["timeout", "cancel", "bad_json", "wrong_chain", "wrong_hash", 400, 500])
async def test_every_failure_after_post_is_ambiguous_and_never_retried(monkeypatch, failure):
    methods = []

    def handler(request):
        methods.append(request.method)
        if request.method == "GET":
            return httpx.Response(200, json=wallet(address=payment_transaction()["from"]))
        if failure == "timeout":
            raise httpx.ReadTimeout("private-secret", request=request)
        if failure == "cancel":
            raise asyncio.CancelledError()
        if failure == "bad_json":
            return httpx.Response(200, text="private-secret")
        if type(failure) is int:
            return httpx.Response(failure, text="private-secret")
        return httpx.Response(200, json={"method": "eth_sendTransaction", "data": {"hash": "0x123" if failure == "wrong_hash" else "0x" + "a" * 64, "caip2": "eip155:1" if failure == "wrong_chain" else "eip155:84532"}})

    client = PrivyClient(settings(), httpx.MockTransport(handler))
    monkeypatch.setattr(client._chain, "_validate_for_dispatch", ready)
    with pytest.raises(WalletDispatchAmbiguous) as error:
        await client.send_transfer("wallet_123", payment_transaction(), 84532, "stable-payment-id")
    assert error.value.ambiguous and "private-secret" not in str(error.value)
    assert methods == ["GET", "POST"]


@pytest.mark.asyncio
async def test_wallet_identity_mismatch_is_definite_before_dispatch(monkeypatch):
    methods = []

    def handler(request):
        methods.append(request.method)
        return httpx.Response(200, json=wallet(address="0x" + "3" * 40))

    client = PrivyClient(settings(), httpx.MockTransport(handler))
    monkeypatch.setattr(client._chain, "_validate_for_dispatch", ready)
    with pytest.raises(WalletProviderError) as error:
        await client.send_transfer("wallet_123", payment_transaction(), 84532, "stable-payment-id")
    assert not isinstance(error.value, WalletDispatchAmbiguous) and methods == ["GET"]


@pytest.mark.asyncio
async def test_payment_mode_mismatch_and_kill_switch_prevent_any_network():
    def handler(_):
        pytest.fail("Mode mismatch must not contact any provider")
    for config, chain_id in [(settings(), 8453), (settings(wallet_payments_enabled=False), 84532), (settings(wallet_mode="off"), 84532)]:
        with pytest.raises(KernelError):
            await PrivyClient(config, httpx.MockTransport(handler), httpx.MockTransport(handler)).send_transfer("wallet_123", payment_transaction(), chain_id, "stable")


@pytest.mark.asyncio
async def test_transport_cleanup_failure_after_broadcast_is_also_ambiguous(monkeypatch):
    class FailingClose(httpx.MockTransport):
        async def aclose(self):
            raise httpx.CloseError("private cleanup data")

    def handler(request):
        if request.method == "GET":
            return httpx.Response(200, json=wallet(address=payment_transaction()["from"]))
        return httpx.Response(200, json={"method": "eth_sendTransaction", "data": {"hash": "0x" + "a" * 64, "caip2": "eip155:84532"}})

    client = PrivyClient(settings(), FailingClose(handler))
    monkeypatch.setattr(client._chain, "_validate_for_dispatch", ready)
    with pytest.raises(WalletDispatchAmbiguous):
        await client.send_transfer("wallet_123", payment_transaction(), 84532, "stable")
