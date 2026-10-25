-- OWNER: tanush
CREATE TABLE agent_wallets (
 id TEXT PRIMARY KEY,
 venture_id TEXT NOT NULL REFERENCES ventures(id),
 agent_id TEXT NOT NULL REFERENCES agents(id),
 external_id TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL CHECK(status IN ('pending_approval','provisioning','ready','error')),
 wallet_id TEXT,
 address TEXT,
 approval_id TEXT REFERENCES approvals(id),
 network TEXT NOT NULL CHECK(network='base-sepolia'),
 claim_token TEXT,
 lease_expires_at TEXT,
 error TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(venture_id,agent_id)
);
