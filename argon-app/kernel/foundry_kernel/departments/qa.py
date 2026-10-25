# OWNER: ayan
"""qa.verify (Ben) — 03-company-kernel/02-autonomous-engineering-loop.md §5–§6.
1. Independent acceptance tests from the spec ACs + the public API surface only (never the builder's tests),
2. full suite + build in the build workspace (local) or an Antigravity sandbox on the PR branch,
3. visual QA through `ctx.use_computer` (Cua) when available,
then the `merge` gate; the approved re-entry merges (Composio, gated) or accepts the local build."""
from __future__ import annotations

import re
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

from ..contracts import (
    HandlerContext,
    HandlerResult,
    NewApproval,
    NewArtifact,
    NewMessage,
)
from ..executors import antigravity as ag
from ..executors import fileblocks, workspace
from ..executors.local_loop import LocalLoopExecutor, VerifyResult, load_prompt
from ..models import ARGON
from ..security import redact

if TYPE_CHECKING:
    from .engineering import EngineeringHandler

EXPORT_RE = re.compile(r"^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|class|interface|type|enum)\b[^\n]*",
                       re.MULTILINE)
AC_NAME_RE = re.compile(r"\b(AC-\d+)\b")


def public_api(ws: Path) -> str:
    """Exported declarations (first line of each) and component props from src/ — the surface Ben may test."""
    out: list[str] = []
    src = ws / "src"
    if not src.exists():
        return "(no src/)"
    for p in sorted(src.rglob("*")):
        if p.suffix not in (".ts", ".tsx") or p.name == "main.tsx" or "node_modules" in p.parts:
            continue
        lines = [m.group(0).strip().rstrip("{").strip() for m in EXPORT_RE.finditer(p.read_text("utf-8"))]
        if lines:
            out.append(f"// {p.relative_to(ws)}\n" + "\n".join(lines))
    return "\n\n".join(out) or "(no exports found)"


def acceptance_status(acs: list[dict[str, str]], v: VerifyResult, test_rel: str) -> list[dict[str, str]]:
    statuses: list[dict[str, str]] = []
    for ac in acs:
        mine = [s for name, s in v.tests.items()
                if v.test_files.get(name, "").endswith(test_rel) and ac["id"] in AC_NAME_RE.findall(name)]
        status = "fail" if any(s == "failed" for s in mine) else ("pass" if mine and all(s == "passed" for s in mine) else "missing")
        statuses.append({"id": ac["id"], "status": status})
    return statuses


async def verify(h: EngineeringHandler, ticket: dict[str, Any], ctx: HandlerContext) -> HandlerResult:
    from .engineering import llm_kw, payload_of, result_of, tid8, venture_id

    if ctx.approval_result is not None:
        return await merge(h, ticket, ctx)
    vid = venture_id(ticket, ctx)
    payload = payload_of(ticket)
    build = await h.latest_build(ctx, ticket)
    if build is None:
        return HandlerResult(outcome="failed", note="no completed build found to verify")
    bres = result_of(build)
    task = payload.get("task_key") or bres.get("task_key") or tid8(str(build["id"]))
    acs = payload.get("acceptance_criteria") or payload_of(build).get("acceptance_criteria") or \
        await h.acceptance_criteria(ctx, vid)
    my8 = tid8(str(ticket.get("id") or ctx.run_id))
    test_rel = f"tests/acceptance/{my8}.test.ts"
    ws_path = bres.get("workspace_path")
    ws = Path(ws_path) if ws_path and Path(ws_path).exists() else None
    surface = public_api(ws) if ws else "(see the repository's src/ exports)"
    prompt = ("ACCEPTANCE CRITERIA:\n" + "\n".join(f"- {a['id']}: {a['text']}" for a in acs) +
              f"\n\nPUBLIC API (exports and component props):\n{surface}")
    res = await ctx.llm.generate("qa_analyze", prompt, system=load_prompt("eng.qa").replace("{tid8}", my8),
                                 **llm_kw(ticket, ctx))
    parsed = fileblocks.parse(res.text)
    block = next((b for b in parsed.blocks if b.content and b.path.startswith("tests/acceptance/")),
                 next((b for b in parsed.blocks if b.content), None))
    if block is None or not block.content:
        return HandlerResult(outcome="failed", note="QA produced no acceptance test file")
    test_src = redact(block.content).rstrip("\n") + "\n"

    venture = await h.venture_row(ctx, vid)
    gh = await h.github(ctx, vid)
    repo = venture.get("repo_full_name") if gh else None
    branch = bres.get("branch")
    if ws is not None:
        target = fileblocks.contained_path(ws, test_rel)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(test_src, "utf-8")
        v = await LocalLoopExecutor(ctx.settings, ctx.llm, runner=h.runner).verify(ws)
        acceptance = acceptance_status(acs, v, test_rel)
        passed, failed, build_ok, failures = v.passed, v.failed, v.build_ok, v.failures
        ok = v.ok and all(a["status"] == "pass" for a in acceptance)
        if gh and repo and branch:  # the acceptance test joins the PR branch (protected by the no-weakening rule)
            try:
                await gh[1].put_file(gh[2], repo, branch, test_rel, test_src.encode(), f"foundry({my8}): acceptance tests")
            except Exception as exc:  # noqa: BLE001
                await ctx.log("warn", f"could not push the acceptance test to {branch} ({type(exc).__name__})")
                return HandlerResult(outcome="failed", note="acceptance tests could not be published to the PR; merge approval not requested")
    elif repo and branch:
        sandbox = await sandbox_verify(ctx, ticket, repo, branch, test_rel, test_src)
        if sandbox is None:
            return HandlerResult(outcome="failed", note="Antigravity QA sandbox did not return a FOUNDRY_RESULT")
        passed, failed, build_ok, failures = sandbox.tests.passed, sandbox.tests.failed, sandbox.build_ok, sandbox.failures
        failed_ids = {i for f in failures for i in AC_NAME_RE.findall(f)}
        acceptance = [{"id": a["id"], "status": "fail" if a["id"] in failed_ids else
                       ("pass" if sandbox.status == "passed" else "missing")} for a in acs]
        ok = sandbox.status == "passed" and failed == 0 and build_ok
    else:
        return HandlerResult(outcome="failed", note="build workspace and PR branch both unavailable")

    visual = await visual_qa(ctx, vid, build, acs) if ok else {"status": "not_run", "reason": "tests failed"}
    review = await last_review(h, ctx, vid, task)
    if visual.get("status") in ("failed", "error"):
        ok = False
        failures.append("visual QA failed")
    if review.get("high", 0) or review.get("escalated"):
        ok = False
        failures.append("review has unresolved high-severity findings")
    summary = (f"{passed}/{passed + failed} tests, build {'ok' if build_ok else 'failed'}; acceptance "
               f"{sum(a['status'] == 'pass' for a in acceptance)}/{len(acceptance)}; visual QA {visual['status']}")
    report = NewArtifact(kind="test_report", title=f"QA {task}: {'pass' if ok else 'fail'}", summary=summary,
                         content_md=f"{summary}\n\n## Acceptance\n" +
                                    "\n".join(f"- {a['id']}: {a['status']}" for a in acceptance) +
                                    ("\n\n## Failures\n" + "\n".join(f"- {redact(f)[:500]}" for f in failures[:20]) if failures else "") +
                                    f"\n\n## Visual QA\n{visual['status']}" + (f" — {visual.get('reason')}" if visual.get("reason") else ""),
                         meta={"acceptance": acceptance, "tests_passed": passed, "tests_failed": failed,
                               "acceptance_test": test_rel, "screenshots": visual.get("screenshots", []),
                               "computer_task_id": visual.get("task_id")})
    result = {"task_key": task, "build_ticket_id": build["id"], "passed": ok, "tests_passed": passed,
              "tests_failed": failed, "acceptance": acceptance, "visual_qa": visual}
    if not ok:
        fixes = await h.task_tickets(ctx, vid, task, ("eng.fix",))
        if len(fixes) >= 3:
            return HandlerResult(outcome="failed", note=f"QA failed after {len(fixes)} fixes", result=result, artifacts=[report],
                                 messages=[NewMessage(channel_slug="incidents", kind="incident",
                                                      body=f"{task}: QA still failing after {len(fixes)} fixes — @Kai please take a design-level look.")])
        chain = h.fix_chain(task_key=task, title=str(build.get("title") or task),
                            body="Ben's independent acceptance tests fail:\n" + "\n".join(f"- {f[:300]}" for f in failures[:10]),
                            payload={"failures": [redact(f)[:1500] for f in failures[:20]], "acceptance_test": test_rel,
                                     "pr_number": bres.get("pr_number"), "source": "qa"},
                            acs=acs, architecture_md=payload.get("architecture_md") or "", n=len(fixes) + 1)
        return HandlerResult(outcome="done", note="QA failed → eng.fix", result=result, artifacts=[report], new_tickets=chain,
                             messages=[NewMessage(channel_slug="dept-engineering", kind="delegation",
                                                  body=f"QA {task}: {summary}. @Zara fix ticket created with the failing acceptance tests.")])
    local = not bres.get("pr_number")
    gate_payload = {"pr_number": bres.get("pr_number"), "pr_url": bres.get("pr_url"), "local": local,
                    "tests": {"passed": passed, "failed": failed}, "build_ok": build_ok, "acceptance": acceptance,
                    "review": {"verdict": review.get("verdict", "unknown"), "high": review.get("high", 0),
                               "medium": review.get("medium", 0)},
                    "preview_url": bres.get("preview_url"), "iterations": bres.get("iterations"),
                    "first_pass_passed": bres.get("first_pass_passed"), "summary": summary,
                    "build_ticket_id": build["id"], "task_key": task, "visual_qa": visual}
    if not local:
        if gh is None or not repo:
            return HandlerResult(outcome="failed", note="GitHub unavailable; cannot verify PR head", result=result, artifacts=[report])
        try:
            pr = await gh[1].get_pull_request(gh[2], repo, int(bres["pr_number"]))
            head = pr.get("head") or {}
            head_sha = head.get("sha")
            if not re.fullmatch(r"[0-9a-fA-F]{40}", str(head_sha or "")):
                raise ValueError("missing real pull request head SHA")
            if branch and head.get("ref") != branch:
                raise ValueError("pull request branch does not match verified build")
            tested_sha = sandbox.commit if ws is None else None
            if ws is None and not re.fullmatch(r"[0-9a-fA-F]{40}", str(tested_sha or "")):
                raise ValueError("sandbox QA did not identify its tested commit")
            if tested_sha and tested_sha != head_sha:
                raise ValueError("pull request head changed after sandbox QA")
        except Exception as exc:
            await ctx.log("warn", f"could not verify pull request head: {type(exc).__name__}")
            return HandlerResult(outcome="failed", note="cannot verify the tested PR head; merge approval not requested", result=result, artifacts=[report])
        gate_payload.update(repo_full_name=repo, merge_method="squash", head_sha=head_sha)
    if local and ws is not None:
        gate_payload["workspace_sha256"] = workspace.source_digest(ws)
    title = (f"Merge PR #{bres['pr_number']}: {build.get('title', '')}" if not local
             else f"Accept build into the product: {build.get('title', '')}")
    return HandlerResult(outcome="waiting_approval", result=result, artifacts=[report],
                         approval=NewApproval(gate_type="merge", title=title[:200], summary=summary, payload=gate_payload),
                         messages=[NewMessage(channel_slug="dept-engineering", kind="gate",
                                              body=f"QA {task} passed: {summary}. Waiting on the founder's merge approval.")])


async def sandbox_verify(ctx: HandlerContext, ticket: dict[str, Any], repo: str, branch: str, test_rel: str,
                         test_src: str) -> ag.AntigravityResult | None:
    from .engineering import tid8

    prompt = (f"You are Ben, QA in Foundry's Engineering department, working in a Linux sandbox.\n"
              f"REPOSITORY: https://github.com/{repo}\nBRANCH: {branch} (already pushed; check it out)\n"
              "AUTH: git is pre-authenticated through the sandbox proxy. Never print or echo credentials.\n\n"
              f"1. Add this file exactly as given:\n<<<FILE path=\"{test_rel}\">>>\n{test_src}<<<END FILE>>>\n"
              "2. Run `npm ci` (or `npm install`), then `npm test` and `npm run build`. Do NOT change any other file.\n"
              f"3. Commit only that file with message \"foundry({tid8(str(ticket.get('id', '')))}): acceptance tests\" and push the branch.\n"
              "4. Finish with EXACTLY one line: FOUNDRY_RESULT {\"status\":\"passed\"|\"failed\",\"branch\":\"...\","
              "\"commit\":\"<sha>\",\"iterations\":1,\"tests\":{\"passed\":<int>,\"failed\":<int>},\"build_ok\":<bool>,"
              "\"files_changed\":[\"...\"],\"summary\":\"...\",\"failures\":[\"<test full name: message>\"]}")
    cred = await ag.kv_get(ctx.db, ag.KV_CREDENTIAL)

    async def progress(msg: str) -> None:
        await ctx.log("info", f"antigravity (qa): {msg}")

    try:
        res = await ctx.llm.run_agent(agent=ctx.settings.antigravity_agent, agent_config={"type": "antigravity", "model": ARGON},
                                      prompt=prompt, environment=ag.environment(cred), run_id=ctx.run_id,
                                      venture_id=str(ticket.get("venture_id") or ctx.venture["id"]), background=True,
                                      on_progress=progress)
    except Exception as exc:  # noqa: BLE001
        await ctx.log("error", f"antigravity QA sandbox failed: {type(exc).__name__}")
        return None
    return ag.parse_result(res.text)


async def visual_qa(ctx: HandlerContext, vid: str, build: dict[str, Any], acs: list[dict[str, str]]) -> dict[str, Any]:
    """Ben clicks through the preview on a Cua computer; `skipped` (CUA_MODE=off etc.) is recorded, never faked."""
    from .engineering import result_of

    if not result_of(build).get("preview_url"):
        return {"status": "skipped", "reason": "no preview for this build (sandbox/PR-only build)"}
    base = ctx.settings.web_url.rstrip("/")
    start_url = f"{base}/preview/{vid}/{build['id']}/"
    host = urlparse(base).hostname or "localhost"
    goal = ("Open the product preview and check each acceptance criterion in the UI; screenshot each step and report "
            "pass/fail per criterion:\n" + "\n".join(f"- {a['id']}: {a['text']}" for a in acs))
    try:
        res = await ctx.use_computer(goal, [host], start_url, max_steps=20)
    except Exception as exc:  # noqa: BLE001 - visual QA is additive; the test suite already decided
        return {"status": "skipped", "reason": f"computer error: {type(exc).__name__}"}
    if res.status == "skipped":
        await ctx.log("info", f"visual QA skipped: {res.reason}")
    return {"status": res.status, "reason": res.reason, "task_id": res.task_id, "screenshots": res.screenshots,
            "result": res.result}


async def last_review(h: EngineeringHandler, ctx: HandlerContext, vid: str, task: str) -> dict[str, Any]:
    from .engineering import result_of

    done = [t for t in await h.task_tickets(ctx, vid, task, ("eng.review",)) if t["status"] == "done"]
    return result_of(max(done, key=lambda t: t.get("completed_at") or "")) if done else {}


async def merge(h: EngineeringHandler, ticket: dict[str, Any], ctx: HandlerContext) -> HandlerResult:
    """Second pass after the founder decided the merge gate."""
    import json

    from .. import gates
    from .engineering import payload_of, result_of, venture_id

    decision = ctx.approval_result or {}
    approval_id = decision.get("approval_id")
    if decision.get("status") != "approved":
        return HandlerResult(outcome="done", note="not merged",
                             messages=[NewMessage(channel_slug="dept-engineering", kind="status",
                                                  body=f"Merge of '{ticket.get('title', '')}' was rejected — not merged."
                                                       + (f" Note: {decision['note']}" if decision.get("note") else ""))])
    if ctx.db is None:
        return HandlerResult(outcome="failed", note="merge needs the database to check the approval")
    row = await gates.require_approved(ctx.db, approval_id, "merge")
    vid = venture_id(ticket, ctx)
    if row.get("venture_id") != vid or (row.get("ticket_id") and row["ticket_id"] != ticket.get("id")):
        return HandlerResult(outcome="failed", note="merge approval belongs to another venture or ticket")
    gate = json.loads(row.get("payload_json") or "{}")
    task = payload_of(ticket).get("task_key")
    if not gate.get("build_ticket_id") or (task and task != gate.get("task_key")):
        return HandlerResult(outcome="failed", note="merge approval does not identify this task's build")
    venture = await h.venture_row(ctx, vid)
    build = await ctx.db.fetch_one("SELECT * FROM tickets WHERE id = ?", (gate.get("build_ticket_id"),)) \
        if gate.get("build_ticket_id") else await h.latest_build(ctx, ticket)
    if build is None or build.get("venture_id") != vid or build.get("status") != "done" or build.get("type") not in ("eng.build", "eng.fix"):
        return HandlerResult(outcome="failed", note="approved build is unavailable or belongs to another venture")
    bres = result_of(build)
    title = str((build or {}).get("title") or ticket.get("title") or "")
    if gate.get("local", True):
        ws = Path(bres.get("workspace_path") or "")
        if not bres.get("workspace_path") or not ws.exists():
            return HandlerResult(outcome="failed", note="local build workspace is gone; cannot accept it")
        expected = workspace.workspace_path(ctx.settings, vid, str(build["id"]))
        if ws.resolve() != expected.resolve():
            return HandlerResult(outcome="failed", note="build workspace is outside its venture and ticket")
        expected_digest = gate.get("workspace_sha256")
        if not expected_digest or workspace.source_digest(ws) != expected_digest:
            return HandlerResult(outcome="failed", note="workspace changed after QA; a new verification and approval are required")
        dest = workspace.product_main(ctx.settings, vid)
        workspace.copy_product(ws, dest)
        uri = gate.get("preview_url") or bres.get("preview_url")
        merged = {"local": True, "product_path": str(dest)}
    else:
        gh = await h.github(ctx, vid)
        if gh is None or not venture.get("repo_full_name"):
            return HandlerResult(outcome="failed", note="GitHub is not connected; cannot merge the PR")
        composio, client, user = gh
        try:
            await composio.merge_pull_request(ctx.db, client, approval_id=approval_id, user_id=user,
                                              repo_full_name=venture["repo_full_name"], number=int(gate["pr_number"]),
                                              method="squash")
        except Exception as exc:  # noqa: BLE001 - retry policy applies; the approval stays approved
            return HandlerResult(outcome="failed", note=f"merge failed: {type(exc).__name__}: {redact(str(exc))[:300]}")
        uri = venture.get("repo_url") or gate.get("pr_url")
        merged = {"local": False, "pr_number": gate.get("pr_number")}
    tests = gate.get("tests") or {}
    who = row.get("decided_by") or venture.get("founder_name") or "the founder"
    n = f"{tests.get('passed', 0)}/{tests.get('passed', 0) + tests.get('failed', 0)}"
    return HandlerResult(
        outcome="done", note="merged", result={**merged, "task_key": gate.get("task_key")},
        artifacts=[NewArtifact(kind="build", title=f"Shipped: {title}"[:200], uri=uri,
                               summary=f"{n} tests, reviewed, verified; approved by {who}",
                               meta={**merged, "approval_id": approval_id})],
        messages=[NewMessage(channel_slug="all-hands", kind="announcement",
                             body=f"Shipped {gate.get('task_key') or ''} '{title}' — {n} tests, reviewed by Mina, verified by Ben. "
                                  f"Approved by {who}.".replace("Shipped  ", "Shipped "))])
