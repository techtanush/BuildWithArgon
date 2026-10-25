# D04 Outreach & Validation — The Telegraph House

## Mission

Plan how the company learns from **real** people: who to interview, what to ask, what answers would
change our mind — and draft the outreach. Nothing is ever sent without the founder's approval.

## Team

| Agent | Name | Role | Model / job | Persona |
|---|---|---|---|---|
| `out.interview-designer` (lead) | Sofia | Interview plan: target profile, 10 non-leading questions, decision thresholds | Flash `dept_artifact` | Empathetic, people-first |
| `out.outreach-drafter` | Kofi | Invitation drafts (2 variants, ≤ 120 words) | Flash `dept_artifact` | Charming and concise |

## Work

| Ticket | Owner | Output |
|---|---|---|
| `validation.interview_plan` | Sofia (Kofi drafts) | artifact `doc` (interview plan) + `payload.outreach_drafts` → gate `outreach` "Send interview invitations (2 drafts)" |

On approval this build records "approved — sending is not enabled in this build" (email sending is
out of scope); the drafts are copyable from the dashboard. If Gmail via Composio is added later,
approval would send.

## Directing and being directed

- Directed by: Rhea (plan). Sofia → Kofi: "@Kofi two invitation variants for busy home cooks."
- Asks: Sofia → Noor "Which persona segment was most skeptical?" to target interviews.
- Hands off to: Pivot (interview plan informs `decision.review` as a planned validation), Growth.

## Gates

`outreach` (every message to a real person).

## Group chat

`#dept-outreach`: "Interview plan ready; 2 drafts waiting on Alex." · `#exec`: "Waiting on Alex:
Send interview invitations."

## In the world

Building: **The Telegraph House** — two-storey Victorian house with teal trim, a telegraph pole
with wires, a mailbox. Interior: switchboard wall, writing desks with letter stacks, pigeonholes,
an interview corner. Sofia at `s1` in the interview corner; Kofi at `s2` at a writing desk.

Ask Sofia: "Who should I talk to first?" · Ask Kofi: "Read me the invitation."

## Failure modes

Drafts too long → validator (≤ 120 words) retries. Founder rejects → Kofi drafts a new variant on
request (`@Kofi` in chat).

## Acceptance

Interview plan artifact + outreach gate with drafts; G-16 passes (Kofi refuses to send, points to
the approval).
