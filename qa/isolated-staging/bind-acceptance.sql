-- Operator bootstrap for a separately provisioned, verified fresh Supabase
-- project only. Not a production migration or a way to bind a shared project.
-- The operator must verify the target project ref independently before running.
-- Use the SQL editor's explicit project context or psql with TLS verification.
-- psql variables: project_ref, room_id, cutoff_ms. Never pass a real secret here.
\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE game.staging_acceptance_binding(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 project_ref text NOT NULL CHECK(project_ref ~ '^[a-z0-9]{10,32}$' AND project_ref <> 'llbkxnazkliskzcureec'),
 room_id uuid NOT NULL,
 cutoff_ms bigint NOT NULL CHECK(cutoff_ms > 0)
);
-- The owner/bootstrap role runs this, not the Railway role. A non-empty game
-- database refuses binding. Run offline before enabling Auth or Railway.
INSERT INTO game.staging_acceptance_binding(project_ref, room_id, cutoff_ms)
VALUES (
 CASE WHEN EXISTS (SELECT FROM game.players) OR EXISTS (SELECT FROM game.rooms)
        OR EXISTS (SELECT FROM game.score_events) OR EXISTS (SELECT FROM game.turn_receipts)
      THEN NULL ELSE :'project_ref' END,
 :'room_id'::uuid, :'cutoff_ms'::bigint
);
ALTER TABLE game.staging_acceptance_binding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game.staging_acceptance_binding FROM PUBLIC, anon, authenticated, lucky_game_runtime, lucky_game_server_login;
GRANT SELECT ON game.staging_acceptance_binding TO lucky_game_runtime;
CREATE POLICY lucky_runtime_acceptance_binding_read ON game.staging_acceptance_binding
 FOR SELECT TO lucky_game_runtime USING (true);
COMMIT;
