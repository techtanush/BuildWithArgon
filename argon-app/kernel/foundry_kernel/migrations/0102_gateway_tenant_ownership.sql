-- Additive; legacy rows remain owner-null and never claimed by first sign-in.
ALTER TABLE ventures ADD COLUMN owner_user_id TEXT;
CREATE INDEX idx_ventures_owner_created ON ventures(owner_user_id, created_at, id);
