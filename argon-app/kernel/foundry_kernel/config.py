# OWNER: frozen contract (change only via docs/contract-requests/<you>.md, applied in the merge session)

"""Settings for every env var in architecture-files/02-models-and-integrations/09-env-and-keys.md."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

KERNEL_DIR = Path(__file__).resolve().parents[1]  # argon-app/kernel
APP_DIR = KERNEL_DIR.parent  # argon-app


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=APP_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    # kernel
    kernel_host: str = "127.0.0.1"
    kernel_port: int = 8787
    kernel_token: SecretStr | None = None
    auth_mode: Literal["local", "gateway"] = "local"
    bootstrap_owner_subject: str | None = None
    data_dir: Path = APP_DIR / "data"
    web_public_dir: Path = APP_DIR / "web" / "public"
    web_url: str = "http://localhost:5173"  # running web dev server (World Lab live round captures)
    llm_mode: Literal["live", "fake"] = "live"
    conversation_model: Literal["gemini-3.8-flash", "gemini-3.5-flash-lite"] | None = None
    # gemini
    gemini_api_key: SecretStr | None = None
    long_decode_poll_seconds: float = 5.0
    long_decode_max_minutes: int = 45
    # engineering
    engineering_executor: Literal["antigravity", "local"] = "antigravity"
    antigravity_agent: str = "antigravity-preview-09-2026"
    max_build_iterations: int = 6
    local_sandbox: Literal["subprocess", "docker"] = "subprocess"
    local_test_timeout_seconds: int = 180
    github_sandbox_token: SecretStr | None = None
    # scheduler
    scheduler_tick_seconds: float = 1.0
    scheduler_concurrency: int = 4
    ticket_timeout_seconds: int = 1800
    eng_ticket_timeout_seconds: int = 3600
    default_budget_usd: float = 25.0
    # composio / github
    composio_api_key: SecretStr | None = None
    composio_base_url: str = "https://backend.composio.dev/api/"
    github_poll_seconds: int = 60
    # voice
    elevenlabs_api_key: SecretStr | None = None
    elevenlabs_model_id: str = "eleven_flash_v2_5"
    elevenlabs_output_format: str = "mp3_44100_128"
    tts_max_chars: int = 600
    elevenlabs_agent_id: str | None = None  # base ElevenLabs agent for live voice calls (voice/agents_setup.py)
    voice_agent_mode: Literal["client_tools", "custom_llm"] = "client_tools"
    public_kernel_url: str | None = None  # only for voice_agent_mode=custom_llm
    stt_primary: Literal["gemini", "browser"] = "browser"
    # conversation & coordination
    checker_model_check: bool = True
    standup_minutes: int = 30
    escalate_minutes: int = 20
    # cloud computers (cua)
    cua_mode: Literal["sandbox", "spaces", "off"] = "sandbox"
    cua_image: str = "ubuntu"
    cua_max_steps: int = 30
    cua_idle_stop_minutes: int = 10
    # optional
    slack_mirror_channel: str = ""

    @property
    def db_path(self) -> Path:
        return self.data_dir / "kernel.db"


@lru_cache
def get_settings() -> Settings:
    return Settings()
