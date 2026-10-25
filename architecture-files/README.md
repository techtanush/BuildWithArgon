# Foundry × Gemini 4 Argon — Build Specification

This folder is the complete, self-contained specification for building **Foundry: the zero-human
company you can walk into** during the Gemini 4 Argon hackathon (Cerebral Valley × Google
DeepMind). It is written so that a coding agent with no prior context can build the whole product
in about **12 hours** by following it in order.

Nothing in this folder is code that runs. The code is built in a new directory, **`argon-app/`**,
at the repository root (see [`01-architecture/02-repo-layout.md`](01-architecture/02-repo-layout.md)).

---

## What the product is (one paragraph)

Foundry is an autonomous software company. A founder gives it an idea; thirteen AI departments
research, validate, plan, build, test, and maintain the product, coordinating in group chats and
asking a human only at approval gates (money, outreach, deploys, new capabilities). Gemini 4 Argon
is the company's brain: it orchestrates the departments and does the long-horizon engineering —
reading the whole codebase, writing large changes in one pass, verifying its own work, and fixing
what fails. The founder watches the company on a **dashboard**, and can press **"Enter the
view"** to walk into a 3D town — one building per department — where every agent is a character
you can walk up to and talk to by voice, with a generated face and live lip-sync. A Concierge in
the central plaza answers any question and tells you which agent to ask; you can **race** there
in a car or **fast-travel**. Every answer an agent gives cites its source, and a checker verifies it.
Agents direct each other through tickets, cross-department requests, quick asks and standups in
group chats; four of them use **Cua cloud computers** (a real desktop + browser) for research,
visual QA and bug reproduction.

---

## Why we're building this — the hackathon

We are a team competing in the **Gemini 4 Argon hackathon** (Cerebral Valley × Google DeepMind,
a one-day, in-person build on 2026-10-26; Google engineers and mentors are on site). The event
showcases `gemini-4-argon`, Google's frontier model for long-horizon software engineering, long
video understanding and 3D/world generation. Judges score **working demos, not slides**, using
four tests from Google's builder guide: a specific problem for a real, named person; work that
genuinely needed Argon; people kept in control of consequential actions; and a live run with real
inputs in under 3 minutes.

**What we're entering (confirm the rules at kickoff):**

| Target | What it asks | Our answer |
|---|---|---|
| **Problem Statement 1 — Million Token Engineering** | Use Argon's whole-codebase understanding and up-to-1M-token output to do monumental engineering, and **measure improvement over a baseline** | The autonomous engineering loop: whole-repo context, whole features in one long-decode pass, verify → repair, independent QA; the eval harness compares a single Argon call (baseline) against the loop on hidden tests |
| **Problem Statement 2 — More Dimensions** | Generate 3D worlds, then build a system that **renders what it made, watches it, critiques it against the goal, and fixes it in a loop** | Argon generates all 13 department buildings in one pass; a headless render → probe → Argon critique → patch loop improves them, with a score recorded at every iteration; the result is the walkable town |
| **Best use of Managed Agents** (special prize) | Best use of Google's managed agents | An Argon Chief of Staff orchestrating 12 department leads who delegate to their own sub-agents; engineering and QA run as **Antigravity managed agents** in Google-hosted sandboxes; four agents also operate Cua cloud computers |

If only one problem statement is allowed, we enter **More Dimensions** and keep the engineering
loop as the product's engine. Every feature in this spec exists either to make the product real or
to prove one of these three claims with evidence the judges can see.

Full context: [`00-overview/02-hackathon-context.md`](00-overview/02-hackathon-context.md),
[`reference/hackathon-problem-statements.md`](reference/hackathon-problem-statements.md),
[`reference/gemini-4-argon-builder-guide.md`](reference/gemini-4-argon-builder-guide.md),
[`reference/prior-winners-research.md`](reference/prior-winners-research.md).

---

## Reading order

Read **all of section 00 and 01 before writing any code.** Then read the section for whatever
phase you are on in [`06-execution/01-12-hour-build-plan.md`](06-execution/01-12-hour-build-plan.md).

**Team build (Tanush, Ayan, Mahin):** `argon-app/` on `main` is a frozen-contract seed, and each
person builds on their own branch (`tanush`, `ayan`, `mahin`). Read
[`06-execution/07-team-split.md`](06-execution/07-team-split.md) and the `WORKORDER_<NAME>.md` at
the root of your branch after sections 00 and 01.

| # | Folder | What it covers |
|---|---|---|
| 00 | [`00-overview/`](00-overview/) | Product vision, hackathon context, glossary, decisions (ADRs), feature catalog |
| 01 | [`01-architecture/`](01-architecture/) | System overview, exact repo layout, data model (SQL), API contract, orchestration, security |
| 02 | [`02-models-and-integrations/`](02-models-and-integrations/) | Which model does what, the Gemini Interactions API wrapper, Antigravity managed agents, Composio, ElevenLabs, speech-to-text, Nano Banana, **Cua cloud computers**, the full **services catalog**, optional integrations, every env var and API key |
| 03 | [`03-company-kernel/`](03-company-kernel/) | The 13 departments and 29 agents (with a **deep dive per department** in `departments/`), how agents **direct each other** (delegation, requests, asks, standups, escalation), group chats, the autonomous engineering loop, support/PR loop, improvement loop, approval gates, prompts, grounding & citations |
| 04 | [`04-dashboard/`](04-dashboard/) | The web dashboard and onboarding |
| 05 | [`05-world/`](05-world/) | "Enter the view": the **full game experience** (`00-game-experience.md`), look kit, city layout, 13 buildings, characters & lip-sync, navigation (walk / race / fast travel), NPC conversation, Concierge, Argon world generation, render→critique→fix loop, performance |
| 06 | [`06-execution/`](06-execution/) | Hour-by-hour build plan, acceptance criteria, tests, evals, risks & fallbacks, operating rules for the coding agent, **the three-person team split and merge plan** |
| — | [`reference/`](reference/) | Google's Argon builder guide (PDF + transcription), the hackathon problem statements, prior-winner research, and the **reuse guide for the old Foundry code in this repo** (what you can and can't take) |
| — | [`assets/`](assets/) | The reference render that defines the visual target |
| — | [`templates/`](templates/) | Files to copy verbatim into `argon-app/`: `.env.example`, `AGENTS.md`, `DESIGN.md`, `roster.json`, eval briefs, grounding questions |

---

## Conventions used in every file

- **MUST / MUST NOT** — a requirement. Acceptance tests check it.
- **SHOULD** — do it unless a recorded reason in `argon-app/docs/DECISIONS.md` says otherwise.
- **MAY** — optional / stretch.
- **VERIFY** — an external API detail this spec could not confirm (no live access when it was
  written). Before relying on it, confirm it against the official docs or the installed Gemini
  API skill, then record the confirmed shape in `argon-app/docs/VERIFIED_API_SHAPES.md`. Every
  VERIFY item is isolated behind one adapter module so a correction touches one file.
- Code identifiers, paths, env vars and IDs are in `backticks` and are **exact** — copy them.
- Units: meters, seconds, radians (unless stated degrees), Y-up, right-handed (Three.js default).
- Times in the build plan are elapsed hours from T+0 (start of build).

## Single source of truth for IDs

These identifiers are used across all files. If you see a conflict, this table wins.

| Thing | Value |
|---|---|
| Spec folder | `architecture-files/` |
| App folder | `argon-app/` |
| Kernel (backend) | Python 3.11+, FastAPI, package `foundry_kernel`, port **8787** |
| Web (dashboard + world) | Vite 6 + React 18 + TypeScript 5 + Three.js, port **5173** |
| Database | SQLite at `argon-app/data/kernel.db` |
| Env file | `argon-app/.env` (copied from `templates/env.example`) |
| Orchestrator model | `gemini-4-argon` |
| Fast model | `gemini-3.8-flash` |
| Router/checker model | `gemini-3.5-flash-lite` |
| Managed agent | `antigravity-preview-09-2026` |
| Department IDs | `intake`, `office-hours`, `market-research`, `outreach`, `synthetic-population`, `pivot`, `engineering`, `growth`, `lead-intel`, `sales`, `finance-people`, `support`, `chief-of-staff` |
| Concierge agent ID | `concierge` (lives in the `plaza`) |

## Status of this spec

- Written 2026-10-25, the day before the event, without live access to Gemini 4 Argon, Antigravity,
  ElevenLabs or Composio. Model IDs and Argon API usage come from Google's builder guide
  ([`reference/gemini-4-argon-builder-guide.md`](reference/gemini-4-argon-builder-guide.md)).
- The visual target is [`assets/reference-bedroom.webp`](assets/reference-bedroom.webp) — a render a
  coding agent produced in one session, used here as the art-direction reference.
- Confirm with organizers at kickoff: (1) whether one project may enter both problem statements,
  (2) whether code from the existing Foundry repo may be reused. This spec assumes a **fresh build
  in `argon-app/`** (see ADR-001 in [`00-overview/04-decisions.md`](00-overview/04-decisions.md)).
