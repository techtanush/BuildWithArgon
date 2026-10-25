# D02 Office Hours — The Clocktower

## Mission

Stop the company from building the wrong thing. Office Hours reviews the brief for ambiguity,
conflicting requirements and risky assumptions, and turns the important ones into **one-click
decisions** for the founder.

## Team

| Agent | Name | Role | Model / job | Persona |
|---|---|---|---|---|
| `oh.skeptic` (lead) | Mara | Finds ambiguities; proposes a concrete interpretation for each | Flash `dept_artifact` | Friendly professional pessimist |
| `oh.clarifier` | Jun | Turns ambiguities into the `clarification` gate's questions; explains trade-offs | Flash `dept_artifact` | Patient, concise |

## Work

| Ticket | Owner | Output |
|---|---|---|
| `review.skeptic` | Mara | artifact `doc` with ≤ 5 ambiguities `{id, issue, proposed, risk_if_wrong, why}`; verdict `clear` / `needs_clarification` |
| (second pass) | Jun | if any risk ≥ medium: gate `clarification` with questions prefilled with Mara's proposals; on decision → creates `spec.write` with answers |

## Directing and being directed

- Directed by: Intake (brief handoff).
- Mara delegates to Jun: "@Jun two of these need Alex — please frame them."
- Hands off to Intake (Theo) once answered.
- Asks: Mara → Priya "Is offline support common among competitors?" (if research exists).

## Gates

`clarification` — the founder sees each question with Mara's proposed answer; one click accepts.
Rejecting the gate means "use your proposals" and is noted in the spec.

## Group chat

`#dept-office-hours`: "3 ambiguities, 2 need Alex." · `#exec`: "Waiting on Alex: Clarify 2 questions."

## In the world

Building: **The Clocktower** — brick tower with a big clock facing the plaza, gold roof band.
Interior: cozy study, armchairs, bookshelves, a chalkboard with question marks, a big wall clock.
Mara at `s1` by the chalkboard; Jun at `s2` near the armchairs.

Ask Mara: "What worries you about this idea?" · Ask Jun: "What do you need me to decide?"

## Failure modes

Too many trivial ambiguities → prompt caps at 5 and requires risk ≥ medium for the gate. Founder
never answers → work waits; standup lists it under "Waiting on Alex".

## Acceptance

`review.skeptic` produces a doc; medium/high risks raise a gate; answers flow into the spec.
