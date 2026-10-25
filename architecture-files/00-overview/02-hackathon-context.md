# 02 — Hackathon Context

## The event

- **Name:** Gemini 4 Argon hackathon (Cerebral Valley × Google DeepMind), one day, in person.
- **Model:** `gemini-4-argon` — Google's frontier model for software engineering, complex knowledge
  work, cybersecurity defense and multimodal creation. Input, thinking and output share one
  1M-token window. Default output cap 65,536 tokens; past that requires `background=True` and a
  higher `max_output_tokens` (up to 1M minus input). Full notes:
  [`../reference/gemini-4-argon-builder-guide.md`](../reference/gemini-4-argon-builder-guide.md).
- **Pricing (intro, through 30 Nov 2026):** $2 / 1M input tokens, $10 / 1M output tokens; implicit
  caching gives 95% off cached input.

## The two problem statements (verbatim summary)

Full text: [`../reference/hackathon-problem-statements.md`](../reference/hackathon-problem-statements.md).

1. **Million Token Engineering.** Use Argon's codebase understanding and up-to-1M continuous output
   to do work across hundreds of files, keep interfaces consistent as they change, and grind tasks
   where other models' accuracy drops off. *Do something monumental and measure improvement over a
   baseline.*
2. **More Dimensions.** Argon is SOTA on long video understanding and can generate 3D games and
   procedural worlds in a single pass. *A single pass is only the first draft. Build a system that
   renders what it made, watches the result, critiques it against the goal, and fixes it in a loop.*

**Our entry (ADR-019):** the organizers confirmed one problem statement per team plus the Managed
Agents prize. We enter **Problem Statement 2 — More Dimensions** and **Best use of Managed Agents**
(judged on the agents we build on Google's agent APIs and how we orchestrate them — not on the
tools we use to write the code).

## Judging tests (from Google's builder guide)

Judges score working demos, not slides. Strong projects pass four tests:

1. Solves a **specific problem for a real person you can name**.
2. Does **work that needed Gemini 4 Argon**: long-horizon coding, autonomous verification loops,
   multi-file synthesis, 3D/WebGPU generation, or multi-agent orchestration.
3. **Keeps people in control** when taking actions that affect external systems, money or private data.
4. **Runs live during judging with real inputs in under 3 minutes.**

## How Foundry maps to the tracks and tests

| Requirement | Foundry feature | Spec |
|---|---|---|
| **PS2 (our track):** single pass → render → watch → critique → fix | One-pass generation of 13 buildings; headless renders + walkthrough videos; 10 probes; Argon critic (screenshots + video, realism); patch loop; score curve; photoreal town; World Lab with a live one-building round | [`../05-world/09-worldgen-pipeline.md`](../05-world/09-worldgen-pipeline.md), [`../05-world/10-render-critique-loop.md`](../05-world/10-render-critique-loop.md), [`../05-world/12-photoreal-look.md`](../05-world/12-photoreal-look.md), [`../05-world/13-world-lab-and-live-round.md`](../05-world/13-world-lab-and-live-round.md) |
| Not entered: PS1 | The engineering loop stays as a company capability (and a managed-agents showcase); its baseline eval is optional (P2) | [`../03-company-kernel/02-autonomous-engineering-loop.md`](../03-company-kernel/02-autonomous-engineering-loop.md) |
| Managed Agents prize | 29 agents on Google's agent APIs (Interactions API: Argon, Flash, Flash-Lite, Deep Research agent, Antigravity managed sandboxes); Argon orchestrator directing 12 department leads who delegate to sub-agents; typed coordination (tickets, asks, requests, standups); Cua cloud computers for GUI work | [`../02-models-and-integrations/03-antigravity-managed-agents.md`](../02-models-and-integrations/03-antigravity-managed-agents.md) |
| Test 1: real person | Founder persona; chosen at kickoff (see "Open decisions") | — |
| Test 2: needed Argon | Long-decode builds and world generation, whole-repo context, high-thinking orchestration | [`01-product-vision.md`](01-product-vision.md) table |
| Test 3: people in control | Approval gates; agents in the world point to the dashboard, never act | [`../03-company-kernel/05-approval-gates.md`](../03-company-kernel/05-approval-gates.md) |
| Test 4: live < 3 min | Everything runs locally; long generations are pre-run and stored with records | [`../06-execution/05-risk-register-and-fallbacks.md`](../06-execution/05-risk-register-and-fallbacks.md) |

## What prior winners tell us (evidence summary)

Full notes and sources: [`../reference/prior-winners-research.md`](../reference/prior-winners-research.md).

- Winners of three recent Cerebral Valley × Anthropic hackathons (14 projects) were all
  **domain-specific with a named user or a ground-truth number** — none was a horizontal agent
  platform.
- They went **deep on proof**: Tekton (1st, Opus 4.8 Build Day) had an evidence chain for every
  component and 20 verifier tests; Sim Francisco (2nd) reported predicted vs actual vote share.
- **Implications for this product:** every answer cites its source and is checked; the product
  ships an eval harness that produces real numbers; the world-quality loop produces a score curve.

## Claims policy (what the product and its docs may claim)

- MAY claim: what was measured by the eval harness, with the numbers it produced.
- MUST NOT claim: "better than Claude/GPT", "fully one-shot", "zero bugs", or anything not measured.
- MUST label pre-run generations as pre-run (the product stores generation records with timestamps).

## Open decisions to settle at kickoff (record answers in `argon-app/docs/DECISIONS.md`)

1. Can one project enter both problem statements? If not, primary = **More Dimensions**; the
   engineering loop remains as the product's engine.
2. May code from the existing Foundry repo be reused? This spec assumes **no** (fresh build).
3. Which real person is the named user? (Default: a founder on the team using Foundry for a real
   small product idea.)
