# 07 — Team Split: three people, three branches, one merge

> **Hackathon context.** Three builders — **Tanush**, **Ayan** and **Mahin** — each with a coding
> agent, build the whole product in parallel through the night and merge once. Every branch runs and
> tests on its own; the merge is a union of disjoint files plus API keys.

This document is the contract between the three branches. Each branch has a work order at its
root (`WORKORDER_TANUSH.md`, `WORKORDER_AYAN.md`, `WORKORDER_MAHIN.md`) that turns this split into
step-by-step instructions. **Read the spec first** (`architecture-files/README.md`, `00-overview/`,
`01-architecture/`), then this document, then your work order.

## How it works

1. **A frozen-contract seed on `main`** (`argon-app/`). Every module in the repo layout already
   exists with its final public interface. The shared contracts (database schema, API objects,
   handler/executor/LLM protocols, the kit API, FaceSpec, the world manifest, the capture-page
   handshake) are final. Stubs are safe no-ops, so the kernel boots, the web builds, and both test
   suites pass on day zero (`make test`).
2. **Disjoint ownership.** Every file has exactly one owner — `tanush`, `ayan`, `mahin` or `frozen`
   — declared in its first line (`OWNER: …`) and enforced by `argon-app/scripts/check_ownership.py`
   (`make ownership WHO=<you>`). Nobody edits a file they don't own, so the merge has no conflicts.
3. **Fakes and mocks remove waiting.** `LLM_MODE=fake` + `FakeLLM` + the fake-mode engineering
   handler let Tanush run the full company DAG without Ayan's live loop; `FakeHandlerContext` lets
   Ayan test handlers without Tanush's scheduler; `/view?mock=1` fixtures let Mahin build the whole
   world and conversation UI without any kernel; the capture handshake types let Ayan and Mahin
   build both ends of the worldgen loop separately.
4. **One merge session** at the end: merge the three branches into `main`, apply contract
   requests, add `.env` keys, regenerate API types and lockfiles, run worldgen and evals, and walk
   the acceptance checklist.

## Who owns what

| | **Tanush** — kernel core, company & dashboard | **Ayan** — models, engineering, integrations & worldgen | **Mahin** — the 3D world |
|---|---|---|---|
| Spec | `01-architecture/*`, `03-company-kernel/*` (except 02, 03), `04-dashboard/*`, `05-world/07`+`08` kernel side, `06-execution/04` grounding | `02-models-and-integrations/*`, `03-company-kernel/02`+`03`, `05-world/05` faces/portraits, `05-world/09`+`10` kernel/script side, `06-execution/04` engineering | `05-world/00`–`11` (web side), `templates/DESIGN.md` |
| Kernel | `app.py`, `db.py`, `bus.py`, `gates.py`, `ledger.py`, `seed.py`, `scheduler.py`, `orchestrator.py`, `departments/*` (all except engineering/qa/support), `departments/prompts/*` (all except `eng.*`, `su.*`), `conversation/*`, `api/` system, ventures, departments, agents, tickets, runs, artifacts, approvals, channels, activity, stream, conversation, world, metrics, org; `evals/grounding_eval.py`; any new top-level kernel module | `models.py`, `llm/*` (client, fake, jsonout, costs, smoke), `departments/engineering.py`, `qa.py`, `support.py`, prompts `eng.*`/`su.*`, `executors/*`, `integrations/*`, `computers/*`, `voice/*`, `worldgen/*`, `api/` voice, integrations, computers, preview; `evals/engineering_eval.py`; `kernel/data/faces.json`, `voices.json`, `worldgen/` | — |
| Web | `src/dashboard/**`, `src/api/**`, `src/styles/app.css`, `tests/unit/dashboard/**`, `tests/e2e/dashboard.spec.ts` | `scripts/capture.ts`, `src/world/buildings/generated/**` and `staging/` (written by worldgen), `public/generated/**` (portraits, textures, signs) | `src/world/**` (except the frozen and generated paths), `src/shared/worldApi.ts`, `tests/unit/world/**`, `tests/e2e/world.spec.ts` |
| Tests | `kernel/tests/**` except Ayan's | `kernel/tests/ayan/**`, `test_fileblocks.py`, `test_computer_guard.py`, `test_worldgen_*.py`, `test_engineering*.py`, `test_executor*.py`, `test_voice*.py`, `test_llm*.py`, `test_composio*.py`, `test_support*.py` | `web/tests/unit/world/**`, `web/tests/e2e/world.spec.ts` |
| FakeLLM fixtures (`kernel/tests/fixtures/fake_llm/<job>.json`) | every job not listed for Ayan | `engineering_*`, `qa_analyze`, `eval_baseline`, `triage`, `transcribe`, `tts_fallback`, `worldgen_*`, `face_spec`, `portrait`, `texture`, `music_loop`, `computer_*` | — |
| Migrations | `0001`–`0099` | `0100`–`0199` | (`0200`–`0299`, unlikely) |
| Results | `evals/results/grounding-*` | `evals/results/engineering-*`, `kernel/data/worldgen/runs/**` | — |
| Docs | `docs/{build-logs,decisions,verified,contract-requests}/tanush.md` | `…/ayan.md` | `…/mahin.md` |
| Acceptance | K-01…K-11, CO-01…CO-06, D-01…D-05, C-05…C-07 (kernel side), V-02, V-03, E-09 | E-01…E-08, CU-01…CU-05, C-08 (kernel side), G-01…G-03, G-05, V-01 | W-01…W-11, C-01…C-04, C-08/C-09 (client side), CO-07, G-04 |

### Frozen (nobody edits on a branch)

| File | What it freezes |
|---|---|
| `kernel/foundry_kernel/schema.sql` | Full DDL from `01-architecture/03-data-model.md` (extend only with migrations) |
| `kernel/foundry_kernel/contracts.py` | `LLMClientProtocol`, `LLMResult`, `Part`, `HandlerContext`, `Handler`, `HandlerResult` and `New*` records, `Executor`/`ExecutorInput`/`ExecutorResult`, conversation, voice, manifest, FaceSpec, standup and computer models |
| `config.py`, `ids.py`, `errors.py`, `security.py` (`redact()`), `world_layout.py` | Settings for every env var; ULIDs; error types; redaction; the deterministic city layout + manifest builder |
| `api/__init__.py`, `evals/cli.py` | Router list (every router file exists); eval dispatcher |
| `kernel/tests/conftest.py`, `fakes.py`, `test_seed_contracts.py` | Shared fixtures, `FakeHandlerContext`, the seed's safety-net tests |
| `kernel/data/roster.json` | 13 departments, 29 agents |
| `web/src/App.tsx`, `main.tsx` | Routing: `/view` → world, `/view/capture` → capture page, `/*` → dashboard |
| `web/src/shared/contracts.ts` | TypeScript mirror of every API object, the manifest and SSE events |
| `web/src/world/kit/types.ts` | The kit API given to Argon (verbatim from `05-world/09`) |
| `web/src/world/npc/FaceSpec.ts` | FaceSpec + enums |
| `web/src/world/probes/types.ts` | Capture handshake: `window.__foundryProbe`, `ProbeResult`, `BuildingProbeReport`, cameras |
| `web/src/world/buildings/example/house.example.ts` | Reference module (prompt example; kit smoke test) |
| `web/src/world/data/manifest.fallback.json` | Generated from `world_layout.py` (`make manifest`) |
| `web/src/styles/tokens.css`, `vite.config.ts`, `tsconfig*.json`, `playwright.config.ts`, `index.html` | Build and design tokens |
| `Makefile`, `.gitignore`, `.env.example`, `AGENTS.md`, `README.md`, `docs/*.md`, `evals/briefs/*`, `evals/grounding/*`, `scripts/*`, `architecture-files/**` | Project scaffolding and the spec |

**Shared dependency files** (`kernel/pyproject.toml`, `uv.lock`, `web/package.json`,
`pnpm-lock.yaml`): all expected dependencies are already listed. If you must add one, add a single
line, log it in your build log; the merge takes the union and regenerates the lockfiles.

**Need a frozen file changed?** Write the exact change in `docs/contract-requests/<you>.md`, work
around it inside your own files (an adapter), and keep going. The merge session applies it.

## Cross-branch interfaces (call these; never edit them)

| Interface | Provided by | Used by | Seed behaviour (until the owner's branch lands) |
|---|---|---|---|
| `ctx.llm` = `build_llm_client(settings, db)` → `LLMClient` / `FakeLLM` (`generate`, `generate_json`, `run_agent`, `generate_images`) | Ayan | Tanush's handlers, conversation, orchestrator | Minimal working live client; `FakeLLM` returns fixtures/generic JSON |
| `models.JOBS` / `models.job(name)` | Ayan | everyone calling the LLM | All jobs from `02-models-and-integrations/01-model-routing.md` |
| `HandlerContext` (`log`, `context_for`, `ask_agent`, `request`, `post`, `use_computer`, `approval_result`) | Tanush (scheduler + `departments/coordination.py`) | Ayan's engineering/support handlers | `tests/fakes.FakeHandlerContext` |
| `departments.REGISTRY` entries `eng.design`, `eng.build`, `eng.fix`, `eng.review`, `qa.verify` → `engineering:EngineeringHandler`; `support.issue` → `support:SupportHandler` | Tanush (file), Ayan (classes) | scheduler | Fake-mode engineering DAG: design → build → review → verify → merge gate |
| `computers.loop.run_task(...) -> ComputerTaskResult` (never raises; `status="skipped"` when unavailable) | Ayan | Tanush's `ctx.use_computer` | Always `skipped` |
| `voice.tts.synthesize(settings=, db=, agent_id=, text=) -> TtsResponse`; `voice.stt.transcribe(...) -> SttResponse` | Ayan | Tanush (`/standups/latest` audio), Mahin (via HTTP) | `provider="browser"` / `"none"` |
| `integrations.github_watch.start/stop`, `computers.manager.start/stop` | Ayan | Tanush's `app.py` lifespan | No-ops |
| `gates.request_approval`, `gates.require_approved`, `ledger.record`, `ledger.over_budget`, `bus.emit`, `db.tx()` | Tanush | Ayan (merge/integration/computer gates, LLM cost accounting) | Working |
| `security.redact()` | frozen | both kernel owners | Working |
| HTTP API (`01-architecture/04-api-contract.md`) | Tanush (+ Ayan's voice/integrations/computers/preview routers) | Mahin via `shared/worldApi.ts`; Tanush's dashboard | Empty routers → Mahin uses `?mock=1` |
| `window.__foundryProbe` / `ProbeResult` / `BuildingProbeReport` | Mahin (page + probes) | Ayan (`scripts/capture.ts`, `worldgen/capture.py`) | Page reports `error: "not implemented"` |
| `web/src/world/buildings/generated/{index.ts,registry.json}` | Ayan (worldgen writes them) | Mahin's `buildings/index.ts` (generated ?? fallback) | Empty → all fallbacks |
| `/generated/portraits/<agent_id>.png`, `/generated/signs/<dept>.png`, `/generated/textures/<name>.png`, `kernel/data/faces.json` | Ayan | Mahin (characters, signs, textures), Tanush (portraits in the dashboard; `face` in the manifest) | Missing → seed-based faces, procedural textures, initials avatars, canvas-drawn signs |
| `GET /v1/world/manifest` built with `world_layout.build_manifest(...)` | Tanush (route), frozen (math) | Mahin | `manifest.fallback.json` |
| `/view?venture=<vid>&goto=<agent_id>` | Mahin | Tanush's dashboard ("Enter the view", "Find in the world") | Placeholder page |

## Timeline (all three in parallel)

| Time | Tanush | Ayan | Mahin |
|---|---|---|---|
| 0:00–0:30 | Read spec + work order; `make test` green | Same; `.env` with own keys | Same |
| 0:30–2:30 | Phase 2: DB, seed, API routes, SSE, gates, ledger, chat | Phase 1: smoke S1–S7, VERIFIED shapes; full `llm/client.py`; Composio/ElevenLabs probes; **start faces → portraits → textures** | Phase 6a: look kit (materials, primitives recording, colliders, props), house example renders |
| 2:30–5:00 | Phase 3: scheduler, 11 non-eng handlers, orchestrator plan, coordination, standups; fake venture E2E | Phase 5: template + cache, fileblocks, LocalLoop, engineering handler (live), review, QA, Composio PRs, merge, Antigravity | Phase 6b: 13 fallback buildings, city, plaza, engine, player, car, interiors, nav/A*, HUD shell, map. **Hand kit to Ayan's worldgen by pushing early** |
| 5:00–8:00 | Phase 4: dashboard (all pages, SSE, onboarding, Computers, Metrics) | Phase 8 kernel side: one-pass `worldgen buildings`, validate, critique, patch, score, `capture.ts` | Phase 7 web: characters (FaceSpec + seed fallback), lip-sync, conversation controller (mic/STT/TTS), panel, source + route cards, race, fast travel, concierge greet, `?goto=` |
| 8:00–10:30 | Phase 7 kernel: context pack, talk, concierge, directory, checker; manifest route; standups latest | Voice: TTS + cache + fallbacks, STT; support loop + github_watch; Cua computers (client, manager, loop, guard) | Phase 8 web: capture page, probes P1–P8/P10, `validateModule.ts`; perf + quality tiers |
| 10:30–12:00 | Grounding eval, improvement loop, metrics endpoints; hardening | Engineering eval (5 × 2), worldgen loop against Mahin's branch in a worktree (optional); hardening | Town Hall standup playback, offline mode, W-01…W-11 checks; hardening |
| Merge | Merge session (below) — whoever runs it uses this checklist |

## The merge session

Run by one person with a coding agent on `main`, after all three branches are pushed and green.

1. **Pre-flight on each branch:** `make test` green and `make ownership WHO=<name>` clean
   (union-file notes are fine).
2. **Merge** (order: `tanush` → `ayan` → `mahin`):
   ```bash
   git checkout main && git pull
   git merge --no-ff origin/tanush -m "merge: tanush"
   git merge --no-ff origin/ayan   -m "merge: ayan"
   git merge --no-ff origin/mahin  -m "merge: mahin"
   ```
   Only the shared dependency files can conflict: keep every added line, then regenerate
   `cd argon-app/kernel && uv lock && uv sync --extra dev` and `cd argon-app/web && pnpm install`.
3. **Apply contract requests** from `docs/contract-requests/*.md` (edit the frozen files, remove
   the matching workarounds), and combine the three build logs into `docs/BUILD_LOG.md`.
4. **Keys** — `cp .env.example .env` in `argon-app/` and fill (never commit `.env`):
   | Key | For | Required |
   |---|---|---|
   | `GEMINI_API_KEY` | Argon, Flash, Flash-Lite, Antigravity, Nano Banana, Deep Research, transcribe/TTS | **Yes** |
   | `COMPOSIO_API_KEY` | GitHub connect, repos, PRs, issues (+ optional Slack mirror) | For PRs (else local mode) |
   | `ELEVENLABS_API_KEY` | Agent voices with timestamps (lip-sync) | For best voice (else Gemini TTS / browser) |
   | `GITHUB_SANDBOX_TOKEN` | Antigravity sandbox pushes via the Credentials API | Optional |
   | `CUA_MODE` (`sandbox`/`spaces`/`off`) + Cua CLI login | Cloud computers | Optional (`off` falls back) |
   | `KERNEL_TOKEN` | Bearer auth on `/v1/*` | Optional |
   | `LLM_MODE=live`, `ENGINEERING_EXECUTOR`, `STT_PRIMARY` | From Ayan's phase-1 decisions (`docs/decisions/ayan.md`) | Yes |
   Then `uv sync --extra computers` if Cua is on, and `uv run python -m foundry_kernel.voice.assign_voices`
   (writes `kernel/data/voices.json`).
5. **Verify:** `make test`; `cd kernel && uv run python -m foundry_kernel.llm.smoke all`;
   `make dev`; `make api-types` (writes `web/src/api/schema.d.ts`) then `pnpm typecheck` again.
6. **Assets and world:** if Ayan's branch didn't commit them, `uv run foundry-worldgen faces portraits
   textures`; then `uv run foundry-worldgen buildings` and `uv run foundry-worldgen loop --max-iter 4`
   (now that Mahin's capture page exists); `make manifest` if the roster changed.
7. **Evals:** `uv run foundry-eval engineering` (background) and `uv run foundry-eval grounding`;
   commit `evals/results/*.json`.
8. **End-to-end:** onboarding → live venture → plan → departments working → engineering PR + merge
   gate → Enter the view → Nova → route card → race → talk with voice + lip-sync + source cards.
9. **Acceptance + drills:** walk [`02-acceptance-criteria.md`](02-acceptance-criteria.md); drill the
   fallbacks in [`05-risk-register-and-fallbacks.md`](05-risk-register-and-fallbacks.md).
10. **Commit and push** `main`.

## Rules recap

- Read the spec on `main` first; the spec wins over the work order if they ever disagree (log it).
- Edit only your files; never edit frozen files; contract requests instead.
- Keep public names and signatures listed above; keep the fake-mode paths working.
- Keep both seed test suites green; commit small, verified steps; push your branch often.
- Never commit `.env` or keys. Never send secrets to the browser.
