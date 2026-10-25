# OWNER: tanush
"""Durable replay and global events must work without leaking other ventures."""
import asyncio
import json

import pytest

from foundry_kernel import bus
from foundry_kernel.api.stream import events


def payload(frame):
    return json.loads(next(line[6:] for line in frame.splitlines() if line.startswith("data: ")))


async def test_stream_replays_only_own_and_global_events(db):
    async with db.tx() as tx:
        await bus.emit(tx, venture_id="own", type="ticket.updated", data={"x": 1})
        await bus.emit(tx, venture_id="other", type="ticket.updated", data={"x": 2})
        await bus.emit(tx, venture_id=None, type="worldgen.progress", data={"x": 3})
    stream = events(db, "own", 0, heartbeat_seconds=0.01)
    try:
        first = payload(await anext(stream))
        second = payload(await anext(stream))
        assert [first["data"]["x"], second["data"]["x"]] == [1, 3]
        assert "venture_id" not in first
        assert await anext(stream) == ": ping\n\n"
    finally:
        await stream.aclose()


async def test_stream_live_global_latency_and_cleanup(db):
    stream = events(db, "one", heartbeat_seconds=0.01)
    try:
        assert await anext(stream) == ": ping\n\n"  # Subscription is now established.
        started = asyncio.get_running_loop().time()
        async with db.tx() as tx:
            await bus.emit(tx, venture_id=None, type="worldgen.progress", data={"step": "critique"})
        event = payload(await asyncio.wait_for(anext(stream), 0.3))
        assert event["type"] == "worldgen.progress"
        assert asyncio.get_running_loop().time() - started < 0.3
    finally:
        await stream.aclose()
    assert not bus.BROKER._subs.get("one")


async def test_stream_replay_resume_has_no_duplicates(db):
    async with db.tx() as tx:
        old = await bus.emit(tx, venture_id="one", type="old")
        latest = await bus.emit(tx, venture_id="one", type="new")
    stream = events(db, "one", old, heartbeat_seconds=0.01)
    try:
        assert payload(await anext(stream))["id"] == latest
        async with db.tx() as tx:
            next_id = await bus.emit(tx, venture_id="one", type="later")
        assert payload(await anext(stream))["id"] == next_id
        assert await anext(stream) == ": ping\n\n"
    finally:
        await stream.aclose()


async def test_stream_replay_pages_without_gaps(db):
    async with db.tx() as tx:
        for i in range(502):
            await bus.emit(tx, venture_id="one", type="test", data={"i": i})
    stream = events(db, "one", 0, heartbeat_seconds=0.01)
    try:
        seen = [payload(await anext(stream))["data"]["i"] for _ in range(502)]
        assert seen == list(range(502))
    finally:
        await stream.aclose()


async def test_stream_never_sends_rolled_back_events(db):
    stream = events(db, "one", heartbeat_seconds=0.01)
    try:
        await anext(stream)
        with pytest.raises(RuntimeError):
            async with db.tx() as tx:
                await bus.emit(tx, venture_id="one", type="aborted")
                raise RuntimeError("rollback")
        assert await anext(stream) == ": ping\n\n"
    finally:
        await stream.aclose()
