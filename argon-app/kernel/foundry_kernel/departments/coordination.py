# OWNER: tanush
"""Runtime coordination and accounting around the cross-branch LLM protocol."""
from __future__ import annotations

import asyncio
from typing import Any

from pydantic import BaseModel, Field

from .. import bus, ledger
from ..config import get_settings
from ..contracts import AnswerCheck, AskAnswer, Citation, CitationCheck, TalkRequest
from ..db import json_dumps, json_loads_or
from ..errors import ConflictError, NotImplementedYet
from ..ids import new_id, utc_now
from ..llm.jsonout import parse_model
from ..models import job as get_job
from ..records import create_ticket, get_row, serialize_message, serialize_run


async def post_message(tx: Any, *, venture_id: str, channel_slug: str, body: str,
                       author_id: str, author_kind: str = "agent", refs: list[dict] | None = None,
                       kind: str = "status", thread_root_id: str | None = None) -> str:
    channel = await tx.fetch_one("SELECT id FROM channels WHERE venture_id=? AND slug=?", (venture_id, channel_slug))
    if channel is None:
        raise ConflictError(f"Channel {channel_slug} does not exist for this venture")
    if thread_root_id:
        root = await get_row(tx, "messages", thread_root_id)
        if root["venture_id"] != venture_id or root["channel_id"] != channel["id"]:
            raise ConflictError("Thread root must belong to the same venture and channel")
    mid = new_id("msg")
    await tx.execute("INSERT INTO messages(id,venture_id,channel_id,author_kind,author_id,body,refs_json,thread_root_id,meta_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                     (mid, venture_id, channel["id"], author_kind, author_id, body, json_dumps(refs or []), thread_root_id, json_dumps({"kind": kind}), utc_now()))
    row = await get_row(tx, "messages", mid)
    await bus.emit(tx, venture_id=venture_id, type="message.posted", entity_kind="message", entity_id=mid, data=serialize_message(row))
    return mid


class TrackedLLM:
    """Fill seed-client accounting gaps; defer to client-written ledger entries when present.

    A per-run lock makes before/after accounting reliable for concurrent callers sharing a run.
    When the merged client writes ledger rows, this wrapper does not add a second charge.
    """
    def __init__(self, db: Any, llm: Any, settings: Any = None, *, run_id: str | None = None,
                 venture_id: str | None = None, agent_id: str | None = None,
                 department_id: str | None = None) -> None:
        self.db, self.settings = db, settings or getattr(db, "settings", None) or get_settings()
        self.raw = llm.raw if isinstance(llm, TrackedLLM) else llm
        self.defaults = {"run_id": run_id, "venture_id": venture_id, "agent_id": agent_id, "department_id": department_id}
        if not hasattr(db, "_llm_tracking_locks"):
            db._llm_tracking_locks = {}

    def __getattr__(self, name: str) -> Any:
        return getattr(self.raw, name)

    async def _invoke(self, method: str, args: tuple, kwargs: dict, job_name: str) -> Any:
        context = {**self.defaults, **{key: kwargs[key] for key in self.defaults if key in kwargs}}
        automatic = context["run_id"] is None
        run_id = context["run_id"] or new_id("run")
        context["run_id"] = run_id
        lock = self.db._llm_tracking_locks.setdefault(run_id, asyncio.Lock())
        try:
            async with lock:
                if context["venture_id"] and await ledger.over_budget(self.db, context["venture_id"]):
                    async with self.db.tx() as tx:
                        await ledger.ensure_spend_approval(tx, context["venture_id"])
                    raise ConflictError("The venture budget is exhausted; approve the spend gate to continue")
                if automatic:
                    kind = {"orchestrate_plan": "plan", "cos_report": "standup", "check_citation": "check", "talk": "talk", "concierge": "concierge"}.get(job_name, "ask")
                    async with self.db.tx() as tx:
                        await tx.execute("INSERT INTO runs(id,venture_id,agent_id,kind,job,model,status,created_at,started_at) VALUES(?,?,?,?,?,?,'running',?,?)",
                            (run_id, context["venture_id"], context["agent_id"], kind, job_name, get_job(job_name).model, utc_now(), utc_now()))
                        row = serialize_run(await get_row(tx, "runs", run_id))
                        row.pop("output_text", None)
                        await bus.emit(tx, venture_id=context["venture_id"], type="run.started", entity_kind="run", entity_id=run_id, data=row)
                before = {row["id"] for row in await self.db.fetch_all("SELECT id FROM ledger WHERE run_id=?", (run_id,))}
                call_kwargs = dict(kwargs)
                if method == "generate":
                    call_kwargs = {**{k: v for k, v in context.items() if v is not None}, **call_kwargs}
                elif method == "run_agent":
                    for key in ("run_id", "venture_id"):
                        if context[key] is not None:
                            call_kwargs.setdefault(key, context[key])
                    call_kwargs.pop("agent_id", None)
                    call_kwargs.pop("department_id", None)
                result = await getattr(self.raw, method)(*args, **call_kwargs)
                async with self.db.tx() as tx:
                    after = await tx.fetch_all("SELECT id FROM ledger WHERE run_id=?", (run_id,))
                    if not ({row["id"] for row in after} - before):
                        await ledger.record(tx, venture_id=context["venture_id"], run_id=run_id,
                            agent_id=context["agent_id"], department_id=context["department_id"],
                            kind="image" if method == "generate_images" else "model", model=result.model,
                            cost_usd=result.cost_usd, units_in=result.tokens_in, units_out=result.tokens_out, estimated=result.estimated_cost)
                    total = await tx.fetch_one("SELECT COALESCE(SUM(units_in),0) AS units_in,COALESCE(SUM(units_out),0) AS units_out,COALESCE(SUM(cost_usd),0) AS cost FROM ledger WHERE run_id=?", (run_id,))
                    prompt = kwargs.get("prompt", args[1] if len(args) > 1 else "")
                    await tx.execute("UPDATE runs SET model=?,interaction_id=?,tokens_in=?,tokens_out=?,cost_usd=?,output_text=?,input_text=CASE WHEN input_text='' THEN ? ELSE input_text END WHERE id=?",
                        (result.model, result.interaction_id, total["units_in"], total["units_out"], total["cost"], result.text, str(prompt), run_id))
                    if automatic:
                        await tx.execute("UPDATE runs SET status='succeeded',completed_at=? WHERE id=?", (utc_now(), run_id))
                    note = f"LLM job={job_name} model={result.model} interaction={result.interaction_id or 'none'}"
                    await tx.execute("INSERT INTO run_logs(run_id,ts,level,message) VALUES(?,?,'info',?)", (run_id, utc_now(), note))
                    await bus.emit(tx, venture_id=context["venture_id"], type="run.log", entity_kind="run", entity_id=run_id,
                                   data={"run_id": run_id, "level": "info", "message": note})
                    row = serialize_run(await get_row(tx, "runs", run_id))
                    row.pop("output_text", None)
                    if automatic:
                        await bus.emit(tx, venture_id=context["venture_id"], type="run.finished", entity_kind="run", entity_id=run_id, data=row)
                return result
        except BaseException as exc:
            if automatic:
                async with self.db.tx() as tx:
                    await tx.execute("UPDATE runs SET status='failed',error=?,completed_at=? WHERE id=?", (str(exc) or type(exc).__name__, utc_now(), run_id))
                    row = await tx.fetch_one("SELECT * FROM runs WHERE id=?", (run_id,))
                    if row:
                        data = serialize_run(row)
                        data.pop("output_text", None)
                        await bus.emit(tx, venture_id=context["venture_id"], type="run.finished", entity_kind="run", entity_id=run_id, data=data)
            raise
        finally:
            # Scheduler runs have a bounded lifetime; standalone calls release their locks here.
            if automatic:
                self.db._llm_tracking_locks.pop(run_id, None)

    async def generate(self, job: str, prompt: Any, **kwargs: Any) -> Any:
        return await self._invoke("generate", (job, prompt), kwargs, job)

    async def generate_json(self, job: str, prompt: Any, schema: type[BaseModel], **kwargs: Any) -> tuple[BaseModel, Any]:
        result = await self.generate(job, prompt, **kwargs)
        try:
            return parse_model(result.text, schema), result
        except ValueError as exc:
            repair = f"Return ONLY corrected JSON matching this schema: {schema.model_json_schema()}. Validation failure: {exc}. Original task: {prompt}. Invalid output: {result.text}"
            repaired = await self.generate(job, repair, **{**kwargs, "previous_interaction_id": result.interaction_id})
            return parse_model(repaired.text, schema), repaired

    async def run_agent(self, **kwargs: Any) -> Any:
        # The provider agent configuration names the model; job metadata stays in models.py.
        name = "deep_research" if "deep-research" in kwargs.get("agent", "") else "dept_artifact"
        return await self._invoke("run_agent", (), kwargs, name)

    async def generate_images(self, job: str, prompt: str, n: int = 1, reference_images: Any = None) -> Any:
        return await self._invoke("generate_images", (job, prompt), {"n": n, "reference_images": reference_images}, job)


class AskOutput(BaseModel):
    text: str
    citations: list[Citation] = Field(default_factory=list)


class RuntimeContext:
    def __init__(self, *, db: Any, llm: Any, settings: Any, venture: dict, agent: dict,
                 run_id: str, ticket: dict) -> None:
        self.db, self.settings, self.venture, self.agent = db, settings, venture, agent
        self.run_id, self.ticket = run_id, ticket
        self.approval_result = json_loads_or(ticket.get("payload_json"), {}).get("_approval")
        self._asks = 0
        self.llm = TrackedLLM(db, llm, settings, run_id=run_id, venture_id=venture["id"],
                              agent_id=agent["id"], department_id=agent["department_id"])

    async def log(self, level: str, message: str) -> None:
        if level not in {"debug", "info", "warn", "error"}:
            raise ValueError("Unknown log level")
        async with self.db.tx() as tx:
            await tx.execute("INSERT INTO run_logs(run_id,ts,level,message) VALUES(?,?,?,?)", (self.run_id, utc_now(), level, message))
            await bus.emit(tx, venture_id=self.venture["id"], type="run.log", entity_kind="run", entity_id=self.run_id,
                           data={"run_id": self.run_id, "level": level, "message": message})

    async def context_for(self, kinds: list[str]) -> str:
        if not kinds:
            return ""
        marks = ",".join("?" for _ in kinds)
        rows = await self.db.fetch_all(f"SELECT * FROM artifacts WHERE venture_id=? AND kind IN ({marks}) ORDER BY created_at DESC,id DESC LIMIT 40", (self.venture["id"], *kinds))
        return "\n\n".join(f"[{r['id']}] {r['title']}\n{r['summary']}\n{r['content_md']}" for r in rows)[:200_000]

    async def post(self, channel_slug: str, body: str, refs: list[dict] | None = None,
                   kind: str = "status", thread_root_id: str | None = None) -> str:
        async with self.db.tx() as tx:
            return await post_message(tx, venture_id=self.venture["id"], channel_slug=channel_slug, body=body,
                                      author_id=self.agent["id"], refs=refs, kind=kind, thread_root_id=thread_root_id)

    async def request(self, department_id: str, need: str, why: str = "", context_refs: list[dict] | None = None) -> str:
        source_payload = json_loads_or(self.ticket.get("payload_json"), {})
        redirects = source_payload.get("redirects", 0) + 1 if self.ticket["type"] == "agent.request" else 0
        if redirects > 2:
            raise ConflictError("A request may be redirected at most twice")
        async with self.db.tx() as tx:
            target = await get_row(tx, "departments", department_id)
            row = await create_ticket(tx, venture_id=self.venture["id"], type="agent.request", department_id=department_id,
                title=need[:200], body=why, payload={"from_agent_id": self.agent["id"], "need": need, "why": why,
                                                  "context_refs": context_refs or [], "deadline_minutes": 30,
                                                  "target_department": department_id, "department_id": department_id,
                                                  "redirects": redirects}, created_by=self.agent["id"])
            reports = await tx.fetch_all("WITH RECURSIVE downstream(id) AS (SELECT ticket_id FROM ticket_deps WHERE depends_on_id=? UNION SELECT d.ticket_id FROM ticket_deps d JOIN downstream p ON d.depends_on_id=p.id) SELECT t.id FROM tickets t JOIN downstream d ON d.id=t.id WHERE t.type='cos.report' AND t.status IN ('open','blocked')", (self.ticket["id"],))
            for report in reports:
                await tx.execute("INSERT OR IGNORE INTO ticket_deps VALUES(?,?)", (report["id"], row["id"]))
            await post_message(tx, venture_id=self.venture["id"], channel_slug=f"dept-{department_id}", kind="request",
                author_kind="system", author_id="system", body=f"Request from {self.agent['display_name']} → {target['name']}: {need} ({row['id']})",
                refs=[{"kind": "ticket", "id": row["id"]}])
            return row["id"]

    async def ask_agent(self, agent_id: str, question: str) -> AskAnswer:
        if self._asks >= 3:
            raise ConflictError("A run may ask at most three questions")
        self._asks += 1
        target = await get_row(self.db, "agents", agent_id)
        if target["venture_id"] not in (None, self.venture["id"]):
            raise ConflictError("The target agent belongs to another venture")
        from ..conversation.talk import talk

        response_answer_id = None
        try:
            result = await talk(db=self.db, llm=self.llm.raw, settings=self.settings, venture_id=self.venture["id"],
                                agent_id=agent_id, req=TalkRequest(text=question))
            answer = AskAnswer(agent_id=agent_id, text=result.text, citations=result.citations, check=result.check)
            response_answer_id = result.answer_id
        except NotImplementedYet:
            # Step B can run independently of the richer Step D context pack.
            artifacts = await self.db.fetch_all("SELECT id,title,summary,content_md FROM artifacts WHERE venture_id=? AND department_id=? ORDER BY created_at DESC LIMIT 20", (self.venture["id"], target["department_id"]))
            tracked = TrackedLLM(self.db, self.llm, self.settings, venture_id=self.venture["id"], agent_id=agent_id, department_id=target["department_id"])
            output, _ = await tracked.generate_json("talk", json_dumps({"question": question, "records": artifacts}), AskOutput,
                system=f"You are {target['display_name']}. Answer only from the provided records, cite exact substrings with kind artifact and record id. Say you do not know if missing. Never take actions. Return JSON text,citations.")
            allowed = {r["id"]: r for r in artifacts}
            checks = [CitationCheck(index=i, status="verified" if c.kind == "artifact" and c.id in allowed and c.quote and any(c.quote in (allowed[c.id][k] or "") for k in ("title", "summary", "content_md")) else "unsupported") for i, c in enumerate(output.citations)]
            valid = bool(checks) and all(c.status == "verified" for c in checks)
            answer = AskAnswer(agent_id=agent_id, text=output.text if valid else "I don't have a verified record to answer that yet.", citations=output.citations if valid else [],
                               check=AnswerCheck(status="verified" if valid else "unsupported", per_citation=checks))
        if response_answer_id:
            check_task = getattr(self.db, "_answer_check_tasks", {}).get(response_answer_id)
            if check_task:
                await check_task
            checked = await self.db.fetch_one("SELECT check_status,check_json FROM answers WHERE id=? AND venture_id=?", (response_answer_id, self.venture["id"]))
            if checked:
                answer.check = AnswerCheck.model_validate(json_loads_or(checked["check_json"], {"status": checked["check_status"]}))
                answer.check.status = checked["check_status"]
        if answer.check.status in {"unsupported", "error"}:
            answer.text, answer.citations = "I don't have a verified record to answer that yet.", []
        channel = f"dept-{self.agent['department_id']}"
        root = await self.post(channel, f"{self.agent['display_name']} → @{target['display_name']}: {question}",
                               [{"kind": "ticket", "id": self.ticket["id"]}], kind="ask")
        async with self.db.tx() as tx:
            await post_message(tx, venture_id=self.venture["id"], channel_slug=channel,
                body=f"{target['display_name']}: {answer.text}", author_id=agent_id, kind="answer", thread_root_id=root,
                refs=[{"kind": c.kind, "id": c.id} for c in answer.citations])
        return answer

    async def use_computer(self, goal: str, allowed_domains: list[str], start_url: str, max_steps: int = 30) -> Any:
        from ..computers.loop import run_task

        return await run_task(settings=self.settings, db=self.db, llm=self.llm, venture_id=self.venture["id"],
            agent_id=self.agent["id"], ticket_id=self.ticket["id"], goal=goal, allowed_domains=allowed_domains,
            start_url=start_url, max_steps=max_steps)


SchedulerContext = RuntimeContext
