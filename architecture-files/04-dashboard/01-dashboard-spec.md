# 01 — Dashboard

> **Prior art in the old repo** — `src/components/GatesPanel.tsx`, `Onboarding.tsx`, `IntegrationsPanel.tsx` and `TimelinePanel.tsx` are useful UX references (decision cards, upload queue, connect card, event feed). The old dark theme, 2D HQ canvas, wallets and Linq/Terac/Solari features are not part of this build. What may and may not be reused: [`../reference/foundry-existing-repo-notes.md`](../reference/foundry-existing-repo-notes.md).

The dashboard is the company's source of truth: everything the company is doing, every decision
waiting on the founder, and the door into the 3D world.

## Visual design

Clean, light, calm — the opposite of a busy ops console. CSS variables in `web/src/styles/tokens.css`:

```css
:root {
  --bg: #F6F4EF;            /* warm paper */
  --surface: #FFFFFF;
  --surface-2: #FBFAF7;
  --border: #E6E1D8;
  --text: #1F1D1A;
  --text-2: #6B655C;
  --accent: #E66A2C;        /* Foundry orange */
  --accent-2: #F5D90A;      /* interaction-ring yellow, used sparingly */
  --ok: #2F8F6B; --warn: #C9A227; --err: #C2473F; --info: #3E7CB1;
  --radius: 12px; --radius-sm: 8px;
  --shadow: 0 1px 2px rgba(0,0,0,.04), 0 4px 16px rgba(0,0,0,.05);
  --font: "Inter", system-ui, -apple-system, Segoe UI, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}
```

Load Inter and JetBrains Mono from Google Fonts in `index.html`. Department colors come from
`roster.json` and are used for chips and portraits' ring borders only.

## Layout

```
┌──────────────┬─────────────────────────────────────────────────────────────┐
│ Sidebar 240px│ TopBar: venture switcher · status pill · spent/budget ·      │
│ Foundry logo │         pending approvals badge · [Enter the view ▸]         │
│ Overview     ├─────────────────────────────────────────────────────────────┤
│ Departments  │ SystemStrip (only when a provider is degraded): amber line   │
│ Agents       ├─────────────────────────────────────────────────────────────┤
│ Tickets      │                                                             │
│ Approvals (2)│                 page content (max-width 1280)               │
│ Chat         │                                                             │
│ Org          │                                                             │
│ Computers    │                                                             │
│ Artifacts    │                                                             │
│ World Lab    │                                                             │
│ Metrics      │                                                             │
│ Integrations │                                                             │
│ Settings     │                                                             │
└──────────────┴─────────────────────────────────────────────────────────────┘
```

Responsive: below 900 px the sidebar collapses to icons.

**Enter the view button:** primary orange button with a small isometric-town icon. Navigates to
`/view?venture=<vid>` in the same tab (the world is a route in the same app). The world has a
"Back to dashboard" control (Esc menu) that returns to the page the founder came from.

### World Lab (`/world-lab`)

The Problem Statement 2 evidence page and the live loop round — full spec in
[`../05-world/13-world-lab-and-live-round.md`](../05-world/13-world-lab-and-live-round.md) §4.

## Data loading

- `api/client.ts`: `get<T>(path)`, `post<T>(path, body)`; unwraps `{data}`; throws `ApiError`
  with `code`/`message` from `{error}`.
- `api/hooks.ts`: tiny cache-and-revalidate hooks (`useQuery(key, fetcher)`) — no external lib.
- `api/sse.ts`: one `EventSource` per venture (`/v1/ventures/<vid>/stream`); a pub/sub that hooks
  use to patch cached lists (`ticket.updated` → replace by id; `*.created` → prepend; etc.).
  Reconnect with backoff 1 s → 10 s; show "Live" dot in TopBar when connected.

## Pages

### Overview (`/`)
- Hero row: venture name, idea (2 lines, expandable), status pill, **Start** (if draft) /
  **Pause** / **Resume**.
- KPI tiles (4): Tickets done / total · Waiting on you (approvals) · Spend $x of $y (bar) ·
  Builds shipped (merged PRs).
- **Departments grid**: 13 cards (4 columns) in roster order; each: code + name, colored left
  border, lead portrait, counts (open · working · waiting · done), latest artifact title, click →
  Department detail.
- **Activity feed** (right column, 360 px): last 50 events, human-readable lines with icons and
  relative time; click → entity.
- **Waiting on you**: up to 3 pending approval cards (compact) with Approve/Reject.

### Departments (`/departments`) and Department detail (`/departments/:id`)
Detail: header (name, mission, building name, colored banner), agents (portrait cards with status),
tabs: Tickets (board by status), Artifacts, Chat (embedded channel), Runs.

### Agents (`/agents`) and Agent detail (`/agents/:id`)
Grid of 29+ portrait cards (name, title, department chip, status). Detail: portrait (large),
persona, role, model (working job → model id), tools, current ticket, recent runs, recent
artifacts, **Talk** box (text chat calling `/talk`, shows citations + check — same component as the
world's conversation panel, without voice), **"Find in the world"** button → `/view?venture=<vid>&goto=<agent_id>`.

### Tickets (`/tickets`) and Ticket detail (`/tickets/:id`)
List with filters (status, department, type) and a toggle to a **graph view** (DAG rendered with a
simple layered layout in SVG: columns by depth, edges as curves, nodes colored by status).
Detail: title, type, department, assigned agent, status timeline, body (markdown), payload (JSON
viewer), dependencies, runs (with link), artifacts, approvals, Retry/Cancel.

### Run detail (`/runs/:id`)
Agent, job, model, thinking level, status, timings, tokens in/out, cost, interaction id; **live
logs** (SSE `run.log`, monospace, auto-scroll); output (markdown or JSON); for engineering runs:
iterations table (iteration, tests passed/failed, build ok, duration) and the "What made this Argon-
specific" note (whole-repo context size in tokens, long-decode output tokens, continuation used).

### Approvals (`/approvals`)
See [`../03-company-kernel/05-approval-gates.md`](../03-company-kernel/05-approval-gates.md).
Supports `?id=` to highlight one card.

### Chat (`/chat`, `/chat/:channelSlug`)
See [`../03-company-kernel/06-group-chats.md`](../03-company-kernel/06-group-chats.md): threads
(standups, asks), message-kind badges (delegation, handoff, request, ask, decision…), `@`
autocomplete for agents and departments, per-channel Summarize.

### Org (`/org`)
The org chart from `GET /v1/ventures/{vid}/org`: founder at top, Rhea, then 13 department cards
(lead portrait large, members small, generated hires marked "new"), Nova beside Rhea. Each card
shows the department's open requests (`agent.request`) in and out. Buttons: **Run a standup now**
(`POST /v1/ventures/{vid}/standup`), **Ask Chief of Staff for a report**. The latest standup thread
is shown below the chart.

### Computers (`/computers`, `/computer-tasks/:id`)
Grid of the agents' Cua computers: agent portrait + name, provider (sandbox/Space), status, current
goal, **live screenshot** (refresh every 1.5 s), step counter, last 5 actions with reasons and guard
verdicts, **Stop**; **Take over** (Spaces only, opens the watch URL). Task detail: goal, allowed
domains, full action timeline with a screenshot per step (scrubbable), result, linked artifact and
any `computer_action` gates. Empty state: "No agent is using a computer right now. Leo, Ines, Ben
and Yuki use one for competitor pricing, lead research, visual QA and bug repro."

### Artifacts (`/artifacts`, `/artifacts/:id`)
Filterable list (kind, department). Detail renders `content_md` (sanitized markdown: headings,
lists, tables, code, links), shows `uri` (PR link, preview link opening `/preview/...` in a new
tab), source agent/ticket.

### Metrics (`/metrics`)
- Engineering: first-run pass rate, final pass rate, mean iterations, cost per shipped task;
  table per build ticket; latest eval results (baseline vs loop) as a grouped bar chart (SVG).
- Grounding: accuracy, citation accuracy, checker agreement (latest eval).
- World: latest worldgen run — score per iteration (line chart) and per building (table).
- Costs: spend by department and by model.
Charts are hand-written SVG components (no chart library).

### Integrations (`/integrations`)
GitHub card: status (Composio), **Connect** → creates the integration gate inline → on approve,
redirect to Composio. Shows repo once created. Cards for ElevenLabs/Gemini/Antigravity show
"configured / not configured" from `/v1/system/status` (read-only).

### Settings (`/settings`)
Budget, autopilot-next toggle, founder name, executor in use (read-only), quality default for the
world.

## Empty and error states

Every list has an empty state with one sentence explaining what will appear and when. API errors
show an inline red banner with the message and a Retry button. Never show raw stack traces.
