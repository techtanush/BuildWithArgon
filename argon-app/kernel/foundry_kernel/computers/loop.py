# OWNER: ayan — keep the public signature of run_task (tanush's ctx.use_computer calls it).

"""The computer-use loop (02-models-and-integrations/10-cua-cloud-computers.md §loop.py): screenshot →
Flash `computer_step` → guard → execute, Argon `computer_plan` re-plans every 6 steps or when stuck.
Contract: NEVER raise for unavailability — return status="skipped" with a reason, so callers fall back."""
from __future__ import annotations

import asyncio
import json
import logging
from collections import deque
from typing import Any, Literal

from pydantic import BaseModel

from .. import bus, gates
from ..contracts import ComputerTaskResult, Part
from ..ids import new_id, utc_now
from ..errors import GateNotApproved
from ..security import redact
from . import evidence, guard, manager
from .cua_client import CuaComputer, CuaUnavailable, cua_available

log = logging.getLogger("foundry.computers")

FAILURES_KEY = "cua.failures"
MAX_FAILURES = 3
REPLAN_EVERY = 6
MAX_BLOCKS_PER_STEP = 2


class ComputerStepAction(BaseModel):
    """Action schema returned by `computer_step` (spec §loop)."""
    type: Literal["click", "double_click", "type", "key", "scroll", "open_url", "wait", "done", "stuck"]
    x: int | None = None
    y: int | None = None
    text: str | None = None
    keys: str | None = None
    dy: int | None = None
    url: str | None = None
    reason: str = ""
    result: dict[str, Any] | None = None


class PlanOut(BaseModel):
    plan: str


STEP_PROMPT = """You are {agent_id}, operating a real desktop computer (screen 1280x800) to reach a goal.
GOAL: {goal}
ALLOWED DOMAINS: {domains}
CURRENT URL: {url}
PLAN: {plan}
LAST ACTIONS (oldest first): {history}
{note}
Look at the attached screenshot and choose the single next action. Never type real credentials; never
download or run files; stay on the allowed domains. When the goal is reached, return type "done" with the
findings in "result". If you cannot make progress, return type "stuck".
Return ONLY JSON: {{"type": "click|double_click|type|key|scroll|open_url|wait|done|stuck", "x": 640, "y": 412,
"text": "...", "keys": "ctrl+l", "dy": -600, "url": "https://...", "reason": "<= 20 words",
"result": {{"...": "only when type == done"}}}}"""

PLAN_PROMPT = """You supervise an agent operating a computer. GOAL: {goal}
ALLOWED DOMAINS: {domains}
CURRENT PLAN: {plan}
ACTION HISTORY: {history}
The last screenshots are attached (oldest first). Review progress and write a revised, concrete
step-by-step plan (max 8 steps) that reaches the goal within the remaining {remaining} steps.
Return ONLY JSON: {{"plan": "..."}}"""


# ------------------------------------------------------------------ kv helpers (consecutive Cua failures)


async def _failures(db: Any) -> int:
    row = await db.fetch_one("SELECT value_json FROM kv WHERE key=?", (FAILURES_KEY,))
    try:
        return int(json.loads(row["value_json"])) if row else 0
    except (TypeError, ValueError):
        return 0


async def _set_failures(db: Any, n: int) -> None:
    async with db.tx() as tx:
        await tx.execute("INSERT INTO kv (key, value_json, updated_at) VALUES (?,?,?) "
                         "ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at",
                         (FAILURES_KEY, json.dumps(n), utc_now()))


# ------------------------------------------------------------------ actions


async def _execute(computer: CuaComputer, action: ComputerStepAction) -> None:
    t = action.type
    if t in ("click", "double_click"):
        if action.x is None or action.y is None:
            raise ValueError("click needs x and y")
        await computer.click(action.x, action.y, double=(t == "double_click"))
    elif t == "type":
        await computer.type_text(action.text or "")
    elif t == "key":
        await computer.key(action.keys or "Return")
    elif t == "scroll":
        await computer.scroll(action.dy if action.dy is not None else -600)
    elif t == "open_url":
        await computer.open_url(action.url or "")
    elif t == "wait":
        await asyncio.sleep(1.0)


async def _actual_url(computer: CuaComputer) -> str:
    reader = getattr(computer, "get_current_url", None)
    if not callable(reader):
        raise CuaUnavailable("computer cannot verify the actual browser URL")
    return str(await reader())


async def execute_gated_action(db: Any, computer: CuaComputer, *, approval_id: str | None, action: dict[str, Any]) -> None:
    """Run an action the guard gated — only after the founder approved the `computer_action` gate."""
    approval = await gates.require_approved(db, approval_id, "computer_action")
    payload = json.loads(approval["payload_json"] or "{}")
    task = await db.fetch_one("SELECT * FROM computer_tasks WHERE id=?", (payload.get("task_id"),))
    row = await db.fetch_one("SELECT * FROM computers WHERE id=?", (task["computer_id"],)) if task else None
    if (not task or not row or task["venture_id"] != approval["venture_id"]
            or str(row["external_ref"]) != str(computer.id)
            or payload.get("action") != action or task["status"] != "waiting_approval"):
        raise GateNotApproved(approval_id, "computer_action")
    allowed = json.loads(task["allowed_domains_json"] or "[]")
    actual_url = await _actual_url(computer)
    if actual_url != payload.get("url") or not guard.domain_allowed(actual_url, allowed):
        raise GateNotApproved(approval_id, "computer_action")
    verdict = guard.deterministic(action, current_url=actual_url, screen_text="", allowed_domains=allowed)
    if verdict and verdict.verdict == "block":
        raise GateNotApproved(approval_id, "computer_action")
    validated = ComputerStepAction.model_validate(action)
    # Commit the claim BEFORE the side effect. An uncertain failure is not safe to replay.
    async with db.tx() as tx:
        await gates.require_approved(tx, approval_id, "computer_action")
        current_task = await tx.fetch_one("SELECT status FROM computer_tasks WHERE id=?", (task["id"],))
        if not current_task or current_task["status"] != "waiting_approval":
            raise GateNotApproved(approval_id, "computer_action")
        key = "computer.approval_consumed." + str(approval_id)
        if await tx.fetch_one("SELECT key FROM kv WHERE key=?", (key,)):
            raise GateNotApproved(approval_id, "computer_action")
        await tx.execute("INSERT INTO kv (key, value_json, updated_at) VALUES (?,?,?)",
                         (key, json.dumps({"task_id": task["id"]}), utc_now()))
    await _execute(computer, validated)


# ------------------------------------------------------------------ the loop


class _Task:
    def __init__(self, settings: Any, db: Any, llm: Any, venture_id: str, agent_id: str, ticket_id: str | None,
                 goal: str, allowed_domains: list[str], computer_row: dict[str, Any], computer: CuaComputer) -> None:
        self.settings, self.db, self.llm = settings, db, llm
        self.venture_id, self.agent_id, self.ticket_id = venture_id, agent_id, ticket_id
        self.goal, self.allowed = goal, allowed_domains
        self.row, self.computer = computer_row, computer
        self.id = new_id("ctk")
        self.url = "about:blank"
        self.plan = "(none yet)"
        self.history: deque[dict[str, Any]] = deque(maxlen=5)
        self.recent_pngs: deque[bytes] = deque(maxlen=3)
        self.screenshots: list[str] = []
        self.steps = 0

    async def create(self) -> None:
        async with self.db.tx() as tx:
            await tx.execute(
                "INSERT INTO computer_tasks (id, venture_id, computer_id, ticket_id, agent_id, goal, allowed_domains_json, "
                "status, steps, created_at) VALUES (?,?,?,?,?,?,?, 'running', 0, ?)",
                (self.id, self.venture_id, self.row["id"], self.ticket_id, self.agent_id, redact(self.goal),
                 json.dumps(self.allowed), utc_now()))
        await manager.set_status(self.db, self.row["id"], "busy", task_id=self.id)

    async def record(self, step: int, action: ComputerStepAction, verdict: guard.GuardVerdict, shot: str | None) -> None:
        data = action.model_dump(exclude_none=True)
        async with self.db.tx() as tx:
            await tx.execute(
                "INSERT INTO computer_actions (task_id, step, action_json, reason, guard, screenshot_path, created_at) "
                "VALUES (?,?,?,?,?,?,?)",
                (self.id, step, redact(json.dumps(data)), redact(action.reason or verdict.reason), verdict.verdict, shot,
                 utc_now()))
            await tx.execute("UPDATE computer_tasks SET steps=? WHERE id=?", (self.steps, self.id))
            await bus.emit(tx, venture_id=self.venture_id, type="computer.action", entity_kind="computer_task",
                           entity_id=self.id, data={"task_id": self.id, "step": step, "action": data,
                                                    "guard": verdict.verdict,
                                                    "screenshot_url": evidence.screen_url(self.id, step) if shot else None})
        self.history.append({"step": step, **data, "guard": verdict.verdict})

    async def finish(self, status: str, result: dict[str, Any], reason: str = "") -> ComputerTaskResult:
        task_status = status if status in ("succeeded", "failed", "waiting_approval", "stopped") else "failed"
        async with self.db.tx() as tx:
            await tx.execute("UPDATE computer_tasks SET status=?, steps=?, result_json=?, completed_at=? WHERE id=?",
                             (task_status, self.steps, redact(json.dumps({**result, "reason": reason} if reason else result)),
                              None if task_status == "waiting_approval" else utc_now(), self.id))
        current = await self.db.fetch_one("SELECT status FROM computers WHERE id=?", (self.row["id"],))
        if current and current["status"] not in ("stopped", "error"):
            await manager.set_status(self.db, self.row["id"], "ready", task_id=self.id,
                                     last_screenshot_path=self.screenshots[-1] if self.screenshots else None)
        return ComputerTaskResult(task_id=self.id, status=task_status, steps=self.steps, result=result,  # type: ignore[arg-type]
                                  screenshots=list(self.screenshots), reason=reason)

    async def stopped(self) -> bool:
        row = await self.db.fetch_one("SELECT status FROM computer_tasks WHERE id=?", (self.id,))
        computer_row = await self.db.fetch_one("SELECT status FROM computers WHERE id=?", (self.row["id"],))
        return bool((row and row["status"] == "stopped") or (computer_row and computer_row["status"] in ("error", "stopped")))

    def _history(self) -> str:
        return json.dumps(list(self.history)) if self.history else "(none)"

    async def next_action(self, png: bytes, note: str) -> ComputerStepAction:
        prompt = STEP_PROMPT.format(agent_id=self.agent_id, goal=self.goal, domains=", ".join(self.allowed), url=self.url,
                                    plan=self.plan, history=self._history(), note=note)
        parts = [Part(kind="text", text=prompt), Part(kind="image", data=png, mime="image/png")]
        action, _ = await self.llm.generate_json("computer_step", parts, ComputerStepAction,
                                                 venture_id=self.venture_id, agent_id=self.agent_id)
        return action  # type: ignore[return-value]

    async def replan(self, remaining: int) -> None:
        parts: list[Part] = [Part(kind="text", text=PLAN_PROMPT.format(
            goal=self.goal, domains=", ".join(self.allowed), plan=self.plan, history=self._history(), remaining=remaining))]
        parts += [Part(kind="image", data=png, mime="image/png") for png in self.recent_pngs]
        out, _ = await self.llm.generate_json("computer_plan", parts, PlanOut, venture_id=self.venture_id,
                                              agent_id=self.agent_id)
        self.plan = out.plan  # type: ignore[attr-defined]

    async def gate(self, step: int, action: ComputerStepAction, verdict: guard.GuardVerdict, shot: str) -> ComputerTaskResult:
        await self.record(step, action, verdict, shot)
        async with self.db.tx() as tx:
            approval_id = await gates.request_approval(
                tx, venture_id=self.venture_id, gate_type="computer_action",
                title=f"Computer action by {self.agent_id}: {action.type}",
                summary=redact(f"{verdict.reason}. Proposed: {action.reason or action.type} on {self.url}"),
                payload={"task_id": self.id, "step": step, "url": self.url, "action": action.model_dump(exclude_none=True),
                         "reason": verdict.reason, "screenshot_url": evidence.screen_url(self.id, step)},
                ticket_id=self.ticket_id, requested_by_agent_id=self.agent_id)
        return await self.finish("waiting_approval", {"approval_id": approval_id,
                                                      "pending_action": action.model_dump(exclude_none=True)},
                                 reason=verdict.reason)

    async def run(self, start_url: str, cap: int) -> ComputerTaskResult:
        start = ComputerStepAction(type="open_url", url=start_url, reason="open the start page")
        verdict = await guard.check(start.model_dump(exclude_none=True), current_url=self.url, screen_text="",
                                    allowed_domains=self.allowed, llm=self.llm, venture_id=self.venture_id)
        if verdict.verdict != "allow":
            await self.record(0, start, verdict, None)
            return await self.finish("failed", {}, reason=f"start URL refused by guard: {verdict.reason}")
        await self.computer.open_url(start_url)
        self.url = await _actual_url(self.computer)
        if not guard.domain_allowed(self.url, self.allowed):
            return await self.finish("failed", {}, reason="start page redirected outside the allowed domains")
        await self.record(0, start, verdict, None)
        replan_due = False
        for step in range(1, cap + 1):
            if await self.stopped():
                return await self.finish("stopped", {}, reason="stopped by the founder")
            self.url = await _actual_url(self.computer)
            if not guard.domain_allowed(self.url, self.allowed):
                return await self.finish("failed", {}, reason="actual browser URL is outside the allowed domains")
            png = await self.computer.screenshot()
            shot = evidence.save_screenshot(self.settings, self.id, step, png)
            self.screenshots.append(shot)
            self.recent_pngs.append(png)
            manager.touch(self.row["id"])
            if replan_due or (step > 1 and (step - 1) % REPLAN_EVERY == 0):
                await self.replan(cap - step + 1)
                replan_due = False
            note, blocks, attempts = "", 0, 0
            while True:
                attempts += 1
                action = await self.next_action(png, note)
                if action.type == "stuck" and attempts <= 2:
                    await self.replan(cap - step + 1)
                    note = "You reported being stuck; the plan was revised. Choose the next action."
                    continue
                if action.type in ("click", "double_click") and (action.x is None or action.y is None):
                    if attempts > MAX_BLOCKS_PER_STEP + 1:
                        return await self.finish("failed", {}, reason="model kept returning clicks without coordinates")
                    note = "Your last action was a click without x and y. Give coordinates."
                    continue
                verdict = await guard.check(action.model_dump(exclude_none=True), current_url=self.url, screen_text="",
                                            allowed_domains=self.allowed, llm=self.llm, venture_id=self.venture_id)
                if verdict.verdict == "allow":
                    break
                self.steps = step
                if verdict.verdict == "gate":
                    return await self.gate(step, action, verdict, shot)
                await self.record(step, action, verdict, shot)
                blocks += 1
                if blocks > MAX_BLOCKS_PER_STEP:
                    return await self.finish("failed", {}, reason=f"guard blocked {blocks} actions in a row: {verdict.reason}")
                note = f"Your last action was blocked by the safety guard ({verdict.reason}). Choose a different action."
            self.steps = step
            if action.type == "stuck":
                replan_due = True
                await self.record(step, action, verdict, shot)
                continue
            if action.type == "done":
                await self.record(step, action, verdict, shot)
                return await self.finish("succeeded", action.result or {})
            await _execute(self.computer, action)
            if action.type == "open_url" and action.url:
                self.url = await _actual_url(self.computer)
            await self.record(step, action, verdict, shot)
        return await self.finish("failed", {}, reason=f"max steps ({cap}) reached")


async def run_task(*, settings: Any, db: Any, llm: Any, venture_id: str, agent_id: str, ticket_id: str | None,
                   goal: str, allowed_domains: list[str], start_url: str, max_steps: int = 30) -> ComputerTaskResult:
    if getattr(settings, "cua_mode", "off") == "off":
        return ComputerTaskResult(status="skipped", reason="CUA_MODE=off")
    try:
        if not manager.has_factory_override():
            ok, why = cua_available()
            if not ok:
                return ComputerTaskResult(status="skipped", reason=why)
        if await _failures(db) >= MAX_FAILURES:
            return ComputerTaskResult(status="skipped", reason=f"Cua failed {MAX_FAILURES} times in a row; using the fallback")
        try:
            row, computer = await manager.get_computer(settings, db, venture_id, agent_id)
        except CuaUnavailable as exc:
            await _set_failures(db, await _failures(db) + 1)
            return ComputerTaskResult(status="skipped", reason=f"computer unavailable: {exc}")
        await _set_failures(db, 0)
        task = _Task(settings, db, llm, venture_id, agent_id, ticket_id, goal, allowed_domains, row, computer)
        await task.create()
    except Exception as exc:  # noqa: BLE001 - contract: never raise for unavailability
        log.warning("computer task could not start: %s", exc)
        return ComputerTaskResult(status="skipped", reason=f"computer task could not start: {type(exc).__name__}: {exc}")
    cap = max(1, min(max_steps, settings.cua_max_steps))
    try:
        return await task.run(start_url, cap)
    except Exception as exc:  # noqa: BLE001 - a failing computer/model fails the task, never the caller
        log.warning("computer task %s failed: %s", task.id, exc)
        if isinstance(exc, CuaUnavailable):
            try:
                await _set_failures(db, await _failures(db) + 1)
            except Exception:
                log.warning("could not update Cua failure counter")
        try:
            return await task.finish("failed", {}, reason=redact(f"{type(exc).__name__}: {exc}"))
        except Exception:  # noqa: BLE001
            return ComputerTaskResult(task_id=task.id, status="failed", steps=task.steps, reason=redact(str(exc), settings))
