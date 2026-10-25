# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.
"""World Lab API — architecture-files/05-world/13-world-lab-and-live-round.md §3.
Run history (`/v1/world/worldgen/latest|runs|files`) and the live one-building round
(`/v1/world/worldgen/live-rounds`). Response models: contracts.WorldgenRunSummary, WorldgenRun, LiveRound.
Envelope {"data": ...}; errors via errors.KernelError (404 / 409 / 503)."""
from __future__ import annotations

import mimetypes
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..contracts import LiveRound, WorldgenRun, WorldgenRunSummary
from ..errors import NotFoundError
from ..worldgen import live, paths
from ..worldgen.runs import full_run, run_dirs, summary

router = APIRouter(tags=["worldgen"])
SERVABLE = {".png": "image/png", ".webm": "video/webm", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
            ".json": "application/json", ".ts": "text/plain", ".txt": "text/plain", ".md": "text/plain"}


class RunEnvelope(BaseModel):
    data: WorldgenRun


class SummaryEnvelope(BaseModel):
    data: WorldgenRunSummary | None


class SummaryList(BaseModel):
    items: list[WorldgenRunSummary]


class SummaryListEnvelope(BaseModel):
    data: SummaryList


class LiveRoundEnvelope(BaseModel):
    data: LiveRound


class LiveRoundList(BaseModel):
    items: list[LiveRound]


class LiveRoundListEnvelope(BaseModel):
    data: LiveRoundList


class LiveRoundCreate(BaseModel):
    department_id: str
    fast: bool = True


def _scored_runs() -> list[Any]:
    return [d for d in run_dirs() if (d / "run.json").exists()]


@router.get("/v1/world/worldgen/latest", response_model=SummaryEnvelope)
async def latest() -> dict[str, Any]:
    """The latest run that has scores (else the latest run at all; null when there is none)."""
    dirs = _scored_runs()
    scored = [d for d in dirs if (d / "scores.json").exists()]
    pick = (scored or dirs or [None])[0]
    return {"data": summary(pick) if pick else None}


@router.get("/v1/world/worldgen/runs", response_model=SummaryListEnvelope)
async def runs() -> dict[str, Any]:
    return {"data": {"items": [summary(d) for d in _scored_runs()]}}


@router.get("/v1/world/worldgen/runs/{run_id}", response_model=RunEnvelope)
async def run(run_id: str) -> dict[str, Any]:
    d = paths.RUNS_DIR / run_id
    if not run_id.startswith("wgr_") or "/" in run_id or ".." in run_id or not (d / "run.json").exists():
        raise NotFoundError("worldgen run", run_id)
    return {"data": full_run(d)}


@router.get("/v1/world/worldgen/files/{path:path}")
async def files(path: str) -> FileResponse:
    """A capture PNG / video WEBM (or a run record) from kernel/data/worldgen/; no `..`, nothing outside it."""
    if not path or ".." in path.split("/") or path.startswith("/") or "\\" in path or "\x00" in path:
        raise NotFoundError("file", path)
    root = paths.WORLDGEN_DATA.resolve()
    target = (root / path).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        raise NotFoundError("file", path)
    media = SERVABLE.get(target.suffix.lower())
    if media is None:
        raise NotFoundError("file", path)
    return FileResponse(target, media_type=media or mimetypes.guess_type(target.name)[0])


@router.post("/v1/world/worldgen/live-rounds", response_model=LiveRoundEnvelope)
async def create_live_round(body: LiveRoundCreate, request: Request) -> dict[str, Any]:
    st = request.app.state
    lr = await live.start_round(settings=st.settings, db=st.db, llm=st.llm, department_id=body.department_id, fast=body.fast)
    return {"data": lr}


@router.get("/v1/world/worldgen/live-rounds", response_model=LiveRoundListEnvelope)
async def list_live_rounds() -> dict[str, Any]:
    return {"data": {"items": live.list_rounds()}}


@router.get("/v1/world/worldgen/live-rounds/{round_id}", response_model=LiveRoundEnvelope)
async def get_live_round(round_id: str) -> dict[str, Any]:
    return {"data": live.load_round(round_id)}


@router.post("/v1/world/worldgen/live-rounds/{round_id}/promote", response_model=LiveRoundEnvelope)
async def promote_live_round(round_id: str, request: Request) -> dict[str, Any]:
    return {"data": await live.promote(db=request.app.state.db, round_id=round_id)}
