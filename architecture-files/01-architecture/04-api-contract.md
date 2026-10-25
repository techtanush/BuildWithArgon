# 04 — API Contract

> **Prior art in the old repo** — `backend/factory/.../errors.py` and the exception handler + bearer check in `app.py` match our error-envelope approach; adapt them (our envelope has no `ok` field). None of the old routes (`/prediction/*`, `/scraper/*`, `/workflow/*`) carry over. What may and may not be reused: [`../reference/foundry-existing-repo-notes.md`](../reference/foundry-existing-repo-notes.md).

Base URL (dev): `http://127.0.0.1:8787`. The web calls it through the Vite proxy, so browser code
uses relative paths (`/v1/...`).

## Conventions

- JSON in, JSON out. `Content-Type: application/json` except uploads (multipart) and SSE.
- **Success envelope:** `{"data": <payload>}`. Lists: `{"data": {"items": [...], "next_cursor": null}}`.
- **Error envelope:** `{"error": {"code": "<snake_case>", "message": "<human text>", "details": {}}}`
  with the matching HTTP status (400 validation, 404 not found, 409 conflict, 422 schema,
  502 upstream provider failure, 503 not configured).
- **Auth:** the kernel binds to `127.0.0.1` only. If `KERNEL_TOKEN` is set, every `/v1/*` route
  requires `Authorization: Bearer <KERNEL_TOKEN>` (the Vite dev proxy adds it from
  `KERNEL_TOKEN` in `.env` via `proxy.headers`). Default: unset (local dev).
- **Pagination:** `?limit=` (default 50, max 200) and `?cursor=` (opaque; the last item's
  `created_at|id`).
- All response models are Pydantic classes in `foundry_kernel/api/*.py` so they appear in
  `/openapi.json` and in the generated `web/src/api/schema.d.ts`.

## Shared objects

```jsonc
// Venture
{"id":"ven_..","name":"Pantry Pal","slug":"pantry-pal","idea":"..","founder_name":"..",
 "status":"running","budget_usd":25.0,"spent_usd":3.42,"repo_full_name":"user/pantry-pal",
 "repo_url":"https://github.com/user/pantry-pal","created_at":"..","updated_at":".."}

// Department (with live counts for a venture)
{"id":"engineering","code":"D07","name":"Engineering & Build","mission":"..",
 "building_id":"b-engineering","building_name":"The Foundry Works",
 "counts":{"open":3,"in_progress":1,"waiting_approval":1,"done":12,"failed":0},
 "agents":["eng.tech-lead","eng.builder","eng.qa","eng.reviewer"]}

// Agent
{"id":"eng.builder","department_id":"engineering","display_name":"Zara","title":"Builder",
 "role_summary":"..","model":"gemini-4-argon","tools":["antigravity","github"],
 "persona":"..","voice_id":"..","portrait_url":"/generated/portraits/eng.builder.png",
 "face":{...FaceSpec...},"npc_slot":"engineering.bench-1","is_lead":false,
 "state":{"status":"working","current_ticket_id":"tkt_..","last_active_at":".."}}

// Ticket
{"id":"tkt_..","type":"eng.build","department_id":"engineering","assigned_agent_id":"eng.builder",
 "title":"..","body":"..","status":"in_progress","priority":1,"payload":{},"result":null,
 "depends_on":["tkt_.."],"parent_ticket_id":null,"generation":1,"attempts":1,"max_attempts":3,
 "created_by":"cos.orchestrator","created_at":"..","updated_at":"..","completed_at":null}

// Run
{"id":"run_..","ticket_id":"tkt_..","agent_id":"eng.builder","kind":"ticket","job":"engineering_build",
 "model":"gemini-4-argon","status":"succeeded","tokens_in":182311,"tokens_out":64012,
 "cost_usd":0.93,"interaction_id":"..","created_at":"..","started_at":"..","completed_at":"..",
 "output_text":"..","error":null}

// Artifact
{"id":"art_..","kind":"pr","title":"Add pantry search","summary":"..","content_md":"..",
 "uri":"https://github.com/user/pantry-pal/pull/7","department_id":"engineering",
 "agent_id":"eng.builder","ticket_id":"tkt_..","meta":{},"created_at":".."}

// Approval
{"id":"apr_..","gate_type":"merge","status":"pending","title":"Merge PR #7: Add pantry search",
 "summary":"..","payload":{...gate-specific...},"requested_by_agent_id":"eng.qa",
 "ticket_id":"tkt_..","created_at":"..","decided_at":null,"decided_by":null,"decision_note":null}

// Message
{"id":"msg_..","channel_id":"chn_..","author_kind":"agent","author_id":"cos.orchestrator",
 "body":"..","refs":[{"kind":"ticket","id":"tkt_.."}],"kind":"decision",
 "thread_root_id":null,"reply_count":4,"created_at":".."}

// Citation
{"kind":"ticket","id":"tkt_..","quote":"exact substring of the cited record","label":"Ticket: Add pantry search"}

// AnswerCheck
{"status":"pending|verified|partial|unsupported|error","per_citation":[{"index":0,"status":"verified","reason":".."}],"reason":".."}
```

## Endpoints

### System

| Method | Path | Response `data` |
|---|---|---|
| GET | `/health` | `{"status":"ok","db":true,"version":"0.1.0"}` (no envelope required; still use it) |
| GET | `/v1/system/status` | `{"providers":{"gemini":{"configured":true,"last_ok_at":".."},"antigravity":{..},"composio":{..},"elevenlabs":{..}},"executor":"antigravity","worldgen":{"last_run_id":"wgr_..","final_score":0.97}}` |

### Ventures

| Method | Path | Body | Response `data` |
|---|---|---|---|
| POST | `/v1/ventures` | `{"name","idea","founder_name","budget_usd"?}` | Venture |
| GET | `/v1/ventures` | — | `{"items":[Venture]}` |
| GET | `/v1/ventures/{vid}` | — | Venture + `{"stats":{"tickets":{..},"approvals_pending":2,"artifacts":14}}` |
| POST | `/v1/ventures/{vid}/files` | multipart `files[]` (≤ 8 files, ≤ 15 MB each; `.md .txt .pdf .csv .json`) | `{"items":[{"id","name","size_bytes","excerpt_chars"}]}` |
| POST | `/v1/ventures/{vid}/start` | `{}` | `{"status":"running","brief_ticket_id":"tkt_.."}` (409 if already running) |
| POST | `/v1/ventures/{vid}/pause` | `{}` | `{"status":"paused"}` — scheduler stops dispatching new tickets |
| POST | `/v1/ventures/{vid}/resume` | `{}` | `{"status":"running"}` |
| GET | `/v1/ventures/{vid}/budget` | — | `{"budget_usd","spent_usd","by_department":[{"department_id","cost_usd"}],"by_model":[..]}` |

### Departments & agents

| Method | Path | Response `data` |
|---|---|---|
| GET | `/v1/ventures/{vid}/departments` | `{"items":[Department]}` |
| GET | `/v1/ventures/{vid}/departments/{dept}` | Department + `{"recent_tickets":[Ticket],"recent_artifacts":[Artifact],"channel_id":"chn_.."}` |
| GET | `/v1/ventures/{vid}/agents` | `{"items":[Agent]}` (global roster + venture's generated agents) |
| GET | `/v1/ventures/{vid}/agents/{agent_id}` | Agent + `{"recent_runs":[Run],"current_ticket":Ticket\|null}` |

### Tickets, runs, artifacts

| Method | Path | Query/Body | Response `data` |
|---|---|---|---|
| GET | `/v1/ventures/{vid}/tickets` | `status`, `department_id`, `type`, `limit`, `cursor` | list of Ticket |
| GET | `/v1/tickets/{tid}` | — | Ticket + `{"runs":[Run],"artifacts":[Artifact],"approvals":[Approval],"children":[Ticket]}` |
| POST | `/v1/ventures/{vid}/tickets` | `{"type","department_id","title","body","payload"?}` (human-created) | Ticket |
| POST | `/v1/tickets/{tid}/retry` | `{}` | Ticket (status reset to `open`, attempts kept) |
| POST | `/v1/tickets/{tid}/cancel` | `{}` | Ticket |
| GET | `/v1/ventures/{vid}/runs` | `agent_id`, `ticket_id`, `kind`, `limit` | list of Run |
| GET | `/v1/runs/{rid}` | — | Run |
| GET | `/v1/runs/{rid}/logs` | `after_id` | `{"items":[{"id","ts","level","message"}]}` |
| GET | `/v1/ventures/{vid}/artifacts` | `department_id`, `kind`, `limit` | list of Artifact |
| GET | `/v1/artifacts/{aid}` | — | Artifact |

### Approvals (gates)

| Method | Path | Body | Response `data` |
|---|---|---|---|
| GET | `/v1/ventures/{vid}/approvals` | `?status=pending` | list of Approval |
| POST | `/v1/approvals/{aid}/decision` | `{"decision":"approve"\|"reject","note"?:"..","decided_by":"<founder name>"}` | Approval. 409 if not pending. Clarification gates also accept `{"answers":{"<question_id>":"<text>"}}` |

### Group chat

| Method | Path | Body | Response `data` |
|---|---|---|---|
| GET | `/v1/ventures/{vid}/channels` | — | `{"items":[{"id","slug","name","kind","department_id","last_message_at","unread":0}]}` |
| GET | `/v1/channels/{cid}/messages` | `?limit&cursor&thread_root_id=` | list of Message (newest last); top-level only unless `thread_root_id` is given |
| POST | `/v1/channels/{cid}/messages` | `{"body":"..","author_name":"..","thread_root_id"?:"msg_.."}` | Message (author_kind `human`). Mentions of an agent/department queue a `chat.reply` ticket (see group chats doc). |
| POST | `/v1/channels/{cid}/summarize` | `{}` | `{"summary":".."}` (Flash-Lite over the last 50 messages) |

### Coordination

| Method | Path | Body | Response `data` |
|---|---|---|---|
| GET | `/v1/ventures/{vid}/org` | — | `{"founder":"..","chief_of_staff":Agent,"departments":[{"department":Department,"lead":Agent,"members":[Agent]}],"concierge":Agent}` |
| POST | `/v1/ventures/{vid}/standup` | `{}` | `{"ticket_id":"tkt_.."}` — creates a `cos.standup` ticket now |
| GET | `/v1/ventures/{vid}/standups/latest` | — | `{"root_message_id","created_at","updates":[{"agent_id","text","refs"}],"decisions":{"text","refs"},"audio":[{"agent_id","audio_url","alignment"}]}` — audio entries are generated lazily (TTS cache) for Town Hall playback |

### Cloud computers (Cua)

| Method | Path | Body | Response `data` |
|---|---|---|---|
| GET | `/v1/ventures/{vid}/computers` | — | `{"items":[{"id","agent_id","provider","status","current_task":{"id","goal","steps","status"}\|null,"watch_url"}]}` |
| GET | `/v1/computers/{id}/screen.png` | — | latest screenshot (image/png; 404 if none) |
| GET | `/v1/computer-tasks/{id}` | — | task + `{"actions":[{"step","action","reason","guard","screenshot_url","created_at"}]}` |
| GET | `/v1/computer-tasks/{id}/screens/{step}.png` | — | screenshot for a step |
| POST | `/v1/computers/{id}/stop` | `{}` | computer (status `stopped`; running task → `stopped`) |

### Activity & stream

| Method | Path | Response |
|---|---|---|
| GET | `/v1/ventures/{vid}/activity` | `?limit=100&after_id=` → `{"items":[Event]}` |
| GET | `/v1/ventures/{vid}/stream` | `text/event-stream`; see SSE catalogue. Supports `Last-Event-ID` header to resume from `events.id`. Sends `: ping` every 15 s. |

### Conversation (world + dashboard)

| Method | Path | Body | Response `data` |
|---|---|---|---|
| POST | `/v1/ventures/{vid}/concierge/ask` | `{"text":"..","history"?:[{"role":"user"\|"agent","text":".."}]}` | `{"answer_id","text","citations":[Citation],"check":AnswerCheck,"route_card":RouteCard\|null,"latency_ms"}` |
| POST | `/v1/ventures/{vid}/agents/{agent_id}/talk` | `{"text":"..","history"?:[...]}` | `{"answer_id","text","citations":[Citation],"check":AnswerCheck,"suggested_agent":{"agent_id","reason"}\|null,"latency_ms"}` |
| GET | `/v1/answers/{answer_id}` | — | `{"id","text","citations","check"}` |

`RouteCard`:
```json
{"agent_id":"mr.research-lead","agent_name":"Priya","agent_title":"Research Lead",
 "department_id":"market-research","building_id":"b-market-research",
 "building_name":"The Observatory","reason":"Priya wrote the pricing research (art_..).",
 "citations":[{"kind":"artifact","id":"art_..","quote":"..","label":".."}]}
```

The `check` returned synchronously contains the deterministic result; if it is `pending` for the
model check, the final result arrives as SSE `answer.checked` and via `GET /v1/answers/{id}`.

### Voice

| Method | Path | Body | Response `data` |
|---|---|---|---|
| POST | `/v1/voice/transcribe` | multipart `audio` (webm/opus or wav, ≤ 30 s) | `{"text":"..","provider":"gemini"\|"none","latency_ms"}` |
| POST | `/v1/voice/tts` | `{"agent_id":"..","text":".."}` (≤ 600 chars) | `{"audio_url":"/media/audio/<sha>.mp3","mime":"audio/mpeg","alignment":{"chars":[..],"starts":[..],"ends":[..]}\|null,"provider":"elevenlabs"\|"gemini"\|"browser","latency_ms"}` — `provider:"browser"` means the client must use `speechSynthesis` |
| GET | `/media/audio/{sha}.mp3` | — | audio bytes (served from `data/audio-cache/`) |

### World

| Method | Path | Response `data` |
|---|---|---|
| GET | `/v1/world/manifest?venture=<vid>` | City manifest (see [`../05-world/03-city-layout.md`](../05-world/03-city-layout.md) §Manifest) including `npcs[]` with `agent_id`, `building_id`, `slot`, `portrait_url`, `face` |

### World Lab (worldgen history + live round) — `api/worldgen.py`

Full table and shapes: [`../05-world/13-world-lab-and-live-round.md`](../05-world/13-world-lab-and-live-round.md) §3
(`GET /v1/world/worldgen/latest`, `GET /v1/world/worldgen/runs`, `GET /v1/world/worldgen/runs/{run_id}`,
`GET /v1/world/worldgen/files/{path}`, `POST /v1/world/worldgen/live-rounds`, `GET /v1/world/worldgen/live-rounds`,
`GET /v1/world/worldgen/live-rounds/{round_id}`, `POST /v1/world/worldgen/live-rounds/{round_id}/promote`).
Models: `WorldgenRunSummary`, `WorldgenRun`, `LiveRound` in `contracts.py` / `shared/contracts.ts`.

### Integrations

| Method | Path | Body | Response `data` |
|---|---|---|---|
| GET | `/v1/ventures/{vid}/integrations` | — | `{"items":[{"provider":"github","status":"active","account_ref":"..","repo_full_name":".."}]}` |
| POST | `/v1/ventures/{vid}/integrations/github/connect` | `{"callback_url":"http://localhost:5173/integrations?connected=github"}` | `{"redirect_url":"https://..."}` |
| POST | `/v1/ventures/{vid}/integrations/github/refresh` | `{}` | integration status after re-checking Composio |

Connecting GitHub is itself gated: the first call creates an `integration` approval; the redirect
URL is returned only after it is approved (the dashboard shows the gate inline, so this is one click).

### Metrics & preview

| Method | Path | Response |
|---|---|---|
| GET | `/v1/ventures/{vid}/metrics` | `{"engineering":{"first_run_pass_rate":..,"loop_pass_rate":..,"avg_iterations":..},"grounding":{"accuracy":..,"n":..},"world":{"final_score":..},"costs":{..}}` |
| GET | `/v1/evals/latest` | latest `eval_results` grouped by suite |
| POST | `/v1/telemetry/latency` | body `{"samples":[{"agent_id","stt_ms","answer_ms","tts_ms","total_ms"}]}` → `{"stored":n}`; kept as a rolling list of 500 in `kv['latency.samples']`; p50/p90 included in `/metrics` |
| GET | `/preview/{vid}/{ticket_id}/{path:path}` | static files from `data/workspaces/{vid}/{ticket_id}/dist/` |

## SSE catalogue (`/v1/ventures/{vid}/stream`)

Each SSE message: `id: <events.id>`, `event: <type>`, `data: <json>`. `data` always contains
`{"type","entity_kind","entity_id","level","created_at","data":{...}}`.

| `event` | Emitted when | `data.data` |
|---|---|---|
| `venture.updated` | status/budget/repo changes | Venture |
| `ticket.created` / `ticket.updated` | any ticket write | Ticket |
| `run.started` / `run.finished` | run lifecycle | Run (without output_text) |
| `run.log` | each run log line | `{"run_id","level","message"}` |
| `artifact.created` | new artifact | Artifact (without content_md) |
| `approval.requested` / `approval.decided` | gate lifecycle | Approval |
| `message.posted` | chat message | Message |
| `agent.status` | agent_state change | `{"agent_id","status","current_ticket_id"}` |
| `answer.checked` | async checker finished | `{"answer_id","check":AnswerCheck}` |
| `ledger.updated` | spend recorded | `{"spent_usd","budget_usd"}` |
| `system.warning` | external provider failure | `{"provider","message"}` |
| `worldgen.progress` | worldgen CLI step or World Lab live-round step (global event: `venture_id` NULL — **every venture stream forwards global events**) | `{"run_id"?,"round_id"?,"department_id","step","status","iteration"?,"score"?}` |
| `computer.updated` | computer status / task change | `{"computer_id","agent_id","status","task_id"}` |
| `computer.action` | each computer-use step | `{"task_id","step","action","guard","screenshot_url"}` |
| `standup.posted` | standup thread complete | `{"root_message_id","ticket_id"}` |
