# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.

"""Integrations routes — 01-architecture/04-api-contract.md §Integrations, 02-models-and-integrations/04-composio.md.

Connecting GitHub is itself gated (`integration`): the first connect call opens the approval and returns
`redirect_url: null` + the approval id; once the founder approves it, the same call returns the Composio
connect link. `connect_github` is the only code path that performs the gated action."""
from __future__ import annotations

import json
from typing import Any, Literal

from fastapi import APIRouter, Request, Query, HTTPException
from pydantic import BaseModel

from .. import bus, gates
from ..errors import DependencyError, GateNotApproved, NotFoundError
from ..ids import new_id, utc_now
from ..integrations.composio import ComposioClient, ComposioError

router = APIRouter(tags=["integrations"])

IntegrationStatus = Literal["not_connected", "pending", "active", "error"]


class IntegrationItem(BaseModel):
    provider: str = "github"
    status: IntegrationStatus
    account_ref: str | None = None
    repo_full_name: str | None = None


class IntegrationList(BaseModel):
    items: list[IntegrationItem]


class IntegrationListEnvelope(BaseModel):
    data: IntegrationList


class IntegrationEnvelope(BaseModel):
    data: IntegrationItem


class ConnectRequest(BaseModel):
    callback_url: str = "http://localhost:5173/integrations?connected=github"


class ConnectResult(BaseModel):
    redirect_url: str | None
    approval_id: str
    status: Literal["waiting_approval", "pending"]


class ConnectEnvelope(BaseModel):
    data: ConnectResult


async def _venture(db: Any, vid: str) -> dict[str, Any]:
    row = await db.fetch_one("SELECT * FROM ventures WHERE id = ?", (vid,))
    if row is None:
        raise NotFoundError("venture", vid)
    return row


async def _item(db: Any, venture: dict[str, Any]) -> IntegrationItem:
    row = await db.fetch_one("SELECT * FROM integrations WHERE venture_id = ? AND provider = 'github'", (venture["id"],))
    if row is None:
        return IntegrationItem(status="not_connected", repo_full_name=venture.get("repo_full_name"))
    return IntegrationItem(status=row["status"], account_ref=row["account_ref"], repo_full_name=venture.get("repo_full_name"))


async def _upsert(db: Any, venture: dict[str, Any], status: str, account_ref: str | None, data: dict[str, Any]) -> None:
    now = utc_now()
    async with db.tx() as tx:
        await tx.execute(
            "INSERT INTO integrations (id, venture_id, provider, status, account_ref, data_json, created_at, updated_at) "
            "VALUES (?,?, 'github', ?,?,?,?,?) ON CONFLICT(venture_id, provider) DO UPDATE SET status = excluded.status, "
            "account_ref = COALESCE(excluded.account_ref, integrations.account_ref), data_json = excluded.data_json, "
            "updated_at = excluded.updated_at",
            (new_id("int"), venture["id"], status, account_ref, json.dumps(data), now, now))
        await bus.emit(tx, venture_id=venture["id"], type="venture.updated", entity_kind="venture", entity_id=venture["id"],
                       data={**venture, "integration": {"provider": "github", "status": status}})


def _client(settings: Any) -> ComposioClient:
    client = ComposioClient(settings)
    if not client.configured:
        raise DependencyError("composio", "COMPOSIO_API_KEY is not set — GitHub features run in no-GitHub mode",
                              unavailable=True)
    return client


async def connect_github(db: Any, client: ComposioClient, venture: dict[str, Any], *, approval_id: str,
                         callback_url: str) -> dict[str, Any]:
    """Gated (`integration`): returns the Composio connect link and records the pending connection."""
    approval = await gates.require_approved(db, approval_id, "integration")
    payload = json.loads(approval["payload_json"] or "{}")
    if (approval["venture_id"] != venture["id"] or payload.get("provider") != "github"
            or (payload.get("composio_user_id") is not None and payload["composio_user_id"] != venture["composio_user_id"])
            or (payload.get("callback_url") is not None and payload["callback_url"] != callback_url)):
        raise GateNotApproved(approval_id, "integration")
    link = await client.create_connect_link(venture["composio_user_id"], callback_url)
    await _upsert(db, venture, "pending", link.get("connected_account_id"), {"approval_id": approval_id})
    return link


@router.get("/v1/ventures/{vid}/integrations", response_model=IntegrationListEnvelope)
async def list_integrations(vid: str, request: Request) -> dict[str, Any]:
    db = request.app.state.db
    venture = await _venture(db, vid)
    rows = await db.fetch_all("SELECT provider, status, account_ref FROM integrations WHERE venture_id = ? AND provider != 'github'", (vid,))
    return {"data": {"items": [await _item(db, venture), *[IntegrationItem(**row) for row in rows]]}}


@router.post("/v1/ventures/{vid}/integrations/github/connect", response_model=ConnectEnvelope)
async def github_connect(vid: str, body: ConnectRequest, request: Request) -> dict[str, Any]:
    db, settings = request.app.state.db, request.app.state.settings
    venture = await _venture(db, vid)
    client = _client(settings)
    latest = await db.fetch_one(
        "SELECT id, status, payload_json FROM approvals WHERE venture_id = ? AND gate_type = 'integration' "
        "ORDER BY created_at DESC, id DESC LIMIT 1", (vid,))
    if (latest is None or latest["status"] not in ("pending", "approved")
            or json.loads(latest["payload_json"] or "{}").get("provider") != "github"
            or json.loads(latest["payload_json"] or "{}").get("callback_url") != body.callback_url):
        async with db.tx() as tx:
            approval_id = await gates.request_approval(
                tx, venture_id=vid, gate_type="integration", title="Connect GitHub",
                summary="Allow Foundry to connect your GitHub account through Composio (repos, PRs, issues).",
                payload={"provider": "github", "callback_url": body.callback_url, "scopes": "Composio-managed GitHub repositories, pull requests and issues; provider consent required", "composio_user_id": venture["composio_user_id"]})
        return {"data": {"redirect_url": None, "approval_id": approval_id, "status": "waiting_approval"}}
    if latest["status"] == "pending":
        return {"data": {"redirect_url": None, "approval_id": latest["id"], "status": "waiting_approval"}}
    try:
        link = await connect_github(db, client, venture, approval_id=latest["id"], callback_url=body.callback_url)
    except ComposioError as exc:
        raise DependencyError("composio", exc.user_message) from exc
    return {"data": {"redirect_url": link["redirect_url"], "approval_id": latest["id"], "status": "pending"}}


@router.post("/v1/ventures/{vid}/integrations/github/refresh", response_model=IntegrationEnvelope)
async def github_refresh(vid: str, request: Request) -> dict[str, Any]:
    db, settings = request.app.state.db, request.app.state.settings
    venture = await _venture(db, vid)
    client = _client(settings)
    try:
        status = await client.connection_status(venture["composio_user_id"])
    except ComposioError as exc:
        await _upsert(db, venture, "error", None, {"error": exc.user_message})
        raise DependencyError("composio", exc.user_message) from exc
    if status["connected"]:
        await _upsert(db, venture, "active", status["account_id"], {"composio_status": status["status"]})
    else:
        row = await db.fetch_one("SELECT status FROM integrations WHERE venture_id = ? AND provider = 'github'", (vid,))
        if row is not None:
            await _upsert(db, venture, "pending" if status["status"] in ("INITIATED", "INITIALIZING", "PENDING", "pending") else "not_connected" if status["status"] == "not_connected" else "error", None, {"composio_status": status["status"]})
    return {"data": await _item(db, await _venture(db, vid))}


@router.get("/v1/ventures/{vid}/integrations/catalog")
async def integration_catalog(vid: str, request: Request, search: str = Query("", max_length=200),
                              cursor: str | None = Query(None, max_length=2000), limit: int = Query(30, ge=1, le=100)) -> dict[str, Any]:
    await _venture(request.app.state.db, vid)
    try:
        return {"data": await _client(request.app.state.settings).toolkit_catalog(search, cursor, limit)}
    except ComposioError as exc:
        raise DependencyError("composio", exc.user_message) from exc


def _provider(provider: str) -> None:
    import re
    if not re.fullmatch(r"[a-z0-9_][a-z0-9_-]{0,99}", provider):
        raise HTTPException(422, "Invalid toolkit slug")


async def _save_toolkit(db: Any, vid: str, provider: str, status: str, account_ref: str | None) -> None:
    now = utc_now()
    async with db.tx() as tx:
        await tx.execute("INSERT INTO integrations(id,venture_id,provider,status,account_ref,data_json,created_at,updated_at) VALUES(?,?,?,?,?,'{}',?,?) ON CONFLICT(venture_id,provider) DO UPDATE SET status=excluded.status,account_ref=excluded.account_ref,updated_at=excluded.updated_at",
                         (new_id("int"), vid, provider, status, account_ref, now, now))


@router.post("/v1/ventures/{vid}/integrations/{provider}/connect", response_model=ConnectEnvelope)
async def toolkit_connect(vid: str, provider: str, body: ConnectRequest, request: Request) -> dict[str, Any]:
    _provider(provider)
    db = request.app.state.db
    venture = await _venture(db, vid)
    client = _client(request.app.state.settings)
    rows = await db.fetch_all("SELECT * FROM approvals WHERE venture_id=? AND gate_type='integration' ORDER BY created_at DESC, id DESC", (vid,))
    latest = next((row for row in rows if json.loads(row["payload_json"] or "{}").get("provider") == provider and json.loads(row["payload_json"] or "{}").get("callback_url") == body.callback_url), None)
    if latest is None or latest["status"] not in ("pending", "approved"):
        async with db.tx() as tx:
            aid = await gates.request_approval(tx, venture_id=vid, gate_type="integration", title=f"Connect {provider}",
                summary="Authorize an optional account connection through Composio. Provider consent is still required. This does not authorize spending or tool execution.",
                payload={"provider": provider, "callback_url": body.callback_url, "scopes": "Enabled toolkit-specific auth configuration; exact provider permissions require separate consent", "composio_user_id": venture["composio_user_id"]})
        return {"data": {"redirect_url": None, "approval_id": aid, "status": "waiting_approval"}}
    if latest["status"] == "pending":
        return {"data": {"redirect_url": None, "approval_id": latest["id"], "status": "waiting_approval"}}
    approval = await gates.require_approved(db, latest["id"], "integration")
    payload = json.loads(approval["payload_json"] or "{}")
    if approval["venture_id"] != vid or payload.get("provider") != provider or payload.get("callback_url") != body.callback_url or (payload.get("composio_user_id") is not None and payload["composio_user_id"] != venture["composio_user_id"]):
        raise GateNotApproved(latest["id"], "integration")
    try:
        link = await client.toolkit_connect_link(provider, venture["composio_user_id"], body.callback_url)
    except ComposioError as exc:
        raise DependencyError("composio", exc.user_message) from exc
    await _save_toolkit(db, vid, provider, "pending", link.get("connected_account_id"))
    return {"data": {"redirect_url": link["redirect_url"], "approval_id": latest["id"], "status": "pending"}}


@router.post("/v1/ventures/{vid}/integrations/{provider}/refresh", response_model=IntegrationEnvelope)
async def toolkit_refresh(vid: str, provider: str, request: Request) -> dict[str, Any]:
    _provider(provider)
    db = request.app.state.db
    venture = await _venture(db, vid)
    try:
        status = await _client(request.app.state.settings).toolkit_connection_status(provider, venture["composio_user_id"])
    except ComposioError as exc:
        raise DependencyError("composio", exc.user_message) from exc
    await _save_toolkit(db, vid, provider, status["status"], status["account_ref"])
    return {"data": IntegrationItem(provider=provider, **status)}
