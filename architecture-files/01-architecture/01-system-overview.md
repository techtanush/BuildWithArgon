# 01 — System Overview

## Components

```
┌──────────────────────────────── Browser (web, :5173) ────────────────────────────────┐
│  React shell                                                                          │
│  ├─ Dashboard (routes /, /departments/:id, /tickets, /approvals, /chat, /artifacts…)  │
│  └─ /view  → WorldHost (React) mounts → Engine (vanilla Three.js)                     │
│        Engine: LookKit · City · Interiors · Player · Car · Nav · NPCs · LipSync · HUD │
│        Voice: mic (push-to-talk) → STT · audio playback · viseme driver               │
└───────────────▲───────────────────────────────┬──────────────────────────────────────┘
                │ SSE /v1/ventures/{id}/stream   │ REST /v1/*  (Vite proxy → :8787)
┌───────────────┴───────────────────────────────▼──────────────────────────────────────┐
│ Kernel (FastAPI, :8787)  package foundry_kernel                                       │
│  api/        HTTP routes, SSE                                                         │
│  db.py       SQLite (aiosqlite, WAL)                                                  │
│  bus.py      events: write row + fan-out to SSE subscribers                           │
│  scheduler.py  ticket scheduler (asyncio workers, deps, retries)                      │
│  departments/  13 handlers (generic artifact handler + specialised engineering/support)│
│  orchestrator.py  Chief-of-Staff planning on Argon                                   │
│  executors/   antigravity.py · local_loop.py  (engineering)                          │
│  conversation/ context_pack.py · talk.py · concierge.py · checker.py                 │
│  voice/       stt.py · tts.py (ElevenLabs, fallbacks)                                 │
│  integrations/ composio.py · github_watch.py                                          │
│  llm/         client.py (Interactions API wrapper) · models.py · costs.py             │
│  gates.py     approvals                                                               │
│  worldgen/    generate.py · validate.py · critique.py (CLI, offline)                  │
└──────┬───────────────┬───────────────┬────────────────┬──────────────┬───────────────┘
       │               │               │                │              │
  Gemini API      Antigravity      Composio        ElevenLabs      Local subprocess
 (Interactions)  managed agent   (GitHub OAuth +   (TTS with      (pnpm/pytest in
  Argon/Flash/    sandboxes        tool calls)     timestamps)     workspace sandbox;
  Flash-Lite/                                                     Playwright capture)
  Nano Banana/
  Deep Research
```

## Processes

| Process | Command (from `argon-app/`) | Port |
|---|---|---|
| Kernel | `cd kernel && uv run uvicorn foundry_kernel.app:app --host 127.0.0.1 --port 8787 --reload` | 8787 |
| Web | `cd web && pnpm dev` | 5173 |
| World generation (offline CLI) | `cd kernel && uv run foundry-worldgen --all` | — |
| Eval harness (offline CLI) | `cd kernel && uv run foundry-eval engineering` / `grounding` | — |

A root `Makefile` provides `make dev` (both servers), `make test`, `make worldgen`, `make eval`.

## Main data flows

### A. Founder starts a venture
1. Dashboard onboarding → `POST /v1/ventures` (+ `POST /v1/ventures/{id}/files` for context) →
   `POST /v1/ventures/{id}/start`.
2. Kernel creates a `brief` ticket for `intake`. Scheduler dispatches it.
3. Intake → spec (+ possible `clarification` gate) → Chief of Staff plans a ticket DAG across
   departments → departments execute → artifacts, PRs, messages → events stream to the dashboard.

### B. Autonomous engineering (detail in [`../03-company-kernel/02-autonomous-engineering-loop.md`](../03-company-kernel/02-autonomous-engineering-loop.md))
`eng.build` ticket → executor (Antigravity or local) → code + tests in sandbox → verify → repair loop
→ PR via Composio → `qa.verify` → `merge` gate (human) → merge via Composio.

### C. Continuous upkeep
`github_watch` polls the venture repo (issues, PR comments) every 60 s via Composio → `support.issue`
tickets → triage → `eng.fix` → PR → QA → gate → merge.

### D. Talking to an agent in the world
1. Player presses **E** at an NPC → web calls `GET /v1/ventures/{id}/agents/{agent_id}` (persona,
   face, voice) and shows the conversation HUD.
2. Player holds **V**, speaks → STT → `POST /v1/ventures/{id}/agents/{agent_id}/talk {text}`.
3. Kernel builds a **context pack** for that agent (fresh from DB), calls `gemini-3.8-flash` with
   persona + context + question, gets `{answer, citations[]}`, runs deterministic checks, returns.
   Starts the async model check; result arrives as SSE `answer.checked`.
4. Web calls `POST /v1/voice/tts {agent_id, text}` → audio + alignment → plays audio, drives visemes,
   shows source cards.

### E. Concierge routing
Same as D, but `POST /v1/ventures/{id}/concierge/ask`. The Concierge has a `directory_search` tool
over agents/departments/artifacts; its response may include a `route_card`. The web renders the card
with **Race there** / **Take me there** buttons.

### F. World generation (offline)
`foundry-worldgen` → Argon generates building modules against the look-kit API → static validation →
`tsc` → Playwright capture + probes → Argon critique → patches → repeat up to N iterations → write
`web/src/world/buildings/generated/*.ts` + `kernel/data/worldgen/runs/<run_id>/` records.

## Non-functional targets

| Target | Value |
|---|---|
| Dashboard first load | < 2 s on localhost |
| Enter the view → interactive | < 6 s (High quality), < 4 s (Medium) |
| World frame rate on demo laptop | ≥ 50 fps High, ≥ 60 fps Medium |
| Talk: release V → first audio | ≤ 2.5 s p50, ≤ 4 s p90 |
| Concierge answer (text) | ≤ 2.0 s p50 |
| SSE event latency | < 300 ms from DB write to browser |
| Kernel cold start | < 3 s |

## Failure isolation

- Any external call failure is logged as an event with `level=warn|error` and surfaced on the
  dashboard's **System** strip. It never crashes the kernel.
- The world loads without the kernel (it shows "Company offline — conversations unavailable") because
  the city manifest is also bundled at build time (`web/src/world/data/manifest.fallback.json`).
