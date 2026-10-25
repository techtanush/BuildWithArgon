# 06 — Group Chats

> **Hackathon context.** Group chats are where judges *see* the managed agents coordinating
> (delegations, requests, asks, standups, decisions) — part of our Best use of Managed Agents entry.
> Keep messages typed, grounded and readable.

Agents coordinate in channels the founder can read and join. Tickets are the mechanism of work;
chat is the **visible conversation around the work**: delegations, handoffs, asks, standups,
announcements, escalations. Every message SHOULD carry `refs` to the records it is about.

Service: built in — SQLite (`channels`, `messages`) + SSE (`message.posted`). Optional one-way
mirror to the founder's Slack via Composio (see §Slack mirror).

## Channels per venture

| Slug | Kind | Members (who posts) | Purpose |
|---|---|---|---|
| `all-hands` | all_hands | everyone + founder | Ship announcements, new hires, milestones, **standup threads** |
| `exec` | exec | Rhea, department leads, system, founder | Plans, gate requests/decisions, escalations, pivot verdicts, reports |
| `dept-<department_id>` ×13 | department | that department's agents + founder | Delegations, ticket start/finish, asks (as threads), handoffs into the department |
| `incidents` | incident | system, Rhea, founder | Failures after retries, paused departments, provider outages |

## Threads

`messages.thread_root_id` (nullable) groups replies under a root message. Used for: standups (root
"Standup 14:30", one reply per lead, then Rhea's decisions), asks (root = question, reply =
answer), and replies to a founder's message. The dashboard shows threads collapsed with a reply
count; clicking expands them inline.

## Message types (all are rows in `messages`; `meta_json.kind` distinguishes them)

| `kind` | Posted by | Example |
|---|---|---|
| `status` | assigned agent | "Starting: Competitor profiles (tkt_…)" / "Done: 5 competitors profiled — cheapest is Whisk (free)." |
| `delegation` | department lead | "@Leo please profile the top 5 competitors (tkt_…)." |
| `handoff` | producing lead | "@Lucia — decision is in: proceed (art_…). Positioning can start." |
| `request` | system (on `agent.request`) | "Request from Lucia → Market Research: two customer quotes… (tkt_…)" |
| `ask` / `answer` | asking agent / answering agent (thread) | "Leo → @Priya: where's the Pantry Check price from?" / "From their pricing page (art_…)." |
| `standup_update` | each lead (thread under standup root) | "Done: brief + spec · Doing: — · Blocked: —" |
| `decision` | Rhea | "Decisions: positioning is P0; @Ines starts ICP after." |
| `gate` | system | "Waiting on Alex: Merge PR #7 (apr_…)" / "Alex approved: Merge PR #7" |
| `announcement` | lead / people ops | "Shipped search: 42/42 tests, reviewed by Mina, verified by Ben." / "Welcome Pia, our new PDF Export Specialist." |
| `incident` | system / Rhea | "Expiry highlighting failed after 3 attempts: build error in Item.tsx" |
| `human` | founder | anything; `@mentions` create work (below) |
| `reply` | mentioned agent | answer to a founder mention, with citations |

Exact templates for automatic posts:

| Trigger | Channel | Author | Body |
|---|---|---|---|
| Ticket dispatched | `dept-<dept>` | assigned agent | `Starting: {title}` |
| Ticket done | `dept-<dept>` | assigned agent | handler summary (≤ 280 chars) |
| Lead delegates | `dept-<dept>` | lead | `@{name} {task title} ({ticket ref})` |
| Dependency artifact ready for another department | `dept-<receiver>` | producing lead | `@{receiver lead} {artifact title} is ready ({ref}). {what it unblocks}.` |
| Plan created | `exec` | Rhea | `Plan for "{venture}": {n} tickets across {m} departments. First up: {top 3}.` |
| Gate requested / decided | `exec` | system | `Waiting on {founder}: {title}` / `{founder} {approved|rejected}: {title}{ — note}` |
| PR merged | `all-hands` | Zara | `Shipped {task}: {passed}/{total} tests, reviewed by Mina, verified by Ben.` |
| Agent hired | `all-hands` | Felix | `Welcome {name}, our new {title}.` |
| Ticket failed (final) | `incidents` | system | `{title} failed after {n} attempts: {first line}` |
| Standup | `all-hands` | Rhea (root), leads (replies) | see [`09-agent-coordination.md`](09-agent-coordination.md) §Standups |

## Founder in the chat

- `POST /v1/channels/{cid}/messages` stores a human message (`author_kind='human'`).
- `@<agent_id>` or `@<DisplayName>` (case-insensitive, roster match) → `chat.reply` ticket for that
  agent (priority 0): the agent answers in a thread with citations using the same context pack and
  checker as world conversations.
- `@<department name>` (e.g. `@engineering`) → the department lead replies.
- Instructions like "@Rhea make positioning the priority" → Rhea's `chat.reply` may return
  `actions` (`reprioritize`, `agent.request`) which the handler applies; the reply states what
  changed, with refs. Gated actions are never executed from chat — the agent links the gate.
- No mention in a `dept-*` channel → the department lead replies; no mention in `all-hands` or
  `exec` → Rhea replies only if the message is a question.

## Agent-to-agent conversation rules

- Agents talk in chat only through these mechanisms (status, delegation, handoff, request, ask,
  standup, decision); there is no free-form agent chatter, so the channels stay readable.
- Every agent message is generated from records and carries refs; no message claims work that isn't
  in the records.
- Rate limits: an agent posts ≤ 1 status message per ticket start/finish; asks ≤ 3 per run;
  standups ≤ every 30 min.

## Dashboard rendering

Slack-like: channel list (unread counts, `#exec` and `#incidents` pinned), message list with
portrait, name, title, time, body (sanitized markdown), kind badge (delegation, handoff, ask…),
ref chips (click → ticket/artifact/approval), collapsed threads, composer with `@` autocomplete
over agents and departments, live via SSE. A per-channel "Summarize" button calls Flash-Lite
`summarize` over the last 50 messages.

## In the world

- Group chat is **not** shown on walls or screens (the world shows no company state).
- In Town Hall's council chamber, pressing E at the long table plays the latest **standup** as
  voices (each lead's update in their ElevenLabs voice, then Rhea's decisions), with captions in
  the conversation panel and source cards for each line.
- Asking any agent "what did the team talk about today?" answers from recent messages with
  citations.

## Slack mirror (MAY)

If the founder connects Slack through Composio (gate `integration`), `integrations/slack_mirror.py`
posts `#all-hands` announcements, standup summaries, and gate requests to one chosen Slack channel
(one-way; Composio Slack tool `SLACK_SEND_MESSAGE` — VERIFY slug). Replies in Slack are not read
back in this build.
