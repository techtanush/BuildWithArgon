# OWNER: tanush
import json

import httpx
import pytest

from foundry_kernel.errors import KernelError
from foundry_kernel.wallet_chain import (
    CHAINS,
    BaseChain,
    WalletChainError,
    transaction_fields,
)

OWNER = "0x" + "1" * 40
RECIPIENT = "0x" + "2" * 40
HASH = "0x" + "a" * 64
BLOCK_HASH = "0x" + "b" * 64
TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"


def transaction():
    return {"from": OWNER, "to": CHAINS[84532]["usdc"], "value": "0x0", "data": "0xa9059cbb" + RECIPIENT[2:].zfill(64) + format(1_000_000, "064x"),
        "chain_id": 84532, "gas_limit": hex(72_000), "max_fee_per_gas": hex(201), "max_priority_fee_per_gas": "0x1", "nonce": 5}


def receipt(**updates):
    return {"transactionHash": HASH, "blockHash": BLOCK_HASH, "blockNumber": "0xa", "status": "0x1", "gasUsed": "0xea60", "effectiveGasPrice": "0x64", "l1Fee": "0x64", "operatorFee": "0xa",
        "logs": [{"address": CHAINS[84532]["usdc"], "topics": [TOPIC, "0x" + OWNER[2:].zfill(64), "0x" + RECIPIENT[2:].zfill(64)], "data": "0x" + format(1_000_000, "064x")}], **updates}


def onchain(**updates):
    tx = transaction()
    return {"hash": HASH, "from": OWNER, "to": tx["to"], "input": tx["data"], "chainId": hex(84532), "value": "0x0", "nonce": "0x5", "gas": tx["gas_limit"],
        "maxFeePerGas": tx["max_fee_per_gas"], "maxPriorityFeePerGas": tx["max_priority_fee_per_gas"], "blockHash": BLOCK_HASH, "blockNumber": "0xa", **updates}


class Rpc:
    def __init__(self, **overrides):
        self.overrides = overrides
        self.requests = []

    def __call__(self, request):
        assert str(request.url) == "https://sepolia.base.org/"
        assert "authorization" not in request.headers
        body = json.loads(request.content)
        method, params = body["method"], body["params"]
        self.requests.append((method, params))
        if method in self.overrides:
            result = self.overrides[method]
            if callable(result):
                result = result(params)
        elif method == "eth_chainId":
            result = hex(84532)
        elif method == "eth_getBalance":
            result = hex(10**18)
        elif method == "eth_call":
            data = params[0]["data"]
            if data.startswith("0x70a08231"):
                assert params[0]["to"] == CHAINS[84532]["usdc"]
                result = hex(10_000_000)
            else:
                assert params[0]["to"] == "0x420000000000000000000000000000000000000F"
                assert data.startswith(("0xf1c7a58b", "0x275aedd2"))
                result = hex(100)
        elif method == "eth_estimateGas":
            assert params[0]["data"] == transaction()["data"]
            result = hex(60_000)
        elif method == "eth_getBlockByNumber":
            result = {"baseFeePerGas": hex(100)} if params[0] == "pending" else {"hash": BLOCK_HASH}
        elif method == "eth_maxPriorityFeePerGas":
            result = "0x1"
        elif method == "eth_getTransactionCount":
            result = "0x5"
        elif method == "eth_getTransactionReceipt":
            result = receipt()
        elif method == "eth_getTransactionByHash":
            result = onchain()
        elif method == "eth_blockNumber":
            result = "0xb"
        else:
            pytest.fail(f"Unexpected RPC method {method}")
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": result})


@pytest.mark.asyncio
async def test_balances_are_exact_and_reads_only_fixed_contract():
    rpc = Rpc()
    result = await BaseChain(httpx.MockTransport(rpc)).balances(OWNER, 84532)
    assert result == {"native_balance_wei": str(10**18), "usdc_balance_units": "10000000", "chain_id": 84532, "usdc_contract": CHAINS[84532]["usdc"]}
    assert [m for m, _ in rpc.requests] == ["eth_chainId", "eth_getBalance", "eth_call"]


@pytest.mark.asyncio
async def test_prepare_encodes_only_transfer_and_bounds_execution_and_data_fees():
    rpc = Rpc()
    result = await BaseChain(httpx.MockTransport(rpc)).prepare_transfer(wallet_address=OWNER, recipient=RECIPIENT, amount_units=1_000_000, chain_id=84532, max_gas_fee_wei=20_000_000)
    assert result == transaction()
    assert any(p[0].get("data", "").startswith("0xf1c7a58b") for m, p in rpc.requests if m == "eth_call")


@pytest.mark.asyncio
@pytest.mark.parametrize("rpc,cap,code", [
    ({"eth_chainId": "0x1"}, 20_000_000, "dependency_error"),
    ({"eth_getBalance": "0x0"}, 20_000_000, "insufficient_wallet_gas"),
    ({"eth_call": "0x0"}, 20_000_000, "insufficient_usdc"),
    ({}, 100, "wallet_gas_budget"),
    ({"eth_estimateGas": hex(1_000_000)}, 20_000_000, "invalid_wallet_transaction"),
])
async def test_prepare_rejects_unsafe_or_unfunded_transfers(rpc, cap, code):
    with pytest.raises(KernelError) as error:
        await BaseChain(httpx.MockTransport(Rpc(**rpc))).prepare_transfer(wallet_address=OWNER, recipient=RECIPIENT, amount_units=1_000_000, chain_id=84532, max_gas_fee_wei=cap)
    assert error.value.code == code


@pytest.mark.asyncio
@pytest.mark.parametrize("recipient", [OWNER, "0x" + "0" * 40, CHAINS[84532]["usdc"], "https://evil.test"])
async def test_bad_recipient_has_no_network_side_effect(recipient):
    rpc = Rpc()
    with pytest.raises(KernelError):
        await BaseChain(httpx.MockTransport(rpc)).prepare_transfer(wallet_address=OWNER, recipient=recipient, amount_units=1, chain_id=84532, max_gas_fee_wei=20_000_000)
    assert rpc.requests == []


@pytest.mark.parametrize("changes", [{"to": RECIPIENT}, {"value": "0x1"}, {"chain_id": 1}, {"data": "0x095ea7b3" + "0" * 128}, {"authorization_list": []}, {"max_fee_per_gas": "0x0"}, {"nonce": True}])
def test_transaction_validator_rejects_arbitrary_actions(changes):
    with pytest.raises(KernelError):
        transaction_fields({**transaction(), **changes}, 84532)


@pytest.mark.asyncio
async def test_confirmation_requires_exact_transaction_stable_canonical_receipt_and_transfer_event():
    rpc = Rpc()
    result = await BaseChain(httpx.MockTransport(rpc)).verify_transfer(tx_hash=HASH, transaction=transaction(), chain_id=84532)
    assert result == {"status": "confirmed", "tx_hash": HASH, "block_number": 10, "fee_wei": "6000110", "confirmations": 2}
    assert sum(m == "eth_getTransactionReceipt" for m, _ in rpc.requests) == 2


@pytest.mark.asyncio
async def test_reverted_confirmed_receipt_reports_only_fee():
    result = await BaseChain(httpx.MockTransport(Rpc(eth_getTransactionReceipt=receipt(status="0x0", logs=[])))).verify_transfer(tx_hash=HASH, transaction=transaction(), chain_id=84532)
    assert result["status"] == "reverted"


@pytest.mark.asyncio
async def test_operator_fee_uses_historical_oracle_instead_of_fork_specific_formula():
    raw = receipt(operatorFeeScalar="0x1", operatorFeeConstant="0x7")
    del raw["operatorFee"]
    rpc = Rpc(eth_getTransactionReceipt=raw)
    result = await BaseChain(httpx.MockTransport(rpc)).verify_transfer(tx_hash=HASH, transaction=transaction(), chain_id=84532)
    assert result["fee_wei"] == "6000200"
    oracle = [params for method, params in rpc.requests if method == "eth_call"]
    assert oracle[0][1] == "0xa" and oracle[0][0]["data"].startswith("0x275aedd2")


@pytest.mark.asyncio
@pytest.mark.parametrize("overrides", [
    {"eth_getTransactionReceipt": None}, {"eth_blockNumber": "0xa"},
    {"eth_getBlockByNumber": {"hash": "0x" + "c" * 64}},
])
async def test_pending_or_reorg_never_confirms(overrides):
    assert await BaseChain(httpx.MockTransport(Rpc(**overrides))).verify_transfer(tx_hash=HASH, transaction=transaction(), chain_id=84532) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("overrides", [
    {"eth_getTransactionByHash": onchain(value="0x1")},
    {"eth_getTransactionByHash": onchain(input="0xdeadbeef")},
    {"eth_getTransactionByHash": onchain(chainId="0x1")},
    {"eth_getTransactionByHash": onchain(**{"from": RECIPIENT})},
    {"eth_getTransactionReceipt": receipt(transactionHash="0x" + "d" * 64)},
    {"eth_getTransactionReceipt": receipt(logs=[])},
    {"eth_getTransactionReceipt": receipt(l1Fee=None)},
    {"eth_getTransactionReceipt": receipt(effectiveGasPrice=hex(202))},
    {"eth_getTransactionReceipt": receipt(gasUsed=hex(73_000))},
])
async def test_mismatched_chain_or_transfer_cannot_release_hold(overrides):
    with pytest.raises(WalletChainError):
        await BaseChain(httpx.MockTransport(Rpc(**overrides))).verify_transfer(tx_hash=HASH, transaction=transaction(), chain_id=84532)


@pytest.mark.asyncio
async def test_changing_receipt_cannot_confirm():
    count = 0

    def changing(_):
        nonlocal count
        count += 1
        return receipt(blockHash=BLOCK_HASH if count == 1 else "0x" + "c" * 64)

    assert await BaseChain(httpx.MockTransport(Rpc(eth_getTransactionReceipt=changing))).verify_transfer(tx_hash=HASH, transaction=transaction(), chain_id=84532) is None


@pytest.mark.asyncio
async def test_rpc_error_body_never_leaks_and_redirect_is_not_followed():
    requests = []

    def redirect(request):
        requests.append(request)
        return httpx.Response(302, headers={"location": "https://evil.test"}, text="private secret")

    with pytest.raises(WalletChainError) as error:
        await BaseChain(httpx.MockTransport(redirect)).balances(OWNER, 84532)
    assert "private secret" not in str(error.value) and len(requests) == 1
