# Lucky Game — Railway PostgreSQL TLS and startup preflight checkpoint
**2026-11-26 Asia/Bangkok — SOURCE MODIFIED ONLY / NOT TESTED / NOT DEPLOYED**

## Scope and commits

- `backend/supabase/pg-tls-config.cjs` (commit `04359614c4e80db61e5c6358aa32b509e8206b45`) validates `DATABASE_URL` before creating a PostgreSQL pool. Only approved Session Pooler `aws-1-ap-southeast-1.pooler.supabase.com:5432`, database `postgres`, and dedicated login `lucky_game_server_login.llbkxnazkliskzcureec` are accepted. URI query/fragment are rejected to prevent `pg` SSL connection-string overrides. CA file is required, parsed as an unexpired CA certificate, and `ssl.rejectUnauthorized=true`.
- `backend/supabase/game-store.cjs` (commit `a12ce937128493d0c6dbf58f7e9c2bd9d728f15f`) uses `poolConnectionOptions` and verifies `current_user`, `session_user`, private schema USAGE and no `game.orders` SELECT privileges in startup `health()`; rejects startup on unexpected identity/rights. Original schema 001–003 checks remain. `secure-server.cjs` already calls `store.health()` before server.listen and aborts startup on preflight failure.
- `tools/prepare_railway_secure.py` (commit `b7e5278ea7198ae479227d711dc3871b1ded0a39`) copies public `prod-ca-2021.crt` from repository root into generated runtime `backend/supabase/prod-ca-2021.crt`. Original ZIP UI v12 bridge behavior remains untouched.
- `backend/supabase/railway.env.example` (commit `c5aace4b67fd5f07672a9bf4c8d0f49736552384`) documents `PG_SSL_ROOT_CERT_PATH=backend/supabase/prod-ca-2021.crt` (relative to generated `railway-runtime` working directory) and the restricted Pooler connection requirements; no actual DATABASE_URL/key/password included.

## Why this remains unverified

- No Build, Node tests, live pg pool initialization, Railway service deployment, Google OAuth staging or WebSocket E2E was run during source-only changes.
- `new Pool` with connectionString and explicit `ssl` options must be verified with the actual `pg` version in an owner-approved local test; `PG_SSL_ROOT_CERT_PATH` path resolution must be checked in generated runtime.
- Existing owner Codespaces `psql` TLS 1.3 `verify-full` with Supabase CA and restricted role succeeded earlier; its results are evidence of **psql** connectivity, not Node `pg` integration.
- `pg-tls-config` currently intentionally supports the single approved session host and restricted account only. Any new Supabase project, endpoint or role requires explicit source/security review rather than silent fallback.
- Keeping CA in repository is allowed because this is the *public CA certificate* downloaded from the project dashboard, NOT a secret key or database password. Do not commit passwords or private keys.
- The original `secure-server.cjs` remains single-process draft with 500-client cap, and OAuth/runtime functional readiness is unverified.

## Next single action (separate test permission)

Request a **single local Codespaces Node build and connection preflight** using existing Codespaces only and restricted credentials from private interactive input. First review generated file paths and `pg` module TLS option precedence without sending secrets. Keep staging Service creation/Deploy and Trial-credit consumption independently gated.

No Railway service/variable/deploy, no database schema/data changes, no new billed resource, and no UI v12 modifications. Overall estimate remains **22%**.
