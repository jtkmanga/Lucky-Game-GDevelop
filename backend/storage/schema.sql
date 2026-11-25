-- Lucky Game prototype persistence schema (Cloudflare D1 / SQLite).
-- Not applied to any live database. Requires migration review before deployment.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS players (
  uid TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  display_name_key TEXT NOT NULL UNIQUE,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS score_ledger (
  event_id TEXT PRIMARY KEY,
  uid TEXT NOT NULL REFERENCES players(uid),
  mode TEXT NOT NULL CHECK (mode IN ('free', 'vip')),
  points INTEGER NOT NULL CHECK (points BETWEEN -1000000 AND 1000000),
  reason TEXT NOT NULL CHECK (reason IN ('game_win', 'lucky_box', 'admin_adjustment')),
  game_id TEXT,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_score_ledger_uid_mode
  ON score_ledger(uid, mode, created_at_ms);

CREATE TABLE IF NOT EXISTS vip_entitlements (
  uid TEXT PRIMARY KEY REFERENCES players(uid),
  tier TEXT NOT NULL DEFAULT 'vip' CHECK (tier = 'vip'),
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  expires_at_ms INTEGER NOT NULL,
  grant_ref TEXT NOT NULL UNIQUE,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS game_results (
  game_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('free', 'vip')),
  winner_uid TEXT NOT NULL REFERENCES players(uid),
  completed_at_ms INTEGER NOT NULL
);
