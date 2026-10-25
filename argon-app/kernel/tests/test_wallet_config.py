# OWNER: tanush
import base64

import pytest
from pydantic import ValidationError

from foundry_kernel.config import Settings
from foundry_kernel.db import redact_value
from foundry_kernel.wallet_config import WalletSettings


def test_defaults_are_bounded_testnet_without_keys():
    config = WalletSettings(_env_file=None)
    assert config.wallet_mode == "testnet"
    assert config.wallet_max_count == config.wallet_limit == 50
    assert not config.configured


@pytest.mark.parametrize("value", [0, -1, 101, 499])
def test_wallet_count_hard_limit(value):
    with pytest.raises(ValidationError):
        WalletSettings(_env_file=None, wallet_max_count=value)


def test_mainnet_requires_explicit_mode_and_other_chains_are_not_available():
    defaults = WalletSettings(_env_file=None)
    assert defaults.chain_id == 84532 and defaults.network == "base-sepolia" and defaults.payments_enabled
    mainnet = WalletSettings(_env_file=None, wallet_mode="mainnet")
    assert mainnet.chain_id == 8453 and mainnet.network == "base" and mainnet.payments_enabled
    assert not WalletSettings(_env_file=None, wallet_mode="off").payments_enabled
    assert not WalletSettings(_env_file=None, wallet_payments_enabled=False).payments_enabled
    with pytest.raises(ValidationError):
        WalletSettings(_env_file=None, wallet_mode="ethereum")


def test_secret_is_masked_and_nested_storage_redacts_raw_basic_and_encoded():
    cfg = WalletSettings(_env_file=None, privy_app_id="unique-app", privy_app_secret="unique-short-secret", credential_bundle_password="test-bundle-unlock")
    assert cfg.configured
    assert "unique-short-secret" not in repr(cfg)
    assert "test-bundle-unlock" not in repr(cfg)
    basic = "unique-app:unique-short-secret"
    encoded = base64.b64encode(basic.encode()).decode()
    result = redact_value({"nested": [basic, encoded, "unique-short-secret"]}, Settings(_env_file=None))
    assert result == {"nested": ["[REDACTED]", "[REDACTED]", "[REDACTED]"]}
    assert redact_value("test-bundle-unlock", Settings(_env_file=None)) == "[REDACTED]"


def test_env_file_is_loaded_separately_without_modifying_frozen_config(tmp_path):
    env = tmp_path / "wallet.env"
    env.write_text("PRIVY_APP_ID=environment-app\nPRIVY_APP_SECRET=environment-secret\nWALLET_MODE=off\nWALLET_MAX_COUNT=29\nLLM_MODE=fake\n")
    cfg = WalletSettings(_env_file=env)
    assert cfg.configured and cfg.wallet_mode == "off" and cfg.wallet_max_count == 29
    assert cfg.privy_app_secret.get_secret_value() == "environment-secret"
