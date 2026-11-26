-- Lucky Game / Supabase PostgreSQL DRAFT ONLY.
-- Not applied to the connected Supabase project. Review privileges and backup before migration.
-- Private game schema must NOT be exposed in Supabase Data API settings.
BEGIN;
CREATE SCHEMA IF NOT EXISTS game;
REVOKE ALL ON SCHEMA game FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS game.players (
 uid UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
 display_name VARCHAR(50) NOT NULL CHECK (char_length(trim(display_name)) BETWEEN 2 AND 50),
 name_key TEXT NOT NULL UNIQUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS game.vip_entitlements (
 uid UUID PRIMARY KEY REFERENCES game.players(uid) ON DELETE CASCADE,
 status TEXT NOT NULL CHECK(status IN ('active','revoked')),
 expires_at TIMESTAMPTZ NOT NULL,
 grant_ref TEXT NOT NULL UNIQUE,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS game.rooms (
 room_id UUID PRIMARY KEY,
 mode TEXT NOT NULL CHECK(mode IN ('free','vip')),
 seats JSONB NOT NULL CHECK (jsonb_typeof(seats)='array'),
 game_state JSONB NOT NULL CHECK(jsonb_typeof(game_state)='object'),
 deadline_ms BIGINT,
 revision BIGINT NOT NULL DEFAULT 0 CHECK(revision>=0),
 status TEXT NOT NULL CHECK(status IN ('playing','finished','closed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS game.score_events (
 event_id TEXT PRIMARY KEY,
 uid UUID NOT NULL REFERENCES game.players(uid),
 mode TEXT NOT NULL CHECK(mode IN ('free','vip')),
 game_id UUID NOT NULL REFERENCES game.rooms(room_id),
 kind TEXT NOT NULL CHECK(kind IN ('win','lucky_box','admin')),
 points INTEGER NOT NULL CHECK (points BETWEEN -1000000 AND 1000000),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS score_events_one_award_per_game
 ON game.score_events(game_id,kind) WHERE kind IN ('win','lucky_box');
CREATE INDEX IF NOT EXISTS score_events_time_idx ON game.score_events (mode,created_at,uid);
CREATE TABLE IF NOT EXISTS game.leaderboard_archives (
 mode TEXT NOT NULL CHECK(mode IN ('free','vip')),
 period_start_ms BIGINT NOT NULL,
 period_end_ms BIGINT NOT NULL,
 snapshot JSONB NOT NULL CHECK(jsonb_typeof(snapshot)='array'),
 archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (mode,period_start_ms),
 CHECK(period_end_ms > period_start_ms)
);
CREATE TABLE IF NOT EXISTS game.orders (
 order_id UUID PRIMARY KEY,
 uid UUID NOT NULL REFERENCES game.players(uid),
 product_code TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','paid','cancelled','refunded')),
 provider_reference TEXT UNIQUE,
 amount_minor BIGINT NOT NULL CHECK(amount_minor>=0),
 currency VARCHAR(3) NOT NULL DEFAULT 'THB',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 paid_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS game.admin_audit (
 audit_id UUID PRIMARY KEY,
 actor_uid UUID REFERENCES game.players(uid),
 action TEXT NOT NULL,
 subject_uid UUID REFERENCES game.players(uid),
 details JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS as a second barrier; server uses trusted, non-browser database connection.
ALTER TABLE game.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE game.vip_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE game.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE game.score_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE game.leaderboard_archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE game.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE game.admin_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE game.players, game.vip_entitlements, game.rooms,
 game.score_events, game.leaderboard_archives, game.orders, game.admin_audit
 FROM PUBLIC, anon, authenticated;
-- No client SELECT/INSERT/UPDATE/DELETE policies. Application tables stay inaccessible through anon/authenticated.
COMMIT;

-- NOT INCLUDED: any GRANT to client roles, payment/admin functions, scheduled reset jobs, and data changes.
-- Migration must be reviewed before applying; no rollback is automatically executed.
