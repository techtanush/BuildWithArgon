# OWNER: ayan
"""support.issue handler (03-company-kernel/03-support-and-pr-loop.md): fake mode unchanged; live triage,
eng.fix creation + loop protection, outreach gate and its re-entry."""
from __future__ import annotations

import json

from foundry_kernel import gates
from foundry_kernel.departments import load_handler
from foundry_kernel.ids import new_id, utc_now
from foundry_kernel.integrations.composio import ComposioClient
from tests.fakes import FakeHandlerContext

BUG = {"category": "bug", "severity": "high", "summary": "Expiry badge missing",
       "repro_steps": ["Open list", "Add milk"], "suspected_area": "src/components/PantryItem.tsx",
       "reply_draft": "Thanks! We're on it.", "duplicate_of": None}
QUESTION = {"category": "question", "severity": "low", "summary": "How to export?", "repro_steps": [],
            "suspected_area": "", "reply_draft": "Not yet, noted.", "duplicate_of": None}
ISSUE = {"number": 12, "title": "Badge missing", "body": "Milk shows no badge", "author": "sam",
         "url": "https://github.com/alex/pantry/issues/12", "labels": ["bug"]}


async def _venture(db, *, github: bool = False) -> dict:
    vid = new_id("ven")
    async with db.tx() as tx:
        await tx.execute("INSERT INTO ventures (id, name, slug, idea, founder_name, status, repo_full_name, composio_user_id, created_at, updated_at) "
                         "VALUES (?,?,?,?,?,?,?,?,?,?)",
                         (vid, "Pantry", f"p-{vid[-6:]}", "idea", "Alex", "running", "alex/pantry" if github else None,
                          f"foundry:{vid}", utc_now(), utc_now()))
        if github:
            await tx.execute("INSERT INTO integrations (id, venture_id, provider, status, account_ref, created_at, updated_at) "
                             "VALUES (?,?, 'github', 'active', 'ca', ?, ?)", (new_id("int"), vid, utc_now(), utc_now()))
    return await db.fetch_one("SELECT * FROM ventures WHERE id = ?", (vid,))


def _live(settings):
    return settings.model_copy(update={"llm_mode": "live"})


def _ticket() -> dict:
    return {"id": new_id("tkt"), "type": "support.issue", "title": "Issue #12: Badge missing", "body": ISSUE["body"], "payload": ISSUE}


async def _add_fix(db, vid: str, status: str) -> None:
    async with db.tx() as tx:
        await tx.execute("INSERT INTO tickets (id, venture_id, type, department_id, title, status, payload_json, created_by, created_at, updated_at) "
                         "VALUES (?,?,?,?,?,?,?,?,?,?)",
                         (new_id("tkt"), vid, "eng.fix", "engineering", "fix", status, json.dumps({"issue_number": 12}), "su.triager", utc_now(), utc_now()))


async def test_fake_mode_unchanged(settings) -> None:
    res = await load_handler("support.issue").handle({"type": "support.issue", "title": "x"}, FakeHandlerContext(settings))
    assert res.outcome == "done" and [a.title for a in res.artifacts] == ["Triage (fake): question"]


async def test_bug_creates_fix_and_outreach_gate(settings, db) -> None:
    v = await _venture(db)
    ctx = FakeHandlerContext(_live(settings), db=db, venture=v, ticket_agent={"id": "su.triager", "department_id": "support"})
    ctx.llm.script("triage", [BUG])
    res = await load_handler("support.issue").handle(_ticket(), ctx)
    assert res.outcome == "waiting_approval"
    assert [t.type for t in res.new_tickets] == ["eng.fix", "eng.review", "qa.verify"]
    assert res.new_tickets[1].depends_on == [f"ref:{res.new_tickets[0].ref}"]
    assert res.new_tickets[2].depends_on == [f"ref:{res.new_tickets[1].ref}"]
    assert all(t.payload["task_key"] == "issue-12" for t in res.new_tickets)
    fix = res.new_tickets[0]
    assert fix.priority == 0 and fix.assigned_agent_id == "eng.builder" and fix.payload["issue_number"] == 12
    assert fix.payload["repro_steps"] == BUG["repro_steps"] and "Milk shows no badge" in fix.body
    assert res.approval and res.approval.gate_type == "outreach" and res.approval.title == "Reply to issue #12"
    assert res.approval.payload == {"channel": "github_comment", "issue_number": 12, "url": ISSUE["url"], "body": "Thanks! We're on it.", "drafted_by": "su.triager"}
    assert res.artifacts[0].kind == "doc" and res.artifacts[0].meta["triage"]["category"] == "bug"
    assert {m.channel_slug for m in res.messages} >= {"dept-support", "dept-engineering"}
    assert ctx.llm.calls[0][0] == "triage"


async def test_question_reply_only(settings, db) -> None:
    v = await _venture(db)
    ctx = FakeHandlerContext(_live(settings), db=db, venture=v)
    ctx.llm.script("triage", [QUESTION])
    res = await load_handler("support.issue").handle(_ticket(), ctx)
    assert res.outcome == "waiting_approval" and res.new_tickets == [] and res.approval.payload["body"] == "Not yet, noted."


async def test_dedupe_open_fix(settings, db) -> None:
    v = await _venture(db)
    await _add_fix(db, v["id"], "in_progress")
    ctx = FakeHandlerContext(_live(settings), db=db, venture=v)
    ctx.llm.script("triage", [BUG])
    res = await load_handler("support.issue").handle(_ticket(), ctx)
    assert res.new_tickets == [] and "already open" in res.note


async def test_three_failed_fixes_escalate(settings, db) -> None:
    v = await _venture(db)
    for _ in range(3):
        await _add_fix(db, v["id"], "failed")
    ctx = FakeHandlerContext(_live(settings), db=db, venture=v)
    ctx.llm.script("triage", [BUG])
    res = await load_handler("support.issue").handle(_ticket(), ctx)
    assert [t.type for t in res.new_tickets] == ["eng.design"] and res.new_tickets[0].assigned_agent_id == "eng.tech-lead"
    assert any(m.channel_slug == "incidents" for m in res.messages)


async def test_reply_posted_after_approval(settings, db, monkeypatch) -> None:
    v = await _venture(db, github=True)
    async with db.tx() as tx:
        apr = await gates.request_approval(tx, venture_id=v["id"], gate_type="outreach", title="Reply to issue #12", summary="s",
                                           payload={"channel": "github_comment", "repo_full_name": v["repo_full_name"], "issue_number": 12, "url": ISSUE["url"], "body": "Thanks!"})
        await tx.execute("UPDATE approvals SET status='approved' WHERE id=?", (apr,))
    posted = []

    async def execute(self, slug, user_id, arguments):
        posted.append((slug, user_id, arguments))
        return {"html_url": "https://github.com/alex/pantry/issues/12#c1"}

    monkeypatch.setattr(ComposioClient, "execute", execute)
    ctx = FakeHandlerContext(_live(settings), db=db, venture=v, approval_result={"approval_id": apr, "status": "approved"})
    res = await load_handler("support.issue").handle(_ticket(), ctx)
    assert res.outcome == "done" and res.note == "reply posted"
    assert posted == [("GITHUB_CREATE_AN_ISSUE_COMMENT", f"foundry:{v['id']}",
                       {"owner": "alex", "repo": "pantry", "issue_number": 12, "body": "Thanks!"})]


async def test_rejected_reply_posts_nothing(settings, db, monkeypatch) -> None:
    v = await _venture(db, github=True)

    async def execute(self, *a, **k):
        raise AssertionError("must not post")

    monkeypatch.setattr(ComposioClient, "execute", execute)
    ctx = FakeHandlerContext(_live(settings), db=db, venture=v, approval_result={"approval_id": "apr_x", "status": "rejected"})
    res = await load_handler("support.issue").handle(_ticket(), ctx)
    assert res.outcome == "done" and "nothing posted" in res.note


async def test_approved_without_github(settings, db) -> None:
    v = await _venture(db)
    ctx = FakeHandlerContext(_live(settings), db=db, venture=v, approval_result={"approval_id": "apr_x", "status": "approved"})
    res = await load_handler("support.issue").handle(_ticket(), ctx)
    assert res.outcome == "done" and res.note == "approved — no GitHub connection"


async def test_ana_drafts_the_reply_with_dept_artifact(settings, db) -> None:  # noqa: ANN001
    from foundry_kernel.departments.support import SupportHandler
    from tests.fakes import FakeHandlerContext

    live = settings.model_copy(update={"llm_mode": "live"})
    ctx = FakeHandlerContext(live, db=db, ticket_agent={"id": "su.triager", "department_id": "support", "display_name": "Yuki"})
    ctx.llm.script("triage", [{"category": "question", "severity": "low", "summary": "How do I export?", "repro_steps": [],
                               "suspected_area": "", "reply_draft": "Yuki draft", "duplicate_of": None}])
    ctx.llm.script("dept_artifact", [{"reply": "Thanks for asking! You can export from Settings."}])
    ticket = {"id": "tkt_X", "type": "support.issue", "title": "Export?", "body": "",
              "payload": {"number": 5, "title": "Export?", "body": "How?", "author": "u", "url": "https://x/5", "labels": []}}
    res = await SupportHandler().handle(ticket, ctx)
    assert res.outcome == "waiting_approval" and res.approval is not None
    assert res.approval.payload["body"].startswith("Thanks for asking") and res.approval.payload["drafted_by"] == "su.liaison"
    call = next(k for k in ctx.llm.call_kwargs if k["job"] == "dept_artifact")
    assert call["agent_id"] == "su.liaison"


async def test_reply_rejects_cross_venture_approval(settings, db, monkeypatch) -> None:
    v = await _venture(db, github=True)
    async with db.tx() as tx:
        other = "ven_other"
        # Use a valid second venture so the approval FK is enforced too.
        await tx.execute("INSERT INTO ventures (id,name,slug,idea,founder_name,composio_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
                         (other, "Other", "other", "Other", "Alex", "foundry:ven_other", utc_now(), utc_now()))
        apr = await gates.request_approval(tx, venture_id=other, gate_type="outreach", title="Reply", summary="s",
                                           payload={"issue_number":12,"body":"Not authorized"})
        await tx.execute("UPDATE approvals SET status='approved' WHERE id=?", (apr,))
    async def execute(self, *a, **kw):
        raise AssertionError("cross-venture approval must not post")
    monkeypatch.setattr(ComposioClient, "execute", execute)
    ctx = FakeHandlerContext(_live(settings), db=db, venture=v, approval_result={"approval_id":apr,"status":"approved"})
    result = await load_handler("support.issue").handle(_ticket(), ctx)
    assert result.outcome == "failed" and "another venture" in result.note


async def test_outreach_gate_records_repository_scope(settings, db) -> None:
    v = await _venture(db, github=True)
    ctx = FakeHandlerContext(_live(settings), db=db, venture=v)
    ctx.llm.script("triage", [QUESTION])
    result = await load_handler("support.issue").handle(_ticket(), ctx)
    assert result.approval and result.approval.payload["repo_full_name"] == v["repo_full_name"]
    assert result.approval.payload["issue_number"] == 12


async def test_support_bug_chain_carries_spec_acceptance_and_plan(settings, db) -> None:
    v = await _venture(db)
    acs = [{"id": "AC-1", "text": "Expiry badge is visible"}]
    async with db.tx() as tx:
        await tx.execute("INSERT INTO artifacts (id,venture_id,department_id,kind,title,content_md,meta_json,created_at) VALUES (?,?,?,?,?,?,?,?)",
                         (new_id("art"), v["id"], "intake", "spec", "Spec", "AC-1 Expiry badge", json.dumps({"acceptance_criteria": acs}), utc_now()))
        await tx.execute("INSERT INTO artifacts (id,venture_id,department_id,kind,title,content_md,created_at) VALUES (?,?,?,?,?,?,?)",
                         (new_id("art"), v["id"], "engineering", "plan", "Plan", "Badge architecture", utc_now()))
    ctx = FakeHandlerContext(_live(settings), db=db, venture=v)
    ctx.llm.script("triage", [{**BUG, "reply_draft": ""}])
    result = await load_handler("support.issue").handle(_ticket(), ctx)
    assert result.outcome == "done"
    assert [t.type for t in result.new_tickets] == ["eng.fix", "eng.review", "qa.verify"]
    assert all(t.payload["acceptance_criteria"] == acs for t in result.new_tickets)
    assert all(t.payload["architecture_md"] == "Badge architecture" for t in result.new_tickets)
    assert result.new_tickets[1].assigned_agent_id == "eng.reviewer"
    assert result.new_tickets[2].assigned_agent_id == "eng.qa"


async def test_support_bug_dedupes_while_qa_is_waiting_for_merge(settings, db) -> None:
    v = await _venture(db)
    await _add_fix(db, v["id"], "done")
    async with db.tx() as tx:
        await tx.execute("INSERT INTO tickets (id,venture_id,type,department_id,title,status,payload_json,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                         (new_id("tkt"), v["id"], "qa.verify", "engineering", "Verify issue", "waiting_approval",
                          json.dumps({"task_key":"issue-12"}), "system", utc_now(), utc_now()))
    ctx = FakeHandlerContext(_live(settings), db=db, venture=v)
    ctx.llm.script("triage", [{**BUG, "reply_draft":""}])
    result = await load_handler("support.issue").handle(_ticket(), ctx)
    assert result.new_tickets == [] and "already open" in result.note
