# OWNER: tanush
"""Provider configuration and genuine world generation status."""
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel

from ..api_models import Envelope
from ..db import json_loads_or

router = APIRouter(tags=["system"])


class ProviderStatus(BaseModel):
    configured: bool
    last_ok_at: str | None = None


class Providers(BaseModel):
    gemini: ProviderStatus
    antigravity: ProviderStatus
    composio: ProviderStatus
    elevenlabs: ProviderStatus


class WorldgenStatus(BaseModel):
    last_run_id: str | None = None
    final_score: float | None = None


class SystemStatus(BaseModel):
    providers: Providers
    executor: str
    worldgen: WorldgenStatus
    mode: Literal["live", "fake"]


@router.get("/v1/system/status", response_model=Envelope[SystemStatus])
async def status(request: Request):
    cfg = request.app.state.settings
    latest = await request.app.state.db.fetch_one("SELECT id,final_score FROM worldgen_runs ORDER BY started_at DESC,id DESC LIMIT 1")
    override = await request.app.state.db.fetch_one("SELECT value_json FROM kv WHERE key='executor.override'")
    executor = json_loads_or(override["value_json"], None) if override else None
    if executor not in {"local", "antigravity"}:
        executor = cfg.engineering_executor
    gemini = bool(cfg.gemini_api_key and cfg.gemini_api_key.get_secret_value())
    return {"data": {"mode": cfg.llm_mode, "providers": {
        "gemini": {"configured": gemini},
        "antigravity": {"configured": gemini},
        "composio": {"configured": bool(cfg.composio_api_key and cfg.composio_api_key.get_secret_value())},
        "elevenlabs": {"configured": bool(cfg.elevenlabs_api_key and cfg.elevenlabs_api_key.get_secret_value())}},
        "executor": executor,
        "worldgen": {"last_run_id": latest["id"] if latest else None, "final_score": latest["final_score"] if latest else None}}}
