# OWNER: ayan
"""Integrations API: listing, the gated GitHub connect flow, refresh (04-api-contract.md §Integrations)."""
from __future__ import annotations

from fastapi.testclient import TestClient
from pydantic import SecretStr

from foundry_kernel.app import create_app
from foundry_kernel.ids import new_id, utc_now
from foundry_kernel.integrations.composio import ComposioClient


def _venture(client: TestClient) -> str:
    vid = new_id("ven")

    async def insert() -> None:
        async with client.app.state.db.tx() as tx:
            await tx.execute("INSERT INTO ventures (id, name, slug, idea, founder_name, composio_user_id, created_at, updated_at) "
                             "VALUES (?,?,?,?,?,?,?,?)", (vid, "T", f"t-{vid[-6:]}", "idea", "Alex", f"foundry:{vid}", utc_now(), utc_now()))

    client.portal.call(insert)
    return vid


def _approve(client: TestClient, approval_id: str) -> None:
    async def run() -> None:
        async with client.app.state.db.tx() as tx:
            await tx.execute("UPDATE approvals SET status='approved', decided_at=? WHERE id=?", (utc_now(), approval_id))

    client.portal.call(run)


def test_list_and_unconfigured(client) -> None:
    vid = _venture(client)
    r = client.get(f"/v1/ventures/{vid}/integrations")
    assert r.status_code == 200
    assert r.json()["data"]["items"] == [{"provider": "github", "status": "not_connected", "account_ref": None, "repo_full_name": None}]
    r = client.post(f"/v1/ventures/{vid}/integrations/github/connect", json={"callback_url": "http://localhost:5173/integrations"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "dependency_error"
    assert client.get("/v1/ventures/ven_missing/integrations").status_code == 404


def test_connect_is_gated_then_refresh(settings, monkeypatch) -> None:
    calls: list[tuple] = []

    async def link(self, user_id, callback_url):
        calls.append(("link", user_id, callback_url))
        return {"redirect_url": "https://connect.composio.dev/abc", "connected_account_id": "ca_1"}

    async def status(self, user_id):
        calls.append(("status", user_id))
        return {"connected": True, "account_id": "ca_1", "status": "ACTIVE"}

    monkeypatch.setattr(ComposioClient, "create_connect_link", link)
    monkeypatch.setattr(ComposioClient, "connection_status", status)
    s = settings.model_copy(update={"composio_api_key": SecretStr("k_test_123456")})
    with TestClient(create_app(s)) as client:
        vid = _venture(client)
        body = {"callback_url": "http://localhost:5173/integrations?connected=github"}
        first = client.post(f"/v1/ventures/{vid}/integrations/github/connect", json=body).json()["data"]
        assert first["redirect_url"] is None and first["status"] == "waiting_approval" and calls == []
        again = client.post(f"/v1/ventures/{vid}/integrations/github/connect", json=body).json()["data"]
        assert again["approval_id"] == first["approval_id"] and again["redirect_url"] is None
        _approve(client, first["approval_id"])
        done = client.post(f"/v1/ventures/{vid}/integrations/github/connect", json=body).json()["data"]
        assert done == {"redirect_url": "https://connect.composio.dev/abc", "approval_id": first["approval_id"], "status": "pending"}
        assert calls == [("link", f"foundry:{vid}", body["callback_url"])]
        item = client.get(f"/v1/ventures/{vid}/integrations").json()["data"]["items"][0]
        assert item["status"] == "pending" and item["account_ref"] == "ca_1"
        refreshed = client.post(f"/v1/ventures/{vid}/integrations/github/refresh", json={}).json()["data"]
        assert refreshed["status"] == "active" and refreshed["account_ref"] == "ca_1"


def test_rejected_approval_opens_a_new_one(settings) -> None:
    s = settings.model_copy(update={"composio_api_key": SecretStr("k_test_123456")})
    with TestClient(create_app(s)) as client:
        vid = _venture(client)
        first = client.post(f"/v1/ventures/{vid}/integrations/github/connect", json={}).json()["data"]

        async def reject() -> None:
            async with client.app.state.db.tx() as tx:
                await tx.execute("UPDATE approvals SET status='rejected' WHERE id=?", (first["approval_id"],))

        client.portal.call(reject)
        second = client.post(f"/v1/ventures/{vid}/integrations/github/connect", json={}).json()["data"]
        assert second["approval_id"] != first["approval_id"] and second["status"] == "waiting_approval"


def test_connect_callback_change_needs_new_approval(settings, monkeypatch) -> None:
    calls = []
    async def link(self, user_id, callback_url):
        calls.append(callback_url)
        return {"redirect_url": "https://connect.composio.dev/abc"}
    monkeypatch.setattr(ComposioClient, "create_connect_link", link)
    s = settings.model_copy(update={"composio_api_key": SecretStr("k_test_123456")})
    with TestClient(create_app(s)) as client:
        vid = _venture(client)
        path = f"/v1/ventures/{vid}/integrations/github/connect"
        first = client.post(path, json={}).json()["data"]
        _approve(client, first["approval_id"])
        changed = client.post(path, json={"callback_url": "https://different.invalid/callback"}).json()["data"]
        assert changed["status"] == "waiting_approval" and changed["approval_id"] != first["approval_id"]
        assert calls == []
