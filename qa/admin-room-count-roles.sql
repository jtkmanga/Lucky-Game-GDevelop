-- Review in a fresh disposable database. Use postgres --single -j (blank line after commands).
-- Any ERROR/FATAL or missing completion sentinel fails the run; single-user mode can continue after errors.
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

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM game.rooms) OR EXISTS (SELECT 1 FROM game.room_count_grants) THEN
    RAISE EXCEPTION 'Fixture requires genuinely empty rooms and grant table';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='game.rooms'::regclass) THEN
    RAISE EXCEPTION 'Expected migration 001 RLS';
  END IF;
END
$check$;

-- Check the effective grants, including privileges inherited from PUBLIC or
-- gameplay role membership. Browser roles may not use the predicate.
DO $capability_acl$
DECLARE who text;
BEGIN
  FOREACH who IN ARRAY ARRAY['anon','authenticated','lucky_game_runtime','lucky_game_server_login'] LOOP
    IF has_function_privilege(who, 'game.can_read_room_counts(uuid)', 'EXECUTE')
       OR pg_has_role(who, 'lucky_count_reader', 'MEMBER') THEN
      RAISE EXCEPTION 'Unexpected eligibility for %', who;
    END IF;
  END LOOP;
END
$capability_acl$;

CREATE SCHEMA count_fixture;

-- SQL SECURITY INVOKER wrapper preserves the adapter statement verbatim and exposes its scalar result to assertions.
CREATE FUNCTION count_fixture.adapter(uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER AS $adapter$
  SELECT CASE WHEN game.can_read_room_counts($1::uuid) IS TRUE THEN (
    SELECT COALESCE(jsonb_agg(to_jsonb(counts) ORDER BY mode, status), '[]'::jsonb)
    FROM (
      SELECT mode, status, count(mode)::text AS count
      FROM game.rooms
      GROUP BY mode, status
    ) AS counts
  ) END AS counts
$adapter$;

REVOKE ALL ON FUNCTION count_fixture.adapter(uuid) FROM PUBLIC;

GRANT USAGE ON SCHEMA count_fixture TO lucky_count_reader;

GRANT EXECUTE ON FUNCTION count_fixture.adapter(uuid) TO lucky_count_reader;

INSERT INTO auth.users(id) VALUES ('11111111-1111-4111-8111-111111111111');

INSERT INTO game.room_count_grants(uid) VALUES ('11111111-1111-4111-8111-111111111111');

SET ROLE lucky_count_reader;

DO $empty$
BEGIN
  IF current_user <> 'lucky_count_reader' OR NOT row_security_active('game.rooms') THEN
    RAISE EXCEPTION 'Expected restricted reader and active RLS';
  END IF;
  IF count_fixture.adapter('11111111-1111-4111-8111-111111111111') IS DISTINCT FROM '[]'::jsonb
     OR count_fixture.adapter('22222222-2222-4222-8222-222222222222') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty vs denied failed';
  END IF;
END
$empty$;

RESET ROLE;

INSERT INTO game.rooms(room_id,mode,seats,game_state,status)
SELECT ('aaaaaaaa-aaaa-4aaa-8aaa-00000000000'||i)::uuid,
       CASE WHEN i<3 THEN 'free' ELSE 'vip' END,'[]','{}',
       CASE WHEN i<3 THEN 'playing' ELSE 'closed' END
FROM generate_series(1,3) i;

SET ROLE lucky_count_reader;

DO $populated$
DECLARE forbidden text;
BEGIN
  IF current_user <> 'lucky_count_reader' OR count_fixture.adapter('11111111-1111-4111-8111-111111111111') IS DISTINCT FROM '[{"mode":"free","status":"playing","count":"2"},{"mode":"vip","status":"closed","count":"1"}]'::jsonb
     OR count_fixture.adapter('22222222-2222-4222-8222-222222222222') IS NOT NULL THEN
    RAISE EXCEPTION 'Populated groups or denial incorrect';
  END IF;
  FOREACH forbidden IN ARRAY ARRAY[
    'SELECT seats FROM game.rooms',
    'SELECT uid FROM game.room_count_grants',
    'UPDATE game.rooms SET status=''closed'' WHERE false',
    'DELETE FROM game.room_count_grants WHERE false',
    'INSERT INTO game.room_count_grants(uid) VALUES (''22222222-2222-4222-8222-222222222222'')',
    'GRANT lucky_count_reader TO anon'
  ] LOOP
    BEGIN
      EXECUTE forbidden;
      RAISE EXCEPTION 'Unauthorized action succeeded: %', forbidden;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END
$populated$;

RESET ROLE;

-- Negative control: the very same populated rows must disappear without the reader's policy.
SAVEPOINT policy_intact;

DROP POLICY read_count_groups ON game.rooms;

SET ROLE lucky_count_reader;

DO $negative$
BEGIN
  IF current_user <> 'lucky_count_reader' OR count_fixture.adapter('11111111-1111-4111-8111-111111111111') IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'Missing-policy control did not hide populated groups';
  END IF;
END
$negative$;

ROLLBACK TO SAVEPOINT policy_intact;

-- Commit the populated, authorized baseline before testing the revocation boundary.
COMMIT;

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

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM game.room_count_grants WHERE uid='11111111-1111-4111-8111-111111111111') THEN
    RAISE EXCEPTION 'Committed grant missing before revocation';
  END IF;
END
$pre$;

DELETE FROM game.room_count_grants WHERE uid='11111111-1111-4111-8111-111111111111';

SET ROLE lucky_count_reader;

COMMIT;

DO $revoked$
BEGIN
  IF current_user <> 'lucky_count_reader' OR count_fixture.adapter('11111111-1111-4111-8111-111111111111') IS NOT NULL THEN
    RAISE EXCEPTION 'First reader statement after revocation failed';
  END IF;
  RAISE NOTICE 'ADMIN_ROOM_COUNTS_SEQUENTIAL_COMPLETE';
END
$revoked$;

RESET ROLE;


SELECT 'ADMIN_ROOM_COUNTS_SEQUENTIAL_COMPLETE' AS result;
