-- Railway PostgreSQL draft; not applied. Requires database provision and review.
CREATE TABLE IF NOT EXISTS lucky_players (
 uid TEXT PRIMARY KEY,
 display_name VARCHAR(50) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lucky_vip_entitlements (
 uid TEXT PRIMARY KEY REFERENCES lucky_players(uid),
 status TEXT NOT NULL CHECK (status IN ('active','revoked')),
 expires_at TIMESTAMPTZ NOT NULL,
 grant_ref TEXT NOT NULL UNIQUE,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lucky_rooms (
 room_id TEXT PRIMARY KEY,
 mode TEXT NOT NULL CHECK (mode IN ('free','vip')),
 seats JSONB NOT NULL,
 game JSONB NOT NULL,
 deadline_ms BIGINT,
 revision BIGINT NOT NULL DEFAULT 0,
 status TEXT NOT NULL CHECK (status IN ('playing','finished')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lucky_score_events (
 event_id TEXT PRIMARY KEY,
 uid TEXT NOT NULL REFERENCES lucky_players(uid),
 mode TEXT NOT NULL CHECK (mode IN ('free','vip')),
 game_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('win','lucky_box','admin')),
 points INTEGER NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lucky_score_events_recent
ON lucky_score_events (mode,created_at DESC,uid);
