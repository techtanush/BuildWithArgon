# OWNER: tanush
"""Persisted venture event history, including global world progress."""
from fastapi import APIRouter, Query, Request

from ..api_models import Envelope, Event, Page
from ..records import get_row, serialize_event

router = APIRouter(tags=["activity"])


@router.get("/v1/ventures/{vid}/activity", response_model=Envelope[Page[Event]])
async def activity(vid: str, request: Request, limit: int = Query(100, ge=1, le=200), after_id: int = Query(0, ge=0)):
    db = request.app.state.db
    await get_row(db, "ventures", vid)
    rows = await db.fetch_all("SELECT * FROM events WHERE (venture_id=? OR venture_id IS NULL) AND id>? ORDER BY id LIMIT ?", (vid, after_id, limit))
    return {"data": {"items": [serialize_event(row) for row in rows]}}
