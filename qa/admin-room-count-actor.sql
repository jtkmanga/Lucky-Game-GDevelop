-- Disposable sequential SQL entry-point checks.
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


INSERT INTO auth.users(id) VALUES
 ('aaaaaaaa-0000-4000-8000-000000000001'), ('aaaaaaaa-0000-4000-8000-000000000002'),
 ('aaaaaaaa-0000-4000-8000-000000000003');
INSERT INTO game.room_count_operators SELECT id FROM auth.users WHERE id IN
 ('aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002');

DO $check$
DECLARE role_name text;
BEGIN
  IF to_regprocedure('game.set_room_count_grant(uuid,boolean,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy path still available';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','lucky_game_runtime','lucky_game_server_login','lucky_count_reader'] LOOP
    IF has_function_privilege(role_name,'game.set_room_count_grant(uuid,boolean,uuid,uuid)','EXECUTE')
       OR has_table_privilege(role_name,'game.room_count_operators','INSERT')
       OR has_any_column_privilege(role_name,'game.room_count_grant_requests','SELECT') THEN
      RAISE EXCEPTION 'Unexpected access for %',role_name;
    END IF;
  END LOOP;
END
$check$;

-- Even a later permissive policy must not let the change role edit membership.
CREATE POLICY qa_permissive_operator_update ON game.room_count_operators
  FOR UPDATE TO lucky_count_change_owner USING (true) WITH CHECK (true);
SET ROLE lucky_count_change_owner;
DO $check$
BEGIN
  IF NOT row_security_active('game.room_count_operators') THEN RAISE EXCEPTION 'RLS inactive'; END IF;
  BEGIN
    UPDATE game.room_count_operators SET actor_uid=actor_uid;
    RAISE EXCEPTION 'Operator membership update unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END
$check$;
RESET ROLE;

SET ROLE lucky_count_operator;

DO $check$
DECLARE
  a uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  b uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
  t uuid := 'aaaaaaaa-0000-4000-8000-000000000003';
BEGIN
  IF game.set_room_count_grant(t,true,a,a) IS DISTINCT FROM true THEN RAISE EXCEPTION 'grant'; END IF;
  IF game.set_room_count_grant(t,true,b,a) IS DISTINCT FROM false THEN RAISE EXCEPTION 'noop'; END IF;
  IF game.set_room_count_grant(t,false,t,b) IS DISTINCT FROM true THEN RAISE EXCEPTION 'revoke'; END IF;
  IF game.set_room_count_grant(t,true,a,a) IS DISTINCT FROM true THEN RAISE EXCEPTION 'stale replay'; END IF;
  IF game.set_room_count_grant(t,true,b,a) IS DISTINCT FROM false THEN RAISE EXCEPTION 'noop replay'; END IF;
  BEGIN PERFORM game.set_room_count_grant(t,true,a,b); RAISE EXCEPTION 'other actor replayed';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END
$check$;

RESET ROLE;
DELETE FROM game.room_count_operators WHERE actor_uid='aaaaaaaa-0000-4000-8000-000000000001';
ALTER TABLE game.room_count_grant_audit ADD CHECK (NOT granted) NOT VALID;
SET ROLE lucky_count_operator;

DO $check$
DECLARE
  a uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  b uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
  t uuid := 'aaaaaaaa-0000-4000-8000-000000000003';
BEGIN
  BEGIN PERFORM game.set_room_count_grant(t,true,a,a); RAISE EXCEPTION 'revoked operator replayed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM game.set_room_count_grant(t,true,'aaaaaaaa-0000-4000-8000-000000000004',b);
    RAISE EXCEPTION 'audit failure expected'; EXCEPTION WHEN check_violation THEN NULL; END;
END
$check$;

RESET ROLE;
DO $check$
DECLARE t uuid := 'aaaaaaaa-0000-4000-8000-000000000003';
BEGIN
  IF EXISTS (SELECT FROM game.room_count_grants WHERE uid=t)
     OR (SELECT count(*) FROM game.room_count_grant_requests WHERE subject_uid=t) <> 3
     OR (SELECT count(*) FROM game.room_count_grant_audit WHERE subject_uid=t) <> 2
     OR (SELECT count(*) FROM game.room_count_grant_requests r JOIN game.room_count_grant_audit a
          USING(request_id,actor_uid,session_role_oid,subject_uid,granted)
          WHERE r.changed AND r.subject_uid=t AND r.session_role_oid=session_user::regrole::oid) <> 2 THEN
    RAISE EXCEPTION 'Unexpected grants, receipts or attribution';
  END IF;
END
$check$;
ROLLBACK;
SELECT 'ADMIN_ACTOR_PG_PASS' AS result;
