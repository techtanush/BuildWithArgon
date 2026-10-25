# D11 Finance & People — The Bank & Guild

## Mission

Keep the company **within budget** and **hire capabilities responsibly**. Finance watches every
model call's cost; People turns capability gaps into new agents — always with the founder's OK.

## Team

| Agent | Name | Role | Model / job | Tools | Persona |
|---|---|---|---|---|---|
| `fp.cfo` (lead) | Hana | Budget, burn rate, projection, spend gate | Flash `dept_artifact` | ledger (read) | Precise, reassuring — number first |
| `fp.people-ops` | Felix | Formats hires, registers approved agents, welcomes them | Flash `dept_artifact` | registry | Welcoming, organised |

## Work

| Ticket | Owner | Output |
|---|---|---|
| `finance.budget` | Hana | artifact `budget` from ledger data: spend by department and model, burn per hour, projected plan total; if projected > budget → gate `spend` with requested increase |
| `people.hire` | Felix | gate `new_capability` (agent design from Max + smoke-test result + cost implication); on approval registers the agent, assigns slot/voice/face, posts the welcome |

Automatic: the ledger raises a `spend` gate when spent ≥ 100% of budget (scheduler pauses model
work for the venture until decided).

## Directing and being directed

- Directed by: Rhea (budget early in the plan), Max (`people.hire` from `capability.gap`).
- Hana → Felix: "@Felix the hire is affordable — open the approval."
- Asked by: Elena ("can we afford v1?"), Grace (price floor), Rhea in standups.
- Hands off to: the hiring department ("@Kai, Pia joins Engineering for PDF export").

## Gates

`spend`, `new_capability`.

## Group chat

`#dept-finance-people`: "Spent $6.40 of $25 (26%); engineering is 64% of spend." · `#all-hands`:
"Welcome Pia, our new PDF Export Specialist."

## In the world

Building: **The Bank & Guild** — stone bank with four pillars, pediment, green doors, a round vault
door visible through the window. Interior: teller counter with glass partitions, the vault door on
the north wall, ledger desks, a guild lounge with an org-chart board of portrait frames. Hana at
`s1` at the teller counter; Felix at `s2` in the lounge. New hires from other departments are
welcomed here only in conversation — they stand in their own department's building.

Ask Hana: "How much have we spent, and on what?" · "Will we stay on budget?" · Ask Felix: "Who
joined recently?" · "Why did we hire them?"

## Acceptance

Budget artifact matches the ledger; spend gate fires over budget; hire flow registers an agent who
appears as an NPC; G-04, G-14 pass.
