# OWNER: tanush
"""HTTP contracts and persistent effects for Step A, using the real SQLite app."""
import io
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from pypdf import PdfWriter

from foundry_kernel import gates
from foundry_kernel.app import create_app
from foundry_kernel.ids import new_id, utc_now
from tests.tanush.helpers import execute


def data(response, status=200):
    assert response.status_code == status, response.text
    assert set(response.json()) == {"data"}
    return response.json()["data"]


def rows(client, sql, params=()):
    return client.portal.call(client.app.state.db.fetch_all, sql, params)


def write(client, sql, params=()):
    return client.portal.call(execute, client.app.state.db, sql, params)


def create_venture(client, name="Pantry Pal", **kwargs):
    return data(client.post("/v1/ventures", json={"name": name, "idea": "Track pantry expiry", "founder_name": "Tanush", **kwargs}))


def create_ticket(client, vid, **kwargs):
    return data(client.post(f"/v1/ventures/{vid}/tickets", json={"type": "brief", "department_id": "intake", "title": "Clarify pantry needs", "body": "Use public research", **kwargs}))


@pytest.fixture
def venture(client):
    return create_venture(client)


@pytest.fixture
def records(client, venture):
    vid = venture["id"]
    ticket = create_ticket(client, vid, payload={"question": "What expires first?"})
    tid = ticket["id"]
    rid, aid = new_id("run"), new_id("art")
    now = utc_now()
    write(client, "INSERT INTO runs(id,venture_id,ticket_id,agent_id,kind,job,model,status,created_at,output_text) VALUES (?,?,?,?,?,?,?,?,?,?)", (rid, vid, tid, "intake.brief-lead", "ticket", "dept_artifact", "gemini-4-argon", "succeeded", now, "Research finished"))
    write(client, "INSERT INTO run_logs(run_id,ts,level,message) VALUES (?,?,?,?)", (rid, now, "info", "First log"))
    write(client, "INSERT INTO run_logs(run_id,ts,level,message) VALUES (?,?,?,?)", (rid, now, "warn", "Second log"))
    write(client, "INSERT INTO artifacts(id,venture_id,ticket_id,run_id,agent_id,department_id,kind,title,summary,content_md,meta_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (aid, vid, tid, rid, "intake.brief-lead", "intake", "brief", "Pantry research", "Research summary", "# Grounded brief", '{"source":"test"}', now))

    async def request_gate():
        async with client.app.state.db.tx() as tx:
            return await gates.request_approval(tx, venture_id=vid, gate_type="clarification", title="Confirm scope", summary="Choose scope", ticket_id=tid, payload={"questions": [{"id": "q1", "proposed": "Pantry only"}]})

    apr = client.portal.call(request_gate)
    return {"vid": vid, "tid": tid, "rid": rid, "aid": aid, "apr": apr}


def test_system_status_reports_provider_configuration_without_secrets(client):
    status = data(client.get("/v1/system/status"))
    assert {"gemini", "antigravity", "composio", "elevenlabs"} <= set(status["providers"])
    assert all(isinstance(p["configured"], bool) for p in status["providers"].values())
    assert status["executor"] in {"antigravity", "local"}
    assert {"last_run_id", "final_score"} <= set(status["worldgen"])


def test_create_list_and_detail_venture(client, venture):
    assert venture["name"] == "Pantry Pal" and venture["status"] == "draft"
    assert venture["budget_usd"] == 25 and venture["spent_usd"] == 0
    assert {"id", "slug", "idea", "founder_name", "repo_full_name", "repo_url", "created_at", "updated_at"} <= set(venture)
    listing = data(client.get("/v1/ventures"))
    assert [v["id"] for v in listing["items"]] == [venture["id"]]
    assert listing["next_cursor"] is None
    detail = data(client.get(f"/v1/ventures/{venture['id']}"))
    assert detail["stats"]["approvals_pending"] == 0
    assert detail["stats"]["artifacts"] == 0
    assert isinstance(detail["stats"]["tickets"], dict)


def test_duplicate_venture_names_have_distinct_slugs(client, venture):
    another = create_venture(client)
    assert another["id"] != venture["id"] and another["slug"] != venture["slug"]


def test_start_pause_resume_transitions_and_duplicate_start_conflict(client, venture):
    base = f"/v1/ventures/{venture['id']}"
    started = data(client.post(f"{base}/start", json={}))
    assert started["status"] == "running" and started["brief_ticket_id"].startswith("tkt_")
    assert len(rows(client, "SELECT id FROM tickets WHERE venture_id=? AND type='brief'", (venture["id"],))) == 1
    conflict = client.post(f"{base}/start", json={})
    assert conflict.status_code == 409 and "error" in conflict.json()
    assert data(client.post(f"{base}/pause", json={})) == {"status": "paused"}
    assert data(client.post(f"{base}/resume", json={})) == {"status": "running"}
    data(client.post(f"{base}/pause", json={}))


def test_venture_budget_aggregates_actual_ledger_entries(client, venture):
    vid = venture["id"]
    from foundry_kernel import ledger

    async def charge():
        async with client.app.state.db.tx() as tx:
            await ledger.record(tx, venture_id=vid, kind="model", model="gemini-4-argon", department_id="engineering", cost_usd=1.25)
            await ledger.record(tx, venture_id=vid, kind="model", model="gemini-3.8-flash", department_id="intake", cost_usd=0.25)

    client.portal.call(charge)
    budget = data(client.get(f"/v1/ventures/{vid}/budget"))
    assert budget["budget_usd"] == 25 and budget["spent_usd"] == 1.5
    assert {d["department_id"]: d["cost_usd"] for d in budget["by_department"]} == {"engineering": 1.25, "intake": 0.25}
    assert {d["model"]: d["cost_usd"] for d in budget["by_model"]} == {"gemini-4-argon": 1.25, "gemini-3.8-flash": 0.25}


def test_department_list_and_detail_show_live_counts(client, records):
    base = f"/v1/ventures/{records['vid']}/departments"
    departments = data(client.get(base))["items"]
    assert len(departments) == 13
    engineering = next(d for d in departments if d["id"] == "engineering")
    assert engineering["building_id"] == "b-engineering" and "eng.builder" in engineering["agents"]
    intake = data(client.get(f"{base}/intake"))
    assert intake["counts"]["open"] == 1
    assert records["tid"] in [t["id"] for t in intake["recent_tickets"]]
    assert records["aid"] in [a["id"] for a in intake["recent_artifacts"]]
    assert intake["channel_id"]


def test_agent_list_and_detail_serialize_roster_and_state(client, records):
    base = f"/v1/ventures/{records['vid']}/agents"
    agents = data(client.get(base))["items"]
    assert len(agents) == 29
    builder = next(a for a in agents if a["id"] == "eng.builder")
    assert builder["model"] == "gemini-4-argon" and isinstance(builder["tools"], list)
    assert builder["state"]["status"] == "idle"
    assert builder["portrait_url"] is None  # Missing generated portraits use the UI initials fallback.
    write(client, "UPDATE agents SET portrait_path=? WHERE id='eng.builder'", ("/generated/portraits/eng.builder.png",))
    with_portrait = data(client.get(f"{base}/eng.builder"))
    assert with_portrait["portrait_url"] == "/generated/portraits/eng.builder.png"
    detail = data(client.get(f"{base}/intake.brief-lead"))
    assert records["rid"] in [r["id"] for r in detail["recent_runs"]]
    assert "current_ticket" in detail


def test_create_ticket_list_filters_and_detail_relations(client, records):
    base = f"/v1/ventures/{records['vid']}/tickets"
    other = create_ticket(client, records["vid"], type="eng.design", department_id="engineering", title="Design pantry")
    listing = data(client.get(base, params={"department_id": "intake", "type": "brief", "status": "open"}))
    assert [t["id"] for t in listing["items"]] == [records["tid"]]
    assert other["id"] not in [t["id"] for t in listing["items"]]
    detail = data(client.get(f"/v1/tickets/{records['tid']}"))
    assert detail["payload"] == {"question": "What expires first?"}
    assert detail["depends_on"] == [] and detail["created_by"] == "human"
    assert detail["assigned_agent_id"] == "intake.brief-lead"
    assert [r["id"] for r in detail["runs"]] == [records["rid"]]
    assert [a["id"] for a in detail["artifacts"]] == [records["aid"]]
    assert [a["id"] for a in detail["approvals"]] == [records["apr"]]
    child = create_ticket(client, records["vid"], title="Child brief")
    write(client, "UPDATE tickets SET parent_ticket_id=? WHERE id=?", (records["tid"], child["id"]))
    assert [t["id"] for t in data(client.get(f"/v1/tickets/{records['tid']}"))["children"]] == [child["id"]]


def test_ticket_cursor_visits_every_row_once_even_when_timestamps_tie(client, venture):
    vid = venture["id"]
    expected = {create_ticket(client, vid, title=f"Ticket {n}")["id"] for n in range(7)}
    write(client, "UPDATE tickets SET created_at='2026-10-25T12:00:00Z' WHERE venture_id=?", (vid,))
    cursor, seen = None, []
    for _ in range(10):
        params = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        page = data(client.get(f"/v1/ventures/{vid}/tickets", params=params))
        assert len(page["items"]) <= 2
        seen.extend(t["id"] for t in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert len(seen) == len(set(seen)) == 7 and set(seen) == expected
    invalid = client.get(f"/v1/ventures/{vid}/tickets", params={"cursor": "not-a-cursor"})
    assert invalid.status_code == 400 and "error" in invalid.json()


def test_retry_preserves_attempts_and_cancel_returns_updated_ticket(client, venture):
    ticket = create_ticket(client, venture["id"])
    tid = ticket["id"]
    write(client, "UPDATE tickets SET status='failed', attempts=2 WHERE id=?", (tid,))
    retry = data(client.post(f"/v1/tickets/{tid}/retry", json={}))
    assert retry["status"] == "open" and retry["attempts"] == 2
    cancelled = data(client.post(f"/v1/tickets/{tid}/cancel", json={}))
    assert cancelled["status"] == "cancelled"
    assert rows(client, "SELECT type FROM events WHERE entity_id=? AND type='ticket.updated'", (tid,))


def test_runs_list_detail_filters_and_incremental_logs(client, records):
    base = f"/v1/ventures/{records['vid']}/runs"
    run_list = data(client.get(base, params={"agent_id": "intake.brief-lead", "ticket_id": records["tid"], "kind": "ticket"}))
    assert [r["id"] for r in run_list["items"]] == [records["rid"]]
    assert data(client.get(base, params={"agent_id": "eng.builder"}))["items"] == []
    run = data(client.get(f"/v1/runs/{records['rid']}"))
    assert run["output_text"] == "Research finished" and run["job"] == "dept_artifact"
    logs = data(client.get(f"/v1/runs/{records['rid']}/logs"))["items"]
    assert [x["message"] for x in logs] == ["First log", "Second log"]
    assert all({"id", "ts", "level", "message"} <= set(x) for x in logs)
    later = data(client.get(f"/v1/runs/{records['rid']}/logs", params={"after_id": logs[0]["id"]}))["items"]
    assert later == logs[1:]


def test_artifact_list_filters_and_detail_decode_metadata(client, records):
    base = f"/v1/ventures/{records['vid']}/artifacts"
    listing = data(client.get(base, params={"department_id": "intake", "kind": "brief"}))
    assert [a["id"] for a in listing["items"]] == [records["aid"]]
    assert data(client.get(base, params={"kind": "pr"}))["items"] == []
    artifact = data(client.get(f"/v1/artifacts/{records['aid']}"))
    assert artifact["content_md"] == "# Grounded brief" and artifact["meta"] == {"source": "test"}


def test_approval_list_decision_reentry_and_repeat_conflict(client, records):
    vid, tid, aid = records["vid"], records["tid"], records["apr"]
    write(client, "UPDATE tickets SET status='waiting_approval' WHERE id=?", (tid,))
    base = f"/v1/ventures/{vid}/approvals"
    assert [a["id"] for a in data(client.get(base, params={"status": "pending"}))["items"]] == [aid]
    body = {"decision": "approve", "decided_by": "Tanush", "note": "Keep focus", "answers": {"q1": "Pantry"}}
    decision = data(client.post(f"/v1/approvals/{aid}/decision", json=body))
    assert decision["status"] == "approved" and decision["decided_by"] == "Tanush" and decision["decided_at"]
    reopened = data(client.get(f"/v1/tickets/{tid}"))
    assert reopened["status"] == "open"
    assert reopened["payload"]["_approval"] == {"approval_id": aid, "status": "approved", "note": "Keep focus", "answers": {"q1": "Pantry"}}
    assert data(client.get(base, params={"status": "pending"}))["items"] == []
    conflict = client.post(f"/v1/approvals/{aid}/decision", json=body)
    assert conflict.status_code == 409
    exec_id = rows(client, "SELECT id FROM channels WHERE venture_id=? AND slug='exec'", (vid,))[0]["id"]
    assert any(aid in json.dumps(m) for m in data(client.get(f"/v1/channels/{exec_id}/messages"))["items"])


def test_channels_messages_threads_mentions_and_summary(client, venture):
    vid = venture["id"]
    channels = data(client.get(f"/v1/ventures/{vid}/channels"))["items"]
    assert {c["slug"] for c in channels} == {"all-hands", "exec", "incidents"} | {"dept-" + d["id"] for d in rows(client, "SELECT id FROM departments")}
    assert all({"last_message_at", "unread", "department_id", "kind"} <= set(c) for c in channels)
    cid = next(c["id"] for c in channels if c["slug"] == "exec")
    base = f"/v1/channels/{cid}/messages"
    root = data(client.post(base, json={"body": "@eng.builder review the brief", "author_name": "Tanush"}))
    assert root["author_kind"] == "human" and root["kind"] == "human" and root["thread_root_id"] is None
    reply = data(client.post(base, json={"body": "Keep the scope small", "author_name": "Tanush", "thread_root_id": root["id"]}))
    top_level = data(client.get(base))["items"]
    assert [m["id"] for m in top_level] == [root["id"]] and top_level[0]["reply_count"] == 1
    thread = data(client.get(base, params={"thread_root_id": root["id"]}))["items"]
    assert [m["id"] for m in thread] == [reply["id"]]
    queued = rows(client, "SELECT * FROM tickets WHERE venture_id=? AND type='chat.reply'", (vid,))
    assert any(t["assigned_agent_id"] == "eng.builder" and t["priority"] == 0 for t in queued)
    summary = data(client.post(f"/v1/channels/{cid}/summarize", json={}))
    assert isinstance(summary["summary"], str) and summary["summary"]


def test_message_pages_are_chronological_without_duplicates(client, venture):
    cid = rows(client, "SELECT id FROM channels WHERE venture_id=? AND slug='exec'", (venture["id"],))[0]["id"]
    base = f"/v1/channels/{cid}/messages"
    expected = []
    for n in range(5):
        expected.append(data(client.post(base, json={"body": f"Update {n}", "author_name": "Tanush"}))["id"])
    page = data(client.get(base, params={"limit": 2}))
    seen = []
    for _ in range(5):
        items = page["items"]
        assert [m["created_at"] for m in items] == sorted(m["created_at"] for m in items)
        seen.extend(m["id"] for m in items)
        if page["next_cursor"] is None:
            break
        page = data(client.get(base, params={"limit": 2, "cursor": page["next_cursor"]}))
    assert len(seen) == len(set(seen)) == 5 and set(seen) == set(expected)


def test_message_thread_cannot_cross_channels_or_ventures(client, venture):
    other = create_venture(client, "Other")
    first, second = [rows(client, "SELECT id FROM channels WHERE venture_id=? AND slug='exec'", (v["id"],))[0]["id"] for v in (venture, other)]
    root = data(client.post(f"/v1/channels/{first}/messages", json={"body": "Private context", "author_name": "Tanush"}))
    result = client.post(f"/v1/channels/{second}/messages", json={"body": "Wrong channel", "author_name": "Tanush", "thread_root_id": root["id"]})
    assert result.status_code in {400, 404, 409, 422}
    assert "error" in result.json()
    assert rows(client, "SELECT id FROM messages WHERE channel_id=?", (second,)) == []


def test_activity_after_id_is_ordered_and_scoped_to_venture(client, venture):
    vid = venture["id"]
    create_ticket(client, vid)
    other = create_venture(client, "Other")
    create_ticket(client, other["id"])
    activity = data(client.get(f"/v1/ventures/{vid}/activity"))["items"]
    assert activity and [e["id"] for e in activity] == sorted(e["id"] for e in activity)
    assert all(e.get("venture_id", vid) == vid for e in activity)
    assert any(e["type"] == "ticket.created" for e in activity)
    later = data(client.get(f"/v1/ventures/{vid}/activity", params={"after_id": activity[0]["id"]}))["items"]
    assert [e["id"] for e in later] == [e["id"] for e in activity[1:]]


def test_upload_text_and_pdf_extracts_context_and_redacts_storage(client, venture):
    secret = "ghp_" + "b" * 30
    pdf = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    writer.write(pdf)
    result = data(client.post(f"/v1/ventures/{venture['id']}/files", files=[("files[]", ("notes.md", f"Pantry context {secret}".encode(), "text/markdown")), ("files[]", ("blank.pdf", pdf.getvalue(), "application/pdf"))]))
    assert [f["name"] for f in result["items"]] == ["notes.md", "blank.pdf"]
    stored = rows(client, "SELECT * FROM files WHERE venture_id=?", (venture["id"],))
    text = next(f for f in stored if f["name"] == "notes.md")
    assert "Pantry context" in text["excerpt"] and secret not in text["excerpt"]
    assert "[REDACTED]" in text["excerpt"]
    assert Path(text["path"]).is_relative_to(client.app.state.settings.data_dir / "uploads" / venture["id"])
    assert secret not in Path(text["path"]).read_text()
    assert all(Path(f["path"]).exists() for f in stored)


@pytest.mark.parametrize("filename", ["script.exe", "../../escape.txt", "/tmp/escape.txt", ".env"])
def test_upload_rejects_unsupported_or_unsafe_filename(client, venture, filename):
    result = client.post(f"/v1/ventures/{venture['id']}/files", files={"files[]": (filename, b"content", "text/plain")})
    assert result.status_code in {400, 422} and "error" in result.json()
    assert rows(client, "SELECT id FROM files WHERE venture_id=?", (venture["id"],)) == []


def test_upload_rejects_more_than_eight_files_and_oversize_content(client, venture):
    endpoint = f"/v1/ventures/{venture['id']}/files"
    too_many = client.post(endpoint, files=[("files[]", (f"{n}.txt", b"small", "text/plain")) for n in range(9)])
    assert too_many.status_code in {400, 422} and "error" in too_many.json()
    too_big = client.post(endpoint, files={"files[]": ("huge.txt", b"x" * (15 * 1024 * 1024 + 1), "text/plain")})
    assert too_big.status_code in {400, 413, 422} and "error" in too_big.json()
    assert rows(client, "SELECT id FROM files WHERE venture_id=?", (venture["id"],)) == []


def test_text_fields_and_nested_payload_never_store_secrets(client):
    secret = "AIza" + "z" * 35
    venture = create_venture(client, f"Venture {secret}", idea=f"Idea {secret}")
    ticket = create_ticket(client, venture["id"], title=f"Title {secret}", body=secret, payload={"nested": [secret]})
    assert secret not in json.dumps([venture, ticket])
    for table in ("ventures", "tickets", "events"):
        assert secret not in json.dumps(rows(client, f"SELECT * FROM {table}"))
    assert "[REDACTED]" in json.dumps(ticket)


@pytest.mark.parametrize("path", ["/v1/ventures/ven_missing", "/v1/ventures/ven_missing/departments", "/v1/ventures/ven_missing/agents", "/v1/ventures/ven_missing/tickets", "/v1/ventures/ven_missing/runs", "/v1/ventures/ven_missing/artifacts", "/v1/ventures/ven_missing/approvals", "/v1/ventures/ven_missing/channels", "/v1/ventures/ven_missing/activity", "/v1/ventures/ven_missing/budget", "/v1/tickets/tkt_missing", "/v1/runs/run_missing", "/v1/runs/run_missing/logs", "/v1/artifacts/art_missing", "/v1/channels/chn_missing/messages"])
def test_missing_records_have_consistent_error_envelope(client, path):
    result = client.get(path)
    assert result.status_code == 404
    assert set(result.json()) == {"error"}
    assert {"code", "message", "details"} <= set(result.json()["error"])


@pytest.mark.parametrize("body", [{}, {"name": "", "idea": "idea", "founder_name": "Tanush"}, {"name": "N", "idea": "I", "founder_name": "T", "budget_usd": -1}])
def test_invalid_venture_schema_has_error_envelope(client, body):
    result = client.post("/v1/ventures", json=body)
    assert result.status_code == 422
    assert {"code", "message", "details"} <= set(result.json()["error"])


def test_invalid_ticket_type_or_department_cannot_be_created(client, venture):
    base = {"title": "Invalid", "body": "", "type": "invented.type", "department_id": "intake"}
    for body in [base, {**base, "type": "eng.build", "department_id": "intake"}]:
        result = client.post(f"/v1/ventures/{venture['id']}/tickets", json=body)
        assert result.status_code in {400, 422} and "error" in result.json()
    assert not rows(client, "SELECT id FROM tickets WHERE venture_id=?", (venture["id"],))


def test_optional_bearer_auth_protects_all_v1_routes_and_never_leaks_token(settings):
    token = "contract-test-token-123456"
    settings = settings.model_copy(update={"kernel_token": SecretStr(token)})
    with TestClient(create_app(settings)) as client:
        assert client.get("/health").status_code == 200
        for path in ("/v1/system/status", "/v1/ventures", "/v1/world/manifest", "/v1/ventures/ven_missing/stream"):
            for headers in ({}, {"Authorization": "Bearer wrong"}, {"Authorization": f"Basic {token}"}):
                result = client.get(path, headers=headers)
                assert result.status_code in {401, 403}
                assert token not in result.text and "error" in result.json()
        result = client.get("/v1/system/status", headers={"Authorization": f"Bearer {token}"})
        assert result.status_code == 200 and token not in result.text


def test_openapi_core_success_responses_have_declared_models(client):
    spec = client.get("/openapi.json").json()
    for path, verb in [("/v1/system/status", "get"), ("/v1/ventures", "post"), ("/v1/ventures/{vid}", "get"), ("/v1/ventures/{vid}/tickets", "post"), ("/v1/tickets/{tid}", "get"), ("/v1/runs/{rid}", "get"), ("/v1/artifacts/{aid}", "get"), ("/v1/approvals/{aid}/decision", "post"), ("/v1/channels/{cid}/messages", "post")]:
        responses = spec["paths"][path][verb]["responses"]
        success = next(v for k, v in responses.items() if k.startswith("2"))
        schema = success["content"]["application/json"]["schema"]
        assert "$ref" in schema, (path, schema)
