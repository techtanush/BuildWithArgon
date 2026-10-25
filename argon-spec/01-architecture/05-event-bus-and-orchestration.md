# 05 — Event Bus, Tickets and Orchestration

> **Prior art in the old repo** — `backend/factory/.../orchestrator.py` (`RunManager`: semaphore, task registry, cancel/shutdown) and `store.py` → `recover_interrupted_runs` are good patterns for the scheduler's dispatch and startup recovery. `src/store.tsx` shows SSE replay-then-live on the client. What may and may not be reused: [`../reference/foundry-existing-repo-notes.md`](../reference/foundry-existing-repo-notes.md).

## Event bus (`bus.py`)

```python
async def emit(conn, *, venture_id: str | None, type: str, entity_kind: str | None,
               entity_id: str | None, data: dict, level: str = "info") -> int:
    """Insert into events inside the caller's transaction; return events.id.
    The row is queued for publish; publish happens after COMMIT via db.tx() hook."""

class Broker:
    subscribers: dict[str | None, set[asyncio.Queue]]   # venture_id -> queues (None = global)
    def subscribe(venture_id) -> asyncio.Queue           # maxsize 1000; drop oldest on overflow
    def publish(event_row) -> None                       # to venture queues + global queues
```

- `db.tx()` collects emitted events and calls `broker.publish` for each **after** a successful
  commit (never publish uncommitted state).
- SSE endpoint: on connect, if `Last-Event-ID` is present, replay `events` with `id > last` for that
  venture (max 500), then stream the queue. Ping comment every 15 s.

## Ticket types (complete taxonomy)

Each type is consumed by exactly one department. `assigned_agent_id` defaults to the agent listed.

| Type | Department | Default agent | Produces | Next |
|---|---|---|---|---|
| `brief` | intake | `intake.brief-lead` | artifact `brief` (structured requirements) | creates `review.skeptic` |
| `review.skeptic` | office-hours | `oh.skeptic` | artifact `doc` (ambiguities) | if ambiguities with risk ≥ medium → gate `clarification`; then creates `spec.write` |
| `spec.write` | intake | `intake.spec-writer` | artifact `spec` (acceptance criteria) | creates `plan.request` |
| `plan.request` | chief-of-staff | `cos.orchestrator` | artifact `plan` + ticket DAG | — |
| `research.market` | market-research | `mr.research-lead` | artifact `research` (Deep Research report) | — |
| `research.competitors` | market-research | `mr.competitor-analyst` | artifact `research` | — |
| `validation.synthetic_panel` | synthetic-population | `sp.panel-analyst` | artifact `dataset` + `report` | — |
| `validation.interview_plan` | outreach | `out.interview-designer` | artifact `doc` (script + target profile); outreach drafts → gate `outreach` | — |
| `decision.review` | pivot | `pv.decision-analyst` | artifact `decision` (`proceed`/`revise`/`kill`) | `revise`/`kill` → gate `pivot` |
| `eng.design` | engineering | `eng.tech-lead` | artifact `plan` (architecture + build tasks) | creates `eng.build` × N, `eng.review` × N, `qa.verify` × N |
| `eng.build` | engineering | `eng.builder` | artifacts `code`, `test_report`, `preview`, `pr` | — |
| `eng.fix` | engineering | `eng.builder` | same as `eng.build` | — |
| `eng.review` | engineering | `eng.reviewer` | artifact `doc` (review) | on `changes_requested` → creates `eng.fix` |
| `qa.verify` | engineering | `eng.qa` | artifact `test_report` | pass → gate `merge`; fail → `eng.fix` |
| `growth.positioning` | growth | `gr.positioning-lead` | artifact `doc` | — |
| `growth.launch_plan` | growth | `gr.growth-planner` | artifact `plan` | — |
| `leads.icp` | lead-intel | `li.lead-researcher` | artifact `research` (ICP + public sources only) | — |
| `sales.proposal` | sales | `sa.proposal-writer` | artifact `doc` (pitch, pricing page copy) | — |
| `finance.budget` | finance-people | `fp.cfo` | artifact `budget` | if projected spend > budget → gate `spend` |
| `people.hire` | finance-people | `fp.people-ops` | gate `new_capability`; on approve registers agent | — |
| `support.issue` | support | `su.triager` | artifact `doc` (triage); reply draft → gate `outreach` | bug → `eng.fix` |
| `capability.gap` | chief-of-staff | `cos.improvement` | agent spec → creates `people.hire` | — |
| `chat.reply` | (mentioned agent's dept) | mentioned agent | message in channel | — |
| `cos.report` | chief-of-staff | `cos.orchestrator` | artifact `report` (what happened, what's next) | — |
| `cos.standup` | chief-of-staff | `cos.orchestrator` | standup thread in `#all-hands` + artifact `report` | may create `agent.request` tickets, change priorities |
| `agent.request` | the **target** department | target department's lead | answer, or child tickets for the lead's own sub-agents, or decline | see [`../03-company-kernel/09-agent-coordination.md`](../03-company-kernel/09-agent-coordination.md) |

Computer-using tickets (`research.competitors`, `leads.icp`, `qa.verify`, `support.issue`) run a
Cua computer task inside their handler when `CUA_MODE != off`
([`../02-models-and-integrations/10-cua-cloud-computers.md`](../02-models-and-integrations/10-cua-cloud-computers.md)).

## Default venture DAG

`plan.request` asks Argon for a plan (see [`../03-company-kernel/07-agent-prompts.md`](../03-company-kernel/07-agent-prompts.md)
§cos.orchestrator). The plan MUST be validated against this skeleton; if Argon's plan is invalid
JSON or misses a required node after one repair attempt, the kernel uses this skeleton verbatim.

```
brief ─► review.skeptic ─►(gate clarification?)─► spec.write ─► plan.request
plan.request ─► finance.budget
             ├► research.market ─────────────┐
             ├► research.competitors ────────┤
             ├► validation.synthetic_panel ──┼─► decision.review ─►(gate pivot if revise/kill)
             ├► validation.interview_plan    │          │
             └► eng.design ◄─────────────────┘ (eng.design depends on decision.review)
                   └► eng.build[i] ─► eng.review[i] ─► qa.verify[i] ─► (gate merge)
decision.review ─► growth.positioning ─► leads.icp ─► sales.proposal
                                       └► growth.launch_plan
all leaf tickets ─► cos.report
```

## Handler contract (`departments/base.py`)

```python
class NewArtifact(BaseModel):
    kind: ArtifactKind; title: str; summary: str = ""; content_md: str = ""
    uri: str | None = None; meta: dict = {}

class NewTicket(BaseModel):
    type: str; title: str; body: str = ""; payload: dict = {}
    depends_on: list[str] = []          # ticket ids OR local refs "ref:<key>"
    ref: str | None = None              # local key so siblings can depend on it
    priority: int = 2

class NewApproval(BaseModel):
    gate_type: GateType; title: str; summary: str; payload: dict = {}

class NewMessage(BaseModel):
    channel_slug: str                   # 'dept-engineering', 'exec', 'all-hands', 'incidents'
    body: str; refs: list[dict] = []

class CapabilityGap(BaseModel):
    capability: str; description: str

class HandlerResult(BaseModel):
    outcome: Literal["done", "waiting_approval", "blocked", "failed", "retry"]
    note: str = ""
    result: dict = {}
    artifacts: list[NewArtifact] = []
    new_tickets: list[NewTicket] = []
    approval: NewApproval | None = None        # required iff outcome == waiting_approval
    messages: list[NewMessage] = []
    capability_gap: CapabilityGap | None = None  # only with outcome == blocked

class Handler(Protocol):
    ticket_types: tuple[str, ...]
    async def handle(self, ticket: dict, ctx: "HandlerContext") -> HandlerResult: ...

class HandlerContext:
    venture: dict
    settings: Settings
    llm: LLMClient                      # llm/client.py
    db: Database
    agent: dict                         # assigned agent row
    run_id: str                         # a run row is created before handle()
    log: Callable[[str, str], Awaitable[None]]   # (level, message) -> run_logs + SSE run.log
    approval_result: dict | None        # set when re-entered after a gate decision
    async def context_for(self, kinds: list[str]) -> str   # pulls related artifacts as text
    # coordination (03-company-kernel/09-agent-coordination.md)
    async def ask_agent(self, agent_id: str, question: str) -> "AskAnswer"   # ≤ 3 per run; posts a thread
    async def request(self, department_id: str, need: str, why: str = "",
                      context_refs: list[dict] = []) -> str                  # creates agent.request; returns ticket id
    async def post(self, channel_slug: str, body: str, refs: list[dict] = [],
                   kind: str = "status", thread_root_id: str | None = None) -> str
    # cloud computers (02-models-and-integrations/10-cua-cloud-computers.md)
    async def use_computer(self, goal: str, allowed_domains: list[str], start_url: str,
                           max_steps: int = 30) -> "ComputerTaskResult"
```

`ArtifactHandler` (generic) implements most departments: it loads the agent's prompt file
`departments/prompts/<agent_id>.md`, builds the input (venture idea, spec, dependency artifacts),
calls the agent's model job, expects JSON `{"title","summary","content_md","messages":[..]}`,
and returns one artifact + one department-channel message.

## Scheduler (`scheduler.py`)

```text
every SCHEDULER_TICK_SECONDS (default 1.0):
  for venture in ventures where status='running':
    if ledger.over_budget(venture) and no pending 'spend' approval: request spend gate; skip venture
    candidates = tickets where status='open'
                 and (payload._retry_at is null or <= now)
                 and all deps have status in ('done','cancelled')
               order by priority asc, created_at asc
    for t in candidates:
      if running_total >= SCHEDULER_CONCURRENCY (4): break
      if running_in_department(t.department_id) >= 2: continue
      if t.type in ('eng.build','eng.fix') and running_eng_builds(venture) >= 1: continue
      dispatch(t)
  for tickets where any dep status == 'failed' and status == 'open': set status 'blocked'

every 60 s:
  for venture in running ventures:
    if minutes since last standup >= STANDUP_MINUTES (30) and any ticket changed since: create cos.standup
    collect stale items (open+ready but undispatched > 10 min, waiting_approval > 30 min,
      blocked > ESCALATE_MINUTES (20)) -> kv['standup.blockers.<vid>'] for the next standup;
      blocked > ESCALATE_MINUTES also posts one escalation mention of Rhea in #exec
```

`dispatch(t)`:
1. In one transaction: `status='in_progress'`, `attempts=attempts+1`, `started_at`, create `runs`
   row (`kind='ticket'`, `job` from agent), set `agent_state` to `working`, emit events.
2. `asyncio.create_task(execute(t, run))` with a timeout of `TICKET_TIMEOUT_SECONDS`
   (default 1800; `eng.build`/`eng.fix` use `ENG_TICKET_TIMEOUT_SECONDS`, default 3600).
3. `execute` calls the handler, then `apply_result()` in one transaction:
   - insert artifacts, messages (resolve channel slugs), new tickets (resolve `ref:` deps), approval;
   - `done` → ticket `done`, `completed_at`, `result_json`;
   - `waiting_approval` → ticket `waiting_approval`, create approval;
   - `blocked` + `capability_gap` → ticket `blocked`, create `capability.gap` ticket with payload
     `{capability, description, blocked_ticket_id, blocked_department}`;
   - `failed` → if attempts < max_attempts: `open` with `_retry_at = now + 15s * 2^(attempts-1)`;
     else `failed` + message to `incidents`;
   - `retry` → like failed but does not consume extra attempts beyond the current one;
   - agent_state back to `idle`; run `succeeded`/`failed`; ledger entries already written by llm client.
4. Exceptions inside the handler are caught, logged to `run_logs`, treated as `failed`.

### Gate re-entry

When `POST /v1/approvals/{id}/decision` lands:
1. Update approval (`approved`/`rejected`, `decided_by`, `decided_at`, `decision_note`).
2. If `ticket_id` is set and the ticket is `waiting_approval`: set it `open`, write
   `payload._approval = {"approval_id","status","note","answers"}`. The scheduler re-dispatches it;
   the handler sees `ctx.approval_result` and runs its second pass.
3. Emit `approval.decided`, post a system message to `exec`.

### Startup recovery

On kernel start: tickets `in_progress` → `open` (attempt kept), runs `running` → `failed`
("kernel restarted"). Then start the scheduler and `github_watch`.

## Capability gaps (improvement loop)

Any handler MAY return `blocked` with a `capability_gap` when the ticket needs a skill no agent in
its department has (checked against `roster.json` `capabilities` + venture-generated agents). The
`cos.improvement` agent (Argon) drafts a new agent definition, `people.hire` opens a
`new_capability` gate, and on approval the kernel inserts the agent (venture-scoped,
`generated=1`), adds an NPC to that department's building (next free slot), sets the blocked ticket
back to `open` with `payload.granted_capabilities += [capability]`. Detail:
[`../03-company-kernel/04-improvement-and-ops-loops.md`](../03-company-kernel/04-improvement-and-ops-loops.md).
