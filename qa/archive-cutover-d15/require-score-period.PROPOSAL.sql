-- REVIEW ONLY. Never apply while the default (unfenced) gameplay writer is running.
-- Requires the vetted canonical game.award_period_is_open(text,bigint,bigint)
-- predicate and a restricted gameplay session writer on physical connections.
-- This file is not a migration and does not enable the archive.
BEGIN;
DO $preflight$
BEGIN
 IF NOT EXISTS(SELECT FROM game.staging_acceptance_binding
   WHERE project_ref='tpwmcozkzlvolehozzri')
 OR EXISTS(SELECT FROM game.rooms WHERE status='playing')
 OR to_regprocedure('game.award_period_is_open(text,bigint,bigint)') IS NULL
 OR EXISTS(SELECT FROM game.leaderboard_archives) THEN
   RAISE EXCEPTION 'Expected idle isolated Staging, empty archive and canonical predicate';
 END IF;
END
$preflight$;
CREATE FUNCTION game.require_score_period_fence() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $check$
DECLARE
 local_day date := (transaction_timestamp() AT TIME ZONE 'Asia/Bangkok')::date;
 first_day date;
 past_end date;
BEGIN
 -- Includes admin/repair inserts: they need a separately reviewed future
 -- correction workflow, never a broad exception to the completeness contract.
 IF NEW.created_at IS DISTINCT FROM transaction_timestamp() THEN
   RAISE EXCEPTION 'Score timestamp must match the awarding transaction'
   USING ERRCODE='23514';
 END IF;
 IF NEW.mode='free' THEN
   first_day:=local_day-extract(dow FROM local_day)::int;
   past_end:=first_day+7;
 ELSIF NEW.mode='vip' THEN
   first_day:=local_day;
   past_end:=first_day+1;
 ELSE
   RAISE EXCEPTION 'Score mode must be Free or VIP' USING ERRCODE='23514';
 END IF;
 IF game.award_period_is_open(NEW.mode,
     (extract(epoch FROM (first_day::timestamp AT TIME ZONE 'Asia/Bangkok'))*1000)::bigint,
     (extract(epoch FROM (past_end::timestamp AT TIME ZONE 'Asia/Bangkok'))*1000)::bigint)
     IS DISTINCT FROM TRUE THEN
   RAISE EXCEPTION 'Score period missing lock or cannot accept awards' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END
$check$;
REVOKE ALL ON FUNCTION game.require_score_period_fence() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER require_score_period BEFORE INSERT ON game.score_events
 FOR EACH ROW EXECUTE FUNCTION game.require_score_period_fence();
ALTER TABLE game.score_events ENABLE ALWAYS TRIGGER require_score_period;
COMMIT;
