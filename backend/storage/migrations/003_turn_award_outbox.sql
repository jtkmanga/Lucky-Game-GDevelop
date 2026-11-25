-- Draft additive migration 003. Apply after 002_room_checkpoints.sql.
-- Transactional transition receipts and score-award outbox.
-- NO live database migration has been performed.
--
-- The FK from the transition marker to a receipt forces D1.batch to roll
-- back if an optimistic UPDATE did not advance the expected room revision.
-- All writes must occur in ONE db.batch call; do not split across requests.

CREATE TABLE IF NOT EXISTS room_revision_receipts (
  room_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  saved_at_ms INTEGER NOT NULL,
  PRIMARY KEY(room_id,revision),
  FOREIGN KEY(room_id) REFERENCES game_room_checkpoints(room_id)
);

CREATE TRIGGER IF NOT EXISTS room_revision_receipt_trigger
AFTER UPDATE OF revision ON game_room_checkpoints
WHEN NEW.revision = OLD.revision + 1
BEGIN
  INSERT INTO room_revision_receipts(room_id,revision,saved_at_ms)
  VALUES(NEW.room_id,NEW.revision,NEW.saved_at_ms);
END;

CREATE TABLE IF NOT EXISTS room_transition_markers (
  room_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY(room_id,revision),
  FOREIGN KEY(room_id,revision)
    REFERENCES room_revision_receipts(room_id,revision)
);

CREATE TABLE IF NOT EXISTS score_award_outbox (
  event_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  game_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('free','vip')),
  uid TEXT NOT NULL REFERENCES players(uid),
  kind TEXT NOT NULL CHECK(kind IN ('game_win','lucky_box')),
  points INTEGER NOT NULL CHECK(points BETWEEN 1 AND 10000),
  created_at_ms INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','applied')),
  applied_at_ms INTEGER,
  FOREIGN KEY(room_id,revision)
    REFERENCES room_transition_markers(room_id,revision)
);

CREATE INDEX IF NOT EXISTS idx_score_award_outbox_pending
  ON score_award_outbox(status,created_at_ms,event_id);

-- At most one winner and one Lucky Box award per game, even with retries.
CREATE UNIQUE INDEX IF NOT EXISTS idx_score_outbox_one_win
  ON score_award_outbox(game_id) WHERE kind='game_win';
CREATE UNIQUE INDEX IF NOT EXISTS idx_score_outbox_one_box
  ON score_award_outbox(game_id) WHERE kind='lucky_box';
