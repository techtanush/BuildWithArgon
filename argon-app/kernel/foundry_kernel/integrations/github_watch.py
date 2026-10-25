# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.

"""Polls GitHub issues and PR comments -> tickets (02-models-and-integrations/04-composio.md §github_watch,
03-company-kernel/03-support-and-pr-loop.md). Runs only with COMPOSIO_API_KEY set and LLM_MODE=live;
start/stop never raise."""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import Any

from fastapi import FastAPI

from .. import bus
from ..ids import new_id, utc_now
from ..security import redact
from .composio import ComposioClient, ComposioError, github_integration

log = logging.getLogger(__name__)

BACKOFF_SECONDS = 300
_TASK_ATTR = "github_watch_task"


def _state(app_or_state: Any) -> Any:
    return getattr(app_or_state, "state", app_or_state)


async def _insert_ticket(tx: Any, *, venture_id: str, type: str, department_id: str, agent_id: str, title: str,
                         body: str, payload: dict[str, Any], priority: int) -> dict[str, Any]:
    now = utc_now()
    ticket = {"id": new_id("tkt"), "venture_id": venture_id, "type": type, "department_id": department_id,
              "assigned_agent_id": agent_id, "title": redact(title)[:300], "body": redact(body),
              "status": "open", "priority": priority, "payload": payload, "created_by": "system",
              "created_at": now, "updated_at": now}
    await tx.execute(
        "INSERT INTO tickets (id, venture_id, type, department_id, assigned_agent_id, title, body, status, priority, "
        "payload_json, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (ticket["id"], venture_id, type, department_id, agent_id, ticket["title"], ticket["body"], "open", priority,
         redact(json.dumps(payload)), "system", now, now))
    await bus.emit(tx, venture_id=venture_id, type="ticket.created", entity_kind="ticket", entity_id=ticket["id"],
                   data=ticket)
    return ticket


async def _seen(db: Any, venture_id: str, kind: str, external_id: str) -> bool:
    row = await db.fetch_one("SELECT 1 AS x FROM github_seen WHERE venture_id = ? AND kind = ? AND external_id = ?",
                             (venture_id, kind, external_id))
    return row is not None


def _is_bot(comment: dict[str, Any]) -> bool:
    user = comment.get("user") or {}
    login = str(user.get("login") or "").lower()
    body = str(comment.get("body") or "")
    return user.get("type") == "Bot" or login.endswith("[bot]") or "foundry" in login or "Built by Foundry" in body


async def _poll_venture(db: Any, client: ComposioClient, venture: dict[str, Any], started: str) -> dict[str, int]:
    vid, repo, uid = venture["id"], venture["repo_full_name"], venture["composio_user_id"]
    counts = {"issues": 0, "pr_comments": 0}
    since_row = await db.fetch_one("SELECT value_json FROM kv WHERE key = ?", (f"gh.since.{vid}",))
    since = json.loads(since_row["value_json"]) if since_row else None

    for issue in await client.list_issues(uid, repo, since):
        if "pull_request" in issue or issue.get("number") is None:
            continue
        ext = str(issue["number"])
        if await _seen(db, vid, "issue", ext):
            continue
        payload = {"number": issue["number"], "title": issue.get("title", ""), "body": issue.get("body") or "",
                   "author": (issue.get("user") or {}).get("login", ""), "url": issue.get("html_url", ""),
                   "labels": [lb.get("name", "") if isinstance(lb, dict) else str(lb) for lb in issue.get("labels") or []]}
        async with db.tx() as tx:
            await _insert_ticket(tx, venture_id=vid, type="support.issue", department_id="support", agent_id="su.triager",
                                 title=f"Issue #{issue['number']}: {payload['title']}", body=payload["body"],
                                 payload=payload, priority=1)
            await tx.execute("INSERT OR IGNORE INTO github_seen (venture_id, kind, external_id, seen_at) VALUES (?,?,?,?)",
                             (vid, "issue", ext, utc_now()))
        counts["issues"] += 1

    prs = await db.fetch_all("SELECT id, meta_json FROM artifacts WHERE venture_id = ? AND kind = 'pr'", (vid,))
    for pr in prs:
        meta = json.loads(pr["meta_json"] or "{}")
        if meta.get("state") != "open" or meta.get("number") is None:
            continue
        for comment in await client.list_issue_comments(uid, repo, int(meta["number"])):
            ext = str(comment.get("id"))
            if comment.get("id") is None or _is_bot(comment) or await _seen(db, vid, "pr_comment", ext):
                continue
            payload = {"pr_number": meta["number"], "comment": comment.get("body") or "", "url": comment.get("html_url", "")}
            async with db.tx() as tx:
                await _insert_ticket(tx, venture_id=vid, type="eng.fix", department_id="engineering", agent_id="eng.builder",
                                     title=f"Address review comment on PR #{meta['number']}", body=payload["comment"],
                                     payload=payload, priority=1)
                await tx.execute("INSERT OR IGNORE INTO github_seen (venture_id, kind, external_id, seen_at) VALUES (?,?,?,?)",
                                 (vid, "pr_comment", ext, utc_now()))
            counts["pr_comments"] += 1

    async with db.tx() as tx:
        await tx.execute("INSERT INTO kv (key, value_json, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET "
                         "value_json = excluded.value_json, updated_at = excluded.updated_at",
                         (f"gh.since.{vid}", json.dumps(started), utc_now()))
    return counts


async def poll_once(app_or_state: Any, client: Any = None) -> dict[str, Any]:
    """One poll over every running venture with an active GitHub integration and a repo."""
    state = _state(app_or_state)
    db, settings = state.db, state.settings
    client = client or ComposioClient(settings)
    started = utc_now()
    totals: dict[str, Any] = {"ventures": 0, "issues": 0, "pr_comments": 0, "errors": 0}
    ventures = await db.fetch_all("SELECT * FROM ventures WHERE status = 'running' AND repo_full_name IS NOT NULL")
    for venture in ventures:
        if await github_integration(db, venture["id"]) is None:
            continue
        totals["ventures"] += 1
        try:
            counts = await _poll_venture(db, client, venture, started)
        except ComposioError as exc:
            totals["errors"] += 1
            async with db.tx() as tx:
                await bus.emit(tx, venture_id=venture["id"], type="system.warning", level="warn",
                               data={"provider": "github", "message": f"GitHub watch failed: {exc.user_message}"})
            continue
        totals["issues"] += counts["issues"]
        totals["pr_comments"] += counts["pr_comments"]
    return totals


async def _loop(app: FastAPI) -> None:
    settings = app.state.settings
    while True:
        delay = float(settings.github_poll_seconds)
        try:
            result = await poll_once(app)
            if result["errors"]:
                delay = BACKOFF_SECONDS
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("github_watch poll failed")
            delay = BACKOFF_SECONDS
        await asyncio.sleep(delay)


async def start(app: FastAPI) -> None:
    """Start polling when Composio is configured and the kernel runs live."""
    try:
        settings = app.state.settings
        if not (settings.composio_api_key and settings.composio_api_key.get_secret_value()) or settings.llm_mode != "live":
            return
        setattr(app.state, _TASK_ATTR, asyncio.create_task(_loop(app), name="github_watch"))
    except Exception:
        log.exception("github_watch did not start")


async def stop(app: FastAPI) -> None:
    """Stop polling."""
    task = getattr(app.state, _TASK_ATTR, None)
    if task is None:
        return
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError, Exception):
        await task
    setattr(app.state, _TASK_ATTR, None)
