# D06 Pivot & Decision — The Rotunda

## Mission

Decide, with evidence on the table, whether to **proceed, revise or kill** before engineering
spends the budget. The company doesn't ship what the evidence says nobody wants — unless the
founder overrides.

## Team

| Agent | Name | Role | Model / job | Persona |
|---|---|---|---|---|
| `pv.decision-analyst` (lead) | Elena | The verdict with reasons for/against and confidence | **Argon high** `decision_review` | Composed, judicial |
| `pv.risk-assessor` | Omar | Risk register (likelihood, impact, mitigation, owner) | Flash `dept_artifact` | Steady and practical |

## Work

| Ticket | Owner | Input | Output |
|---|---|---|---|
| `decision.review` | Elena (Omar first) | market + competitor research, synthetic panel (weighted lower), interview plan, spec, founder goals | Omar's risk register (artifact `doc`), then Elena's artifact `decision` `{verdict, confidence, reasons_for, reasons_against, evidence[], proposed_revision}` |

- `proceed` → engineering design starts (it depends on this ticket), Growth starts.
- `revise` / `kill` → gate `pivot`. Approve = proceed anyway (founder override). Reject + revise →
  Elena writes a revision `brief` (generation + 1) to Intake; reject + kill → venture paused.

## Directing and being directed

- Directed by: Rhea (plan); depends on Market Research and Synthetic Population.
- Elena → Omar: "@Omar risk register first, please (tkt_…)."
- Elena blocks Engineering by design (dependency) and hands off: "@Kai decision is proceed —
  condition: adding items must be fast (art_…)." · "@Lucia positioning can start."
- Asks: Elena → Ravi "Which segment liked it least?"; Elena → Hana "Can we afford v1 at this scope?"

## Gates

`pivot` (revise or kill verdicts).

## Group chat

`#exec`: "Decision: proceed (0.72). Condition: fast item entry." · handoffs in
`#dept-engineering` and `#dept-growth`.

## In the world

Building: **The Rotunda** — ring of columns, shallow dome, purple banners, steps to the door.
Interior: big round table with chairs, a set of scales, evidence easels, purple rug. Elena at `s1`
at the table head; Omar at `s2` by the easels.

Ask Elena: "Should we build this?" · "What would change your mind?" · Ask Omar: "What's our
biggest risk?"

## Failure modes

Missing inputs (a dependency failed) → ticket blocked; Rhea escalates. Confidence < 0.4 → Elena
recommends `revise` with what evidence to gather.

## Acceptance

Decision artifact with verdict and evidence refs; pivot gate on revise/kill; G-05 passes.
