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
\echo 'PRECHECK: restricted account, permissions, and fixture absence'
BEGIN;
SET LOCAL statement_timeout='5s';
SET LOCAL lock_timeout='2s';
DO $test_guard$
BEGIN
 IF current_user <> 'lucky_game_server_login' OR session_user <> 'lucky_game_server_login' THEN
   RAISE EXCEPTION 'WRONG_DATABASE_IDENTITY';
 END IF;
 IF NOT has_schema_privilege(current_user,'game','USAGE')
    OR NOT has_table_privilege(current_user,'game.rooms','SELECT')
    OR NOT has_table_privilege(current_user,'game.rooms','INSERT')
    OR NOT has_table_privilege(current_user,'game.rooms','UPDATE') THEN
   RAISE EXCEPTION 'MISSING_RESTRICTED_ROOM_PERMISSIONS';
 END IF;
 IF has_table_privilege(current_user,'game.orders','SELECT')
    OR has_table_privilege(current_user,'game.rooms','DELETE') THEN
   RAISE EXCEPTION 'UNEXPECTED_PRIVILEGE';
 END IF;
 IF EXISTS(SELECT 1 FROM game.rooms
           WHERE room_id='71b0a4c9-406b-4628-9a75-72c0d36a65d1'::uuid) THEN
   RAISE EXCEPTION 'TEST_UUID_ALREADY_PRESENT';
 END IF;
END
$test_guard$;
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
DO $post_guard$
BEGIN
 IF EXISTS (SELECT 1 FROM game.rooms WHERE room_id='71b0a4c9-406b-4628-9a75-72c0d36a65d1'::uuid) THEN
   RAISE EXCEPTION 'ROLLBACK_RESIDUE_DETECTED';
 END IF;
END
$post_guard$;
