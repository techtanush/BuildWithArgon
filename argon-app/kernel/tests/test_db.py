# OWNER: tanush
"""Atomic storage, live-event isolation, recovery and storage redaction."""
from __future__ import annotations

import asyncio
import json
import sqlite3

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel, SecretStr

from foundry_kernel.app import create_app, recover_interrupted
from foundry_kernel.bus import BROKER, Broker, emit
from foundry_kernel.db import Database, json_loads_or
from foundry_kernel.errors import KernelError
from foundry_kernel.ids import utc_now
from foundry_kernel.seed import load_roster, seed_roster


async def venture(tx, identifier="ven_test"):
    now = utc_now()
    await tx.execute("INSERT INTO ventures (id,name,slug,idea,founder_name,composio_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
                     (identifier, "Test", identifier, "Idea", "Tanush", f"foundry:{identifier}", now, now))


@pytest.mark.parametrize("value,expected", [(None, {}), ("not json", {}), ('{"x":1}', {"x": 1}), ("null", None), ("false", False)])
def test_json_loads_or(value, expected):
    assert json_loads_or(value, {}) == expected


async def test_rollback_drops_rows_and_events(db):
    q = BROKER.subscribe("ven_test")
    try:
        with pytest.raises(ValueError):
            async with db.tx() as tx:
                await venture(tx)
                await emit(tx, venture_id="ven_test", type="venture.created", data={"id": "ven_test"})
                raise ValueError("abort")
        assert await db.fetch_one("SELECT id FROM ventures WHERE id='ven_test'") is None
        assert q.empty()
        assert await db.fetch_all("SELECT * FROM events") == []
    finally:
        BROKER.unsubscribe("ven_test", q)


async def test_cancelled_transaction_rolls_back_and_connection_recovers(db):
    ready = asyncio.Event()

    async def writer():
        async with db.tx() as tx:
            await venture(tx)
            ready.set()
            await asyncio.Event().wait()

    task = asyncio.create_task(writer())
    await ready.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert await db.fetch_one("SELECT * FROM ventures WHERE id='ven_test'") is None
    async with db.tx() as tx:
        await venture(tx)
    assert await db.ping()


async def test_failed_commit_rolls_back_and_does_not_publish(db, monkeypatch):
    original = db.conn.commit

    async def failing_commit():
        raise sqlite3.OperationalError("disk full")

    q = BROKER.subscribe(None)
    try:
        monkeypatch.setattr(db.conn, "commit", failing_commit)
        with pytest.raises(sqlite3.OperationalError):
            async with db.tx() as tx:
                await venture(tx)
                await emit(tx, venture_id="ven_test", type="test")
        assert q.empty()
        assert await db.fetch_one("SELECT * FROM ventures") is None
        monkeypatch.setattr(db.conn, "commit", original)
        async with db.tx() as tx:
            await venture(tx)
    finally:
        BROKER.unsubscribe(None, q)


async def test_cancel_during_commit_finishes_commit_before_publication_and_unlock(db, monkeypatch):
    started, release = asyncio.Event(), asyncio.Event()
    original = db.conn.commit

    async def delayed_commit():
        started.set()
        await release.wait()
        await original()

    monkeypatch.setattr(db.conn, "commit", delayed_commit)
    q = BROKER.subscribe(None)

    async def writer():
        async with db.tx() as tx:
            await venture(tx)
            await emit(tx, venture_id="ven_test", type="committed")

    task = asyncio.create_task(writer())
    try:
        await started.wait()
        task.cancel()
        await asyncio.sleep(0)
        assert not task.done() and q.empty()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert (await db.fetch_one("SELECT id FROM ventures"))["id"] == "ven_test"
        assert q.get_nowait()["type"] == "committed"
        assert await db.ping()
    finally:
        release.set()
        BROKER.unsubscribe(None, q)


async def test_readers_cannot_observe_partial_transactions_and_publish_order(db):
    entered, release = asyncio.Event(), asyncio.Event()
    q = BROKER.subscribe(None)

    async def writer():
        async with db.tx() as tx:
            await venture(tx)
            await emit(tx, venture_id="ven_test", type="first")
            entered.set()
            await release.wait()

    first = asyncio.create_task(writer())
    try:
        await entered.wait()
        read = asyncio.create_task(db.fetch_one("SELECT id FROM ventures WHERE id='ven_test'"))
        await asyncio.sleep(0)
        assert not read.done() and q.empty()
        release.set()
        await first
        assert (await read)["id"] == "ven_test"
        async with db.tx() as tx:
            await emit(tx, venture_id="ven_test", type="second")
        events = [q.get_nowait(), q.get_nowait()]
        assert [e["type"] for e in events] == ["first", "second"]
        assert events[0]["id"] < events[1]["id"]
    finally:
        release.set()
        await first
        BROKER.unsubscribe(None, q)


def test_broker_global_and_venture_routing_overflow_and_unsubscribe():
    broker = Broker()
    all_events, one, two = [broker.subscribe(key) for key in (None, "one", "two")]
    broker.publish({"id": 1, "venture_id": "one"})
    assert all_events.get_nowait()["id"] == one.get_nowait()["id"] == 1
    assert two.empty()
    broker.publish({"id": 2, "venture_id": None})
    assert [q.get_nowait()["id"] for q in (all_events, one, two)] == [2, 2, 2]
    for event_id in range(1001):
        broker.publish({"id": event_id, "venture_id": "one"})
    assert one.qsize() == 1000 and one.get_nowait()["id"] == 1
    broker.unsubscribe("two", two)
    broker.publish({"id": 2000, "venture_id": None})
    assert two.empty()


async def test_redaction_covers_configured_secrets_escaped_json_and_live_events(settings):
    literal = 'private-"quoted-token'
    settings.gemini_api_key = SecretStr(literal)
    settings.kernel_token = SecretStr("short")
    db = Database(settings.db_path, settings)
    await db.connect()
    q = BROKER.subscribe(None)
    try:
        async with db.tx() as tx:
            await tx.execute("INSERT INTO kv VALUES (?,?,?)", ("text", json.dumps({"nested": [literal, "short", "AIza" + "x" * 35]}), utc_now()))
            await emit(tx, venture_id=None, type="test", data={"text": literal, "nested": ["short"]})
        stored = json.loads((await db.fetch_one("SELECT value_json FROM kv WHERE key='text'"))["value_json"])
        assert stored == {"nested": ["[REDACTED]"] * 3}
        event = q.get_nowait()
        persisted = await db.fetch_one("SELECT data_json FROM events WHERE id=?", (event["id"],))
        assert event["data"] == json.loads(persisted["data_json"]) == {"text": "[REDACTED]", "nested": ["[REDACTED]"]}
    finally:
        BROKER.unsubscribe(None, q)
        await db.close()


async def test_startup_recovery_preserves_attempts_and_waiting_gates(db):
    async with db.tx() as tx:
        await venture(tx)
        for identifier, status in (("tkt_interrupted", "in_progress"), ("tkt_gate", "waiting_approval")):
            await tx.execute("INSERT INTO tickets (id,venture_id,type,department_id,assigned_agent_id,title,status,attempts,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                             (identifier, "ven_test", "brief", "intake", "intake.brief-lead", "Brief", status, 2, "human", utc_now(), utc_now()))
        await tx.execute("INSERT INTO agent_state (venture_id,agent_id,status,current_ticket_id) VALUES (?,?,?,?)",
                         ("ven_test", "intake.brief-lead", "working", "tkt_interrupted"))
        for status in ("queued", "running", "succeeded"):
            await tx.execute("INSERT INTO runs (id,venture_id,ticket_id,agent_id,kind,job,model,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                             ("run_" + status, "ven_test", "tkt_interrupted", "intake.brief-lead", "ticket", "brief", "fake", status, utc_now()))
    await recover_interrupted(db)
    ticket = await db.fetch_one("SELECT * FROM tickets WHERE id='tkt_interrupted'")
    assert ticket["status"] == "open" and ticket["attempts"] == 2
    assert (await db.fetch_one("SELECT status FROM tickets WHERE id='tkt_gate'"))["status"] == "waiting_approval"
    for status in ("queued", "running"):
        run = await db.fetch_one("SELECT * FROM runs WHERE id=?", ("run_" + status,))
        assert run["status"] == "failed" and run["error"] == "kernel restarted" and run["completed_at"]
    assert (await db.fetch_one("SELECT status FROM runs WHERE id='run_succeeded'"))["status"] == "succeeded"
    state = await db.fetch_one("SELECT * FROM agent_state")
    assert state["status"] == "idle" and state["current_ticket_id"] is None
    before = len(await db.fetch_all("SELECT * FROM events"))
    await recover_interrupted(db)
    assert len(await db.fetch_all("SELECT * FROM events")) == before


async def test_roster_upserts_all_mutable_fields_idempotently(db, settings):
    async with db.tx() as tx:
        await tx.execute("UPDATE departments SET sort_order=99, building_name='wrong' WHERE id='intake'")
        await tx.execute("UPDATE agents SET department_id='engineering', generated=1 WHERE id='intake.brief-lead'")
    await seed_roster(db, settings)
    await seed_roster(db, settings)
    department = next(d for d in load_roster()["departments"] if d["id"] == "intake")
    assert (await db.fetch_one("SELECT * FROM departments WHERE id='intake'"))["sort_order"] == department["sort_order"]
    row = await db.fetch_one("SELECT * FROM agents WHERE id='intake.brief-lead'")
    assert row["department_id"] == "intake" and row["generated"] == 0
    assert len(await db.fetch_all("SELECT * FROM agents")) == 29


def test_optional_auth_all_v1_paths_and_enveloped_errors(settings):
    settings.kernel_token = SecretStr("private-token")
    app = create_app(settings)

    @app.get("/v1/testing/private")
    async def private():
        return {"data": "ok"}

    @app.get("/v1/testing/error")
    async def fail():
        raise KernelError(400, "test", "private-token", {"nested": ["private-token"]})

    @app.get("/v1/testing/http")
    async def http_fail():
        raise HTTPException(409, "private-token")

    class Input(BaseModel):
        count: int

    # Avoid postponed annotation resolution for a function-local model.
    async def validate(body):
        return {"data": body.count}
    validate.__annotations__["body"] = Input
    app.post("/v1/testing/validate")(validate)

    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/v1/testing/private").status_code == 401
        assert client.get("/v1/missing").status_code == 401
        assert client.get("/v1/testing/private", headers={"Authorization": "Bearer wrong"}).status_code == 401
        headers = {"Authorization": "Bearer private-token"}
        assert client.get("/v1/testing/private", headers=headers).status_code == 200
        for path in ("error", "http"):
            response = client.get("/v1/testing/" + path, headers=headers)
            assert "private-token" not in response.text
            assert response.json()["error"]["message"] == "[REDACTED]"
        response = client.post("/v1/testing/validate", headers=headers, json={"count": "private-token"})
        assert response.status_code == 422 and "error" in response.json() and "private-token" not in response.text
        assert client.get("/v1/missing", headers=headers).json()["error"]["code"] == "not_found"
        assert "/health" in client.get("/openapi.json").json()["paths"]


def test_startup_failure_stops_partial_hooks_and_closes_database(settings, monkeypatch):
    from foundry_kernel import app as app_module

    calls = []

    async def scheduler_start(app):
        calls.append("scheduler.start")

    async def scheduler_stop(app):
        calls.append("scheduler.stop")

    async def github_start(app):
        calls.append("github.start")
        raise RuntimeError("startup failed")

    async def github_stop(app):
        calls.append("github.stop")

    monkeypatch.setattr(app_module.scheduler, "start", scheduler_start)
    monkeypatch.setattr(app_module.scheduler, "stop", scheduler_stop)
    monkeypatch.setattr(app_module.github_watch, "start", github_start)
    monkeypatch.setattr(app_module.github_watch, "stop", github_stop)
    app = create_app(settings)
    with pytest.raises(RuntimeError, match="startup failed"):
        with TestClient(app):
            pass
    assert calls == ["scheduler.start", "github.start", "github.stop", "scheduler.stop"]
    assert app.state.db._conn is None
