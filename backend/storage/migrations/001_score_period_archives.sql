-- Draft additive migration for period snapshots.
-- DO NOT apply to existing databases without an approved migration plan.
-- Current canonical ledger in backend/storage/schema.sql remains append-only.
CREATE TABLE IF NOT EXISTS leaderboard_period_archives (
  mode TEXT NOT NULL CHECK(mode IN ('free','vip')),
  period_start_ms INTEGER NOT NULL,
  period_end_ms INTEGER NOT NULL,
  archived_at_ms INTEGER NOT NULL,
  entry_count INTEGER NOT NULL CHECK(entry_count >= 0),
  PRIMARY KEY(mode,period_start_ms),
  CHECK(period_end_ms > period_start_ms)
);

CREATE TABLE IF NOT EXISTS leaderboard_snapshot_entries (
  mode TEXT NOT NULL CHECK(mode IN ('free','vip')),
  period_start_ms INTEGER NOT NULL,
  uid TEXT NOT NULL,
  display_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  ranking INTEGER NOT NULL CHECK(ranking >= 1),
  PRIMARY KEY(mode,period_start_ms,uid),
  UNIQUE(mode,period_start_ms,ranking),
  FOREIGN KEY(mode,period_start_ms)
    REFERENCES leaderboard_period_archives(mode,period_start_ms)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_snapshot_rank
  ON leaderboard_snapshot_entries(mode,period_start_ms,ranking);
