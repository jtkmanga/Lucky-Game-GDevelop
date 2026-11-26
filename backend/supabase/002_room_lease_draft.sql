-- DRAFT ONLY. Not applied. Must run after 001_game_private_schema.sql.
-- Room ownership fencing for future multi-process recovery.
-- A lease is only a claim to mutate; every write must also be fenced with
-- lease_epoch AND owner ID in the same PostgreSQL transaction.
BEGIN;
ALTER TABLE game.rooms
 ADD COLUMN IF NOT EXISTS lease_owner UUID,
 ADD COLUMN IF NOT EXISTS lease_epoch BIGINT NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ;
ALTER TABLE game.rooms
 ADD CONSTRAINT game_rooms_lease_consistency CHECK (
  (lease_owner IS NULL AND lease_until IS NULL)
  OR (lease_owner IS NOT NULL AND lease_until IS NOT NULL)
 );
CREATE INDEX IF NOT EXISTS game_rooms_recovery_index
 ON game.rooms(status,lease_until,updated_at)
 WHERE status='playing';
COMMIT;

-- Operators must verify the current schema first; ADD CONSTRAINT is not
-- idempotent if already present. This file must NOT be applied twice blindly.
-- No client GRANTs and no RLS changes: private game schema remains restricted.
