# 06 — Security, Secrets and Safety

> **Prior art in the old repo** — `backend/factory/.../composio_publisher.py` has secret-content regexes, blocked filenames/suffixes and size limits to adapt for `redact()`, file-block validation and GitHub publishing. Do **not** take the old defaults of binding `0.0.0.0` or putting a token in the browser (`src/api.ts`). What may and may not be reused: [`../reference/foundry-existing-repo-notes.md`](../reference/foundry-existing-repo-notes.md).

## Secrets

- All secrets live only in `argon-app/.env` (gitignored). `config.py` reads them with
  `pydantic-settings` as `SecretStr`. Full list: [`../02-models-and-integrations/09-env-and-keys.md`](../02-models-and-integrations/09-env-and-keys.md).
- The browser never receives a secret. No `VITE_*` variable may contain a key.
- Logs, run outputs, artifacts and events MUST pass through `redact(text)` before being stored:
  replace matches of these patterns with `[REDACTED]`:
  `AIza[0-9A-Za-z_\-]{30,}`, `sk-[A-Za-z0-9_\-]{16,}`, `github_pat_[A-Za-z0-9_]{16,}`,
  `gh[pousr]_[A-Za-z0-9]{20,}`, `xi-[A-Za-z0-9]{16,}`, `-----BEGIN [A-Z ]*PRIVATE KEY-----`,
  and the literal values of every configured secret.
- Antigravity sandboxes receive the GitHub token only through the **Credentials API**
  (`client.credentials.create`) so it is injected at the proxy and never enters model context
  (per Google's guide). The network allowlist is `["github.com", "api.github.com",
  "registry.npmjs.org", "objects.githubusercontent.com", "codeload.github.com"]`.

## Gated actions (hard rule)

The following functions MUST call `gates.require_approved(conn, approval_id, gate_type)` and
raise `GateNotApproved` otherwise. No other code path may perform these actions.

| Action | Function | Gate type |
|---|---|---|
| Merge a PR | `integrations.composio.merge_pull_request` | `merge` |
| Post a public GitHub comment / reply to a user | `integrations.composio.create_issue_comment` | `outreach` |
| Connect GitHub | `api.integrations.connect_github` | `integration` |
| Register a generated agent | `departments.finance_people.register_agent` | `new_capability` |
| Continue spending past budget | `ledger.raise_cap` | `spend` |
| Proceed after a revise/kill verdict | `departments.pivot.proceed_override` | `pivot` |
| Start building after ambiguities | `departments.intake.write_spec` (second pass) | `clarification` |
| Computer action on a login/sign-up/checkout/contact form | `computers.loop.execute_gated_action` | `computer_action` |

Cloud computers (Cua) also follow: per-task domain allowlists; agents never type real credentials;
no downloads/executables; every action logged in `computer_actions` with a screenshot
([`../02-models-and-integrations/10-cua-cloud-computers.md`](../02-models-and-integrations/10-cua-cloud-computers.md)).

Opening a PR on a feature branch is **not** gated (it changes nothing users see). Pushing to
`main` is never done by agents.

## Running generated code

- `LocalLoopExecutor` runs product tests inside `data/workspaces/<vid>/<tid>/` with:
  - `subprocess` with `cwd` set to the workspace, `env` stripped to `PATH`, `HOME`=workspace,
    `CI=1`, `NODE_ENV=test` (no secrets);
  - wall-clock timeout `LOCAL_TEST_TIMEOUT_SECONDS` (default 180), output capped at 200 KB;
  - if Docker is available (`docker info` succeeds) and `LOCAL_SANDBOX=docker`, run inside
    `node:20-bookworm-slim` with `--network none --memory 2g --cpus 2 -v <ws>:/ws -w /ws`.
- File blocks emitted by models are rejected if their path is absolute, contains `..`, starts with
  `.git/`, or matches `.env*`, `*.pem`, `*.key`.
- Generated world modules are validated statically before being imported (see
  [`../05-world/09-worldgen-pipeline.md`](../05-world/09-worldgen-pipeline.md) §Validation): no
  `import` except from `../../kit/types`, no `fetch`, `eval`, `Function(`, `document`, `window`,
  `localStorage`, `XMLHttpRequest`, `WebSocket`, `import(`.

## Model output trust

- Model JSON is parsed with `llm/jsonout.py` and validated against a Pydantic model. Invalid output
  → one repair attempt ("Return only valid JSON matching this schema: …") → else the handler fails.
- Agents answering in conversation only see the context pack; they cannot call tools that change
  state. Conversation endpoints are read-only (they write `answers`, `runs`, `ledger` only).

## Private data

- Uploaded context files stay in `data/uploads/<vid>/` and are only sent to Gemini models.
- Lead Intelligence uses public, business-level information only; no personal data scraping.
  Its prompt forbids collecting personal emails/phones.
