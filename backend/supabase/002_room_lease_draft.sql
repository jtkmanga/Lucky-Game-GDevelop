-- DRAFT ONLY. NOT APPLIED. Must run after 001_game_private_schema.sql.
-- Intended to be repeat-safe for an identical schema; review existing objects
-- and permissions before any approved application.
BEGIN;
ALTER TABLE game.rooms
 ADD COLUMN IF NOT EXISTS lease_owner UUID,
 ADD COLUMN IF NOT EXISTS lease_epoch BIGINT NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ;
-- A named CHECK constraint has no ADD CONSTRAINT IF NOT EXISTS syntax.
-- When an existing constraint has the same name, fail if its definition differs
-- rather than accidentally treating an incompatible schema as compatible.
DO $migration$
DECLARE existing_definition text;
BEGIN
 SELECT pg_get_constraintdef(c.oid) INTO existing_definition
 FROM pg_constraint c
 WHERE c.conrelid='game.rooms'::regclass
   AND c.conname='game_rooms_lease_consistency';
 IF existing_definition IS NULL THEN
  ALTER TABLE game.rooms ADD CONSTRAINT game_rooms_lease_consistency CHECK (
   (lease_owner IS NULL AND lease_until IS NULL)
   OR (lease_owner IS NOT NULL AND lease_until IS NOT NULL)
  );
 ELSIF regexp_replace(lower(existing_definition), '[[:space:]()]', '', 'g')
   <> 'checklease_ownerisnullandlease_untilisnullorlease_ownerisnotnullandlease_untilisnotnull' THEN
  RAISE EXCEPTION 'Conflicting game_rooms_lease_consistency definition: %', existing_definition;
 END IF;
END
$migration$;
CREATE INDEX IF NOT EXISTS game_rooms_recovery_index
 ON game.rooms(status,lease_until,updated_at)
 WHERE status='playing';
COMMIT;
-- IMPORTANT: Existing index columns/privileges and constraint normalization still
-- require inspection. Not a replacement for schema diff or authorized DB tests.
-- No client GRANTs; the private game schema remains restricted.
