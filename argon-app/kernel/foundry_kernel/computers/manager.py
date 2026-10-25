# OWNER: ayan
"""Cua computer lifecycle (02-models-and-integrations/10-cua-cloud-computers.md §manager.py): one computer per
(venture, agent), started lazily, stopped after CUA_IDLE_STOP_MINUTES idle. Live computer objects are kept in
a process registry keyed by computer id; DB rows in `computers` mirror their status (`computer.updated`)."""
from __future__ import annotations

import asyncio
import logging
import re
import time
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import FastAPI

from .. import bus
from ..errors import DependencyError, NotFoundError
from ..ids import new_id, utc_now
from .cua_client import CuaComputer, CuaUnavailable, create_computer, cua_available

log = logging.getLogger("foundry.computers")

Factory = Callable[[Any, str], Awaitable[CuaComputer]]
_factory: Factory | None = None
_live: dict[str, CuaComputer] = {}
_last_used: dict[str, float] = {}
_locks: dict[int, asyncio.Lock] = {}


def _lock() -> asyncio.Lock:
    loop_id = id(asyncio.get_running_loop())
    return _locks.setdefault(loop_id, asyncio.Lock())


def set_factory(factory: Factory | None) -> None:
    """Tests / dry runs: replace `cua_client.create_computer` (None restores it)."""
    global _factory
    _factory = factory


def has_factory_override() -> bool:
    return _factory is not None


def live(computer_id: str) -> CuaComputer | None:
    return _live.get(computer_id)


def touch(computer_id: str) -> None:
    _last_used[computer_id] = time.monotonic()


def reset() -> None:
    """Forget every live computer (tests)."""
    _live.clear()
    _last_used.clear()


async def _emit(db: Any, row: dict[str, Any], task_id: str | None = None) -> None:
    async with db.tx() as tx:
        await bus.emit(tx, venture_id=row["venture_id"], type="computer.updated", entity_kind="computer",
                       entity_id=row["id"], data={"computer_id": row["id"], "agent_id": row["agent_id"],
                                                  "status": row["status"], "task_id": task_id})


async def set_status(db: Any, computer_id: str, status: str, *, task_id: str | None = None,
                     last_screenshot_path: str | None = None) -> None:
    async with db.tx() as tx:
        if last_screenshot_path:
            await tx.execute("UPDATE computers SET status=?, last_screenshot_path=?, updated_at=? WHERE id=?",
                             (status, last_screenshot_path, utc_now(), computer_id))
        else:
            await tx.execute("UPDATE computers SET status=?, updated_at=? WHERE id=?", (status, utc_now(), computer_id))
        row = await tx.fetch_one("SELECT * FROM computers WHERE id=?", (computer_id,))
        if row:
            await bus.emit(tx, venture_id=row["venture_id"], type="computer.updated", entity_kind="computer",
                           entity_id=computer_id, data={"computer_id": computer_id, "agent_id": row["agent_id"],
                                                        "status": status, "task_id": task_id})
    touch(computer_id)


async def get_computer(settings: Any, db: Any, venture_id: str, agent_id: str) -> tuple[dict[str, Any], CuaComputer]:
    """Return (row, computer) for this agent, starting one if needed. Raises CuaUnavailable."""
    if settings.cua_mode == "off":
        raise CuaUnavailable("CUA_MODE=off")
    async with _lock():
        row = await db.fetch_one("SELECT * FROM computers WHERE venture_id=? AND agent_id=?", (venture_id, agent_id))
        if row and row["id"] in _live and row["status"] == "error":
            raise CuaUnavailable("previous desktop cleanup is unconfirmed; retry Stop before reusing it")
        if row and row["id"] in _live and row["status"] not in ("stopped", "error"):
            touch(row["id"])
            return row, _live[row["id"]]
        provider = "cua_space" if settings.cua_mode == "spaces" else "cua_sandbox"
        now = utc_now()
        async with db.tx() as tx:
            if row is None:
                cid = new_id("cmp")
                await tx.execute(
                    "INSERT INTO computers (id, venture_id, agent_id, provider, status, image, created_at, updated_at) "
                    "VALUES (?,?,?,?, 'starting', ?,?,?)", (cid, venture_id, agent_id, provider, settings.cua_image, now, now))
            else:
                cid = row["id"]
                await tx.execute("UPDATE computers SET status='starting', provider=?, image=?, updated_at=? WHERE id=?",
                                 (provider, settings.cua_image, now, cid))
        name = "foundry-" + re.sub(r"[^a-z0-9-]", "-", agent_id.lower()) + "-" + cid[-6:].lower()
        try:
            computer = await (_factory or create_computer)(settings, name)
            if any(str(getattr(other, "id", "")) == str(computer.id) for other in _live.values()):
                await computer.stop()
                raise CuaUnavailable("this desktop is already assigned to another agent")
        except Exception as exc:
            await set_status(db, cid, "error")
            if isinstance(exc, CuaUnavailable):
                raise
            raise CuaUnavailable(str(exc)) from exc
        _live[cid] = computer
        async with db.tx() as tx:
            await tx.execute("UPDATE computers SET status='ready', external_ref=?, watch_url=?, updated_at=? WHERE id=?",
                             (getattr(computer, "id", name), getattr(computer, "watch_url", None), utc_now(), cid))
        row = await db.fetch_one("SELECT * FROM computers WHERE id=?", (cid,))
        assert row is not None
        await _emit(db, row)
        touch(cid)
        return row, computer


async def stop_computer(db: Any, computer_id: str) -> dict[str, Any]:
    """Stop the computer (best effort) and any running task on it; returns the updated row."""
    row = await db.fetch_one("SELECT * FROM computers WHERE id=?", (computer_id,))
    if row is None:
        raise NotFoundError("computer", computer_id)
    computer = _live.get(computer_id)
    if computer is None and row["status"] != "stopped":
        await set_status(db, computer_id, "error")
        raise DependencyError("cua", "Desktop stop cannot be confirmed: no live connection", unavailable=True)
    if computer is not None:
        try:
            await computer.stop()
        except Exception as exc:  # noqa: BLE001
            log.warning("stopping computer %s failed (%s)", computer_id, type(exc).__name__)
            await set_status(db, computer_id, "error")
            raise DependencyError("cua", "Desktop stop failed; retry Stop", unavailable=True) from exc
    _live.pop(computer_id, None)
    _last_used.pop(computer_id, None)
    now = utc_now()
    async with db.tx() as tx:
        await tx.execute("UPDATE computer_tasks SET status='stopped', completed_at=? "
                         "WHERE computer_id=? AND status IN ('running','waiting_approval')", (now, computer_id))
        await tx.execute("UPDATE computers SET status='stopped', updated_at=? WHERE id=?", (now, computer_id))
        row = await tx.fetch_one("SELECT * FROM computers WHERE id=?", (computer_id,))
        await bus.emit(tx, venture_id=row["venture_id"], type="computer.updated", entity_kind="computer",
                       entity_id=computer_id, data={"computer_id": computer_id, "agent_id": row["agent_id"],
                                                    "status": "stopped", "task_id": None})
    return row


async def _reaper(app: FastAPI) -> None:
    settings, db = app.state.settings, app.state.db
    while True:
        await asyncio.sleep(60)
        try:
            idle_s = settings.cua_idle_stop_minutes * 60
            for cid in list(_live):
                if time.monotonic() - _last_used.get(cid, 0) < idle_s:
                    continue
                row = await db.fetch_one("SELECT status FROM computers WHERE id=?", (cid,))
                if row and row["status"] != "busy":
                    await stop_computer(db, cid)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.warning("computer reaper: %s", exc)


async def start(app: FastAPI) -> None:
    """Called from the kernel lifespan. Never raises; CUA_MODE=off does nothing."""
    try:
        settings = app.state.settings
        if settings.cua_mode == "off":
            return
        ok, reason = cua_available()
        log.info("cloud computers: mode=%s available=%s (%s)", settings.cua_mode, ok, reason)
        app.state.computer_reaper = asyncio.create_task(_reaper(app))
    except Exception as exc:  # noqa: BLE001
        log.warning("computer manager start failed: %s", exc)


async def stop(app: FastAPI) -> None:
    """Stop all computers. Never raises."""
    task = getattr(app.state, "computer_reaper", None)
    if task is not None:
        task.cancel()
    db = getattr(app.state, "db", None)
    for cid in list(_live):
        try:
            if db is not None:
                await stop_computer(db, cid)
            else:
                await _live.pop(cid).stop()
        except Exception as exc:  # noqa: BLE001
            log.warning("stopping computer %s failed: %s", cid, exc)
