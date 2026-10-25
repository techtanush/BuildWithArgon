-- OWNER: tanush
CREATE TABLE treasury_proposals (
 id TEXT PRIMARY KEY,
 venture_id TEXT NOT NULL REFERENCES ventures(id),
 agent_id TEXT NOT NULL REFERENCES agents(id),
 amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
 currency TEXT NOT NULL CHECK(currency = 'USD'),
 recipient TEXT NOT NULL,
 purpose TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 idempotency_hash TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending_approval','approved_pending_provider','rejected')),
 approval_id TEXT REFERENCES approvals(id),
 reserved_day TEXT NOT NULL,
 created_at TEXT NOT NULL,
 decided_at TEXT,
 UNIQUE(venture_id,idempotency_hash)
);
CREATE INDEX treasury_reservations ON treasury_proposals(venture_id,reserved_day,status);
