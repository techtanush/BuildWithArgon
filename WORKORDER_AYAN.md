# WORK ORDER — Ayan (branch `ayan`)

**Lane B: models, the autonomous engineering loop, integrations, cloud computers, and world
generation.** You make Argon do the heavy lifting: the Gemini/Interactions client every
agent uses, the engineering loop that writes, tests, reviews and ships code (Problem Statement 1),
Antigravity managed agents and Cua computers (Managed Agents prize), Composio/GitHub, and the
one-pass + render → critique → fix world generation (Problem Statement 2). Voice (TTS/STT,
`/v1/voice/*`) moved to Karthik.

---

## 0. Read first — on `main`, before writing any code

Read these in order (they are on every branch, under `architecture-files/`):

1. `architecture-files/README.md` — the whole thing, including "Why we're building this".
2. `00-overview/*` (vision, hackathon context, glossary, ADRs, feature catalog).
3. `01-architecture/*` (system overview, repo layout, data model, API contract, orchestration, security).
4. `06-execution/07-team-split.md` — who owns what, the frozen contracts, the cross-branch
   interfaces and the merge plan. **This work order is the Ayan column of that document.**
5. `06-execution/06-agent-operating-rules.md`, `02-acceptance-criteria.md`, `03-testing-strategy.md`,
   `04-evals.md`, `05-risk-register-and-fallbacks.md`.
6. Your sections: **`02-models-and-integrations/`** 01–04 and 07–11 (05/06 are Karthik's), `03-company-kernel/02-autonomous-engineering-loop.md`,
   `03-support-and-pr-loop.md`, `05-approval-gates.md` (merge/integration/computer_action),
   `departments/07-engineering.md`, `departments/12-support.md`, `05-world/05-characters-and-faces.md`
   (FaceSpec generation), `05-world/04-buildings.md`, `05-world/09-worldgen-pipeline.md`,
   `05-world/10-render-critique-loop.md`, `templates/DESIGN.md`, `templates/eval-briefs/*`.
7. `argon-app/AGENTS.md` and every seed file you own (they start with `# OWNER: ayan` / `// OWNER: ayan`).

The spec is the contract. If this work order and the spec ever disagree, follow the spec and log it
in `argon-app/docs/decisions/ayan.md`.

## 1. Setup

```bash
git fetch origin && git checkout ayan
cd argon-app && cp .env.example .env     # add GEMINI_API_KEY (+ COMPOSIO_API_KEY if you have it)
cd kernel && uv sync --extra dev && uv run pytest -q     # 11 passed
cd ../web && pnpm install && pnpm typecheck && pnpm test  # 5 passed
cd ../kernel && uv run python -m foundry_kernel.llm.smoke basic   # S1 against the live API
```

Install the official Gemini API skills for your coding agent first
(`02-models-and-integrations/02-gemini-interactions-api.md` Step 0).

## 2. What you own (edit only these)

**Kernel** (`argon-app/kernel/foundry_kernel/`): `models.py`, `llm/*` (client, fake, jsonout,
costs, smoke), `departments/engineering.py`, `departments/qa.py` (create; helper used by
`EngineeringHandler` for `qa.verify`), `departments/support.py`, `departments/prompts/eng.*.md` and
`su.*.md`, `executors/*` (incl. `templates/vite-react-ts/`), `integrations/*` (composio,
github_watch, slack_mirror, marketing), `computers/*`,
`worldgen/*`, `api/integrations.py`, `api/computers.py`, `api/preview.py`,
`evals/engineering_eval.py`; migrations `0100`–`0199` named `NNNN_ayan_<what>.sql`.

**Kernel tests:** `kernel/tests/ayan/**` (add an empty `__init__.py`), `test_fileblocks.py`,
`test_computer_guard.py`, `test_worldgen_*.py`, `test_engineering*.py`, `test_executor*.py`,
`test_llm*.py`, `test_composio*.py`, `test_support*.py`. FakeLLM fixtures
`kernel/tests/fixtures/fake_llm/<job>.json` for `engineering_*`, `qa_analyze`, `eval_baseline`,
`triage`, `worldgen_*`, `face_spec`, `portrait`, `texture`,
`music_loop`, `computer_*`.

**Generated data you write and commit:** `kernel/data/faces.json`,
`kernel/data/worldgen/runs/**`, `web/public/generated/{portraits,textures,signs}/*`,
`web/src/world/buildings/generated/*` (modules, `index.ts`, `registry.json`),
`web/src/world/buildings/staging/` (scratch, gitignored), `evals/results/engineering-*.json`.

**Web script:** `web/scripts/capture.ts`.

**Docs:** `docs/{build-logs,decisions,verified,contract-requests}/ayan.md`.

## 3. Never touch

Frozen: `schema.sql`, `contracts.py`, `config.py`, `ids.py`, `errors.py`, `security.py`,
`world_layout.py`, `api/__init__.py`, `evals/cli.py`, `tests/conftest.py`, `tests/fakes.py`,
`tests/test_seed_contracts.py`, `kernel/data/roster.json`, `web/src/world/kit/types.ts`,
`npc/FaceSpec.ts`, `probes/types.ts`, `buildings/example/*`, `src/shared/contracts.ts`, `Makefile`,
`AGENTS.md`, `docs/*.md`, `architecture-files/**`.
Tanush's: the rest of the kernel (`app.py`, `db.py`, `scheduler.py`, `departments/__init__.py`
REGISTRY, other handlers, `conversation/*`, other routers) and the dashboard.
Mahin's: `web/src/world/**` (except generated/staging) and `src/shared/worldApi.ts`.
Karthik's: `voice/*`, `api/voice.py`, `evals/grounding_eval.py`, `kernel/data/voices.json`, the web
voice modules (`npc/visemes.ts`, `npc/LipSync.ts`, `conversation/{Mic,Stt,Speech}.ts`).
Need a change there? → `docs/contract-requests/ayan.md`. Check before every push:
`make ownership WHO=ayan`.

## 4. What you can rely on (from others — already in the seed)

| You need | Use | Seed behaviour |
|---|---|---|
| Handler context in your handlers | `contracts.HandlerContext` (`ctx.llm`, `ctx.settings`, `ctx.db`, `ctx.venture`, `ctx.agent`, `ctx.run_id`, `ctx.approval_result`, `log`, `context_for`, `ask_agent`, `request`, `post`, `use_computer`) | `tests/fakes.FakeHandlerContext` for unit tests; Tanush's scheduler implements it |
| Approvals | `gates.request_approval(tx, *, venture_id, gate_type, title, summary, payload=None, ticket_id=None, run_id=None, requested_by_agent_id=None)`, `gates.require_approved(db_or_tx, approval_id, gate_type)` | Working |
| Cost accounting | `ledger.record(tx, *, venture_id, kind, cost_usd, model=None, run_id=None, department_id=None, agent_id=None, units_in=0, units_out=0, estimated=True)` | Working |
| Events | `bus.emit(tx, *, venture_id, type, entity_kind, entity_id, data, level)` inside `async with db.tx() as tx` | Working (published after commit) |
| DB | `db.Database` (`tx()`, `fetch_one`, `fetch_all`), full schema incl. `computers`, `computer_tasks`, `computer_actions`, `worldgen_runs`, `worldgen_iterations`, `eval_results`, `integrations`, `github_seen`, `kv` (see `schema.sql`) | Working |
| Redaction | `security.redact(text)` on every LLM output, file block and Composio payload before storage | Working |
| Capture handshake | `web/src/world/probes/types.ts` (`window.__foundryProbe`, `ProbeResult`, `BuildingProbeReport`, cameras, which probes each mode computes) | Mahin's page; seed page answers `ready: true, error: "not implemented"` |
| Props library table for the prompt | `web/src/world/kit/props.contract.ts` (`PROP_FOOTPRINTS`, frozen) | Final — generate the prompt's PROPS LIBRARY table from it |
| Prompt example module | `web/src/world/buildings/example/house.example.ts` | Final (passes the probes by construction). After the merge, switch to the `house` archetype in Mahin's `fallback/archetypes.ts` if it exists |

## 5. What others rely on from you (keep these names and signatures)

- `llm.client.build_llm_client(settings, db=None)` → object satisfying `contracts.LLMClientProtocol`
  (`generate`, `generate_json`, `run_agent`, `generate_images`); returns `FakeLLM` when
  `LLM_MODE=fake`. **`FakeLLM` keeps its interface** (`script(job, outputs)`, fixture lookup by job
  name, generic schema-valid JSON when no fixture) — Tanush's tests depend on it.
- `models.JOBS` / `models.job(name)` — every job in `01-model-routing.md` stays defined.
- `EngineeringHandler` (types `eng.design`, `eng.build`, `eng.fix`, `eng.review`, `qa.verify`) and
  `SupportHandler` (`support.issue`) at the module paths in `departments.REGISTRY`. **Keep the
  `LLM_MODE=fake` branch exactly working** — Tanush's end-to-end test runs through it (design creates
  `eng.build` with `ref="build:T1"`, `eng.review` depends on `ref:build:T1`, `qa.verify` depends on
  `ref:review:T1`; `qa.verify` returns `waiting_approval` with a `merge` gate, then `done`).
- `computers.loop.run_task(*, settings, db, llm, venture_id, agent_id, ticket_id, goal, allowed_domains, start_url, max_steps=30) -> ComputerTaskResult`
  — **never raises** for unavailability; returns `status="skipped"` + reason.
- Gemini transcribe/TTS jobs (`transcribe`, `tts_fallback`) and audio `Part`s in the client — Karthik's
  `voice/stt.py` and TTS fallback call them through `build_llm_client`; report in
  `docs/verified/ayan.md` whether audio input works (smoke tests); Karthik decides `STT_PRIMARY`.
- `integrations.github_watch.start/stop(app)`, `computers.manager.start/stop(app)` — called from
  Tanush's lifespan; must not raise when keys are missing.
- HTTP shapes in `04-api-contract.md` for `/v1/ventures/{vid}/integrations*`,
  `/v1/ventures/{vid}/computers`, `/v1/computers/*`, `/v1/computer-tasks/*`, `/preview/*` (Tanush's
  dashboard and Mahin's world call them).
- Worldgen outputs at the exact paths in `05-world/09`: `generated/<dept>.ts` default-exporting a
  `BuildingModule`, `generated/registry.json`, and `generated/index.ts` keeping the seed's export
  shape exactly: `export const generatedModules: Partial<Record<string, BuildingModule>> = { engineering, ... };`
  (Mahin indexes it by department id).

## 6. Build steps (phases from `06-execution/01-12-hour-build-plan.md`)

Commit after each step with its tests green; append `T+hh:mm step — result` to
`docs/build-logs/ayan.md`; push the branch at every checkpoint.

### Step A — Smoke tests & the LLM client (Phase 1, then client hardening)
1. `llm/client.py` to the full spec in `02-gemini-interactions-api.md`: Interactions API calls,
   `thinking_level`, background long decode + polling (`LONG_DECODE_*`), `previous_interaction_id`,
   multimodal `Part`s, retries/backoff, usage → `costs.py` → `ledger.record` + run token columns,
   `redact()` outputs, `run_agent` for Antigravity (`03-antigravity-managed-agents.md`),
   `generate_images` for Nano Banana. Only `client.py` imports `google.genai`.
2. `llm/smoke.py` S1–S7 (`python -m foundry_kernel.llm.smoke all`); record every VERIFY result in
   `docs/verified/ayan.md`; decide `ENGINEERING_EXECUTOR` in `docs/decisions/ayan.md` (and note whether audio input works, for
   Karthik's `STT_PRIMARY`).
3. Probe Composio (`GET v3.1/auth_configs`); record the shape. (ElevenLabs is Karthik's.)
4. **Start background assets** as soon as S1/S2 pass: `worldgen/faces.py` (job `face_spec`,
   validation + seed fallback) → `kernel/data/faces.json`; `portraits` (Nano Banana) →
   `web/public/generated/portraits/<agent_id>.png`; `textures` + `signs` →
   `web/public/generated/{textures,signs}/` (`07-nano-banana-assets.md`). Commit the outputs.
**Checkpoint:** S1 and S2 PASS; `uv run pytest -q` green.

### Step B — Autonomous engineering loop (Phase 5) — `03-company-kernel/02-autonomous-engineering-loop.md`
1. `executors/templates/vite-react-ts/` scaffold; `workspace.py` (create from template, cached
   `node_modules` in `data/template-cache/`, run commands with limits).
2. `fileblocks.py` + `test_fileblocks.py` (rejects `..`, absolute paths, `.env`, blocked
   filenames/suffixes; E-02).
3. `local_loop.py` (`Executor`: write → build → test → repair until pass or `MAX_BUILD_ITERATIONS`,
   no-weakening rule; E-03 with scripted FakeLLM outputs).
4. `engineering.py` live mode: `eng.design` (1–5 tasks covering every AC id; E-01) → `eng.build` /
   `eng.fix` via the executor → `eng.review` → `qa.verify` (`qa.py`: independent acceptance tests,
   full suite; E-04) → `merge` gate → merge (E-05/E-06). Delegation/handoff posts via `ctx.post`.
   `qa.verify` also runs **visual QA** through `ctx.use_computer(...)` when available (Ben), else the
   Playwright headless check.
5. `antigravity.py` (`AntigravityExecutor` through `ctx.llm.run_agent`, Credentials API for the
   GitHub token; fallback to local recorded; E-07).
6. `integrations/composio.py` (connect, status, create repo, branch, put file, PR, merge, issues) +
   `api/integrations.py` (GitHub connect is itself gated: `integration` approval first) +
   `api/preview.py` (serve `data/workspaces/{vid}/{ticket}/dist/`).
**Checkpoint:** `uv run foundry-eval engineering --brief split-bill --condition loop` passes the
hidden tests; a live venture produces a PR (or a local build in no-GitHub mode) + pending merge gate.
(For a full venture run on your branch, temporarily run Tanush's branch in a worktree, or test the
handler directly with `FakeHandlerContext` + a live `LLMClient`.)

### Step C — World generation (kernel/script side of Phase 8) — `05-world/09`, `05-world/10`
1. `worldgen/cli.py` subcommands: `faces`, `portraits`, `textures`, `buildings`, `loop --max-iter N`,
   `all`/`--all`, `report`; every run under `kernel/data/worldgen/runs/<run_id>/` + DB rows.
2. `kit_contract.md` (copy of `web/src/world/kit/types.ts`), `assets.py` (reference webp → png),
   `generate.py` (one long-decode pass for all 13 buildings, FILE blocks, per-building fallback
   generation when truncated; G-01), `validate.py` (static rules + `pnpm typecheck:worldgen` on the
   staging dir; G-05), `capture.py` (runs `pnpm capture`), `critique.py` (`worldgen_critic`),
   patch (`worldgen_patch`, `previous_interaction_id`), `score.py` (keep best per building; write
   `generated/<dept>.ts`, `generated/index.ts`, `generated/registry.json`, `scores.json`).
3. `web/scripts/capture.ts`: Playwright Chromium with the swiftshader flags; per building × mode open
   `/view/capture?...`, wait for `__foundryProbe.ready`, screenshots per camera, P9 from the PNGs,
   merge both modes into a `BuildingProbeReport` (types in `probes/types.ts`); non-zero exit only
   on infrastructure failure.
4. Run `uv run foundry-worldgen buildings` (one pass) on your branch and commit the run + staged
   modules that pass static validation and tsc. The render loop needs Mahin's capture page: test it
   against Mahin's branch in a worktree (`git worktree add ../mahin-wt origin/mahin`, `pnpm install`
   + `pnpm dev --port 5199` there, then `pnpm capture --url http://localhost:5199 ...`). If Mahin's page
   isn't ready yet, leave the loop for the merge session — it is step 6 of the merge checklist.
5. Tests: `test_worldgen_validate.py` (forbidden tokens, imports, id/export checks), score selection.

### Step D — Support loop, computers, eval (Phase 9)
1. `departments/support.py` (triage with `triage` job; bug → `eng.fix`; question → answer) +
   `integrations/github_watch.py` (poll issues/PR comments → `support.issue`; E-08). Yuki's bug repro
   uses `ctx.use_computer` when available.
2. Cua (`10-cua-cloud-computers.md`): `cua_client.py` (only module importing `cua`; SDK methods or
   xdotool fallback; VERIFY and record), `manager.py`, `loop.py` (Flash `computer_step`, Argon
   `computer_plan` every 6 steps), `guard.py` (+ `test_computer_guard.py`: allowlist block,
   login/contact gate → `computer_action` approval; CU-03), `evidence.py`; `api/computers.py`
   endpoints. `CUA_MODE=off` → `run_task` returns `skipped` (CU-05).
3. `evals/engineering_eval.py`: 5 briefs × {baseline, loop} with hidden tests → `eval_results` rows +
   `evals/results/engineering-<timestamp>.json` (V-01). Run in the background.
4. Optional (MAY): `integrations/slack_mirror.py`.

## 7. Definition of done

- Acceptance: **E-01…E-08, CU-01…CU-05, G-01…G-03, G-05, V-01**
  (`06-execution/02-acceptance-criteria.md`). G-02/G-03 may be completed in the merge session.
- `cd kernel && uv run pytest -q` green (seed tests included); `cd web && pnpm typecheck && pnpm test` green.
- Fake-mode engineering path unchanged (Tanush's E2E depends on it).
- `make ownership WHO=ayan` clean. Branch pushed.
- `docs/build-logs/ayan.md` ends with a **Handoff** section: smoke results, chosen executor, audio-input support, what
  ran live, generated assets committed (faces/portraits/textures/signs/first-pass modules), whether
  the worldgen loop ran, open issues, contract requests, and the exact env values to set at merge.

## 8. One-shot prompt for your coding agent

> You are building lane B (Ayan) of Foundry × Argon on branch `ayan` of this repo. First read
> `architecture-files/README.md`, `architecture-files/00-overview/*`, `architecture-files/01-architecture/*`,
> `architecture-files/06-execution/07-team-split.md`, all of `architecture-files/02-models-and-integrations/`,
> and `WORKORDER_AYAN.md`, then `argon-app/AGENTS.md`. Install the Gemini API skills. Follow
> `WORKORDER_AYAN.md` step by step (A → D). Edit only files owned by ayan (check with
> `make ownership WHO=ayan`); never edit frozen contracts — write requests in
> `argon-app/docs/contract-requests/ayan.md`. Keep the fake-mode engineering path and both seed
> test suites green. After each step: run its tests, append to `argon-app/docs/build-logs/ayan.md`,
> commit, and push `ayan`.
