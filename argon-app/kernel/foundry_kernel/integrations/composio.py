# OWNER: ayan — seed version; replace/extend freely but keep the public signatures.
"""Composio REST client — 02-models-and-integrations/04-composio.md.

REST via httpx (no SDK). Connection calls (auth config, connect link, status) follow the shapes the old
Foundry repo used in production. Tool execution (`v3/tools/execute/{slug}`) and the tool slugs are
VERIFY items: confirm them with `python -m foundry_kernel.integrations.composio probe` + the Composio
docs and record the result in docs/verified/ayan.md. Only this module knows Composio's wire format.

Gated actions (01-architecture/06-security-and-secrets.md): `merge_pull_request` (merge) and
`create_issue_comment` (outreach) call `gates.require_approved` before touching GitHub."""
from __future__ import annotations

import asyncio
import base64
import json
import re
import sys
from contextvars import ContextVar
from typing import Any
from urllib.parse import urlparse

import httpx

from .. import gates
from ..errors import GateNotApproved
from ..ids import utc_now
from ..security import redact

_approved_execution: ContextVar[Any] = ContextVar("composio_approved_execution", default=None)

ALLOWED_TOOLKITS = {"github"}  # expand only with a recorded decision (02-models-and-integrations/08)

# Assumed slugs (04-composio.md table) — VERIFY with GET v3/tools?toolkit_slug=github&limit=200.
TOOL_SLUGS: dict[str, str] = {
    "get_authenticated_user": "GITHUB_GET_THE_AUTHENTICATED_USER",
    "create_repo": "GITHUB_CREATE_A_REPOSITORY_FOR_THE_AUTHENTICATED_USER",
    "get_ref": "GITHUB_GET_A_REFERENCE",
    "get_pull_request": "GITHUB_GET_A_PULL_REQUEST",
    "create_branch": "GITHUB_CREATE_A_REFERENCE",
    "put_file": "GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS",
    "open_pr": "GITHUB_CREATE_A_PULL_REQUEST",
    "list_pr_files": "GITHUB_LIST_PULL_REQUESTS_FILES",
    "list_issues": "GITHUB_LIST_REPOSITORY_ISSUES",
    "list_issue_comments": "GITHUB_LIST_ISSUE_COMMENTS",
    "create_issue_comment": "GITHUB_CREATE_AN_ISSUE_COMMENT",
    "merge_pull_request": "GITHUB_MERGE_A_PULL_REQUEST",
}


class ComposioError(Exception):
    """A Composio failure with a message that is safe to show in the browser."""

    def __init__(self, user_message: str, status_code: int | None = None) -> None:
        super().__init__(user_message)
        self.user_message = user_message
        self.status_code = status_code


def _safe_message(status: int) -> str:
    if status in (401, 403):
        return "Composio rejected the API key"
    if status == 402:
        return "Requires configuration: Composio account or plan does not permit this request. No paid plan or credits were purchased."
    if status == 429:
        return "Composio rate limited the request"
    return f"Composio request failed (HTTP {status})"


def _safe_connect_url(value: str) -> str:
    parsed = urlparse(value)
    allowed = {"connect.composio.dev", "backend.composio.dev"}
    if parsed.path.startswith("/login/oauth"):
        allowed.add("github.com")
    if (parsed.scheme != "https" or parsed.hostname not in allowed
            or parsed.username or parsed.password or parsed.netloc not in allowed | {host + ":443" for host in allowed}):
        raise ComposioError("Composio returned an invalid connect link")
    return value


def _split_repo(repo_full_name: str) -> tuple[str, str]:
    owner, _, repo = repo_full_name.partition("/")
    if not owner or not repo:
        raise ComposioError(f"invalid repository name: {repo_full_name!r}")
    return owner, repo


def _unwrap(data: Any) -> Any:
    """Tool responses may nest the GitHub payload under data / response_data (VERIFY); peel those layers."""
    for _ in range(3):
        if isinstance(data, dict) and len(data) <= 3:
            for key in ("data", "response_data"):
                if key in data and isinstance(data[key], dict | list):
                    data = data[key]
                    break
            else:
                break
        else:
            break
    return data


def _as_list(data: Any, *keys: str) -> list[dict[str, Any]]:
    data = _unwrap(data)
    if isinstance(data, list):
        return [d for d in data if isinstance(d, dict)]
    if isinstance(data, dict):
        for key in (*keys, "items", "details"):
            value = data.get(key)
            if isinstance(value, list):
                return [d for d in value if isinstance(d, dict)]
    return []


class ComposioClient:
    def __init__(self, settings: Any, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.settings = settings
        self._transport = transport
        base = str(settings.composio_base_url or "https://backend.composio.dev/api/")
        self.base_url = base if base.endswith("/") else base + "/"

    @property
    def configured(self) -> bool:
        key = self.settings.composio_api_key
        return bool(key and key.get_secret_value())

    def _headers(self) -> dict[str, str]:
        if not self.configured:
            raise ComposioError("COMPOSIO_API_KEY is not set")
        return {"x-api-key": self.settings.composio_api_key.get_secret_value(), "Accept": "application/json"}

    async def _request(self, method: str, path: str, *, params: dict[str, Any] | None = None,
                       body: dict[str, Any] | None = None) -> Any:
        headers = self._headers()
        try:
            async with httpx.AsyncClient(base_url=self.base_url, transport=self._transport, timeout=60.0) as http:
                resp = await http.request(method, path, params=params, json=body, headers=headers)
        except httpx.HTTPError as exc:
            raise ComposioError("Composio is unreachable") from exc
        if resp.status_code >= 400:
            raise ComposioError(_safe_message(resp.status_code), resp.status_code)
        try:
            return resp.json()
        except ValueError as exc:
            raise ComposioError("Composio returned an invalid response", resp.status_code) from exc

    async def toolkit_catalog(self, search: str = "", cursor: str | None = None, limit: int = 30) -> dict[str, Any]:
        """Provider v3.1 catalog: https://docs.composio.dev/reference/api-reference/toolkits/get-toolkits."""
        params: dict[str, Any] = {"search": search, "limit": limit, "sort_by": "alphabetically", "type": "all"}
        if cursor:
            params["cursor"] = cursor
        data = await self._request("GET", "v3.1/toolkits", params=params)
        if not isinstance(data, dict) or not isinstance(data.get("items"), list):
            raise ComposioError("Composio returned an invalid toolkit catalog")
        items = []
        for item in data["items"]:
            meta = item.get("meta") or {}
            logo = str(meta.get("logo") or "")
            parsed = urlparse(logo)
            items.append({"slug": item["slug"], "name": item.get("name") or item["slug"],
                          "description": meta.get("description") or "",
                          "logo": logo if parsed.scheme == "https" and parsed.netloc and not parsed.username and not parsed.password else None,
                          "auth_schemes": item.get("auth_schemes") or []})
        return {"items": items, "next_cursor": data.get("next_cursor"), "total_items": data.get("total_items")}

    async def toolkit_connect_link(self, toolkit: str, user_id: str, callback_url: str) -> dict[str, Any]:
        # Never borrow GitHub credentials or silently create provider configuration.
        cursor = None
        while True:
            params = {"toolkit_slug": toolkit, "limit": 50}
            if cursor:
                params["cursor"] = cursor
            data = await self._request("GET", "v3.1/auth_configs", params=params)
            for item in data.get("items", []):
                if ((item.get("toolkit") or {}).get("slug") == toolkit
                        and item.get("status") == "ENABLED" and item.get("id")):
                    result = await self._request("POST", "v3/connected_accounts/link", body={
                        "auth_config_id": item["id"], "user_id": user_id, "callback_url": callback_url})
                    redirect = str(result.get("redirect_url") or "")
                    _safe_connect_url(redirect)
                    return {"redirect_url": redirect, "connected_account_id": result.get("connected_account_id")}
            next_cursor = data.get("next_cursor")
            if not next_cursor or next_cursor == cursor:
                break
            cursor = next_cursor
        raise ComposioError("Requires configuration: enable an auth config for this toolkit in your Composio project. No account has been connected.")

    async def toolkit_connection_status(self, toolkit: str, user_id: str) -> dict[str, Any]:
        cursor = None
        observed = "not_connected"
        while True:
            params = {"toolkit_slugs": toolkit, "user_ids": user_id, "limit": 100}
            if cursor:
                params["cursor"] = cursor
            data = await self._request("GET", "v3.1/connected_accounts", params=params)
            for item in data.get("items", []):
                if ((item.get("toolkit") or {}).get("slug") == toolkit and item.get("user_id") == user_id
                        and item.get("status") == "ACTIVE" and item.get("is_disabled") is not True):
                    return {"status": "active", "account_ref": item.get("id")}
            for item in data.get("items", []):
                if ((item.get("toolkit") or {}).get("slug") == toolkit and item.get("user_id") == user_id):
                    if item.get("is_disabled") is True or item.get("status") in ("FAILED", "EXPIRED", "INACTIVE"):
                        observed = "error"
                    elif observed != "error" and item.get("status") in ("INITIATED", "INITIALIZING", "PENDING"):
                        observed = "pending"
            next_cursor = data.get("next_cursor")
            if not next_cursor or next_cursor == cursor:
                break
            cursor = next_cursor
        return {"status": observed, "account_ref": None}

    # ------------------------------------------------------------------ connection flow

    async def find_or_create_auth_config(self) -> str:
        data = await self._request("GET", "v3.1/auth_configs",
                                   params={"toolkit_slug": "github", "is_composio_managed": "true", "limit": 50})
        for item in data.get("items", []) if isinstance(data, dict) else []:
            toolkit = item.get("toolkit") or {}
            if (toolkit.get("slug") == "github" and item.get("is_composio_managed") is True
                    and item.get("status") == "ENABLED" and item.get("id")):
                return str(item["id"])
        created = await self._request("POST", "v3/auth_configs", body={
            "toolkit": {"slug": "github"},
            "auth_config": {"type": "use_composio_managed_auth", "credentials": {}, "restrict_to_following_tools": []}})
        auth_id = ((created or {}).get("auth_config") or {}).get("id") if isinstance(created, dict) else None
        if not auth_id:
            raise ComposioError("Composio did not return an auth config id")
        return str(auth_id)

    async def create_connect_link(self, user_id: str, callback_url: str) -> dict[str, Any]:
        auth_config_id = await self.find_or_create_auth_config()
        data = await self._request("POST", "v3/connected_accounts/link", body={
            "auth_config_id": auth_config_id, "user_id": user_id, "callback_url": callback_url})
        redirect = str((data or {}).get("redirect_url") or "")
        _safe_connect_url(redirect)
        return {"redirect_url": redirect, "connected_account_id": (data or {}).get("connected_account_id")}

    async def connection_status(self, user_id: str) -> dict[str, Any]:
        data = await self._request("GET", "v3.1/connected_accounts",
                                   params={"toolkit_slugs": "github", "user_ids": user_id, "limit": 50})
        items = data.get("items", []) if isinstance(data, dict) else []
        status = "not_connected"
        for item in items:
            if (item.get("toolkit") or {}).get("slug") != "github" or item.get("user_id") != user_id:
                continue
            if item.get("status") == "ACTIVE" and item.get("is_disabled") is not True:
                return {"connected": True, "account_id": item.get("id"), "status": "ACTIVE"}
            status = str(item.get("status") or "pending")
        return {"connected": False, "account_id": None, "status": status}

    # ------------------------------------------------------------------ tool execution (VERIFY)

    async def execute(self, tool_slug: str, user_id: str, arguments: dict[str, Any]) -> Any:
        if tool_slug in (TOOL_SLUGS["merge_pull_request"], TOOL_SLUGS["create_issue_comment"]):
            if _approved_execution.get() != (tool_slug, user_id, arguments):
                raise GateNotApproved(None, "merge" if tool_slug == TOOL_SLUGS["merge_pull_request"] else "outreach")
        if not tool_slug.startswith(tuple(t.upper() + "_" for t in ALLOWED_TOOLKITS)):
            raise ComposioError(f"toolkit for {tool_slug} is not allowed")
        data = await self._request("POST", f"v3/tools/execute/{tool_slug}",
                                   body={"user_id": user_id, "arguments": arguments})
        if isinstance(data, dict) and data.get("successful") is False:
            raise ComposioError(f"{tool_slug} failed: {redact(str(data.get('error') or 'unknown error'))[:300]}")
        return _unwrap(data.get("data", data) if isinstance(data, dict) else data)

    async def get_authenticated_user(self, user_id: str) -> dict[str, Any]:
        return dict(await self.execute(TOOL_SLUGS["get_authenticated_user"], user_id, {}) or {})

    async def create_repo(self, user_id: str, name: str, private: bool, description: str) -> dict[str, Any]:
        return dict(await self.execute(TOOL_SLUGS["create_repo"], user_id, {
            "name": name, "private": private, "description": description, "auto_init": True}) or {})

    async def get_ref(self, user_id: str, repo_full_name: str, branch: str) -> str:
        owner, repo = _split_repo(repo_full_name)
        data = await self.execute(TOOL_SLUGS["get_ref"], user_id, {"owner": owner, "repo": repo, "ref": f"heads/{branch}"})
        sha = ((data or {}).get("object") or {}).get("sha") if isinstance(data, dict) else None
        if not sha:
            raise ComposioError(f"no ref heads/{branch} in {repo_full_name}")
        return str(sha)

    async def create_branch(self, user_id: str, repo_full_name: str, branch: str, from_sha: str) -> None:
        owner, repo = _split_repo(repo_full_name)
        await self.execute(TOOL_SLUGS["create_branch"], user_id,
                           {"owner": owner, "repo": repo, "ref": f"refs/heads/{branch}", "sha": from_sha})

    async def put_file(self, user_id: str, repo_full_name: str, branch: str, path: str, content: bytes,
                       message: str, sha: str | None = None) -> dict[str, Any]:
        owner, repo = _split_repo(repo_full_name)
        args: dict[str, Any] = {"owner": owner, "repo": repo, "path": path, "message": message,
                                "content": base64.b64encode(content).decode(), "branch": branch}
        if sha:
            args["sha"] = sha
        return dict(await self.execute(TOOL_SLUGS["put_file"], user_id, args) or {})

    async def open_pr(self, user_id: str, repo_full_name: str, head: str, base: str, title: str, body: str) -> dict[str, Any]:
        owner, repo = _split_repo(repo_full_name)
        return dict(await self.execute(TOOL_SLUGS["open_pr"], user_id, {
            "owner": owner, "repo": repo, "head": head, "base": base, "title": title, "body": body}) or {})

    async def get_pull_request(self, user_id: str, repo_full_name: str, number: int) -> dict[str, Any]:
        owner, repo = _split_repo(repo_full_name)
        return dict(await self.execute(TOOL_SLUGS["get_pull_request"], user_id,
                                       {"owner": owner, "repo": repo, "pull_number": number}) or {})

    async def list_pr_files(self, user_id: str, repo_full_name: str, number: int) -> list[dict[str, Any]]:
        owner, repo = _split_repo(repo_full_name)
        return _as_list(await self.execute(TOOL_SLUGS["list_pr_files"], user_id,
                                           {"owner": owner, "repo": repo, "pull_number": number}), "files")

    async def list_issues(self, user_id: str, repo_full_name: str, since: str | None) -> list[dict[str, Any]]:
        owner, repo = _split_repo(repo_full_name)
        args: dict[str, Any] = {"owner": owner, "repo": repo, "state": "open"}
        if since:
            args["since"] = since
        return _as_list(await self.execute(TOOL_SLUGS["list_issues"], user_id, args), "issues")

    async def list_issue_comments(self, user_id: str, repo_full_name: str, number: int) -> list[dict[str, Any]]:
        owner, repo = _split_repo(repo_full_name)
        return _as_list(await self.execute(TOOL_SLUGS["list_issue_comments"], user_id,
                                           {"owner": owner, "repo": repo, "issue_number": number}), "comments")


# ------------------------------------------------------------------ helpers + gated actions


async def github_integration(db: Any, venture_id: str) -> dict[str, Any] | None:
    """The venture's GitHub integration row when it is active, else None."""
    row = await db.fetch_one("SELECT * FROM integrations WHERE venture_id = ? AND provider = 'github'", (venture_id,))
    if row is None or row["status"] != "active":
        return None
    row = dict(row)
    try:
        row["data"] = json.loads(row.pop("data_json") or "{}")
    except ValueError:
        row["data"] = {}
    return row


async def _approved_target(db: Any, approval_id: str | None, gate_type: str, user_id: str,
                           repo_full_name: str, number: int, *, body: str | None = None,
                           method: str | None = None) -> dict[str, Any]:
    async with db.tx() as tx:
        approval = await gates.require_approved(tx, approval_id, gate_type)
        venture = await tx.fetch_one("SELECT * FROM ventures WHERE id=?", (approval["venture_id"],))
        try:
            payload = json.loads(approval["payload_json"] or "{}")
        except (TypeError, ValueError):
            raise GateNotApproved(approval_id, gate_type) from None
        number_key = "pr_number" if gate_type == "merge" else "issue_number"
        if (not venture or venture["composio_user_id"] != user_id
                or venture["repo_full_name"] != repo_full_name
                or not isinstance(payload, dict) or payload.get("repo_full_name") != repo_full_name
                or type(number) is not int or number < 1 or type(payload.get(number_key)) is not int
                or payload[number_key] != number):
            raise GateNotApproved(approval_id, gate_type)
        if gate_type == "outreach" and (payload.get("channel") != "github_comment" or payload.get("body") != body):
            raise GateNotApproved(approval_id, gate_type)
        if gate_type == "merge" and (payload.get("local") is True or payload.get("merge_method", "squash") != method):
            raise GateNotApproved(approval_id, gate_type)
        if gate_type == "merge" and (method not in ("merge", "squash", "rebase")
                or not isinstance(payload.get("head_sha"), str)
                or not re.fullmatch(r"[0-9a-fA-F]{40}", payload["head_sha"])):
            raise GateNotApproved(approval_id, gate_type)
        key = "composio.approval_consumed." + str(approval_id)
        if await tx.fetch_one("SELECT key FROM kv WHERE key=?", (key,)):
            raise GateNotApproved(approval_id, gate_type)
        await tx.execute("INSERT INTO kv (key, value_json, updated_at) VALUES (?,?,?)",
                         (key, json.dumps({"venture_id": approval["venture_id"], "gate_type": gate_type}), utc_now()))
        return payload


async def _execute_approved(client: ComposioClient, slug: str, user_id: str, args: dict[str, Any]) -> Any:
    token = _approved_execution.set((slug, user_id, args))
    try:
        return await client.execute(slug, user_id, args)
    finally:
        _approved_execution.reset(token)


async def create_issue_comment(db: Any, client: ComposioClient, *, approval_id: str | None, user_id: str,
                               repo_full_name: str, number: int, body: str) -> dict[str, Any]:
    """Post only the exact approved reply to the approved venture's repository and issue."""
    await _approved_target(db, approval_id, "outreach", user_id, repo_full_name, number, body=body)
    owner, repo = _split_repo(repo_full_name)
    return dict(await _execute_approved(client, TOOL_SLUGS["create_issue_comment"], user_id,
                                     {"owner": owner, "repo": repo, "issue_number": number, "body": body}) or {})


async def merge_pull_request(db: Any, client: ComposioClient, *, approval_id: str | None, user_id: str,
                             repo_full_name: str, number: int, method: str = "squash") -> dict[str, Any]:
    """Merge only the exact approved PR for the approved venture and merge method."""
    payload = await _approved_target(db, approval_id, "merge", user_id, repo_full_name, number, method=method)
    owner, repo = _split_repo(repo_full_name)
    args = {"owner": owner, "repo": repo, "pull_number": number, "merge_method": method}
    if payload.get("head_sha"):
        args["sha"] = payload["head_sha"]
    return dict(await _execute_approved(client, TOOL_SLUGS["merge_pull_request"], user_id, args) or {})


# ------------------------------------------------------------------ Step A.3 probe


def _shape(value: Any, depth: int = 0) -> Any:
    """Keys and types only — never values (the probe output may be pasted into docs)."""
    if depth > 4:
        return "…"
    if isinstance(value, dict):
        return {k: _shape(v, depth + 1) for k, v in value.items()}
    if isinstance(value, list):
        return [_shape(value[0], depth + 1)] if value else []
    return type(value).__name__


async def probe(settings: Any = None) -> int:
    from ..config import get_settings

    client = ComposioClient(settings or get_settings())
    if not client.configured:
        print("COMPOSIO_API_KEY not set — skipping the Composio probe (no-GitHub mode).")
        return 0
    try:
        data = await client._request("GET", "v3.1/auth_configs",
                                     params={"limit": 100})
    except ComposioError as exc:
        print(f"Composio probe FAIL: {exc.user_message}")
        return 1
    print("Composio configured:", client.configured)
    print("Auth configs on first page:", len(data.get("items", [])), "enabled managed available:", any(item.get("status") == "ENABLED" and item.get("is_composio_managed") is True and (item.get("toolkit") or {}).get("slug") == "github" for item in data.get("items", [])))
    counts: dict[str, int] = {}
    for item in data.get("items", []):
        key = str((item.get("toolkit") or {}).get("slug", "unknown")) + ":" + str(item.get("status", "unknown"))
        counts[key] = counts.get(key, 0) + 1
    print("Auth config toolkit/status counts:", json.dumps(counts), "has_more:", bool(data.get("next_cursor")))
    return 0


if __name__ == "__main__":
    if sys.argv[1:2] != ["probe"]:
        print("usage: python -m foundry_kernel.integrations.composio probe")
        raise SystemExit(2)
    raise SystemExit(asyncio.run(probe()))
