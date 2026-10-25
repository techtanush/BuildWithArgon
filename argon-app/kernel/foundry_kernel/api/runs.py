# OWNER: tanush
"""Run inspection, filters and incremental logs."""
from fastapi import APIRouter, Query, Request

from ..api_models import Envelope, Page, Run, RunLog
from ..records import get_row, list_rows, serialize_run

router = APIRouter(tags=["runs"])


@router.get("/v1/ventures/{vid}/runs", response_model=Envelope[Page[Run]])
async def list_runs(vid: str, request: Request, agent_id: str | None = None, ticket_id: str | None = None, kind: str | None = None, limit: int = Query(50, ge=1, le=200), cursor: str | None = None):
    db = request.app.state.db
    await get_row(db, "ventures", vid)
    rows, cursor = await list_rows(db, "runs", venture_id=vid, limit=limit, cursor=cursor, filters={"agent_id": agent_id, "ticket_id": ticket_id, "kind": kind})
    return {"data": {"items": [serialize_run(row) for row in rows], "next_cursor": cursor}}


@router.get("/v1/runs/{rid}", response_model=Envelope[Run])
async def get_run(rid: str, request: Request):
    return {"data": serialize_run(await get_row(request.app.state.db, "runs", rid))}


@router.get("/v1/runs/{rid}/logs", response_model=Envelope[Page[RunLog]])
async def logs(rid: str, request: Request, after_id: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200)):
    db = request.app.state.db
    await get_row(db, "runs", rid)
    rows = await db.fetch_all("SELECT id,ts,level,message FROM run_logs WHERE run_id=? AND id>? ORDER BY id LIMIT ?", (rid, after_id, limit))
    return {"data": {"items": rows}}
