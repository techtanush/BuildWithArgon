# 13 — World Lab and the Live Round (Problem Statement 2, on stage)

> **Hackathon context — Problem Statement 2 (More Dimensions).** The full render → watch →
> critique → fix loop runs ahead of time (ADR-012) because it takes far longer than a 3-minute
> demo. The **World Lab** shows that recorded evidence, and runs **one live round on one building**
> during the demo so judges see the loop work on stage (ADR-020).

## 1. The demo beat

1. At the start of the demo, open **World Lab** in the dashboard, pick a building whose latest
   version still has an issue (the page pre-selects the building with the lowest final visual or
   realism score), press **Improve live**.
2. While it runs (target ≤ 150 s; progress streams in), show the rest: the company, the town, a
   conversation.
3. Come back: before/after screenshots and video, the critic's issues, the new scores. Press
   **Promote** — the new module replaces the old one and the world reloads it (Vite HMR in dev).
4. Show the recorded run: the score curve from iteration 0 (single pass) to the final iteration for
   all 13 buildings, with a filmstrip per building.

If the live round fails or overruns, the page shows the most recent completed live round (stored)
and says so — never fake a result.

## 2. Live round pipeline (`worldgen/live.py`, owner Ayan)

```
input: department_id, source (default: the building's current generated module), fast=true
1. capture "before": 6 screenshots + walkthrough video + probes (scripts/capture.ts --url $WEB_URL)
2. critique (job worldgen_critic; fast → thinking "medium") with screenshots + video + probes + source
3. patch (job worldgen_patch; fast → "medium"). SHOULD run as an Antigravity managed agent
   ("world architect"): the sandbox gets the module, kit/types.ts, props.contract.ts and the static
   validator, and must return a module that passes `tsc` + the static rules (it verifies its own
   output). Fallback: plain Argon call + local validation.
4. validate (static + tsc) — on failure, one repair attempt, else status failed
5. capture "after" + probes; critique "after" for scores only
6. score; store; status done. Promote is a separate, explicit action.
```

Requirements: the web dev server must be running (`WEB_URL`, default `http://localhost:5173`); one
live round at a time (409 otherwise); every step writes a timestamped record under
`kernel/data/worldgen/live/<round_id>/` and emits SSE `worldgen.progress`
(`{"round_id","department_id","step","status","score"?}`, global event: `venture_id` NULL — every
venture stream forwards global events).

## 3. API (`api/worldgen.py`, owner Ayan)

| Method | Path | Body | Response `data` |
|---|---|---|---|
| GET | `/v1/world/worldgen/latest` | — | `WorldgenRunSummary` (moved here from `api/world.py`) |
| GET | `/v1/world/worldgen/runs` | — | `{"items":[WorldgenRunSummary]}` |
| GET | `/v1/world/worldgen/runs/{run_id}` | — | `WorldgenRun` |
| GET | `/v1/world/worldgen/files/{path:path}` | — | a capture PNG / video WEBM from `kernel/data/worldgen/` (path validated, no `..`) |
| POST | `/v1/world/worldgen/live-rounds` | `{"department_id","fast"?:true}` | `LiveRound` (status `queued`); 409 if one is running; 503 if `WEB_URL` unreachable |
| GET | `/v1/world/worldgen/live-rounds` | — | `{"items":[LiveRound]}` newest first |
| GET | `/v1/world/worldgen/live-rounds/{round_id}` | — | `LiveRound` |
| POST | `/v1/world/worldgen/live-rounds/{round_id}/promote` | `{}` | `LiveRound` (`promoted: true`; writes `generated/<dept>.ts`, updates `registry.json`); 409 unless `done` |

Shapes are frozen in `kernel/foundry_kernel/contracts.py` and `web/src/shared/contracts.ts`
(`WorldgenRunSummary`, `WorldgenRun`, `WorldgenBuildingHistory`, `WorldgenIterationView`,
`CaptureSet`, `LiveRound`, `LiveRoundStep`).

## 4. World Lab page (`/world-lab`, owner Tanush)

- Header: latest run id, date, final world / visual / realism scores, generated vs fallback count.
- **Score curve:** world score, visual score and realism per iteration (iteration 0 = single-pass
  baseline), plus a per-building table (probe score, visual, realism, failed probes, status).
- **Filmstrip per building:** iteration columns × cameras (`ext-1`, `int-1` by default, expandable
  to all 6), the walkthrough video per iteration, and the critic's issues/keep list.
- **Live round panel:** building picker (pre-selects the weakest), **Improve live**, a step
  progress list fed by SSE `worldgen.progress`, elapsed time, then before/after (slider) for
  screenshots and side-by-side videos, scores before → after, issues fixed, **Promote**, and
  **Open in the world** (`/view?venture=<vid>&goto=<lead agent id>`).
- Links from the sidebar ("World Lab") and from Metrics.

## 5. What the critic watches (video)

`scripts/capture.ts` records a walkthrough per building and mode with Playwright video
(`recordVideo`, 1280 × 720) while the capture page plays a scripted camera path:
`window.__foundryProbe.playPath('ext-orbit' | 'int-walk')` (exterior: 8 s orbit at 24 m radius and
1.7–8 m height; interior: 6 s walk from the door to the room center and a slow pan). Videos are
saved next to the screenshots (`…/captures/iter-<n>/<dept>/{ext,int}.webm`) and sent to the
critic as video parts (VERIFY video input shape; fallback: 8 evenly spaced frames as images).
The critic looks for motion problems screenshots miss: flicker, z-fighting, shadow acne, popping,
objects clipping into each other, floating objects revealed by parallax, unreadable sign at an
angle.

## 6. Acceptance

G-06 (critic receives video), G-07 (live round completes ≤ 150 s with before/after and scores, or
reports a clear failure), G-08 (World Lab shows the recorded run: curve + filmstrips) — see
`06-execution/02-acceptance-criteria.md`.
