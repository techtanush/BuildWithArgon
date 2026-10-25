# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.

"""support.issue handler (Yuki, Flash-Lite `triage`). Spec: 03-company-kernel/03-support-and-pr-loop.md,
departments/12-support.md. Fake mode keeps the seed behaviour exactly.

Pass 1: triage → bug: `eng.fix` for Zara (with loop protection) + optional repro on a Cua computer;
feature request: note to #exec; any reply draft → `outreach` gate. Pass 2 (gate re-entry): approved →
post the reply on GitHub (gated function); rejected → nothing is posted."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urljoin, urlparse

from pydantic import BaseModel, Field

from ..contracts import (
    HandlerContext,
    HandlerResult,
    NewApproval,
    NewArtifact,
    NewMessage,
    NewTicket,
)
from ..integrations import composio
from ..security import redact

PROMPTS = Path(__file__).with_name("prompts")
OPEN_STATUSES = ("open", "in_progress", "waiting_approval", "blocked")
MAX_FAILED_FIXES = 3


class TriageOut(BaseModel):
    category: Literal["bug", "question", "feature_request", "duplicate", "spam"]
    severity: Literal["critical", "high", "medium", "low"] = "medium"
    summary: str
    repro_steps: list[str] = Field(default_factory=list)
    suspected_area: str = ""
    reply_draft: str = ""
    duplicate_of: int | None = None


class LiaisonReply(BaseModel):
    reply: str = ""


def _payload(ticket: dict[str, Any]) -> dict[str, Any]:
    p = ticket.get("payload")
    if p is None and ticket.get("payload_json"):
        p = json.loads(ticket["payload_json"])
    return dict(p or {})


def _prompt(name: str) -> str:
    text = (PROMPTS / name).read_text()
    return "\n".join(line for line in text.splitlines() if not line.startswith("<!-- OWNER"))


class SupportHandler:
    ticket_types = ("support.issue",)

    async def handle(self, ticket: dict[str, Any], ctx: HandlerContext) -> HandlerResult:
        if ctx.settings.llm_mode == "fake":
            return HandlerResult(outcome="done", artifacts=[NewArtifact(kind="doc", title="Triage (fake): question")])
        if ctx.approval_result is not None:
            return await self._after_gate(ticket, ctx)
        return await self._triage(ticket, ctx)

    # ------------------------------------------------------------------ pass 1

    async def _triage(self, ticket: dict[str, Any], ctx: HandlerContext) -> HandlerResult:
        issue = _payload(ticket)
        number = issue.get("number")
        label = f"#{number}" if number is not None else f"'{ticket.get('title', '')}'"
        product = await ctx.context_for(["spec", "plan", "build"])
        prompt = (
            f"ISSUE {label}\nTitle: {issue.get('title') or ticket.get('title', '')}\n"
            f"Author: {issue.get('author', 'unknown')}\nLabels: {', '.join(issue.get('labels') or []) or 'none'}\n"
            f"URL: {issue.get('url', '')}\n\nBody:\n{issue.get('body') or ticket.get('body', '')}\n\n"
            f"PRODUCT SUMMARY (spec, plan, recent builds):\n{product or '(none yet)'}")
        triage, _ = await ctx.llm.generate_json("triage", prompt, TriageOut, system=_prompt("su.triager.md"),
                                                run_id=ctx.run_id, venture_id=ctx.venture.get("id"),
                                                agent_id=ctx.agent.get("id"), department_id="support")
        assert isinstance(triage, TriageOut)
        await ctx.log("info", f"triage {label}: {triage.category}/{triage.severity} — {triage.summary}")

        new_tickets: list[NewTicket] = []
        messages: list[NewMessage] = [NewMessage(
            channel_slug="dept-support", kind="status",
            body=f"New issue {label} ({triage.category}, {triage.severity}): {triage.summary}")]
        meta: dict[str, Any] = {"triage": triage.model_dump(), "issue": issue}
        notes: list[str] = []

        if triage.category == "bug":
            repro = await self._repro(triage, ctx)
            if repro is not None:
                meta["repro"] = repro
            decision = await self._fix_decision(ctx, number)
            if decision == "create":
                body = (f"Bug from issue {label}: {triage.summary}\n\nRepro steps:\n"
                        + "\n".join(f"{i + 1}. {s}" for i, s in enumerate(triage.repro_steps))
                        + f"\n\nSuspected area: {triage.suspected_area or 'unknown'}\n\nIssue text:\n"
                        + str(issue.get("body") or ticket.get("body", "")))
                new_tickets.append(NewTicket(
                    type="eng.fix", title=f"Fix {label}: {triage.summary}"[:200], body=body,
                    payload={"issue_number": number, "summary": triage.summary, "repro_steps": triage.repro_steps,
                             "suspected_area": triage.suspected_area, "issue_url": issue.get("url", "")},
                    priority=0 if triage.severity in ("critical", "high") else 1, assigned_agent_id="eng.builder"))
                messages.append(NewMessage(channel_slug="dept-engineering", kind="delegation",
                                           body=f"@Kai bug from {label}: {triage.summary} — eng.fix for Zara."
                                                + (" Repro screenshots attached." if repro and repro.get("screenshots") else "")))
                notes.append("bug → eng.fix")
            elif decision == "open_exists":
                notes.append("bug → eng.fix already open")
            else:  # too many failed fixes → design-level look
                history = f"{MAX_FAILED_FIXES} eng.fix attempts for issue {label} failed. Latest triage: {triage.summary}"
                new_tickets.append(NewTicket(type="eng.design", title=f"Redesign for issue {label}", body=history,
                                             payload={"issue_number": number, "reason": "repeated_fix_failures"},
                                             priority=1, assigned_agent_id="eng.tech-lead"))
                messages.append(NewMessage(channel_slug="incidents", kind="incident",
                                           body=f"Issue {label}: {MAX_FAILED_FIXES} fixes failed — escalated to Kai for a design-level look."))
                notes.append("bug → escalated to eng.design")
        elif triage.category == "feature_request":
            messages.append(NewMessage(channel_slug="exec", kind="request",
                                       body=f"@Rhea feature request from {label}: {triage.summary}"))
            notes.append("feature request → #exec")

        artifact = NewArtifact(kind="doc", title=f"Triage {label}: {triage.category} ({triage.severity})",
                               summary=redact(triage.summary),
                               content_md=redact(_triage_md(label, triage)), uri=issue.get("url") or None,
                               meta=meta)
        result = {"category": triage.category, "severity": triage.severity, "issue_number": number}
        if triage.reply_draft.strip() and triage.category != "spam":
            reply, drafted_by = await self._liaison_reply(ctx, label, issue, triage)
            notes.append(f"reply drafted by {drafted_by}")
            messages.append(NewMessage(channel_slug="dept-support", kind="delegation",
                                       body=f"@Ana reply to {label} drafted — waiting on the founder's approval."))
            approval = NewApproval(
                gate_type="outreach", title=f"Reply to issue {label}",
                summary=f"Post this reply on GitHub issue {label}: {triage.summary}"[:300],
                payload={"channel": "github_comment", "issue_number": number, "url": issue.get("url", ""),
                         "body": redact(reply), "drafted_by": drafted_by})
            return HandlerResult(outcome="waiting_approval", note="; ".join(notes + ["reply → outreach gate"]),
                                 result=result, artifacts=[artifact], new_tickets=new_tickets, messages=messages,
                                 approval=approval)
        return HandlerResult(outcome="done", note="; ".join(notes) or triage.category, result=result,
                             artifacts=[artifact], new_tickets=new_tickets, messages=messages)

    async def _liaison_reply(self, ctx: HandlerContext, label: str, issue: dict[str, Any],
                             triage: TriageOut) -> tuple[str, str]:
        """Ana (su.liaison) writes the user-facing reply with dept_artifact (03-company-kernel/10 §2), starting from
        Yuki's draft; on any failure Yuki's draft is used and the note says so."""
        prompt = (f"{_prompt('su.liaison')}\n\nDraft the reply to GitHub issue {label}.\nISSUE TITLE: {issue.get('title', '')}\n"
                  f"ISSUE BODY:\n{str(issue.get('body', ''))[:4000]}\nTRIAGE: {triage.category}, {triage.severity}: {triage.summary}\n"
                  f"YUKI'S DRAFT: {triage.reply_draft}\nReturn ONLY JSON: {{\"reply\": \"<= 120 words\"}}")
        try:
            out, _ = await ctx.llm.generate_json("dept_artifact", prompt, LiaisonReply, run_id=ctx.run_id,
                                                 venture_id=ctx.venture.get("id"), agent_id="su.liaison",
                                                 department_id="support")
            reply = str(getattr(out, "reply", "")).strip()
            if reply:
                return reply, "su.liaison"
        except Exception as exc:  # noqa: BLE001 — Yuki's draft still goes to the gate
            await ctx.log("warn", f"su.liaison reply failed, using the triage draft: {str(exc)[:200]}")
        return triage.reply_draft, "su.triager"

    async def _fix_decision(self, ctx: HandlerContext, number: Any) -> Literal["create", "open_exists", "escalate"]:
        """Loop protection (03-support-and-pr-loop.md): one open eng.fix per issue; 3 failed → escalate."""
        if ctx.db is None or number is None:
            return "create"
        rows = await ctx.db.fetch_all(
            "SELECT status FROM tickets WHERE venture_id = ? AND type = 'eng.fix' "
            "AND json_extract(payload_json, '$.issue_number') = ?", (ctx.venture.get("id"), number))
        if any(r["status"] in OPEN_STATUSES for r in rows):
            return "open_exists"
        if sum(1 for r in rows if r["status"] == "failed") >= MAX_FAILED_FIXES:
            return "escalate"
        return "create"

    async def _repro(self, triage: TriageOut, ctx: HandlerContext) -> dict[str, Any] | None:
        """Yuki reproduces UI bugs on the latest preview with a cloud computer (skipped results are fine)."""
        if ctx.db is None or not triage.repro_steps:
            return None
        row = await ctx.db.fetch_one(
            "SELECT uri FROM artifacts WHERE venture_id = ? AND kind = 'preview' AND uri IS NOT NULL "
            "ORDER BY created_at DESC LIMIT 1", (ctx.venture.get("id"),))
        if row is None:
            return None
        start_url = urljoin(ctx.settings.web_url.rstrip("/") + "/", str(row["uri"]))
        host = urlparse(start_url).hostname or "localhost"
        goal = ("Follow these steps on the preview and capture what happens:\n"
                + "\n".join(f"{i + 1}. {s}" for i, s in enumerate(triage.repro_steps)))
        res = await ctx.use_computer(goal, [host], start_url, max_steps=20)
        await ctx.log("info", f"repro on computer: {res.status} {res.reason}".strip())
        return {"status": res.status, "task_id": res.task_id, "screenshots": res.screenshots, "reason": res.reason}

    # ------------------------------------------------------------------ pass 2 (gate re-entry)

    async def _after_gate(self, ticket: dict[str, Any], ctx: HandlerContext) -> HandlerResult:
        decision = ctx.approval_result or {}
        approval_id = decision.get("approval_id")
        issue = _payload(ticket)
        label = f"#{issue.get('number')}"
        if decision.get("status") != "approved":
            return HandlerResult(outcome="done", note="reply rejected — nothing posted",
                                 messages=[NewMessage(channel_slug="dept-support", body=f"Reply to {label} was not approved; nothing posted.")])
        approval = await ctx.db.fetch_one("SELECT payload_json FROM approvals WHERE id = ?", (approval_id,)) if ctx.db else None
        payload = json.loads(approval["payload_json"]) if approval else {}
        integration = await composio.github_integration(ctx.db, ctx.venture["id"]) if ctx.db else None
        repo = ctx.venture.get("repo_full_name")
        number = payload.get("issue_number", issue.get("number"))
        if integration is None or not repo or number is None:
            return HandlerResult(outcome="done", note="approved — no GitHub connection",
                                 messages=[NewMessage(channel_slug="dept-support",
                                                      body=f"Reply to {label} approved, but GitHub isn't connected — not posted.")])
        client = composio.ComposioClient(ctx.settings)
        try:
            res = await composio.create_issue_comment(ctx.db, client, approval_id=approval_id,
                                                      user_id=ctx.venture["composio_user_id"], repo_full_name=repo,
                                                      number=int(number), body=str(payload.get("body", "")))
        except composio.ComposioError as exc:
            await ctx.log("warn", f"posting reply failed: {exc.user_message}")
            return HandlerResult(outcome="retry", note=f"posting reply failed: {exc.user_message}")
        url = res.get("html_url", "")
        return HandlerResult(outcome="done", note="reply posted", result={"comment_url": url},
                             messages=[NewMessage(channel_slug="dept-support", kind="status",
                                                  body=f"Posted the approved reply on {label}." + (f" {url}" if url else ""))])


def _triage_md(label: str, t: TriageOut) -> str:
    steps = "\n".join(f"{i + 1}. {s}" for i, s in enumerate(t.repro_steps)) or "—"
    dup = f"\n**Duplicate of:** #{t.duplicate_of}" if t.duplicate_of else ""
    return (f"## Triage {label}\n\n**Category:** {t.category} · **Severity:** {t.severity}\n\n{t.summary}\n\n"
            f"### Repro steps\n{steps}\n\n**Suspected area:** {t.suspected_area or '—'}{dup}\n\n"
            f"### Reply draft\n{t.reply_draft or '—'}\n")
