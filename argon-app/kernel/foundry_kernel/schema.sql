-- OWNER: frozen contract. Copied verbatim from architecture-files/01-architecture/03-data-model.md.
-- Additions go in foundry_kernel/migrations/NNNN_<owner>_<what>.sql (new files only).

CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);

CREATE TABLE ventures (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  idea            TEXT NOT NULL,
  founder_name    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','running','paused','archived')),
  budget_usd      REAL NOT NULL DEFAULT 25.0,
  spent_usd       REAL NOT NULL DEFAULT 0.0,
  repo_full_name  TEXT,
  repo_url        TEXT,
  composio_user_id TEXT NOT NULL,
  settings_json   TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE files (
  id          TEXT PRIMARY KEY,
  venture_id  TEXT NOT NULL REFERENCES ventures(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  path        TEXT NOT NULL,
  excerpt     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);

CREATE TABLE departments (
  id           TEXT PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,         -- 'D01'..'D13'
  name         TEXT NOT NULL,
  mission      TEXT NOT NULL,
  building_id  TEXT NOT NULL UNIQUE,         -- 'b-<department id>'
  building_name TEXT NOT NULL,
  sort_order   INTEGER NOT NULL
);

CREATE TABLE agents (
  id            TEXT PRIMARY KEY,
  venture_id    TEXT REFERENCES ventures(id) ON DELETE CASCADE,  -- NULL = global roster
  department_id TEXT NOT NULL REFERENCES departments(id),
  display_name  TEXT NOT NULL,
  title         TEXT NOT NULL,
  role_summary  TEXT NOT NULL,
  model_job     TEXT NOT NULL,               -- key in models.py JOBS
  tools_json    TEXT NOT NULL DEFAULT '[]',
  persona       TEXT NOT NULL,
  voice_id      TEXT,                        -- ElevenLabs voice id
  face_json     TEXT,                        -- FaceSpec JSON (05-world/05)
  portrait_path TEXT,                        -- /generated/portraits/<id>.png (web static)
  npc_slot      TEXT NOT NULL,               -- slot id inside the building, or 'plaza.concierge'
  is_lead       INTEGER NOT NULL DEFAULT 0 CHECK (is_lead IN (0,1)),
  generated     INTEGER NOT NULL DEFAULT 0 CHECK (generated IN (0,1)),
  created_at    TEXT NOT NULL
);

CREATE TABLE agent_state (
  venture_id        TEXT NOT NULL REFERENCES ventures(id) ON DELETE CASCADE,
  agent_id          TEXT NOT NULL REFERENCES agents(id),
  status            TEXT NOT NULL DEFAULT 'idle'
                    CHECK (status IN ('idle','working','waiting','blocked')),
  current_ticket_id TEXT,
  last_active_at    TEXT,
  PRIMARY KEY (venture_id, agent_id)
);

CREATE TABLE tickets (
  id                TEXT PRIMARY KEY,
  venture_id        TEXT NOT NULL REFERENCES ventures(id) ON DELETE CASCADE,
  type              TEXT NOT NULL,           -- see 05-event-bus-and-orchestration.md
  department_id     TEXT NOT NULL REFERENCES departments(id),
  assigned_agent_id TEXT REFERENCES agents(id),
  title             TEXT NOT NULL,
  body              TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','in_progress','waiting_approval','blocked',
                                      'done','failed','cancelled')),
  priority          INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 3), -- 0 highest
  payload_json      TEXT NOT NULL DEFAULT '{}',
  result_json       TEXT,
  parent_ticket_id  TEXT REFERENCES tickets(id),
  generation        INTEGER NOT NULL DEFAULT 1,
  attempts          INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 3,
  created_by        TEXT NOT NULL,           -- agent id, 'human', or 'system'
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  started_at        TEXT,
  completed_at      TEXT
);
CREATE INDEX idx_tickets_venture_status ON tickets(venture_id, status);
CREATE INDEX idx_tickets_dept ON tickets(venture_id, department_id);

CREATE TABLE ticket_deps (
  ticket_id     TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  depends_on_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  PRIMARY KEY (ticket_id, depends_on_id)
);

CREATE TABLE runs (
  id                       TEXT PRIMARY KEY,
  venture_id               TEXT REFERENCES ventures(id) ON DELETE CASCADE,
  ticket_id                TEXT REFERENCES tickets(id),
  agent_id                 TEXT REFERENCES agents(id),
  kind                     TEXT NOT NULL CHECK (kind IN
                           ('ticket','talk','concierge','plan','check','worldgen','eval','watch',
                            'ask','standup','computer')),
  job                      TEXT NOT NULL,     -- models.py job key
  model                    TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'queued'
                           CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  input_text               TEXT NOT NULL DEFAULT '',
  output_text              TEXT,
  output_json              TEXT,
  error                    TEXT,
  interaction_id           TEXT,             -- Gemini Interactions API id
  previous_interaction_id  TEXT,
  tokens_in                INTEGER NOT NULL DEFAULT 0,
  tokens_out               INTEGER NOT NULL DEFAULT 0,
  cost_usd                 REAL NOT NULL DEFAULT 0.0,
  created_at               TEXT NOT NULL,
  started_at               TEXT,
  completed_at             TEXT
);
CREATE INDEX idx_runs_ticket ON runs(ticket_id);
CREATE INDEX idx_runs_venture ON runs(venture_id, created_at);

CREATE TABLE run_logs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id   TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  ts       TEXT NOT NULL,
  level    TEXT NOT NULL CHECK (level IN ('debug','info','warn','error')),
  message  TEXT NOT NULL
);
CREATE INDEX idx_run_logs_run ON run_logs(run_id, id);

CREATE TABLE artifacts (
  id            TEXT PRIMARY KEY,
  venture_id    TEXT NOT NULL REFERENCES ventures(id) ON DELETE CASCADE,
  ticket_id     TEXT REFERENCES tickets(id),
  run_id        TEXT REFERENCES runs(id),
  agent_id      TEXT REFERENCES agents(id),
  department_id TEXT NOT NULL REFERENCES departments(id),
  kind          TEXT NOT NULL CHECK (kind IN
                ('brief','spec','plan','research','report','decision','doc','code','pr',
                 'build','preview','test_report','budget','dataset')),
  title         TEXT NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',
  content_md    TEXT NOT NULL DEFAULT '',
  uri           TEXT,                       -- PR URL, preview URL, file path
  meta_json     TEXT NOT NULL DEFAULT '{}',
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_artifacts_venture ON artifacts(venture_id, created_at);

CREATE TABLE approvals (
  id                     TEXT PRIMARY KEY,
  venture_id             TEXT NOT NULL REFERENCES ventures(id) ON DELETE CASCADE,
  ticket_id              TEXT REFERENCES tickets(id),
  run_id                 TEXT REFERENCES runs(id),
  requested_by_agent_id  TEXT REFERENCES agents(id),
  gate_type              TEXT NOT NULL CHECK (gate_type IN
                         ('clarification','pivot','spend','outreach','merge','deploy',
                          'integration','new_capability','computer_action')),
  title                  TEXT NOT NULL,
  summary                TEXT NOT NULL,
  payload_json           TEXT NOT NULL DEFAULT '{}',
  status                 TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','approved','rejected','expired')),
  decided_by             TEXT,
  decision_note          TEXT,
  created_at             TEXT NOT NULL,
  decided_at             TEXT
);
CREATE INDEX idx_approvals_venture_status ON approvals(venture_id, status);

CREATE TABLE channels (
  id            TEXT PRIMARY KEY,
  venture_id    TEXT NOT NULL REFERENCES ventures(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,              -- 'all-hands', 'exec', 'dept-engineering', ...
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('all_hands','exec','department','incident')),
  department_id TEXT REFERENCES departments(id),
  created_at    TEXT NOT NULL,
  UNIQUE (venture_id, slug)
);

CREATE TABLE messages (
  id           TEXT PRIMARY KEY,
  venture_id   TEXT NOT NULL REFERENCES ventures(id) ON DELETE CASCADE,
  channel_id   TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_kind  TEXT NOT NULL CHECK (author_kind IN ('agent','human','system')),
  author_id    TEXT NOT NULL,
  body         TEXT NOT NULL,
  refs_json    TEXT NOT NULL DEFAULT '[]',   -- [{kind,id}] links to tickets/artifacts/approvals
  thread_root_id TEXT REFERENCES messages(id),  -- NULL = top-level message
  meta_json    TEXT NOT NULL DEFAULT '{}',   -- {"kind": "status|delegation|handoff|request|ask|answer|standup_update|decision|gate|announcement|incident|human|reply"}
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_messages_channel ON messages(channel_id, created_at);
CREATE INDEX idx_messages_thread ON messages(thread_root_id, created_at);

CREATE TABLE computers (
  id            TEXT PRIMARY KEY,               -- cmp_<ULID>
  venture_id    TEXT NOT NULL REFERENCES ventures(id) ON DELETE CASCADE,
  agent_id      TEXT NOT NULL REFERENCES agents(id),
  provider      TEXT NOT NULL CHECK (provider IN ('cua_sandbox','cua_space')),
  external_ref  TEXT,                           -- Cua sandbox/Space name or id
  status        TEXT NOT NULL CHECK (status IN ('starting','ready','busy','stopped','error')),
  image         TEXT NOT NULL,
  watch_url     TEXT,                           -- Spaces shared-desktop link (VERIFY)
  last_screenshot_path TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (venture_id, agent_id)
);

CREATE TABLE computer_tasks (
  id            TEXT PRIMARY KEY,               -- ctk_<ULID>
  venture_id    TEXT NOT NULL REFERENCES ventures(id) ON DELETE CASCADE,
  computer_id   TEXT NOT NULL REFERENCES computers(id),
  ticket_id     TEXT REFERENCES tickets(id),
  agent_id      TEXT NOT NULL REFERENCES agents(id),
  goal          TEXT NOT NULL,
  allowed_domains_json TEXT NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','waiting_approval','stopped')),
  steps         INTEGER NOT NULL DEFAULT 0,
  result_json   TEXT,
  created_at    TEXT NOT NULL,
  completed_at  TEXT
);

CREATE TABLE computer_actions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id         TEXT NOT NULL REFERENCES computer_tasks(id) ON DELETE CASCADE,
  step            INTEGER NOT NULL,
  action_json     TEXT NOT NULL,
  reason          TEXT NOT NULL DEFAULT '',
  guard           TEXT NOT NULL CHECK (guard IN ('allow','gate','block')),
  screenshot_path TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_computer_actions_task ON computer_actions(task_id, step);

CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  venture_id  TEXT,
  type        TEXT NOT NULL,                 -- see SSE catalogue
  entity_kind TEXT,
  entity_id   TEXT,
  level       TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('debug','info','warn','error')),
  data_json   TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_events_venture ON events(venture_id, id);

CREATE TABLE ledger (
  id            TEXT PRIMARY KEY,
  venture_id    TEXT REFERENCES ventures(id) ON DELETE CASCADE,
  run_id        TEXT REFERENCES runs(id),
  department_id TEXT REFERENCES departments(id),
  agent_id      TEXT REFERENCES agents(id),
  kind          TEXT NOT NULL CHECK (kind IN ('model','tts','stt','image','tool')),
  model         TEXT,
  units_in      INTEGER NOT NULL DEFAULT 0,   -- tokens or characters
  units_out     INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL NOT NULL,
  estimated     INTEGER NOT NULL DEFAULT 1 CHECK (estimated IN (0,1)),
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_ledger_venture ON ledger(venture_id, created_at);

CREATE TABLE integrations (
  id           TEXT PRIMARY KEY,
  venture_id   TEXT NOT NULL REFERENCES ventures(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL CHECK (provider IN ('github')),
  status       TEXT NOT NULL CHECK (status IN ('not_connected','pending','active','error')),
  account_ref  TEXT,                          -- Composio connected_account_id
  data_json    TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (venture_id, provider)
);

CREATE TABLE github_seen (
  venture_id   TEXT NOT NULL REFERENCES ventures(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('issue','pr_comment')),
  external_id  TEXT NOT NULL,
  seen_at      TEXT NOT NULL,
  PRIMARY KEY (venture_id, kind, external_id)
);

CREATE TABLE answers (
  id             TEXT PRIMARY KEY,
  venture_id     TEXT NOT NULL REFERENCES ventures(id) ON DELETE CASCADE,
  agent_id       TEXT NOT NULL REFERENCES agents(id),
  run_id         TEXT REFERENCES runs(id),
  question       TEXT NOT NULL,
  answer         TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  check_status   TEXT NOT NULL DEFAULT 'pending'
                 CHECK (check_status IN ('pending','verified','partial','unsupported','error')),
  check_json     TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL,
  checked_at     TEXT
);

CREATE TABLE worldgen_runs (
  id           TEXT PRIMARY KEY,
  status       TEXT NOT NULL CHECK (status IN ('running','succeeded','failed')),
  iterations   INTEGER NOT NULL DEFAULT 0,
  final_score  REAL,
  data_path    TEXT NOT NULL,                 -- kernel/data/worldgen/runs/<id>
  started_at   TEXT NOT NULL,
  finished_at  TEXT
);

CREATE TABLE worldgen_iterations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id       TEXT NOT NULL REFERENCES worldgen_runs(id) ON DELETE CASCADE,
  iteration    INTEGER NOT NULL,
  building_id  TEXT NOT NULL,
  probe_json   TEXT NOT NULL,
  critic_json  TEXT NOT NULL DEFAULT '{}',
  score        REAL NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE eval_results (
  id           TEXT PRIMARY KEY,
  suite        TEXT NOT NULL CHECK (suite IN ('engineering','grounding','world')),
  case_id      TEXT NOT NULL,
  condition    TEXT NOT NULL,                 -- 'baseline' | 'loop' | 'default'
  metrics_json TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE kv (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

INSERT INTO schema_version (version) VALUES (1);
