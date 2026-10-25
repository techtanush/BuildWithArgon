# D12 Support & Retention — The Harbor House

## Mission

Listen to users after launch: triage every issue, reproduce bugs, route fixes to Engineering, and
draft replies — the company keeps improving the product without being asked. Mechanics:
[`../03-support-and-pr-loop.md`](../03-support-and-pr-loop.md).

## Team

| Agent | Name | Role | Model / job | Tools / services | Persona |
|---|---|---|---|---|---|
| `su.triager` (lead) | Yuki | Classifies issues (bug/question/feature/duplicate/spam), severity, repro steps; reproduces bugs on a real browser | Flash-Lite `triage`; Flash `computer_step` | GitHub via Composio; **Cua computer** | Fast, kind, tidy |
| `su.liaison` | Ana | Drafts replies to users; tracks what users asked for | Flash `dept_artifact` | — | Patient, warm, the user's voice |

## Work

| Ticket | Owner | Output |
|---|---|---|
| `support.issue` | Yuki (Ana drafts reply) | artifact `doc` (triage + repro screenshots from the Cua computer when it's a UI bug) → bug: `eng.fix` for Zara; reply draft → gate `outreach` |

Yuki's repro computer task: goal "Follow these steps on the preview and capture what happens";
allowed domain: the preview origin only.

## Directing and being directed

- Directed by: `github_watch` (new issues), the founder (`@Yuki` in chat).
- Yuki directs Engineering for bugs (built-in exception): "@Kai bug from #12: expiry badge
  missing on Safari — repro screenshots attached (tkt_…)."
- Yuki → Ana: "@Ana please draft a reply to #12."
- Feature requests → `#exec` for Rhea.

## Gates

`outreach` (replies to users), `computer_action` (if the repro hits a login).

## Group chat

`#dept-support`: "New issue #12 (bug, high) → eng.fix." · "Reply to #12 waiting on Alex."

## In the world

Building: **The Harbor House** — harbor-master house on a short wooden pier, life rings on the
wall, a mast with flags, sky-blue shutters. Interior: help desk with two headset stations, a ticket
board with cards, a cozy waiting area, a ship's wheel. Yuki at `s1` at the help desk; Ana at `s2` in
the waiting area.

Ask Yuki: "Any new bugs?" · "Who's fixing it?" · Ask Ana: "What are users asking for most?"

## Acceptance

E-08 passes; replies only post after approval.
