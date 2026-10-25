# OWNER: tanush
"""Provider configuration and genuine world generation status."""
from fastapi import APIRouter, Request
from pydantic import BaseModel

from ..api_models import Envelope

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


@router.get("/v1/system/status", response_model=Envelope[SystemStatus])
async def status(request: Request):
    cfg = request.app.state.settings
    latest = await request.app.state.db.fetch_one("SELECT id,final_score FROM worldgen_runs ORDER BY started_at DESC,id DESC LIMIT 1")
    gemini = bool(cfg.gemini_api_key and cfg.gemini_api_key.get_secret_value())
    return {"data": {"providers": {
        "gemini": {"configured": gemini},
        "antigravity": {"configured": gemini},
        "composio": {"configured": bool(cfg.composio_api_key and cfg.composio_api_key.get_secret_value())},
        "elevenlabs": {"configured": bool(cfg.elevenlabs_api_key and cfg.elevenlabs_api_key.get_secret_value())}},
        "executor": cfg.engineering_executor,
        "worldgen": {"last_run_id": latest["id"] if latest else None, "final_score": latest["final_score"] if latest else None}}}
