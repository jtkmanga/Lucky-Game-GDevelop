-- Lucky Game migration 004 PROPOSAL ONLY. NOT APPROVED OR APPLIED.
-- Scoped to the server-only Railway runtime privilege bundle.
-- Execute only after separate explicit owner authorization and security review.
-- NO PASSWORDS. NO LOGIN ROLE. NO BROWSER GRANTS.
-- Owner's dashboard confirms schema game excluded from Data API (2026-11-26).
BEGIN;

-- Fail closed on name collision rather than changing an existing unrelated role.
DO $check$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lucky_game_runtime') THEN
  RAISE EXCEPTION 'Role lucky_game_runtime already exists; review before continuing';
 END IF;
END
$check$;

CREATE ROLE lucky_game_runtime
 NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
 NOBYPASSRLS INHERIT;

GRANT USAGE ON SCHEMA game TO lucky_game_runtime;
GRANT SELECT, INSERT, UPDATE ON game.players TO lucky_game_runtime;
GRANT SELECT ON game.vip_entitlements TO lucky_game_runtime;
GRANT SELECT, INSERT, UPDATE ON game.rooms TO lucky_game_runtime;
GRANT SELECT, INSERT ON game.score_events TO lucky_game_runtime;
GRANT SELECT, INSERT ON game.turn_receipts TO lucky_game_runtime;

-- All game tables remain RLS enabled. These policies are ONLY for the
-- dedicated trusted server privilege bundle, not anon/authenticated/PUBLIC.
-- The server performs all player authorization before queries.
CREATE POLICY lucky_runtime_players_read ON game.players
 FOR SELECT TO lucky_game_runtime USING (true);
CREATE POLICY lucky_runtime_players_create ON game.players
 FOR INSERT TO lucky_game_runtime WITH CHECK (true);
CREATE POLICY lucky_runtime_players_update ON game.players
 FOR UPDATE TO lucky_game_runtime USING (true) WITH CHECK (true);

CREATE POLICY lucky_runtime_vip_read ON game.vip_entitlements
 FOR SELECT TO lucky_game_runtime USING (true);

CREATE POLICY lucky_runtime_rooms_read ON game.rooms
 FOR SELECT TO lucky_game_runtime USING (true);
CREATE POLICY lucky_runtime_rooms_create ON game.rooms
 FOR INSERT TO lucky_game_runtime WITH CHECK (true);
CREATE POLICY lucky_runtime_rooms_update ON game.rooms
 FOR UPDATE TO lucky_game_runtime USING (true) WITH CHECK (true);

CREATE POLICY lucky_runtime_score_read ON game.score_events
 FOR SELECT TO lucky_game_runtime USING (true);
CREATE POLICY lucky_runtime_score_create ON game.score_events
 FOR INSERT TO lucky_game_runtime WITH CHECK (true);

CREATE POLICY lucky_runtime_receipts_read ON game.turn_receipts
 FOR SELECT TO lucky_game_runtime USING (true);
CREATE POLICY lucky_runtime_receipts_create ON game.turn_receipts
 FOR INSERT TO lucky_game_runtime WITH CHECK (true);

-- No grants on game.orders, game.admin_audit, game.leaderboard_archives.
-- No LOGIN credentials or role membership is created here.
-- Creating a separate login, role membership, password and Railway secret
-- is a later separately approved operation, not part of this migration.
COMMIT;
