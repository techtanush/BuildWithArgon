# OWNER: tanush
"""Optional, creation-only agent wallet settings; no signing credentials reach the UI."""
from __future__ import annotations

import base64
from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from .config import APP_DIR

_SECRET_LITERALS: set[str] = set()


class WalletSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=APP_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    privy_app_id: str | None = None
    privy_app_secret: SecretStr | None = None
    credential_bundle_password: SecretStr | None = None
    wallet_mode: Literal["off", "testnet"] = "testnet"
    wallet_max_count: int = Field(default=50, ge=1, le=100)

    @field_validator("privy_app_id")
    @classmethod
    def valid_app_id(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        if ":" in value or any(c.isspace() for c in value) or len(value) > 256:
            raise ValueError("Privy app ID must be a nonempty credential identifier")
        return value

    @model_validator(mode="after")
    def register_secrets(self) -> WalletSettings:
        if self.credential_bundle_password:
            unlock = self.credential_bundle_password.get_secret_value()
            if unlock:
                _SECRET_LITERALS.add(unlock)
        secret = self.privy_app_secret.get_secret_value() if self.privy_app_secret else ""
        if secret:
            _SECRET_LITERALS.add(secret)
            if self.privy_app_id:
                credential = f"{self.privy_app_id}:{secret}"
                _SECRET_LITERALS.update((credential, base64.b64encode(credential.encode()).decode()))
        return self

    @property
    def configured(self) -> bool:
        return bool(self.privy_app_id and self.privy_app_secret and self.privy_app_secret.get_secret_value().strip())

    @property
    def wallet_limit(self) -> int:
        return self.wallet_max_count


@lru_cache(maxsize=1)
def get_wallet_settings() -> WalletSettings:
    return WalletSettings()


def secret_literals() -> tuple[str, ...]:
    # Also protects storage before a provider singleton is constructed.
    get_wallet_settings()
    return tuple(sorted(_SECRET_LITERALS, key=len, reverse=True))
