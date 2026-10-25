# 09 — How Agents Direct Each Other

> **Hackathon context — Best use of Managed Agents.** This document is our main entry for the
> Managed Agents prize at the Gemini 4 Argon hackathon. Judges should be able to see real
> orchestration, not one big prompt: an Argon Chief of Staff plans and directs 12 department leads;
> each lead delegates to its own sub-agents; departments request work from each other, ask each
> other questions, hand off results and hold standups — all as records shown in the dashboard and
> group chats. Engineering and QA run as **Antigravity managed agents** (`antigravity-preview-09-2026`
> with Argon inside) in Google-hosted sandboxes, and four agents operate Cua cloud computers. Keep
> every coordination step visible and attributable — that visibility is what the prize is judged on.
> See [`../00-overview/02-hackathon-context.md`](../00-overview/02-hackathon-context.md).

Foundry is an organization, not a pipeline. Agents assign work, ask each other questions, hand off
results, escalate problems, and hold standups — all in records the founder can read.

## The org chart

```
                              Founder (human — approves gates)
                                          │
                         Rhea · Chief of Staff (cos.orchestrator, Argon)
             ┌───────────────┬────────────┼──────────────┬────────────────┐
     Nova · Concierge   Max · Improvement   12 department leads (one per department)
     (plaza; reads all)  (designs new agents)        │
                                                     └── each lead directs its sub-agents
```

| Department | Lead | Sub-agents the lead directs |
|---|---|---|
| Intake | Iris (brief lead) | Theo (spec writer) |
| Office Hours | Mara (skeptic) | Jun (clarifier) |
| Market Research | Priya (research lead) | Leo (competitor analyst) |
| Outreach & Validation | Sofia (interview designer) | Kofi (outreach drafter) |
| Synthetic Population | Noor (simulation strategist) | Ravi (panel analyst) |
| Pivot & Decision | Elena (decision analyst) | Omar (risk assessor) |
| Engineering & Build | Kai (tech lead) | Zara (builder), Mina (reviewer), Ben (QA) |
| Strategy & Growth | Lucia (positioning lead) | Sam (growth planner) |
| Lead Intelligence | Ines (lead researcher) | Tariq (account mapper) |
| Sales | Grace (proposal writer) | Diego (pipeline manager) |
| Finance & People | Hana (CFO) | Felix (people ops) |
| Support & Retention | Yuki (triager) | Ana (customer liaison) |
| Chief of Staff | Rhea | Max (improvement), Nova (concierge) |

Generated agents (hires) join their department under its lead.

## Three ways agents coordinate

| Mechanism | What it is | When | Record |
|---|---|---|---|
| **Ticket** | A unit of work assigned to an agent, with dependencies | Real work that produces an artifact | `tickets` (+ `parent_ticket_id`, `created_by`) |
| **Ask** | A quick question to another agent, answered from that agent's records | Mid-task, when information is missing | Two messages in a thread (question + cited answer) |
| **Chat** | Posts in group channels: handoffs, standups, announcements, mentions | Making coordination visible; humans joining in | `messages` with `refs` |

### 1. Tickets — who may assign work to whom

| From | May create tickets for | How |
|---|---|---|
| Rhea (CoS) | Any department (assigned to the lead or a specific agent) | `plan.request`, `cos.standup` decisions, `agent.request` |
| A department lead | Its own sub-agents (any ticket type the department consumes) | Returns `new_tickets` from its handler (internal delegation) |
| A department lead | Another department (never a specific agent there) | `agent.request` → handled by that department's lead |
| A sub-agent | Nobody directly; asks its lead or uses **Ask** | Lead decides |
| Built-in exceptions | `eng.qa`/`eng.reviewer` → `eng.fix` for Zara; `su.triager` → `eng.fix` (bugs); `pv.decision-analyst` → revision `brief` (after pivot gate); `cos.improvement` → `people.hire` | Defined in their handlers |

### `agent.request` (new ticket type, consumed by the **target** department's lead)

Payload:

```json
{"from_agent_id": "gr.positioning-lead", "need": "Two customer quotes about food waste for the landing page",
 "why": "Positioning proof points", "context_refs": [{"kind": "artifact", "id": "art_..."}],
 "deadline_minutes": 30}
```

Handler (`departments/requests.py`, the lead's prompt + Flash `agent_request` job) returns one of:

```json
{"decision": "answer", "text": "...", "citations": [...]}
{"decision": "delegate", "tickets": [{"type": "research.competitors", "assign_to": "mr.competitor-analyst", "title": "...", "body": "..."}]}
{"decision": "decline", "reason": "...", "suggest_department": "outreach"}
```

- `answer` → done; message to the requester's department channel with citations.
- `delegate` → child tickets (`parent_ticket_id` = the request) assigned to the lead's own
  sub-agents; when they finish, the request is marked done and the result is posted back.
- `decline` → done with reason; if `suggest_department` is set, a new `agent.request` goes there.

### 2. Asks — quick questions between agents

`HandlerContext.ask_agent(agent_id, question) -> AskAnswer` is available to every handler:
1. Builds the **target** agent's context pack (same as world conversations) and calls the `talk`
   job as that agent. Returns `{text, citations, check}`.
2. Posts both lines as a thread in the **asking** agent's department channel:
   "Leo → @Priya: Where did the $2.99 Pantry Check price come from?" / "Priya: From the pricing page
   captured in the market research (art_…)."
3. Limits: 3 asks per ticket run; asks cannot create tickets; an answer of "I don't know" may be
   followed by `ctx.request(...)` to that agent's department.

Handlers SHOULD ask before inventing: the common prompt tells agents
"If you need a fact owned by another department, use ASK(agent_id, question) — the system runs it
for you." Implementation: the agent's model output may include
`"asks": [{"agent_id": "...", "question": "..."}]`; the handler runs them and calls the model again
with the answers appended (max one round).

### 3. Chat — handoffs, mentions, standups

See [`06-group-chats.md`](06-group-chats.md). Coordination-specific posts:

| Event | Post |
|---|---|
| Handoff (an artifact another department depends on is ready) | In the receiving department's channel: "@Lucia — decision is in: proceed (art_…). Positioning can start." (by the producing lead) |
| Request created | In the target department's channel: "Request from Lucia: two customer quotes… (tkt_…)" |
| Delegation inside a department | "@Leo please profile the top 5 competitors (tkt_…)." (by the lead) |
| Escalation | In `#exec`: "@Rhea Engineering is blocked on a pivot decision for 25 min." |

## Standups (`cos.standup`, new ticket type, Chief of Staff)

- Created automatically every `STANDUP_MINUTES` (default 30) while the venture is running and at
  least one ticket changed since the last standup; also on demand ("Run a standup" button on the
  dashboard, or ask Rhea in the world).
- Steps:
  1. For each department with activity since the last standup, the **lead's update** is generated
     (Flash, `dept_artifact`) strictly from that department's records:
     `Done: … · Doing: … · Blocked: …` (≤ 60 words, with refs).
  2. Updates are posted as a thread in `#all-hands` titled "Standup 14:30".
  3. Rhea (Argon, `cos_report`) reads all updates + open blockers + pending gates and posts
     **Decisions & assignments**: reprioritizations (`priority` changes, recorded as events),
     new `agent.request` tickets, nudges ("@Kai please unblock Zara"), and "Waiting on Alex:" with
     links to pending approvals.
  4. Artifact `report` "Standup 14:30" (the thread + decisions).
- In the world, the standup can be **heard**: in Town Hall's council chamber, press E at the
  table to play the latest standup — each lead's update spoken in their voice (cached TTS), then
  Rhea's decisions. This is conversation content, not a status display.

## Escalation ladder and timers

1. Sub-agent blocked → posts in its department channel mentioning the lead.
2. Lead can't resolve within `ESCALATE_MINUTES` (default 20) → `#exec` mention of Rhea.
3. Rhea resolves (reassign, reprioritize, `agent.request`) or, if it needs a human decision,
   raises the right gate.
4. Founder decides in the dashboard.

A scheduler check every minute finds tickets `open` with all dependencies done but not dispatched
for > 10 min (capacity), or `waiting_approval` for > 30 min, and adds them to the next standup's
blocker list.

## Example flows

**Kickoff.** Founder launches → Iris writes the brief → Mara reviews (gate if needed) → Theo writes
the spec → Rhea plans 16 tickets and posts the plan in `#exec` → leads post "Starting" in their
channels and delegate (Priya → Leo for competitors).

**A bug report.** GitHub issue → Yuki triages (bug, high) → `eng.fix` for Zara + "@Kai FYI" in
`#dept-engineering` → Zara fixes in her sandbox → Mina reviews → Ben verifies (visual QA on his Cua
computer, screenshots attached) → merge gate → Alex approves → Ana drafts a reply to the user →
outreach gate → Alex approves → comment posted.

**An ask mid-task.** Lucia writes positioning and needs proof points → asks Ravi
"What did personas say about food waste?" → Ravi answers from the panel report with a citation →
both lines appear in `#dept-growth` → Lucia cites the panel report (labelled synthetic).

**A standup reassignment.** Standup shows Lead Intelligence blocked waiting on positioning; Rhea
raises Lucia's ticket to priority 0 and posts "@Lucia positioning first, then @Ines can start ICP."
