# OWNER: tanush
"""Database-to-wire conversion and transactional API record helpers."""
from __future__ import annotations

import base64
import json
from functools import lru_cache
from typing import Any

from . import bus
from .config import KERNEL_DIR
from .contracts import AgentRuntime, AgentRuntimeJob
from .errors import KernelError, NotFoundError
from .ids import new_id, utc_now
from .models import job
from .security import redact

# Taxonomy in 01-architecture/05-event-bus-and-orchestration.md. Dynamic
# chat.reply and agent.request select their target agent separately.
TICKET_DEFAULTS = {
    "brief": ("intake", "intake.brief-lead"),
    "review.skeptic": ("office-hours", "oh.skeptic"),
    "spec.write": ("intake", "intake.spec-writer"),
    "plan.request": ("chief-of-staff", "cos.orchestrator"),
    "research.market": ("market-research", "mr.research-lead"),
    "research.competitors": ("market-research", "mr.competitor-analyst"),
    "validation.synthetic_panel": ("synthetic-population", "sp.panel-analyst"),
    "validation.interview_plan": ("outreach", "out.interview-designer"),
    "decision.review": ("pivot", "pv.decision-analyst"),
    "starter.plan": ("engineering", "eng.tech-lead"),
    "starter.build": ("engineering", "eng.builder"),
    "starter.qa": ("engineering", "eng.qa"),
    "starter.review": ("engineering", "eng.reviewer"),
    "eng.design": ("engineering", "eng.tech-lead"),
    "eng.build": ("engineering", "eng.builder"),
    "eng.fix": ("engineering", "eng.builder"),
    "eng.review": ("engineering", "eng.reviewer"),
    "qa.verify": ("engineering", "eng.qa"),
    "growth.positioning": ("growth", "gr.positioning-lead"),
    "growth.launch_plan": ("growth", "gr.growth-planner"),
    "leads.icp": ("lead-intel", "li.lead-researcher"),
    "sales.proposal": ("sales", "sa.proposal-writer"),
    "finance.budget": ("finance-people", "fp.cfo"),
    "wallet.pay": ("finance-people", "fp.cfo"),
    "people.hire": ("finance-people", "fp.people-ops"),
    "support.issue": ("support", "su.triager"),
    "capability.gap": ("chief-of-staff", "cos.improvement"),
    "cos.report": ("chief-of-staff", "cos.orchestrator"),
    "cos.standup": ("chief-of-staff", "cos.orchestrator"),
}
TABLES = frozenset({"ventures", "tickets", "runs", "artifacts", "approvals", "agents", "departments", "channels", "messages", "files"})


def json_loads(value: Any, default: Any) -> Any:
    if value is None:
        return default
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default


def clean(value: Any, settings: Any) -> Any:
    if isinstance(value, str):
        return redact(value, settings)
    if isinstance(value, dict):
        return {redact(str(k), settings): clean(v, settings) for k, v in value.items()}
    if isinstance(value, list):
        return [clean(v, settings) for v in value]
    return value


async def get_row(db: Any, table: str, identifier: str) -> dict:
    if table not in TABLES:
        raise ValueError("unsupported record table")
    row = await db.fetch_one(f"SELECT * FROM {table} WHERE id=?", (identifier,))
    if row is None:
        raise NotFoundError(table.rstrip("s"), identifier)
    return row


def select_fields(row: dict, names: str) -> dict:
    return {key: row.get(key) for key in names.split()}


def serialize_venture(row: dict) -> dict:
    return select_fields(row, "id name slug idea founder_name status budget_usd spent_usd repo_full_name repo_url created_at updated_at")


async def serialize_ticket(db: Any, row: dict) -> dict:
    result = select_fields(row, "id type department_id assigned_agent_id title body status priority parent_ticket_id generation attempts max_attempts created_by created_at updated_at completed_at")
    result.update(payload=json_loads(row.get("payload_json"), {}), result=json_loads(row.get("result_json"), None),
                  depends_on=[r["depends_on_id"] for r in await db.fetch_all("SELECT depends_on_id FROM ticket_deps WHERE ticket_id=? ORDER BY depends_on_id", (row["id"],))])
    return result


def serialize_run(row: dict) -> dict:
    return select_fields(row, "id ticket_id agent_id kind job model status tokens_in tokens_out cost_usd interaction_id created_at started_at completed_at output_text error")


def serialize_artifact(row: dict) -> dict:
    result = select_fields(row, "id kind title summary content_md uri department_id agent_id ticket_id created_at")
    result["meta"] = json_loads(row.get("meta_json"), {})
    return result


def serialize_approval(row: dict) -> dict:
    result = select_fields(row, "id gate_type status title summary requested_by_agent_id ticket_id created_at decided_at decided_by decision_note")
    result["payload"] = json_loads(row.get("payload_json"), {})
    return result


def serialize_message(row: dict) -> dict:
    result = select_fields(row, "id channel_id author_kind author_id body thread_root_id created_at")
    result.update(refs=json_loads(row.get("refs_json"), []), kind=json_loads(row.get("meta_json"), {}).get("kind", "status"), reply_count=row.get("reply_count", 0))
    return result


def serialize_event(row: dict) -> dict:
    result = select_fields(row, "id type entity_kind entity_id level created_at")
    result["data"] = json_loads(row.get("data_json"), {})
    return result


@lru_cache(maxsize=1)
def capability_matrix() -> dict:
    """The frozen matrix is authoritative for every roster agent."""
    return json.loads((KERNEL_DIR / "data" / "agent_capabilities.json").read_text())


def serialize_runtime(row: dict) -> dict:
    capability = capability_matrix()["agents"].get(row["id"])
    if capability is None:
        # Approved hires use the safe default job and only their approved tools.
        capability = {"work_jobs": ["dept_artifact"], "conversation_jobs": ["talk", "check_citation"],
                      "coordination_jobs": [], "managed_agents": [],
                      "tools": json_loads(row.get("tools_json"), []), "gates": [], "voice_call": True}
    jobs = []
    for purpose in ("work", "conversation", "coordination"):
        for name in capability[f"{purpose}_jobs"]:
            routed = job(name)
            jobs.append(AgentRuntimeJob(job=name, model=routed.model, thinking_level=routed.thinking_level, purpose=purpose))
    return AgentRuntime(jobs=jobs, managed_agents=capability["managed_agents"], tools=capability["tools"],
                        gates=capability["gates"], voice_call=capability.get("voice_call", True)).model_dump()


async def serialize_agent(db: Any, row: dict, vid: str) -> dict:
    result = select_fields(row, "id department_id display_name title role_summary persona voice_id npc_slot")
    state = await db.fetch_one("SELECT status,current_ticket_id,last_active_at FROM agent_state WHERE venture_id=? AND agent_id=?", (vid, row["id"]))
    result.update(model=job(row["model_job"]).model, tools=json_loads(row.get("tools_json"), []),
                  portrait_url=row.get("portrait_path"), face=json_loads(row.get("face_json"), None), is_lead=bool(row["is_lead"]),
                  state=state or {"status": "idle", "current_ticket_id": None, "last_active_at": None})
    result["runtime"] = serialize_runtime(row)
    return result


async def serialize_department(db: Any, row: dict, vid: str) -> dict:
    result = select_fields(row, "id code name mission building_id building_name")
    counts = {key: 0 for key in ("open", "in_progress", "waiting_approval", "done", "failed")}
    for count in await db.fetch_all("SELECT status,COUNT(*) AS n FROM tickets WHERE venture_id=? AND department_id=? GROUP BY status", (vid, row["id"])):
        if count["status"] in counts:
            counts[count["status"]] = count["n"]
    result["counts"] = counts
    result["agents"] = [r["id"] for r in await db.fetch_all("SELECT id FROM agents WHERE department_id=? AND (venture_id IS NULL OR venture_id=?) ORDER BY id", (row["id"], vid))]
    paused = await db.fetch_one("SELECT value_json FROM kv WHERE key=?", (f"dept.paused.{vid}.{row['id']}",))
    result["paused"] = json_loads(paused["value_json"], False) is True if paused else False
    return result


def cursor_clause(cursor: str | None, *, ascending: bool = False) -> tuple[str, list]:
    if not cursor:
        return "", []
    try:
        created_at, identifier = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        if not isinstance(created_at, str) or not isinstance(identifier, str):
            raise TypeError
    except Exception as exc:
        raise KernelError(400, "invalid_cursor", "The pagination cursor is invalid") from exc
    op = ">" if ascending else "<"
    return f" AND (created_at {op} ? OR (created_at=? AND id {op} ?))", [created_at, created_at, identifier]


def page_rows(rows: list[dict], limit: int) -> tuple[list[dict], str | None]:
    more = len(rows) > limit
    selected = rows[:limit]
    cursor = None
    if more and selected:
        cursor = base64.urlsafe_b64encode(json.dumps([selected[-1]["created_at"], selected[-1]["id"]]).encode()).decode()
    return selected, cursor


async def list_rows(db: Any, table: str, *, venture_id: str, limit: int = 50, cursor: str | None = None, filters: dict | None = None) -> tuple[list[dict], str | None]:
    if table not in TABLES:
        raise ValueError("unsupported record table")
    sql, params = f"SELECT * FROM {table} WHERE venture_id=?", [venture_id]
    for key, value in (filters or {}).items():
        if key not in {"status", "department_id", "type", "agent_id", "ticket_id", "kind"}:
            raise ValueError("unsupported record filter")
        if value is not None:
            sql += f" AND {key}=?"
            params.append(value)
    clause, values = cursor_clause(cursor)
    rows = await db.fetch_all(sql + clause + " ORDER BY created_at DESC,id DESC LIMIT ?", (*params, *values, limit + 1))
    return page_rows(rows, limit)


async def create_ticket(tx: Any, *, venture_id: str, type: str, department_id: str, title: str, body: str = "", payload: dict | None = None, assigned_agent_id: str | None = None, priority: int = 2, created_by: str = "human") -> dict:
    if type in TICKET_DEFAULTS:
        expected, default_agent = TICKET_DEFAULTS[type]
        if department_id != expected:
            raise KernelError(400, "invalid_department", f"{type} belongs to {expected}")
        assigned_agent_id = assigned_agent_id or default_agent
    elif type in ("chat.reply", "agent.request"):
        if not assigned_agent_id:
            lead = await tx.fetch_one("SELECT id FROM agents WHERE department_id=? AND is_lead=1 AND id!='concierge' AND (venture_id IS NULL OR venture_id=?) ORDER BY generated,id LIMIT 1", (department_id, venture_id))
            assigned_agent_id = lead["id"] if lead else None
    else:
        raise KernelError(400, "invalid_ticket_type", "Unknown ticket type")
    await get_row(tx, "departments", department_id)
    if not assigned_agent_id:
        raise KernelError(400, "invalid_agent", "No agent can handle this ticket")
    agent = await get_row(tx, "agents", assigned_agent_id)
    if agent["department_id"] != department_id or agent["venture_id"] not in (None, venture_id):
        raise KernelError(400, "invalid_agent", "Assigned agent must belong to the ticket department and venture")
    tid, now = new_id("tkt"), utc_now()
    await tx.execute("INSERT INTO tickets(id,venture_id,type,department_id,assigned_agent_id,title,body,payload_json,priority,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (tid, venture_id, type, department_id, assigned_agent_id, title, body, json.dumps(payload or {}), priority, created_by, now, now))
    result = await serialize_ticket(tx, await get_row(tx, "tickets", tid))
    await bus.emit(tx, venture_id=venture_id, type="ticket.created", entity_kind="ticket", entity_id=tid, data=result)
    return result
