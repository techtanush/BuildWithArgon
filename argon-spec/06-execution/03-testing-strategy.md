# 03 — Testing Strategy

> **Prior art in the old repo** — `backend/factory/tests/test_control_plane_api.py` shows the per-test settings + temp DB + mock-mode + polling style to follow. What may and may not be reused: [`../reference/foundry-existing-repo-notes.md`](../reference/foundry-existing-repo-notes.md).

## Layers

| Layer | Tool | Where | Runs in |
|---|---|---|---|
| Kernel unit & API | pytest + pytest-asyncio + httpx `ASGITransport` | `kernel/tests/` | `make test` (< 60 s) |
| Kernel integration (fake mode) | pytest, `LLM_MODE=fake` | `test_scheduler.py::test_fake_venture_end_to_end` | `make test` |
| Web unit | vitest | `web/tests/unit/` | `make test` |
| Type contract | `openapi-typescript` → `tsc --noEmit` | `web/src/api/schema.d.ts` | after any API change |
| E2E | Playwright (Chromium) | `web/tests/e2e/` | `pnpm e2e` (kernel in fake mode) |
| Live smoke | `llm/smoke.py` S1–S7 | — | manual at T+0:30 and before judging |
| Evals | `foundry-eval` | `evals/` | phase 9, before judging |

## Fixtures

- `kernel/tests/conftest.py`:
  - `tmp_db` — fresh SQLite file per test with schema + seed.
  - `fake_llm` — `FakeLLM` with per-test scripted responses: `fake_llm.script("engineering_build",
    [text1, text2])` returns them in order; unscripted jobs use canned defaults from
    `tests/fixtures/fake_llm/<job>.json`.
  - `client` — `httpx.AsyncClient(transport=ASGITransport(app=create_app(settings)))`.
  - `approve_all_gates` — helper that polls approvals and approves them (used in the end-to-end test).
- Engineering tests use a tiny product template copy with a 2-test suite to keep runs < 10 s.

## Must-have unit tests (minimum list)

Kernel: schema/seed; every route (status + envelope); SSE replay; gates (`require_approved`);
ledger cost math (Argon prices, cached discount, unknown price → estimated); scheduler (deps,
concurrency caps, retry backoff, blocked on failed dep, gate re-entry, restart recovery);
fileblocks (parse/emit/truncation/unsafe paths); no-weakening detector; plan validation and
skeleton fallback; context pack selection and budget; checker deterministic stage (quote match
normalization, unknown ref, no-citation factual answer); directory search ranking (keyword
fallback); redact.

Web: A* + nearest-node + path lengths; collision (circle vs OBB, multiple passes); layout numbers
vs the plot table; checkpoint placement (min 3, max 10, last at D_i); visemes (mapping, binary
search, smoothing); kit `validateModule` rules; quality auto-downgrade logic.

## E2E (`web/tests/e2e/`)

- `dashboard.spec.ts`: onboarding → start → overview shows departments → approvals page approve →
  ticket status changes (kernel fake mode with fast scheduler tick 0.1 s).
- `world.spec.ts`: open `/view?venture=…&quality=low`; wait `window.__foundryDebug.ready`; assert
  HUD prompt appears near Nova; call `window.__foundryDebug.travel('eng.builder')`; assert
  `__foundryDebug.scene === 'interior:engineering'` and the conversation engaged; exit; repeat for
  all 13 departments' leads; assert no console errors.

`window.__foundryDebug` (dev builds only) exposes `{ ready, scene, mode, travel(agentId),
race(agentId), playerPos(), fps() }`.

## Test commands

```bash
make test                         # kernel pytest + web typecheck + vitest
cd web && pnpm e2e                # requires `LLM_MODE=fake make kernel` running
cd kernel && uv run python -m foundry_kernel.llm.smoke all
cd kernel && uv run foundry-eval engineering && uv run foundry-eval grounding
```
