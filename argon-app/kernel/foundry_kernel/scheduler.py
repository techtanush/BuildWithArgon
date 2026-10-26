# OWNER: tanush — seed version; replace/extend freely but keep the public signatures.

"""Durable company work, bounded dispatch and visible coordination."""
from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import FastAPI

from . import bus, gates, ledger
from .contracts import CapabilityGap, HandlerResult
from .db import json_dumps, json_loads_or
from .departments import load_handler
from .departments.coordination import RuntimeContext, post_message
from .ids import new_id, utc_now
from .models import job as get_job
from .records import (
    TICKET_DEFAULTS,
    create_ticket,
    get_row,
    serialize_artifact,
    serialize_run,
    serialize_ticket,
)
from .seed import load_roster


def _since(value: str | None, now: datetime) -> float:
    try:
        return (now - datetime.fromisoformat(value or "")).total_seconds()
    except (ValueError, TypeError):
        return 0


def ticket_job(ticket: dict, agent: dict) -> str:
    if ticket["type"].startswith("starter."):
        from .departments.starter import selected_job
        return selected_job()
    if agent.get("generated") and ticket["type"] != "chat.reply":
        return "dept_artifact"
    if ticket["type"] == "chat.reply" and agent["id"] == "concierge":
        return "concierge"
    return {"agent.request": "agent_request", "cos.report": "cos_report", "cos.standup": "cos_report",
            "eng.fix": "engineering_fix", "chat.reply": "talk"}.get(ticket["type"], agent["model_job"])


class Scheduler:
    def __init__(self, app: FastAPI) -> None:
        self.app, self.db, self.settings = app, app.state.db, app.state.settings
        self.tasks: dict[str, asyncio.Task] = {}
        self.running: dict[str, dict] = {}
        self.loop_task: asyncio.Task | None = None
        self.stopping = False
        self._tick_lock = asyncio.Lock()
        self._maintenance_at = 0.0

    async def start(self) -> None:
        self.loop_task = asyncio.create_task(self._loop(), name="foundry-scheduler")

    async def stop(self) -> None:
        self.stopping = True
        if self.loop_task:
            self.loop_task.cancel()
            await asyncio.gather(self.loop_task, return_exceptions=True)
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def cancel_ticket(self, ticket_id: str) -> None:
        task = self.tasks.get(ticket_id)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def _loop(self) -> None:
        while not self.stopping:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - keep one corrupt ticket from stopping dispatch
                async with self.db.tx() as tx:
                    await bus.emit(tx, venture_id=None, type="system.warning", level="error",
                                   data={"message": f"Scheduler tick failed: {type(exc).__name__}: {exc}"})
            await asyncio.sleep(max(0.01, self.settings.scheduler_tick_seconds))

    async def tick(self) -> None:
        async with self._tick_lock:
            for tid, task in list(self.tasks.items()):
                if task.done():
                    # Surface failures outside the normal handler error boundary.
                    if not task.cancelled():
                        failure = task.exception()
                        if failure:
                            async with self.db.tx() as tx:
                                await bus.emit(tx, venture_id=self.running[tid]["venture_id"], type="system.warning", level="error",
                                    data={"ticket_id": tid, "message": f"Ticket task failed outside its handler: {type(failure).__name__}: {failure}"})
                    self.tasks.pop(tid, None)
                    self.running.pop(tid, None)
            await self._resolve_dependencies()
            if time.monotonic() >= self._maintenance_at:
                await self.maintenance()
                self._maintenance_at = time.monotonic() + 60
            ventures = await self.db.fetch_all("SELECT * FROM ventures WHERE status='running' ORDER BY created_at,id")
            for venture in ventures:
                if await ledger.over_budget(self.db, venture["id"]):
                    async with self.db.tx() as tx:
                        await ledger.ensure_spend_approval(tx, venture["id"])
                    continue
                tickets = await self.db.fetch_all("SELECT t.* FROM tickets t WHERE t.venture_id=? AND t.status='open' AND NOT EXISTS (SELECT 1 FROM ticket_deps d JOIN tickets p ON p.id=d.depends_on_id WHERE d.ticket_id=t.id AND p.status NOT IN ('done','cancelled')) ORDER BY t.priority,t.created_at,t.id", (venture["id"],))
                for ticket in tickets:
                    if len(self.tasks) >= self.settings.scheduler_concurrency:
                        return
                    payload = json_loads_or(ticket["payload_json"], {})
                    retry_at = payload.get("_retry_at")
                    if retry_at and retry_at > utc_now():
                        continue
                    pause = await self.db.fetch_one("SELECT value_json FROM kv WHERE key=?", (f"dept.paused.{venture['id']}.{ticket['department_id']}",))
                    if pause and json_loads_or(pause["value_json"], False):
                        continue
                    active = list(self.running.values())
                    if sum(t["venture_id"] == venture["id"] and t["department_id"] == ticket["department_id"] for t in active) >= 2:
                        continue
                    if any(t["venture_id"] == venture["id"] and t["assigned_agent_id"] == ticket["assigned_agent_id"] for t in active):
                        continue
                    if ticket["type"] in {"eng.build", "eng.fix"} and any(t["venture_id"] == venture["id"] and t["type"] in {"eng.build", "eng.fix"} for t in active):
                        continue
                    await self.dispatch(ticket["id"])

    async def dispatch(self, ticket_id: str) -> None:
        async with self.db.tx() as tx:
            ticket = await get_row(tx, "tickets", ticket_id)
            venture = await get_row(tx, "ventures", ticket["venture_id"])
            if ticket["status"] != "open" or venture["status"] != "running":
                return
            # Candidate reads in tick() can become stale before this transaction.
            # Recheck durable dispatch guards atomically with claiming the ticket;
            # public/manual dispatch must follow the same constraints as the loop.
            if venture["spent_usd"] >= venture["budget_usd"]:
                await ledger.ensure_spend_approval(tx, venture["id"])
                return
            dependency = await tx.fetch_one("SELECT d.depends_on_id FROM ticket_deps d JOIN tickets p ON p.id=d.depends_on_id WHERE d.ticket_id=? AND p.status NOT IN ('done','cancelled') LIMIT 1", (ticket_id,))
            payload = json_loads_or(ticket["payload_json"], {})
            retry_at = payload.get("_retry_at")
            if dependency or (retry_at and retry_at > utc_now()):
                return
            pause = await tx.fetch_one("SELECT value_json FROM kv WHERE key=?", (f"dept.paused.{venture['id']}.{ticket['department_id']}",))
            if pause and json_loads_or(pause["value_json"], False):
                return
            active = await tx.fetch_all("SELECT venture_id,department_id,assigned_agent_id,type FROM tickets WHERE status='in_progress'")
            if len(active) >= self.settings.scheduler_concurrency:
                return
            own = [row for row in active if row["venture_id"] == venture["id"]]
            if sum(row["department_id"] == ticket["department_id"] for row in own) >= 2:
                return
            if any(row["assigned_agent_id"] == ticket["assigned_agent_id"] for row in own):
                return
            if ticket["type"] in {"eng.build", "eng.fix"} and any(row["type"] in {"eng.build", "eng.fix"} for row in own):
                return
            agent = await get_row(tx, "agents", ticket["assigned_agent_id"])
            run_id, now = new_id("run"), utc_now()
            name = ticket_job(ticket, agent)
            await tx.execute("UPDATE tickets SET status='in_progress',attempts=attempts+1,started_at=?,completed_at=NULL,updated_at=? WHERE id=?", (now, now, ticket_id))
            await tx.execute("INSERT INTO runs(id,venture_id,ticket_id,agent_id,kind,job,model,status,created_at,started_at) VALUES(?,?,?,?,'ticket',?,?,'running',?,?)",
                             (run_id, venture["id"], ticket_id, agent["id"], name, "none (deterministic)" if ticket["type"] in {"starter.build", "starter.qa", "starter.review"} or (ticket["type"] == "starter.plan" and json_loads_or(ticket["payload_json"], {}).get("scenario") == "ai_tutor_demo") else get_job(name).model, now, now))
            await self._agent_state(tx, ticket, "working", ticket_id)
            ticket = await get_row(tx, "tickets", ticket_id)
            await self._ticket_event(tx, ticket)
            await self._run_event(tx, run_id, "run.started")
            await self._post_if_channel(tx, ticket, f"dept-{ticket['department_id']}", f"Starting: {ticket['title']}", agent["id"], "status")
        self.running[ticket_id] = ticket
        task = asyncio.create_task(self.execute(ticket, venture, agent, run_id), name=f"ticket:{ticket_id}")
        self.tasks[ticket_id] = task

    async def execute(self, ticket: dict, venture: dict, agent: dict, run_id: str) -> None:
        ctx = RuntimeContext(db=self.db, llm=self.app.state.llm, settings=self.settings, venture=venture,
                             agent=agent, run_id=run_id, ticket=ticket)
        try:
            gap = await self._capability_gap(ticket)
            if gap:
                result = HandlerResult(outcome="blocked", note=gap.description, capability_gap=gap)
            else:
                timeout = self.settings.eng_ticket_timeout_seconds if ticket["type"] in {"eng.build", "eng.fix"} else self.settings.ticket_timeout_seconds
                async with asyncio.timeout(timeout):
                    # Ticket semantics remain authoritative: a generated engineer must still
                    # build and test through the engineering executor, never finish as a doc.
                    result = await load_handler(ticket["type"]).handle(ticket, ctx)
                result = HandlerResult.model_validate(result)
            await self.apply_result(ticket, run_id, result)
        except asyncio.CancelledError:
            async with self.db.tx() as tx:
                current = await get_row(tx, "tickets", ticket["id"])
                if current["status"] == "in_progress":
                    status = "open" if self.stopping else "cancelled"
                    await tx.execute("UPDATE tickets SET status=?,updated_at=? WHERE id=?", (status, utc_now(), ticket["id"]))
                    await self._ticket_event(tx, await get_row(tx, "tickets", ticket["id"]))
                await tx.execute("UPDATE runs SET status=?,error=?,completed_at=? WHERE id=? AND status IN ('running','queued')",
                    ("failed" if self.stopping else "cancelled", "kernel stopped" if self.stopping else "ticket cancelled", utc_now(), run_id))
                await self._agent_state(tx, ticket, "idle", None)
                await self._run_event(tx, run_id, "run.finished")
            raise
        except Exception as exc:  # noqa: BLE001 - handler failures are durable, retryable work
            await ctx.log("error", f"{type(exc).__name__}: {exc}")
            await self.apply_result(ticket, run_id, HandlerResult(outcome="failed", note=f"{type(exc).__name__}: {exc}"))
        finally:
            self.db._llm_tracking_locks.pop(run_id, None) if hasattr(self.db, "_llm_tracking_locks") else None

    async def _capability_gap(self, ticket: dict) -> CapabilityGap | None:
        payload = json_loads_or(ticket["payload_json"], {})
        needed = payload.get("requires_capability")
        if not needed:
            return None
        existing = set(payload.get("granted_capabilities", []))
        for agent in load_roster()["agents"]:
            if agent["department_id"] == ticket["department_id"]:
                existing.update(agent.get("capabilities", []))
        generated = await self.db.fetch_all("SELECT id FROM agents WHERE venture_id=? AND department_id=? AND generated=1", (ticket["venture_id"], ticket["department_id"]))
        for agent in generated:
            design = await self.db.fetch_one("SELECT value_json FROM kv WHERE key=?", (f"agent.design.{agent['id']}",))
            if design:
                existing.update(json_loads_or(design["value_json"], {}).get("capabilities", []))
        return None if needed in existing else CapabilityGap(capability=needed, description=f"{ticket['title']} requires {needed}, which this department does not have yet")

    async def _ticket_event(self, tx: Any, ticket: dict) -> None:
        await bus.emit(tx, venture_id=ticket["venture_id"], type="ticket.updated", entity_kind="ticket", entity_id=ticket["id"], data=await serialize_ticket(tx, ticket))

    async def _run_event(self, tx: Any, run_id: str, type: str) -> None:
        row = await get_row(tx, "runs", run_id)
        data = serialize_run(row)
        data.pop("output_text", None)
        await bus.emit(tx, venture_id=row["venture_id"], type=type, entity_kind="run", entity_id=run_id, data=data)

    async def _agent_state(self, tx: Any, ticket: dict, status: str, current_ticket_id: str | None) -> None:
        previous = await tx.fetch_one("SELECT current_ticket_id FROM agent_state WHERE venture_id=? AND agent_id=?", (ticket["venture_id"], ticket["assigned_agent_id"]))
        if status != "working" and previous and previous["current_ticket_id"] not in (None, ticket["id"]):
            return
        if status == "idle":
            pending = await tx.fetch_one("SELECT id,status FROM tickets WHERE venture_id=? AND assigned_agent_id=? AND id<>? AND status IN ('waiting_approval','blocked') ORDER BY CASE status WHEN 'waiting_approval' THEN 0 ELSE 1 END,updated_at DESC LIMIT 1",
                (ticket["venture_id"], ticket["assigned_agent_id"], ticket["id"]))
            if pending:
                status, current_ticket_id = ("waiting" if pending["status"] == "waiting_approval" else "blocked"), pending["id"]
        await tx.execute("INSERT INTO agent_state(venture_id,agent_id,status,current_ticket_id,last_active_at) VALUES(?,?,?,?,?) ON CONFLICT(venture_id,agent_id) DO UPDATE SET status=excluded.status,current_ticket_id=excluded.current_ticket_id,last_active_at=excluded.last_active_at",
            (ticket["venture_id"], ticket["assigned_agent_id"], status, current_ticket_id, utc_now()))
        await bus.emit(tx, venture_id=ticket["venture_id"], type="agent.status", entity_kind="agent", entity_id=ticket["assigned_agent_id"],
                       data={"agent_id": ticket["assigned_agent_id"], "status": status, "current_ticket_id": current_ticket_id})

    async def _post_if_channel(self, tx: Any, ticket: dict, channel: str, body: str, author: str, kind: str, refs: list[dict] | None = None, thread_root_id: str | None = None) -> None:
        if await tx.fetch_one("SELECT id FROM channels WHERE venture_id=? AND slug=?", (ticket["venture_id"], channel)):
            await post_message(tx, venture_id=ticket["venture_id"], channel_slug=channel, body=body, author_id=author,
                author_kind="system" if author == "system" else "agent", kind=kind, refs=refs or [{"kind": "ticket", "id": ticket["id"]}], thread_root_id=thread_root_id)

    async def _children(self, tx: Any, parent: dict, result: HandlerResult) -> list[str]:
        refs = [t.ref for t in result.new_tickets if t.ref]
        if len(refs) != len(set(refs)):
            raise ValueError("New ticket refs must be unique")
        reports = await tx.fetch_all("WITH RECURSIVE downstream(id) AS (SELECT ticket_id FROM ticket_deps WHERE depends_on_id=? UNION SELECT d.ticket_id FROM ticket_deps d JOIN downstream p ON d.depends_on_id=p.id) SELECT t.id FROM tickets t JOIN downstream d ON d.id=t.id WHERE t.type='cos.report' AND t.status IN ('open','blocked')", (parent["id"],))
        ids, ref_ids = [], {}
        lead = await tx.fetch_one("SELECT * FROM agents WHERE department_id=? AND is_lead=1 AND venture_id IS NULL ORDER BY id LIMIT 1", (parent["department_id"],))
        creator = await get_row(tx, "agents", parent["assigned_agent_id"])
        for child in result.new_tickets:
            if isinstance(child.priority, bool) or not 0 <= child.priority <= 3:
                raise ValueError("Ticket priority must be between zero and three")
            dept = TICKET_DEFAULTS.get(child.type, (None, None))[0]
            if child.type == "agent.request":
                dept = child.payload.get("department_id") or child.payload.get("target_department")
            if child.type == "chat.reply" and child.assigned_agent_id:
                dept = (await get_row(tx, "agents", child.assigned_agent_id))["department_id"]
            if not dept:
                raise ValueError(f"No department for {child.type}")
            exceptions = {("brief", "review.skeptic"), ("review.skeptic", "spec.write"), ("spec.write", "plan.request"),
                ("decision.review", "brief"), ("capability.gap", "people.hire"), ("eng.review", "eng.fix"),
                ("qa.verify", "eng.fix"), ("support.issue", "eng.fix")}
            if parent["department_id"] != "chief-of-staff" and (dept != parent["department_id"] or not creator["is_lead"]) and (parent["type"], child.type) not in exceptions:
                raise ValueError("Agents may delegate internally through a lead or use agent.request across departments")
            row = await create_ticket(tx, venture_id=parent["venture_id"], type=child.type, department_id=dept,
                title=child.title, body=child.body, payload=child.payload, assigned_agent_id=child.assigned_agent_id,
                priority=child.priority, created_by=creator["id"])
            await tx.execute("UPDATE tickets SET parent_ticket_id=?,generation=? WHERE id=?", (parent["id"], child.payload.get("generation", parent["generation"] + (1 if parent["type"] == "decision.review" and child.type == "brief" else 0)), row["id"]))
            ids.append(row["id"])
            if child.ref:
                ref_ids[child.ref] = row["id"]
            if lead and child.assigned_agent_id != lead["id"] and dept == parent["department_id"]:
                target = await get_row(tx, "agents", row["assigned_agent_id"])
                await self._post_if_channel(tx, parent, f"dept-{dept}", f"@{target['display_name']} {child.title} ({row['id']})", lead["id"], "delegation", [{"kind": "ticket", "id": row["id"]}])
        for child, child_id in zip(result.new_tickets, ids):
            for dependency in child.depends_on:
                dep_id = ref_ids.get(dependency[4:]) if dependency.startswith("ref:") else dependency
                if not dep_id:
                    raise ValueError(f"Unresolved dependency: {dependency}")
                dependency_row = await get_row(tx, "tickets", dep_id)
                if dependency_row["venture_id"] != parent["venture_id"] or dep_id == child_id:
                    raise ValueError("Dependencies must be distinct tickets in the same venture")
                await tx.execute("INSERT OR IGNORE INTO ticket_deps VALUES(?,?)", (child_id, dep_id))
            await self._ticket_event(tx, await get_row(tx, "tickets", child_id))
        for report in reports:
            for child_id in ids:
                if child_id != report["id"]:
                    await tx.execute("INSERT OR IGNORE INTO ticket_deps VALUES(?,?)", (report["id"], child_id))
            await self._ticket_event(tx, await get_row(tx, "tickets", report["id"]))
        # Include dynamically extended report edges in cycle validation.
        for identifier in ids + [report["id"] for report in reports]:
            cycle = await tx.fetch_one("WITH RECURSIVE ancestors(id) AS (SELECT depends_on_id FROM ticket_deps WHERE ticket_id=? UNION SELECT d.depends_on_id FROM ticket_deps d JOIN ancestors a ON d.ticket_id=a.id) SELECT id FROM ancestors WHERE id=?", (identifier, identifier))
            if cycle:
                raise ValueError("New tickets form a dependency cycle")
        return ids

    async def apply_result(self, ticket: dict, run_id: str, result: HandlerResult) -> None:
        async with self.db.tx() as tx:
            current = await get_row(tx, "tickets", ticket["id"])
            if current["status"] != "in_progress":
                await tx.execute("UPDATE runs SET status='cancelled',completed_at=? WHERE id=? AND status='running'", (utc_now(), run_id))
                await self._agent_state(tx, ticket, "idle", None)
                await self._run_event(tx, run_id, "run.finished")
                return
            payload = json_loads_or(current["payload_json"], {})
            status, finished = result.outcome, None
            if result.capability_gap and result.outcome != "blocked":
                raise ValueError("A capability gap requires a blocked outcome")
            if result.approval and result.outcome != "waiting_approval":
                raise ValueError("A new approval requires a waiting_approval outcome")
            existing_gate = result.result.get("waiting_existing_approval")
            if existing_gate:
                approval = await get_row(tx, "approvals", existing_gate)
                if approval["venture_id"] != current["venture_id"] or approval["ticket_id"] != current["id"] or approval["status"] not in {"pending", "approved", "rejected"}:
                    raise ValueError("An existing gate must belong to this ticket and venture")
                if approval["status"] == "pending":
                    status = "waiting_approval"
                else:
                    # The founder may decide while run_task is returning its wait result.
                    status = "open"
                    payload["_approval"] = {"approval_id": approval["id"], "status": approval["status"], "note": approval["decision_note"] or "", "answers": {}}
            if status == "waiting_approval" and result.approval is None and not existing_gate:
                raise ValueError("waiting_approval requires an approval")
            if status in {"failed", "retry"}:
                if current["attempts"] < current["max_attempts"]:
                    status = "open"
                    payload["_retry_at"] = (datetime.now(UTC) + timedelta(seconds=15 * 2 ** (current["attempts"] - 1))).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                else:
                    status, finished = "failed", utc_now()
            elif status == "done":
                finished = utc_now()
                payload.pop("_retry_at", None)
            artifact_ids = []
            if current["type"] == "decision.review" and result.result.get("verdict") == "revise" and result.result.get("supersedes_generation") is not None:
                old = await tx.fetch_all("SELECT * FROM tickets WHERE venture_id=? AND generation=? AND id<>? AND status IN ('open','blocked','waiting_approval')", (current["venture_id"], result.result["supersedes_generation"], current["id"]))
                for obsolete in old:
                    await tx.execute("UPDATE tickets SET status='cancelled',completed_at=?,updated_at=? WHERE id=?", (utc_now(), utc_now(), obsolete["id"]))
                    await self._ticket_event(tx, await get_row(tx, "tickets", obsolete["id"]))
                    await self._agent_state(tx, obsolete, "idle", None)
            for artifact in result.artifacts:
                aid = new_id("art")
                await tx.execute("INSERT INTO artifacts(id,venture_id,ticket_id,run_id,agent_id,department_id,kind,title,summary,content_md,uri,meta_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (aid, current["venture_id"], current["id"], run_id, current["assigned_agent_id"], current["department_id"], artifact.kind, artifact.title, artifact.summary, artifact.content_md, artifact.uri, json_dumps(artifact.meta), utc_now()))
                artifact_ids.append(aid)
                artifact_event = serialize_artifact(await get_row(tx, "artifacts", aid))
                artifact_event.pop("content_md", None)
                await bus.emit(tx, venture_id=current["venture_id"], type="artifact.created", entity_kind="artifact", entity_id=aid, data=artifact_event)
            child_ids = await self._children(tx, current, result)
            if current["type"] == "agent.request" and result.outcome == "done" and child_ids:
                status, finished = "blocked", None
                payload["_awaiting_children"] = child_ids
                for child_id in child_ids:
                    await tx.execute("INSERT OR IGNORE INTO ticket_deps VALUES(?,?)", (current["id"], child_id))
                cycle = await tx.fetch_one("WITH RECURSIVE ancestors(id) AS (SELECT depends_on_id FROM ticket_deps WHERE ticket_id=? UNION SELECT d.depends_on_id FROM ticket_deps d JOIN ancestors a ON d.ticket_id=a.id) SELECT id FROM ancestors WHERE id=?", (current["id"], current["id"]))
                if cycle:
                    raise ValueError("Delegated request children form a dependency cycle")
            if result.capability_gap:
                gap = result.capability_gap
                pending = await tx.fetch_one("SELECT id FROM tickets WHERE venture_id=? AND type='capability.gap' AND parent_ticket_id=? AND status NOT IN ('done','failed','cancelled')", (current["venture_id"], current["id"]))
                if not pending:
                    gap_ticket = await create_ticket(tx, venture_id=current["venture_id"], type="capability.gap", department_id="chief-of-staff",
                        title=f"Add capability: {gap.capability}", body=gap.description, payload={"capability": gap.capability, "description": gap.description,
                        "blocked_ticket_id": current["id"], "blocked_department": current["department_id"]}, created_by="system")
                    await tx.execute("UPDATE tickets SET parent_ticket_id=? WHERE id=?", (current["id"], gap_ticket["id"]))
            if result.approval:
                approval = result.approval
                pending_spend = await tx.fetch_one("SELECT * FROM approvals WHERE venture_id=? AND gate_type='spend' AND status='pending' AND COALESCE(json_extract(payload_json,'$.purpose'),'')<>'treasury_payment' ORDER BY created_at LIMIT 1", (current["venture_id"],)) if approval.gate_type == "spend" else None
                if pending_spend:
                    existing_payload = json_loads_or(pending_spend["payload_json"], {})
                    amount = max(existing_payload.get("requested_increase_usd", 0), approval.payload.get("requested_increase_usd", 0))
                    merged_payload = {**existing_payload, **approval.payload, "requested_increase_usd": amount}
                    await tx.execute("UPDATE approvals SET payload_json=?,ticket_id=COALESCE(ticket_id,?),run_id=COALESCE(run_id,?) WHERE id=?", (json_dumps(merged_payload), current["id"], run_id, pending_spend["id"]))
                    payload["_waiting_spend_approval_id"] = pending_spend["id"]
                else:
                    await gates.request_approval(tx, venture_id=current["venture_id"], gate_type=approval.gate_type,
                        title=approval.title, summary=approval.summary, payload=approval.payload, ticket_id=current["id"], run_id=run_id,
                        requested_by_agent_id="oh.clarifier" if current["type"] == "review.skeptic" and approval.gate_type == "clarification" else current["assigned_agent_id"])
            await tx.execute("UPDATE tickets SET status=?,result_json=?,payload_json=?,updated_at=?,completed_at=? WHERE id=?",
                (status, json_dumps({**result.result, "note": result.note}), json_dumps(payload), utc_now(), finished, current["id"]))
            if status == "done" and current["type"] == "cos.standup":
                await tx.execute("INSERT INTO kv VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
                    (f"standup.last.{current['venture_id']}", json_dumps(utc_now()), utc_now()))
            run_status = "failed" if result.outcome in {"failed", "retry"} else "succeeded"
            await tx.execute("UPDATE runs SET status=?,error=?,completed_at=? WHERE id=?", (run_status, result.note if run_status == "failed" else None, utc_now(), run_id))
            state = "waiting" if status == "waiting_approval" else "blocked" if status == "blocked" else "idle"
            await self._agent_state(tx, current, state, current["id"] if state in {"waiting", "blocked"} else None)
            await self._ticket_event(tx, await get_row(tx, "tickets", current["id"]))
            await self._run_event(tx, run_id, "run.finished")
            for message in result.messages:
                await self._post_if_channel(tx, current, message.channel_slug, message.body, current["assigned_agent_id"], message.kind,
                    message.refs or [{"kind": "artifact", "id": aid} for aid in artifact_ids] or [{"kind": "ticket", "id": current["id"]}], message.thread_root_id)
            if status == "done" and not any(m.channel_slug == f"dept-{current['department_id']}" and m.kind == "status" for m in result.messages):
                await self._post_if_channel(tx, current, f"dept-{current['department_id']}", (result.note or (result.artifacts[0].summary if result.artifacts else "") or f"Done: {current['title']}")[:280], current["assigned_agent_id"], "status")
            if status == "done" and artifact_ids:
                await self._handoffs(tx, current, artifact_ids)
            if status == "failed":
                await self._post_if_channel(tx, current, "incidents", f"{current['title']} failed after {current['attempts']} attempts: {result.note.splitlines()[0] if result.note else 'no error supplied'}", "system", "incident")
                await self._pause_failed_department(tx, current)

    async def _handoffs(self, tx: Any, ticket: dict, artifacts: list[str]) -> None:
        receivers = await tx.fetch_all("SELECT DISTINCT t.department_id FROM tickets t JOIN ticket_deps d ON d.ticket_id=t.id WHERE d.depends_on_id=? AND t.department_id<>? AND t.status='open'", (ticket["id"], ticket["department_id"]))
        producer = await tx.fetch_one("SELECT id FROM agents WHERE department_id=? AND is_lead=1 AND venture_id IS NULL ORDER BY id LIMIT 1", (ticket["department_id"],))
        artifact = await get_row(tx, "artifacts", artifacts[0])
        for receiver in receivers:
            lead = await tx.fetch_one("SELECT display_name FROM agents WHERE department_id=? AND is_lead=1 AND venture_id IS NULL ORDER BY id LIMIT 1", (receiver["department_id"],))
            if lead:
                await self._post_if_channel(tx, ticket, f"dept-{receiver['department_id']}", f"@{lead['display_name']} {artifact['title']} is ready ({artifacts[0]}). Dependent work can start when its other dependencies finish.", producer["id"] if producer else ticket["assigned_agent_id"], "handoff", [{"kind": "artifact", "id": aid} for aid in artifacts])

    async def _pause_failed_department(self, tx: Any, ticket: dict) -> None:
        since = (datetime.now(UTC) - timedelta(minutes=30)).isoformat().replace("+00:00", "Z")
        failures = await tx.fetch_one("SELECT COUNT(*) AS n FROM tickets WHERE venture_id=? AND department_id=? AND status='failed' AND completed_at>=?", (ticket["venture_id"], ticket["department_id"], since))
        marker = f"dept.paused.{ticket['venture_id']}.{ticket['department_id']}"
        paused = await tx.fetch_one("SELECT value_json FROM kv WHERE key=?", (marker,))
        if failures["n"] >= 3 and not (paused and json_loads_or(paused["value_json"], False)):
            await tx.execute("INSERT INTO kv VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at", (marker, "true", utc_now()))
            await self._post_if_channel(tx, ticket, "incidents", f"{ticket['department_id']} paused after three failures in 30 minutes. @Rhea please review.", "system", "incident")
            await create_ticket(tx, venture_id=ticket["venture_id"], type="cos.report", department_id="chief-of-staff", title=f"Incident: {ticket['department_id']}", payload={"incident": True, "department_id": ticket["department_id"]}, created_by="system")

    async def _resolve_dependencies(self) -> None:
        async with self.db.tx() as tx:
            candidates = await tx.fetch_all("SELECT * FROM tickets WHERE status IN ('open','blocked','waiting_approval') ORDER BY created_at,id")
            for ticket in candidates:
                payload = json_loads_or(ticket["payload_json"], {})
                if ticket["status"] == "waiting_approval":
                    shared_gate = payload.get("_waiting_spend_approval_id")
                    approval = await tx.fetch_one("SELECT * FROM approvals WHERE id=?", (shared_gate,)) if shared_gate else None
                    if approval and approval["status"] in {"approved", "rejected"}:
                        payload.pop("_waiting_spend_approval_id", None)
                        payload["_approval"] = {"approval_id": approval["id"], "status": approval["status"], "note": approval["decision_note"] or "", "answers": {}}
                        await tx.execute("UPDATE tickets SET status='open',payload_json=?,updated_at=? WHERE id=?", (json_dumps(payload), utc_now(), ticket["id"]))
                        await self._ticket_event(tx, await get_row(tx, "tickets", ticket["id"]))
                    continue
                deps = await tx.fetch_all("SELECT t.* FROM tickets t JOIN ticket_deps d ON d.depends_on_id=t.id WHERE d.ticket_id=?", (ticket["id"],))
                failed = any(d["status"] == "failed" for d in deps)
                waiting_children = payload.get("_awaiting_children")
                if waiting_children and deps and all(d["status"] in {"done", "failed", "cancelled"} for d in deps):
                    payload.pop("_awaiting_children", None)
                    payload["_children_completed"] = True
                    # Re-enter the lead so failed children become an honest partial answer.
                    # The temporary wait edges must not prevent that summary from running.
                    for child_id in waiting_children:
                        await tx.execute("DELETE FROM ticket_deps WHERE ticket_id=? AND depends_on_id=?", (ticket["id"], child_id))
                    await tx.execute("UPDATE tickets SET status='open',payload_json=?,completed_at=NULL,updated_at=? WHERE id=?", (json_dumps(payload), utc_now(), ticket["id"]))
                    await self._agent_state(tx, ticket, "idle", None)
                    await self._ticket_event(tx, await get_row(tx, "tickets", ticket["id"]))
                elif failed and ticket["status"] == "open":
                    payload["_blocked_by_dependency"] = True
                    await tx.execute("UPDATE tickets SET status='blocked',payload_json=?,updated_at=? WHERE id=?", (json_dumps(payload), utc_now(), ticket["id"]))
                    await self._ticket_event(tx, await get_row(tx, "tickets", ticket["id"]))
                elif ticket["status"] == "blocked" and payload.get("_blocked_by_dependency") and not failed:
                    payload.pop("_blocked_by_dependency", None)
                    await tx.execute("UPDATE tickets SET status='open',payload_json=?,updated_at=? WHERE id=?", (json_dumps(payload), utc_now(), ticket["id"]))
                    await self._ticket_event(tx, await get_row(tx, "tickets", ticket["id"]))

    async def maintenance(self, now: datetime | None = None) -> None:
        now = now or datetime.now(UTC)
        async with self.db.tx() as tx:
            ventures = await tx.fetch_all("SELECT * FROM ventures WHERE status='running'")
            for venture in ventures:
                tickets = await tx.fetch_all("SELECT * FROM tickets WHERE venture_id=?", (venture["id"],))
                blockers = []
                for ticket in tickets:
                    age = _since(ticket["updated_at"], now)
                    ready_stale = False
                    if ticket["status"] == "open" and age > 600:
                        pending = await tx.fetch_one("SELECT 1 FROM ticket_deps d JOIN tickets p ON p.id=d.depends_on_id WHERE d.ticket_id=? AND p.status NOT IN ('done','cancelled') LIMIT 1", (ticket["id"],))
                        ready_stale = pending is None
                    if ready_stale or ticket["status"] == "waiting_approval" and age > 1800 or ticket["status"] == "blocked" and age > self.settings.escalate_minutes * 60:
                        blockers.append({"ticket_id": ticket["id"], "title": ticket["title"], "status": ticket["status"]})
                    if ticket["status"] == "blocked" and age > self.settings.escalate_minutes * 60:
                        marker = f"escalated.{ticket['id']}"
                        if not await tx.fetch_one("SELECT key FROM kv WHERE key=?", (marker,)):
                            await tx.execute("INSERT INTO kv VALUES(?,?,?)", (marker, "true", utc_now()))
                            await self._post_if_channel(tx, ticket, "exec", f"@Rhea {ticket['department_id']} is blocked on {ticket['title']} for {int(age // 60)} min.", "system", "incident")
                await tx.execute("INSERT INTO kv VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at", (f"standup.blockers.{venture['id']}", json_dumps(blockers), utc_now()))
                last = await tx.fetch_one("SELECT value_json FROM kv WHERE key=?", (f"standup.last.{venture['id']}",))
                last_at = json_loads_or(last["value_json"], None) if last else venture["created_at"]
                latest = max((t["updated_at"] for t in tickets if t["type"] != "cos.standup"), default=last_at)
                pending_standup = any(t["type"] == "cos.standup" and t["status"] in {"open", "in_progress"} for t in tickets)
                if _since(last_at, now) >= self.settings.standup_minutes * 60 and latest > last_at and not pending_standup:
                    await create_ticket(tx, venture_id=venture["id"], type="cos.standup", department_id="chief-of-staff", title=f"Standup {now.strftime('%H:%M')}", created_by="system")
                    await tx.execute("INSERT INTO kv VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at", (f"standup.last.{venture['id']}", json_dumps(now.isoformat().replace("+00:00", "Z")), utc_now()))

async def start(app: FastAPI) -> None:
    app.state.scheduler = Scheduler(app)
    await app.state.scheduler.start()


async def stop(app: FastAPI) -> None:
    scheduler = getattr(app.state, "scheduler", None)
    if scheduler:
        await scheduler.stop()
