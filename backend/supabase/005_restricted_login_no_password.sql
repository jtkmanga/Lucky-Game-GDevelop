-- Lucky Game 005: owner-approved restricted database login identity ONLY.
-- NO PASSWORD, no DB secret, no service deployment.
-- Password-based authentication is intentionally unavailable until a separate
-- secure credential provisioning approval. Do not reapply.
DO $guard$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lucky_game_server_login') THEN
  RAISE EXCEPTION 'lucky_game_server_login exists; manual review required';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM pg_roles
   WHERE rolname='lucky_game_runtime' AND NOT rolcanlogin AND NOT rolbypassrls
 ) THEN RAISE EXCEPTION 'Expected restricted runtime role missing'; END IF;
END
$guard$;

CREATE ROLE lucky_game_server_login WITH LOGIN PASSWORD NULL
 NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;

GRANT lucky_game_runtime TO lucky_game_server_login
 WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;
