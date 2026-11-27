-- Review only. Fresh, disposable PG17 database with migration 001 and baseline roles.
-- The opt-in must come from the reviewed single-user invocation. No login or membership is granted.
BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'lucky_qa_admin'
     OR current_setting('lucky.disposable_admin_qa', true) IS DISTINCT FROM 'on'
     OR inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'Disposable Admin QA opt-in required';
  END IF;
END
$guard$;

CREATE ROLE lucky_count_predicate_owner NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS NOINHERIT;

CREATE ROLE lucky_count_reader NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS NOINHERIT;

CREATE TABLE game.room_count_grants (
  uid pg_catalog.uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);

REVOKE ALL ON TABLE game.room_count_grants FROM PUBLIC, anon, authenticated, lucky_game_runtime, lucky_game_server_login, lucky_count_reader, lucky_count_predicate_owner;

ALTER TABLE game.room_count_grants ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA game TO lucky_count_predicate_owner, lucky_count_reader;

GRANT SELECT(uid) ON game.room_count_grants TO lucky_count_predicate_owner;

CREATE POLICY read_count_grants ON game.room_count_grants FOR SELECT TO lucky_count_predicate_owner USING (true);

CREATE FUNCTION game.can_read_room_counts(verified_uid pg_catalog.uuid)
RETURNS pg_catalog.bool
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $predicate$
  SELECT EXISTS (SELECT 1 FROM game.room_count_grants AS g WHERE g.uid = verified_uid)
$predicate$;

ALTER FUNCTION game.can_read_room_counts(pg_catalog.uuid) OWNER TO lucky_count_predicate_owner;

REVOKE ALL ON FUNCTION game.can_read_room_counts(pg_catalog.uuid) FROM PUBLIC, anon, authenticated, lucky_game_runtime, lucky_game_server_login;

GRANT EXECUTE ON FUNCTION game.can_read_room_counts(pg_catalog.uuid) TO lucky_count_reader;

GRANT SELECT(mode,status) ON game.rooms TO lucky_count_reader;

CREATE POLICY read_count_groups ON game.rooms FOR SELECT TO lucky_count_reader USING (true);

COMMIT;

