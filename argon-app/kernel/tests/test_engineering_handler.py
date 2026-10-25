# OWNER: ayan
"""Live-mode engineering handler with FakeLLM + FakeHandlerContext + a real DB (E-01, E-04–E-06 local mode,
E-07 result parsing / fallback)."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from foundry_kernel.api.preview import resolve_preview
from foundry_kernel.departments.engineering import EngineeringHandler
from foundry_kernel.executors import antigravity as ag
from foundry_kernel.executors import executor_name
from foundry_kernel.ids import new_id, utc_now
from foundry_kernel.llm.fake import FakeLLM
from tests.ayan.eng_helpers import FakeRunner, block, notes
from tests.fakes import FakeHandlerContext

ACS = [{"id": "AC-1", "text": "add returns the sum"}, {"id": "AC-2", "text": "App shows the total"}]


def live(settings: Any) -> Any:
    return settings.model_copy(update={"llm_mode": "live", "engineering_executor": "local"})


async def make_venture(db: Any) -> str:
    vid = new_id("ven")
    async with db.tx() as tx:
        await tx.execute("INSERT INTO ventures (id, name, slug, idea, founder_name, composio_user_id, created_at, updated_at) "
                         "VALUES (?,?,?,?,?,?,?,?)", (vid, "Adder", "adder", "Add numbers", "Alex", f"foundry:{vid}", utc_now(), utc_now()))
        await tx.execute("INSERT INTO artifacts (id, venture_id, department_id, kind, title, content_md, meta_json, created_at) "
                         "VALUES (?,?,?,?,?,?,?,?)", (new_id("art"), vid, "intake", "spec", "Spec", "AC-1 ...",
                                                      json.dumps({"acceptance_criteria": ACS}), utc_now()))
    return vid


async def insert_ticket(db: Any, vid: str, type_: str, *, status: str = "done", payload: dict | None = None,
                        result: dict | None = None, title: str = "T1 Adder") -> str:
    tid = new_id("tkt")
    async with db.tx() as tx:
        await tx.execute("INSERT INTO tickets (id, venture_id, type, department_id, title, status, payload_json, result_json, "
                         "created_by, created_at, updated_at, completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                         (tid, vid, type_, "engineering", title, status, json.dumps(payload or {}),
                          json.dumps(result) if result is not None else None, "system", utc_now(), utc_now(), utc_now()))
    return tid


def ctx_for(settings: Any, db: Any, vid: str, agent: str = "eng.tech-lead", approval: dict | None = None) -> FakeHandlerContext:
    return FakeHandlerContext(live(settings), db=db, venture={"id": vid, "name": "Adder", "idea": "Add numbers"},
                              ticket_agent={"id": agent, "department_id": "engineering"}, approval_result=approval)


def design(tasks: list[dict[str, Any]]) -> dict[str, Any]:
    return {"architecture_md": "## Overview\nOne module.", "tasks": tasks, "risks": []}


T1 = {"key": "T1", "title": "Adder", "body": "Implement add", "acceptance_refs": ["AC-1"], "files_hint": [], "depends_on": []}
T2 = {"key": "T2", "title": "UI", "body": "Show total", "acceptance_refs": ["AC-2"], "files_hint": [], "depends_on": ["T1"]}


async def test_design_covers_every_ac_after_one_repair(settings, db) -> None:
    vid = await make_venture(db)
    ctx = ctx_for(settings, db, vid)
    ctx.llm.script("engineering_design", [design([T1]), design([T1, T2])])  # first misses AC-2
    res = await EngineeringHandler().handle({"id": new_id("tkt"), "type": "eng.design", "title": "Design", "venture_id": vid}, ctx)
    assert res.outcome == "done" and len(ctx.llm.calls) == 2
    assert [t.type for t in res.new_tickets] == ["eng.build", "eng.review", "qa.verify"] * 2
    builds = [t for t in res.new_tickets if t.type == "eng.build"]
    assert builds[1].depends_on == ["ref:build:T1"] and builds[1].payload["acceptance_criteria"] == [ACS[1]]
    assert res.new_tickets[2].depends_on == ["ref:review:T1"] and res.artifacts[0].kind == "plan"
    assert any("@Zara" in m.body for m in res.messages)


async def test_design_fails_when_still_invalid(settings, db) -> None:
    vid = await make_venture(db)
    ctx = ctx_for(settings, db, vid)
    ctx.llm.script("engineering_design", [design([T1]), design([T1])])
    res = await EngineeringHandler().handle({"id": new_id("tkt"), "type": "eng.design", "title": "D", "venture_id": vid}, ctx)
    assert res.outcome == "failed" and "AC-2" in res.note


async def build_t1(settings: Any, db: Any, vid: str, runner: FakeRunner) -> tuple[str, dict[str, Any]]:
    h = EngineeringHandler()
    h.runner = runner
    ctx = ctx_for(settings, db, vid, "eng.builder")
    ctx.llm.script("engineering_build", [block("src/lib/add.ts", "export const add = (a: number, b: number) => a + b;")
                                         + "\n" + block("tests/add.test.ts", "import { it, expect } from 'vitest';\nit('adds', () => expect(1).toBe(1));")
                                         + "\n" + notes("adder")])
    payload = {"task_key": "T1", "acceptance_criteria": ACS[:1], "architecture_md": "## A"}
    tid = await insert_ticket(db, vid, "eng.build", status="in_progress", payload=payload)
    res = await h.handle({"id": tid, "type": "eng.build", "title": "T1 Adder", "body": "Implement add", "payload": payload,
                          "venture_id": vid}, ctx)
    assert res.outcome == "done", res.note
    async with db.tx() as tx:
        await tx.execute("UPDATE tickets SET status='done', result_json=? WHERE id=?", (json.dumps(res.result), tid))
    return tid, res.result


async def test_build_local_mode_produces_artifacts(settings, db) -> None:
    vid = await make_venture(db)
    runner = FakeRunner([{"tests": {"adds": ("tests/add.test.ts", "passed")}}])
    tid, result = await build_t1(settings, db, vid, runner)
    assert result["executor"] == "local" and result["final_passed"] and result["preview_url"] == f"/preview/{vid}/{tid}/"
    assert Path(result["workspace_path"], "src/lib/add.ts").exists()
    assert resolve_preview(live(settings).data_dir, vid, tid, "") is not None
    assert resolve_preview(live(settings).data_dir, vid, tid, "../../../kernel.db") is None


async def test_review_changes_requested_creates_fix_chain(settings, db) -> None:
    vid = await make_venture(db)
    await build_t1(settings, db, vid, FakeRunner([{"tests": {"adds": ("tests/add.test.ts", "passed")}}]))
    review_id = await insert_ticket(db, vid, "eng.review", status="in_progress", payload={"task_key": "T1"})
    verify_id = await insert_ticket(db, vid, "qa.verify", status="open", payload={"task_key": "T1"})
    async with db.tx() as tx:
        await tx.execute("INSERT INTO ticket_deps (ticket_id, depends_on_id) VALUES (?,?)", (verify_id, review_id))
    ctx = ctx_for(settings, db, vid, "eng.reviewer")
    ctx.llm.script("engineering_review", [{"verdict": "changes_requested", "summary": "overflow",
                                           "comments": [{"file": "src/lib/add.ts", "line": 1, "severity": "high", "comment": "wrong"}]}])
    res = await EngineeringHandler().handle({"id": review_id, "type": "eng.review", "title": "Review T1",
                                             "payload": {"task_key": "T1"}, "venture_id": vid}, ctx)
    assert res.outcome == "done" and res.result["verdict"] == "changes_requested"
    assert [t.type for t in res.new_tickets] == ["eng.fix", "eng.review", "qa.verify"]
    assert res.new_tickets[0].payload["review_comments"][0]["severity"] == "high"
    assert (await db.fetch_one("SELECT status FROM tickets WHERE id=?", (verify_id,)))["status"] == "cancelled"
    assert "+export const add" in ctx.llm.calls[0][1]  # Mina saw the diff


async def test_review_approve(settings, db) -> None:
    vid = await make_venture(db)
    await build_t1(settings, db, vid, FakeRunner([{"tests": {"adds": ("tests/add.test.ts", "passed")}}]))
    ctx = ctx_for(settings, db, vid, "eng.reviewer")
    ctx.llm.script("engineering_review", [{"verdict": "approve", "summary": "ok", "comments": []}])
    res = await EngineeringHandler().handle({"id": new_id("tkt"), "type": "eng.review", "title": "Review T1",
                                             "payload": {"task_key": "T1"}, "venture_id": vid}, ctx)
    assert res.outcome == "done" and not res.new_tickets and res.artifacts[0].kind == "doc"


async def qa_ticket(db: Any, vid: str) -> dict[str, Any]:
    tid = await insert_ticket(db, vid, "qa.verify", status="in_progress", payload={"task_key": "T1", "acceptance_criteria": ACS[:1]})
    return {"id": tid, "type": "qa.verify", "title": "Verify T1", "payload": {"task_key": "T1", "acceptance_criteria": ACS[:1]},
            "venture_id": vid}


async def test_qa_verify_gates_merge_then_accepts_local_build(settings, db) -> None:
    vid = await make_venture(db)
    build_id, bres = await build_t1(settings, db, vid, FakeRunner([{"tests": {"adds": ("tests/add.test.ts", "passed")}}]))
    ticket = await qa_ticket(db, vid)
    acc_file = f"tests/acceptance/{ticket['id'][-8:].lower()}.test.ts"
    h = EngineeringHandler()
    h.runner = FakeRunner([{"tests": {"adds": ("tests/add.test.ts", "passed"), "AC-1: add returns the sum": (acc_file, "passed")}}])
    ctx = ctx_for(settings, db, vid, "eng.qa")
    ctx.llm.script("qa_analyze", [block("tests/acceptance/x.test.ts", "import { it, expect } from 'vitest';\nit('AC-1: add returns the sum', () => expect(2).toBe(2));")])
    res = await h.handle(ticket, ctx)
    assert res.outcome == "waiting_approval" and res.approval and res.approval.gate_type == "merge"
    p = res.approval.payload
    assert p["local"] is True and p["tests"] == {"passed": 2, "failed": 0} and p["build_ok"]
    assert p["acceptance"] == [{"id": "AC-1", "status": "pass"}] and p["build_ticket_id"] == build_id
    assert p["visual_qa"]["status"] == "skipped"  # FakeHandlerContext.use_computer → skipped, recorded honestly
    assert Path(bres["workspace_path"], acc_file).exists()
    assert "add" in ctx.llm.calls[0][1] and "adds" not in ctx.llm.calls[0][1].split("PUBLIC API")[0]  # no builder tests
    # founder approves → second pass copies the workspace into data/products/<vid>/main
    apr = new_id("apr")
    async with db.tx() as tx:
        await tx.execute("INSERT INTO approvals (id, venture_id, ticket_id, gate_type, title, summary, payload_json, status, "
                         "decided_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                         (apr, vid, ticket["id"], "merge", "Merge", "s", json.dumps(p), "approved", "Alex", utc_now()))
    ctx2 = ctx_for(settings, db, vid, "eng.qa", approval={"approval_id": apr, "status": "approved", "note": None})
    res2 = await h.handle(ticket, ctx2)
    main = Path(live(settings).data_dir) / "products" / vid / "main"
    assert res2.outcome == "done" and res2.note == "merged" and (main / "src/lib/add.ts").exists()
    assert not (main / "node_modules").exists() and not (main / ".git").exists() and (main / acc_file).exists()
    assert res2.artifacts[0].kind == "build" and "Approved by Alex" in res2.messages[0].body


async def test_qa_merge_rejected_and_unapproved(settings, db) -> None:
    vid = await make_venture(db)
    ticket = await qa_ticket(db, vid)
    res = await EngineeringHandler().handle(ticket, ctx_for(settings, db, vid, "eng.qa", approval={"approval_id": "apr_X", "status": "rejected"}))
    assert res.outcome == "done" and res.note == "not merged"
    apr = new_id("apr")
    async with db.tx() as tx:
        await tx.execute("INSERT INTO approvals (id, venture_id, gate_type, title, summary, status, created_at) VALUES (?,?,?,?,?,?,?)",
                         (apr, vid, "merge", "Merge", "s", "pending", utc_now()))
    from foundry_kernel.errors import GateNotApproved

    try:
        await EngineeringHandler().handle(ticket, ctx_for(settings, db, vid, "eng.qa", approval={"approval_id": apr, "status": "approved"}))
        raise AssertionError("merge must require an approved approval row")
    except GateNotApproved:
        pass


async def test_qa_failure_creates_fix_chain(settings, db) -> None:
    vid = await make_venture(db)
    await build_t1(settings, db, vid, FakeRunner([{"tests": {"adds": ("tests/add.test.ts", "passed")}}]))
    ticket = await qa_ticket(db, vid)
    acc_file = f"tests/acceptance/{ticket['id'][-8:].lower()}.test.ts"
    h = EngineeringHandler()
    h.runner = FakeRunner([{"tests": {"AC-1: add returns the sum": (acc_file, "failed")}}])
    ctx = ctx_for(settings, db, vid, "eng.qa")
    ctx.llm.script("qa_analyze", [block(acc_file, "it('AC-1: add returns the sum', () => {});")])
    res = await h.handle(ticket, ctx)
    assert res.outcome == "done" and res.note == "QA failed → eng.fix" and res.approval is None
    assert [t.type for t in res.new_tickets] == ["eng.fix", "eng.review", "qa.verify"]
    assert res.new_tickets[0].payload["failures"]


def test_fake_mode_branch_unchanged(settings) -> None:
    import asyncio

    res = asyncio.run(EngineeringHandler().handle({"type": "qa.verify", "title": "V"}, FakeHandlerContext(settings)))
    assert res.outcome == "waiting_approval" and res.approval and res.approval.payload == {"local": True, "tests": {"passed": 3, "failed": 0}}


# ------------------------------------------------------------------ Antigravity


def test_parse_foundry_result() -> None:
    ok = ('working...\nFOUNDRY_RESULT {"status":"passed","branch":"foundry/abc-x","commit":"deadbeef","iterations":2,'
          '"tests":{"passed":5,"failed":0},"build_ok":true,"files_changed":["src/a.ts"],"summary":"done","failures":[]}\n')
    r = ag.parse_result(ok)
    assert r and r.status == "passed" and r.tests.passed == 5 and r.iterations == 2
    assert ag.parse_result("no result here") is None
    assert ag.parse_result('FOUNDRY_RESULT {"status":"maybe"}') is None
    assert ag.parse_result("FOUNDRY_RESULT {not json}") is None


def test_environment_attaches_credential() -> None:
    env = ag.environment("cred-1")
    entries = {e["domain"]: e for e in env["network"]["allowlist"]}
    assert env["type"] == "remote" and set(entries) == set(ag.ALLOWLIST)
    assert entries["github.com"]["credential"] == "cred-1" and "credential" not in entries["registry.npmjs.org"]
    assert all("credential" not in e for e in ag.environment(None)["network"]["allowlist"])


async def test_antigravity_executor_runs_and_falls_back(settings, db) -> None:
    from foundry_kernel.contracts import ExecutorInput

    s = settings.model_copy(update={"llm_mode": "live"})
    inp = ExecutorInput(venture_id="ven_X", ticket_id="tkt_01HZZZZZABCDEFGH", run_id="run_X", title="Add search",
                        body="b", repo_full_name="alex/adder", acceptance_criteria=ACS)
    llm = FakeLLM()
    llm.script("antigravity", [('FOUNDRY_RESULT {"status":"passed","branch":"foundry/abcdefgh-add-search","commit":"c1",'
                               '"iterations":1,"tests":{"passed":3,"failed":0},"build_ok":true,"files_changed":[],"summary":"ok","failures":[]}')])
    logs: list[str] = []

    async def log(level: str, msg: str) -> None:
        logs.append(msg)

    res = await ag.AntigravityExecutor(s, llm, db).run(inp, log)
    assert res.status == "passed" and res.first_pass_passed and res.branch == "foundry/abcdefgh-add-search"
    assert "alex/adder" in llm.calls[0][1] and "FOUNDRY_RESULT" in llm.calls[0][1]

    class Broken:
        async def run_agent(self, **kw: Any) -> Any:
            raise RuntimeError("503")

    for _ in range(3):
        bad = await ag.AntigravityExecutor(s, Broken(), db).run(inp, log)
        assert bad.status == "failed"
    assert await ag.kv_get(db, ag.KV_OVERRIDE) == "local"
    assert await executor_name(s, db) == "local" and await executor_name(s, None) == "antigravity"
    assert ag.branch_name("tkt_01HZZZZZABCDEFGH", "Fix: the Search UI!", "fix") == "foundry/abcdefgh-fix-fix-the-search-ui"


# ------------------------------------------------------------------ GitHub mode (fake Composio)


class FakeComposioClient:
    configured = True

    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    async def get_ref(self, *a: Any) -> str:
        self.calls.append(("get_ref", a))
        return "sha-main"

    async def create_branch(self, *a: Any) -> None:
        self.calls.append(("create_branch", a))

    async def put_file(self, *a: Any, **kw: Any) -> dict:
        self.calls.append(("put_file", a))
        return {}

    async def open_pr(self, *a: Any) -> dict:
        self.calls.append(("open_pr", a))
        return {"number": 7, "html_url": "https://github.com/alex/adder/pull/7"}

    async def get_pull_request(self, *a: Any) -> dict:
        self.calls.append(("get_pull_request", a))
        branches = [args[2] for name, args in self.calls if name == "create_branch"]
        return {"head": {"sha": "a" * 40, "ref": branches[-1] if branches else "foundry/test"}}

    async def create_repo(self, *a: Any) -> dict:
        self.calls.append(("create_repo", a))
        return {"full_name": "alex/foundry-adder", "html_url": "https://github.com/alex/foundry-adder"}


class FakeComposioModule:
    def __init__(self) -> None:
        self.merged: list[dict[str, Any]] = []

    async def merge_pull_request(self, db: Any, client: Any, **kw: Any) -> dict:
        from foundry_kernel import gates

        await gates.require_approved(db, kw["approval_id"], "merge")
        self.merged.append(kw)
        return {"merged": True}


async def test_github_mode_repo_pr_and_merge(settings, db, monkeypatch) -> None:
    vid = await make_venture(db)
    client, module = FakeComposioClient(), FakeComposioModule()

    async def github(self: Any, ctx: Any, vid_: str) -> Any:
        return module, client, f"foundry:{vid_}"

    monkeypatch.setattr(EngineeringHandler, "github", github)
    # design creates the repo once
    ctx = ctx_for(settings, db, vid)
    ctx.llm.script("engineering_design", [design([{**T1, "acceptance_refs": ["AC-1", "AC-2"]}])])
    res = await EngineeringHandler().handle({"id": new_id("tkt"), "type": "eng.design", "title": "D", "venture_id": vid}, ctx)
    assert res.outcome == "done"
    row = await db.fetch_one("SELECT repo_full_name FROM ventures WHERE id=?", (vid,))
    assert row["repo_full_name"] == "alex/foundry-adder"
    # build publishes the branch file by file and opens a PR
    _, bres = await build_t1(settings, db, vid, FakeRunner([{"tests": {"adds": ("tests/add.test.ts", "passed")}}]))
    names = [c[0] for c in client.calls]
    assert names[:3] == ["create_repo", "get_ref", "create_branch"] and "open_pr" in names
    pushed = [c[1][3] for c in client.calls if c[0] == "put_file"]
    assert "src/lib/add.ts" in pushed and not any(p.startswith(("node_modules", "dist")) for p in pushed)
    assert bres["pr_number"] == 7 and "Built by Foundry eng.builder (Argon, local loop)" in client.calls[-1][1][5]
    # QA → merge gate (not local) → approved → Composio merge (gated)
    ticket = await qa_ticket(db, vid)
    acc_file = f"tests/acceptance/{ticket['id'][-8:].lower()}.test.ts"
    h = EngineeringHandler()
    h.runner = FakeRunner([{"tests": {"AC-1: add returns the sum": (acc_file, "passed")}}])
    qctx = ctx_for(settings, db, vid, "eng.qa")
    qctx.llm.script("qa_analyze", [block(acc_file, "it('AC-1: add returns the sum', () => {});")])
    res = await h.handle(ticket, qctx)
    assert res.approval and res.approval.payload["local"] is False and res.approval.payload["pr_number"] == 7
    assert res.approval.title.startswith("Merge PR #7")
    assert res.approval.payload["repo_full_name"] == "alex/foundry-adder"
    assert res.approval.payload["merge_method"] == "squash"
    assert res.approval.payload["head_sha"] == "a" * 40
    apr = new_id("apr")
    async with db.tx() as tx:
        await tx.execute("INSERT INTO approvals (id, venture_id, gate_type, title, summary, payload_json, status, created_at) "
                         "VALUES (?,?,?,?,?,?,?,?)", (apr, vid, "merge", "Merge", "s", json.dumps(res.approval.payload), "approved", utc_now()))
    done = await h.handle(ticket, ctx_for(settings, db, vid, "eng.qa", approval={"approval_id": apr, "status": "approved"}))
    assert done.note == "merged" and module.merged[0]["number"] == 7 and module.merged[0]["method"] == "squash"


def test_preview_route(client, settings) -> None:
    dist = Path(settings.data_dir) / "workspaces" / "ven_A" / "tkt_B" / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<h1>hi</h1>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    (Path(settings.data_dir) / "secret.txt").write_text("nope")
    assert client.get("/preview/ven_A/tkt_B/").text == "<h1>hi</h1>"
    assert client.get("/preview/ven_A/tkt_B/assets/app.js").status_code == 200
    r = client.get("/preview/ven_A/tkt_B/%2e%2e/%2e%2e/%2e%2e/%2e%2e/secret.txt")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    assert client.get("/preview/ven_A/nope/").status_code == 404


async def test_merge_rejects_approval_from_another_venture(settings, db) -> None:
    vid = await make_venture(db)
    async with db.tx() as tx:
        await tx.execute("UPDATE ventures SET slug=? WHERE id=?", ("first-adder", vid))
    other = await make_venture(db)
    ticket = await qa_ticket(db, vid)
    from foundry_kernel import gates

    async with db.tx() as tx:
        apr = await gates.request_approval(tx, venture_id=other, gate_type="merge", title="Other merge", summary="s",
                                            payload={"local": True})
        await tx.execute("UPDATE approvals SET status='approved' WHERE id=?", (apr,))
    result = await EngineeringHandler().handle(ticket, ctx_for(settings, db, vid, "eng.qa", approval={"approval_id": apr, "status": "approved"}))
    assert result.outcome == "failed" and "another venture" in result.note
    assert not (Path(settings.data_dir) / "products" / vid / "main").exists()


async def test_managed_agent_green_status_with_failed_build_is_rejected(settings, db) -> None:
    from foundry_kernel.contracts import ExecutorInput

    llm = FakeLLM()
    llm.script("antigravity", ['FOUNDRY_RESULT {"status":"passed","iterations":1,"tests":{"passed":3,"failed":0},"build_ok":false}'])
    async def log(level, msg):
        pass
    result = await ag.AntigravityExecutor(live(settings), llm, db).run(
        ExecutorInput(venture_id="ven_X", ticket_id="tkt_X", run_id="run_X", title="x", body="x", repo_full_name="alex/adder"), log)
    assert result.status == "failed" and not result.first_pass_passed


async def test_local_merge_rejects_workspace_changed_after_qa(settings, db) -> None:
    from foundry_kernel import gates
    from foundry_kernel.executors import workspace

    vid = await make_venture(db)
    build_id, bres = await build_t1(settings, db, vid, FakeRunner([{"tests": {"adds": ("tests/add.test.ts", "passed")}}]))
    ticket = await qa_ticket(db, vid)
    ws = Path(bres["workspace_path"])
    payload = {"local": True, "build_ticket_id": build_id, "task_key": "T1", "workspace_sha256": workspace.source_digest(ws)}
    async with db.tx() as tx:
        apr = await gates.request_approval(tx, venture_id=vid, ticket_id=ticket["id"], gate_type="merge", title="Merge", summary="s", payload=payload)
        await tx.execute("UPDATE approvals SET status='approved' WHERE id=?", (apr,))
    (ws / "src/lib/add.ts").write_text("export const add = () => 999;")
    result = await EngineeringHandler().handle(ticket, ctx_for(settings, db, vid, "eng.qa", approval={"approval_id": apr, "status": "approved"}))
    assert result.outcome == "failed" and "changed after QA" in result.note
    assert not workspace.product_main(settings, vid).exists()


async def test_dependent_build_inherits_completed_prerequisite_workspace(settings, db) -> None:
    vid = await make_venture(db)
    parent_id, parent_result = await build_t1(settings, db, vid, FakeRunner([{"tests": {"adds": ("tests/add.test.ts", "passed")}}]))
    payload = {"task_key": "T2", "acceptance_criteria": ACS[1:]}
    ticket_id = await insert_ticket(db, vid, "eng.build", status="in_progress", payload=payload)
    async with db.tx() as tx:
        await tx.execute("INSERT INTO ticket_deps (ticket_id,depends_on_id) VALUES (?,?)", (ticket_id, parent_id))
    h = EngineeringHandler()
    h.runner = FakeRunner([{"tests": {"adds": ("tests/add.test.ts", "passed")}}])
    ctx = ctx_for(settings, db, vid, "eng.builder")
    ctx.llm.script("engineering_build", [block("src/lib/ui.ts", "export const label = 'total';") + "\n" + notes("UI")])
    result = await h.handle({"id": ticket_id, "venture_id": vid, "type": "eng.build", "title": "T2 UI", "payload": payload}, ctx)
    assert result.outcome == "done", result.note
    workspace = Path(result.result["workspace_path"])
    assert (workspace / "src/lib/add.ts").read_bytes() == Path(parent_result["workspace_path"], "src/lib/add.ts").read_bytes()
    assert (workspace / "src/lib/ui.ts").exists() and (workspace / "tests/add.test.ts").exists()
    assert '<<<FILE path="src/lib/add.ts">>>' in ctx.llm.calls[0][1]


@pytest.mark.parametrize("problem", ["missing_sha", "wrong_branch", "acceptance_push_failed"])
async def test_remote_merge_does_not_gate_without_verified_pr_head(settings, db, monkeypatch, problem) -> None:
    vid = await make_venture(db)
    client, module = FakeComposioClient(), FakeComposioModule()
    async with db.tx() as tx:
        await tx.execute("UPDATE ventures SET repo_full_name=? WHERE id=?", ("alex/foundry-adder", vid))
    async def github(self, ctx, vid_):
        return module, client, f"foundry:{vid_}"
    monkeypatch.setattr(EngineeringHandler, "github", github)
    await build_t1(settings, db, vid, FakeRunner([{"tests": {"adds": ("tests/add.test.ts", "passed")}}]))
    ticket = await qa_ticket(db, vid)
    acc_file = f"tests/acceptance/{ticket['id'][-8:].lower()}.test.ts"
    h = EngineeringHandler()
    h.runner = FakeRunner([{"tests": {"AC-1 sum": (acc_file, "passed")}}])
    ctx = ctx_for(settings, db, vid, "eng.qa")
    ctx.llm.script("qa_analyze", [block(acc_file, "it('AC-1 sum', () => {});")])
    async def invalid_head(*args):
        branches = [args[2] for name, args in client.calls if name == "create_branch"]
        return {"head": {"sha": "not-a-sha" if problem == "missing_sha" else "a" * 40,
                         "ref": "other-branch" if problem == "wrong_branch" else branches[-1]}}
    monkeypatch.setattr(client, "get_pull_request", invalid_head)
    if problem == "acceptance_push_failed":
        async def failed_push(*args, **kwargs):
            raise RuntimeError("unavailable")
        monkeypatch.setattr(client, "put_file", failed_push)
    result = await h.handle(ticket, ctx)
    assert result.outcome == "failed" and result.approval is None
    assert "merge approval not requested" in result.note
    assert module.merged == []
