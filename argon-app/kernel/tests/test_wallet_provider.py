# OWNER: tanush
import base64
import json

import httpx
import pytest

from foundry_kernel.errors import KernelError
from foundry_kernel.wallet_config import WalletSettings
from foundry_kernel.wallet_provider import PrivyClient, WalletProviderError


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


def test_creation_only_client_has_no_sign_or_transfer_api():
    public = [name for name in vars(PrivyClient) if not name.startswith("_")]
    assert public == ["ensure_wallet"]
