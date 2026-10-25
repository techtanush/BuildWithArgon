# OWNER: tanush
"""Failed initialization must release SQLite's worker and permit a clean retry."""
import asyncio

import aiosqlite
import pytest

from foundry_kernel.db import Database


async def test_failed_migration_closes_partial_connection_and_allows_retry(settings, monkeypatch):
    captured = []
    original_connect = aiosqlite.connect

    def capture(*args, **kwargs):
        connection = original_connect(*args, **kwargs)
        captured.append(connection)
        return connection

    monkeypatch.setattr(aiosqlite, "connect", capture)
    db = Database(settings.db_path, settings)
    migrate = db._migrate

    async def fail():
        raise OSError("simulated startup disk failure")

    monkeypatch.setattr(db, "_migrate", fail)
    with pytest.raises(OSError, match="startup disk failure"):
        await db.connect()
    assert db._conn is None
    with pytest.raises(ValueError, match="no active connection"):
        await captured[0].execute("SELECT 1")
    monkeypatch.setattr(db, "_migrate", migrate)
    await db.connect()
    assert await db.ping()
    await db.close()


async def test_cancelled_migration_closes_partial_connection(settings, monkeypatch):
    db = Database(settings.db_path, settings)
    entered = asyncio.Event()
    captured = []

    async def blocked():
        captured.append(db.conn)
        entered.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(db, "_migrate", blocked)
    task = asyncio.create_task(db.connect())
    await asyncio.wait_for(entered.wait(), 2)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert db._conn is None
    with pytest.raises(ValueError, match="no active connection"):
        await captured[0].execute("SELECT 1")
