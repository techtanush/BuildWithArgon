# 02 — The Autonomous Engineering Loop

> **Hackathon context — Problem Statement 1 (Million Token Engineering).** This loop is our answer
> to "do something monumental with Argon's codebase understanding and 1M-token output, and measure
> improvement over a baseline." The baseline (one Argon call) vs loop comparison lives in
> [`../06-execution/04-evals.md`](../06-execution/04-evals.md); only claim what that eval measures.

This is the heart of the company and the main use of Argon's long-horizon engineering. Goal:
**a ticket goes from spec to a verified, reviewed, merge-ready change with zero human input, and
the only human action is approving the merge.**

```
spec (acceptance criteria AC-1..n)
  └─ eng.design (Kai, Argon high, whole-repo context)
        └─ tasks T1..Tk  ─►  eng.build[Ti] (Zara: Antigravity sandbox OR local long-decode loop)
                                 └─ verify: npm test + npm run build  ─ fail ─► repair (≤ 6 iters)
                                 └─ pass ─► PR (Composio)  ─►  eng.review[Ti] (Mina, Argon medium)
                                                              └─ changes requested ─► eng.fix
                                                         ─►  qa.verify[Ti] (Ben: independent
                                                              acceptance tests from the spec)
                                                              ├─ fail ─► eng.fix (failures attached)
                                                              └─ pass ─► GATE merge (human) ─► merge
```

## 1. Product template

Every venture's product starts from `kernel/foundry_kernel/executors/templates/vite-react-ts/`:

```
package.json          scripts: dev, build ("tsc -b && vite build"), test ("vitest run"), preview
tsconfig.json         strict: true
vite.config.ts        base: "./"  (so /preview/<vid>/<tid>/ works)
vitest.config.ts      environment: "jsdom"
index.html
src/main.tsx
src/App.tsx           placeholder page with the venture name
src/lib/.gitkeep
tests/smoke.test.ts   renders App without crashing
README.md
```

Allowed dependencies (pre-installed once into `data/template-cache/node_modules` during setup):
`react`, `react-dom`, `typescript`, `vite`, `@vitejs/plugin-react`, `vitest`, `jsdom`,
`@testing-library/react`, `@testing-library/user-event`, `zod`, `date-fns`, `clsx`. Builders MUST
NOT add other dependencies in local mode (the prompt says so; the verifier rejects a
`package.json` whose dependencies are not a subset). In Antigravity mode the sandbox has network
access to npm, so the allowlist is advisory (logged if violated).

Setup command (T+5, run once): `uv run python -m foundry_kernel.executors.workspace prepare-cache`
→ copies the template to `data/template-cache/`, runs `npm install`, records versions.

## 2. `eng.design` (Kai — Argon, `thinking_level=high`)

**Input (one request, whole-context):**
- Venture idea, brief artifact, spec artifact (with AC ids), decision artifact.
- If the product exists: the **entire current codebase** as FILE blocks (all text files except
  `node_modules`, `dist`, lockfiles), plus the list of open/done engineering tickets with results.
  Argon's 1M window means this is normally the whole repo; if the estimated tokens
  (`chars / 3.5`) exceed 700k, include full contents only for `src/` and `tests/` and a tree listing
  for the rest (log that this happened).

**Output (JSON, validated):**

```json
{
  "architecture_md": "## Overview ... (modules, data flow, key decisions)",
  "tasks": [
    {"key": "T1", "title": "Pantry data model and storage", "body": "...",
     "acceptance_refs": ["AC-1","AC-2"], "files_hint": ["src/lib/pantry.ts","tests/pantry.test.ts"],
     "depends_on": []},
    {"key": "T2", "title": "Search UI", "body": "...", "acceptance_refs": ["AC-3"],
     "files_hint": ["src/components/Search.tsx"], "depends_on": ["T1"]}
  ],
  "risks": ["..."]
}
```

Rules: 1–5 tasks; every AC id appears in at least one task; tasks are vertical slices (each
leaves the app working). The kernel creates for each task: `eng.build` (ref `build:Tk`),
`eng.review` (depends on build), `qa.verify` (depends on review). Task `depends_on` maps to
dependencies between `eng.build` tickets. Architecture is stored as artifact `plan`.

## 3. `eng.build` — the executor interface

```python
class ExecutorInput(BaseModel):
    venture_id: str; ticket_id: str; run_id: str
    title: str; body: str
    acceptance_criteria: list[dict]       # [{"id":"AC-1","text":"..."}] relevant to this task
    architecture_md: str
    repo_full_name: str | None            # None => local mode
    base_branch: str = "main"
    max_iterations: int                   # MAX_BUILD_ITERATIONS (6)
    mode: Literal["build", "fix"]
    fix_context: str | None = None        # failures / review comments for eng.fix

class ExecutorResult(BaseModel):
    status: Literal["passed", "failed"]
    iterations: int
    first_pass_passed: bool               # did iteration 1 pass verification? (metric)
    branch: str | None; commit: str | None
    tests_passed: int; tests_failed: int; build_ok: bool
    files_changed: list[str]
    summary: str
    failures: list[str]
    workspace_path: str | None            # local mode
    preview_path: str | None              # local mode: data/workspaces/<vid>/<tid>/dist
    tokens_in: int; tokens_out: int; cost_usd: float; wall_seconds: float

class Executor(Protocol):
    async def run(self, inp: ExecutorInput, log: LogFn) -> ExecutorResult: ...
```

`get_executor()` returns `AntigravityExecutor` when `ENGINEERING_EXECUTOR=antigravity` and
`kv['executor.override']` is not `local`; else `LocalLoopExecutor`.

### 3a. AntigravityExecutor
Specified in [`../02-models-and-integrations/03-antigravity-managed-agents.md`](../02-models-and-integrations/03-antigravity-managed-agents.md).
Requires a GitHub repo; if `repo_full_name` is None it falls back to local for that ticket.
`first_pass_passed = (result.iterations == 1 and status == "passed")`.

### 3b. LocalLoopExecutor (fully specified here)

**Step 1 — workspace.** `ws = data/workspaces/<vid>/<tid>/`.
- If `data/products/<vid>/main/` exists → copy it; else copy the template.
- Symlink `ws/node_modules → data/template-cache/node_modules`.
- `git init`, commit "base" (used to compute `files_changed` with `git diff --name-only`).

**Step 2 — context.** Build `CODE_CONTEXT`: every text file in `ws` except `node_modules`,
`dist`, `.git`, lockfiles, as FILE blocks (format below), sorted by path.

**Step 3 — build call (iteration 1).** `LLMClient.generate("engineering_build", prompt,
system=BUILDER_SYSTEM)` with **long decode** (`background=True`, `max_output_tokens=262144`,
`thinking_level="high"`). Prompt:

```text
### SYSTEM  (BUILDER_SYSTEM)
You are Zara, Builder at Foundry. You implement a ticket completely in ONE response.
Output format — MANDATORY:
- For every file you create or change, output the COMPLETE new file content:
<<<FILE path="relative/path.ext">>>
...entire file content...
<<<END FILE>>>
- To delete a file: <<<DELETE path="relative/path.ext">>>
- Do not output unchanged files. Do not use diffs. Do not abbreviate with "...".
- After all files, output one line: FOUNDRY_NOTES {"summary":"...","tests_added":[...],"assumptions":[...]}
Engineering rules:
- TypeScript strict. React function components. No new dependencies beyond: {allowlist}.
- Write vitest tests in tests/ that check every acceptance criterion listed below. Tests must be
  deterministic (no network, no real timers unless faked).
- `npm test` and `npm run build` must both pass.
- Keep the app working end to end; keep existing tests passing.

### TASK
TICKET {ticket_id}: {title}
{body}
ACCEPTANCE CRITERIA:
{AC list}
ARCHITECTURE:
{architecture_md}
CURRENT CODEBASE ({n_files} files):
{CODE_CONTEXT}
```

**Step 4 — apply.** `fileblocks.parse(text)` → list of `(path, content | DELETE)`. Reject paths
that are absolute, contain `..`, start with `.git/` or `node_modules/`, or match `.env*`/`*.pem`/
`*.key`. Reject `package.json` changes that add dependencies outside the allowlist (strip them and
log a warning). Write files.

**Step 5 — verify.** In `ws`:
1. `npm test -- --reporter=json --outputFile=.foundry/vitest.json` (timeout 180 s)
2. `npm run build` (timeout 180 s)
Parse vitest JSON: `numPassedTests`, `numFailedTests`, and for each failed assertion
`fullName` + first 1,500 chars of `failureMessages`. Build failure: last 4,000 chars of output.
Record per-iteration results in run logs and `result.iterations_detail`.

**Step 6 — no-weakening rule.** Keep `known_tests` = set of test `fullName`s seen passing or failing
so far. If a later iteration's test set is missing any name in `known_tests` **and** no new test
covers the same file, the iteration is rejected without counting as a pass: the repair prompt says
"You removed tests: […]. Restore them; never delete or weaken tests." Also reject any edit that
replaces an `expect(...)` assertion in an existing test file with nothing (diff check: count of
`expect(` per existing test file must not decrease).

**Step 7 — repair loop.** If verify fails and `iteration < max_iterations`: call
`engineering_fix` with `previous_interaction_id = <last interaction id>` (server-side state keeps
the full context; implicit caching makes it cheap) and prompt:

```text
Verification failed (iteration {i}/{max}).
TEST FAILURES:
{failures}
BUILD OUTPUT (tail):
{build_tail}
Fix the root cause. Output ONLY the files you change, in the same FILE block format, then a
FOUNDRY_NOTES line. Never delete or weaken tests.
```

If `previous_interaction_id` is not supported (VERIFY V7), resend the full Step 3 prompt with the
current files + the failure section.

**Step 8 — finish.**
- Pass → `npm run build` output in `ws/dist` → preview at `/preview/<vid>/<tid>/`; artifacts:
  `code` (summary + files_changed + diff stats), `test_report` (counts + iteration history),
  `preview` (URL). If GitHub is active, publish branch + PR (see Composio doc) → artifact `pr`.
- Fail after max iterations → `ExecutorResult(status="failed")`; ticket follows retry policy.

### File block format (`fileblocks.py`)

```
<<<FILE path="src/lib/pantry.ts">>>
export function ...
<<<END FILE>>>
<<<DELETE path="src/old.ts">>>
```

Parser regex (multiline, dotall): `<<<FILE path="([^"]+)">>>\n(.*?)\n<<<END FILE>>>` and
`<<<DELETE path="([^"]+)">>>`. A missing `<<<END FILE>>>` at the end (truncated output) → that
block is dropped and the run is marked `truncated` (retry with a request to continue). Unit tests:
parse multiple files, content containing `<<<` inside strings, delete markers, truncated tail.

## 4. `eng.review` (Mina — Argon medium)

Input: PR diff (from local `git diff base` or Composio PR files), spec ACs, architecture. Output:

```json
{"verdict":"approve"|"changes_requested","comments":[{"file":"..","line":12,"severity":"high|medium|low","comment":".."}],"security_notes":["..."],"summary":".."}
```

`changes_requested` with any `high` comment → create `eng.fix` (payload: comments) and the
`qa.verify` waits for it (dependency added). Otherwise artifact `doc` (review) and continue.

## 5. `qa.verify` (Ben — independent verification)

1. Ben writes **independent acceptance tests** from the spec ACs only — prompt includes the ACs and
   the public API surface (exported names/signatures extracted from the code), not the builder's
   tests. Output: `tests/acceptance/<ticket_id_short>.test.ts` as a FILE block.
2. Run the full suite (`npm test`, `npm run build`) in the workspace (local) or in an Antigravity
   sandbox on the PR branch (antigravity mode).
3. Pass → artifact `test_report` and **gate `merge`** (payload below). Fail → `eng.fix` with the
   failing acceptance tests (the acceptance test file is committed to the branch so the builder
   sees it; it is now part of the suite and protected by the no-weakening rule).

Merge gate payload:

```json
{"pr_number": 7, "pr_url": "https://github.com/...", "local": false,
 "tests": {"passed": 42, "failed": 0}, "build_ok": true,
 "acceptance": [{"id":"AC-1","status":"pass"}, ...],
 "review": {"verdict":"approve","high":0,"medium":1},
 "preview_url": "/preview/ven_../tkt_../", "iterations": 2, "first_pass_passed": false,
 "summary": "..."}
```

## 6. Merge

On approval: `composio.merge_pull_request(..., merge_method="squash")` (gated function) or, in
local mode, copy `ws` (without node_modules/.git/.foundry) to `data/products/<vid>/main/`. Artifact
`build` (kind `build`, uri = repo URL or preview URL). Message to `#all-hands`:
"Shipped T2 'Search UI' — 42/42 tests, reviewed by Mina, verified by Ben. Approved by <founder>."

## 7. Metrics (written to `tickets.result_json` and aggregated by `/v1/ventures/{vid}/metrics`)

Per build ticket: `iterations`, `first_pass_passed`, `final_passed`, `tests_passed`,
`tests_failed`, `tokens_in`, `tokens_out`, `cost_usd`, `wall_seconds`, `executor`.
Aggregates: first-run pass rate, final pass rate, mean iterations, total cost.

## 8. What makes this Argon-specific (state it in the UI's Run detail)

- Whole-codebase context in one request (design and build).
- Whole-feature output in one long-decode response (Step 3), not chunked.
- Server-side continuation (`previous_interaction_id`) for repairs.
- High-thinking design and review; Flash never writes production code.
