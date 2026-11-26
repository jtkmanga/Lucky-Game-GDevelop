-- Lucky Game P1 — proposed restricted-login RLS transaction check.
-- SOURCE ONLY / NOT RUN / DO NOT APPLY AS SUPABASE MIGRATION.
-- Requires explicit authorization for a bounded write + ROLLBACK test.
-- Only execute using `lucky_game_server_login` over verified TLS in the existing Codespace.
-- The CLI invocation must be psql -X -v ON_ERROR_STOP=1 -P pager=off -f <this-file>.
-- Never connect as postgres to claim restricted RLS success.
-- If a statement fails, ON_ERROR_STOP ends the psql session; PostgreSQL rolls back
-- the open transaction when that session closes. Check post-state separately.
\set ON_ERROR_STOP on
\set AUTOCOMMIT on
\echo 'PRECHECK: restricted login identity'
SELECT current_user AS login_name, session_user AS session_name,
       has_schema_privilege(current_user,'game','USAGE') AS game_usage,
       has_table_privilege(current_user,'game.rooms','INSERT') AS room_insert_allowed,
       has_table_privilege(current_user,'game.rooms','UPDATE') AS room_update_allowed;
-- Reserve a fixed nonproduction UUID. This must not exist in the table already.
SELECT count(*) AS existing_test_rows
FROM game.rooms
WHERE room_id='71b0a4c9-406b-4628-9a75-72c0d36a65d1'::uuid;
-- If existing_test_rows is nonzero STOP; the insert will fail safely on collision.
BEGIN;
SET LOCAL statement_timeout='5s';
SET LOCAL lock_timeout='2s';
-- This row is intentionally only a DB permissions fixture, not a playable room.
INSERT INTO game.rooms
 (room_id,mode,seats,game_state,deadline_ms,revision,status)
VALUES
 ('71b0a4c9-406b-4628-9a75-72c0d36a65d1'::uuid,
  'free','[]'::jsonb,'{}'::jsonb,NULL,0,'playing')
RETURNING room_id,mode,revision,status;
UPDATE game.rooms
 SET revision=1,updated_at=now()
 WHERE room_id='71b0a4c9-406b-4628-9a75-72c0d36a65d1'::uuid AND revision=0
 RETURNING room_id,revision;
SELECT room_id,revision
FROM game.rooms
WHERE room_id='71b0a4c9-406b-4628-9a75-72c0d36a65d1'::uuid;
ROLLBACK;
-- The check below must be zero; never run DELETE as a cleanup workaround.
SELECT count(*) AS remaining_test_rows
FROM game.rooms
WHERE room_id='71b0a4c9-406b-4628-9a75-72c0d36a65d1'::uuid;
