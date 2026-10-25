# 02 — Repository Layout (exact)

Create exactly this tree under `argon-app/`. Files marked *(gen)* are produced by a tool, not
hand-written. Files marked *(copy)* are copied verbatim from `architecture-files/templates/`.

```
argon-app/
├── Makefile
├── README.md                      # how to run; links to architecture-files/
├── AGENTS.md                      # (copy) templates/AGENTS.md — rules for coding agents
├── .gitignore
├── .env.example                   # (copy) templates/env.example
├── docs/
│   ├── DECISIONS.md               # ADRs from architecture-files/00-overview/04-decisions.md + new ones
│   ├── VERIFIED_API_SHAPES.md     # every VERIFY item, confirmed shape + date + source
│   ├── BUILD_LOG.md               # phase checkpoints, timings, failures, fixes
│   └── DESIGN.md                  # (copy) templates/DESIGN.md — visual rules for the world
├── data/                          # runtime data, gitignored except .gitkeep
│   ├── kernel.db
│   ├── uploads/<venture_id>/...
│   ├── workspaces/<venture_id>/<ticket_id>/...
│   ├── template-cache/            # pre-installed node_modules for product workspaces
│   ├── products/<venture_id>/main/  # local-mode "main branch" of each venture's product
│   ├── computers/<task_id>/<step>.png  # Cua computer-use screenshots (evidence)
│   └── audio-cache/<sha256>.mp3
├── evals/
│   ├── briefs/                    # (copy) templates/eval-briefs/*.yaml
│   ├── grounding/questions.yaml   # (copy) templates/grounding-questions.yaml
│   └── results/                   # committed JSON results (proof)
├── kernel/
│   ├── pyproject.toml
│   ├── foundry_kernel/
│   │   ├── __init__.py
│   │   ├── app.py                 # FastAPI app factory + lifespan + router registration
│   │   ├── config.py              # pydantic-settings Settings (reads ../.env)
│   │   ├── db.py                  # aiosqlite connection, migrations, helpers
│   │   ├── schema.sql             # full DDL (01-architecture/03-data-model.md)
│   │   ├── seed.py                # departments, agents (from data/roster.json), channels
│   │   ├── ids.py                 # new_id(prefix) -> "tkt_01J..." (ULID)
│   │   ├── errors.py              # KernelError, NotFoundError, ConflictError, DependencyError
│   │   ├── bus.py                 # emit(event) -> events row + SSE fan-out
│   │   ├── models.py              # JOB -> (model_id, thinking_level, max_output_tokens)
│   │   ├── ledger.py              # cost accounting + budget checks
│   │   ├── gates.py               # request/decide approvals; gated-action guard
│   │   ├── scheduler.py           # ticket dispatcher, workers, retries
│   │   ├── orchestrator.py        # Chief-of-Staff planning (Argon)
│   │   ├── llm/
│   │   │   ├── __init__.py
│   │   │   ├── client.py          # THE ONLY module that imports google.genai
│   │   │   ├── jsonout.py         # robust JSON extraction + schema validation
│   │   │   └── costs.py           # price table, usage extraction
│   │   ├── departments/
│   │   │   ├── __init__.py        # REGISTRY: ticket_type -> handler
│   │   │   ├── base.py            # Handler protocol, HandlerResult, ArtifactHandler
│   │   │   ├── intake.py
│   │   │   ├── office_hours.py
│   │   │   ├── engineering.py     # uses executors/
│   │   │   ├── qa.py
│   │   │   ├── support.py
│   │   │   ├── chief_of_staff.py  # plan + report + standups + improvement (capability gaps)
│   │   │   ├── finance_people.py  # budget + hire (capability) approvals
│   │   │   ├── requests.py        # agent.request handler (target department lead)
│   │   │   ├── coordination.py    # ask_agent, request, post helpers used by HandlerContext
│   │   │   └── prompts/           # one markdown system prompt per agent (03-company-kernel/07)
│   │   │       └── <agent_id>.md
│   │   ├── executors/
│   │   │   ├── __init__.py        # get_executor(settings)
│   │   │   ├── base.py            # Executor protocol, ExecutorResult
│   │   │   ├── antigravity.py
│   │   │   ├── local_loop.py
│   │   │   ├── fileblocks.py      # parse/emit <<<FILE path="...">>> blocks
│   │   │   ├── workspace.py       # create workspace from template, run commands with limits
│   │   │   └── templates/vite-react-ts/   # product scaffold (package.json, vitest, src/)
│   │   ├── conversation/
│   │   │   ├── __init__.py
│   │   │   ├── context_pack.py
│   │   │   ├── talk.py            # agent conversation
│   │   │   ├── concierge.py       # concierge + route card
│   │   │   ├── directory.py       # directory_search over agents/departments/artifacts
│   │   │   └── checker.py         # citation verification
│   │   ├── voice/
│   │   │   ├── __init__.py
│   │   │   ├── stt.py
│   │   │   └── tts.py
│   │   ├── integrations/
│   │   │   ├── __init__.py
│   │   │   ├── composio.py        # REST client (connect, status, execute tool)
│   │   │   ├── github_watch.py    # poll issues/PR comments -> tickets
│   │   │   ├── slack_mirror.py    # MAY: one-way #all-hands/#exec mirror via Composio Slack
│   │   │   └── marketing.py       # stub (later)
│   │   ├── computers/             # Cua cloud computers (02-models-and-integrations/10)
│   │   │   ├── __init__.py
│   │   │   ├── cua_client.py      # THE ONLY module importing cua
│   │   │   ├── manager.py         # one computer per (venture, agent); lifecycle
│   │   │   ├── loop.py            # computer-use loop (Flash steps, Argon re-plans)
│   │   │   ├── guard.py           # domain allowlist + action safety + computer_action gate
│   │   │   └── evidence.py        # screenshots -> data/computers/<task>/<step>.png
│   │   ├── api/
│   │   │   ├── __init__.py        # include all routers
│   │   │   ├── system.py          # /health, /v1/system/status
│   │   │   ├── ventures.py
│   │   │   ├── departments.py
│   │   │   ├── agents.py
│   │   │   ├── tickets.py
│   │   │   ├── runs.py
│   │   │   ├── artifacts.py
│   │   │   ├── approvals.py
│   │   │   ├── channels.py
│   │   │   ├── activity.py
│   │   │   ├── stream.py          # SSE
│   │   │   ├── conversation.py    # talk + concierge
│   │   │   ├── voice.py           # transcribe + tts
│   │   │   ├── world.py           # manifest, faces, portraits
│   │   │   ├── integrations.py
│   │   │   ├── metrics.py
│   │   │   ├── org.py             # org chart, standup trigger, latest standup
│   │   │   ├── computers.py       # Cua computers, tasks, screenshots
│   │   │   └── preview.py         # serve built product previews
│   │   ├── worldgen/
│   │   │   ├── __init__.py
│   │   │   ├── cli.py             # entry point `foundry-worldgen`
│   │   │   ├── kit_contract.md    # the look-kit API text given to Argon (copied from 05-world/09)
│   │   │   ├── generate.py
│   │   │   ├── validate.py
│   │   │   ├── capture.py         # runs web/scripts/capture.ts
│   │   │   ├── critique.py
│   │   │   ├── faces.py           # face specs (Argon) + portraits (Nano Banana)
│   │   │   ├── textures.py        # tileable textures + signs (Nano Banana)
│   │   │   └── score.py
│   │   └── evals/
│   │       ├── __init__.py
│   │       ├── cli.py             # entry point `foundry-eval`
│   │       ├── engineering_eval.py
│   │       └── grounding_eval.py
│   ├── data/
│   │   ├── roster.json            # (copy) templates/roster.json
│   │   ├── faces.json             # (gen) worldgen/faces.py
│   │   ├── voices.json            # agent_id -> ElevenLabs voice_id (setup step)
│   │   └── worldgen/runs/<run_id>/  # (gen) prompts, outputs, screenshots, scores
│   └── tests/
│       ├── conftest.py            # temp DB, FakeLLM, app client
│       ├── test_db.py
│       ├── test_api_contract.py
│       ├── test_scheduler.py
│       ├── test_gates.py
│       ├── test_ledger.py
│       ├── test_fileblocks.py
│       ├── test_checker.py
│       ├── test_directory.py
│       ├── test_context_pack.py
│       ├── test_coordination.py   # asks, agent.request decisions, standups, escalation
│       ├── test_computer_guard.py # allowlist, gate/block rules, loop with a fake computer
│       └── test_worldgen_validate.py
└── web/
    ├── package.json
    ├── tsconfig.json
    ├── tsconfig.worldgen.json     # typechecks kit/types.ts + buildings/staging only
    ├── vite.config.ts
    ├── index.html
    ├── playwright.config.ts
    ├── scripts/
    │   └── capture.ts             # headless capture + probes for worldgen
    ├── public/
    │   └── generated/
    │       ├── portraits/<agent_id>.png   # (gen) Nano Banana
    │       ├── textures/<name>.png        # (gen) Nano Banana, tileable
    │       └── signs/<dept_id>.png        # (gen) Nano Banana
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx                # router: dashboard routes + /view
    │   ├── styles/
    │   │   ├── tokens.css
    │   │   └── app.css
    │   ├── api/
    │   │   ├── schema.d.ts        # (gen) openapi-typescript from http://127.0.0.1:8787/openapi.json
    │   │   ├── client.ts          # typed fetch wrapper
    │   │   ├── sse.ts             # EventSource wrapper with typed events
    │   │   └── hooks.ts           # useVenture, useTickets, ... (SWR-style, simple)
    │   ├── dashboard/
    │   │   ├── components/        # Layout, Sidebar, TopBar, SystemStrip, StatusPill, TicketCard,
    │   │   │                      # GateCard, MessageList, Portrait, EnterViewButton, EmptyState
    │   │   └── pages/             # Overview, Departments, DepartmentDetail, Agents, AgentDetail,
    │   │                          # Tickets, TicketDetail, Runs, RunDetail, Approvals, Chat,
    │   │                          # Artifacts, ArtifactDetail, Computers, ComputerTask, Org,
    │   │                          # Integrations, Metrics, Settings, Onboarding
    │   └── world/
    │       ├── WorldHost.tsx      # React component: mounts Engine + Hud
    │       ├── engine/            # Engine.ts, Loop.ts, Input.ts, Quality.ts, SceneManager.ts, Audio.ts
    │       ├── kit/               # LookKit.ts, materials.ts, primitives.ts, lights.ts, post.ts,
    │       │                      # textures.ts, types.ts (KitApi), validateModule.ts
    │       ├── city/              # City.ts, layout.ts, roads.ts, props.ts, signage.ts, plaza.ts
    │       ├── interiors/         # Interior.ts, loader.ts
    │       ├── buildings/
    │       │   ├── index.ts       # registry: generated module if valid, else fallback
    │       │   ├── fallback/archetypes.ts   # 13 hand-written fallback builders
    │       │   └── generated/     # (gen) <dept_id>.ts ×13 + index.ts
    │       ├── player/            # Player.ts, Collision.ts
    │       ├── vehicle/           # Car.ts, ChaseCamera.ts
    │       ├── nav/               # RoadGraph.ts, astar.ts, Gps.ts, Race.ts, FastTravel.ts
    │       ├── npc/               # Character.ts, FaceSpec.ts, NpcManager.ts, LipSync.ts,
    │       │                      # visemes.ts, LookAt.ts
    │       ├── conversation/      # ConversationController.ts, Mic.ts, Stt.ts, Speech.ts
    │       ├── probes/probes.ts   # probe computations used by the capture page
    │       ├── capture/CapturePage.tsx  # dev-only /view/capture (worldgen renders + probes)
    │       ├── data/manifest.fallback.json  # (gen) copy of GET /v1/world/manifest
    │       └── hud/               # Hud.tsx, Crosshair, InteractPrompt, ConversationPanel,
    │                              # SourceCard, RouteCard, MapOverlay, RaceHud, Fade,
    │                              # PauseMenu, QualityToggle, Toasts
    └── tests/
        ├── unit/                  # vitest: astar, collision, visemes, layout, race, kit validator
        └── e2e/                   # playwright: dashboard.spec.ts, world.spec.ts
```

## Dependencies

### Kernel (`kernel/pyproject.toml`)

```toml
[project]
name = "foundry-kernel"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.32",
  "pydantic>=2.9",
  "pydantic-settings>=2.6",
  "aiosqlite>=0.20",
  "httpx>=0.27",
  "google-genai>=2.3.0",       # Interactions API + Antigravity per Google's guide
  "python-multipart>=0.0.12",  # uploads
  "python-ulid>=3.0",
  "pyyaml>=6.0",
  "sse-starlette>=2.1",
  "pypdf>=5.0",                # text from uploaded PDFs
  "pillow>=11.0",              # image checks/conversion in worldgen
]

[project.optional-dependencies]
dev = ["pytest>=8.3", "pytest-asyncio>=0.24", "ruff>=0.7", "mypy>=1.13"]
computers = ["cua"]            # Cua SDK (README: `pip install cua`); install with `uv sync --extra computers`

[project.scripts]
foundry-worldgen = "foundry_kernel.worldgen.cli:main"
foundry-eval = "foundry_kernel.evals.cli:main"

[tool.pytest.ini_options]
asyncio_mode = "auto"
```

Use **uv**: `uv sync --extra dev`. Run everything with `uv run ...`.

### Web (`web/package.json`)

```json
{
  "name": "foundry-argon-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 5173",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "e2e": "playwright test",
    "gen:api": "openapi-typescript http://127.0.0.1:8787/openapi.json -o src/api/schema.d.ts",
    "capture": "tsx scripts/capture.ts"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.0",
    "three": "LATEST_AT_T0"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@types/three": "LATEST_AT_T0",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.7.2",
    "vite": "^6.0.7",
    "vitest": "^2.1.8",
    "@playwright/test": "^1.48.0",
    "openapi-typescript": "^7.4.0",
    "tsx": "^4.19.0"
  }
}
```

`LATEST_AT_T0`: run `pnpm add three @types/three -D` (types as dev) at T+0 and **pin the exact
resolved version** (no caret). Record it in `docs/DECISIONS.md`. All Three.js add-ons are imported
from `three/examples/jsm/...` (see [`../05-world/02-look-kit.md`](../05-world/02-look-kit.md)).

### Vite proxy (`web/vite.config.ts`)

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/v1': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/health': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/preview': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/media': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 4000 },
});
```

## Makefile

```make
.PHONY: dev kernel web test typecheck worldgen eval api-types seed

kernel:
	cd kernel && uv run uvicorn foundry_kernel.app:app --host 127.0.0.1 --port 8787 --reload

web:
	cd web && pnpm dev

dev:
	$(MAKE) -j2 kernel web

seed:
	cd kernel && uv run python -m foundry_kernel.seed

api-types:
	cd web && pnpm gen:api

test:
	cd kernel && uv run pytest -q
	cd web && pnpm typecheck && pnpm test

worldgen:
	cd kernel && uv run foundry-worldgen --all

eval:
	cd kernel && uv run foundry-eval engineering && uv run foundry-eval grounding
```

## .gitignore (argon-app)

```
data/*
!data/.gitkeep
.env
**/node_modules
web/dist
kernel/.venv
**/__pycache__
test-results/
playwright-report/
```

## Seed additions (team build)

The frozen-contract seed on `main` adds a few files that are not in the tree above, so the three
branches can share contracts from hour zero (see [`../06-execution/07-team-split.md`](../06-execution/07-team-split.md)):

| File | Purpose |
|---|---|
| `kernel/foundry_kernel/contracts.py` | All cross-module protocols and records (LLM client, handler context, handler result, executor, conversation, voice, manifest, FaceSpec, computers) |
| `kernel/foundry_kernel/security.py` | `redact()` |
| `kernel/foundry_kernel/world_layout.py` | Deterministic city layout + manifest builder used by `api/world.py` and `make manifest` |
| `kernel/foundry_kernel/llm/fake.py`, `kernel/tests/fakes.py` | `FakeLLM` (fixture-driven) and `FakeHandlerContext` |
| `kernel/foundry_kernel/migrations/` | Per-person migrations on top of `schema.sql` |
| `web/src/shared/contracts.ts` | TypeScript mirror of the API objects, manifest and SSE events |
| `web/src/shared/worldApi.ts` | The world's only kernel client, with a `?mock=1` fixture mode |
| `web/src/world/probes/types.ts` | Capture page ↔ capture script handshake |
| `web/src/world/buildings/example/house.example.ts` | Reference building module |
| `web/src/world/data/mock/*.json` | Fixtures for mock mode |
| `web/src/world/kit/props.contract.ts` | Frozen footprint of every `PropKind` |
| `web/src/world/assets/manifest.contract.ts` | Frozen asset-manifest types (photoreal assets) |
| `web/assets-pipeline/` (+ `web/public/assets/manifest.json`) | Asset pipeline (fetch/build CC0 assets) and its committed manifest; binaries gitignored |
| `kernel/foundry_kernel/api/worldgen.py`, `worldgen/live.py` | World Lab API and the live one-building round |
| `web/src/world/npc/{visemes,LipSync}.ts`, `web/src/world/conversation/{Mic,Stt,Speech}.ts` | Voice modules (Karthik) |
| `scripts/check_ownership.py`, `docs/{build-logs,decisions,verified,contract-requests}/<name>.md` | Ownership check and per-person logs |
