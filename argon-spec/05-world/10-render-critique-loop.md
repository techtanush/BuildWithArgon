# 10 — Render → Watch → Critique → Fix Loop

> **Hackathon context — Problem Statement 2 (More Dimensions).** The organizers' brief: "A single
> pass is only the first draft. Build a system that renders what it made, watches the result,
> critiques it against the goal, and fixes it in a loop." This document is that system; iteration 0
> is the single-pass baseline and the score curve is the evidence.

This is the **More Dimensions** problem statement implemented literally: Argon's first draft of
the town is rendered, measured, looked at, critiqued against the goal, and fixed — in a loop, with
a score recorded at every iteration.

```
iteration 0: one-pass generation of 13 modules (09-worldgen-pipeline.md)
for iteration n = 0..MAX (default 4):
   1. stage modules → static validation → tsc
   2. capture: headless browser renders each building (6 cameras) + runs probes
   3. score: probe score (deterministic) per building
   4. critique: Argon looks at the 6 screenshots + probe report + source vs DESIGN.md/reference
   5. keep best version per building so far
   6. if all buildings: probe score = 1.0 and visual score ≥ 0.75 → stop
   7. patch: Argon rewrites each building that still has failures or high-severity issues
final: write the best version of each building; registry; scores.json
```

## 1. Capture page (`web/src/world/capture/CapturePage.tsx`, dev-only route `/view/capture`)

URL: `/view/capture?building=<dept>&mode=exterior|interior&source=staging|generated|fallback`.

- Renders the single building on a 60 × 60 grass plane (exterior) or the interior shell + module
  (interior), with the standard lighting preset and **High** quality, fixed time (no animation),
  no HUD.
- Cameras (exterior, building local coords): `ext-1` front at (0, 1.7, 30) looking at (0, 5, 0);
  `ext-2` front-left 3/4 at (−24, 8, 24) → (0, 4, 0); `ext-3` aerial at (18, 34, 18) → (0, 0, 0).
  Interior: `int-1` from the door (0, 1.65, 6.0) → (0, 1.4, −7); `int-2` corner (7.5, 3.6, 5.5) →
  (−3, 0.5, −3); `int-3` top-down (0, 12, 0.01) → (0, 0, 0) with the ceiling hidden.
- Exposes `window.__foundryProbe = { ready: boolean, error?: string, result?: ProbeResult,
  setCamera(name: string): Promise<void> }`.

## 2. Capture script (`web/scripts/capture.ts`, run via `pnpm capture`)

```
pnpm capture --run <run_id> --iter <n> --source staging [--only engineering,pivot]
```

1. Start `vite` in preview-of-dev mode on port 5199 (`vite --port 5199 --strictPort`) unless
   `--url` is given.
2. Launch Chromium with Playwright: `chromium.launch({ args: ['--use-gl=angle',
   '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })` (software GL works headless; if a
   GPU is available on the machine, omit these flags). Viewport 1280 × 720, deviceScaleFactor 1.
3. For each building × mode: open the URL, wait for `__foundryProbe.ready` (timeout 60 s), collect
   console errors, for each camera call `setCamera` then `page.screenshot` into
   `kernel/data/worldgen/runs/<run>/captures/iter-<n>/<dept>/<cam>.png`, and write the probe JSON.
4. Exit non-zero only on infrastructure failure (browser didn't start); building failures are data.

`worldgen/capture.py` invokes this script with `subprocess.run([...], cwd=web_dir, timeout=1800)`.

## 3. Probes (computed in-page from the kit's recorded build — deterministic)

| ID | Probe | Pass condition |
|---|---|---|
| P1 | `loads` | Module ran without exception; 0 console errors |
| P2 | `bounds` | All meshes inside `k.bounds` (exterior x,z ∈ [−13, 13], y ∈ [0, 30]; interior x ∈ [−9, 9], z ∈ [−7, 7], y ∈ [0, 4.2]) with 0.05 m tolerance |
| P3 | `entrance` | Exterior: exactly one `entrance`, `z ∈ [6, 11]`; no collider within 1.5 m of the door ring; exactly one `sign` with y ∈ [3.2, 6] |
| P4 | `slots` | Interior: exactly 6 slots s1–s6; pairwise ≥ 1.6 m; ≥ 0.8 m from walls; not inside any collider |
| P5 | `reachability` | Interior nav grid (0.25 m cells; colliders inflated by 0.35 m): BFS from (0, 5.4) reaches the point 1.2 m in front of every slot (along its facing) |
| P6 | `overlap` | No two colliders intersect with overlap volume > 0.01 m³ |
| P7 | `budget` | Triangles: exterior ≤ 60,000, interior ≤ 120,000; draw calls after merge ≤ 60 |
| P8 | `lights` | Module lights: interior ≤ 3, exterior ≤ 1 |
| P9 | `nonblank` | Every screenshot: luminance std-dev > 12 and no single color > 90% of pixels |
| P10 | `sign_visible` | In `ext-1`, the sign's projected screen area ≥ 1% and a raycast from the camera to the sign center hits the sign first |

`probe_score(building) = passed / 10` (P9 is computed by the Node script from the PNGs and merged
into the JSON). **World score = mean probe score over the 13 buildings.** Critical probes: P1, P2,
P3, P4, P5 — a module failing any critical probe cannot be used in the product.

## 4. Critique (job `worldgen_critic`, Argon high, per building, run in parallel up to 4)

Input parts: the 6 screenshots (PNG), the reference image, DESIGN.md, the building's brief, the
probe JSON (with failure details), tsc errors if any, and the module source.

```text
You are the art director and QA lead for the Foundry town. Judge this building against DESIGN.md,
its brief and the reference image. Look carefully at the screenshots: clipping, floating objects,
objects inside walls, empty or cluttered rooms, unreadable sign, wrong scale, missing department
identity, bad composition, inconsistent style with the reference.
Return ONLY JSON:
{"scores": {"style_match": 1-10, "department_identity": 1-10, "composition": 1-10,
            "readability": 1-10, "craft": 1-10},
 "issues": [{"severity": "high"|"medium"|"low", "where": "exterior|interior",
             "camera": "ext-1|...", "description": "...", "fix": "concrete change in kit calls"}],
 "keep": ["what works and must not be lost"]}
Every failed probe must appear as a high-severity issue with a concrete fix.
```

`visual_score = mean(scores) / 10`.

## 5. Patch (job `worldgen_patch`, Argon high)

For each building where any probe failed or any `high` issue exists:

```text
Rewrite this building module to fix every issue below while keeping what works ("keep").
Same rules and KIT API as before (attached). Output exactly one FILE block for
web/src/world/buildings/generated/<dept>.ts.
ISSUES: {issues JSON}
PROBE FAILURES: {failed probes with details}
TSC ERRORS: {errors}
CURRENT SOURCE: {module}
```

Use `previous_interaction_id` from the critic call when supported (the critic's context — the
screenshots — carries over). Patched modules go back to step 1 of the next iteration.

## 6. Selection and stopping

- Per building keep the version with the highest `(critical_pass, probe_score, visual_score)`
  lexicographically.
- Stop early when every building has `probe_score == 1.0` and `visual_score ≥ 0.75`, or at
  `--max-iter` (default 4), or when an iteration improves nothing.
- A building whose best version fails a critical probe → `fallback` in the registry.

## 7. Outputs that matter

`scores.json`:

```json
{"run_id": "wgr_...", "iterations": [
  {"n": 0, "world_score": 0.71, "visual_score": 0.58, "by_building": {"engineering": {"probe": 0.8, "visual": 0.6, "failed": ["P5", "P6"]}}},
  {"n": 1, "world_score": 0.92, "visual_score": 0.69, "by_building": {}},
  {"n": 2, "world_score": 1.00, "visual_score": 0.78, "by_building": {}}
 ],
 "final": {"world_score": 1.0, "visual_score": 0.78, "generated": 13, "fallback": 0},
 "tokens": {"in": 0, "out": 0}, "cost_usd": 0.0, "wall_minutes": 0}
```

The dashboard Metrics page charts `world_score` and `visual_score` per iteration and shows
iteration-0 vs final screenshots per building (served from
`/v1/world/worldgen/runs/<run_id>/captures/...` — add a static route in `api/world.py`).

## 8. Baseline for comparison

Iteration 0 *is* the single-pass baseline. The loop's value = final scores − iteration-0 scores.
Additionally the fallbacks are captured once (`--source fallback`) as a human-authored reference
point; they must score `probe = 1.0`.
