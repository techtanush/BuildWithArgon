# OWNER: tanush — seed version; replace/extend freely but keep the public signatures.

"""Events: insert into `events` inside a transaction; publish to SSE subscribers after commit.
Spec: architecture-files/01-architecture/05-event-bus-and-orchestration.md."""
from __future__ import annotations

import asyncio
from typing import Any

from .db import json_dumps
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
        if not self._subs.get(venture_id):
            self._subs.pop(venture_id, None)

    def publish(self, event: dict[str, Any]) -> None:
        keys = self._subs if event.get("venture_id") is None else {event["venture_id"], None}
        queues = {q for key in keys for q in self._subs.get(key, ())}
        for q in queues:
            if q.full():
                q.get_nowait()  # drop oldest
            q.put_nowait(event)


BROKER = Broker()


async def emit(tx: Any, *, venture_id: str | None, type: str, entity_kind: str | None = None,
               entity_id: str | None = None, data: dict[str, Any] | None = None, level: str = "info") -> int:
    created = utc_now()
    event_id = await tx.execute(
        "INSERT INTO events (venture_id, type, entity_kind, entity_id, level, data_json, created_at) VALUES (?,?,?,?,?,?,?)",
        (venture_id, type, entity_kind, entity_id, level, json_dumps(data or {}, getattr(tx, "settings", None)), created))
    # Publish the persisted representation so redaction is identical for replay and live SSE.
    row = await tx.fetch_one("SELECT * FROM events WHERE id=?", (event_id,))
    if row is not None:
        from .db import json_loads_or

        row["data"] = json_loads_or(row.pop("data_json"), {})
        tx.events.append(row)
    return int(event_id or 0)
