# 07 — Team Split: four people, four branches, one merge

> **Hackathon context.** Four builders — **Tanush**, **Ayan**, **Mahin** and **Karthik** — each with
> a coding agent, build the whole product in parallel through the night and merge once. Every branch
> runs and tests on its own; the merge is a union of disjoint files plus API keys. Karthik works on a
> Claude Pro plan, so lane D is deliberately smaller and made of self-contained pieces.

This document is the contract between the four branches. Each branch has a work order at its root
(`WORKORDER_TANUSH.md`, `WORKORDER_AYAN.md`, `WORKORDER_MAHIN.md`, `WORKORDER_KARTHIK.md`) that turns
this split into step-by-step instructions. **Read the spec first** (`architecture-files/README.md`,
`00-overview/`, `01-architecture/`), then this document, then your work order.

## How it works

1. **A frozen-contract seed on `main`** (`argon-app/`). Every module in the repo layout already
   exists with its final public interface. The shared contracts (database schema, API objects,
   handler/executor/LLM protocols, the kit API, FaceSpec, the world manifest, the capture-page
   handshake) are final. Stubs are safe no-ops, so the kernel boots, the web builds, and both test
   suites pass on day zero (`make test`).
2. **Disjoint ownership.** Every file has exactly one owner — `tanush`, `ayan`, `mahin`, `karthik`
   or `frozen` — declared in its first line (`OWNER: …`) and enforced by
   `argon-app/scripts/check_ownership.py` (`make ownership WHO=<you>`). Nobody edits a file they
   don't own, so the merge has no conflicts. `python3 scripts/check_ownership.py --audit` checks
   that every tracked file and every file the work orders plan to create has exactly one intended
   owner — it doubles as a "where does this file go?" index.
3. **Fakes and mocks remove waiting.** `LLM_MODE=fake` + `FakeLLM` + the fake-mode engineering
   handler let Tanush run the full company DAG without Ayan's live loop; `FakeHandlerContext` lets
   Ayan test handlers without Tanush's scheduler; `/view?mock=1` fixtures let Mahin build the whole
   world without any kernel; the capture handshake types let Ayan and Mahin build both ends of the
   worldgen loop separately; the voice modules' seed stubs (browser speech, mouth at rest) let Mahin
   wire conversations before Karthik's lip-sync lands, and Karthik tests voice with pure-function
   unit tests and a tiny local harness page.
4. **One merge session** at the end: merge the four branches into `main`, apply contract
   requests, add `.env` keys, regenerate API types and lockfiles, run worldgen and evals, and walk
   the acceptance checklist.

## Who owns what

| | **Tanush** — kernel core, company & dashboard | **Ayan** — models, engineering, integrations & worldgen | **Mahin** — the 3D world | **Karthik** — voice & grounding eval |
|---|---|---|---|---|
| Spec | `01-architecture/*`, `03-company-kernel/*` (except 02, 03), `04-dashboard/*`, `05-world/07`+`08` kernel side | `02-models-and-integrations/*` (except 05, 06), `03-company-kernel/02`+`03`, `05-world/05` faces/portraits, `05-world/09`+`10` kernel/script side, `06-execution/04` §1 | `05-world/00`–`11` (web side, except lip-sync/mic/speech internals), `templates/DESIGN.md` | `02-models-and-integrations/05`+`06`, `05-world/05` §Lip-sync, `05-world/07` voice pipeline, `06-execution/04` §2 |
| Kernel | `app.py`, `db.py`, `bus.py`, `gates.py`, `ledger.py`, `seed.py`, `scheduler.py`, `orchestrator.py`, `departments/*` (all except engineering/qa/support), `departments/prompts/*` (all except `eng.*`, `su.*`), `conversation/*`, `api/` system, ventures, departments, agents, tickets, runs, artifacts, approvals, channels, activity, stream, conversation, world, metrics, org; any new top-level kernel module | `models.py`, `llm/*`, `departments/engineering.py`, `qa.py`, `support.py`, prompts `eng.*`/`su.*`, `executors/*`, `integrations/*`, `computers/*`, `worldgen/*`, `api/` integrations, computers, preview; `evals/engineering_eval.py`; `kernel/data/faces.json`, `worldgen/` | — | `voice/*` (tts, stt, `assign_voices.py`), `api/voice.py`, `evals/grounding_eval.py`, `evals/fixtures/*`, `kernel/data/voices.json` |
| Web | `src/dashboard/**`, `src/api/**`, `src/styles/app.css`, `tests/unit/dashboard/**`, `tests/e2e/dashboard.spec.ts` | `scripts/capture.ts`, `src/world/buildings/generated/**` and `staging/`, `public/generated/**` | `src/world/**` except frozen, generated and Karthik's five files; `src/shared/worldApi.ts`; `tests/unit/world/**`, `tests/e2e/world.spec.ts` | `src/world/npc/visemes.ts`, `npc/LipSync.ts`, `conversation/Mic.ts`, `conversation/Stt.ts`, `conversation/Speech.ts`; `tests/unit/voice/**` |
| Tests | `kernel/tests/**` except others' | `kernel/tests/ayan/**`, `test_fileblocks.py`, `test_computer_guard.py`, `test_worldgen_*.py`, `test_engineering*.py`, `test_executor*.py`, `test_llm*.py`, `test_composio*.py`, `test_support*.py` | `web/tests/unit/world/**`, `web/tests/e2e/world.spec.ts` | `kernel/tests/karthik/**`, `test_voice*.py`, `test_grounding*.py`, `web/tests/unit/voice/**` |
| FakeLLM fixtures (`kernel/tests/fixtures/fake_llm/<job>.json`) | every job not listed for others | `engineering_*`, `qa_analyze`, `eval_baseline`, `triage`, `worldgen_*`, `face_spec`, `portrait`, `texture`, `music_loop`, `computer_*` | — | `transcribe`, `tts_fallback` |
| Migrations | `0001`–`0099` | `0100`–`0199` | `0200`–`0299` | `0300`–`0399` |
| Results | — | `evals/results/engineering-*`, `kernel/data/worldgen/runs/**` | — | `evals/results/grounding-*` |
| Docs | `docs/{build-logs,decisions,verified,contract-requests}/tanush.md` | `…/ayan.md` | `…/mahin.md` | `…/karthik.md` |
| Acceptance | K-01…K-11, CO-01…CO-06, D-01…D-05, C-05…C-07 (kernel side), E-09, V-03 | E-01…E-08, CU-01…CU-05, G-01…G-03, G-05, V-01 | W-01…W-11, C-01, C-02, C-04, CO-07, G-04 | C-03 (voice parts), C-08, C-09, V-02 |

### Frozen (nobody edits on a branch)

| File | What it freezes |
|---|---|
| `kernel/foundry_kernel/schema.sql` | Full DDL from `01-architecture/03-data-model.md` (extend only with migrations) |
| `kernel/foundry_kernel/contracts.py` | `LLMClientProtocol`, `LLMResult` (incl. `images` and `audio` outputs), `Part`, `HandlerContext`, `Handler`, `HandlerResult` and `New*` records, `Executor`/`ExecutorInput`/`ExecutorResult`, conversation, voice (`TtsResponse`, `SttResponse`, `Alignment`), manifest, FaceSpec, standup and computer models |
| `config.py`, `ids.py`, `errors.py`, `security.py` (`redact()`), `world_layout.py` | Settings for every env var; ULIDs; error types; redaction; the deterministic city layout + manifest builder |
| `api/__init__.py`, `evals/cli.py` | Router list (every router file exists); eval dispatcher |
| `kernel/tests/conftest.py`, `fakes.py`, `test_seed_contracts.py` | Shared fixtures, `FakeHandlerContext`, the seed's safety-net tests |
| `kernel/data/roster.json` | 13 departments, 29 agents |
| `web/src/App.tsx`, `main.tsx` | Routing: `/view` → world, `/view/capture` → capture page, `/*` → dashboard |
| `web/src/shared/contracts.ts` | TypeScript mirror of every API object, the manifest and SSE events |
| `web/src/world/kit/types.ts` | The kit API given to Argon (verbatim from `05-world/09`) |
| `web/src/world/kit/props.contract.ts` | Footprint (w × d × h) of every `PropKind` — Mahin's `kit/props.ts` builds to it; Ayan's prompt "PROPS LIBRARY" table is generated from it |
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
| `ctx.llm` = `build_llm_client(settings, db)` → `LLMClient` / `FakeLLM` (`generate`, `generate_json`, `run_agent`, `generate_images`) | Ayan | Tanush's handlers, conversation, orchestrator; Karthik's STT/TTS fallbacks | Minimal working live client; `FakeLLM` returns fixtures/generic JSON |
| `models.JOBS` / `models.job(name)` | Ayan | everyone calling the LLM | All jobs from `02-models-and-integrations/01-model-routing.md` |
| `HandlerContext` (`log`, `context_for`, `ask_agent`, `request`, `post`, `use_computer`, `approval_result`) | Tanush (scheduler + `departments/coordination.py`) | Ayan's engineering/support handlers | `tests/fakes.FakeHandlerContext` |
| `departments.REGISTRY` entries `eng.*`, `qa.verify` → `engineering:EngineeringHandler`; `support.issue` → `support:SupportHandler` | Tanush (file), Ayan (classes) | scheduler | Fake-mode engineering DAG: design → build → review → verify → merge gate |
| `computers.loop.run_task(...) -> ComputerTaskResult` (never raises; `status="skipped"` when unavailable) | Ayan | Tanush's `ctx.use_computer` | Always `skipped` |
| `voice.tts.synthesize(settings=, db=, agent_id=, text=) -> TtsResponse`; `voice.stt.transcribe(settings=, llm=, audio=, mime=) -> SttResponse` | **Karthik** | Tanush (`/standups/latest` audio), Mahin (via HTTP) | `provider="browser"` / `"none"` |
| `POST /v1/voice/tts`, `POST /v1/voice/transcribe`, `GET /media/audio/{sha}.mp3` | **Karthik** | Mahin via `shared/worldApi.ts` | Empty router → world falls back to browser speech |
| `npc/visemes.ts` (`VISEMES`, `visemeForChar`, `charIndexAt`), `npc/LipSync.ts` (`LipSync.start/onBoundary/stop/update`, `.mouth`), `conversation/Mic.ts` (`Mic`), `conversation/Stt.ts` (`startListening`), `conversation/Speech.ts` (`speak`) | **Karthik** | Mahin's `Character.ts` and `ConversationController.ts` | Mouth at rest; mic unavailable (typing fallback); browser `speechSynthesis` |
| `conversation.talk.talk(...)`, `conversation.concierge.ask(...)` (signatures in the seed) | Tanush | Tanush's API, **Karthik's grounding eval** | Raise `NotImplementedYet` |
| `integrations.github_watch.start/stop`, `computers.manager.start/stop` | Ayan | Tanush's `app.py` lifespan | No-ops |
| `gates.*`, `ledger.*`, `bus.emit`, `db.tx()` | Tanush | Ayan, Karthik (eval writes `eval_results`) | Working |
| `security.redact()` | frozen | all kernel owners | Working |
| HTTP API (`01-architecture/04-api-contract.md`) | Tanush (+ Ayan's integrations/computers/preview, Karthik's voice routers) | Mahin via `shared/worldApi.ts`; Tanush's dashboard | Empty routers → Mahin uses `?mock=1` |
| `window.__foundryProbe` / `ProbeResult` / `BuildingProbeReport` | Mahin (page + probes) | Ayan (`scripts/capture.ts`, `worldgen/capture.py`) | Page reports `error: "not implemented"` |
| `web/src/world/buildings/generated/{index.ts,registry.json}` | Ayan (worldgen writes them) | Mahin's `buildings/index.ts` (generated ?? fallback) | Empty → all fallbacks |
| `/generated/portraits|signs|textures/*`, `kernel/data/faces.json` | Ayan | Mahin, Tanush | Missing → seed faces, procedural textures, initials avatars, canvas signs |
| `kernel/data/voices.json` | Karthik | Tanush (manifest `voice_ready`), Karthik's TTS | Missing → `voice_ready: false` |
| `GET /v1/world/manifest` built with `world_layout.build_manifest(...)` | Tanush (route), frozen (math) | Mahin | `manifest.fallback.json` |
| `/view?venture=<vid>&goto=<agent_id>` | Mahin | Tanush's dashboard | Placeholder page |

## Timeline (all four in parallel)

| Time | Tanush | Ayan | Mahin | Karthik (Claude Pro: short sessions) |
|---|---|---|---|---|
| 0:00–0:30 | Read spec + work order; `make test` green | Same; `.env` with own keys | Same | Same (read only the files listed in the work order) |
| 0:30–2:30 | Phase 2: DB, seed, API, SSE, gates, ledger, chat | Phase 1: smoke S1–S7; full `llm/client.py`; Composio probe; **start faces → portraits → textures** | Look kit, house example renders | Step A: `visemes.ts` + `LipSync.ts` with unit tests |
| 2:30–5:00 | Phase 3: scheduler, handlers, orchestrator, coordination; fake E2E | Phase 5: engineering loop, Composio PRs, merge, Antigravity | Fallback buildings, city, engine, player, car, nav, HUD shell | Step B: `Speech.ts`, `Mic.ts`, `Stt.ts` + harness page |
| 5:00–8:00 | Phase 4: dashboard | Worldgen one pass, validate, critique, patch, score, `capture.ts` | Characters (reading `lipSync.mouth`), conversation controller + panel, race, fast travel, concierge, `?goto=` | Step C: ElevenLabs probe, `tts.py` + cache + fallbacks, `stt.py`, `assign_voices.py`, `api/voice.py` |
| 8:00–10:30 | Conversation kernel (context pack, talk, concierge, checker), manifest route, standups | Support loop + github_watch; Cua computers | Capture page + probes; performance | Step D: grounding eval harness + scoring (tested with a fake answerer) |
| 10:30–12:00 | Improvement loop, metrics; hardening | Engineering eval; worldgen loop vs Mahin's branch (optional); hardening | Town Hall playback, offline mode, W- checks | Handoff notes; help in the merge session (voice drills, run the grounding eval live) |

## The merge session

Run by one person with a coding agent on `main`, after all four branches are pushed and green.

1. **Pre-flight on each branch:** `make test` green and `make ownership WHO=<name>` clean
   (union-file notes are fine).
2. **Merge** (order: `tanush` → `ayan` → `mahin` → `karthik`):
   ```bash
   git checkout main && git pull
   git merge --no-ff origin/tanush  -m "merge: tanush"
   git merge --no-ff origin/ayan    -m "merge: ayan"
   git merge --no-ff origin/mahin   -m "merge: mahin"
   git merge --no-ff origin/karthik -m "merge: karthik"
   ```
   Only the shared dependency files can conflict: keep every added line, then regenerate
   `cd argon-app/kernel && uv lock && uv sync --extra dev` and `cd argon-app/web && pnpm install`.
3. **Apply contract requests** from `docs/contract-requests/*.md` (edit the frozen files, remove
   the matching workarounds), and combine the four build logs into `docs/BUILD_LOG.md`.
4. **Keys** — `cp .env.example .env` in `argon-app/` and fill (never commit `.env`):
   | Key | For | Required |
   |---|---|---|
   | `GEMINI_API_KEY` | Argon, Flash, Flash-Lite, Antigravity, Nano Banana, Deep Research, transcribe/TTS | **Yes** |
   | `COMPOSIO_API_KEY` | GitHub connect, repos, PRs, issues (+ optional Slack mirror) | For PRs (else local mode) |
   | `ELEVENLABS_API_KEY` | Agent voices with timestamps (lip-sync) | For best voice (else Gemini TTS / browser) |
   | `GITHUB_SANDBOX_TOKEN` | Antigravity sandbox pushes via the Credentials API | Optional |
   | `CUA_MODE` (`sandbox`/`spaces`/`off`) + Cua CLI login | Cloud computers | Optional (`off` falls back) |
   | `KERNEL_TOKEN` | Bearer auth on `/v1/*` | Optional |
   | `LLM_MODE=live`, `ENGINEERING_EXECUTOR`, `STT_PRIMARY` | From Ayan's and Karthik's decisions (`docs/decisions/ayan.md`, `karthik.md`) | Yes |
   Then `uv sync --extra computers` if Cua is on, and `uv run python -m foundry_kernel.voice.assign_voices`
   (writes `kernel/data/voices.json`) if Karthik's branch didn't commit it.
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
- Keep public names and signatures listed above; keep the fake-mode paths and seed stubs' behaviour
  safe.
- Keep both seed test suites green; commit small, verified steps; push your branch often.
- Never commit `.env` or keys. Never send secrets to the browser.
