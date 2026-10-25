# OWNER: tanush
"""Privy REST provisioning only. EVM addresses are network-agnostic; use is testnet-only.

No signing, export, transaction, funding, RPC or arbitrary URL method is exposed.
External IDs uniquely identify wallets permanently; idempotency keys add a 24h guard.
"""
from __future__ import annotations

import hashlib
import re
from typing import Literal, TypedDict

import httpx

from .errors import DependencyError, KernelError
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
    def __init__(self, settings: WalletSettings, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.settings = settings
        self._transport = transport

    async def ensure_wallet(self, external_id: str, display_name: str) -> WalletRecord:
        if self.settings.wallet_mode != "testnet":
            raise KernelError(503, "wallet_disabled", "Agent wallet provisioning is disabled.")
        if not self.settings.configured:
            raise WalletProviderError("Configure the Privy app ID and app secret to provision testnet wallets.", unavailable=True)
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
