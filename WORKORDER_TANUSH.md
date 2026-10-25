# WORK ORDER — Tanush (branch `tanush`)

**Lane A: kernel core, the company, and the dashboard.** You build the company's brain and its
source-of-truth UI: database, API, event stream, scheduler, approvals, ledger, 11 of the 13
departments' handlers, agent coordination and group chat, grounded conversation (talk, concierge,
citation checker), the world manifest route, the grounding eval, and every dashboard page —
including the **World Lab**, where judges see our Problem Statement 2 loop (recorded score curve +
a live round on stage).

**Our entry (ADR-019):** Problem Statement 2 — More Dimensions, plus Best use of Managed Agents.
Your lane carries the Managed Agents story: an Argon Chief of Staff orchestrating department agents
built on Google's agent APIs, coordinating through tickets, asks, requests and standups — and the
dashboard is where judges *see* that orchestration (runs, Antigravity sandboxes, chat, approvals).

---

## 0. Read first — on `main`, before writing any code

Read these in order (they are on every branch, under `architecture-files/`):

1. `architecture-files/README.md` — the whole thing, including "Why we're building this".
2. `00-overview/*` (vision, hackathon context, glossary, **ADRs incl. 018–020**, feature catalog).
3. `01-architecture/*` (system overview, repo layout, **data model**, **API contract**, event bus &
   orchestration, security).
4. `06-execution/07-team-split.md` — who owns what, the frozen contracts, the cross-branch
   interfaces and the merge plan. **This work order is the Tanush column of that document.**
5. `06-execution/06-agent-operating-rules.md`, `02-acceptance-criteria.md`, `03-testing-strategy.md`,
   `05-risk-register-and-fallbacks.md`.
6. Your sections: `03-company-kernel/01`, `04`–`09` and `departments/*` (skim 02/03 — Ayan's),
   `02-models-and-integrations/03-antigravity-managed-agents.md` (what the dashboard must show),
   `04-dashboard/01-dashboard-spec.md`, `04-dashboard/02-onboarding.md`,
   `05-world/13-world-lab-and-live-round.md` §1, §3, §4 (the World Lab page),
   `05-world/03-city-layout.md` §Manifest, `05-world/07-npc-conversation.md`, `05-world/08-concierge.md`,
   `06-execution/04-evals.md` §2 (grounding eval), `02-models-and-integrations/01-model-routing.md`,
   **`03-company-kernel/10-agent-model-matrix.md`** (which agent runs which job/model/managed agent/tools —
   your handlers must use exactly these jobs), `02-models-and-integrations/12-elevenlabs-voice-agents.md` §4
   (the dashboard Call button).
7. `argon-app/AGENTS.md` and every seed file you own (they start with `# OWNER: tanush` / `// OWNER: tanush`).

The spec is the contract. If this work order and the spec ever disagree, follow the spec and log it
in `argon-app/docs/decisions/tanush.md`.

## 1. Setup

```bash
git fetch origin && git checkout tanush
cd argon-app && cp .env.example .env          # add GEMINI_API_KEY if you have it; LLM_MODE=fake works without
cd kernel && uv sync --extra dev && uv run pytest -q     # 12 passed
cd ../web && pnpm install && pnpm typecheck && pnpm test  # 8 passed
cd .. && make dev                                         # kernel :8787, web :5173
```

Install the Gemini API skill for your coding agent: `npx skills add google-gemini/gemini-skills --skill gemini-api-dev`
(`03-company-kernel/10-agent-model-matrix.md` §5).

## 2. What you own (edit only these)

**Kernel** (`argon-app/kernel/foundry_kernel/`):
`app.py`, `db.py`, `bus.py`, `gates.py`, `ledger.py`, `seed.py`, `scheduler.py`, `orchestrator.py`;
`departments/__init__.py` (REGISTRY), `departments/base.py`, `intake.py`, `office_hours.py`,
`chief_of_staff.py`, `pivot.py`, `finance_people.py`, `requests.py`, `chat.py`, `coordination.py`
(create the ones that don't exist); `departments/prompts/*.md` for every agent **except** `eng.*`
and `su.*`; `conversation/*`; `api/system.py`, `ventures.py`, `departments.py`, `agents.py`,
`tickets.py`, `runs.py`, `artifacts.py`, `approvals.py`, `channels.py`, `activity.py`, `stream.py`,
`conversation.py`, `world.py` (manifest only), `metrics.py`, `org.py`; **`evals/grounding_eval.py`,
`evals/fixtures/*`**; migrations `0001`–`0099` named `NNNN_tanush_<what>.sql`; any **new
top-level** kernel module you need.

**Kernel tests:** everything under `kernel/tests/` except the frozen files, Ayan's
(`tests/ayan/`, `test_fileblocks.py`, `test_computer_guard.py`, `test_worldgen_*`,
`test_engineering*`, `test_executor*`, `test_llm*`, `test_composio*`, `test_support*`) and
Karthik's (`tests/karthik/`, `test_voice*`). That includes `test_grounding*.py`. FakeLLM fixtures
`kernel/tests/fixtures/fake_llm/<job>.json` for every job not owned by Ayan or Karthik (e.g.
`orchestrate_plan`, `dept_artifact`, `talk`, `concierge`, `check_citation`, `standup_update`,
`agent_request`, `spec_write`, `decision_review`, `capability_design`, `cos_report`, `summarize`,
`route_rank`, `panel_simulation`).

**Web** (`argon-app/web/`): `src/dashboard/**` (incl. `pages/WorldLab.tsx`), `src/api/**` (client,
sse, hooks; `schema.d.ts` is generated at merge), `src/styles/app.css`, `tests/unit/dashboard/**`,
`tests/e2e/dashboard.spec.ts`.

**Results/docs:** `evals/results/grounding-*.json`, `docs/{build-logs,decisions,verified,contract-requests}/tanush.md`.

## 3. Never touch

Frozen: `schema.sql`, `contracts.py`, `config.py`, `ids.py`, `errors.py`, `security.py`,
`world_layout.py`, `api/__init__.py`, `evals/cli.py`, `tests/conftest.py`, `tests/fakes.py`,
`tests/test_seed_contracts.py`, `kernel/data/roster.json`, `web/src/App.tsx`, `main.tsx`,
`src/shared/contracts.ts`, `styles/tokens.css`, everything under `src/world/` (Mahin's, Karthik's,
Ayan's generated, or frozen), `Makefile`, `AGENTS.md`, `docs/*.md`, `architecture-files/**`.
Ayan's: `models.py`, `llm/*`, `departments/engineering.py`/`qa.py`/`support.py`, `executors/*`,
`integrations/*`, `computers/*`, `worldgen/*`, `api/integrations.py`/`computers.py`/`preview.py`/
**`worldgen.py`**. Karthik's: `voice/*`, `api/voice.py`, `kernel/data/voices.json`,
`web/assets-pipeline/**`, `web/public/assets/**`. Need a change there? →
`docs/contract-requests/tanush.md`.

Check before every push: `make ownership WHO=tanush`.

## 4. What you can rely on (from others — already in the seed)

| You need | Use | Seed behaviour |
|---|---|---|
| LLM calls | `app.state.llm` / `ctx.llm` from `llm.client.build_llm_client(settings, db)`; `generate`, `generate_json(job, prompt, Schema)`, `run_agent(...)` (Antigravity); job names in `models.JOBS` | Minimal **working** live client (S1-level); `FakeLLM` in `LLM_MODE=fake` (scriptable: `FakeLLM().script(job, [outputs])`, fixtures by job name) |
| Engineering + QA + support handlers | `departments.REGISTRY` → `engineering:EngineeringHandler`, `support:SupportHandler` (don't rename those entries) | Fake mode: `eng.design` → creates `eng.build`(ref `build:T1`) → `eng.review` → `qa.verify` → **merge gate** → done. Live mode raises `NotImplementedError` until Ayan's branch lands |
| Cloud computers | `computers.loop.run_task(settings=, db=, llm=, venture_id=, agent_id=, ticket_id=, goal=, allowed_domains=, start_url=, max_steps=)` | Always returns `status="skipped"` → your caller must fall back (CU-05) |
| World Lab data (Ayan) | `GET /v1/world/worldgen/latest`, `/runs`, `/runs/{id}`, `/files/{path}`, `POST/GET /v1/world/worldgen/live-rounds…`, `…/promote`; shapes `WorldgenRunSummary`, `WorldgenRun`, `LiveRound` in `src/shared/contracts.ts`; SSE `worldgen.progress` (global event) | Empty router → 404s: the page renders an empty state ("No world generation run yet"). Build against hand-written fixture objects of those types in `tests/unit/dashboard/` |
| TTS for standup audio (Karthik) | `voice.tts.synthesize(settings=, db=, agent_id=, text=)` → `TtsResponse` | `provider="browser"`, no audio URL |
| Voice availability per agent (Karthik) | `kernel/data/voices.json` (`agent_id → voice_id`) → manifest `voice_ready` | Missing → all `false` |
| Startup hooks | `integrations.github_watch.start/stop(app)`, `computers.manager.start/stop(app)` | No-ops — keep calling them from `app.py` lifespan |
| Agent runtime matrix | `kernel/data/agent_capabilities.json` (frozen): per agent `work_jobs`, `conversation_jobs`, `coordination_jobs`, `managed_agents`, `tools`, `gates`; with `models.JOBS` → `AgentRuntime` | Final |
| Live voice calls (Karthik) | `startVoiceCall({ ventureId, agentId, surface: 'dashboard', onStatus, onTranscript, onAnswer })` from `web/src/world/conversation/VoiceCall.ts` → `{ status, end, setMuted }` | Seed: reports `unavailable` → show "Voice calls unavailable" and keep the Talk box |
| Layout math | `world_layout.build_manifest(roster, registry=, faces=, voices=, extra_agents=)` | Final; identical to the web's fallback manifest |
| Redaction | `security.redact(text)` | Final |

## 5. What others rely on from you (keep these names and signatures)

- `db.Database` (`connect`, `close`, `tx()`, `fetch_one`, `fetch_all`, `ping`) and `Tx` (`execute`,
  `fetch_one`, `fetch_all`); events published **after commit**.
- `bus.emit(tx, *, venture_id, type, entity_kind=None, entity_id=None, data=None, level="info")`,
  `bus.BROKER`. Events with `venture_id=None` are **global**: every venture's SSE stream must
  forward them (Ayan's `worldgen.progress` for the World Lab).
- `gates.request_approval(tx, *, venture_id, gate_type, title, summary, payload=None, ticket_id=None, run_id=None, requested_by_agent_id=None) -> approval_id`
  and `gates.require_approved(db_or_tx, approval_id, gate_type)` — Ayan calls these for `merge`,
  `integration`, `computer_action`.
- `ledger.record(tx, *, venture_id, kind, cost_usd, model=None, run_id=None, department_id=None, agent_id=None, units_in=0, units_out=0, estimated=True)`
  and `ledger.over_budget(db, venture_id)` — Ayan's LLM client records every call through `ledger.record`.
- `departments.REGISTRY` keys (the seed test checks it equals the spec's ticket types) and the
  `HandlerContext` protocol from `contracts.py`, implemented by your scheduler/coordination.
- `seed.seed_roster(db, settings)`, `app.create_app(settings)`, module-level `app`.
- `conversation.talk.talk(*, db, llm, settings, venture_id, agent_id, req) -> TalkResponse` and
  `conversation.concierge.ask(*, db, llm, settings, venture_id, req) -> ConciergeResponse`.
- Every route in `01-architecture/04-api-contract.md` except Ayan's (integrations, computers,
  preview, worldgen) and Karthik's (voice), with the exact response shapes in
  `web/src/shared/contracts.ts` — Mahin's world calls `/v1/world/manifest`, `/agents/{id}/talk`,
  `/concierge/ask`, `/answers/{id}`, `/standups/latest`, `/telemetry/latency`, and the SSE stream
  (`answer.checked`).

## 6. Build steps (phases from `06-execution/01-12-hour-build-plan.md`)

Commit after each step with its tests green; append `T+hh:mm step — result` to
`docs/build-logs/tanush.md`; push the branch at every checkpoint.

### Step A — Kernel core (Phase 2)
1. Review the seed `db.py`, `bus.py`, `gates.py`, `ledger.py`, `seed.py`, `app.py`; extend, don't
   rename. Add JSON column helpers, startup recovery (`in_progress` → `open`, K-10).
2. Routers (envelope `{"data": …}`, error envelope, pagination, optional bearer `KERNEL_TOKEN`);
   every `Agent` carries `runtime` (`AgentRuntime` built from `agent_capabilities.json` + `models.JOBS`),
   Pydantic response models in each `api/*.py` so they show in `/openapi.json`:
   system (`/v1/system/status`), ventures (create, list, get+stats, files upload with PDF/text
   extraction, start/pause/resume, budget), departments, agents, tickets (list/filter, get with
   runs/artifacts/approvals/children, create, retry, cancel), runs (+logs), artifacts, approvals
   (list, decision incl. clarification answers), channels (list, messages with threads, post,
   summarize), activity.
3. `stream.py`: SSE per venture with `Last-Event-ID` resume and `: ping` every 15 s (K-04);
   forward global events (`venture_id` NULL) to every venture stream.
4. `gates.py` decisions + re-entry hook; `ledger.py` spend gate when over budget (K-09);
   `redact()` on every stored text (K-11).
5. Tests: `test_db.py`, `test_api_contract.py` (one test per route you own), `test_gates.py`, `test_ledger.py`.
**Checkpoint:** the Phase 2 curl sequence in the build plan works; tests green.

### Step B — Company orchestration (Phase 3) — the Managed Agents core
1. `departments/base.py`: `ArtifactHandler` (generic `dept_artifact` job; output → artifact +
   status message + optional follow-up tickets), shared prompt loading.
2. Prompts for all agents except `eng.*`/`su.*` (`03-company-kernel/07-agent-prompts.md`).
3. Handlers: `intake.py` (brief, spec.write), `office_hours.py` (review.skeptic + clarification
   gate), `chief_of_staff.py` (plan.request → Argon `orchestrate_plan` with the skeleton fallback;
   `cos.report`; `cos.standup`; `capability.gap`), `pivot.py` (decision.review + pivot gate),
   `finance_people.py` (finance.budget, people.hire → `new_capability` gate → register agent),
   `requests.py` (agent.request: answer/delegate/decline), `chat.py` (chat.reply with citations and
   allowed actions), generic registrations for the remaining types. `research.market` uses the
   Deep Research agent; `research.competitors` and `leads.icp` call `ctx.use_computer(...)` (and
   Antigravity web research per `03-antigravity-managed-agents.md` via `ctx.llm.run_agent`) and fall
   back when unavailable (CU-05).
4. `scheduler.py`: dispatch with `SCHEDULER_CONCURRENCY`, per-ticket timeouts, retries, dependency
   resolution (`ref:<key>`), gate re-entry (K-08), startup recovery, standup timer
   (`STANDUP_MINUTES`), escalation (`ESCALATE_MINUTES`), `agent_state`, `runs` rows, automatic chat
   posts with the exact templates in `03-company-kernel/06-group-chats.md`. Every handler uses
   exactly the jobs in `agent_capabilities.json` / `10-agent-model-matrix.md` (requests →
   `agent_request`, standups → `standup_update`, Rhea's decisions → `cos_report`).
5. `coordination.py`: the real `HandlerContext` (`log`, `context_for`, `ask_agent` ≤ 3 per run,
   `request`, `post`, `use_computer` → `computers.loop.run_task`).
6. `orchestrator.py`: plan → ticket DAG across departments.
7. Tests: `test_scheduler.py::test_fake_venture_end_to_end` (K-05, gates auto-approved by a test
   helper; it exercises Ayan's fake engineering path), `-k gate_reentry`, `-k startup_recovery`,
   `test_coordination.py` (CO-02…CO-05), `-k improvement_loop` (E-09: gap → hire → gate → new agent
   appears in `GET /v1/world/manifest` npcs).
**Checkpoint:** `LLM_MODE=fake` venture completes through `cos.report` in < 2 min; then one live
venture up to `plan.request` (real Argon plan) if you have a key.

### Step C — Dashboard (Phase 4) — `04-dashboard/01-dashboard-spec.md`, `02-onboarding.md`
1. `api/client.ts` (seed works), `sse.ts` (one EventSource per venture, backoff 1→10 s, Live dot),
   `hooks.ts` (`useQuery`, SSE patching). Types from `src/shared/contracts.ts`.
2. Layout (Sidebar incl. **World Lab**, TopBar with **Enter the view ▸** → `/view?venture=<vid>`,
   SystemStrip), pages: Overview, Departments (+detail), Agents (+detail: a **"Runs on"** line from
   `agent.runtime` — e.g. *Argon high · Antigravity sandbox · GitHub · Cua* — the Talk box using `/talk`,
   a **Call** button opening `components/CallPanel.tsx` (Karthik's `startVoiceCall`, live transcript,
   source cards from `onAnswer`, End call), **Find in the world** → `/view?venture=<vid>&goto=<agent_id>`), Tickets (+graph), Runs (+live
   logs; **Antigravity runs show the interaction id, sandbox progress and result** — the managed
   agents must be visible), Approvals (all gate types incl. `computer_action` with screenshot), Chat
   (threads, kinds, ref chips, @-autocomplete, Summarize), Org (who directs whom, with the same runtime badges and a Call button per agent — the managed-agents
   evidence, C-12), Artifacts
   (+detail), **Computers** (live screenshot every 1.5 s, action log, Stop, Take over link — Ayan's
   endpoints; empty state when none), Integrations, **Metrics** (world scores headline, grounding,
   cost, latency p50/p90, engineering baseline vs loop only if results exist), Settings, Onboarding.
3. **World Lab** (`/world-lab`, `05-world/13` §4): latest run header; score curve (world, visual,
   realism per iteration; iteration 0 = single-pass baseline); per-building table; filmstrip per
   building (iterations × cameras, walkthrough videos, critic issues/keep); **live round panel**
   (building picker pre-selecting the weakest, **Improve live** → `POST …/live-rounds`, step list
   from SSE `worldgen.progress`, elapsed time, before/after slider for screenshots, side-by-side
   videos, scores before → after, **Promote**, **Open in the world**). Handle 404/409/503 with clear
   messages; never show a fabricated result.
4. Portraits: `/generated/portraits/<id>.png` with an initials fallback ring in the department color.
5. `tests/e2e/dashboard.spec.ts` (D-01…D-05) against `LLM_MODE=fake make kernel`; unit tests for
   the World Lab view models with fixture `WorldgenRun`/`LiveRound` objects.
**Checkpoint:** `pnpm typecheck && pnpm test && pnpm e2e --grep dashboard` green; live updates
without refresh; approving a gate unblocks its ticket; World Lab renders the fixtures.

### Step D — Conversation & world data (kernel side of Phase 7)
1. `conversation/context_pack.py`, `directory.py`, `talk.py`, `concierge.py` (route cards),
   `checker.py` (deterministic quote check sync; model check async → SSE `answer.checked` and
   `GET /v1/answers/{id}`) per `03-company-kernel/08-grounding-and-citations.md`,
   `05-world/07`, `05-world/08`. Agents refuse gated actions and point to the approval (C-07).
2. `api/conversation.py` (talk, concierge/ask, answers).
3. `api/world.py`: `GET /v1/world/manifest?venture=` = `world_layout.build_manifest(roster,
   registry=<web/src/world/buildings/generated/registry.json>, faces=<kernel/data/faces.json>,
   voices=<kernel/data/voices.json>, extra_agents=<venture's registered agents>)` — read files if
   present, tolerate absence. (Worldgen history and the live round are Ayan's `api/worldgen.py`.)
4. `api/org.py`: org chart, `POST /standup`, `GET /standups/latest` with lazily generated audio via
   `voice.tts.synthesize` (cache the result; `provider="browser"` → `audio_url: null`).
5. Tests: `test_checker.py`, `test_directory.py`, `test_context_pack.py`, manifest test (shape equals
   `Manifest` in `contracts.py`; 13 buildings, 52 nodes, 65 edges).

### Step E — Grounding eval, loops, metrics (Phase 9)
1. `evals/grounding_eval.py` `main(argv)` (`--only`, `--out`, `--answerer live|fake`): temp DB,
   load `evals/fixtures/grounding_state.json`, ask every item of
   `argon-app/evals/grounding/questions.yaml` through `concierge.ask` / `talk.talk`, score fact,
   citation, route, fabrication and checker agreement per `06-execution/04-evals.md` §2, write
   `argon-app/evals/results/grounding-<UTC ts>.json` + `eval_results` rows. Make the answerer
   injectable; `tests/test_grounding_eval.py` scores a fake answerer with known right/wrong answers
   (C-06, V-02).
2. `api/metrics.py`: `/v1/ventures/{vid}/metrics`, `/v1/evals/latest`, `POST /v1/telemetry/latency`
   (rolling 500 in `kv`, p50/p90).
3. Improvement loop end to end; hardening; `make test` green.

## 7. Definition of done

- Acceptance: **K-01…K-11, CO-01…CO-06, D-01…D-05, G-08, C-05…C-07 (kernel side), C-12, E-09, V-02, V-03**
  (and the dashboard side of C-10/C-11: the Call panel works with Karthik's module or falls back cleanly)
  (`06-execution/02-acceptance-criteria.md`).
- `cd kernel && uv run pytest -q` green (seed tests included); `cd web && pnpm typecheck && pnpm test` green.
- `make ownership WHO=tanush` clean. Branch pushed.
- `docs/build-logs/tanush.md` ends with a **Handoff** section: what works live vs fake only, open
  issues, contract requests, anything the merge session must do (e.g. env values you rely on).

## 8. One-shot prompt for your coding agent

> You are building lane A (Tanush) of Foundry × Argon on branch `tanush` of this repo. We enter
> Problem Statement 2 (More Dimensions) + Best use of Managed Agents. First read
> `architecture-files/README.md`, `architecture-files/00-overview/*`, `architecture-files/01-architecture/*`,
> `architecture-files/06-execution/07-team-split.md`, and `WORKORDER_TANUSH.md`, then `argon-app/AGENTS.md`.
> Follow `WORKORDER_TANUSH.md` step by step (A → E). Edit only files owned by tanush (check with
> `make ownership WHO=tanush`); never edit frozen contracts — write requests in
> `argon-app/docs/contract-requests/tanush.md`. Keep `kernel/tests/test_seed_contracts.py` and
> `web/tests/unit/seed.contracts.test.ts` green. After each step: run its tests, append to
> `argon-app/docs/build-logs/tanush.md`, commit, and push `tanush`.
