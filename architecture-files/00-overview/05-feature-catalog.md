# 05 — Feature Catalog

Every feature in the product, grouped by area, with priority and where it's specified.
**P0** = required for the core experience; **P1** = required for acceptance; **P2** = MAY / stretch.

## Company (autonomous operations)

| Feature | Priority | Spec |
|---|---|---|
| 13 departments, 29 named agents with personas, voices, faces | P0 | [`../03-company-kernel/01-departments-and-agents.md`](../03-company-kernel/01-departments-and-agents.md), [`../03-company-kernel/departments/`](../03-company-kernel/departments/) |
| Venture onboarding (idea + files + budget) and launch | P0 | [`../04-dashboard/02-onboarding.md`](../04-dashboard/02-onboarding.md) |
| Brief → skeptic review → clarification gate → spec with acceptance criteria | P0 | Intake, Office Hours deep dives |
| Chief of Staff plans a ticket DAG across departments (Argon) with a validated skeleton fallback | P0 | [`../01-architecture/05-event-bus-and-orchestration.md`](../01-architecture/05-event-bus-and-orchestration.md) |
| Ticket scheduler: dependencies, concurrency, retries, gate re-entry, restart recovery | P0 | same |
| Agents direct each other: delegation, `agent.request`, asks, handoffs, escalations | P1 | [`../03-company-kernel/09-agent-coordination.md`](../03-company-kernel/09-agent-coordination.md) |
| Standups every 30 min of activity, with Rhea's decisions and reassignments | P1 | same, §Standups |
| Group chats: all-hands, exec, 13 department channels, incidents; threads; founder mentions | P0 | [`../03-company-kernel/06-group-chats.md`](../03-company-kernel/06-group-chats.md) |
| Market research with Deep Research (cited) | P1 | Market Research deep dive |
| Synthetic persona panel (labelled synthetic) | P1 | Synthetic Population deep dive |
| Proceed / revise / kill decision with pivot gate | P1 | Pivot deep dive |
| Positioning, launch plan, ICP, pitch & pricing, pipeline plan | P1 | Growth, Lead Intel, Sales deep dives |
| Budget ledger, spend gate, cost per department/model | P0 | [`../02-models-and-integrations/01-model-routing.md`](../02-models-and-integrations/01-model-routing.md), Finance deep dive |
| Improvement loop: capability gap → new agent design → smoke test → hire approval → new NPC | P1 | [`../03-company-kernel/04-improvement-and-ops-loops.md`](../03-company-kernel/04-improvement-and-ops-loops.md) |
| Reports from the Chief of Staff (what we did / waiting on you / next / costs) | P1 | same |
| Approval gates: clarification, pivot, spend, outreach, merge, integration, new capability, computer action | P0 | [`../03-company-kernel/05-approval-gates.md`](../03-company-kernel/05-approval-gates.md) |

## Engineering (company capability; managed-agents showcase)

| Feature | Priority | Spec |
|---|---|---|
| Tech-lead design with whole-repo context (Argon high) | P0 | [`../03-company-kernel/02-autonomous-engineering-loop.md`](../03-company-kernel/02-autonomous-engineering-loop.md) |
| Whole-feature builds in one long-decode pass | P0 | same |
| Verify → repair loop (≤ 6 iterations) with the no-weakening rule | P0 | same |
| Antigravity managed-agent builds in Google-hosted sandboxes | P1 | [`../02-models-and-integrations/03-antigravity-managed-agents.md`](../02-models-and-integrations/03-antigravity-managed-agents.md) |
| Code review (Argon) and independent QA acceptance tests | P0 | engineering loop §4–5 |
| Visual QA on a Cua cloud computer with screenshots | P1 | [`../02-models-and-integrations/10-cua-cloud-computers.md`](../02-models-and-integrations/10-cua-cloud-computers.md) |
| GitHub repo, branches, PRs, merges via Composio (merge gated) | P1 | [`../02-models-and-integrations/04-composio.md`](../02-models-and-integrations/04-composio.md) |
| No-GitHub mode (local builds, previews, local merge) | P0 | same |
| Live previews of built products | P1 | API contract §preview |
| Support loop: GitHub issues → triage → bug repro (Cua) → fix → review → QA → merge; gated replies | P1 | [`../03-company-kernel/03-support-and-pr-loop.md`](../03-company-kernel/03-support-and-pr-loop.md) |
| Engineering eval: baseline vs loop on 5 briefs with hidden tests | P2 (optional, ADR-019) | [`../06-execution/04-evals.md`](../06-execution/04-evals.md) |

## Cloud computers (Cua)

| Feature | Priority | Spec |
|---|---|---|
| Per-agent cloud computer (Cua sandbox or Space) with browser | P1 | [`../02-models-and-integrations/10-cua-cloud-computers.md`](../02-models-and-integrations/10-cua-cloud-computers.md) |
| Computer-use loop: screenshot → Flash action → guard → execute; Argon re-plans | P1 | same |
| Safety guard + `computer_action` gate (logins, sign-ups, forms that contact people) | P0 when Cua is on | same |
| Dashboard Computers page: live screenshots, action log, stop; take over (Spaces) | P1 | same; dashboard spec |
| Screenshot evidence attached to artifacts and citable | P1 | same |

## Dashboard

| Feature | Priority | Spec |
|---|---|---|
| Overview, Departments, Agents, Tickets (+ DAG graph), Runs (live logs), Approvals, Chat (threads), Artifacts, Computers, Org chart, Metrics, Integrations, Settings | P0/P1 | [`../04-dashboard/01-dashboard-spec.md`](../04-dashboard/01-dashboard-spec.md) |
| Live updates over SSE | P0 | API contract §SSE |
| Talk to any agent by text from the dashboard, with sources | P1 | dashboard spec §Agents |
| Enter the view / Find in the world | P0 | dashboard spec |

## The world ("Enter the view", Problem Statement 2)

| Feature | Priority | Spec |
|---|---|---|
| Sunny 3D town: plaza + 13 department buildings in the reference look | P0 | [`../05-world/00-game-experience.md`](../05-world/00-game-experience.md), 02–04 |
| First-person walking with collision; enter/exit every building | P0 | [`../05-world/06-navigation-race-travel.md`](../05-world/06-navigation-race-travel.md) |
| Drivable car with chase camera | P0 | same |
| Race there (GPS ribbon, checkpoints, timer, best times) | P0 | same |
| Take me there (fade travel to the agent) | P0 | same |
| Map with search | P1 | same |
| Concierge with auto-greeting and route cards | P0 | [`../05-world/08-concierge.md`](../05-world/08-concierge.md) |
| Realistic rigged human avatars chosen/tinted from Argon-generated face specs; idle, look-at, blink, gestures | P0 | [`../05-world/12-photoreal-look.md`](../05-world/12-photoreal-look.md) §7, [`../05-world/05-characters-and-faces.md`](../05-world/05-characters-and-faces.md) |
| **Photoreal look:** scanned PBR materials, real prop models, HDRI + sun with cascaded shadows, GTAO, SMAA, AgX, color grading, EZ-Tree vegetation; asset pipeline + manifest | P0 | [`../05-world/12-photoreal-look.md`](../05-world/12-photoreal-look.md) |
| Critic watches walkthrough videos (Argon long-video understanding) and scores realism | P0 | [`../05-world/13-world-lab-and-live-round.md`](../05-world/13-world-lab-and-live-round.md) §5 |
| **World Lab:** recorded score curve + filmstrips; live one-building loop round on stage; promote | P0 | [`../05-world/13-world-lab-and-live-round.md`](../05-world/13-world-lab-and-live-round.md) |
| Portraits rendered from the 3D avatars (optional Nano Banana polish) | P1 | [`../05-world/12-photoreal-look.md`](../05-world/12-photoreal-look.md) §8 |
| Voice conversations: push-to-talk, ElevenLabs voices, lip-sync from timestamps | P0 | [`../05-world/07-npc-conversation.md`](../05-world/07-npc-conversation.md) |
| Source cards + verification chips on every answer | P0 | [`../03-company-kernel/08-grounding-and-citations.md`](../03-company-kernel/08-grounding-and-citations.md) |
| Standup playback in Town Hall | P1 | [`../03-company-kernel/09-agent-coordination.md`](../03-company-kernel/09-agent-coordination.md) |
| Argon generates all 13 buildings in one pass; render → probe → critique → fix loop with scores | P0 | [`../05-world/09-worldgen-pipeline.md`](../05-world/09-worldgen-pipeline.md), [`../05-world/10-render-critique-loop.md`](../05-world/10-render-critique-loop.md) |
| Nano Banana portraits, textures, signs | P1 | [`../02-models-and-integrations/07-nano-banana-assets.md`](../02-models-and-integrations/07-nano-banana-assets.md) |
| Quality tiers + auto quality | P1 | [`../05-world/11-performance.md`](../05-world/11-performance.md) |
| Plaza music (Lyria), Live-mode Concierge | P2 | [`../02-models-and-integrations/08-optional-integrations.md`](../02-models-and-integrations/08-optional-integrations.md) |

## Proof and metrics

| Feature | Priority | Spec |
|---|---|---|
| World scores per iteration (headline, P0), grounding eval (P1), engineering eval (P2) | P0/P1/P2 | [`../06-execution/04-evals.md`](../06-execution/04-evals.md) |
| Metrics page: first-run pass rate, loop vs baseline, grounding accuracy, world score curve, latency p50/p90, costs | P1 | dashboard spec §Metrics |
| Evidence records committed (worldgen runs, eval results, build log) | P1 | operating rules |
