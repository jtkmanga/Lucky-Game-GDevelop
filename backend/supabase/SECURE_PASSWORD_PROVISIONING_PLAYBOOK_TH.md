# Lucky Game — Secure database password provisioning playbook
**2026-11-26 Asia/Bangkok | PREPARED ONLY — NOT RUN**

## Purpose and hard boundaries
- Existing Supabase project: `llbkxnazkliskzcureec`; database login: `lucky_game_server_login` (created as LOGIN PASSWORD NULL by migration 005).
- Existing privilege group: `lucky_game_runtime` (migration 004); only inherited group permissions, never use `postgres` as the game server account.
- Project-specific Session Pooler display (owner screenshot): `aws-1-ap-southeast-1.pooler.supabase.com:5432`, database `postgres`; anticipated restricted login pooler name `lucky_game_server_login.llbkxnazkliskzcureec` (not yet tested).
- No new Railway service, no secrets in repo/chat, no deploy, no changes to UI v12, no paid add-on.
- Setting a password is a **new database mutation** not performed in this checkpoint. Require owner approval for the specific method/operation before running.

## Safer password-setting method for an interactive owner-controlled terminal

PostgreSQL documents the `psql` meta-command `\\password [username]`: psql prompts without echoing the password and encrypts it before sending an ALTER ROLE operation. This avoids plaintext password in SQL history and query text. See official PostgreSQL `psql` docs:
https://www.postgresql.org/docs/current/app-psql.html

**Prerequisites before any owner-approved run**
1. Confirm `psql` client installed in the **existing** Codespace without installing paid software or starting a new machine. No need to run the old QA suites.
2. Obtain the existing **database owner's** connection credentials in the owner's password manager/Supabase UI; do **not** share owner password or a complete connection URI in ChatGPT, GitHub, screenshots, shell history or log files.
3. Open a trusted interactive psql session using the provider-confirmed endpoint; pass nonsecret host, port, database and username as connection options (never put a password in an argument). Let `psql` prompt for owner credential. Use verified TLS CA and hostname validation; avoid `sslmode=disable` or `sslmode=require` if it does not validate the actual server hostname. Do not use `PGPASSWORD` on a shared machine.
4. Once connected as authorized owner and after checking `SELECT current_user, session_user;`, issue *interactively*:
   `\\password lucky_game_server_login`
   Enter a **new, strong, unique** password twice at hidden prompts. Do not type it into the chat, a script, SQL Editor or a copyable command line. Do not capture the prompts on screen recordings.
5. Exit `psql` and do not keep `.pgpass` credentials on disk. Confirm using **SELECT-only** catalog check `rolpassword IS NOT NULL` via a trusted administrative connector; never fetch `rolpassword` contents or display a verifier/hash. Any password or verifier should remain unknown to ChatGPT.
6. Under a separately approved **bounded connection test**, connect as `lucky_game_server_login.llbkxnazkliskzcureec` through project Session Pooler port 5432 with proper TLS trust and password prompt, and run only:
   `SELECT current_user, session_user, has_schema_privilege(current_user,'game','USAGE');`
   `SELECT has_table_privilege(current_user,'game.rooms','SELECT'), has_table_privilege(current_user,'game.orders','SELECT');`
   Expected: restricted DB identity, game USAGE true, rooms SELECT true, orders SELECT false. These checks do not prove application logic or row-level RLS acceptance.
7. If pooler returns `Tenant or user not found`, recheck suffix `.<project_ref>` and provider guidance; if password/auth/TLS fails, STOP (do not downgrade to `postgres` game credentials or disable TLS). Do not repeatedly rotate the password on guesses.
8. Save **only sanitized** test status, the checked source SHA, timestamp and connection mode in GitHub. Never save connection strings, passwords or tokens.

**Limits:** `\\password` prevents plaintext in the SQL statement sent by psql, but the user still must trust the Codespace terminal and managed connection, and avoid screen capture or malicious shell/session plugins. Supabase's provider connection pooler and custom-role compatibility are documented, but have not been tested for this project.

## Current blocker and next action
**No password has been set yet.** A terminal-capable tool cannot operate the existing Codespace from this chat. The owner can perform the interactive steps only after specific approval of credential provisioning. Railway staging resource and deployment remain separate approvals.
