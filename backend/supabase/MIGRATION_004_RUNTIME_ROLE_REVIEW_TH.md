# Lucky Game — Migration 004 review, verification and rollback (NOT APPLIED)

Date: 2026-11-26 Asia/Bangkok  
Active project: `llbkxnazkliskzcureec` / `jtkmanga/Lucky-Game-GDevelop:main`

## Exact proposed scope

File: `backend/supabase/004_railway_runtime_access_PROPOSAL.sql`.

- Creates `lucky_game_runtime` as a **NOLOGIN** non-superuser, non-BYPASSRLS group privilege role.
- `USAGE` only on `game`; minimum DML per selected `game-store.cjs` and `room-lease-store.cjs`: `players` (SELECT, INSERT, UPDATE), `vip_entitlements` (SELECT), `rooms` (SELECT, INSERT, UPDATE), `score_events` (SELECT, INSERT), `turn_receipts` (SELECT, INSERT).
- Adds 11 RLS policies **TO lucky_game_runtime only**, separating read/write. Trusted server source is responsible for UID and game authorization before SQL. `USING (true)` on a server-only privilege role is **not** safe for browser/shared/untrusted credentials.
- **Does not grant** `anon`, `authenticated`, `PUBLIC` or `service_role`, or any permissions to `orders`, `admin_audit`, `leaderboard_archives`.
- **Does not** create a login, set a password, grant membership to login, create Railway service/variables, change Data API settings, deploy or expose endpoints.
- Fails on a preexisting `lucky_game_runtime` role; SQL transaction rolls back fully if any step fails. Do not apply it twice without a reviewed migration/history check.

## Live source/catalog review used

1. Supabase migrated eight game tables are all `postgres` owned, RLS enabled, not FORCE RLS (regular server role will not own these tables). No role policies or client grants at the inspected checkpoint.
2. Independent owner dashboard screenshot: `game` is **unchecked** under Data API Exposed schemas; `graphql_public` and `public` are selected.
3. Server reads/writes in `backend/supabase/game-store.cjs` and `room-lease-store.cjs` require the operations above, including `UPDATE ... RETURNING` and `INSERT ... RETURNING`.
4. Table-owned sequences are not needed by currently defined explicit UUID identities and revision values. Re-review if any future table identity/default changes.
5. `NOLOGIN` role alone **cannot connect**; later explicit approval must establish a separate LOGIN identity, secure credential delivery and verified effective role. Do not use `postgres` credentials from the Railway or client side by default.

## Pre-apply check (read-only only; approval gate still active)

- Confirm fresh migration history still ends with 003; inspect `pg_roles` for name conflicts, policies, inherited memberships, table owners, ACLs and RLS flags.
- Review PostgreSQL role inheritance/membership semantics for effective runtime login; explicit role membership with `INHERIT` verified before any real test. Prevent membership for untrusted identities.
- Confirm `game` remains excluded from the Supabase Data API via project settings.
- Agree the separate secure path for generating/rotating the Railway DB password. Do not commit or paste credentials into docs/chat.
- Obtain explicit owner approval for the exact 004 DDL scope and any potential lock/billing implications. **This document and SQL are not authorization.**

## After separately approved application

- Verify `rolcanlogin=false`, `rolbypassrls=false`, `rolsuper=false` for `lucky_game_runtime`, and no unexpected members.
- Verify exactly 11 `game` RLS policies `TO lucky_game_runtime`, and table privileges match the matrix. Verify `anon`/`authenticated` still have no usage/table privileges; exclude game from Data API.
- No application data, payments or user identifiers should be modified by the schema migration.
- At a **separate** stage, authorize creation of a login and Railway secret and test access from a real restricted connection. A successful migration does not prove deployed gameplay.

## Rollback / forward-fix proposal (manual review; NOT EXECUTED)

For a newly created, unused `lucky_game_runtime` role with **no members or additional grants**, use a separately approved transaction to drop the 11 named policies, revoke explicit grants, then `DROP ROLE lucky_game_runtime`. Do not drop a role blindly if it gained members or dependent objects. Stop and inventory any role memberships/dependencies first.

No rollback of migrations 001–003 is proposed. Do not delete user accounts, game tables, or data to undo role access. If deployed credentials exist later, revoke the LOGIN membership/rotate credentials and stop services as a separate incident procedure before dropping roles.

## Unverified, not to claim PASS

- SQL 004 has **not** been applied or tested.
- PostgreSQL runtime-role login, RLS behavior with that login, actual Railway connections, UID reconnect using real DB, Google OAuth, free/VIP, Admin and payment are not demonstrated.
- No Codespaces started, no database mutations, no deploy, no new paid resources. Project progress unchanged at 22%.

**NEXT SINGLE ACTION:** obtain explicit scoped approval for applying SQL 004 **after** role/policy review; if not approved, keep SQL as source-only draft while continuing other independent source work.
