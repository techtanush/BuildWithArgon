# 03 — Antigravity Managed Agents

> **Hackathon context.** Managed agents are a named prize category at the Gemini 4 Argon hackathon,
> so the Antigravity runs must be real, visible (Run detail page: interaction id, live progress,
> result) and central to the product — not a side demo. Coordination between these agents is
> described in [`../03-company-kernel/09-agent-coordination.md`](../03-company-kernel/09-agent-coordination.md).

Foundry's department agents that need a real computer — building and testing code, browsing,
running tools — run as **Antigravity managed agents** (`antigravity-preview-09-2026`) with Argon as
the model. Google provisions a hosted Linux sandbox per interaction where Argon plans, writes code,
verifies its own output, searches the web and calls MCP tools. This is Foundry's entry for
**Best use of Managed Agents**.

## Where managed agents are used

| Agent | Ticket types | Why a sandbox |
|---|---|---|
| `eng.builder` | `eng.build`, `eng.fix` | Clone repo, write code, install deps, run tests, push branch |
| `eng.qa` | `qa.verify` (when executor = antigravity) | Check out the PR branch, run the full suite + headless browser checks |
| `mr.competitor-analyst` | `research.competitors` | Web search and page reading for competitor facts |
| `li.lead-researcher` | `leads.icp` | Public web research for company-level ICP evidence |

All other agents use plain model calls (no sandbox).

## Orchestration shape (what judges should see in the dashboard)

```
cos.orchestrator (Argon, high)  ── plans the DAG, posts to #exec
   ├─ eng.tech-lead (Argon, high) ── designs + splits into build tasks
   │     ├─ eng.builder ×N  → Antigravity sandbox each (Argon inside)  [parallel across tickets,
   │     │                                                              max 1 build per repo at a time]
   │     ├─ eng.reviewer (Argon, medium) → reviews diff
   │     └─ eng.qa → Antigravity sandbox → verifies
   ├─ department agents (Flash) ── artifacts in parallel
   └─ Flash-Lite ── triage/routing/checks
```

Each Antigravity run is a `runs` row with `kind='ticket'`, `job='engineering_build'`, the
`interaction_id`, live `run_logs` (progress messages), token usage, cost, and the final
`FOUNDRY_RESULT` JSON. The Run detail page shows these.

## Credentials and network

1. At kernel start (if `ENGINEERING_EXECUTOR=antigravity`), create/refresh a credential for the
   GitHub token used by sandboxes:
   ```python
   cred = client.credentials.create(...)   # VERIFY (V8): name="github", value=GITHUB_SANDBOX_TOKEN
   ```
   Store the returned credential id in `kv['antigravity.github_credential_id']`.
2. Every engineering interaction uses:
   ```python
   environment = {
       "type": "remote",
       "network": {"allowlist": ["github.com", "api.github.com", "codeload.github.com",
                                 "objects.githubusercontent.com", "registry.npmjs.org"]},
       # VERIFY: how a credential id is attached to the environment (e.g. "credentials": [id])
   }
   ```
3. `GITHUB_SANDBOX_TOKEN` is a fine-grained GitHub PAT limited to the venture repos
   (Contents: read/write, Pull requests: read/write). It never appears in prompts.

## Engineering prompt template (`executors/antigravity.py`)

```text
You are {agent.display_name}, the Builder in Foundry's Engineering department. You work alone in a
Linux sandbox. Complete the ticket end to end and verify it yourself.

REPOSITORY: https://github.com/{repo_full_name}  (default branch: main)
BRANCH TO CREATE: foundry/{ticket_id_short}-{slug}
AUTH: git is pre-authenticated through the sandbox proxy. Never print or echo credentials.

TICKET {ticket_id}: {title}
{body}

ACCEPTANCE CRITERIA (from the spec; all must pass):
{acceptance_criteria as numbered list}

ARCHITECTURE NOTES (from eng.tech-lead):
{design excerpt for this task}

RULES
1. Clone the repo, create the branch, implement the change across all files needed.
2. Write or update tests for every acceptance criterion. Tests must be runnable with `npm test`.
3. Run `npm ci` (or `npm install` if no lockfile) and `npm test` and `npm run build`.
4. If anything fails: read the failure, fix the cause, rerun. Repeat until all pass, at most
   {max_iterations} iterations. Never delete or weaken a test to make it pass.
5. Commit with message "foundry({ticket_id_short}): {title}" and push the branch.
6. Do not open a pull request (Foundry opens it). Do not push to main.
7. Finish with EXACTLY one line starting with FOUNDRY_RESULT followed by JSON:
FOUNDRY_RESULT {"status":"passed"|"failed","branch":"...","commit":"<sha>",
 "iterations":<int>,"tests":{"passed":<int>,"failed":<int>},"build_ok":<bool>,
 "files_changed":["..."],"summary":"<=600 chars","failures":["..."]}
```

## Result handling

- Parse the last line matching `^FOUNDRY_RESULT (\{.*\})$` from `output_text`; validate with
  Pydantic `AntigravityResult`. Missing/invalid → ticket `failed` (retryable) with the tail of the
  output (last 4,000 chars) logged.
- `status == "passed"` → kernel opens the PR via Composio (`GITHUB_CREATE_A_PULL_REQUEST`, head =
  branch, base = main, body = summary + acceptance checklist + "Built by Foundry eng.builder (Argon,
  Antigravity) — run <run_id>"), stores a `pr` artifact, creates `eng.review` and `qa.verify`
  tickets if the plan did not already.
- `status == "failed"` → ticket `failed` with failures; scheduler retry policy applies; after the
  final attempt, post to `#incidents` and create an `eng.fix` ticket only if the failure list names
  specific failing tests (otherwise escalate to `eng.tech-lead` via `#dept-engineering`).

## Progress streaming

While the background interaction runs, poll every 5 s; each poll writes a run log line
`"antigravity: status=<status> elapsed=<s>"`. If the API exposes intermediate steps (VERIFY), log
each step's summary (first 200 chars).

## Fallback

If smoke test **S6** fails, or Antigravity errors three times in a row, set
`kv['executor.override'] = 'local'`, emit `system.warning`, and route engineering tickets to
`LocalLoopExecutor` ([`../03-company-kernel/02-autonomous-engineering-loop.md`](../03-company-kernel/02-autonomous-engineering-loop.md)).
The dashboard's System strip shows "Engineering executor: local (Antigravity unavailable)".
