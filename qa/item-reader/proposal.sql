-- Disposable QA only. NOT a migration, issuer, route, or deploy step.
BEGIN;
DO $guard$
BEGIN
 IF current_database() <> 'lucky_qa_item_read'
    OR current_setting('lucky.disposable_item_qa',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS NOT NULL THEN
   RAISE EXCEPTION 'Disposable item reader lab required';
 END IF;
END
$guard$;
CREATE ROLE lucky_item_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE TABLE game.item_entitlement_current (
 uid uuid NOT NULL REFERENCES game.players(uid) ON DELETE CASCADE,
 item text NOT NULL CHECK (item IN ('shield','double_win')),
 starts_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 PRIMARY KEY(uid,item),
 CHECK (isfinite(starts_at) AND isfinite(expires_at) AND starts_at < expires_at),
 CHECK (revoked_at IS NULL OR isfinite(revoked_at))
);
ALTER TABLE game.item_entitlement_current ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE game.item_entitlement_current FROM PUBLIC, anon, authenticated, lucky_game_runtime, lucky_game_server_login;
GRANT USAGE ON SCHEMA game TO lucky_item_reader;
GRANT SELECT (uid,item,starts_at,expires_at,revoked_at) ON game.item_entitlement_current TO lucky_item_reader;
CREATE POLICY item_reader_select ON game.item_entitlement_current FOR SELECT TO lucky_item_reader USING (true);
COMMIT;
