# 01 — Product Vision

## The one-sentence product

**Foundry is a zero-human software company: give it an idea, and thirteen AI departments —
orchestrated by Gemini 4 Argon — build and run the product, while you watch from a dashboard or
walk into the company as a 3D town and talk to any agent face to face.**

## Why it exists

Today, "AI builds your app" still means a human vibe-coder prompting, re-prompting and fixing.
The model writes code in short bursts; a person stitches the bursts together, notices the failures,
and decides what to do next. Nothing ships right the first time, and nothing keeps running when the
person walks away.

Foundry removes the person from the loop *between* decisions, not *from* decisions:

- **The company does the work.** Departments research the market, validate demand, write the spec,
  plan the work, build the code, test it, review it, open PRs, triage support issues, and fix bugs —
  continuously, without being prompted.
- **Argon is the brain.** Argon holds the whole codebase and company history in one 1M-token
  window, writes large multi-file changes in a single pass, verifies its own output against tests,
  and repairs what fails. Smaller models handle fast, parallel, cheap work.
- **Humans stay in control at the right moments.** Spending money, contacting real people,
  deploying/merging, connecting integrations, and creating new agent capabilities each require an
  explicit human approval in the dashboard. Agents never do these on their own.
- **The company is legible.** Every agent action leaves a record (ticket, run, artifact, message,
  approval). Every answer an agent gives cites its source, and an independent checker verifies it.

## The two surfaces

### 1. The dashboard (the source of truth)

A clean web dashboard showing the whole company: departments and their agents, tickets and their
dependencies, runs with logs, artifacts, PRs, group chats, budget, and the approval queue. This is
where the founder approves gates and reads status. **All company state is shown here and only
here.**

### 2. "Enter the view" (the experience)

A button on the dashboard drops the founder into a real-time 3D town rendered in the browser:

- **A central plaza** with a fountain and the **Concierge**, the company's main agent. You spawn
  facing the Concierge, who greets you by voice. Ask anything ("Who's working on checkout?",
  "Where's the pricing research?"). The Concierge answers, cites sources, and — when another agent
  knows more — shows a **route card**: who to ask, where they are, and why.
- **Thirteen buildings**, one per department, each with distinct architecture and a lit interior in
  the style of [`../assets/reference-bedroom.webp`](../assets/reference-bedroom.webp).
- **Getting around:** walk in first person; or from a route card or the map, choose **Race there**
  (hop in a car, follow a GPS ribbon through checkpoints, beat your best time) or **Take me there**
  (instant fade to the agent).
- **Every agent is a character.** Walk up to any agent, press **E**, hold **V** and speak. The agent
  answers by voice (ElevenLabs), its mouth moving in sync, using **real, current details** of its
  work, with a **source card** showing what each claim is based on and whether the checker verified it.

**The world itself never signals company state.** No status colors, no traffic jams, no smoke from
buildings. The town is a place to *be* and to *meet* your company; the dashboard is where state
lives. What agents *say* is real; what the world *shows* is architecture.

## What makes this an Argon product (not a generic agent demo)

| Argon capability (from Google's guide) | Where Foundry uses it |
|---|---|
| Shared 1M-token context | Engineering agents load the entire product repo + spec + ticket history in one request; the orchestrator reads the whole company state when planning |
| Long decode up to ~1M output tokens (`background=True`) | Whole features / whole services written in one coherent pass; the 3D town's thirteen building modules generated in one consistent pass against the look-kit API |
| `thinking_level="high"` | Planning, architecture, debugging, security fixes, verdicts |
| Autonomous verification loops | Build → run tests → read failures → fix → rerun, until zero failures with zero regressions; world render → probe + critique → patch → re-render |
| Agentic video/visual understanding | The world critic watches captured walkthroughs/screenshots of what Argon built and fixes it |
| Managed Agents (Antigravity) | Department agents run as managed agents in Google-hosted sandboxes with credentials injected at the proxy |
| Managed agents + cloud computers | Engineering in Antigravity sandboxes; Leo, Ines, Ben and Yuki operate real desktops through Cua with Gemini deciding each step |
| Orchestrating Flash & media subagents | Argon delegates leaf work to `gemini-3.8-flash`, routing/checks to `gemini-3.5-flash-lite`, faces/textures to Nano Banana 2.1, research to Deep Research |

## Principles (apply to every design decision)

1. **Real, not mocked.** Every number, answer and status comes from the kernel's database or a real
   model/tool call. A feature that is not built is hidden, never faked.
2. **Cite or don't claim.** Agents answer only from the context they were given and cite it. Unknown
   → say so and route to the right agent.
3. **Gates are sacred.** No code path performs a gated action without an `approved` approval row.
4. **Verify before trusting.** Generated code, generated world modules, and generated answers each
   pass an independent check before they are used.
5. **The world is fixed; conversations are live.** World layout and looks are generated ahead of
   time and validated. Conversation content is fetched live when you press E.
6. **Degrade, never die.** Every external dependency has a fallback (see
   [`../06-execution/05-risk-register-and-fallbacks.md`](../06-execution/05-risk-register-and-fallbacks.md)).

## Non-goals (do not build these)

- Marketing execution (ads, social posting, Higgsfield video, mass email). Departments may *draft*
  outreach; sending is gated and out of scope for the build. See
  [`../02-models-and-integrations/08-optional-integrations.md`](../02-models-and-integrations/08-optional-integrations.md).
- Multiplayer. One founder per browser session.
- Combat, weapons, or damage of any kind in the 3D world.
- Realistic humans. Characters are stylized (see [`../05-world/05-characters-and-faces.md`](../05-world/05-characters-and-faces.md)).
- Production deployment, auth providers, billing. Runs locally on the demo laptop.
- Showing company status in the 3D world (see above).

## Who it is for

The founder of a small software venture who wants a company working for them while they sleep,
and wants to *trust* it: see what it did, ask why, and approve what matters. The product is
specified for one founder and one venture at a time; the data model supports several ventures.
