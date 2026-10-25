# OWNER: tanush — seed version; replace/extend freely but keep the public signatures.

"""SQLite access. Adapted from foundry (Zero Downtime build): backend/factory/src/foundry_factory/database.py.
Writes go through `async with db.tx() as tx:`; events emitted on the tx are published after COMMIT."""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import aiosqlite

SCHEMA = Path(__file__).with_name("schema.sql")
MIGRATIONS = Path(__file__).with_name("migrations")


class Tx:
    def __init__(self, conn: aiosqlite.Connection) -> None:
        self.conn = conn
        self.events: list[dict[str, Any]] = []

    async def execute(self, sql: str, params: Sequence[Any] = ()) -> int | None:
        cur = await self.conn.execute(sql, params)
        last = cur.lastrowid
        await cur.close()
        return last

    async def fetch_one(self, sql: str, params: Sequence[Any] = ()) -> dict[str, Any] | None:
        cur = await self.conn.execute(sql, params)
        row = await cur.fetchone()
        await cur.close()
        return dict(row) if row is not None else None

    async def fetch_all(self, sql: str, params: Sequence[Any] = ()) -> list[dict[str, Any]]:
        cur = await self.conn.execute(sql, params)
        rows = await cur.fetchall()
        await cur.close()
        return [dict(r) for r in rows]


class Database:
    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self._conn: aiosqlite.Connection | None = None
        self._lock = asyncio.Lock()

    @property
    def conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("database is not connected")
        return self._conn

    async def connect(self) -> None:
        if self._conn is not None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = await aiosqlite.connect(self.path, isolation_level=None, timeout=10.0)
        self._conn.row_factory = aiosqlite.Row
        for pragma in ("foreign_keys = ON", "busy_timeout = 5000", "journal_mode = WAL", "synchronous = NORMAL"):
            await self._conn.execute(f"PRAGMA {pragma}")
        await self._migrate()

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    async def _migrate(self) -> None:
        async with self._lock:
            cur = await self.conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
            exists = await cur.fetchone()
            await cur.close()
            if not exists:
                await self.conn.executescript("BEGIN IMMEDIATE;\n" + SCHEMA.read_text() + "\nCOMMIT;")
            await self.conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
            cur = await self.conn.execute("SELECT name FROM schema_migrations")
            applied = {r[0] for r in await cur.fetchall()}
            await cur.close()
            for script in sorted(MIGRATIONS.glob("*.sql")):
                if script.name in applied:
                    continue
                name = script.name.replace("'", "''")
                await self.conn.executescript(
                    "BEGIN IMMEDIATE;\n" + script.read_text() +
                    f"\nINSERT INTO schema_migrations(name, applied_at) VALUES ('{name}', strftime('%Y-%m-%dT%H:%M:%fZ','now'));\nCOMMIT;")

    @asynccontextmanager
    async def tx(self) -> AsyncIterator[Tx]:
        from .bus import BROKER

        async with self._lock:
            await self.conn.execute("BEGIN IMMEDIATE")
            tx = Tx(self.conn)
            try:
                yield tx
            except BaseException:
                await self.conn.rollback()
                raise
            else:
                await self.conn.commit()
        for event in tx.events:  # publish only after a successful commit
            BROKER.publish(event)

    async def fetch_one(self, sql: str, params: Sequence[Any] = ()) -> dict[str, Any] | None:
        async with self._lock:
            return await Tx(self.conn).fetch_one(sql, params)

    async def fetch_all(self, sql: str, params: Sequence[Any] = ()) -> list[dict[str, Any]]:
        async with self._lock:
            return await Tx(self.conn).fetch_all(sql, params)

    async def ping(self) -> bool:
        row = await self.fetch_one("SELECT 1 AS ok")
        return bool(row and row["ok"] == 1)
