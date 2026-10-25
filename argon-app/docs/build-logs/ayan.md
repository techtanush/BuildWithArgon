# Build log — ayan

Format: `T+hh:mm <step> — what works, what doesn't`. T+0 = 2026-10-25 10:59 PDT (branch checked out). Work done the day
before the event with the team Gemini key; live = real API calls.

- T+00:40 setup — kernel `uv sync --extra dev` + seed tests 11/11; web `pnpm install` (slow network: needed
  `--fetch-timeout=900000`); seed web tests 7/7. pnpm 11 writes an unowned `web/pnpm-workspace.yaml` on install —
  deleted, not committed.
- T+00:55 Step A.1 — `llm/client.py` rewritten against google-genai 2.33.0 (types read from the installed SDK):
  `system_instruction`, async `client.aio.interactions`, multimodal parts incl. **video**, background long decode +
  polling + cancel on timeout, retries (2/4/8/16 s ±20%, 429/5xx only), ledger + run token/cost columns + run_logs +
  `kv['provider.gemini.*']`, redaction, `run_agent`, `generate_images` (Nano Banana, aspect ratio), audio output.
- T+01:05 Step A.2 — smoke tests live: S1 S2 S4 S5 S6 S7 + video **PASS** (table in `docs/verified/ayan.md`).
  Video input confirmed (critic can watch webm walkthroughs). Audio input confirmed (`STT_PRIMARY=gemini` viable).
  Antigravity confirmed (`ENGINEERING_EXECUTOR=antigravity`). S3: background mode works, but Argon itself refuses
  synthetic 70k-token lists ("exceeds my output capacity") — the real long decode is proven by the one-pass world
  generation below (75,050 output tokens in one background call).
- T+01:10 Steps D, E (parallel) — engineering loop (executors, fileblocks, workspace, local loop with no-weakening rule,
  Antigravity executor, QA, preview, eval), Composio + github_watch + support loop + integrations API, Cua computers +
  guard + loop + computers API. All fake-mode/unit tested; fake-mode engineering DAG unchanged (seed test green).
- T+01:30 Step A.4 — `foundry-worldgen faces` live: 29/29 FaceSpecs from one Argon call, 0 fallbacks, 0 variety
  warnings → `kernel/data/faces.json`. `foundry-worldgen signs` live: 13/13 realistic Nano Banana signs, each read back
  correctly by Flash → `web/public/generated/signs/`.
- T+01:20 Step B — worldgen pipeline: prompts built from the frozen sources (kit types, props contract, DESIGN.md,
  building rules, photoreal bar) + the founder's art direction; generate, validate (static + tsc), capture.ts
  (screenshots, `recordVideo` walkthroughs, 8 fallback frames, P9, merged BuildingProbeReport), critique (video parts,
  frame fallback), patch (`previous_interaction_id`, one repair), score/selection, generated index/registry, report.
  `capture.ts` verified against `scripts/fixtures/fake-capture.html` (6 PNG + 2 webm + 16 frames per building).
- T+01:50 Step B.5 — `foundry-worldgen buildings` live: **13/13 modules in one long-decode pass, 13/13 pass static
  rules + tsc, 0 regenerated** (84k in / 75k out tokens, 11.7 min, $0.92) → `kernel/data/worldgen/runs/wgr_01M5T6VWB2SFMJSPB1KCK8CGYY/`
  (G-01, G-05). Found live: background calls reject image input → the reference images go in as a text brief.
- T+02:00 Step B checkpoint — full loop in fake LLM mode via the CLI with the real capture script and the fake page:
  one-pass → validate → capture → critique → registry → report, 2 min 45 s for 3 buildings. Fake outputs removed
  afterwards (never committed).
- T+02:05 Step C — `worldgen/live.py` (one round at a time, 409/503, timestamped records, SSE, Antigravity
  "world architect" patch with time budget + Argon fallback, validate + one repair, promote) and `api/worldgen.py`
  (latest, runs, run detail, files with path validation, live rounds, promote). State machine, failure path,
  concurrency, orphaned-round recovery and API tested with a fake capture + FakeLLM.
- T+02:30 Engineering eval (live, 1 of 5 briefs: split-bill): baseline **7/7 hidden tests** (one Argon pass, 49 s,
  $0.05); loop **7/7 hidden tests**, builder's own tests passed on iteration 1 (92 s, $0.08) →
  `evals/results/engineering-20261025T1912Z.json`. Real LocalLoopExecutor path end to end (Argon long decode → FILE
  blocks → npm test/build → hidden tests). This is not the full V-01 (5 briefs; optional P2).

## Handoff

**Smoke results (live, 2026-10-25):** S1 S2 S4 S5 S6 S7 PASS, video input PASS; S3 — see above (long decode proven by
the 75k-token world generation). Details and verified shapes: `docs/verified/ayan.md`.

**Chosen executor:** `ENGINEERING_EXECUTOR=antigravity` (S6 PASS). Needs `GITHUB_SANDBOX_TOKEN` for sandbox pushes and
a connected GitHub (Composio) venture repo; otherwise tickets run on the local executor automatically.

**Audio input:** works (`gemini-3.5-transcribe`) → Karthik may set `STT_PRIMARY=gemini`.

**What ran live:** all smoke tests above; faces (29); signs (13); one-pass buildings (13/13 valid); engineering eval
split-bill (baseline 7/7 and loop 7/7 hidden tests; `evals/results/engineering-20261025T1912Z.json`).

**Generated outputs committed:** `kernel/data/faces.json`, `web/public/generated/signs/*.png`,
`kernel/data/worldgen/runs/wgr_01M5T6VWB2SFMJSPB1KCK8CGYY/` (prompt, raw output, 13 iteration-0 modules,
validation), `kernel/data/worldgen/assets/` (reference PNG, reference brief, sign + face logs).

**Not run yet (needs Mahin's capture page — the seed page answers `error: "not implemented"`):** the render loop with
real renders (G-02, G-03), portraits from renders, the fallback capture (G-04), a real live round (G-07 timing).
Run in the merge session (or against Mahin's branch in a worktree):
```bash
cd argon-app && make dev                                   # web :5173 must serve /view/capture
cd kernel && uv run foundry-worldgen loop --max-iter 4 --url http://localhost:5173   # continues wgr_01M5T6VW…
uv run foundry-worldgen portraits --from-renders --url http://localhost:5173 [--polish]
uv run foundry-worldgen fallbacks --url http://localhost:5173
uv run foundry-worldgen report                             # -> evals/results/world-<ts>.json
# then World Lab -> Improve live (POST /v1/world/worldgen/live-rounds) ×2 and Promote
```
Live-round timing: not measured with real renders yet; the patch step budgets 150 s (Antigravity world architect only
if ≥ 45 s remain after reserving 70 s for validate + re-capture + scoring).

**Open issues:** Composio and Cua are unverified (no `COMPOSIO_API_KEY`, Cua not installed); the CLI's
`worldgen.progress` events reach the DB but not a running kernel's SSE broker (CR-A2); `pnpm capture` can stall on
pnpm's dependency check on slow networks — the Python side calls `node_modules/.bin/tsx` directly; the first
`playwright install --only-shell chromium` is required on a fresh machine.

**Contract requests:** `docs/contract-requests/ayan.md` (CR-A1 `Part.kind` video; CR-A2 global SSE from the CLI;
CR-A3 connect response; CR-A4 gated computer actions; CR-A5 capture-page conventions + art direction for the plaza;
CR-A6 spec inconsistencies).

**Env values to set at merge (`argon-app/.env`):**
```
LLM_MODE=live
GEMINI_API_KEY=<team key>
ENGINEERING_EXECUTOR=antigravity
GITHUB_SANDBOX_TOKEN=<fine-grained PAT: Contents RW, Pull requests RW, Metadata R>   # optional; else local executor
COMPOSIO_API_KEY=<key>                                                              # optional; else no-GitHub mode
CUA_MODE=off            # set sandbox/spaces only after installing Cua (`uv sync --extra computers` + Cua CLI)
STT_PRIMARY=gemini      # Karthik's call; audio input verified
WEB_URL=http://localhost:5173
```
Also once per machine: `cd web && pnpm exec playwright install --only-shell chromium` and
`cd kernel && uv run python -m foundry_kernel.executors.workspace prepare-cache`.

**Dependencies added:** none new; the `computers` extra in `kernel/pyproject.toml` is pinned to the matching pair
`cua==0.5.0` + `cua-sandbox==0.9.1` (newer `cua` 0.9.0 changed `embedded()` and breaks `cua_sandbox`).

**Cua status (2026-10-25):** CLI + Lume installed; with the pinned pair the SDK reaches the local runtime, but the
one-time built-in Linux runtime download (`~/.cua/runtimes/linux`) failed twice on this network ("error decoding
response body" at 364 MB and 477 MB). No sandbox has booted yet → `CUA_MODE=off`. On a faster network:
`uv sync --extra dev --extra computers`, then the sandbox smoke in `docs/verified/ayan.md` §Cua, then
`CUA_MODE=sandbox`.
