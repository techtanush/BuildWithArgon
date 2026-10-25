# OWNER: tanush — seed version; replace/extend freely but keep the public signatures.
"""Fresh, bounded records for read-only company conversations."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from ..db import json_dumps, redact_value
from ..errors import ConflictError, NotFoundError
from ..ids import new_id, utc_now

MAX_RECORDS, MAX_CHARACTERS = 24, 30_000
MAX_RECORD_CHARACTERS = 6_000
STOPWORDS = frozenset({"what", "which", "where", "when", "with", "about", "this", "that", "have", "been", "from", "were", "your", "they", "their", "does", "there", "company", "could", "would", "please"})


@dataclass
class ContextPack:
    records: list[dict[str, str]]
    rendered: str
    venture_id: str


def keywords(question: str) -> set[str]:
    return {word for word in re.findall(r"[\w-]{4,}", question.casefold()) if word not in STOPWORDS}


def record_text(row: dict[str, Any], *, content_limit: int = 1500) -> str:
    """Use real field names/values so exact source quotations can be rechecked."""
    excluded = {"face_json", "portrait_path", "path", "input_text", "output_text", "output_json"}
    values = {key: value for key, value in row.items() if key not in excluded and value is not None}
    if "content_md" in values:
        values["content_md"] = values["content_md"][:content_limit]
    if row.get("input_text"):
        values["input_text"] = row["input_text"][:6000]
    if row.get("output_text"):
        values["output_text"] = row["output_text"][:2000]
    return "\n".join(f"{key}: {value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)}" for key, value in values.items())


async def build_context_pack(*, db: Any, venture_id: str, agent_id: str, question: str,
                             company_wide: bool = False, snapshot_run_id: str | None = None) -> ContextPack:
    records: list[dict[str, str]] = []
    rendered: list[str] = []
    seen: set[tuple[str, str]] = set()
    length = 0

    def add(kind: str, row: dict, title: str | None = None, text: str | None = None) -> None:
        nonlocal length
        identifier = str(row["id"])
        if (kind, identifier) in seen or len(records) >= MAX_RECORDS:
            return
        ref = f"R{len(records) + 1}"
        title = str(title or row.get("title") or row.get("name") or row.get("display_name") or kind.title())[:180]
        header = f'[{ref}] kind={kind} id={identifier} title={json.dumps(title)} created={row.get("created_at", "")}\n'
        available = MAX_CHARACTERS - length - len(header) - (2 if rendered else 0)
        if available < 100:
            return
        text = str(redact_value(text if text is not None else record_text(row), getattr(db, "settings", None)))[:min(available, MAX_RECORD_CHARACTERS)]
        records.append({"ref": ref, "kind": kind, "id": identifier, "title": title, "text": text})
        rendered.append(header + text)
        length += len(header) + len(text) + (2 if len(rendered) > 1 else 0)
        seen.add((kind, identifier))

    async with db.tx() as tx:
        venture = await tx.fetch_one("SELECT * FROM ventures WHERE id=?", (venture_id,))
        if venture is None:
            raise NotFoundError("venture", venture_id)
        agent = await tx.fetch_one("SELECT * FROM agents WHERE id=? AND (venture_id IS NULL OR venture_id=?)", (agent_id, venture_id))
        if agent is None:
            raise NotFoundError("agent", agent_id)
        department = await tx.fetch_one("SELECT * FROM departments WHERE id=?", (agent["department_id"],))
        assert department is not None
        counts = await tx.fetch_all("SELECT department_id,status,COUNT(*) AS tickets FROM tickets WHERE venture_id=? GROUP BY department_id,status ORDER BY department_id,status", (venture_id,))
        costs = await tx.fetch_all("SELECT department_id,COALESCE(SUM(cost_usd),0) AS cost_usd FROM ledger WHERE venture_id=? GROUP BY department_id ORDER BY department_id", (venture_id,))
        pending = await tx.fetch_all("SELECT id,title,gate_type,status FROM approvals WHERE venture_id=? AND status='pending' ORDER BY created_at,id", (venture_id,))
        latest = await tx.fetch_all("SELECT a.department_id,a.id,a.title FROM artifacts a WHERE a.venture_id=? AND a.id=(SELECT b.id FROM artifacts b WHERE b.venture_id=a.venture_id AND b.department_id=a.department_id ORDER BY b.created_at DESC,b.id DESC LIMIT 1) ORDER BY a.department_id", (venture_id,))
        departments = await tx.fetch_all("SELECT id,name FROM departments ORDER BY sort_order")
        department_summaries = []
        for item in departments:
            by_status = {status: 0 for status in ("open", "in_progress", "waiting_approval", "blocked", "done", "failed", "cancelled")}
            by_status.update({row["status"]: row["tickets"] for row in counts if row["department_id"] == item["id"]})
            department_summaries.append({**item, "counts": by_status, "latest_artifact": next((row for row in latest if row["department_id"] == item["id"]), None)})
        snapshot = json_dumps({"context_snapshot": "Actual database state at the time of this question; no model call performed.",
            "venture": {key: str(venture[key])[:2000] if key == "idea" else venture[key] for key in ("id", "name", "idea", "founder_name", "status", "budget_usd", "spent_usd")},
            "departments": department_summaries,
            "department_ticket_counts": counts, "latest_artifacts_by_department": latest, "ledger_by_department": costs,
            "pending_approvals": pending[:20]}, getattr(db, "settings", None))
        now = utc_now()
        if snapshot_run_id:
            run = await tx.fetch_one("SELECT * FROM runs WHERE id=?", (snapshot_run_id,))
            if run is None or run["venture_id"] != venture_id or run["kind"] not in {"talk", "concierge", "ask", "check"}:
                raise ConflictError("Context snapshots require a conversation run in the same venture")
            await tx.execute("UPDATE runs SET input_text=? WHERE id=?", (snapshot, snapshot_run_id))
        else:
            snapshot_run_id = new_id("run")
            await tx.execute("INSERT INTO runs(id,venture_id,agent_id,kind,job,model,status,input_text,output_text,created_at,completed_at) VALUES(?,?,?,'check','check_citation','deterministic','succeeded',?,'Context snapshot; no model call performed.',?,?)",
                (snapshot_run_id, venture_id, agent_id, snapshot, now, now))
        # Reserve summary provenance before other records exhaust the pack budget.
        add("agent", agent)
        add("department", department)
        add("run", {"id": snapshot_run_id, "created_at": now}, "Current venture, budget and company state", snapshot)
        if company_wide:
            for row in await tx.fetch_all("SELECT * FROM approvals WHERE venture_id=? AND status='pending' ORDER BY created_at DESC,id DESC LIMIT 6", (venture_id,)):
                add("approval", row)
            for row in await tx.fetch_all("SELECT m.* FROM messages m JOIN channels c ON c.id=m.channel_id WHERE m.venture_id=? AND c.slug IN ('exec','all-hands') ORDER BY m.created_at DESC,m.id DESC LIMIT 10", (venture_id,)):
                add("message", row, "Company conversation")
        else:
            state = await tx.fetch_one("SELECT current_ticket_id FROM agent_state WHERE venture_id=? AND agent_id=?", (venture_id, agent_id))
            current = await tx.fetch_one("SELECT * FROM tickets WHERE id=? AND venture_id=?", (state["current_ticket_id"], venture_id)) if state and state["current_ticket_id"] else None
            if current:
                add("ticket", current)
            run = await tx.fetch_one("SELECT * FROM runs WHERE venture_id=? AND agent_id=? AND kind='ticket' ORDER BY created_at DESC,id DESC LIMIT 1", (venture_id, agent_id))
            if run:
                logs = await tx.fetch_all("SELECT level,message FROM run_logs WHERE run_id=? ORDER BY id DESC LIMIT 20", (run["id"],))
                add("run", run, "Latest work run", record_text(run) + "\nLast recorded progress:\n" + "\n".join(f"{line['level']}: {line['message']}" for line in reversed(logs)))
            for row in await tx.fetch_all("SELECT * FROM tickets WHERE venture_id=? AND assigned_agent_id=? ORDER BY created_at DESC,id DESC LIMIT 5", (venture_id, agent_id)):
                add("ticket", row)
            for row in await tx.fetch_all("SELECT * FROM artifacts WHERE venture_id=? AND (agent_id=? OR department_id=?) ORDER BY created_at DESC,id DESC LIMIT 5", (venture_id, agent_id, agent["department_id"])):
                add("artifact", row)
            for row in await tx.fetch_all("SELECT a.* FROM approvals a LEFT JOIN agents p ON p.id=a.requested_by_agent_id WHERE a.venture_id=? AND a.status='pending' AND (a.requested_by_agent_id=? OR p.department_id=?) ORDER BY a.created_at DESC,a.id DESC LIMIT 4", (venture_id, agent_id, agent["department_id"])):
                add("approval", row)
            for row in await tx.fetch_all("SELECT m.* FROM messages m JOIN channels c ON c.id=m.channel_id WHERE m.venture_id=? AND (c.slug=? OR m.author_id=? OR lower(m.body) LIKE ? OR lower(m.body) LIKE ?) ORDER BY m.created_at DESC,m.id DESC LIMIT 10", (venture_id, f"dept-{agent['department_id']}", agent_id, f"%{agent_id.casefold()}%", f"%{agent['display_name'].casefold()}%")):
                add("message", row, "Department conversation")
        tokens = keywords(question)
        matches = []
        for table, kind, body_keys in (("tickets", "ticket", ("body", "result_json")), ("artifacts", "artifact", ("summary", "content_md")), ("approvals", "approval", ("summary", "payload_json")), ("messages", "message", ("body",))):
            if not tokens:
                break
            for row in await tx.fetch_all(f"SELECT * FROM {table} WHERE venture_id=? ORDER BY created_at DESC,id DESC LIMIT 200", (venture_id,)):
                title = str(row.get("title", "")).casefold()
                body = " ".join(str(row.get(key, "")) for key in body_keys).casefold()
                score = sum(title.count(token) * 3 + body.count(token) for token in tokens)
                if score and (kind, row["id"]) not in seen:
                    matches.append((score, row.get("created_at", ""), kind, row))
        for _, _, kind, row in sorted(matches, key=lambda item: (item[0], item[1]), reverse=True)[:8 if company_wide else 5]:
            add(kind, row)
    return ContextPack(records=records, rendered="\n\n".join(rendered), venture_id=venture_id)


async def build(db: Any, venture_id: str, agent_id: str, question: str) -> ContextPack:
    """Compatibility name retained from the seed module."""
    return await build_context_pack(db=db, venture_id=venture_id, agent_id=agent_id, question=question)
