-- Fixture only. Do not load this file directly into a service.
BEGIN;
DO $guard$
BEGIN
 IF current_database() <> 'lucky_qa_vip_pair'
    OR current_setting('lucky.disposable_vip_qa', true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS NOT NULL
    OR pg_catalog.to_regprocedure('game.lock_vip_pair(uuid,uuid)') IS NULL THEN
   RAISE EXCEPTION 'Disposable VIP lab required';
 END IF;
END
$guard$;
INSERT INTO auth.users SELECT ('10000000-0000-4000-8000-00000000000'||i)::uuid FROM generate_series(1,6) i;
INSERT INTO game.players SELECT id, 'Player '||id, id::text FROM auth.users;
INSERT INTO game.vip_entitlements(uid,status,expires_at,grant_ref)
SELECT id, CASE WHEN right(id::text,1)='3' THEN 'revoked' ELSE 'active' END,
 CASE right(id::text,1) WHEN '4' THEN clock_timestamp() - interval '1 second'
 WHEN '6' THEN 'infinity'::timestamptz ELSE clock_timestamp()+interval '1 day' END, id::text
FROM auth.users WHERE right(id::text,1)<>'5';
-- Nontransactional counter detects even a rolled-back or zero-row INSERT attempt.
CREATE SEQUENCE public.room_attempts;
CREATE FUNCTION public.track_room_attempt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$ BEGIN PERFORM nextval('public.room_attempts'); RETURN NULL; END $$;
CREATE TRIGGER qa_attempt BEFORE INSERT ON game.rooms FOR EACH STATEMENT EXECUTE FUNCTION public.track_room_attempt();
-- Lab-only invoker spells out the proposed transactional caller.
CREATE FUNCTION public.try_room(a uuid, b uuid) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
 IF game.lock_vip_pair(a,b) IS DISTINCT FROM true THEN RETURN false; END IF;
 INSERT INTO game.rooms(room_id,mode,seats,game_state,status)
 VALUES(a,'vip',jsonb_build_array(a,b),'{}','playing');
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.try_room(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.try_room(uuid,uuid) TO lucky_game_server_login;
COMMIT;
-- next backend
BEGIN;
SET LOCAL SESSION AUTHORIZATION lucky_game_server_login;
DO $qa$
DECLARE a uuid := '10000000-0000-4000-8000-000000000001';
 b uuid := '10000000-0000-4000-8000-000000000002'; other uuid;
BEGIN
 IF current_user <> 'lucky_game_server_login' OR session_user <> current_user THEN RAISE EXCEPTION 'caller'; END IF;
 FOREACH other IN ARRAY ARRAY[NULL::uuid,a,'10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000006'] LOOP
   IF public.try_room(a,other) IS DISTINCT FROM false THEN RAISE EXCEPTION 'denial failed %',other; END IF;
 END LOOP;
 BEGIN PERFORM public.try_room(a,'bad-uuid'); RAISE EXCEPTION 'malformed accepted';
 EXCEPTION WHEN invalid_text_representation THEN NULL; END;
 BEGIN PERFORM uid FROM game.vip_entitlements FOR SHARE; RAISE EXCEPTION 'direct lock';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE game.vip_entitlements SET updated_at=clock_timestamp(); RAISE EXCEPTION 'direct update';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF NOT has_table_privilege(current_user,'game.vip_entitlements','SELECT')
 OR has_any_column_privilege(current_user,'game.vip_entitlements','UPDATE')
 OR pg_has_role(current_user,'lucky_vip_pair_guard','MEMBER') THEN RAISE EXCEPTION 'gameplay privileges'; END IF;
END $qa$;
ROLLBACK;
-- next backend
DO $$ BEGIN IF (SELECT is_called FROM public.room_attempts) OR EXISTS(SELECT FROM game.rooms) THEN RAISE EXCEPTION 'room attempted on denial'; END IF; END $$;
BEGIN;
-- Defense in depth: a later permissive policy must not enable real writes.
CREATE POLICY qa_permissive_future ON game.vip_entitlements
  FOR UPDATE TO lucky_vip_pair_guard USING (true) WITH CHECK (true);
SET LOCAL SESSION AUTHORIZATION lucky_vip_pair_guard;
DO $qa$ BEGIN
 IF NOT row_security_active('game.vip_entitlements') OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='game.vip_entitlements'::regclass) OR EXISTS (
 SELECT FROM pg_roles WHERE rolname=current_user AND (rolcanlogin OR rolbypassrls OR rolsuper OR rolcreaterole))
 OR (SELECT relowner FROM pg_class WHERE oid='game.vip_entitlements'::regclass)=current_user::regrole
 OR has_schema_privilege(current_user,'game','CREATE')
 OR has_any_column_privilege(current_user,'game.rooms','INSERT')
 OR has_column_privilege(current_user,'game.vip_entitlements','status','UPDATE')
 OR NOT has_column_privilege(current_user,'game.vip_entitlements','updated_at','UPDATE') THEN RAISE EXCEPTION 'guard privileges'; END IF;
 BEGIN UPDATE game.vip_entitlements SET updated_at=clock_timestamp();
 RAISE EXCEPTION 'guard changed entitlement';
 EXCEPTION WHEN insufficient_privilege THEN
 IF position('row-level security' in SQLERRM)=0 THEN RAISE; END IF; END;
END $qa$;
ROLLBACK;
-- next backend
DO $$ BEGIN
 IF EXISTS (SELECT FROM (VALUES ('anon'),('authenticated'),('lucky_game_runtime')) r(name)
 WHERE has_function_privilege(name,'game.lock_vip_pair(uuid,uuid)','EXECUTE')) THEN RAISE EXCEPTION 'execute leak'; END IF;
END $$;
-- Start the transaction before assigning expiry. now() would still allow this pair.
BEGIN;
UPDATE game.vip_entitlements SET expires_at=clock_timestamp()+interval '100 milliseconds' WHERE right(uid::text,1)='2';
SELECT pg_sleep(0.15);
SET LOCAL SESSION AUTHORIZATION lucky_game_server_login;
DO $$ BEGIN IF game.lock_vip_pair('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002') IS DISTINCT FROM false THEN RAISE EXCEPTION 'stale transaction clock'; END IF; END $$;
ROLLBACK;
-- next backend
BEGIN;
SET LOCAL SESSION AUTHORIZATION lucky_game_server_login;
DO $$ DECLARE
 a uuid := '10000000-0000-4000-8000-000000000001';
 b uuid := '10000000-0000-4000-8000-000000000002';
BEGIN
 IF public.try_room(b,a) IS DISTINCT FROM true THEN RAISE EXCEPTION 'eligible pair denied'; END IF;
END $$;
COMMIT;
-- next backend
DO $$ BEGIN IF (SELECT count(*) FROM game.rooms)<>1 OR (SELECT last_value FROM public.room_attempts)<>1
 OR NOT (SELECT is_called FROM public.room_attempts) THEN RAISE EXCEPTION 'positive control'; END IF; END $$;
SELECT 'VIP_PAIR_LAB_PASS';
