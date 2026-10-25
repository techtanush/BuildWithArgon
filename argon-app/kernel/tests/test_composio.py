# OWNER: ayan
"""Composio REST client (02-models-and-integrations/04-composio.md) against httpx.MockTransport."""
from __future__ import annotations

import json

import httpx
import pytest
from pydantic import SecretStr

from foundry_kernel import gates
from foundry_kernel.errors import GateNotApproved
from foundry_kernel.ids import new_id, utc_now
from foundry_kernel.integrations import composio
from foundry_kernel.integrations.composio import ComposioClient, ComposioError


def _client(settings, handler) -> ComposioClient:
    s = settings.model_copy(update={"composio_api_key": SecretStr("k_test_123456")})
    return ComposioClient(s, transport=httpx.MockTransport(handler))


async def _venture(db) -> str:
    vid = new_id("ven")
    async with db.tx() as tx:
        await tx.execute("INSERT INTO ventures (id, name, slug, idea, founder_name, composio_user_id, created_at, updated_at) "
                         "VALUES (?,?,?,?,?,?,?,?)", (vid, "T", f"t-{vid[-6:]}", "idea", "Alex", f"foundry:{vid}", utc_now(), utc_now()))
    return vid


def test_unconfigured(settings) -> None:
    assert not ComposioClient(settings).configured


async def test_finds_existing_auth_config(settings) -> None:
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append((req.method, req.url.path, req.headers.get("x-api-key")))
        return httpx.Response(200, json={"items": [
            {"id": "ac_disabled", "toolkit": {"slug": "github"}, "is_composio_managed": True, "status": "DISABLED"},
            {"id": "ac_ok", "toolkit": {"slug": "github"}, "is_composio_managed": True, "status": "ENABLED"}]})

    assert await _client(settings, handler).find_or_create_auth_config() == "ac_ok"
    assert seen == [("GET", "/api/v3.1/auth_configs", "k_test_123456")]


async def test_creates_auth_config_when_missing(settings) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "GET":
            return httpx.Response(200, json={"items": []})
        body = json.loads(req.content)
        assert req.url.path == "/api/v3/auth_configs" and body["toolkit"] == {"slug": "github"}
        assert body["auth_config"]["type"] == "use_composio_managed_auth"
        return httpx.Response(201, json={"auth_config": {"id": "ac_new"}})

    assert await _client(settings, handler).find_or_create_auth_config() == "ac_new"


@pytest.mark.parametrize("url,ok", [("https://github.com/login/oauth?x=1", True), ("http://evil.example/", False)])
async def test_connect_link_requires_https(settings, url, ok) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path.endswith("auth_configs"):
            return httpx.Response(200, json={"items": [{"id": "ac", "toolkit": {"slug": "github"}, "is_composio_managed": True, "status": "ENABLED"}]})
        body = json.loads(req.content)
        assert body == {"auth_config_id": "ac", "user_id": "foundry:v1", "callback_url": "http://localhost:5173/integrations"}
        return httpx.Response(200, json={"redirect_url": url, "connected_account_id": "ca_1"})

    c = _client(settings, handler)
    if ok:
        assert await c.create_connect_link("foundry:v1", "http://localhost:5173/integrations") == {"redirect_url": url, "connected_account_id": "ca_1"}
    else:
        with pytest.raises(ComposioError):
            await c.create_connect_link("foundry:v1", "http://localhost:5173/integrations")


async def test_connection_status(settings) -> None:
    items = [{"id": "ca_other", "toolkit": {"slug": "github"}, "user_id": "foundry:other", "status": "ACTIVE"},
             {"id": "ca_dis", "toolkit": {"slug": "github"}, "user_id": "foundry:v1", "status": "ACTIVE", "is_disabled": True},
             {"id": "ca_ok", "toolkit": {"slug": "github"}, "user_id": "foundry:v1", "status": "ACTIVE"}]
    c = _client(settings, lambda req: httpx.Response(200, json={"items": items}))
    assert await c.connection_status("foundry:v1") == {"connected": True, "account_id": "ca_ok", "status": "ACTIVE"}
    c2 = _client(settings, lambda req: httpx.Response(200, json={"items": items[:2]}))
    assert (await c2.connection_status("foundry:v1"))["connected"] is False


async def test_execute_success_and_unwrap(settings) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.url.path == "/api/v3/tools/execute/GITHUB_CREATE_A_PULL_REQUEST"
        body = json.loads(req.content)
        assert body["user_id"] == "foundry:v1" and body["arguments"]["owner"] == "alex" and body["arguments"]["repo"] == "app"
        return httpx.Response(200, json={"data": {"response_data": {"number": 7, "html_url": "https://github.com/alex/app/pull/7"}},
                                         "successful": True, "error": None})

    pr = await _client(settings, handler).open_pr("foundry:v1", "alex/app", "foundry/x", "main", "T", "B")
    assert pr["number"] == 7


async def test_execute_failure_is_safe(settings) -> None:
    c = _client(settings, lambda req: httpx.Response(200, json={"data": {}, "successful": False, "error": "Not Found ghp_" + "a" * 30}))
    with pytest.raises(ComposioError) as exc:
        await c.get_ref("foundry:v1", "alex/app", "main")
    assert "ghp_" not in exc.value.user_message


@pytest.mark.parametrize("status,msg", [(401, "Composio rejected the API key"), (403, "Composio rejected the API key"),
                                        (429, "rate limited")])
async def test_error_mapping(settings, status, msg) -> None:
    c = _client(settings, lambda req: httpx.Response(status, json={"secret": "body"}))
    with pytest.raises(ComposioError) as exc:
        await c.connection_status("u")
    assert msg in exc.value.user_message and exc.value.status_code == status and "secret" not in exc.value.user_message


async def test_disallowed_toolkit(settings) -> None:
    with pytest.raises(ComposioError):
        await _client(settings, lambda req: httpx.Response(200, json={})).execute("SLACK_SEND", "u", {})


async def test_list_issues_and_put_file(settings) -> None:
    calls = []

    def handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        calls.append((req.url.path.rsplit("/", 1)[-1], body["arguments"]))
        if "ISSUES" in req.url.path:
            return httpx.Response(200, json={"data": [{"number": 1}], "successful": True})
        return httpx.Response(200, json={"data": {"content": {"sha": "abc"}}, "successful": True})

    c = _client(settings, handler)
    assert await c.list_issues("u", "alex/app", "2026-10-26T00:00:00Z") == [{"number": 1}]
    await c.put_file("u", "alex/app", "b", "src/a.ts", b"hi", "msg")
    assert calls[0][1]["since"] == "2026-10-26T00:00:00Z" and calls[1][1]["content"] == "aGk="


async def test_gated_actions(settings, db) -> None:
    vid = await _venture(db)
    executed = []

    def handler(req: httpx.Request) -> httpx.Response:
        executed.append(req.url.path.rsplit("/", 1)[-1])
        return httpx.Response(200, json={"data": {"merged": True}, "successful": True})

    c = _client(settings, handler)
    async with db.tx() as tx:
        await tx.execute("UPDATE ventures SET repo_full_name='alex/app' WHERE id=?", (vid,))
        apr = await gates.request_approval(tx, venture_id=vid, gate_type="merge", title="Merge", summary="s",
                                           payload={"repo_full_name": "alex/app", "pr_number": 7, "head_sha": "a" * 40})
    with pytest.raises(GateNotApproved):
        await composio.merge_pull_request(db, c, approval_id=apr, user_id=f"foundry:{vid}", repo_full_name="alex/app", number=7)
    with pytest.raises(GateNotApproved):
        await composio.create_issue_comment(db, c, approval_id=None, user_id=f"foundry:{vid}", repo_full_name="alex/app", number=7, body="x")
    assert executed == []
    async with db.tx() as tx:
        await tx.execute("UPDATE approvals SET status='approved' WHERE id=?", (apr,))
    with pytest.raises(GateNotApproved):  # wrong gate type
        await composio.create_issue_comment(db, c, approval_id=apr, user_id=f"foundry:{vid}", repo_full_name="alex/app", number=7, body="x")
    assert (await composio.merge_pull_request(db, c, approval_id=apr, user_id=f"foundry:{vid}", repo_full_name="alex/app", number=7))["merged"]
    assert executed == ["GITHUB_MERGE_A_PULL_REQUEST"]


async def test_github_integration_row(db) -> None:
    vid = await _venture(db)
    assert await composio.github_integration(db, vid) is None
    async with db.tx() as tx:
        await tx.execute("INSERT INTO integrations (id, venture_id, provider, status, account_ref, data_json, created_at, updated_at) "
                         "VALUES (?,?, 'github', 'active', 'ca_1', '{\"a\": 1}', ?, ?)", (new_id("int"), vid, utc_now(), utc_now()))
    row = await composio.github_integration(db, vid)
    assert row and row["account_ref"] == "ca_1" and row["data"] == {"a": 1}


async def test_probe_without_key(settings, capsys) -> None:
    assert await composio.probe(settings) == 0
    assert "COMPOSIO_API_KEY not set" in capsys.readouterr().out

async def test_approved_targets_are_venture_and_content_bound(settings, db) -> None:
    vid, other = await _venture(db), await _venture(db)
    calls = []
    c = _client(settings, lambda req: calls.append(json.loads(req.content)) or httpx.Response(200, json={"data": {"ok": True}}))
    async with db.tx() as tx:
        await tx.execute("UPDATE ventures SET repo_full_name='alex/app' WHERE id=?", (vid,))
        apr = await gates.request_approval(tx, venture_id=vid, gate_type="outreach", title="Reply", summary="s",
                                           payload={"repo_full_name": "alex/app", "channel": "github_comment", "issue_number": 7, "body": "approved"})
        await tx.execute("UPDATE approvals SET status='approved' WHERE id=?", (apr,))
    for changes in ({"user_id": f"foundry:{other}"}, {"number": 8}, {"repo_full_name": "alex/other"}, {"body": "substitute"}):
        args = {"approval_id": apr, "user_id": f"foundry:{vid}", "repo_full_name": "alex/app", "number": 7, "body": "approved", **changes}
        with pytest.raises(GateNotApproved):
            await composio.create_issue_comment(db, c, **args)
    with pytest.raises(GateNotApproved):
        await c.execute(composio.TOOL_SLUGS["create_issue_comment"], f"foundry:{vid}", {})
    assert calls == []
    await composio.create_issue_comment(db, c, approval_id=apr, user_id=f"foundry:{vid}", repo_full_name="alex/app", number=7, body="approved")
    assert len(calls) == 1

async def test_merge_rejects_changed_target_or_method_and_pins_head(settings, db) -> None:
    vid = await _venture(db)
    calls = []
    c = _client(settings, lambda req: calls.append(json.loads(req.content)) or httpx.Response(200, json={"data": {"merged": True}}))
    async with db.tx() as tx:
        await tx.execute("UPDATE ventures SET repo_full_name='alex/app' WHERE id=?", (vid,))
        apr = await gates.request_approval(tx, venture_id=vid, gate_type="merge", title="Merge", summary="s",
                 payload={"repo_full_name": "alex/app", "pr_number": 7, "merge_method": "squash", "head_sha": "a" * 40})
        await tx.execute("UPDATE approvals SET status='approved' WHERE id=?", (apr,))
    for change in ({"number": 8}, {"method": "merge"}, {"repo_full_name": "alex/other"}, {"user_id": "different"}):
        with pytest.raises(GateNotApproved):
            await composio.merge_pull_request(db, c, **{"approval_id": apr, "user_id": f"foundry:{vid}", "repo_full_name": "alex/app", "number": 7, **change})
    assert not calls
    await composio.merge_pull_request(db, c, approval_id=apr, user_id=f"foundry:{vid}", repo_full_name="alex/app", number=7)
    assert calls[0]["arguments"]["sha"] == "a" * 40

@pytest.mark.parametrize("gate_type", ["merge", "outreach"])
async def test_composio_approval_is_atomic_single_use(settings, db, gate_type) -> None:
    import asyncio
    vid = await _venture(db)
    calls = []
    c = _client(settings, lambda req: calls.append(req) or httpx.Response(200, json={"data": {"ok": True}}))
    payload = {"repo_full_name": "alex/app", "pr_number": 7, "head_sha": "a" * 40} if gate_type == "merge" else {
        "repo_full_name": "alex/app", "issue_number": 7, "channel": "github_comment", "body": "approved"}
    async with db.tx() as tx:
        await tx.execute("UPDATE ventures SET repo_full_name='alex/app' WHERE id=?", (vid,))
        apr = await gates.request_approval(tx, venture_id=vid, gate_type=gate_type, title="T", summary="s", payload=payload)
        await tx.execute("UPDATE approvals SET status='approved' WHERE id=?", (apr,))
    async def invoke():
        kw = {"approval_id":apr,"user_id":f"foundry:{vid}","repo_full_name":"alex/app","number":7}
        if gate_type == "merge": return await composio.merge_pull_request(db,c,**kw)
        return await composio.create_issue_comment(db,c,body="approved",**kw)
    results = await asyncio.gather(invoke(), invoke(), return_exceptions=True)
    assert sum(isinstance(x,GateNotApproved) for x in results) == 1
    assert len(calls) == 1

@pytest.mark.parametrize("head", [None, "", "fake", "g" * 40, "a" * 39])
async def test_remote_merge_without_real_head_sha_is_blocked(settings, db, head) -> None:
    vid = await _venture(db)
    calls = []
    c = _client(settings, lambda req: calls.append(req) or httpx.Response(200,json={}))
    async with db.tx() as tx:
        await tx.execute("UPDATE ventures SET repo_full_name='alex/app' WHERE id=?", (vid,))
        apr = await gates.request_approval(tx,venture_id=vid,gate_type="merge",title="T",summary="s",
                                          payload={"repo_full_name":"alex/app","pr_number":7,"head_sha":head})
        await tx.execute("UPDATE approvals SET status='approved' WHERE id=?",(apr,))
    with pytest.raises(GateNotApproved):
        await composio.merge_pull_request(db,c,approval_id=apr,user_id=f"foundry:{vid}",repo_full_name="alex/app",number=7)
    assert calls == []
    assert await db.fetch_one("SELECT * FROM kv WHERE key=?",("composio.approval_consumed."+apr,)) is None
