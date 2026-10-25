# 04 — Composio (GitHub integration)

> **Prior art in the old repo** — the connect/status calls below come from `backend/factory/.../composio_integration.py` and `api/composio/github.ts`, which worked in the old build; adapt them. Tool execution was never implemented there. What may and may not be reused: [`../reference/foundry-existing-repo-notes.md`](../reference/foundry-existing-repo-notes.md).

Composio brokers the founder's GitHub account: OAuth connection, and tool calls the kernel makes
on the company's behalf (create repo, branches, files, PRs, issues, comments, merges).
Implementation: `foundry_kernel/integrations/composio.py` (REST via `httpx`, no SDK — fewer
unknowns).

## Configuration

| Env var | Required | Meaning |
|---|---|---|
| `COMPOSIO_API_KEY` | for GitHub features | Composio project API key (dashboard → Settings → API keys) |
| `COMPOSIO_BASE_URL` | no | default `https://backend.composio.dev/api/` |

The Composio **user id** for a venture is `foundry:<venture_id>` (stored in
`ventures.composio_user_id`).

## Connection flow (shapes used by the existing Foundry repo's working code)

These REST calls are copied from the existing repo's `backend/factory/.../composio_integration.py`
and `api/composio/github.ts`, which use them in production. Headers: `x-api-key: <key>`,
`Accept: application/json`.

1. **Find or create a Composio-managed GitHub auth config**
   - `GET v3.1/auth_configs?toolkit_slug=github&is_composio_managed=true&limit=50` → `items[]`;
     pick the first with `toolkit.slug == "github"`, `is_composio_managed == true`,
     `status == "ENABLED"`; use its `id`.
   - If none: `POST v3/auth_configs` with
     `{"toolkit":{"slug":"github"},"auth_config":{"type":"use_composio_managed_auth","credentials":{},"restrict_to_following_tools":[]}}`
     → `auth_config.id`.
2. **Create a connect link**
   - `POST v3/connected_accounts/link` with
     `{"auth_config_id": "<id>", "user_id": "foundry:<vid>", "callback_url": "<dashboard url>"}` →
     `{"redirect_url": "https://...", "connected_account_id": "..."}`. Validate the URL is https.
3. **Check status**
   - `GET v3.1/connected_accounts?toolkit_slugs=github&user_ids=foundry:<vid>&limit=50` →
     `items[]`; connected when an item has `toolkit.slug=="github"`, `user_id` matches,
     `status=="ACTIVE"`, `is_disabled != true`. Store its `id` in `integrations.account_ref`.

Errors: 401/403 → "Composio rejected the API key"; 429 → "rate limited"; others → generic.
Never return Composio error bodies to the browser verbatim.

## Tool execution — VERIFY

The existing repo never executed tools, so the execution endpoint is unconfirmed. At T+0 confirm:

- **Endpoint (assumed):** `POST v3/tools/execute/{tool_slug}` with body
  `{"user_id": "foundry:<vid>", "arguments": {...}}` (or `connected_account_id`). Response assumed
  `{"data": {...}, "successful": true, "error": null}`.
- **Tool slugs:** list with `GET v3/tools?toolkit_slug=github&limit=200` and search by name. The
  spec assumes these slugs (adjust names only in `composio.py`):

| Kernel method | Assumed tool slug | Arguments (GitHub REST names) |
|---|---|---|
| `get_authenticated_user()` | `GITHUB_GET_THE_AUTHENTICATED_USER` | — |
| `create_repo(name, private, description)` | `GITHUB_CREATE_A_REPOSITORY_FOR_THE_AUTHENTICATED_USER` | `name`, `private`, `description`, `auto_init: true` |
| `get_ref(repo, branch)` | `GITHUB_GET_A_REFERENCE` | `owner`, `repo`, `ref: "heads/<branch>"` |
| `create_branch(repo, branch, from_sha)` | `GITHUB_CREATE_A_REFERENCE` | `owner`, `repo`, `ref: "refs/heads/<branch>"`, `sha` |
| `put_file(repo, branch, path, content_b64, message, sha?)` | `GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS` | `owner`, `repo`, `path`, `message`, `content`, `branch`, `sha?` |
| `open_pr(repo, head, base, title, body)` | `GITHUB_CREATE_A_PULL_REQUEST` | `owner`, `repo`, `head`, `base`, `title`, `body` |
| `list_issues(repo, since)` | `GITHUB_LIST_REPOSITORY_ISSUES` | `owner`, `repo`, `state: "open"`, `since` |
| `list_issue_comments(repo, number)` | `GITHUB_LIST_ISSUE_COMMENTS` | `owner`, `repo`, `issue_number` |
| `create_issue_comment(repo, number, body)` **[gated: outreach]** | `GITHUB_CREATE_AN_ISSUE_COMMENT` | `owner`, `repo`, `issue_number`, `body` |
| `merge_pull_request(repo, number, method)` **[gated: merge]** | `GITHUB_MERGE_A_PULL_REQUEST` | `owner`, `repo`, `pull_number`, `merge_method: "squash"` |

Record the confirmed endpoint and slugs in `docs/VERIFIED_API_SHAPES.md`.

## Repository lifecycle

- First `eng.design` completion for a venture with `repo_full_name IS NULL` and GitHub `active`:
  `create_repo(name=f"foundry-{slug}", private=True, description=idea[:300])`, store
  `repo_full_name`/`repo_url`, emit `venture.updated`.
- Initial scaffold: the first `eng.build` pushes the template
  (`executors/templates/vite-react-ts/`) as part of its branch; the kernel never pushes to `main`
  directly — `main` only changes by merging approved PRs.
- **LocalLoopExecutor publishing:** after a passing local loop, the kernel creates branch
  `foundry/<tid8>-<slug>` from `main`'s SHA and writes changed files one by one with `put_file`
  (max 200 files, each ≤ 1 MB; skip `node_modules`, `dist`, lockfiles > 1 MB), then `open_pr`.

## No-GitHub mode (always works)

If GitHub is not connected or Composio is down, engineering still runs locally: the result is a
`code` artifact (diff summary + file list), a `preview` artifact (`/preview/<vid>/<tid>/`), and the
`merge` gate becomes "Accept build into the product" (payload `{"local": true}`); approving copies
the workspace into `data/products/<vid>/main/`. The UI labels these "local build — not on GitHub".

## `github_watch.py` (support loop)

Every `GITHUB_POLL_SECONDS` (default 60) for each running venture with an active GitHub
integration and a repo:
1. `list_issues(since = kv['gh.since.<vid>'])`; for each issue not in `github_seen` (and not a PR):
   create `support.issue` ticket with payload `{number, title, body, author, url, labels}`; insert
   `github_seen`.
2. For each open Foundry PR (artifacts kind `pr`, `meta.state == "open"`), list comments; new
   human comments → `eng.fix` ticket with payload `{pr_number, comment, url}`.
3. Update `kv['gh.since.<vid>']` to the poll start time.
Failures emit `system.warning` and back off to 5 minutes.
