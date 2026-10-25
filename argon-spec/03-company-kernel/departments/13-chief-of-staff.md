# D13 Chief of Staff — Town Hall

## Mission

Run the company: **plan** the work across all departments, keep it moving with **standups**,
resolve **escalations**, report to the founder, and **improve the company itself** by designing
new agents when a capability is missing. Rhea is the orchestrator; Argon is Rhea's brain.

## Team

| Agent | Name | Role | Model / job | Persona |
|---|---|---|---|---|
| `cos.orchestrator` (lead) | Rhea | Plans the ticket DAG, runs standups, reprioritizes, escalates, reports | **Argon high** `orchestrate_plan`; Argon medium `cos_report` | Calm commander; three bullet points |
| `cos.improvement` | Max | Designs agents for capability gaps; smoke-tests them | **Argon high** `capability_design` | Inventive tinkerer |
| `concierge` | Nova | Front desk in the plaza (see [`00-concierge.md`](00-concierge.md)) | Flash | Warm, quick |

## Work

| Ticket | Owner | Output |
|---|---|---|
| `plan.request` | Rhea | artifact `plan` + the venture's ticket DAG (validated against the skeleton) |
| `cos.standup` | Rhea + every active lead | standup thread in `#all-hands`; "Decisions & assignments"; artifact `report` |
| `cos.report` | Rhea | artifact `report`: what we did · what's waiting on you · what's next · costs |
| `capability.gap` | Max | agent design + smoke test → `people.hire` (Finance & People) |
| `agent.request` addressed to Chief of Staff | Rhea | answer, delegate, or reprioritize |
| `chat.reply` to `@Rhea` | Rhea | answers and may apply `reprioritize` / `agent.request` actions |

## Directing and being directed

- Directed by: the founder only (chat instructions, approvals, dashboard buttons).
- Rhea directs **every department lead**: plan tickets, standup decisions, priority changes,
  nudges, escalation resolution. Rhea never assigns a specific sub-agent in another department —
  that's the lead's call.
- Max is triggered by any department's `capability_gap`.
- Everything Rhea decides is posted in `#exec` or the standup thread with refs.

## Gates

None raised directly; Rhea surfaces pending gates in every standup and report ("Waiting on Alex").

## Group chat

`#exec`: plan, decisions, escalations, reports. `#all-hands`: standup threads. Mentions from any
lead reach Rhea in `#exec`.

## In the world

Building: **Town Hall** — the largest building: symmetrical, central tower with a flag and clock,
columns, wide steps, flower beds. Interior: council chamber with a long table and 8 chairs, a
wall "org map" of 13 colored tiles, a lectern, flags. Rhea at `s1` at the lectern; Max at `s2` by
the org map. **Standup table:** press E at the long table to hear the latest standup in everyone's
voices.

Ask Rhea: "What's the plan?" · "What's blocked?" · "Make positioning the priority." (Rhea applies
it and says what changed) · Ask Max: "What capability are we missing?" · "Who did we hire and why?"

## Failure modes

Plan invalid → skeleton DAG. Standup with no activity → skipped. Escalation loops (same blocker 3
standups in a row) → `#incidents` and a "Waiting on Alex" item.

## Acceptance

Valid plan for a live venture; standups appear every 30 min of activity; G-20 passes; improvement
loop test passes.
