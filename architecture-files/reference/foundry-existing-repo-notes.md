# Reuse Guide: The Existing Foundry Repository

This spec lives inside `aybordia/foundry`, which was built for an earlier hackathon (the **Zero
Downtime Hackathon**, sponsors Port, Bright Data, SigNoz; models from OpenAI). The Argon build is
**fresh code in `argon-app/`** (ADR-001). This guide tells coding agents exactly what they may take
from the old code, how, and what they must not take.

## Ground rules

1. **Read, don't import.** Nothing in `argon-app/` may import from `backend/`, `src/`, `api/`,
   `public/` or `archive/`. Every reused idea is re-typed or adapted into the new structure, with
   the new names, IDs and contracts from this spec.
2. **Small, generic patterns only.** Take infrastructure patterns (SQLite wrapper, error envelope,
   upload sanitizing, secret scanning, Composio OAuth calls), never product logic tied to the old
   sponsors or the old data model.
3. **Spec wins.** Where old code and this spec disagree (names, endpoints, tables, ports, auth), follow
   the spec.
4. **Eligibility first.** At kickoff ask the organizers whether code written before the event may be
   reused. If **not**, treat everything below as "reference reading only" and write fresh code. If
   **yes**, adapting the "Take" items is allowed. Record the answer in `docs/DECISIONS.md`.
5. **Never copy secrets, URLs or account-specific values** (e.g. the old Vercel bridge host, old
   tokens, old default model names).
6. When you reuse something, add a one-line comment at the top of the new file:
   `# Adapted from foundry (Zero Downtime build): <old path> — see architecture-files/reference/foundry-existing-repo-notes.md`.

## TAKE — adapt these (with the changes listed)

| Old path | What to take | Adapt like this | Goes to (new) |
|---|---|---|---|
| `backend/factory/src/foundry_factory/database.py` | `Database` class: aiosqlite connect, `PRAGMA foreign_keys/busy_timeout/journal_mode=WAL/synchronous=NORMAL`, migration runner with `schema_migrations`, `transaction()` with `BEGIN IMMEDIATE`, `fetch_one/fetch_all/execute`, `ping()` | Use our single `schema.sql` (or one migration file `0001_initial.sql` from [`../01-architecture/03-data-model.md`](../01-architecture/03-data-model.md)); add the post-commit event publish hook from the bus doc | `kernel/foundry_kernel/db.py` |
| `backend/factory/src/foundry_factory/errors.py` | `FactoryError(status_code, code, message, details)`, `NotFoundError`, `ConflictError`, `DependencyError(503/502)` | Rename to `KernelError`; keep the codes; used by the API error envelope | `kernel/foundry_kernel/errors.py` (add to layout) |
| `backend/factory/src/foundry_factory/app.py` (parts) | The `FactoryError` exception handler returning `{"ok": false, "error": {...}}`; the request-size-limit middleware; bearer check with `hmac.compare_digest`; production guard against wildcard CORS | Our envelope is `{"error": {...}}` / `{"data": ...}` (no `ok`); one optional `KERNEL_TOKEN`; bind to `127.0.0.1` (the old default `0.0.0.0` is **not** taken) | `kernel/foundry_kernel/app.py` |
| `backend/factory/src/foundry_factory/config.py` | `pydantic-settings` `BaseSettings` with `SecretStr` for keys, `extra="ignore"`, `.env` loading | New variable names from [`../02-models-and-integrations/09-env-and-keys.md`](../02-models-and-integrations/09-env-and-keys.md); drop every OpenAI/Port/SigNoz/Bright Data field | `kernel/foundry_kernel/config.py` |
| `backend/factory/src/foundry_factory/orchestrator.py` | `RunManager` pattern: `asyncio.Semaphore` for concurrency, task registry with `add_done_callback` cleanup, cancel/shutdown that awaits tasks, error-to-failed-run handling | Becomes the dispatch/execute part of our scheduler; our tickets/deps/retries/gates logic is new | `kernel/foundry_kernel/scheduler.py` |
| `backend/factory/src/foundry_factory/store.py` → `recover_interrupted_runs` | Startup recovery: mark `running` runs failed with "service restarted…", emit an event, refresh agent statuses | Also reset `in_progress` tickets to `open` (spec §Startup recovery) | `scheduler.py` startup |
| `backend/factory/src/foundry_factory/composio_integration.py` and `api/composio/github.ts` | The working Composio REST calls: `GET v3.1/auth_configs?toolkit_slug=github&is_composio_managed=true`, `POST v3/auth_configs` (managed auth), `POST v3/connected_accounts/link`, `GET v3.1/connected_accounts?toolkit_slugs=github&user_ids=…`; error mapping (401/403/429); https check on the redirect URL | Our user id is `foundry:<venture_id>`; connect is behind the `integration` gate; tool execution is new (VERIFY) | `kernel/foundry_kernel/integrations/composio.py` |
| `backend/factory/src/foundry_factory/composio_publisher.py` | Safety lists: `_SECRET_CONTENT` regex (private keys, `sk-`, `github_pat_`, `gh*_`, `xox*`), `_BLOCKED_FILENAMES` (`.env`, `.npmrc`, `id_rsa`, `credentials.json`…), `_BLOCKED_SUFFIXES` (`.key`, `.pem`, `.p12`, `.pfx`), `_EXCLUDED_DIRECTORIES` (`.git`, `node_modules`, `.venv`…), size limits per file/total, repo-name and branch-name regexes | Use in `fileblocks.py` path validation, before publishing files to GitHub, and in `redact()` (add Google `AIza…` and ElevenLabs patterns) | `executors/fileblocks.py`, `integrations/composio.py`, `security` helpers |
| `backend/factory/src/foundry_factory/capabilities.py` | `GeneratedAgent` Pydantic model (name, description, instructions, capabilities, tools with length limits), `SAFE_AGENT_TOOLS` allowlist, deterministic mock agent in mock mode | Our agent design JSON has more fields (persona, greeting, voice_hint, model_job, smoke_test); generation runs on Argon, not the OpenAI Agents SDK | `departments/chief_of_staff.py` (improvement) |
| `backend/factory/src/foundry_factory/demo.py` → `upload()` | Upload sanitizing: allowed suffix set, `Path(name).name`, `re.sub(r"[^A-Za-z0-9._-]+", "-", name)[:120]`, read with a +1 byte size cap, text excerpt with `errors="ignore"`, max 8 files | Our limits: 8 files, 15 MB, `.md .txt .pdf .csv .json`; PDF text via `pypdf` | `api/ventures.py` (`/files`) |
| `backend/factory/tests/test_control_plane_api.py` | Test style: `Settings(...)` built per test with `tmp_path` DB, mock AI mode, `TestClient`, polling helper that waits for a run status | Use `httpx.AsyncClient(ASGITransport)` + `LLM_MODE=fake`; same polling idea for scheduler tests | `kernel/tests/conftest.py` |
| `src/components/Landing.tsx` → `OPERATING_DEPARTMENTS` | The 13 department names and their D01–D13 order (matches our roster) | Names/IDs now come from `roster.json`; do not copy the component | `templates/roster.json` (already aligned) |
| `src/components/Onboarding.tsx` | Onboarding UX: step list, drag-and-drop file queue with per-file status (`queued/uploading/uploaded/error`), size/type limits, GitHub connect step returning from an OAuth redirect | Our steps: You · Idea · Context · Connect & launch; our API; light theme | `web/src/dashboard/pages/Onboarding.tsx` |
| `src/components/GatesPanel.tsx` | Decision-card UX: pending first, "History" toggle, per-gate help text, approve/reject with a note, toast on decision | Our gate types and payload renderers ([`../03-company-kernel/05-approval-gates.md`](../03-company-kernel/05-approval-gates.md)) | `web/src/dashboard/pages/Approvals.tsx`, `GateCard.tsx` |
| `src/components/IntegrationsPanel.tsx` (`GitHubConnectCard`) | Connect-card states (not connected → redirecting → connected), returning-from-OAuth handling | Through our kernel API (no Vercel bridge) and the integration gate | `web/src/dashboard/pages/Integrations.tsx` |
| `src/store.tsx` | SSE pattern: replay-from-last-seen then live, dedupe by sequence number, capped event buffer, reconnect | Use `EventSource` with `Last-Event-ID` (our kernel replays from `events.id`); no token in query strings | `web/src/api/sse.ts` |
| `src/theme.css` | Only the accent `#E66A2C` (already our `--accent`) and the JetBrains Mono choice | The old dark "Void/Paper" theme is **not** taken — our dashboard is light (see dashboard spec) | `web/src/styles/tokens.css` |
| `.gitignore` (root) | The secrets block (`.env*`, `*.pem`, `*.key`, `credentials.json`, `service-account*.json`, `secrets/`) | Merge into `argon-app/.gitignore` | `argon-app/.gitignore` |

## TAKE AS IDEAS ONLY (read for inspiration; write new code)

| Old path | Idea worth keeping | Where it shows up in this spec |
|---|---|---|
| `archive/foundry-concept/03_DEPARTMENTS_AND_AGENTS.md` | Agent definitions as Role / Input / Output / Guardrails; the skeptic must propose a concrete interpretation for each ambiguity; generation counter on re-entered briefs | Agent prompts, Office Hours, pivot revisions |
| `archive/foundry-concept/04_SIGNATURE_LOOPS.md` | The three loops: ops → intake, improvement (hire the missing agent and resume the blocked ticket), validation → revision brief | Improvement & ops loops, Pivot gate |
| `archive/foundry-concept/05_PORT_INTEGRATION.md` §Command Center | "One screen for every approval" | Approvals page |
| `backend/factory/src/foundry_factory/demo.py` → `command_center_activity` | One activity model shared by polling and SSE | Activity feed + SSE |
| `src/hq/departments.ts`, `src/hq/scene.ts` | Rooms grouped by department; the HQ as a place you visit | Replaced by the 3D town (concept only) |
| `src/components/BriefingRoom.tsx`, `MeetingsPanel.tsx` | Executive briefings / meetings | Standups + Town Hall playback |
| `src/components/TimelinePanel.tsx` | Human-readable event feed | Overview activity feed |
| `01-platform/04-resilience-zero-downtime.md` | Degrade, never die; every dependency has a fallback | Risk register & fallbacks |

## DO NOT TAKE (and why)

| Old path | Why not |
|---|---|
| `backend/crates/` (Rust "Simit" engine: `sim-core`, `sim-maps`, binaries) | Imported from **Sim Francisco**, another team's prize-winning project; unrelated to this build; eligibility risk. Do not depend on it, call its API, or copy its code. |
| `backend/frontend/`, `public/simit/`, `src/marketResearch.ts`, `src/components/LiveSimulation.tsx` | Sim Francisco's UI / calls to its public API |
| `backend/port/`, `backend/factory/src/foundry_factory/port_mirror.py`, `backend/scripts/validate_port_contract.py` | Port was the old sponsor's orchestration surface; our kernel + dashboard replace it |
| `backend/.brightdata/`, `backend/factory/src/foundry_factory/brightdata.py`, `backend/CLAUDE.md` scraper rules | Bright Data was the old sponsor's data layer; we use Deep Research, Antigravity web and Cua |
| `backend/signoz/`, `telemetry.py`, OTel wiring | SigNoz was the old sponsor's observability; we use kernel events + Metrics page |
| `backend/factory/src/foundry_factory/runtime.py`, `sandbox.py`, any `openai` / `agents` SDK usage, `demo.py` → `_generate_bundle` | Built on OpenAI; this build runs on Gemini (Argon + family) |
| `backend/factory/src/foundry_factory/store.py` (as a whole), `schemas.py`, `migrations/*.sql` | Different data model (Port projections, workflows, scraped events); our schema is new — only the specific helpers listed in TAKE |
| `backend/factory/src/foundry_factory/actions.py`, `simit.py`, `/prediction/*`, `/scraper/*` routes | Prediction-factory product logic for the old hackathon |
| `src/api.ts` defaults (`VITE_KERNEL_SHARED_TOKEN`, `'dev-only-token'`, token in `localStorage`, hard-coded Vercel bridge `foundry-ui-pink.vercel.app`) | Puts a secret in the browser / points at someone's deployment; our rule is no secrets in the browser |
| `src/components/WalletsPanel.tsx`, Linq / Terac / Solari references in `GatesPanel.tsx` and `IntegrationsPanel.tsx` | Services not used in this build |
| `src/theme.css` dark theme, `hq/scene.ts` 2D pixel renderer, `public/assets/` sprites | Different visual direction (light dashboard, 3D world in the reference look) |
| `00-vision/`, `01-platform/`, `02-integrations/`, `03-execution/`, `BUILD_PLAN.md`, `WORK_SPLIT.md`, `WORKORDER_*.md` | Plans for the old hackathon; reading them can mislead an agent about scope — this spec replaces them |
| `backend/data/`, `*.db`, `*.csv`, `tiles.db`, `server_tiles/` | Large data for the old engine; not needed |
| `backend/session-log.md` | A pasted transcript from another session; not a spec |

## Quick answers for coding agents

- "Can I reuse the old FastAPI app and add Gemini?" — **No.** Start fresh per the spec; adapt only
  the TAKE helpers.
- "The old repo already has departments and gates — can I extend that?" — **No.** Same concepts,
  new code and new contracts.
- "Can I call Sim Francisco for the synthetic panel?" — **No.** Synthetic Population runs its own
  Flash persona panel.
- "Can I copy the Composio OAuth calls?" — **Yes** (adapt, see TAKE), if the organizers allow
  pre-existing code; otherwise re-type them from this guide's description.
