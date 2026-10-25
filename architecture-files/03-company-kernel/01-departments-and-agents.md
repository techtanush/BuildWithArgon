# 01 — Departments and Agents

> **Prior art in the old repo** — the 13 department names and D01–D13 order match `src/components/Landing.tsx` (`OPERATING_DEPARTMENTS`); agent role/guardrail style follows `archive/foundry-concept/03_DEPARTMENTS_AND_AGENTS.md`. Take names and ideas only. What may and may not be reused: [`../reference/foundry-existing-repo-notes.md`](../reference/foundry-existing-repo-notes.md).

The canonical machine-readable roster is [`../templates/roster.json`](../templates/roster.json)
(copied to `kernel/data/roster.json`). This file explains it. If they ever disagree, `roster.json`
wins and this file must be corrected.

## The 13 departments

| Code | ID | Name | Mission (one line) | Building ID | Building name | Color |
|---|---|---|---|---|---|---|
| D01 | `intake` | Intake | Turn the founder's idea and context into a structured brief and a testable spec. | `b-intake` | The Arrivals Hall | `#E07A3F` |
| D02 | `office-hours` | Office Hours | Find ambiguity and risk early; ask the founder only what matters. | `b-office-hours` | The Clocktower | `#C9A227` |
| D03 | `market-research` | Market Research | Map the market, competitors and pricing with cited evidence. | `b-market-research` | The Observatory | `#3E7CB1` |
| D04 | `outreach` | Outreach & Validation | Design customer interviews and draft outreach (sending is gated). | `b-outreach` | The Telegraph House | `#4FA3A5` |
| D05 | `synthetic-population` | Synthetic Population | Test the value proposition against a simulated persona panel. | `b-synthetic-population` | The Greenhouse | `#5FA35F` |
| D06 | `pivot` | Pivot & Decision | Weigh the evidence and decide proceed / revise / kill. | `b-pivot` | The Rotunda | `#8E6CC4` |
| D07 | `engineering` | Engineering & Build | Design, build, review and verify the product. | `b-engineering` | The Foundry Works | `#D0573F` |
| D08 | `growth` | Strategy & Growth | Positioning and the launch plan. | `b-growth` | The Lighthouse | `#E3B341` |
| D09 | `lead-intel` | Lead Intelligence | Ideal customer profile and public, company-level lead evidence. | `b-lead-intel` | The Archive | `#6B7FA8` |
| D10 | `sales` | Sales | Pitch, pricing page copy and pipeline plan. | `b-sales` | The Market Hall | `#C2477A` |
| D11 | `finance-people` | Finance & People | Budget, runway, spend gates and hiring new agent capabilities. | `b-finance-people` | The Bank & Guild | `#2F8F6B` |
| D12 | `support` | Support & Retention | Triage issues and feedback; route bugs to engineering. | `b-support` | The Harbor House | `#38A3C9` |
| D13 | `chief-of-staff` | Chief of Staff | Plan and coordinate all work; improve the company itself. | `b-chief-of-staff` | Town Hall | `#6C7A99` |

The Concierge (`concierge`) belongs to `chief-of-staff` in the database but stands in the **plaza**
(`npc_slot = "plaza.concierge"`).

## The 29 agents

| Agent ID | Name | Title | Dept | Working job (model) | Tools | Lead | NPC slot |
|---|---|---|---|---|---|---|---|
| `concierge` | Nova | Concierge | chief-of-staff | `concierge` (Flash) | directory_search | — | `plaza.concierge` |
| `intake.brief-lead` | Iris | Brief Lead | intake | `dept_artifact` (Flash) | — | ✓ | `intake.s1` |
| `intake.spec-writer` | Theo | Spec Writer | intake | `spec_write` (Argon high) | — | | `intake.s2` |
| `oh.skeptic` | Mara | Skeptic | office-hours | `dept_artifact` (Flash) | — | ✓ | `office-hours.s1` |
| `oh.clarifier` | Jun | Clarifier | office-hours | `dept_artifact` (Flash) | — | | `office-hours.s2` |
| `mr.research-lead` | Priya | Research Lead | market-research | `deep_research` | deep_research | ✓ | `market-research.s1` |
| `mr.competitor-analyst` | Leo | Competitor Analyst | market-research | `dept_artifact` (Flash) + Cua computer or Antigravity web | antigravity_web, cua | | `market-research.s2` |
| `out.interview-designer` | Sofia | Interview Designer | outreach | `dept_artifact` | — | ✓ | `outreach.s1` |
| `out.outreach-drafter` | Kofi | Outreach Drafter | outreach | `dept_artifact` | — | | `outreach.s2` |
| `sp.sim-strategist` | Noor | Simulation Strategist | synthetic-population | `dept_artifact` | — | ✓ | `synthetic-population.s1` |
| `sp.panel-analyst` | Ravi | Panel Analyst | synthetic-population | `panel_simulation` (Flash) | — | | `synthetic-population.s2` |
| `pv.decision-analyst` | Elena | Decision Analyst | pivot | `decision_review` (Argon high) | — | ✓ | `pivot.s1` |
| `pv.risk-assessor` | Omar | Risk Assessor | pivot | `dept_artifact` | — | | `pivot.s2` |
| `eng.tech-lead` | Kai | Tech Lead | engineering | `engineering_design` (Argon high) | — | ✓ | `engineering.s1` |
| `eng.builder` | Zara | Builder | engineering | `engineering_build` (Argon high, long decode / Antigravity) | antigravity, github | | `engineering.s2` |
| `eng.reviewer` | Mina | Code Reviewer | engineering | `engineering_review` (Argon medium) | — | | `engineering.s3` |
| `eng.qa` | Ben | QA Engineer | engineering | `qa_analyze` (Argon medium) | antigravity, cua | | `engineering.s4` |
| `gr.positioning-lead` | Lucia | Positioning Lead | growth | `dept_artifact` | — | ✓ | `growth.s1` |
| `gr.growth-planner` | Sam | Growth Planner | growth | `dept_artifact` | — | | `growth.s2` |
| `li.lead-researcher` | Ines | Lead Researcher | lead-intel | `dept_artifact` + Cua computer or Antigravity web | antigravity_web, cua | ✓ | `lead-intel.s1` |
| `li.account-mapper` | Tariq | Account Mapper | lead-intel | `dept_artifact` | — | | `lead-intel.s2` |
| `sa.proposal-writer` | Grace | Proposal Writer | sales | `dept_artifact` | — | ✓ | `sales.s1` |
| `sa.pipeline-manager` | Diego | Pipeline Manager | sales | `dept_artifact` | — | | `sales.s2` |
| `fp.cfo` | Hana | CFO | finance-people | `dept_artifact` | ledger | ✓ | `finance-people.s1` |
| `fp.people-ops` | Felix | People Ops | finance-people | `dept_artifact` | registry | | `finance-people.s2` |
| `su.triager` | Yuki | Support Triager | support | `triage` (Flash-Lite) | github, cua | ✓ | `support.s1` |
| `su.liaison` | Ana | Customer Liaison | support | `dept_artifact` | — | | `support.s2` |
| `cos.orchestrator` | Rhea | Chief of Staff | chief-of-staff | `orchestrate_plan` (Argon high) | — | ✓ | `chief-of-staff.s1` |
| `cos.improvement` | Max | Improvement Engineer | chief-of-staff | `capability_design` (Argon high) | — | | `chief-of-staff.s2` |

Every agent's conversation in the world uses the `talk` job (Flash) with the agent's persona.

## Per-agent fields in `roster.json`

```jsonc
{
  "id": "eng.builder",
  "department_id": "engineering",
  "display_name": "Zara",
  "title": "Builder",
  "role_summary": "Implements engineering tickets end to end in a sandbox and verifies them.",
  "model_job": "engineering_build",
  "tools": ["antigravity", "github"],
  "capabilities": ["typescript", "react", "node", "vitest", "vite"],
  "persona": "Calm, precise, slightly dry humor. Talks about code in plain words. Always says which tests passed.",
  "greeting": "Hey — I'm Zara, I build things here. Ask me what I'm shipping.",
  "voice_hint": "young adult, neutral accent, calm, conversational",
  "npc_slot": "engineering.s2",
  "is_lead": false,
  "face_seed": 7
}
```

- `capabilities` is used by the capability-gap check (see
  [`04-improvement-and-ops-loops.md`](04-improvement-and-ops-loops.md)).
- `face_seed` makes face-spec generation deterministic when regenerated.
- Personas MUST NOT reference gender; the app uses they/them in all generated copy about agents.

## Agent status in the UI

`agent_state.status`: `idle` (no ticket), `working` (running a ticket), `waiting` (ticket waiting on
a gate), `blocked` (ticket blocked). Shown on the dashboard. **Not shown in the world.**

## Deep dives and coordination

- One file per department (team, sub-agent responsibilities, tickets, handoffs, services, gates,
  chat behaviour, building, what to ask them): [`departments/`](departments/).
- How agents direct each other (delegation, `agent.request`, asks, standups, escalation):
  [`09-agent-coordination.md`](09-agent-coordination.md).
- Agents with a Cua cloud computer: Leo, Ines, Ben, Yuki
  ([`../02-models-and-integrations/10-cua-cloud-computers.md`](../02-models-and-integrations/10-cua-cloud-computers.md)).
