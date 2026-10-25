# OWNER: tanush — seed version; replace/extend freely but keep the public signatures.

"""Durable replay followed by committed live events, including world-wide events."""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import StreamingResponse

from ..bus import BROKER
from ..db import json_loads_or
from ..errors import KernelError
from ..records import get_row

router = APIRouter(tags=["stream"])


def encode(event: dict[str, Any]) -> str:
    data = {key: event.get(key) for key in ("id", "type", "entity_kind", "entity_id", "level", "created_at")}
    data["data"] = event.get("data", json_loads_or(event.get("data_json"), {}))
    return f"id: {event['id']}\nevent: {event['type']}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def events(db: Any, venture_id: str, last_id: int | None = None, *,
                 heartbeat_seconds: float = 15) -> AsyncIterator[str]:
    # Subscribe first: a commit concurrent with the replay query cannot fall into a gap.
    queue = BROKER.subscribe(venture_id)
    try:
        watermark = await db.fetch_one("SELECT COALESCE(MAX(id),0) AS n FROM events")
        high = watermark["n"]
        cursor = high if last_id is None else last_id
        if last_id is not None:
            while cursor < high:
                rows = await db.fetch_all(
                    "SELECT * FROM events WHERE id>? AND id<=? AND (venture_id=? OR venture_id IS NULL) ORDER BY id LIMIT 500",
                    (cursor, high, venture_id))
                if not rows:
                    break
                for row in rows:
                    cursor = row["id"]
                    yield encode(row)
            cursor = max(cursor, high)
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), heartbeat_seconds)
            except TimeoutError:
                # Recover durable events after a queue overflow as well as keeping the connection alive.
                rows = await db.fetch_all(
                    "SELECT * FROM events WHERE id>? AND (venture_id=? OR venture_id IS NULL) ORDER BY id LIMIT 500",
                    (cursor, venture_id))
                if rows:
                    for row in rows:
                        cursor = row["id"]
                        yield encode(row)
                else:
                    yield ": ping\n\n"
                continue
            if event["id"] <= cursor:
                continue
            # Filling from the DB also recovers records dropped by the bounded subscriber queue.
            while cursor < event["id"]:
                rows = await db.fetch_all(
                    "SELECT * FROM events WHERE id>? AND id<=? AND (venture_id=? OR venture_id IS NULL) ORDER BY id LIMIT 500",
                    (cursor, event["id"], venture_id))
                if not rows:
                    break
                for row in rows:
                    cursor = row["id"]
                    yield encode(row)
    finally:
        BROKER.unsubscribe(venture_id, queue)


@router.get("/v1/ventures/{vid}/stream", response_class=StreamingResponse,
            responses={200: {"content": {"text/event-stream": {"schema": {"type": "string"}}}}})
async def stream(request: Request, vid: str, last_event_id: str | None = Header(None),
                 resume_id: int | None = Query(None, alias="last_event_id", ge=0)):
    db = request.app.state.db
    await get_row(db, "ventures", vid)
    try:
        last_id = int(last_event_id) if last_event_id is not None else resume_id
        if last_id is not None and last_id < 0:
            raise ValueError
    except ValueError:
        raise KernelError(400, "validation", "Last-Event-ID must be a non-negative integer") from None
    return StreamingResponse(events(db, vid, last_id), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
