-- Disposable sequential fixture; all synthetic changes roll back after assertions.
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

INSERT INTO auth.users(id) VALUES('00000000-0000-4000-8000-000000000073'::uuid);

DO $check$
BEGIN
  IF 'game.room_count_grant_audit'::regclass::oid < 16384 THEN RAISE EXCEPTION 'Low audit OID'; END IF;
END
$check$;

SET ROLE anon;

DO $test$
BEGIN
  IF current_user <> 'anon' OR pg_has_role(current_user,'lucky_count_operator','MEMBER') THEN RAISE EXCEPTION 'Wrong effective role'; END IF;
  BEGIN
    PERFORM game.set_room_count_grant('00000000-0000-4000-8000-000000000073'::uuid,true);
    RAISE EXCEPTION 'Unexpected execution privilege';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'PASS denied anon';
END
$test$;

RESET ROLE;

SET ROLE authenticated;

DO $test$
BEGIN
  IF current_user <> 'authenticated' OR pg_has_role(current_user,'lucky_count_operator','MEMBER') THEN RAISE EXCEPTION 'Wrong effective role'; END IF;
  BEGIN
    PERFORM game.set_room_count_grant('00000000-0000-4000-8000-000000000073'::uuid,true);
    RAISE EXCEPTION 'Unexpected execution privilege';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'PASS denied authenticated';
END
$test$;

RESET ROLE;

SET ROLE lucky_game_runtime;

DO $test$
BEGIN
  IF current_user <> 'lucky_game_runtime' OR pg_has_role(current_user,'lucky_count_operator','MEMBER') THEN RAISE EXCEPTION 'Wrong effective role'; END IF;
  BEGIN
    PERFORM game.set_room_count_grant('00000000-0000-4000-8000-000000000073'::uuid,true);
    RAISE EXCEPTION 'Unexpected execution privilege';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'PASS denied lucky_game_runtime';
END
$test$;

RESET ROLE;

SET ROLE lucky_game_server_login;

DO $test$
BEGIN
  IF current_user <> 'lucky_game_server_login' OR pg_has_role(current_user,'lucky_count_operator','MEMBER') THEN RAISE EXCEPTION 'Wrong effective role'; END IF;
  BEGIN
    PERFORM game.set_room_count_grant('00000000-0000-4000-8000-000000000073'::uuid,true);
    RAISE EXCEPTION 'Unexpected execution privilege';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'PASS denied lucky_game_server_login';
END
$test$;

RESET ROLE;

SET ROLE lucky_count_reader;

DO $test$
BEGIN
  IF current_user <> 'lucky_count_reader' OR pg_has_role(current_user,'lucky_count_operator','MEMBER') THEN RAISE EXCEPTION 'Wrong effective role'; END IF;
  BEGIN
    PERFORM game.set_room_count_grant('00000000-0000-4000-8000-000000000073'::uuid,true);
    RAISE EXCEPTION 'Unexpected execution privilege';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'PASS denied lucky_count_reader';
END
$test$;

RESET ROLE;

SET ROLE lucky_count_predicate_owner;

DO $test$
BEGIN
  IF current_user <> 'lucky_count_predicate_owner' OR pg_has_role(current_user,'lucky_count_operator','MEMBER') THEN RAISE EXCEPTION 'Wrong effective role'; END IF;
  BEGIN
    PERFORM game.set_room_count_grant('00000000-0000-4000-8000-000000000073'::uuid,true);
    RAISE EXCEPTION 'Unexpected execution privilege';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'PASS denied lucky_count_predicate_owner';
END
$test$;

RESET ROLE;

SET ROLE lucky_count_reader;

DO $test$
BEGIN
  IF NOT row_security_active('game.room_count_grants') OR NOT row_security_active('game.room_count_grant_audit') THEN RAISE EXCEPTION 'Expected effective RLS'; END IF;
  BEGIN PERFORM uid FROM game.room_count_grants; RAISE EXCEPTION 'Reader sees grants'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM subject_uid FROM game.room_count_grant_audit; RAISE EXCEPTION 'Reader sees audit'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASS reader tables private';
END
$test$;

RESET ROLE;

SET ROLE lucky_count_operator;

DO $test$
BEGIN
  IF current_user <> 'lucky_count_operator' OR pg_has_role(current_user,'lucky_count_change_owner','MEMBER') THEN RAISE EXCEPTION 'Operator identity'; END IF;
  BEGIN PERFORM uid FROM game.room_count_grants; RAISE EXCEPTION 'Operator reads grants'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM subject_uid FROM game.room_count_grant_audit; RAISE EXCEPTION 'Operator reads audit'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM game.room_count_grants WHERE false; RAISE EXCEPTION 'Direct grant change'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM game.room_count_grant_audit WHERE false; RAISE EXCEPTION 'Audit modification'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM game.set_room_count_grant(NULL,true); RAISE EXCEPTION 'Null subject accepted'; EXCEPTION WHEN null_value_not_allowed THEN NULL; END;
  BEGIN PERFORM game.set_room_count_grant('00000000-0000-4000-8000-000000000073'::uuid,NULL); RAISE EXCEPTION 'Null state accepted'; EXCEPTION WHEN null_value_not_allowed THEN NULL; END;
  BEGIN PERFORM game.set_room_count_grant('00000000-0000-4000-8000-000000000074',true); RAISE EXCEPTION 'Unknown grant subject'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  RAISE NOTICE 'PASS operator bounded';
END
$test$;

DO $test$
BEGIN
  IF game.set_room_count_grant('00000000-0000-4000-8000-000000000073'::uuid,true) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Grant failed'; END IF;
  IF game.set_room_count_grant('00000000-0000-4000-8000-000000000073'::uuid,true) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Duplicate grant'; END IF;
  RAISE NOTICE 'PASS grant and duplicate';
END
$test$;

RESET ROLE;

SET ROLE lucky_count_reader;

DO $test$
BEGIN
  IF game.can_read_room_counts('00000000-0000-4000-8000-000000000073'::uuid) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Grant invisible'; END IF;
  RAISE NOTICE 'PASS reader observes grant';
END
$test$;

RESET ROLE;

ALTER TABLE game.room_count_grant_audit ADD CONSTRAINT qa_force_audit_failure CHECK(granted);

SET ROLE lucky_count_operator;

DO $test$
BEGIN
  BEGIN PERFORM game.set_room_count_grant('00000000-0000-4000-8000-000000000073'::uuid,false); RAISE EXCEPTION 'Expected audit failure'; EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE 'PASS failed audit rolls back revoke';
END
$test$;

RESET ROLE;

SET ROLE lucky_count_reader;

DO $test$
BEGIN
  IF game.can_read_room_counts('00000000-0000-4000-8000-000000000073'::uuid) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Unaudited revoke'; END IF;
  RAISE NOTICE 'PASS grant survives audit failure';
END
$test$;

RESET ROLE;

ALTER TABLE game.room_count_grant_audit DROP CONSTRAINT qa_force_audit_failure;

SET ROLE lucky_count_operator;

DO $test$
BEGIN
  IF game.set_room_count_grant('00000000-0000-4000-8000-000000000073'::uuid,false) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Revoke failed'; END IF;
  IF game.set_room_count_grant('00000000-0000-4000-8000-000000000073'::uuid,false) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Duplicate revoke'; END IF;
  RAISE NOTICE 'PASS revoke and duplicate';
END
$test$;

RESET ROLE;

SET ROLE lucky_count_reader;

DO $test$
BEGIN
  IF game.can_read_room_counts('00000000-0000-4000-8000-000000000073'::uuid) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Revocation invisible'; END IF;
  RAISE NOTICE 'PASS reader observes revoke';
END
$test$;

RESET ROLE;

DO $test$
BEGIN
  IF (SELECT count(*) FROM game.room_count_grant_audit WHERE subject_uid='00000000-0000-4000-8000-000000000073'::uuid) <> 2
     OR (SELECT count(DISTINCT granted) FROM game.room_count_grant_audit WHERE subject_uid='00000000-0000-4000-8000-000000000073'::uuid AND session_role_oid=session_user::regrole::oid) <> 2 THEN
    RAISE EXCEPTION 'Audit does not match the two effective transitions';
  END IF;
  RAISE NOTICE 'PASS two transition records';
END
$test$;

-- Regrant before simulating an identity deletion through the auth subsystem.
SET ROLE lucky_count_operator;

DO $test$
BEGIN
  IF game.set_room_count_grant('00000000-0000-4000-8000-000000000073'::uuid,true) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Regrant failed';
  END IF;
END
$test$;

RESET ROLE;

DELETE FROM auth.users WHERE id='00000000-0000-4000-8000-000000000073'::uuid;
SET ROLE lucky_count_reader;
DO $test$
BEGIN
  IF game.can_read_room_counts('00000000-0000-4000-8000-000000000073'::uuid) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Deleted identity retained grant';
  END IF;
END
$test$;
RESET ROLE;
DO $test$
BEGIN
  IF (SELECT count(*) FROM game.room_count_grant_audit
       WHERE subject_uid='00000000-0000-4000-8000-000000000073'::uuid) <> 3 THEN
    RAISE EXCEPTION 'Explicit audit history changed on auth deletion';
  END IF;
  RAISE NOTICE 'PASS identity deletion removes grant without rewriting explicit audit';
END
$test$;

ROLLBACK;

SELECT 'ADMIN_GRANT_OPERATOR_COMPLETE' AS result;

