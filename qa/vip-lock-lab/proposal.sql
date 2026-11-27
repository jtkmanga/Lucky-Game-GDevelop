-- Disposable single-user QA proposal. No runtime call site or migration registration.
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'lucky_qa_vip_pair'
     OR current_setting('lucky.disposable_vip_qa', true) IS DISTINCT FROM 'on'
     OR inet_server_addr() IS NOT NULL
     OR 'game.vip_entitlements'::regclass::oid < 16384 THEN
    RAISE EXCEPTION 'Disposable VIP lab required';
  END IF;
END
$guard$;
CREATE ROLE lucky_vip_pair_guard NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA game TO lucky_vip_pair_guard;
GRANT SELECT (uid, status, expires_at), UPDATE (updated_at)
  ON game.vip_entitlements TO lucky_vip_pair_guard;
CREATE POLICY vip_guard_read ON game.vip_entitlements
  FOR SELECT TO lucky_vip_pair_guard USING (true);
CREATE POLICY vip_guard_lock ON game.vip_entitlements
  FOR UPDATE TO lucky_vip_pair_guard USING (true) WITH CHECK (false);
-- Future permissive UPDATE policies must not accidentally unblock writes.
CREATE POLICY vip_guard_deny_write ON game.vip_entitlements AS RESTRICTIVE
  FOR UPDATE TO lucky_vip_pair_guard USING (true) WITH CHECK (false);

-- Caller supplies exactly two server-verified seat identities.
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
ALTER FUNCTION game.lock_vip_pair(uuid, uuid) OWNER TO lucky_vip_pair_guard;
REVOKE ALL ON FUNCTION game.lock_vip_pair(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION game.lock_vip_pair(uuid, uuid) TO lucky_game_server_login;
COMMIT;
