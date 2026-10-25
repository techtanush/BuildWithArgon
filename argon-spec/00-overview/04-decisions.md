# 04 — Architecture Decision Records

Each decision below is final for the build unless kickoff information overrides it. The coding
agent MUST copy this list into `argon-app/docs/DECISIONS.md` at T+0 and append any new decision
there (format: ID, date, decision, why, consequence).

---

### ADR-001 — Fresh build in `argon-app/`, not an extension of the existing Foundry code

- **Decision:** Build a new, self-contained app in `argon-app/`. Do not import from `backend/`,
  `src/`, `api/`, or `public/`.
- **Why:** Eligibility of pre-existing code is unconfirmed; the existing backend is built around
  OpenAI, Port, Bright Data and SigNoz (another hackathon's sponsors) and around a third-party
  simulation engine. A fresh build is cleaner for judges and for the agent.
- **Consequence:** Concepts are reused (departments, gates, tickets, the HQ idea); a short list of
  generic helpers may be **adapted** (SQLite wrapper, error envelope, Composio OAuth calls, upload
  sanitizing, secret scanning, run recovery) if organizers allow pre-existing code. The exact
  take / ideas-only / do-not-take lists are in
  [`../reference/foundry-existing-repo-notes.md`](../reference/foundry-existing-repo-notes.md).

### ADR-002 — Kernel in Python (FastAPI); web in TypeScript (Vite + React + Three.js)

- **Why Python for the kernel:** Google's guide gives verified Python examples for the Interactions
  API, background long decode, and Antigravity managed agents (`google-genai` ≥ 2.3.0). Using the
  same language removes the biggest API-shape risk.
- **Why TS for web:** Three.js and React are the standard for browser 3D + dashboard.
- **Contract between them:** FastAPI's OpenAPI schema → `openapi-typescript` → `web/src/api/schema.d.ts`.
  The web never hand-writes response types.

### ADR-003 — SQLite (via `aiosqlite`) as the only datastore

- **Why:** Zero setup, one file, durable, fast enough for one founder. WAL mode for concurrent reads.
- **Consequence:** All writes go through `foundry_kernel/db.py` in short transactions. No ORM.

### ADR-004 — Server-Sent Events for live updates

- **Why:** One-directional push is all the web needs; SSE reconnects automatically; trivial in FastAPI
  (`StreamingResponse`, `text/event-stream`).

### ADR-005 — Vanilla Three.js engine (not React Three Fiber) inside a React shell

- **Why:** The game loop, pointer lock, input, car physics and scene swaps are simpler to control in
  plain Three.js; generated building modules target a small imperative API. React renders the
  dashboard and the HUD overlay only.

### ADR-006 — No physics engine; 2D (XZ-plane) collision against axis-aligned boxes

- **Why:** The town is flat. Walking and driving need only circle-vs-AABB collision on the ground
  plane. Removes a WASM dependency and a large risk.

### ADR-007 — Stylized procedural characters with Argon-generated face specs

- **Why:** Realistic faces next to primitive furniture look uncanny; procedural heads make lip-sync
  trivial and robust. Argon generates each agent's face *spec* (JSON); Nano Banana 2.1 generates a
  matching **portrait** for the dashboard and conversation HUD.

### ADR-008 — Voice: push-to-talk in; ElevenLabs out (with timestamps) for lip-sync

- **Input:** Hold **V** to record. Primary STT decided by smoke test S5 (Gemini transcription vs
  browser Web Speech API); see [`../02-models-and-integrations/06-speech-to-text.md`](../02-models-and-integrations/06-speech-to-text.md).
- **Output:** ElevenLabs text-to-speech *with timestamps* → audio + per-character timings → visemes.
  Fallbacks: Gemini TTS, then browser `speechSynthesis`.
- **Why push-to-talk:** Reliable in a noisy hackathon room; no VAD tuning.

### ADR-009 — Answers return text first; the checker runs in parallel with speech

- Deterministic citation checks (IDs exist, quotes match) run synchronously (<10 ms) before the
  answer is returned. The model-based support check runs asynchronously; the source card shows
  "checking…" then ✓ verified / ◐ partial / ⚠ unsupported. Unsupported answers are marked, never hidden.

### ADR-010 — The world shows no company state

- Founder's explicit requirement. Building looks and layout never change based on company data.
  Only conversation content is live.

### ADR-011 — Two engineering executors behind one interface

- `AntigravityExecutor` (primary; managed agent in a Google-hosted sandbox; Managed Agents prize) and
  `LocalLoopExecutor` (fallback and eval; Argon long-decode emits files → local sandboxed test run →
  repair loop). Selected by `ENGINEERING_EXECUTOR=antigravity|local`. Both produce the same
  `ExecutorResult`.

### ADR-012 — World generation is offline (ahead of time), validated, and has fallbacks

- `uv run foundry-worldgen` produces 13 building modules, validates them (static rules + typecheck +
  headless render probes), runs the critique loop, and commits the results. If a module fails, the
  hand-written fallback archetype for that department is used. The world always loads.

### ADR-013 — One active venture in the UI; many in the data model

- The dashboard has a venture switcher, but the world always shows the venture selected on the
  dashboard (`?venture=<id>`).

### ADR-014 — Models are configured in one file

- `foundry_kernel/models.py` maps every job to a model ID and thinking level. No other file contains
  a model ID string.

### ADR-015 — Composio for user-facing integrations (GitHub required)

- Composio brokers GitHub OAuth and GitHub tool calls (create repo, open PR, list issues, comment,
  merge). Sandbox pushes from Antigravity use a GitHub token injected via the Credentials API.
  See [`../02-models-and-integrations/04-composio.md`](../02-models-and-integrations/04-composio.md).

### ADR-016 — Cloud computers through Cua (open source), Gemini as the driver

- **Decision:** Agents that need a GUI (Leo, Ines, Ben, Yuki) get a Cua computer: a gVisor desktop
  sandbox by default (`CUA_MODE=sandbox`) or a Cua Space on the demo Mac / our Google Cloud project
  (`CUA_MODE=spaces`) when the founder should be able to watch and take over.
- **Why:** Cua provides the computer and controls (MIT SDK, Spaces with shared desktops); Gemini
  Flash decides each step and Argon re-plans, keeping the "Gemini does the thinking" story.
- **Consequence:** `computers/` module, `computer_action` gate, Computers dashboard page; full
  fallbacks when `CUA_MODE=off`.

### ADR-017 — Coordination through tickets, asks, requests and standups (not free-form chatter)

- **Decision:** Agents direct each other only through typed mechanisms — tickets (delegation),
  `agent.request` (cross-department), asks (quick cited Q&A), standups, handoff/escalation posts.
- **Why:** Keeps the company legible and every claim grounded; avoids noisy agent chatter.
- **Consequence:** `agent.request` and `cos.standup` ticket types, `HandlerContext.ask_agent/request/post`,
  threads in chat, Town Hall standup playback.
