-- OWNER: tanush
CREATE TABLE wallet_spending_policies (
 id TEXT PRIMARY KEY,
 venture_id TEXT NOT NULL REFERENCES ventures(id),
 agent_id TEXT NOT NULL REFERENCES agents(id),
 wallet_intent_id TEXT NOT NULL REFERENCES agent_wallets(id),
 wallet_id TEXT NOT NULL,
 policy_json TEXT NOT NULL,
 policy_hash TEXT NOT NULL,
 approval_id TEXT REFERENCES approvals(id),
 revoked_at TEXT,
 created_at TEXT NOT NULL,
 UNIQUE(wallet_intent_id,policy_hash)
);
CREATE TABLE wallet_payments (
 id TEXT PRIMARY KEY,
 venture_id TEXT NOT NULL REFERENCES ventures(id),
 agent_id TEXT NOT NULL REFERENCES agents(id),
 wallet_intent_id TEXT NOT NULL REFERENCES agent_wallets(id),
 policy_id TEXT NOT NULL REFERENCES wallet_spending_policies(id),
 chain_id INTEGER NOT NULL CHECK(chain_id IN (84532,8453)),
 recipient TEXT NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 purpose TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 idempotency_hash TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 run_id TEXT REFERENCES runs(id),
 status TEXT NOT NULL CHECK(status IN ('preparing','dispatching','submitted','confirmed','reverted','failed','uncertain')),
 transaction_json TEXT,
 tx_hash TEXT,
 provider_transaction_id TEXT,
 receipt_json TEXT,
 reserved_day TEXT NOT NULL,
 claim_token TEXT,
 lease_expires_at TEXT,
 error TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(wallet_intent_id,idempotency_hash)
);
CREATE INDEX wallet_payment_reservations ON wallet_payments(wallet_intent_id,status,created_at);
