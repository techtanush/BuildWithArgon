# 04 — Evals (the numbers the product reports)

Three suites. Each writes `evals/results/<suite>-<UTC timestamp>.json` and rows in
`eval_results`. The Metrics page reads the latest results. Results files are committed.

## 1. Engineering eval — "first-run right" vs baseline (Problem Statement 1)

**Question it answers:** how often does Foundry's autonomous engineering loop produce code that
passes *hidden* acceptance tests, compared with a single Argon call?

**Briefs:** `evals/briefs/*.yaml` (5 files, from `templates/eval-briefs/`): `split-bill`,
`habit-streaks`, `markdown-toc`, `inventory-reorder`, `room-booking`. Each has `brief`,
`acceptance_criteria`, `api` (module path + exported signatures) and `hidden_tests` (a vitest file).
**The model never sees `hidden_tests`.**

**Conditions:**

| Condition | What runs |
|---|---|
| `baseline` | One `eval_baseline` call (Argon, medium thinking, long decode allowed): the same builder prompt (brief + ACs + API + template codebase), output applied once. No test feedback, no repair. |
| `loop` | `LocalLoopExecutor` exactly as in production: Argon high, builder writes its own tests, verify, repair up to `MAX_BUILD_ITERATIONS`. Feedback comes only from the builder's own tests and the build. |

Then for both: copy `hidden_tests` into `tests/hidden/` of the workspace and run
`npx vitest run tests/hidden --reporter=json`.

**Metrics per (brief, condition):** `hidden_passed`, `hidden_total`, `all_hidden_pass` (bool),
`iterations`, `first_pass_passed` (loop only), `tokens_in`, `tokens_out`, `cost_usd`,
`wall_seconds`, `files_changed`.

**Report:** per condition: all-pass rate (n/5), mean hidden pass ratio, mean iterations, total cost
and time. CLI:

```bash
uv run foundry-eval engineering [--brief <id>] [--condition baseline|loop|both] [--repeats 1]
```

Repeats default 1 (time budget); if time allows, `--repeats 2` and report mean ± range.

## 2. Grounding eval — do agents tell the truth with sources?

**Setup:** `foundry-eval grounding` creates a fresh temp DB and loads
`kernel/foundry_kernel/evals/fixtures/grounding_state.json` (from `templates/grounding-fixture.json`)
— a fixed venture ("Pantry Pal") with known tickets, runs, artifacts, approvals and messages.

**Questions:** `evals/grounding/questions.yaml` (from `templates/grounding-questions.yaml`). Each
item: `id`, `ask` (`concierge` or an agent id), `question`, and expectations:
- `must_include_any`: list of groups; each group is a list of alternative substrings; every group
  must match (case-insensitive) → **fact score**.
- `must_cite_any`: record ids; at least one must be cited → **citation score**.
- `expect_route`: (Concierge only) agent id expected in `route_card` → **route score**.
- `must_not_match`: regexes that must not match the answer (fabrication guard).

**Metrics:** fact accuracy, citation accuracy, route accuracy, fabrication rate, checker agreement
(share of answers the checker marked `verified` among answers that passed fact + citation;
and share marked `unsupported` among those that failed). Report all.

## 3. World eval — from worldgen

No separate run: `foundry-worldgen report` reads the latest `scores.json` and writes
`evals/results/world-<ts>.json` with iteration-0 vs final world/visual scores and the per-building
table. (Iteration 0 = single-pass baseline.)

## Honesty rules

- Never tune prompts on the hidden tests or the grounding answers; if you change prompts after
  seeing results, re-run all items and keep both results files.
- Report failures as they are. The Metrics page shows the raw table, not only the averages.
