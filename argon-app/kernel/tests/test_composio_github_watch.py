# OWNER: ayan
"""github_watch.poll_once: new issues -> support.issue, PR comments -> eng.fix (E-08)."""
from __future__ import annotations

import json
from types import SimpleNamespace

from pydantic import SecretStr

from foundry_kernel.ids import new_id, utc_now
from foundry_kernel.integrations import github_watch
from foundry_kernel.integrations.composio import ComposioError


class FakeComposio:
    def __init__(self, issues=None, comments=None, fail=False) -> None:
        self.issues = issues or []
        self.comments = comments or {}
        self.fail = fail
        self.since_seen: list = []

    async def list_issues(self, user_id, repo, since):
        if self.fail:
            raise ComposioError("Composio rate limited the request", 429)
        self.since_seen.append(since)
        return self.issues

    async def list_issue_comments(self, user_id, repo, number):
        return self.comments.get(number, [])


async def _setup(db, *, integration=True, status="running") -> str:
    vid = new_id("ven")
    async with db.tx() as tx:
        await tx.execute("INSERT INTO ventures (id, name, slug, idea, founder_name, status, repo_full_name, composio_user_id, created_at, updated_at) "
                         "VALUES (?,?,?,?,?,?,?,?,?,?)",
                         (vid, "Pantry", f"p-{vid[-6:]}", "idea", "Alex", status, "alex/pantry", f"foundry:{vid}", utc_now(), utc_now()))
        if integration:
            await tx.execute("INSERT INTO integrations (id, venture_id, provider, status, account_ref, created_at, updated_at) "
                             "VALUES (?,?, 'github', 'active', 'ca', ?, ?)", (new_id("int"), vid, utc_now(), utc_now()))
    return vid


def _state(settings, db):
    return SimpleNamespace(settings=settings, db=db)


ISSUES = [
    {"number": 12, "title": "Badge missing", "body": "Milk shows no badge", "user": {"login": "sam"},
     "html_url": "https://github.com/alex/pantry/issues/12", "labels": [{"name": "bug"}]},
    {"number": 13, "title": "A PR", "pull_request": {"url": "x"}, "user": {"login": "sam"}},
]


async def test_new_issue_becomes_support_ticket(settings, db) -> None:
    vid = await _setup(db)
    client = FakeComposio(issues=ISSUES)
    res = await github_watch.poll_once(_state(settings, db), client)
    assert res["issues"] == 1 and res["ventures"] == 1
    tickets = await db.fetch_all("SELECT * FROM tickets WHERE venture_id = ?", (vid,))
    assert [t["type"] for t in tickets] == ["support.issue"]
    t = tickets[0]
    assert t["department_id"] == "support" and t["assigned_agent_id"] == "su.triager" and t["created_by"] == "system"
    payload = json.loads(t["payload_json"])
    assert payload == {"number": 12, "title": "Badge missing", "body": "Milk shows no badge", "author": "sam",
                       "url": "https://github.com/alex/pantry/issues/12", "labels": ["bug"]}
    assert await db.fetch_one("SELECT * FROM github_seen WHERE venture_id = ? AND external_id = '12'", (vid,))
    since = await db.fetch_one("SELECT value_json FROM kv WHERE key = ?", (f"gh.since.{vid}",))
    assert since is not None
    # second poll: seen issues are skipped and `since` is passed through
    res2 = await github_watch.poll_once(_state(settings, db), client)
    assert res2["issues"] == 0 and client.since_seen[1] == json.loads(since["value_json"])
    assert len(await db.fetch_all("SELECT id FROM tickets WHERE venture_id = ?", (vid,))) == 1


async def test_pr_comment_becomes_eng_fix(settings, db) -> None:
    vid = await _setup(db)
    async with db.tx() as tx:
        for state, number in (("open", 7), ("merged", 8)):
            await tx.execute("INSERT INTO artifacts (id, venture_id, department_id, kind, title, meta_json, created_at) VALUES (?,?,?,?,?,?,?)",
                             (new_id("art"), vid, "engineering", "pr", f"PR {number}", json.dumps({"state": state, "number": number}), utc_now()))
    client = FakeComposio(comments={
        7: [{"id": 1, "body": "Please handle empty lists", "user": {"login": "alex", "type": "User"}, "html_url": "u1"},
            {"id": 2, "body": "bot", "user": {"login": "ci[bot]", "type": "Bot"}}],
        8: [{"id": 3, "body": "should not be read", "user": {"login": "alex"}}]})
    res = await github_watch.poll_once(_state(settings, db), client)
    assert res["pr_comments"] == 1
    t = await db.fetch_one("SELECT * FROM tickets WHERE venture_id = ? AND type = 'eng.fix'", (vid,))
    assert t["assigned_agent_id"] == "eng.builder"
    assert json.loads(t["payload_json"]) == {"pr_number": 7, "comment": "Please handle empty lists", "url": "u1"}
    assert (await github_watch.poll_once(_state(settings, db), client))["pr_comments"] == 0


async def test_skips_ventures_without_integration_or_not_running(settings, db) -> None:
    await _setup(db, integration=False)
    await _setup(db, status="paused")
    res = await github_watch.poll_once(_state(settings, db), FakeComposio(issues=ISSUES))
    assert res["ventures"] == 0 and not await db.fetch_all("SELECT id FROM tickets")


async def test_failure_emits_warning(settings, db) -> None:
    vid = await _setup(db)
    res = await github_watch.poll_once(_state(settings, db), FakeComposio(fail=True))
    assert res["errors"] == 1
    ev = await db.fetch_one("SELECT * FROM events WHERE venture_id = ? AND type = 'system.warning'", (vid,))
    assert ev and "rate limited" in ev["data_json"]


async def test_start_stop_are_safe(settings, db) -> None:
    app = SimpleNamespace(state=SimpleNamespace(settings=settings, db=db))
    await github_watch.start(app)  # no key -> no task
    assert getattr(app.state, "github_watch_task", None) is None
    await github_watch.stop(app)
    live = settings.model_copy(update={"composio_api_key": SecretStr("k_test_123456"), "llm_mode": "live", "github_poll_seconds": 3600})
    app2 = SimpleNamespace(state=SimpleNamespace(settings=live, db=db))
    await github_watch.start(app2)
    assert app2.state.github_watch_task is not None
    await github_watch.stop(app2)
    assert app2.state.github_watch_task is None
