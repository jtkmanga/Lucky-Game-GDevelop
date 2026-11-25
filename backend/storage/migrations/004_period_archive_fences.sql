-- Draft migration 004: fence finalized score periods.
-- Apply after 001_score_period_archives.sql and 003_turn_award_outbox.sql.
-- Prevent stale queued awards from being omitted from historical rankings.
-- Must be reviewed in a staging migration before any production use.

CREATE TRIGGER IF NOT EXISTS deny_archive_with_pending_awards
BEFORE INSERT ON leaderboard_period_archives
WHEN EXISTS (
  SELECT 1 FROM score_award_outbox o
  WHERE o.mode=NEW.mode AND o.status='pending'
    AND o.created_at_ms>=NEW.period_start_ms
    AND o.created_at_ms<NEW.period_end_ms
)
BEGIN
  SELECT RAISE(ABORT,'Pending awards prevent period archival');
END;

CREATE TRIGGER IF NOT EXISTS deny_archived_ledger_backfill
BEFORE INSERT ON score_ledger
WHEN EXISTS (
  SELECT 1 FROM leaderboard_period_archives a
  WHERE a.mode=NEW.mode
    AND NEW.created_at_ms>=a.period_start_ms
    AND NEW.created_at_ms<a.period_end_ms
)
BEGIN
  SELECT RAISE(ABORT,'Cannot alter archived leaderboard period');
END;

-- An existing archive may not receive a new outbox event with an old
-- timestamp. Gameplay writes must use server-owned event time.
CREATE TRIGGER IF NOT EXISTS deny_outbox_into_archived_period
BEFORE INSERT ON score_award_outbox
WHEN EXISTS (
  SELECT 1 FROM leaderboard_period_archives a
  WHERE a.mode=NEW.mode
    AND NEW.created_at_ms>=a.period_start_ms
    AND NEW.created_at_ms<a.period_end_ms
)
BEGIN
  SELECT RAISE(ABORT,'Cannot queue award in archived leaderboard period');
END;
