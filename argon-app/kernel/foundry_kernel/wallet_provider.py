# OWNER: tanush
"""Privy wallet provisioning and tightly restricted Base USDC transfers.

No generic signing, export, funding, RPC or arbitrary URL API is exposed.
External IDs uniquely identify wallets permanently; idempotency keys add a 24h guard.
"""
from __future__ import annotations

import asyncio
import hashlib
import re
from typing import Literal, TypedDict

import httpx

from .errors import DependencyError, KernelError
from .wallet_chain import BaseChain, transaction_fields
from .wallet_config import WalletSettings

_ORIGIN = "https://api.privy.io"
_EXTERNAL_ID = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")
_WALLET_ID = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")
_ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}\Z")


class WalletRecord(TypedDict):
    id: str
    address: str
    chain_type: Literal["ethereum"]
    external_id: str


class WalletProviderError(DependencyError):
    def __init__(self, message: str = "Wallet provider is unavailable; try again safely.", *, unavailable: bool = False) -> None:
        super().__init__("privy", message, unavailable=unavailable)


class WalletDispatchAmbiguous(WalletProviderError):
    """A dispatch may have succeeded. Keep the durable hold; never blindly resend."""
    ambiguous = True

    def __init__(self) -> None:
        super().__init__("Payment dispatch could not be confirmed. Its funds remain reserved for reconciliation.")


def _validated(response: httpx.Response, external_id: str) -> WalletRecord:
    try:
        data = response.json()
        if (not isinstance(data, dict) or not isinstance(data.get("id"), str)
                or not _WALLET_ID.fullmatch(data["id"])
                or not isinstance(data.get("address"), str) or not _ADDRESS.fullmatch(data["address"])
                or data.get("chain_type") != "ethereum" or data.get("external_id") != external_id
                or data.get("archived_at") is not None):
            raise ValueError("invalid wallet")
        return {"id": data["id"], "address": data["address"], "chain_type": "ethereum", "external_id": external_id}
    except (ValueError, TypeError, KeyError):
        raise WalletProviderError("Wallet provider returned an invalid wallet record.") from None


class PrivyClient:
    def __init__(self, settings: WalletSettings, transport: httpx.AsyncBaseTransport | None = None,
                 chain_transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.settings = settings
        self._transport = transport
        self._chain = BaseChain(chain_transport)

    async def ensure_wallet(self, external_id: str, display_name: str) -> WalletRecord:
        if self.settings.wallet_mode == "off":
            raise KernelError(503, "wallet_disabled", "Agent wallet provisioning is disabled.")
        if not self.settings.configured:
            raise WalletProviderError("Configure the Privy app ID and app secret to provision agent wallets.", unavailable=True)
        if not isinstance(external_id, str) or not _EXTERNAL_ID.fullmatch(external_id):
            raise KernelError(400, "invalid_wallet_external_id", "Wallet external ID must contain 1–64 URL-safe characters.")
        if not isinstance(display_name, str) or not 1 <= len(display_name.strip()) <= 100 or any(ord(c) < 32 for c in display_name):
            raise KernelError(400, "invalid_wallet_display_name", "Wallet display name must contain 1–100 printable characters.")
        secret = self.settings.privy_app_secret.get_secret_value()
        async with httpx.AsyncClient(
            base_url=_ORIGIN, auth=httpx.BasicAuth(self.settings.privy_app_id, secret),
            headers={"privy-app-id": self.settings.privy_app_id}, timeout=httpx.Timeout(20.0),
            follow_redirects=False, trust_env=False, transport=self._transport,
        ) as client:
            path = f"/v1/wallets/ext_wal_{external_id}"
            try:
                existing = await client.get(path)
            except httpx.HTTPError:
                raise WalletProviderError() from None
            if existing.is_success:
                return _validated(existing, external_id)
            if existing.status_code != 404:
                raise WalletProviderError()
            # Never vary this key after an ambiguous result; recover by external-ID lookup.
            key = hashlib.sha256(f"foundry-wallet:{external_id}".encode()).hexdigest()
            try:
                created = await client.post("/v1/wallets", headers={"privy-idempotency-key": key}, json={
                    "chain_type": "ethereum", "external_id": external_id, "display_name": display_name.strip(),
                })
            except httpx.HTTPError:
                created = None
            if created is not None and created.is_success:
                return _validated(created, external_id)
            # A timeout, conflict or provider error may follow a successful creation.
            # One read reconciles it; a later user retry always starts with the same read.
            try:
                recovered = await client.get(path)
            except httpx.HTTPError:
                raise WalletProviderError("Wallet creation could not be confirmed; retry to look up the same wallet.") from None
            if recovered.is_success:
                return _validated(recovered, external_id)
            raise WalletProviderError("Wallet creation could not be confirmed; retry to look up the same wallet.")

    def _payment_chain(self, chain_id: int) -> None:
        if not self.settings.payments_enabled:
            raise KernelError(503, "wallet_payments_disabled", "Agent wallet payments are disabled.")
        if type(chain_id) is not int or chain_id != self.settings.chain_id:
            raise KernelError(400, "wallet_chain_mismatch", "Payment chain does not match the configured wallet mode.")

    async def balances(self, address: str, chain_id: int) -> dict:
        return await self._chain.balances(address, chain_id)

    async def prepare_transfer(self, *, wallet_address: str, recipient: str, amount_units: int, chain_id: int, max_gas_fee_wei: int) -> dict:
        self._payment_chain(chain_id)
        return await self._chain.prepare_transfer(wallet_address=wallet_address, recipient=recipient,
            amount_units=amount_units, chain_id=chain_id, max_gas_fee_wei=max_gas_fee_wei)

    async def send_transfer(self, wallet_id: str, transaction: dict, chain_id: int, idempotency_key: str) -> dict:
        self._payment_chain(chain_id)
        if not self.settings.configured:
            raise WalletProviderError("Configure Privy credentials before sending an agent payment.", unavailable=True)
        sender, _, _ = transaction_fields(transaction, chain_id)
        transaction = dict(transaction)  # Freeze scalar fields before network awaits.
        if not isinstance(wallet_id, str) or not _WALLET_ID.fullmatch(wallet_id) or not isinstance(idempotency_key, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", idempotency_key):
            raise KernelError(400, "invalid_wallet_dispatch", "A valid wallet ID and stable payment idempotency key are required.")
        # Recheck pending nonce and balances immediately before irreversible dispatch.
        await self._chain._validate_for_dispatch(transaction, chain_id)
        dispatched = False
        try:
            async with httpx.AsyncClient(base_url=_ORIGIN,
                auth=httpx.BasicAuth(self.settings.privy_app_id, self.settings.privy_app_secret.get_secret_value()),
                headers={"privy-app-id": self.settings.privy_app_id}, timeout=20.0,
                follow_redirects=False, trust_env=False, transport=self._transport) as client:
                try:
                    existing = await client.get(f"/v1/wallets/{wallet_id}")
                    existing.raise_for_status()
                    wallet = existing.json()
                    if not isinstance(wallet, dict) or wallet.get("id") != wallet_id or str(wallet.get("address", "")).lower() != sender or wallet.get("chain_type") != "ethereum" or wallet.get("archived_at") is not None:
                        raise ValueError("Wallet identity mismatch")
                except (httpx.HTTPError, ValueError, TypeError):
                    raise WalletProviderError("Provider wallet identity could not be verified before dispatch.") from None
                # Everything from this boundary onward may follow a broadcast, including
                # cancellation or malformed success responses. The service retains its hold.
                dispatched = True
                try:
                    response = await client.post(f"/v1/wallets/{wallet_id}/rpc",
                        headers={"privy-idempotency-key": idempotency_key}, json={
                            "method": "eth_sendTransaction", "chain_type": "ethereum", "caip2": f"eip155:{chain_id}",
                            "params": {"transaction": transaction},
                        })
                    response.raise_for_status()
                    result = response.json()
                    data = result.get("data") if isinstance(result, dict) else None
                    if not isinstance(data, dict) or result.get("method") != "eth_sendTransaction" or not isinstance(data.get("hash"), str) or not re.fullmatch(r"0x[0-9a-fA-F]{64}", data["hash"]) or data.get("caip2") != f"eip155:{chain_id}":
                        raise ValueError("Invalid dispatch response")
                    out = {"hash": data["hash"], "caip2": data["caip2"]}
                    if data.get("transaction_id") is not None:
                        if not isinstance(data["transaction_id"], str) or not _WALLET_ID.fullmatch(data["transaction_id"]):
                            raise ValueError("Invalid transaction ID")
                        out["transaction_id"] = data["transaction_id"]
                    return out
                except (Exception, asyncio.CancelledError):  # noqa: BLE001 — every failure after dispatch must retain the hold.
                    raise WalletDispatchAmbiguous() from None
        except (Exception, asyncio.CancelledError):
            if dispatched:
                raise WalletDispatchAmbiguous() from None
            raise

    async def verify_transfer(self, *, tx_hash: str, transaction: dict, chain_id: int) -> dict | None:
        # Verification is read-only, including after payments are disabled.
        return await self._chain.verify_transfer(tx_hash=tx_hash, transaction=transaction, chain_id=chain_id)
