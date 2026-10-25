# OWNER: tanush — seed version; replace/extend freely but keep the public signatures.

"""Events: insert into `events` inside a transaction; publish to SSE subscribers after commit.
Spec: architecture-files/01-architecture/05-event-bus-and-orchestration.md."""
from __future__ import annotations

import asyncio
import json
from typing import Any

from .ids import utc_now


class Broker:
    def __init__(self) -> None:
        self._subs: dict[str | None, set[asyncio.Queue[dict[str, Any]]]] = {}

    def subscribe(self, venture_id: str | None) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=1000)
        self._subs.setdefault(venture_id, set()).add(q)
        return q

    def unsubscribe(self, venture_id: str | None, q: asyncio.Queue[dict[str, Any]]) -> None:
        self._subs.get(venture_id, set()).discard(q)

    def publish(self, event: dict[str, Any]) -> None:
        for key in {event.get("venture_id"), None}:
            for q in list(self._subs.get(key, ())):
                if q.full():
                    q.get_nowait()  # drop oldest
                q.put_nowait(event)


BROKER = Broker()


async def emit(tx: Any, *, venture_id: str | None, type: str, entity_kind: str | None = None,
               entity_id: str | None = None, data: dict[str, Any] | None = None, level: str = "info") -> int:
    created = utc_now()
    payload = data or {}
    event_id = await tx.execute(
        "INSERT INTO events (venture_id, type, entity_kind, entity_id, level, data_json, created_at) VALUES (?,?,?,?,?,?,?)",
        (venture_id, type, entity_kind, entity_id, level, json.dumps(payload, default=str), created))
    tx.events.append({"id": event_id, "venture_id": venture_id, "type": type, "entity_kind": entity_kind,
                      "entity_id": entity_id, "level": level, "data": payload, "created_at": created})
    return int(event_id or 0)
