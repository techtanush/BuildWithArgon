# OWNER: tanush
"""Restricted Base reads and exact USDC transfer encoding; no generic RPC surface."""
from __future__ import annotations

import re
from typing import Any

import httpx

from .errors import DependencyError, KernelError

CHAINS = {
    84532: {"rpc": "https://sepolia.base.org", "usdc": "0x036CbD53842c5426634e7929541eC2318f3dCF7e"},
    8453: {"rpc": "https://mainnet.base.org", "usdc": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"},
}
_ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}\Z")
_HASH = re.compile(r"0x[0-9a-fA-F]{64}\Z")
_QUANTITY = re.compile(r"0x[0-9a-fA-F]{1,64}\Z")
_TRANSFER = re.compile(r"0xa9059cbb[0-9a-fA-F]{128}\Z")
_ORACLE = "0x420000000000000000000000000000000000000F"
_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
_TRANSACTION_KEYS = {"from", "to", "value", "data", "chain_id", "gas_limit", "max_fee_per_gas", "max_priority_fee_per_gas", "nonce"}


class WalletChainError(DependencyError):
    def __init__(self, message: str = "Base network could not verify the payment safely.") -> None:
        super().__init__("base", message)


def chain(chain_id: int) -> dict[str, str]:
    if type(chain_id) is not int or chain_id not in CHAINS:
        raise KernelError(400, "unsupported_wallet_chain", "Only Base and Base Sepolia USDC payments are supported.")
    return CHAINS[chain_id]


def address(value: Any) -> str:
    if not isinstance(value, str) or not _ADDRESS.fullmatch(value) or int(value, 16) == 0:
        raise KernelError(400, "invalid_wallet_address", "A nonzero EVM address is required.")
    return value.lower()


def quantity(value: Any) -> int:
    if type(value) is int and 0 <= value < 2**256:
        return value
    if isinstance(value, str) and _QUANTITY.fullmatch(value):
        return int(value, 16)
    raise WalletChainError("Base network returned an invalid numeric field.")


def transaction_fields(transaction: dict, chain_id: int) -> tuple[str, str, int]:
    config = chain(chain_id)
    if not isinstance(transaction, dict) or set(transaction) != _TRANSACTION_KEYS:
        raise KernelError(400, "invalid_wallet_transaction", "Only a prepared USDC transfer is supported.")
    sender = address(transaction["from"])
    if address(transaction["to"]) != config["usdc"].lower() or quantity(transaction["chain_id"]) != chain_id or quantity(transaction["value"]) != 0:
        raise KernelError(400, "invalid_wallet_transaction", "Transaction must transfer only the configured USDC token.")
    data = transaction["data"]
    if not isinstance(data, str) or not _TRANSFER.fullmatch(data) or data[10:34] != "0" * 24:
        raise KernelError(400, "invalid_wallet_transaction", "Only exact ERC20 transfer calldata is supported.")
    recipient = address("0x" + data[34:74])
    amount = int(data[74:], 16)
    if recipient in (sender, config["usdc"].lower()) or amount <= 0:
        raise KernelError(400, "invalid_wallet_transaction", "USDC recipient and amount are invalid.")
    gas = quantity(transaction["gas_limit"])
    maximum = quantity(transaction["max_fee_per_gas"])
    tip = quantity(transaction["max_priority_fee_per_gas"])
    if not 21_000 <= gas <= 500_000 or not 0 < maximum <= 10**12 or tip > maximum or quantity(transaction["nonce"]) >= 2**64:
        raise KernelError(400, "invalid_wallet_transaction", "Transaction gas, fees or nonce exceed the supported bounds.")
    return sender, recipient, amount


class BaseChain:
    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._transport = transport

    async def _rpc(self, client: httpx.AsyncClient, method: str, params: list) -> Any:
        # Internal callers below have fixed methods and argument structures.
        try:
            response = await client.post("/", json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict) or data.get("jsonrpc") != "2.0" or data.get("id") != 1 or "error" in data or "result" not in data:
                raise ValueError("Invalid RPC response")
            return data["result"]
        except (httpx.HTTPError, ValueError, TypeError):
            raise WalletChainError() from None

    def _client(self, chain_id: int) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=chain(chain_id)["rpc"], transport=self._transport,
            timeout=20.0, follow_redirects=False, trust_env=False)

    async def _check_chain(self, client: httpx.AsyncClient, chain_id: int) -> None:
        if quantity(await self._rpc(client, "eth_chainId", [])) != chain_id:
            raise WalletChainError("Base RPC returned the wrong chain ID.")

    async def _balances(self, client: httpx.AsyncClient, owner: str, chain_id: int) -> dict:
        native = quantity(await self._rpc(client, "eth_getBalance", [owner, "pending"]))
        token = quantity(await self._rpc(client, "eth_call", [{"to": chain(chain_id)["usdc"], "data": "0x70a08231" + owner[2:].zfill(64)}, "pending"]))
        return {"native_balance_wei": str(native), "usdc_balance_units": str(token), "chain_id": chain_id, "usdc_contract": chain(chain_id)["usdc"]}

    async def balances(self, owner: str, chain_id: int) -> dict:
        owner = address(owner)
        async with self._client(chain_id) as client:
            await self._check_chain(client, chain_id)
            return await self._balances(client, owner, chain_id)

    async def _extra_fee_reserve(self, client: httpx.AsyncClient, gas_limit: int) -> int:
        # Fixed simple transfer unsigned payload <1024B. Fjord oracle upper bound
        # includes signature overhead. Double L1/operator estimates for headroom.
        l1 = quantity(await self._rpc(client, "eth_call", [{"to": _ORACLE, "data": "0xf1c7a58b" + format(1024, "064x")}, "pending"]))
        operator = quantity(await self._rpc(client, "eth_call", [{"to": _ORACLE, "data": "0x275aedd2" + format(gas_limit, "064x")}, "pending"]))
        return 2 * (l1 + operator)

    async def prepare_transfer(self, *, wallet_address: str, recipient: str, amount_units: int, chain_id: int, max_gas_fee_wei: int) -> dict:
        owner, recipient = address(wallet_address), address(recipient)
        token = chain(chain_id)["usdc"]
        if recipient in (owner, token.lower()) or type(amount_units) is not int or not 0 < amount_units < 2**256 or type(max_gas_fee_wei) is not int or max_gas_fee_wei <= 0:
            raise KernelError(400, "invalid_wallet_transfer", "A distinct recipient, positive USDC amount and gas budget are required.")
        data = "0xa9059cbb" + recipient[2:].zfill(64) + format(amount_units, "064x")
        async with self._client(chain_id) as client:
            await self._check_chain(client, chain_id)
            balances = await self._balances(client, owner, chain_id)
            if int(balances["usdc_balance_units"]) < amount_units:
                raise KernelError(409, "insufficient_usdc", "The agent wallet has insufficient USDC.")
            draft = {"from": owner, "to": token, "value": "0x0", "data": data}
            estimate = quantity(await self._rpc(client, "eth_estimateGas", [draft, "pending"]))
            gas = (estimate * 120 + 99) // 100
            block = await self._rpc(client, "eth_getBlockByNumber", ["pending", False])
            if not isinstance(block, dict):
                raise WalletChainError()
            tip = quantity(await self._rpc(client, "eth_maxPriorityFeePerGas", []))
            fee = 2 * quantity(block.get("baseFeePerGas")) + tip
            nonce = quantity(await self._rpc(client, "eth_getTransactionCount", [owner, "pending"]))
            transaction = {**draft, "chain_id": chain_id, "gas_limit": hex(gas), "max_fee_per_gas": hex(fee), "max_priority_fee_per_gas": hex(tip), "nonce": nonce}
            transaction_fields(transaction, chain_id)
            total = gas * fee + await self._extra_fee_reserve(client, gas)
            if total > max_gas_fee_wei:
                raise KernelError(409, "wallet_gas_budget", "Estimated Base execution and data fees exceed the gas budget.")
            if int(balances["native_balance_wei"]) < total:
                raise KernelError(409, "insufficient_wallet_gas", "The agent wallet needs native ETH for Base execution and data fees.")
            return transaction

    async def _validate_for_dispatch(self, transaction: dict, chain_id: int) -> None:
        owner, _, amount = transaction_fields(transaction, chain_id)
        async with self._client(chain_id) as client:
            await self._check_chain(client, chain_id)
            balances = await self._balances(client, owner, chain_id)
            if int(balances["usdc_balance_units"]) < amount:
                raise KernelError(409, "insufficient_usdc", "The agent wallet has insufficient USDC.")
            nonce = quantity(await self._rpc(client, "eth_getTransactionCount", [owner, "pending"]))
            if nonce != quantity(transaction["nonce"]):
                raise KernelError(409, "wallet_nonce_changed", "Wallet pending nonce changed. Prepare a new payment safely.")
            total = quantity(transaction["gas_limit"]) * quantity(transaction["max_fee_per_gas"]) + await self._extra_fee_reserve(client, quantity(transaction["gas_limit"]))
            if int(balances["native_balance_wei"]) < total:
                raise KernelError(409, "insufficient_wallet_gas", "The agent wallet needs native ETH for Base execution and data fees.")

    async def verify_transfer(self, *, tx_hash: str, transaction: dict, chain_id: int) -> dict | None:
        owner, recipient, amount = transaction_fields(transaction, chain_id)
        transaction = dict(transaction)
        if not isinstance(tx_hash, str) or not _HASH.fullmatch(tx_hash):
            raise KernelError(400, "invalid_transaction_hash", "A full EVM transaction hash is required.")
        async with self._client(chain_id) as client:
            await self._check_chain(client, chain_id)
            receipt = await self._rpc(client, "eth_getTransactionReceipt", [tx_hash])
            if receipt is None:
                return None
            actual = await self._rpc(client, "eth_getTransactionByHash", [tx_hash])
            if not isinstance(receipt, dict) or not isinstance(actual, dict):
                raise WalletChainError()
            for key, expected in (("hash", tx_hash), ("from", owner), ("to", transaction["to"]), ("input", transaction["data"])):
                if not isinstance(actual.get(key), str) or actual[key].lower() != expected.lower():
                    raise WalletChainError("Onchain transaction does not match the reserved USDC transfer.")
            for key, expected in (("chainId", chain_id), ("value", 0), ("nonce", transaction["nonce"]), ("gas", transaction["gas_limit"]), ("maxFeePerGas", transaction["max_fee_per_gas"]), ("maxPriorityFeePerGas", transaction["max_priority_fee_per_gas"])):
                if quantity(actual.get(key)) != quantity(expected):
                    raise WalletChainError("Onchain transaction fields do not match the reserved transfer.")
            block_number = quantity(receipt.get("blockNumber"))
            block_hash = receipt.get("blockHash")
            if not isinstance(block_hash, str) or not _HASH.fullmatch(block_hash) or str(receipt.get("transactionHash", "")).lower() != tx_hash.lower() or str(actual.get("blockHash", "")).lower() != block_hash.lower() or quantity(actual.get("blockNumber")) != block_number:
                raise WalletChainError("Receipt identity does not match the reserved transfer.")
            head = quantity(await self._rpc(client, "eth_blockNumber", []))
            confirmations = head - block_number + 1
            if confirmations < 2:
                return None
            canonical = await self._rpc(client, "eth_getBlockByNumber", [hex(block_number), False])
            again = await self._rpc(client, "eth_getTransactionReceipt", [tx_hash])
            if not isinstance(canonical, dict) or str(canonical.get("hash", "")).lower() != block_hash.lower() or again != receipt:
                return None
            status = quantity(receipt.get("status"))
            if status not in (0, 1):
                raise WalletChainError("Receipt has an invalid status.")
            if status == 1:
                topics = [_TRANSFER_TOPIC, "0x" + owner[2:].zfill(64), "0x" + recipient[2:].zfill(64)]
                logs = receipt.get("logs")
                if not isinstance(logs, list) or not any(isinstance(log, dict) and str(log.get("address", "")).lower() == transaction["to"].lower() and log.get("removed") is not True and isinstance(log.get("topics"), list) and [str(t).lower() for t in log["topics"]] == topics and str(log.get("data", "")).lower() == "0x" + format(amount, "064x") for log in logs):
                    raise WalletChainError("Successful receipt lacks the expected USDC Transfer event.")
            gas_used, gas_price = quantity(receipt.get("gasUsed")), quantity(receipt.get("effectiveGasPrice"))
            if gas_used > quantity(transaction["gas_limit"]) or gas_price > quantity(transaction["max_fee_per_gas"]):
                raise WalletChainError("Receipt gas usage exceeds the reserved transaction limits.")
            # Base includes L1 data fees; never silently report zero if omitted.
            fee = gas_used * gas_price + quantity(receipt.get("l1Fee"))
            # OP operator fee may be provided directly. Otherwise ask the oracle
            # at that historical block: Isthmus/Jovian use different formulas.
            if "operatorFee" in receipt:
                fee += quantity(receipt["operatorFee"])
            else:
                # Historical block state avoids substituting today's oracle rate.
                fee += quantity(await self._rpc(client, "eth_call", [{"to": _ORACLE, "data": "0x275aedd2" + format(gas_used, "064x")}, hex(block_number)]))
            return {"status": "confirmed" if status else "reverted", "tx_hash": tx_hash, "block_number": block_number, "fee_wei": str(fee), "confirmations": confirmations}
