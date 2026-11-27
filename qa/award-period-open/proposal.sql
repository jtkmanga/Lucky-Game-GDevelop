-- Socketless disposable QA ONLY; not a Supabase migration.
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'lucky_qa_award_period'
     OR current_setting('lucky.disposable_award_period_qa', true) IS DISTINCT FROM 'on'
     OR inet_server_addr() IS NOT NULL
     OR 'game.leaderboard_archives'::regclass::oid < 16384 THEN
    RAISE EXCEPTION 'Disposable award-period QA required';
  END IF;
END
$guard$;

CREATE ROLE lucky_archive_period_probe NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA game TO lucky_archive_period_probe;
GRANT SELECT (mode,period_start_ms,period_end_ms) ON game.leaderboard_archives
  TO lucky_archive_period_probe;
CREATE POLICY lucky_archive_period_probe_select ON game.leaderboard_archives
  FOR SELECT TO lucky_archive_period_probe USING (true);

CREATE FUNCTION game.award_period_is_open(
  requested_mode text, requested_start bigint, requested_end bigint
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = on
AS $open$
DECLARE
  day_local date := (transaction_timestamp() AT TIME ZONE 'Asia/Bangkok')::date;
  start_day date;
  end_day date;
  period_key integer;
  namespace_key integer;
  archive_oid oid := 'game.leaderboard_archives'::regclass;
  probe_oid oid := 'lucky_archive_period_probe'::regrole;
BEGIN
  IF session_user <> 'lucky_game_server_login'
     OR requested_mode IS NULL OR requested_mode NOT IN ('free','vip')
     OR requested_start IS NULL OR requested_end IS NULL THEN
    RETURN false;
  END IF;
  IF requested_mode = 'free' THEN
    start_day := day_local-extract(dow FROM day_local)::int;
    end_day := start_day+7;
    namespace_key := 1279739393;
  ELSE
    start_day := day_local;
    end_day := start_day+1;
    namespace_key := 1279739394;
  END IF;
  period_key := start_day-date '1970-01-01';
  IF period_key < 0 OR
     requested_start <> (extract(epoch FROM (start_day::timestamp AT TIME ZONE 'Asia/Bangkok'))*1000)::bigint OR
     requested_end <> (extract(epoch FROM (end_day::timestamp AT TIME ZONE 'Asia/Bangkok'))*1000)::bigint
     OR NOT EXISTS (
       SELECT FROM pg_catalog.pg_locks AS l WHERE l.locktype='advisory'
         AND l.pid=pg_backend_pid() AND l.granted AND l.mode='ShareLock'
         AND l.objsubid=2 AND l.classid=namespace_key::oid AND l.objid=period_key::oid
     ) THEN RETURN false; END IF;
  -- Take the normal relation read lock before inspecting visibility metadata.
  -- No write or snapshot-column privilege is granted to the predicate owner.
  PERFORM mode FROM game.leaderboard_archives WHERE false;
  IF NOT row_security_active(archive_oid)
     OR NOT EXISTS (
       SELECT FROM pg_catalog.pg_policy p WHERE p.polrelid=archive_oid
         AND p.polname='lucky_archive_period_probe_select' AND p.polcmd='r'
         AND p.polpermissive AND p.polroles=ARRAY[probe_oid]
         AND pg_catalog.pg_get_expr(p.polqual,p.polrelid)='true'
     )
     OR EXISTS (
       SELECT FROM pg_catalog.pg_policy p WHERE p.polrelid=archive_oid
         AND p.polcmd IN ('r','*') AND NOT p.polpermissive
     ) THEN RETURN false; END IF;
  -- A canonical closed row or any overlapping historical row is a stop,
  -- even if preexisting bounds disagree. See no snapshot or player data.
  RETURN NOT EXISTS (
    SELECT FROM game.leaderboard_archives a WHERE a.mode=requested_mode
      AND a.period_start_ms<requested_end AND a.period_end_ms>requested_start
  );
END
$open$;
ALTER FUNCTION game.award_period_is_open(text,bigint,bigint) OWNER TO lucky_archive_period_probe;
REVOKE ALL ON FUNCTION game.award_period_is_open(text,bigint,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION game.award_period_is_open(text,bigint,bigint) TO lucky_game_runtime;
COMMIT;
