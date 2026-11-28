-- Isolated Lucky Game Staging only. Does not grant VIP to any user.
-- Native race evidence: f17b7321; based on qa/vip-lock-lab/proposal.sql.
-- Managed installation deliberately refuses missing identity or a live room.
DO $guard$
BEGIN
 IF NOT EXISTS (
   SELECT FROM game.staging_acceptance_binding
   WHERE project_ref='tpwmcozkzlvolehozzri'
 ) OR EXISTS (SELECT FROM game.rooms WHERE status='playing') THEN
   RAISE EXCEPTION 'Expected isolated, idle Lucky Game Staging';
 END IF;
 IF NOT EXISTS (SELECT FROM pg_class WHERE oid='game.vip_entitlements'::regclass AND relrowsecurity)
   OR has_column_privilege('lucky_game_server_login','game.vip_entitlements','updated_at','UPDATE') THEN
   RAISE EXCEPTION 'Unexpected VIP entitlement security configuration';
 END IF;
END
$guard$;

CREATE ROLE lucky_vip_pair_guard NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS NOINHERIT;
GRANT lucky_vip_pair_guard TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
GRANT USAGE, CREATE ON SCHEMA game TO lucky_vip_pair_guard;
GRANT SELECT (uid, status, expires_at), UPDATE (updated_at)
  ON game.vip_entitlements TO lucky_vip_pair_guard;
CREATE POLICY vip_guard_read ON game.vip_entitlements
  FOR SELECT TO lucky_vip_pair_guard USING (true);
CREATE POLICY vip_guard_lock ON game.vip_entitlements
  FOR UPDATE TO lucky_vip_pair_guard USING (true) WITH CHECK (false);
CREATE POLICY vip_guard_deny_write ON game.vip_entitlements AS RESTRICTIVE
  FOR UPDATE TO lucky_vip_pair_guard USING (true) WITH CHECK (false);

SET LOCAL ROLE lucky_vip_pair_guard;

CREATE FUNCTION game.lock_vip_pair(first_uid uuid, second_uid uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $body$
DECLARE
  seat record;
  locked_count integer := 0;
  eligible boolean := true;
  earliest timestamptz;
BEGIN
  IF first_uid IS NULL OR second_uid IS NULL OR first_uid = second_uid THEN
    RETURN false;
  END IF;
  FOR seat IN
    SELECT e.status, e.expires_at FROM game.vip_entitlements AS e
    WHERE e.uid IN (first_uid, second_uid)
    ORDER BY e.uid FOR SHARE OF e
  LOOP
    locked_count := locked_count + 1;
    eligible := eligible AND seat.status = 'active' AND isfinite(seat.expires_at);
    earliest := least(earliest, seat.expires_at);
  END LOOP;
  RETURN locked_count = 2 AND eligible AND earliest > clock_timestamp();
END
$body$;

REVOKE ALL ON FUNCTION game.lock_vip_pair(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION game.lock_vip_pair(uuid,uuid) TO lucky_game_server_login;
RESET ROLE;
-- A subtransaction verifies the managed DB and always discards the fixture.
-- It derives two already authorized testers from the retained 4-seat Free room.
DO $probe$
DECLARE
 roster uuid[];
 a uuid;
 b uuid;
BEGIN
 SELECT ARRAY(
   SELECT (seat->>'uid')::uuid FROM jsonb_array_elements(r.seats) AS seat
   ORDER BY seat->>'uid'
 ) INTO roster
 FROM game.rooms AS r
 WHERE r.mode='free' AND r.status='finished' AND jsonb_array_length(r.seats)=4
 ORDER BY r.created_at, r.room_id LIMIT 1;
 IF cardinality(roster) IS DISTINCT FROM 4 OR EXISTS (SELECT FROM game.vip_entitlements) THEN
   RAISE EXCEPTION 'VIP fixture requires the verified Free4 roster and no existing VIP rows';
 END IF;
 a:=roster[1];
 b:=roster[2];
 BEGIN
  INSERT INTO game.vip_entitlements(uid,status,expires_at,grant_ref) VALUES
   (a,'active',clock_timestamp()+interval '30 minutes','isolated-vip-qa-a'),
   (b,'active',clock_timestamp()+interval '30 minutes','isolated-vip-qa-b');
  EXECUTE 'SET LOCAL ROLE lucky_vip_pair_guard';
  IF game.lock_vip_pair(a,b) IS DISTINCT FROM true OR
     game.lock_vip_pair(b,a) IS DISTINCT FROM true OR
     game.lock_vip_pair(a,roster[3]) IS DISTINCT FROM false OR
     game.lock_vip_pair(a,a) IS DISTINCT FROM false OR
     game.lock_vip_pair(a,NULL) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'VIP pair basic cases failed';
  END IF;
  BEGIN
   UPDATE game.vip_entitlements SET updated_at=clock_timestamp() WHERE uid=a;
   RAISE EXCEPTION 'VIP guard unexpectedly allowed entitlement mutation';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  EXECUTE 'RESET ROLE';
  UPDATE game.vip_entitlements SET expires_at=clock_timestamp() WHERE uid=b;
  EXECUTE 'SET LOCAL ROLE lucky_vip_pair_guard';
  IF game.lock_vip_pair(a,b) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Expired pair was admitted'; END IF;
  EXECUTE 'RESET ROLE';
  UPDATE game.vip_entitlements SET expires_at='infinity' WHERE uid=b;
  EXECUTE 'SET LOCAL ROLE lucky_vip_pair_guard';
  IF game.lock_vip_pair(a,b) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Nonfinite expiry was admitted'; END IF;
  EXECUTE 'RESET ROLE';
  UPDATE game.vip_entitlements SET status='revoked',expires_at=clock_timestamp()+interval '30 minutes' WHERE uid=b;
  EXECUTE 'SET LOCAL ROLE lucky_vip_pair_guard';
  IF game.lock_vip_pair(a,b) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Revoked pair was admitted'; END IF;
  RAISE SQLSTATE 'P00V7' USING MESSAGE='Discard validated VIP fixture';
 EXCEPTION WHEN SQLSTATE 'P00V7' THEN NULL;
 END;
 IF EXISTS (SELECT FROM game.vip_entitlements) THEN RAISE EXCEPTION 'VIP fixture remained'; END IF;
END
$probe$;

REVOKE CREATE ON SCHEMA game FROM lucky_vip_pair_guard;
GRANT lucky_vip_pair_guard TO CURRENT_USER WITH INHERIT FALSE, SET FALSE;

DO $acl$
BEGIN
 IF NOT has_function_privilege('lucky_game_server_login','game.lock_vip_pair(uuid,uuid)','EXECUTE')
   OR has_function_privilege('anon','game.lock_vip_pair(uuid,uuid)','EXECUTE')
   OR has_function_privilege('authenticated','game.lock_vip_pair(uuid,uuid)','EXECUTE')
   OR has_schema_privilege('lucky_vip_pair_guard','game','CREATE')
   OR pg_has_role(current_user,'lucky_vip_pair_guard','SET') THEN
   RAISE EXCEPTION 'Unexpected VIP gate permissions';
 END IF;
END
$acl$;
