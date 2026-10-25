-- OWNER: ayan — World Lab live rounds (05-world/13 §2). One row per round; the full LiveRound JSON is mirrored in
-- round_json (files under kernel/data/worldgen/live/<round_id>/ are the evidence).
CREATE TABLE IF NOT EXISTS worldgen_live_rounds (
  id            TEXT PRIMARY KEY,               -- wlr_<ULID>
  department_id TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('queued','capturing','critiquing','patching','validating',
                                                'recapturing','scoring','done','failed')),
  fast          INTEGER NOT NULL DEFAULT 1 CHECK (fast IN (0,1)),
  promoted      INTEGER NOT NULL DEFAULT 0 CHECK (promoted IN (0,1)),
  data_path     TEXT NOT NULL,
  round_json    TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL,
  finished_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_worldgen_live_rounds_created ON worldgen_live_rounds(created_at);
