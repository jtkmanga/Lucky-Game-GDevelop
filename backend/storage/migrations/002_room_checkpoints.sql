-- Draft migration 002: authoritative room checkpoints.
-- Apply only after the selected persistent SQL provider has been reviewed.
-- Game JSON must never contain authentication ID tokens, session bearer tokens,
-- payment credentials, or other secrets.
CREATE TABLE IF NOT EXISTS game_room_checkpoints (
  room_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK(mode IN ('free','vip')),
  game_id TEXT NOT NULL UNIQUE,
  state_json TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 0),
  status TEXT NOT NULL CHECK(status IN ('waiting','playing','finished','closed')),
  deadline_at_ms INTEGER,
  saved_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_room_status
  ON game_room_checkpoints(status,saved_at_ms);

CREATE TABLE IF NOT EXISTS game_room_seats (
  room_id TEXT NOT NULL REFERENCES game_room_checkpoints(room_id) ON DELETE CASCADE,
  seat_index INTEGER NOT NULL CHECK(seat_index BETWEEN 0 AND 3),
  uid TEXT NOT NULL REFERENCES players(uid),
  PRIMARY KEY(room_id,seat_index),
  UNIQUE(room_id,uid)
);
CREATE INDEX IF NOT EXISTS idx_game_room_seats_uid ON game_room_seats(uid);
