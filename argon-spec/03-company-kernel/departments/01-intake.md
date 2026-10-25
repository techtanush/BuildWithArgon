# D01 Intake — The Arrivals Hall

## Mission

Turn the founder's idea and context files into a structured **brief**, then (after Office Hours)
into a testable **spec** with numbered acceptance criteria that engineering and QA build against.
Intake is the company's front door: every new direction (the first idea, a pivot revision) enters
here.

## Team

| Agent | Name | Role | Model / job | Tools | Persona |
|---|---|---|---|---|---|
| `intake.brief-lead` (lead) | Iris | Reads the idea + files; writes the brief | Flash `dept_artifact` | — | Attentive listener; repeats back what they heard |
| `intake.spec-writer` | Theo | Writes the formal spec + acceptance criteria | **Argon high** `spec_write` | — | Exact, methodical, loves a crisp checklist |

## Work

| Ticket | Owner | Input | Output |
|---|---|---|---|
| `brief` | Iris | idea, uploaded files (excerpts ≤ 200k chars), founder name | artifact `brief`: Goals · Users · Core features · Data needs · Constraints · Non-goals · Open questions → creates `review.skeptic` (Office Hours) |
| `spec.write` | Theo | brief, skeptic review, clarification answers | artifact `spec` with `meta.acceptance_criteria` (5–15 AC, each testable) → creates `plan.request` (Chief of Staff) |
| `brief` (generation N+1) | Iris | pivot revision from Elena | revised brief; the whole flow re-runs |

## Directing and being directed

- Directed by: the founder (onboarding), Elena (revision briefs after a `pivot` gate).
- Iris directs Theo implicitly (the `spec.write` ticket is created after Office Hours) and posts
  "@Theo spec time — clarifications are in (apr_…)" in `#dept-intake`.
- Hands off to: Office Hours (brief), Chief of Staff (spec). Handoff messages in their channels.
- Typical asks: Theo → Mara "Did the founder confirm offline mode is out of scope?"

## Gates

None raised directly; the `clarification` gate comes from Office Hours and gates Theo's spec.

## Group chat

`#dept-intake`: "Starting: Brief for Pantry Pal" · "Done: brief — 4 core features, 3 open questions."
`#dept-office-hours` handoff: "@Mara brief is ready for review (art_…)."
`#exec` handoff: "@Rhea spec v1 is ready: 4 acceptance criteria (art_…)."

## In the world

Building: **The Arrivals Hall** — train-station-style hall, orange canopy, luggage carts; straight
north of the plaza (the first building you see). Interior: reception counter, idea wall with
colorful notes, sofas. Iris at `s1` behind the counter; Theo at `s2` by the idea wall.

Ask Iris: "What did you understand my idea to be?" · "What's still unclear?"
Ask Theo: "Read me the acceptance criteria." · "Which criterion is hardest to test?"

## Failure modes

Unreadable PDF → excerpt empty, Iris notes "couldn't read file X". Spec JSON invalid → repair once,
else retry ticket. Spec with untestable criteria → Theo's validator (each AC must mention an
observable input/output) fails and retries with feedback.

## Acceptance

Brief and spec artifacts exist for a live venture; spec has 5–15 ACs with ids; grounding G-17 passes.
