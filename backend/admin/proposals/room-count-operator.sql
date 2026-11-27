-- Lab proposal only. Depends on the pinned room-count predicate proposal.
-- Authorization comes solely from EXECUTE; neither new role is assigned to any user.
-- Audits explicit changes through this function only. Auth-user deletion cascades
-- to grants by design; that lifecycle event needs separate identity-system audit.
-- session_role_oid identifies the database session, not a human behind a pool.
BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'lucky_qa_admin'
     OR current_setting('lucky.disposable_admin_qa', true) IS DISTINCT FROM 'on'
     OR inet_server_addr() IS NOT NULL
     OR 'game.room_count_grants'::regclass::oid < 16384 THEN
    RAISE EXCEPTION 'Disposable Admin QA with normal user-object OIDs required';
  END IF;
END
$guard$;

CREATE ROLE lucky_count_operator NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS NOINHERIT;

CREATE ROLE lucky_count_change_owner NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS NOINHERIT;

CREATE TABLE game.room_count_grant_audit (
  subject_uid pg_catalog.uuid NOT NULL,
  granted pg_catalog.bool NOT NULL,
  session_role_oid pg_catalog.oid NOT NULL,
  changed_at pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

ALTER TABLE game.room_count_grant_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON game.room_count_grant_audit FROM PUBLIC, anon, authenticated, lucky_game_runtime, lucky_game_server_login, lucky_count_reader, lucky_count_operator, lucky_count_predicate_owner, lucky_count_change_owner;

GRANT USAGE ON SCHEMA game TO lucky_count_operator, lucky_count_change_owner;

GRANT SELECT(uid), INSERT(uid), DELETE ON game.room_count_grants TO lucky_count_change_owner;

CREATE POLICY count_change_lookup ON game.room_count_grants FOR SELECT TO lucky_count_change_owner USING (true);

CREATE POLICY count_change_insert ON game.room_count_grants FOR INSERT TO lucky_count_change_owner WITH CHECK (true);

CREATE POLICY count_change_delete ON game.room_count_grants FOR DELETE TO lucky_count_change_owner USING (true);

GRANT INSERT(subject_uid,granted,session_role_oid) ON game.room_count_grant_audit TO lucky_count_change_owner;

CREATE POLICY count_change_audit ON game.room_count_grant_audit FOR INSERT TO lucky_count_change_owner WITH CHECK (true);

CREATE FUNCTION game.set_room_count_grant(target_uid pg_catalog.uuid, desired pg_catalog.bool)
RETURNS pg_catalog.bool LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $change$
BEGIN
  IF target_uid IS NULL OR desired IS NULL THEN
    RAISE EXCEPTION 'Subject and desired grant state required' USING ERRCODE='22004';
  END IF;
  IF desired THEN
    INSERT INTO game.room_count_grants(uid) VALUES(target_uid) ON CONFLICT(uid) DO NOTHING;
  ELSE
    DELETE FROM game.room_count_grants WHERE uid=target_uid;
  END IF;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO game.room_count_grant_audit(subject_uid,granted,session_role_oid)
    VALUES(target_uid,desired,session_user::pg_catalog.regrole::pg_catalog.oid);
  RETURN true;
END
$change$;

ALTER FUNCTION game.set_room_count_grant(pg_catalog.uuid,pg_catalog.bool) OWNER TO lucky_count_change_owner;

REVOKE ALL ON FUNCTION game.set_room_count_grant(pg_catalog.uuid,pg_catalog.bool) FROM PUBLIC, anon, authenticated, lucky_game_runtime, lucky_game_server_login, lucky_count_reader, lucky_count_predicate_owner;

GRANT EXECUTE ON FUNCTION game.set_room_count_grant(pg_catalog.uuid,pg_catalog.bool) TO lucky_count_operator;

COMMIT;

