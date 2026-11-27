-- Disposable extension of room-count-operator.sql. Only a trusted server that
-- verified the Auth credential may supply verified_actor. EXECUTE conveys that
-- trust: PostgreSQL cannot establish human identity from this argument.
-- The receipt and transition audit record session_user independently.
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

DROP FUNCTION game.set_room_count_grant(uuid,boolean,uuid);

CREATE TABLE game.room_count_operators (
  actor_uid uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE game.room_count_operators ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game.room_count_operators FROM PUBLIC, anon, authenticated, lucky_game_runtime,
  lucky_game_server_login, lucky_count_reader, lucky_count_operator, lucky_count_change_owner;
-- FOR SHARE needs UPDATE privilege and an applicable update policy. WITH CHECK
-- false prevents actual updates. No insert/delete privilege or provisioning API.
GRANT SELECT(actor_uid), UPDATE(actor_uid) ON game.room_count_operators TO lucky_count_change_owner;
CREATE POLICY operator_lookup ON game.room_count_operators FOR SELECT TO lucky_count_change_owner USING (true);
CREATE POLICY operator_lock ON game.room_count_operators FOR UPDATE TO lucky_count_change_owner
  USING (true) WITH CHECK (false);
CREATE POLICY operator_no_write ON game.room_count_operators AS RESTRICTIVE
  FOR UPDATE TO lucky_count_change_owner USING (true) WITH CHECK (false);

-- Legacy receipts retain their UUID and NULL attribution. Their IDs cannot be
-- claimed by a new actor. Require attribution for all new records.
ALTER TABLE game.room_count_grant_requests ADD COLUMN actor_uid uuid,
  ADD CHECK (actor_uid IS NOT NULL) NOT VALID;
ALTER TABLE game.room_count_grant_audit ADD COLUMN actor_uid uuid, ADD COLUMN request_id uuid,
  ADD CHECK (actor_uid IS NOT NULL AND request_id IS NOT NULL) NOT VALID;
GRANT INSERT(actor_uid) ON game.room_count_grant_requests TO lucky_count_change_owner;
GRANT INSERT(actor_uid,request_id) ON game.room_count_grant_audit TO lucky_count_change_owner;

CREATE FUNCTION game.set_room_count_grant(target_uid pg_catalog.uuid, desired pg_catalog.bool, operation_id pg_catalog.uuid, verified_actor pg_catalog.uuid)
RETURNS pg_catalog.bool LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $change$
DECLARE
  principal CONSTANT pg_catalog.oid := session_user::pg_catalog.regrole::pg_catalog.oid;
  prior game.room_count_grant_requests%ROWTYPE;
BEGIN
  IF target_uid IS NULL OR desired IS NULL OR operation_id IS NULL OR verified_actor IS NULL THEN
    RAISE EXCEPTION 'Subject, desired state, request ID and verified actor required' USING ERRCODE='22004';
  END IF;
  PERFORM actor_uid FROM game.room_count_operators
    WHERE actor_uid=verified_actor FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operator access denied' USING ERRCODE='42501';
  END IF;
  INSERT INTO game.room_count_grant_requests(request_id,session_role_oid,subject_uid,granted,actor_uid)
    VALUES(operation_id,principal,target_uid,desired,verified_actor) ON CONFLICT(request_id) DO NOTHING;
  IF NOT FOUND THEN
    SELECT * INTO STRICT prior FROM game.room_count_grant_requests WHERE request_id=operation_id;
    IF (prior.session_role_oid,prior.subject_uid,prior.granted,prior.actor_uid) IS DISTINCT FROM (principal,target_uid,desired,verified_actor) THEN
      RAISE EXCEPTION 'Request ID already bound to another operation' USING ERRCODE='22023';
    END IF;
    RETURN prior.changed;
  END IF;
  IF desired THEN
    INSERT INTO game.room_count_grants(uid) VALUES(target_uid) ON CONFLICT(uid) DO NOTHING;
  ELSE
    DELETE FROM game.room_count_grants WHERE uid=target_uid;
  END IF;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO game.room_count_grant_audit(subject_uid,granted,session_role_oid,request_id,actor_uid)
    VALUES(target_uid,desired,principal,operation_id,verified_actor);
  UPDATE game.room_count_grant_requests SET changed=true WHERE request_id=operation_id;
  RETURN true;
END
$change$;

ALTER FUNCTION game.set_room_count_grant(pg_catalog.uuid,pg_catalog.bool,pg_catalog.uuid,pg_catalog.uuid) OWNER TO lucky_count_change_owner;

REVOKE ALL ON FUNCTION game.set_room_count_grant(pg_catalog.uuid,pg_catalog.bool,pg_catalog.uuid,pg_catalog.uuid) FROM PUBLIC, anon, authenticated, lucky_game_runtime, lucky_game_server_login, lucky_count_reader, lucky_count_predicate_owner;

GRANT EXECUTE ON FUNCTION game.set_room_count_grant(pg_catalog.uuid,pg_catalog.bool,pg_catalog.uuid,pg_catalog.uuid) TO lucky_count_operator;

COMMIT;

