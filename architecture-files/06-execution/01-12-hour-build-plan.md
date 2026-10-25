# 01 — The 12-Hour Build Plan

> **Hackathon context.** One build day for the Gemini 4 Argon hackathon (plus the night before).
> Targets (ADR-019): **Problem Statement 2 — More Dimensions** (phases 6–8 + photoreal look + World
> Lab live round) and **Best use of Managed Agents** (phases 3, 5, 9). Every checkpoint should leave
> something demoable. The engineering eval in phase 9 is optional.

Follow the phases in order. Each phase ends with a **checkpoint**: run the verify commands, write a
line in `argon-app/docs/BUILD_LOG.md` (`T+hh:mm phase N done — what works, what doesn't`), and
commit (`git commit -m "phase N: <name>"`). Never start a phase with the previous checkpoint red;
if a checkpoint can't go green within 20 extra minutes, apply the fallback listed in
[`05-risk-register-and-fallbacks.md`](05-risk-register-and-fallbacks.md) and move on.

Background jobs (long Argon generations) are started as soon as their inputs exist and run while
you build the next phase.

## Timeline at a glance

| Time | Phase | Output |
|---|---|---|
| 0:00–0:30 | 0. Setup | `argon-app/` skeleton, deps, skills, docs, templates copied |
| 0:30–1:00 | 1. Smoke tests | S1–S7 results; VERIFIED_API_SHAPES.md; STT + executor decisions |
| 1:00–2:30 | 2. Kernel core | DB, seed, APIs, SSE, approvals, chat, FakeLLM, tests |
| 2:30–4:00 | 3. Company orchestration | Scheduler, 13 department handlers, plan DAG, gates, ledger, **coordination (asks, `agent.request`, handoffs, standups, threads)**; fake-mode venture runs end to end. **Start background: faces → signs; asset pipeline (`pnpm assets`)** |
| 4:00–5:00 | 4. Dashboard | All pages, SSE live updates, onboarding |
| 5:00–6:30 | 5. Engineering loop | Template + cache, LocalLoop & Antigravity executors, review, QA, Composio PRs, merge gate |
| 6:30–8:00 | 6. World core | Look kit, city, fallback buildings ×13, player, car, interiors, HUD shell, map. **Start background at 7:15: worldgen buildings (one pass)** |
| 8:00–9:15 | 7. Characters & conversation | Characters, lip-sync, talk/concierge + checker, TTS/STT, route cards, race, fast travel |
| 9:15–10:30 | 8. Worldgen loop | Capture page, probes, critique/patch loop, registry; generated buildings live |
| 10:30–11:30 | 9. Evals, loops, computers & metrics | Engineering + grounding evals, metrics page, support loop, improvement loop, **Cua cloud computers** (Leo, Ines, Ben, Yuki) + Computers page, Town Hall standup playback |
| 11:30–12:00 | 10. Hardening | Acceptance checklist, fallback drills, README, final commit |

---

## Phase 0 — Setup (0:00–0:30)

1. `mkdir argon-app && cd argon-app && git init` (if the repo is already a git repo, just create
   the folder on the working branch).
2. Create the tree from [`../01-architecture/02-repo-layout.md`](../01-architecture/02-repo-layout.md)
   (empty files where needed).
3. Copy templates: `templates/AGENTS.md → AGENTS.md`, `templates/DESIGN.md → docs/DESIGN.md`,
   `templates/env.example → .env.example` and `.env`, `templates/roster.json →
   kernel/data/roster.json`, `templates/eval-briefs/*.yaml → evals/briefs/`,
   `templates/grounding-questions.yaml → evals/grounding/questions.yaml`,
   `templates/grounding-fixture.json → kernel/foundry_kernel/evals/fixtures/grounding_state.json`.
4. Copy ADRs into `docs/DECISIONS.md`; create `docs/VERIFIED_API_SHAPES.md`, `docs/BUILD_LOG.md`.
5. Kernel: write `pyproject.toml`; `cd kernel && uv sync --extra dev`.
6. Web: `cd web && pnpm init`, write `package.json` from the spec, `pnpm install`, then
   `pnpm add three && pnpm add -D @types/three`, pin exact versions.
7. Install Gemini skills (see [`../02-models-and-integrations/02-gemini-interactions-api.md`](../02-models-and-integrations/02-gemini-interactions-api.md) Step 0).
8. Fill `.env` keys you have.

**Checkpoint:** `uv run python -c "import fastapi, google.genai"` OK; `pnpm typecheck` OK on an
empty `src/main.tsx`; `make dev` starts both servers (kernel `/health` may 404 until phase 2).

## Phase 1 — Smoke tests (0:30–1:00)

Implement `llm/client.py` (minimal) + `llm/smoke.py`; run S1–S7. For each VERIFY item resolved,
record the shape in `docs/VERIFIED_API_SHAPES.md`. Also probe Composio (`GET v3.1/auth_configs`)
and ElevenLabs (`GET /v1/voices`) with tiny scripts.

Decisions to record: `STT_PRIMARY` (gemini|browser), `ENGINEERING_EXECUTOR` (antigravity|local),
whether images/audio input work (affects critic and STT), Composio execute endpoint confirmed or not.

**Checkpoint:** S1 and S2 PASS (mandatory — without them nothing works; if they fail, get help from
the Google team immediately and continue in `LLM_MODE=fake`).

## Phase 2 — Kernel core (1:00–2:30)

Order: `config.py` → `db.py` + `schema.sql` → `ids.py` → `seed.py` → `bus.py` (+ broker) →
`api/system.py`, `ventures.py`, `departments.py`, `agents.py`, `tickets.py`, `runs.py`,
`artifacts.py`, `approvals.py`, `channels.py`, `activity.py`, `stream.py` → `gates.py` →
`ledger.py` → `llm/client.py` full (accounting, retries, fake mode) → tests.

**Checkpoint:**
```bash
cd kernel && uv run pytest -q tests/test_db.py tests/test_api_contract.py tests/test_gates.py tests/test_ledger.py
curl -s localhost:8787/health
curl -s -XPOST localhost:8787/v1/ventures -H 'content-type: application/json' \
  -d '{"name":"Smoke","idea":"A tiny todo app for testing the kernel end to end.","founder_name":"Test"}'
curl -N localhost:8787/v1/ventures/<vid>/stream   # receives venture.updated after next call
```

## Phase 3 — Company orchestration (2:30–4:00)

`departments/base.py` (contracts + ArtifactHandler) → prompts for all 29 agents →
`intake.py`, `office_hours.py`, `chief_of_staff.py` (plan + skeleton fallback + report +
capability gap), pivot (in generic + gate), `finance_people.py`, generic registrations for all
other types → `scheduler.py` (dispatch, retries, gate re-entry, startup recovery, standup timer,
escalation check) → chat automatic messages with kinds and threads → `coordination.py`
(`ask_agent`, `request`, `post`) + `requests.py` (`agent.request`) + `cos.standup` →
fake executor for `eng.*` in fake mode. Spec: `03-company-kernel/09-agent-coordination.md`.

At 2:45 start background job: `uv run foundry-worldgen faces && uv run foundry-worldgen signs`
(needs only roster + Gemini). Textures, HDRIs, models and avatars come from Karthik's asset pipeline
(`pnpm assets`); portraits are rendered from the avatars later (`portraits --from-renders`).

**Checkpoint:** `LLM_MODE=fake`: create + start a venture → within 2 minutes the DAG completes
through `cos.report` (gates auto-approved by a test helper) — `tests/test_scheduler.py::test_fake_venture_end_to_end`.
Then one **live** venture run up to `plan.request` done (real Argon plan visible).

## Phase 4 — Dashboard (4:00–5:00)

`pnpm gen:api` → `api/client.ts`, `sse.ts`, `hooks.ts` → Layout/Sidebar/TopBar/SystemStrip →
Overview → Departments (+detail) → Agents (+detail with Talk box placeholder) → Tickets (+graph) →
Runs (+live logs) → Approvals → Chat → Artifacts → Integrations → Settings → Onboarding.
Portraits: use `/generated/portraits/<id>.png` with an initials-avatar fallback.

**Checkpoint:** `pnpm typecheck && pnpm test && pnpm e2e --grep dashboard` green; a live venture's
tickets update without refresh; approving a gate in the UI unblocks the ticket.

## Phase 5 — Engineering loop (5:00–6:30)

`executors/templates/vite-react-ts/` → `workspace.py prepare-cache` → `fileblocks.py` (+ tests) →
`local_loop.py` → `engineering.py` handler (design → tasks; build; fix) → review → QA (acceptance
tests) → merge gate + merge → `antigravity.py` → `integrations/composio.py` (connect, status,
create repo, branch, put file, PR, merge) → previews (`api/preview.py`).

**Checkpoint:** `uv run foundry-eval engineering --brief split-bill --condition loop` passes the
hidden tests; a live venture produces a PR (or local build in no-GitHub mode) and a pending merge
gate; approving it merges.

## Phase 6 — World core (6:30–8:00)

`kit/types.ts` (contract verbatim) → `kit/materials.ts`, `textures.ts` (procedural fallbacks),
`lights.ts`, `post.ts`, `LookKit.ts`, `primitives.ts` (recording + merge + colliders), props
library → `buildings/fallback/archetypes.ts` (4 archetypes, 13 configs) → `city/*` (layout, roads,
plaza, props, signage) → `engine/*` (Engine, Loop, Input, Quality, SceneManager) →
`player/*` → `vehicle/*` → interiors → `nav/RoadGraph.ts`, `astar.ts` (+ tests) → HUD shell
(prompt, toasts, pause menu, map) → `WorldHost.tsx` + route `/view`.

At 7:15 start background job: `uv run foundry-worldgen buildings` (one-pass generation; needs
`kit/types.ts`, DESIGN.md, a fallback archetype example).

**Checkpoint:** `/view` loads in < 6 s; walk the plaza; drive the car around the ring; enter and
exit all 13 fallback interiors; `pnpm test` (astar, collision, layout) green; FPS ≥ 50 High.

## Phase 7 — Characters & conversation (8:00–9:15)

Kernel: `conversation/context_pack.py`, `directory.py`, `talk.py`, `concierge.py`, `checker.py`
(+ tests), `voice/tts.py` (+ cache, fallbacks), `voice/stt.py`, `voice/assign_voices` →
`api/conversation.py`, `api/voice.py`, `api/world.py` (manifest).
Web: `npc/Character.ts` (FaceSpec → mesh; seed fallback), `NpcManager`, `LookAt`, `visemes.ts`
(+ tests), `LipSync.ts`, `conversation/*` (Mic, Stt, Speech, ConversationController), HUD
ConversationPanel, SourceCard, RouteCard, RaceHud, Fade → `nav/Gps.ts`, `Race.ts`, `FastTravel.ts`
→ Concierge auto-greet, `?goto=`.

**Checkpoint:** in a live venture: talk to Nova, get a cited answer with a route card, race to the
agent, talk to them with lip-synced voice; release-V-to-first-audio p50 ≤ 2.5 s (latency samples).

## Phase 8 — Worldgen loop (9:15–10:30)

`kit/validateModule.ts`, `capture/CapturePage.tsx`, `probes/probes.ts`, `scripts/capture.ts`,
`tsconfig.worldgen.json` → `worldgen/validate.py`, `capture.py`, `critique.py`, `score.py` →
run `uv run foundry-worldgen loop --max-iter 4` on the generated modules → registry →
`buildings/index.ts` uses generated modules.

**Checkpoint:** `scores.json` has ≥ 2 iterations; final world score ≥ 0.9 and ≥ 10 of 13
buildings `generated`; the world loads with generated buildings; fallbacks capture at 1.0.

## Phase 9 — Evals, loops & metrics (10:30–11:30)

`uv run foundry-eval engineering` (5 briefs × baseline/loop, run in background, ~30–60 min) →
`uv run foundry-eval grounding` → Metrics page charts → `integrations/github_watch.py` +
`departments/support.py` → improvement loop (`capability.gap` → `people.hire` → register agent →
NPC appears) with a test → **Cua**: `uv sync --extra computers`, `computers/cua_client.py` (confirm
SDK methods; xdotool fallback), `manager.py`, `loop.py`, `guard.py` (+ `test_computer_guard.py`),
wire `use_computer` into `research.competitors`, `leads.icp`, `qa.verify`, `support.issue`;
dashboard Computers page → Town Hall standup playback (`/v1/ventures/{vid}/standups/latest`).

**Checkpoint:** `evals/results/*.json` committed; Metrics page shows engineering (baseline vs
loop), grounding accuracy, world scores, latency p50/p90; one Cua computer task (Leo's pricing
capture) completes with screenshots visible on the Computers page, or `CUA_MODE=off` is recorded
with the reason.

## Phase 10 — Hardening (11:30–12:00)

Run the full acceptance checklist ([`02-acceptance-criteria.md`](02-acceptance-criteria.md)); drill
each fallback once (kill ElevenLabs key → browser voice; `ENGINEERING_EXECUTOR=local`; kernel down →
world loads offline); update README with run instructions and links to eval results; final commit.

---

## Parallel version (our team of 4, each with a coding agent)

Phase 0 is already done: `argon-app/` on `main` is a frozen-contract seed (every module exists with
its final interface; shared contracts are frozen; `make test` is green). Each person works on their
own branch and the branches merge once. Full ownership map, cross-branch interfaces and the merge
checklist: [`07-team-split.md`](07-team-split.md).

| Lane | Owner (branch) | Phases |
|---|---|---|
| A — Kernel core, company & dashboard | **Tanush** (`tanush`) | 2, 3, 4 (whole dashboard incl. **World Lab** page), kernel side of 7 (conversation, checker, manifest route), 9 (grounding eval, improvement loop, metrics) |
| B — Models, engineering, integrations & the world loop | **Ayan** (`ayan`) | 1, 5, kernel/script side of 8 (one pass, capture with **video**, critique with realism, patch, score, **live round** + World Lab API, portraits from renders), 9 (support loop, Cua; engineering eval optional) |
| C — The photoreal 3D world | **Mahin** (`mahin`) | 6 with the photoreal kit (`05-world/12`), web side of 7 (realistic avatars, conversation UI, race, fast travel, HUD), web side of 8 (capture page incl. `playPath` + portrait mode, probes), Town Hall playback, performance |
| D — Assets & voice (smaller lane, Claude Pro) | **Karthik** (`karthik`) | Photoreal asset pipeline first (CC0 textures, HDRIs, models, avatars → manifest), then voice end to end (visemes, lip-sync, mic, STT, speech; ElevenLabs/Gemini TTS, STT, voice assignment, `/v1/voice/*`) |

The frozen contracts (agreed up front, edited only in the merge session): `schema.sql`,
`contracts.py`, `shared/contracts.ts`, `kit/types.ts`, `kit/props.contract.ts`,
`assets/manifest.contract.ts`, FaceSpec, `probes/types.ts`, the manifest (`world_layout.py`).
