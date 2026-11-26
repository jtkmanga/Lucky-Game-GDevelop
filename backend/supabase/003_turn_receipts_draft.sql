-- DRAFT SOURCE ONLY. NOT APPLIED. Requires 001 and 002 first.
-- Every successful authoritative room revision has exactly one durable
-- receipt. The receipt is written in the SAME transaction as room update and
-- reward inserts; outbox delivery is NOT implemented or claimed here.
BEGIN;
CREATE TABLE IF NOT EXISTS game.turn_receipts (
 room_id UUID NOT NULL REFERENCES game.rooms(room_id) ON DELETE RESTRICT,
 revision BIGINT NOT NULL CHECK (revision>0),
 previous_revision BIGINT NOT NULL CHECK (previous_revision>=0 AND previous_revision+1=revision),
 lease_epoch BIGINT NOT NULL CHECK (lease_epoch>=1),
 event_type TEXT NOT NULL CHECK(event_type IN ('roll','timeout')),
 actor_index INTEGER NOT NULL CHECK(actor_index>=0),
 roll INTEGER CHECK(roll BETWEEN 1 AND 6),
 outcome JSONB NOT NULL CHECK(jsonb_typeof(outcome)='object'),
 game_state JSONB NOT NULL CHECK(jsonb_typeof(game_state)='object'),
 award_events JSONB NOT NULL CHECK(jsonb_typeof(award_events)='array'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(room_id,revision),
 CHECK ((event_type='timeout' AND roll IS NULL) OR
        (event_type='roll' AND roll IS NOT NULL AND roll BETWEEN 1 AND 6))
);
CREATE INDEX IF NOT EXISTS turn_receipts_created_idx
 ON game.turn_receipts(created_at,room_id);
ALTER TABLE game.turn_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE game.turn_receipts FROM PUBLIC,anon,authenticated;
COMMIT;
-- No Supabase anon/authenticated access, no RPC, no automatic outbox worker.
-- Creation is repeat-aware only when prior table definition is identical;
-- CREATE TABLE IF NOT EXISTS does not guarantee compatibility. Inspect before
-- applying and do not apply silently.
