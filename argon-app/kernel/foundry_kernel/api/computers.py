# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.

"""Cloud computers (Cua) — 01-architecture/04-api-contract.md §Cloud computers. Read-mostly endpoints for the
dashboard's Computers page, plus Stop."""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse

from ..computers import evidence, manager
from ..contracts import ComputerAction, ComputerInfo, ComputerTaskInfo
from ..errors import NotFoundError

router = APIRouter(tags=["computers"])


def _check(kind: str, value: str, prefix: str) -> None:
    if not evidence.valid_id(value, prefix):
        raise NotFoundError(kind, value)


async def _info(db: Any, row: dict[str, Any]) -> dict[str, Any]:
    task = await db.fetch_one(
        "SELECT id, goal, steps, status FROM computer_tasks WHERE computer_id=? AND status IN ('running','waiting_approval') "
        "ORDER BY created_at DESC LIMIT 1", (row["id"],))
    return ComputerInfo(id=row["id"], agent_id=row["agent_id"], provider=row["provider"], status=row["status"],
                        current_task=ComputerTaskInfo(**task) if task else None, watch_url=row["watch_url"]).model_dump()


@router.get("/v1/ventures/{vid}/computers")
async def list_computers(vid: str, request: Request) -> dict[str, Any]:
    db = request.app.state.db
    if await db.fetch_one("SELECT id FROM ventures WHERE id=?", (vid,)) is None:
        raise NotFoundError("venture", vid)
    rows = await db.fetch_all("SELECT * FROM computers WHERE venture_id=? ORDER BY created_at", (vid,))
    return {"data": {"items": [await _info(db, r) for r in rows], "next_cursor": None}}


@router.get("/v1/computers/{computer_id}/screen.png")
async def computer_screen(computer_id: str, request: Request) -> FileResponse:
    _check("computer", computer_id, "cmp")
    row = await request.app.state.db.fetch_one("SELECT last_screenshot_path FROM computers WHERE id=?", (computer_id,))
    path = evidence.resolve(request.app.state.settings, row["last_screenshot_path"]) if row else None
    if path is None:
        raise NotFoundError("screenshot for computer", computer_id)
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "no-store"})


@router.get("/v1/computer-tasks/{task_id}")
async def get_task(task_id: str, request: Request) -> dict[str, Any]:
    _check("computer task", task_id, "ctk")
    db = request.app.state.db
    task = await db.fetch_one("SELECT * FROM computer_tasks WHERE id=?", (task_id,))
    if task is None:
        raise NotFoundError("computer task", task_id)
    rows = await db.fetch_all("SELECT * FROM computer_actions WHERE task_id=? ORDER BY step, id", (task_id,))
    actions = [ComputerAction(step=r["step"], action=json.loads(r["action_json"]), reason=r["reason"], guard=r["guard"],
                              screenshot_url=evidence.screen_url(task_id, r["step"]) if r["screenshot_path"] else None,
                              created_at=r["created_at"]).model_dump() for r in rows]
    data = {k: task[k] for k in ("id", "venture_id", "computer_id", "ticket_id", "agent_id", "goal", "status", "steps",
                                 "created_at", "completed_at")}
    data["allowed_domains"] = json.loads(task["allowed_domains_json"] or "[]")
    data["result"] = json.loads(task["result_json"]) if task["result_json"] else None
    data["actions"] = actions
    return {"data": data}


@router.get("/v1/computer-tasks/{task_id}/screens/{step}.png")
async def task_screen(task_id: str, step: int, request: Request) -> FileResponse:
    _check("computer task", task_id, "ctk")
    path = evidence.step_path(request.app.state.settings, task_id, step)
    if path is None:
        raise NotFoundError("screenshot", f"{task_id}/{step}")
    return FileResponse(path, media_type="image/png")


@router.post("/v1/computers/{computer_id}/stop")
async def stop_computer(computer_id: str, request: Request) -> dict[str, Any]:
    _check("computer", computer_id, "cmp")
    db = request.app.state.db
    row = await manager.stop_computer(db, computer_id)
    return {"data": await _info(db, row)}
