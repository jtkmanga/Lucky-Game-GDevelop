-- Apply only to the original empty fixture after the period predicate.
BEGIN;
DO $guard$
BEGIN
 IF current_database() <> 'lucky_qa_award_period'
    OR current_setting('lucky.disposable_append_qa',true) IS DISTINCT FROM 'on'
    OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
    OR inet_server_addr() IS NOT NULL
    OR 'game.leaderboard_archives'::regclass::oid < 16384
    OR to_regprocedure('game.award_period_is_open(text,bigint,bigint)') IS NULL
 THEN RAISE EXCEPTION 'Expected disposable PG17 archive QA'; END IF;
 LOCK TABLE game.leaderboard_archives IN ACCESS EXCLUSIVE MODE;
 IF EXISTS(SELECT FROM game.leaderboard_archives) OR NOT
    (SELECT relrowsecurity FROM pg_class WHERE oid='game.leaderboard_archives'::regclass)
 THEN RAISE EXCEPTION 'Expected empty RLS-enabled fixture archive'; END IF;
END $guard$;

CREATE ROLE lucky_qa_archive_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE lucky_qa_archive_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA game TO lucky_qa_archive_writer,lucky_qa_archive_reader;
GRANT SELECT(uid,display_name) ON game.players TO lucky_qa_archive_writer;
GRANT SELECT(uid,points,mode,created_at) ON game.score_events TO lucky_qa_archive_writer;
CREATE POLICY qa_archive_players ON game.players FOR SELECT TO lucky_qa_archive_writer USING (true);
CREATE POLICY qa_archive_scores ON game.score_events FOR SELECT TO lucky_qa_archive_writer USING (true);
GRANT SELECT(mode,period_start_ms,period_end_ms,snapshot) ON game.leaderboard_archives
 TO lucky_qa_archive_writer,lucky_qa_archive_reader;
GRANT INSERT(mode,period_start_ms,period_end_ms,snapshot) ON game.leaderboard_archives TO lucky_qa_archive_writer;
CREATE POLICY qa_archive_read ON game.leaderboard_archives FOR SELECT
 TO lucky_qa_archive_writer,lucky_qa_archive_reader USING (true);
CREATE POLICY qa_archive_append ON game.leaderboard_archives FOR INSERT TO lucky_qa_archive_writer WITH CHECK (true);

CREATE FUNCTION game.qa_require_archive_append() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $append$
DECLARE
 d date := (statement_timestamp() AT TIME ZONE 'Asia/Bangkok')::date;
 e date;
 s date;
 ns integer;
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Archive is append only'; END IF;
 IF NEW.mode='free' THEN e:=d-extract(dow FROM d)::int; s:=e-7; ns:=1279739393;
 ELSIF NEW.mode='vip' THEN e:=d; s:=e-1; ns:=1279739394;
 ELSE RAISE EXCEPTION 'Invalid mode'; END IF;
 IF NEW.period_start_ms IS DISTINCT FROM (extract(epoch FROM (s::timestamp AT TIME ZONE 'Asia/Bangkok'))*1000)::bigint
 OR NEW.period_end_ms IS DISTINCT FROM (extract(epoch FROM (e::timestamp AT TIME ZONE 'Asia/Bangkok'))*1000)::bigint
 OR NOT EXISTS (SELECT FROM pg_locks WHERE locktype='advisory' AND granted AND pid=pg_backend_pid()
    AND mode='ExclusiveLock' AND objsubid=2 AND classid=ns::oid AND objid=(s-date '1970-01-01')::oid)
 THEN RAISE EXCEPTION 'Expected locked previous period'; END IF;
 RETURN NEW;
END $append$;
REVOKE ALL ON FUNCTION game.qa_require_archive_append() FROM PUBLIC;
CREATE TRIGGER qa_archive_insert BEFORE INSERT ON game.leaderboard_archives
 FOR EACH ROW EXECUTE FUNCTION game.qa_require_archive_append();
CREATE TRIGGER qa_archive_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON game.leaderboard_archives
 FOR EACH STATEMENT EXECUTE FUNCTION game.qa_require_archive_append();
ALTER TABLE game.leaderboard_archives ENABLE ALWAYS TRIGGER qa_archive_insert;
ALTER TABLE game.leaderboard_archives ENABLE ALWAYS TRIGGER qa_archive_immutable;
COMMIT;
