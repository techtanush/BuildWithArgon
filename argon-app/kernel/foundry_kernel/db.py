# OWNER: tanush — seed version; replace/extend freely but keep the public signatures.

"""SQLite access. Adapted from foundry (Zero Downtime build): backend/factory/src/foundry_factory/database.py.
Writes go through `async with db.tx() as tx:`; events emitted on the tx are published after COMMIT."""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import aiosqlite

from .config import Settings, get_settings
from .security import SECRET_FIELDS, redact

SCHEMA = Path(__file__).with_name("schema.sql")
MIGRATIONS = Path(__file__).with_name("migrations")


def json_loads_or(value: str | bytes | None, default: Any) -> Any:
    """Decode a SQLite JSON column, falling back only for absent or invalid JSON."""
    if value is None:
        return default
    try:
        return json.loads(value)
    except (ValueError, TypeError, UnicodeDecodeError):
        return default


def redact_value(value: Any, settings: Settings | None = None) -> Any:
    """Redact nested payloads without corrupting JSON escaping or changing scalar types."""
    cfg = settings or get_settings()
    if isinstance(value, str):
        value = redact(value, cfg)
        # security.redact deliberately ignores short secrets; storage must cover all literals.
        for name in SECRET_FIELDS:
            secret = getattr(cfg, name, None)
            literal = secret.get_secret_value() if secret else ""
            if literal:
                value = value.replace(literal, "[REDACTED]")
        return value
    if isinstance(value, dict):
        return {redact_value(k, cfg): redact_value(v, cfg) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact_value(item, cfg) for item in value]
    return value


def json_dumps(value: Any, settings: Settings | None = None) -> str:
    return json.dumps(redact_value(value, settings), default=str)


def _stored_param(value: Any, settings: Settings) -> Any:
    if isinstance(value, str):
        # Handle escaped configured secrets inside JSON as well as ordinary text columns.
        if value.lstrip().startswith(("{", "[")):
            try:
                return json_dumps(json.loads(value), settings)
            except (ValueError, TypeError):
                pass
        return redact_value(value, settings)
    return value


class Tx:
    def __init__(self, conn: aiosqlite.Connection, settings: Settings | None = None) -> None:
        self.conn = conn
        self.settings = settings or get_settings()
        self.events: list[dict[str, Any]] = []

    async def execute(self, sql: str, params: Sequence[Any] = ()) -> int | None:
        cur = await self.conn.execute(sql, tuple(_stored_param(p, self.settings) for p in params))
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
    def __init__(self, path: Path | str, settings: Settings | None = None) -> None:
        self.path = Path(path)
        self.settings = settings or get_settings()
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
        async with self._lock:
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
            tx = Tx(self.conn, self.settings)
            try:
                await self.conn.execute("BEGIN IMMEDIATE")
                yield tx
                # Keep the lock until publication, preserving commit/event ordering.
                # aiosqlite operations continue in its worker when their awaiter is cancelled.
                commit = asyncio.create_task(self.conn.commit())
                cancelled: asyncio.CancelledError | None = None
                try:
                    await asyncio.shield(commit)
                except asyncio.CancelledError as exc:
                    cancelled = exc
                    await commit
                for event in tx.events:
                    BROKER.publish(event)
                if cancelled is not None:
                    raise cancelled
            except BaseException:
                rollback = asyncio.create_task(self.conn.rollback())
                try:
                    await asyncio.shield(rollback)
                except asyncio.CancelledError:
                    await rollback
                raise

    async def fetch_one(self, sql: str, params: Sequence[Any] = ()) -> dict[str, Any] | None:
        async with self._lock:
            return await Tx(self.conn, self.settings).fetch_one(sql, params)

    async def fetch_all(self, sql: str, params: Sequence[Any] = ()) -> list[dict[str, Any]]:
        async with self._lock:
            return await Tx(self.conn, self.settings).fetch_all(sql, params)

    async def ping(self) -> bool:
        row = await self.fetch_one("SELECT 1 AS ok")
        return bool(row and row["ok"] == 1)
