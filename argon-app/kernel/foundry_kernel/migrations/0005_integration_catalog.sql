-- Preserve all integration rows; allow toolkit-specific connections beyond GitHub.
CREATE TABLE integrations_catalog_upgrade (
  id TEXT PRIMARY KEY,
  venture_id TEXT NOT NULL REFERENCES ventures(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 100 AND provider NOT GLOB '*[^a-z0-9_-]*'),
  status TEXT NOT NULL CHECK (status IN ('not_connected','pending','active','error')),
  account_ref TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (venture_id, provider)
);
INSERT INTO integrations_catalog_upgrade SELECT id,venture_id,provider,status,account_ref,data_json,created_at,updated_at FROM integrations;
DROP TABLE integrations;
ALTER TABLE integrations_catalog_upgrade RENAME TO integrations;
