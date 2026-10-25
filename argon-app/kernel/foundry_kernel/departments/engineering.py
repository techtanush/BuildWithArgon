# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.

"""Engineering & QA handler (eng.design, eng.build, eng.fix, eng.review, qa.verify).
Spec: 03-company-kernel/02-autonomous-engineering-loop.md. LLM_MODE=fake keeps the seed behaviour (the company DAG
runs end to end on every branch); live mode runs the real loop: Kai designs → Zara builds (Antigravity or the
local loop) → Mina reviews → Ben verifies → founder approves the merge gate → merge."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from ..contracts import (
    HandlerContext,
    HandlerResult,
    NewApproval,
    NewArtifact,
    NewMessage,
    NewTicket,
)
from ..executors import antigravity as ag
from ..executors import executor_name, workspace
from ..executors.local_loop import LocalLoopExecutor, load_prompt
from ..security import redact

MAX_TASKS = 5
MAX_FIXES_PER_TASK = 3
CONTEXT_TOKEN_LIMIT = 700_000
NAMES = {"eng.tech-lead": "Kai", "eng.builder": "Zara", "eng.reviewer": "Mina", "eng.qa": "Ben"}


class TaskOut(BaseModel):
    key: str
    title: str
    body: str = ""
    acceptance_refs: list[str] = Field(default_factory=list)
    files_hint: list[str] = Field(default_factory=list)
    depends_on: list[str] = Field(default_factory=list)


class DesignOut(BaseModel):
    architecture_md: str
    tasks: list[TaskOut]
    risks: list[str] = Field(default_factory=list)


class ReviewComment(BaseModel):
    file: str = ""
    line: int | None = None
    severity: Literal["high", "medium", "low"] = "low"
    comment: str = ""


class ReviewOut(BaseModel):
    verdict: Literal["approve", "changes_requested"]
    comments: list[ReviewComment] = Field(default_factory=list)
    security_notes: list[str] = Field(default_factory=list)
    summary: str = ""


# ------------------------------------------------------------------ small helpers


def payload_of(ticket: dict[str, Any]) -> dict[str, Any]:
    p = ticket.get("payload")
    if isinstance(p, dict):
        return p
    raw = ticket.get("payload_json") or p
    if isinstance(raw, str) and raw:
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except ValueError:
            return {}
    return {}


def result_of(ticket: dict[str, Any]) -> dict[str, Any]:
    r = ticket.get("result") or ticket.get("result_json")
    if isinstance(r, dict):
        return r
    if isinstance(r, str) and r:
        try:
            parsed = json.loads(r)
            return parsed if isinstance(parsed, dict) else {}
        except ValueError:
            return {}
    return {}


def tid8(ticket_id: str) -> str:
    return ticket_id.split("_", 1)[-1][-8:].lower()


def venture_id(ticket: dict[str, Any], ctx: HandlerContext) -> str:
    return str(ticket.get("venture_id") or ctx.venture["id"])


def llm_kw(ticket: dict[str, Any], ctx: HandlerContext) -> dict[str, Any]:
    return {"run_id": ctx.run_id, "venture_id": venture_id(ticket, ctx), "agent_id": ctx.agent.get("id"),
            "department_id": "engineering"}


def check_design(design: DesignOut, ac_ids: list[str]) -> list[str]:
    """E-01: 1–5 tasks, unique keys, known earlier deps, every AC id covered."""
    problems: list[str] = []
    if not 1 <= len(design.tasks) <= MAX_TASKS:
        problems.append(f"there must be 1–{MAX_TASKS} tasks (got {len(design.tasks)})")
    keys = [t.key for t in design.tasks]
    if len(set(keys)) != len(keys):
        problems.append("task keys must be unique")
    for i, t in enumerate(design.tasks):
        bad = [d for d in t.depends_on if d not in keys[:i]]
        if bad:
            problems.append(f"task {t.key} depends on unknown or later tasks {bad}")
    covered = {ref for t in design.tasks for ref in t.acceptance_refs}
    missing = [a for a in ac_ids if a not in covered]
    if missing:
        problems.append(f"acceptance criteria not covered by any task: {missing}")
    return problems


def ac_list_from_text(text: str) -> list[dict[str, str]]:
    out: dict[str, str] = {}
    for m in re.finditer(r"\b(AC-\d+)\b[\s:.)\-–]*([^\n]*)", text or ""):
        out.setdefault(m.group(1), m.group(2).strip())
    return [{"id": k, "text": v} for k, v in out.items()]


def codebase_context(root: Path) -> tuple[str, bool]:
    """Whole repo as FILE blocks; above ~700k tokens (chars/3.5) only src/ and tests/ in full + a tree listing."""
    from ..executors import fileblocks

    files = workspace.text_files(root)
    full = "\n".join(fileblocks.emit(str(p.relative_to(root)), p.read_text("utf-8").rstrip("\n")) for p in files)
    if len(full) / 3.5 <= CONTEXT_TOKEN_LIMIT:
        return full, False
    tree = "\n".join(str(p.relative_to(root)) for p in files)
    core = [p for p in files if str(p.relative_to(root)).startswith(("src/", "tests/"))]
    body = "\n".join(fileblocks.emit(str(p.relative_to(root)), p.read_text("utf-8").rstrip("\n")) for p in core)
    return f"FILE TREE:\n{tree}\n\n{body}", True


# ------------------------------------------------------------------ handler


class EngineeringHandler:
    ticket_types = ("eng.design", "eng.build", "eng.fix", "eng.review", "qa.verify")
    runner: workspace.Runner | None = None  # tests inject a fake command runner (no npm)

    async def handle(self, ticket: dict[str, Any], ctx: HandlerContext) -> HandlerResult:
        if ctx.settings.llm_mode == "fake":
            return self._fake(ticket, ctx)
        t = ticket["type"]
        if t == "eng.design":
            return await self.design(ticket, ctx)
        if t in ("eng.build", "eng.fix"):
            return await self.build(ticket, ctx)
        if t == "eng.review":
            return await self.review(ticket, ctx)
        if t == "qa.verify":
            from . import qa

            return await qa.verify(self, ticket, ctx)
        return HandlerResult(outcome="failed", note=f"unknown type {t}")

    def _fake(self, ticket: dict[str, Any], ctx: HandlerContext) -> HandlerResult:
        t = ticket["type"]
        if t == "eng.design":
            return HandlerResult(
                outcome="done",
                artifacts=[NewArtifact(kind="plan", title="Architecture (fake)", summary="One task.", content_md="## Overview\nFake design.")],
                new_tickets=[
                    NewTicket(type="eng.build", title="T1 (fake build)", ref="build:T1", assigned_agent_id="eng.builder"),
                    NewTicket(type="eng.review", title="Review T1", ref="review:T1", depends_on=["ref:build:T1"], assigned_agent_id="eng.reviewer"),
                    NewTicket(type="qa.verify", title="Verify T1", depends_on=["ref:review:T1"], assigned_agent_id="eng.qa"),
                ],
                messages=[NewMessage(channel_slug="dept-engineering", body="@Zara T1 is yours (fake).", kind="delegation")])
        if t in ("eng.build", "eng.fix"):
            return HandlerResult(outcome="done", result={"iterations": 1, "first_pass_passed": True, "tests_passed": 3, "tests_failed": 0},
                                 artifacts=[NewArtifact(kind="code", title=f"{ticket['title']} — code (fake)"),
                                            NewArtifact(kind="test_report", title="3/3 tests (fake)")])
        if t == "eng.review":
            return HandlerResult(outcome="done", artifacts=[NewArtifact(kind="doc", title="Review: approve (fake)")])
        if t == "qa.verify":
            if ctx.approval_result is None:
                return HandlerResult(outcome="waiting_approval",
                                     approval=NewApproval(gate_type="merge", title="Merge T1 (fake)", summary="3/3 tests, reviewed, verified.",
                                                          payload={"local": True, "tests": {"passed": 3, "failed": 0}}))
            return HandlerResult(outcome="done", note="merged (fake)")
        return HandlerResult(outcome="failed", note=f"unknown type {t}")

    # ------------------------------------------------------------------ shared lookups

    async def acceptance_criteria(self, ctx: HandlerContext, vid: str) -> list[dict[str, str]]:
        """Latest spec artifact's meta.acceptance_criteria; fallback: AC-n lines in the spec context."""
        if ctx.db is not None:
            row = await ctx.db.fetch_one("SELECT meta_json, content_md FROM artifacts WHERE venture_id = ? AND kind = 'spec' "
                                         "ORDER BY created_at DESC LIMIT 1", (vid,))
            if row:
                try:
                    acs = json.loads(row["meta_json"] or "{}").get("acceptance_criteria") or []
                except ValueError:
                    acs = []
                parsed = [{"id": str(a.get("id")), "text": str(a.get("text", ""))} for a in acs
                          if isinstance(a, dict) and a.get("id")]
                return parsed or ac_list_from_text(row["content_md"] or "")
        return ac_list_from_text(await ctx.context_for(["spec"]))

    async def venture_row(self, ctx: HandlerContext, vid: str) -> dict[str, Any]:
        if ctx.db is not None:
            row = await ctx.db.fetch_one("SELECT * FROM ventures WHERE id = ?", (vid,))
            if row:
                return row
        return dict(ctx.venture)

    async def github(self, ctx: HandlerContext, vid: str) -> tuple[Any, Any, str] | None:
        """(composio module, client, composio user id) when GitHub is connected and Composio configured."""
        if ctx.db is None:
            return None
        try:
            from ..integrations import composio

            client = composio.ComposioClient(ctx.settings)
            if not client.configured:
                return None
            row = await composio.github_integration(ctx.db, vid)
        except (ImportError, AttributeError):
            return None
        except Exception as exc:  # noqa: BLE001 - Composio down → no-GitHub mode
            await ctx.log("warn", f"GitHub integration unavailable ({type(exc).__name__}); using local mode")
            return None
        if not row:
            return None
        venture = await self.venture_row(ctx, vid)
        return composio, client, str(venture.get("composio_user_id") or f"foundry:{vid}")

    async def task_tickets(self, ctx: HandlerContext, vid: str, task_key: str | None, types: tuple[str, ...]) -> list[dict[str, Any]]:
        if ctx.db is None or not task_key:
            return []
        marks = ",".join("?" for _ in types)
        rows = await ctx.db.fetch_all(f"SELECT * FROM tickets WHERE venture_id = ? AND type IN ({marks}) "
                                      "ORDER BY created_at ASC", (vid, *types))
        return [r for r in rows if payload_of(r).get("task_key") == task_key]

    async def latest_build(self, ctx: HandlerContext, ticket: dict[str, Any]) -> dict[str, Any] | None:
        """The most recent completed eng.build/eng.fix for this ticket's task (fixes supersede the build);
        fallback: walk the dependency chain."""
        vid, key = venture_id(ticket, ctx), payload_of(ticket).get("task_key")
        done = [t for t in await self.task_tickets(ctx, vid, key, ("eng.build", "eng.fix")) if t["status"] == "done"]
        if done:
            return max(done, key=lambda t: t.get("completed_at") or t.get("updated_at") or "")
        if ctx.db is None or not ticket.get("id"):
            return None
        seen, frontier = set(), [ticket["id"]]
        while frontier:
            tid = frontier.pop()
            for dep in await ctx.db.fetch_all("SELECT t.* FROM ticket_deps d JOIN tickets t ON t.id = d.depends_on_id "
                                              "WHERE d.ticket_id = ?", (tid,)):
                if dep["id"] in seen:
                    continue
                seen.add(dep["id"])
                if dep["type"] in ("eng.build", "eng.fix") and dep["status"] == "done":
                    return dep
                frontier.append(dep["id"])
        return None

    async def plan_markdown(self, ctx: HandlerContext, vid: str) -> str:
        if ctx.db is None:
            return ""
        row = await ctx.db.fetch_one("SELECT content_md FROM artifacts WHERE venture_id = ? AND kind = 'plan' AND "
                                     "department_id = 'engineering' ORDER BY created_at DESC LIMIT 1", (vid,))
        return row["content_md"] if row else ""

    def fix_chain(self, *, task_key: str, title: str, body: str, payload: dict[str, Any], acs: list[dict[str, str]],
                  architecture_md: str, n: int) -> list[NewTicket]:
        """eng.fix → eng.review → qa.verify for one task (support doc: the usual loop after a fix)."""
        base = {"task_key": task_key, "acceptance_criteria": acs, "architecture_md": architecture_md[:20_000]}
        return [
            NewTicket(type="eng.fix", title=f"Fix {task_key}: {title}"[:200], body=body, ref=f"fix:{task_key}:{n}",
                      payload={**base, **payload}, priority=1, assigned_agent_id="eng.builder"),
            NewTicket(type="eng.review", title=f"Review fix {task_key}", ref=f"review:{task_key}:fix{n}",
                      depends_on=[f"ref:fix:{task_key}:{n}"], payload=dict(base), assigned_agent_id="eng.reviewer"),
            NewTicket(type="qa.verify", title=f"Verify {task_key} (after fix {n})", ref=f"verify:{task_key}:fix{n}",
                      depends_on=[f"ref:review:{task_key}:fix{n}"], payload=dict(base), assigned_agent_id="eng.qa"),
        ]

    # ------------------------------------------------------------------ eng.design (Kai)

    async def design(self, ticket: dict[str, Any], ctx: HandlerContext) -> HandlerResult:
        vid = venture_id(ticket, ctx)
        venture = await self.venture_row(ctx, vid)
        acs = await self.acceptance_criteria(ctx, vid)
        ac_ids = [a["id"] for a in acs]
        main = workspace.product_main(ctx.settings, vid)
        if main.exists():
            code, reduced = codebase_context(main)
            if reduced:
                await ctx.log("warn", "codebase above 700k tokens: full contents for src/ and tests/ only")
        else:
            code = "(no product yet — the first build starts from the vite-react-ts template: index.html, src/main.tsx, " \
                   "src/App.tsx, tests/smoke.test.ts)"
        history = ""
        if ctx.db is not None:
            rows = await ctx.db.fetch_all("SELECT type, title, status, result_json FROM tickets WHERE venture_id = ? AND "
                                          "department_id = 'engineering' AND id != ? ORDER BY created_at",
                                          (vid, ticket.get("id") or ""))
            history = "\n".join(f"- [{r['status']}] {r['type']}: {r['title']}" for r in rows)
        context = await ctx.context_for(["brief", "spec", "decision"])
        prompt = (f"VENTURE: {venture.get('name', '')}\nIDEA: {venture.get('idea', '')}\n\n"
                  f"CONTEXT (brief, spec, decision):\n{context or '(none)'}\n\n"
                  f"ACCEPTANCE CRITERIA:\n" + "\n".join(f"- {a['id']}: {a['text']}" for a in acs) +
                  f"\n\nENGINEERING TICKETS SO FAR:\n{history or '(none)'}\n\nCURRENT CODEBASE:\n{code}\n\n"
                  f"TICKET {ticket.get('id', '')}: {ticket.get('title', '')}\n{ticket.get('body', '')}")
        system = load_prompt("eng.tech-lead")
        kw = llm_kw(ticket, ctx)
        out, res = await ctx.llm.generate_json("engineering_design", prompt, DesignOut, system=system, **kw)
        design: DesignOut = out  # type: ignore[assignment]
        problems = check_design(design, ac_ids)
        if problems:
            await ctx.log("warn", f"design invalid ({'; '.join(problems)}); asking Kai to correct it once")
            fix = ("Your design is invalid: " + "; ".join(problems) + ". Return the COMPLETE corrected JSON (same schema): "
                   f"1–{MAX_TASKS} tasks and every one of these ids in some task's acceptance_refs: {ac_ids}.")
            out, res = await ctx.llm.generate_json("engineering_design", prompt + "\n\n" + fix, DesignOut, system=system,
                                                   previous_interaction_id=res.interaction_id, **kw)
            design = out  # type: ignore[assignment]
            problems = check_design(design, ac_ids)
            if problems:
                return HandlerResult(outcome="failed", note="design invalid after one repair: " + "; ".join(problems))
        await self.ensure_repo(ctx, vid, venture)
        arch = redact(design.architecture_md)
        by_id = {a["id"]: a for a in acs}
        tickets: list[NewTicket] = []
        messages: list[NewMessage] = []
        for task in design.tasks:
            task_acs = [by_id[r] for r in task.acceptance_refs if r in by_id]
            payload = {"task_key": task.key, "acceptance_refs": task.acceptance_refs, "acceptance_criteria": task_acs,
                       "architecture_md": arch[:20_000], "files_hint": task.files_hint}
            tickets += [
                NewTicket(type="eng.build", title=f"{task.key} {task.title}"[:200], body=redact(task.body),
                          ref=f"build:{task.key}", depends_on=[f"ref:build:{d}" for d in task.depends_on],
                          payload=payload, priority=1, assigned_agent_id="eng.builder"),
                NewTicket(type="eng.review", title=f"Review {task.key} {task.title}"[:200], ref=f"review:{task.key}",
                          depends_on=[f"ref:build:{task.key}"], payload={k: payload[k] for k in ("task_key", "acceptance_criteria", "architecture_md")},
                          assigned_agent_id="eng.reviewer"),
                NewTicket(type="qa.verify", title=f"Verify {task.key} {task.title}"[:200], ref=f"verify:{task.key}",
                          depends_on=[f"ref:review:{task.key}"], payload={k: payload[k] for k in ("task_key", "acceptance_criteria", "architecture_md")},
                          assigned_agent_id="eng.qa"),
            ]
            messages.append(NewMessage(channel_slug="dept-engineering", kind="delegation",
                                       body=f"@Zara {task.key} {task.title} is yours ({', '.join(task.acceptance_refs)}). "
                                            f"@Mina reviews it, @Ben verifies it."))
        md = arch + ("\n\n## Tasks\n" + "\n".join(f"- **{t.key}** {t.title} — {', '.join(t.acceptance_refs)}"
                                                    + (f" (after {', '.join(t.depends_on)})" if t.depends_on else "")
                                                    for t in design.tasks))
        if design.risks:
            md += "\n\n## Risks\n" + "\n".join(f"- {redact(r)}" for r in design.risks)
        return HandlerResult(
            outcome="done",
            result={"tasks": [t.key for t in design.tasks], "acceptance_ids": ac_ids, "interaction_id": res.interaction_id},
            artifacts=[NewArtifact(kind="plan", title="Architecture & build tasks", content_md=md,
                                   summary=f"{len(design.tasks)} task(s) covering {len(ac_ids)} acceptance criteria",
                                   meta={"tasks": [t.model_dump() for t in design.tasks], "risks": design.risks})],
            new_tickets=tickets, messages=messages)

    async def ensure_repo(self, ctx: HandlerContext, vid: str, venture: dict[str, Any]) -> None:
        """First design for a venture with GitHub active and no repo → create a private repo (Composio)."""
        if venture.get("repo_full_name"):
            return
        gh = await self.github(ctx, vid)
        if gh is None:
            return
        _, client, user = gh
        slug = venture.get("slug") or ag.slugify(str(venture.get("name") or vid))
        try:
            repo = await client.create_repo(user, f"foundry-{slug}", True, str(venture.get("idea") or "")[:300])
        except Exception as exc:  # noqa: BLE001 - keep going in local mode
            await ctx.log("warn", f"could not create the GitHub repo ({type(exc).__name__}); local mode")
            return
        from .. import bus
        from ..ids import utc_now

        full, url = repo.get("full_name"), repo.get("html_url")
        async with ctx.db.tx() as tx:
            await tx.execute("UPDATE ventures SET repo_full_name = ?, repo_url = ?, updated_at = ? WHERE id = ?",
                             (full, url, utc_now(), vid))
            await bus.emit(tx, venture_id=vid, type="venture.updated", entity_kind="venture", entity_id=vid,
                           data={"repo_full_name": full, "repo_url": url})
        await ctx.log("info", f"created GitHub repo {full}")

    # ------------------------------------------------------------------ eng.build / eng.fix (Zara)

    def fix_context(self, payload: dict[str, Any], ticket: dict[str, Any]) -> str | None:
        parts = []
        for key, label in (("failures", "FAILING TESTS / QA"), ("review_comments", "REVIEW COMMENTS"),
                           ("repro_steps", "REPRO STEPS"), ("comment", "PR COMMENT")):
            if payload.get(key):
                parts.append(f"{label}:\n{json.dumps(payload[key], indent=2) if not isinstance(payload[key], str) else payload[key]}")
        if payload.get("summary"):
            parts.append(f"ISSUE: {payload['summary']}")
        if payload.get("suspected_area"):
            parts.append(f"SUSPECTED AREA: {payload['suspected_area']}")
        return "\n\n".join(parts) or (ticket.get("body") or None)

    async def build(self, ticket: dict[str, Any], ctx: HandlerContext) -> HandlerResult:
        from ..contracts import ExecutorInput

        vid = venture_id(ticket, ctx)
        payload = payload_of(ticket)
        mode = "fix" if ticket["type"] == "eng.fix" else "build"
        venture = await self.venture_row(ctx, vid)
        gh = await self.github(ctx, vid)
        repo = venture.get("repo_full_name") if gh else None
        acs = payload.get("acceptance_criteria") or await self.acceptance_criteria(ctx, vid)
        inp = ExecutorInput(venture_id=vid, ticket_id=str(ticket.get("id") or ctx.run_id), run_id=ctx.run_id,
                            title=str(ticket.get("title") or ""), body=str(ticket.get("body") or ""),
                            acceptance_criteria=acs, architecture_md=payload.get("architecture_md") or await self.plan_markdown(ctx, vid),
                            repo_full_name=repo, max_iterations=ctx.settings.max_build_iterations, mode=mode,  # type: ignore[arg-type]
                            fix_context=self.fix_context(payload, ticket) if mode == "fix" else None)
        name = await executor_name(ctx.settings, ctx.db)
        if name == "antigravity" and repo:
            executor: Any = ag.AntigravityExecutor(ctx.settings, ctx.llm, ctx.db, agent_name=NAMES["eng.builder"])
            result = await executor.run(inp, ctx.log)
        else:
            if name == "antigravity":
                await ctx.log("info", "no GitHub repo for this venture — this ticket runs on the local loop")
            name = "local"
            executor = LocalLoopExecutor(ctx.settings, ctx.llm, runner=self.runner)
            base = None
            if mode == "fix":  # continue from the task's latest workspace (or the product's main)
                prev = await self.latest_build(ctx, ticket)
                prev_ws = result_of(prev).get("workspace_path") if prev else None
                base = Path(prev_ws) if prev_ws and Path(prev_ws).exists() else None
            result = await executor.run(inp, ctx.log, base=base)
        tid = inp.ticket_id
        metrics = {"iterations": result.iterations, "first_pass_passed": result.first_pass_passed,
                   "final_passed": result.status == "passed", "tests_passed": result.tests_passed,
                   "tests_failed": result.tests_failed, "build_ok": result.build_ok, "tokens_in": result.tokens_in,
                   "tokens_out": result.tokens_out, "cost_usd": result.cost_usd, "wall_seconds": result.wall_seconds,
                   "executor": name, "branch": result.branch, "commit": result.commit,
                   "workspace_path": result.workspace_path, "task_key": payload.get("task_key"),
                   "files_changed": result.files_changed[:200]}
        if name == "antigravity":
            metrics["interaction_id"] = getattr(executor, "interaction_id", None)
        if name == "local":
            metrics["iterations_detail"] = executor.iterations_detail
        task = payload.get("task_key") or tid8(tid)
        if result.status == "failed":
            return HandlerResult(outcome="failed", note="; ".join(result.failures)[:2000] or "build failed",
                                 result=metrics, artifacts=[self.test_report(ticket, result, name, failed=True)],
                                 messages=[NewMessage(channel_slug="dept-engineering", kind="status",
                                                      body=f"{task}: verification still failing after {result.iterations} "
                                                           f"iteration(s) ({result.tests_passed}/{result.tests_passed + result.tests_failed} passing).")])
        artifacts = [
            NewArtifact(kind="code", title=f"{ticket.get('title', '')} — code"[:200], summary=result.summary[:600],
                        content_md=f"{result.summary}\n\n**Files changed ({len(result.files_changed)}):**\n" +
                                   "\n".join(f"- `{f}`" for f in result.files_changed[:200]),
                        meta={"files_changed": result.files_changed[:200], "executor": name, "branch": result.branch}),
            self.test_report(ticket, result, name, failed=False),
        ]
        if result.preview_path:
            preview = f"/preview/{vid}/{tid}/"
            metrics["preview_url"] = preview
            artifacts.append(NewArtifact(kind="preview", title=f"Preview — {ticket.get('title', '')}"[:200], uri=preview,
                                         summary="Local build served by the kernel"))
        if gh is not None and repo:
            pr = await self.publish(ctx, gh, repo, ticket, result, name, acs)
            if pr:
                metrics.update(pr_number=pr.get("number"), pr_url=pr.get("html_url"), branch=pr.get("branch"))
                artifacts.append(NewArtifact(kind="pr", title=f"PR #{pr.get('number')}: {ticket.get('title', '')}"[:200],
                                             uri=pr.get("html_url"), summary=result.summary[:600],
                                             meta={"number": pr.get("number"), "state": "open", "head": pr.get("branch"),
                                                   "base": "main", "repo": repo}))
        else:
            artifacts[0].meta["local"] = True
        where = f"PR #{metrics['pr_number']}" if metrics.get("pr_number") else "local build — not on GitHub"
        return HandlerResult(
            outcome="done", result=metrics, artifacts=artifacts,
            messages=[NewMessage(channel_slug="dept-engineering", kind="handoff",
                                 body=f"{task} built in {result.iterations} iteration(s): {result.tests_passed}/"
                                      f"{result.tests_passed + result.tests_failed} tests, build ok ({where}). @Mina over to you.")])

    @staticmethod
    def test_report(ticket: dict[str, Any], result: Any, executor: str, *, failed: bool) -> NewArtifact:
        total = result.tests_passed + result.tests_failed
        body = (f"Executor: {executor}\n\nTests: {result.tests_passed}/{total} passing, build "
                f"{'ok' if result.build_ok else 'failed'}, {result.iterations} iteration(s), first pass "
                f"{'passed' if result.first_pass_passed else 'did not pass'}.")
        if result.failures:
            body += "\n\n## Failures\n" + "\n".join(f"- {f[:500]}" for f in result.failures[:20])
        return NewArtifact(kind="test_report", title=f"{result.tests_passed}/{total} tests — {ticket.get('title', '')}"[:200],
                           summary=("FAILED: " if failed else "") + f"{result.tests_passed}/{total} passing",
                           content_md=body, meta={"tests_passed": result.tests_passed, "tests_failed": result.tests_failed,
                                                  "iterations": result.iterations, "build_ok": result.build_ok})

    async def publish(self, ctx: HandlerContext, gh: tuple[Any, Any, str], repo: str, ticket: dict[str, Any],
                      result: Any, executor: str, acs: list[dict[str, str]]) -> dict[str, Any] | None:
        """Antigravity pushed its branch already; the local loop pushes changed files one by one. Then open the PR."""
        _, client, user = gh
        title = str(ticket.get("title") or "")
        branch = result.branch or ag.branch_name(str(ticket.get("id") or ""), title,
                                                 "fix" if ticket["type"] == "eng.fix" else "build")
        try:
            if executor == "local" and result.workspace_path:
                ws = Path(result.workspace_path)
                sha = await client.get_ref(user, repo, "main")
                await client.create_branch(user, repo, branch, sha)
                pushed = 0
                for rel in result.files_changed:
                    path = ws / rel
                    if pushed >= 200 or not path.is_file() or rel.split("/")[0] in ("node_modules", "dist", ".foundry"):
                        continue
                    data = path.read_bytes()
                    if len(data) > 1_000_000:
                        continue
                    await client.put_file(user, repo, branch, rel, data, f"foundry({tid8(str(ticket.get('id', '')))}): {title}")
                    pushed += 1
            payload = payload_of(ticket)
            refs = f"\n\nFixes #{payload['issue_number']}" if payload.get("issue_number") else ""
            how = "Antigravity" if executor == "antigravity" else "local loop"
            body = (f"{result.summary}\n\n## Acceptance criteria\n" +
                    "\n".join(f"- [x] {a['id']}: {a['text']}" for a in acs) +
                    f"\n\nTests: {result.tests_passed}/{result.tests_passed + result.tests_failed}, build "
                    f"{'ok' if result.build_ok else 'failed'}.{refs}\n\nBuilt by Foundry eng.builder (Argon, {how}) — run {ctx.run_id}")
            pr = await client.open_pr(user, repo, branch, "main", title, redact(body))
            return {**pr, "branch": branch}
        except Exception as exc:  # noqa: BLE001 - the build is still usable locally
            await ctx.log("warn", f"publishing to GitHub failed ({type(exc).__name__}: {redact(str(exc))[:300]})")
            return None

    # ------------------------------------------------------------------ eng.review (Mina)

    async def review(self, ticket: dict[str, Any], ctx: HandlerContext) -> HandlerResult:
        vid = venture_id(ticket, ctx)
        payload = payload_of(ticket)
        build = await self.latest_build(ctx, ticket)
        if build is None:
            return HandlerResult(outcome="failed", note="no completed build found to review")
        bres = result_of(build)
        diff = ""
        ws = bres.get("workspace_path")
        if ws and Path(ws).exists():
            diff = workspace.diff_text(Path(ws))
        elif bres.get("pr_number"):
            gh = await self.github(ctx, vid)
            venture = await self.venture_row(ctx, vid)
            if gh and venture.get("repo_full_name"):
                try:
                    files = await gh[1].list_pr_files(gh[2], venture["repo_full_name"], int(bres["pr_number"]))
                    diff = "\n".join(f"--- {f.get('filename')}\n{f.get('patch') or '(binary or large file)'}" for f in files)
                except Exception as exc:  # noqa: BLE001
                    await ctx.log("warn", f"could not load PR files ({type(exc).__name__})")
        if not diff:
            return HandlerResult(outcome="failed", note="diff unavailable for review")
        acs = payload.get("acceptance_criteria") or payload_of(build).get("acceptance_criteria") or []
        arch = payload.get("architecture_md") or payload_of(build).get("architecture_md") or ""
        prompt = ("ACCEPTANCE CRITERIA:\n" + "\n".join(f"- {a['id']}: {a['text']}" for a in acs) +
                  f"\n\nARCHITECTURE:\n{arch or '(none)'}\n\nCHANGE: {build.get('title')}\n\nDIFF:\n{diff}")
        out, res = await ctx.llm.generate_json("engineering_review", prompt, ReviewOut, system=load_prompt("eng.reviewer"),
                                               **llm_kw(ticket, ctx))
        rv: ReviewOut = out  # type: ignore[assignment]
        high = [c for c in rv.comments if c.severity == "high"]
        medium = [c for c in rv.comments if c.severity == "medium"]
        verdict = rv.verdict
        needs_fix = verdict == "changes_requested" and bool(high)
        md = (f"**Verdict:** {verdict}\n\n{redact(rv.summary)}\n\n## Comments\n" +
              ("\n".join(f"- [{c.severity}] `{c.file}`{f':{c.line}' if c.line else ''} — {redact(c.comment)}" for c in rv.comments)
               or "- none") +
              ("\n\n## Security notes\n" + "\n".join(f"- {redact(s)}" for s in rv.security_notes) if rv.security_notes else ""))
        task = payload.get("task_key") or payload_of(build).get("task_key") or tid8(str(build["id"]))
        result = {"verdict": verdict, "high": len(high), "medium": len(medium), "low": len(rv.comments) - len(high) - len(medium),
                  "task_key": task, "build_ticket_id": build["id"], "interaction_id": res.interaction_id}
        artifacts = [NewArtifact(kind="doc", title=f"Review: {verdict} — {build.get('title', '')}"[:200], content_md=md,
                                 summary=f"{verdict}: {len(high)} high, {len(medium)} medium",
                                 meta={"review": rv.model_dump(), "build_ticket_id": build["id"]})]
        if not needs_fix:
            return HandlerResult(outcome="done", result=result, artifacts=artifacts,
                                 messages=[NewMessage(channel_slug="dept-engineering", kind="handoff",
                                                      body=f"Reviewed {task}: {verdict} ({len(high)} high, {len(medium)} medium "
                                                           "note(s)). @Ben please verify.")])
        fixes = await self.task_tickets(ctx, vid, task, ("eng.fix",))
        if len(fixes) >= MAX_FIXES_PER_TASK:
            return HandlerResult(outcome="done", result={**result, "escalated": True}, artifacts=artifacts, messages=[
                NewMessage(channel_slug="incidents", kind="incident",
                           body=f"{task}: {len(fixes)} fixes already and review still requests changes — @Kai needs a design-level look."),
                NewMessage(channel_slug="dept-engineering", kind="request",
                           body=f"@Kai {task} keeps failing review; escalating for a redesign.")])
        await self.supersede_verify(ctx, ticket)
        comments = [c.model_dump() for c in rv.comments if c.severity in ("high", "medium")]
        chain = self.fix_chain(task_key=task, title=str(build.get("title") or task),
                               body=f"Mina requested changes:\n{redact(rv.summary)}",
                               payload={"review_comments": comments, "pr_number": bres.get("pr_number"), "source": "review"},
                               acs=acs, architecture_md=arch, n=len(fixes) + 1)
        return HandlerResult(outcome="done", result=result, artifacts=artifacts, new_tickets=chain,
                             messages=[NewMessage(channel_slug="dept-engineering", kind="delegation",
                                                  body=f"Review {task}: changes requested ({len(high)} high). @Zara fix ticket created.")])

    async def supersede_verify(self, ctx: HandlerContext, ticket: dict[str, Any]) -> None:
        """The qa.verify waiting on this review is replaced by the fix chain's own verify (one merge gate per task)."""
        if ctx.db is None or not ticket.get("id"):
            return
        from .. import bus
        from ..ids import utc_now

        rows = await ctx.db.fetch_all("SELECT t.id, t.venture_id FROM ticket_deps d JOIN tickets t ON t.id = d.ticket_id "
                                      "WHERE d.depends_on_id = ? AND t.type = 'qa.verify' AND t.status IN ('open','blocked')",
                                      (ticket["id"],))
        if not rows:
            return
        async with ctx.db.tx() as tx:
            for r in rows:
                await tx.execute("UPDATE tickets SET status = 'cancelled', updated_at = ?, result_json = ? WHERE id = ?",
                                 (utc_now(), json.dumps({"note": "superseded by the fix chain after review"}), r["id"]))
                await bus.emit(tx, venture_id=r["venture_id"], type="ticket.updated", entity_kind="ticket", entity_id=r["id"],
                               data={"id": r["id"], "status": "cancelled"})
