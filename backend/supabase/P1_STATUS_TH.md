# Supabase P1 source checkpoint — 2026-11-25

Status: **code prepared / untested / database migration NOT applied / Railway NOT deployed**.

## What was checked
- Supabase project `llbkxnazkliskzcureec` in Singapore is ACTIVE_HEALTHY.
- Connected Supabase `list_tables` for public/game returned no game tables.
- Read-only pg_namespace query showed `public` but not `game`; `game` is a planned schema, not created yet.
- Supabase docs say Google OAuth requires a Google Cloud OAuth web client with Supabase callback URL, permitted origins and Supabase redirect allowlist. This provider setup is not verified and not automatically complete after creating the Supabase project.
- Neither Railway staging service nor production deployment is active.

## Source-only work completed
1. `backend/supabase/001_game_private_schema.sql`: **unapplied draft** creates private `game` schema, references `auth.users.id` UUID, tables for players, VIP, room checkpoint, score events, previous leaderboard archives, orders, and admin audit; removes public/anon/authenticated grants and enables RLS with no client policies. Reviewed design: pending award outbox, idempotent admin adjustments, reset scheduler and recoverable room ownership still need work.
2. `backend/auth/supabase-access-token.cjs`: validates the client access token server-side against Supabase Auth `/auth/v1/user` with the configured public/publishable key and a fixed trusted project URL; only verified returned UUID becomes a user identity. Failed verification rejects access. No Firebase dependency on the selected path.
3. `backend/supabase/game-store.cjs`: Node `pg` backend for private game schema, verified UUID player/VIP records, durable room snapshots, compare-and-update revision + reward inserts in one PostgreSQL transaction, leaderboard window read. Source only; not integrated to a running service.
4. `backend/railway/secure-server.cjs`: now imports Supabase Auth verifier and private game store, requires `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`. The public `/api/supabase-config` endpoint returns only the public URL and publishable key. Refuses startup if DB schema absent. Single-process 500-socket ceiling is only a conservative guard, NOT a measured limit.
5. `tools/prepare_railway_secure.py`: replaces Firebase browser sign-in with Supabase Google OAuth (redirect flow) and sends verified `accessToken` in join messages. The visible HTML/CSS/board remains identical. User may need to click the existing Online button again after OAuth redirects back; that behavior is not validated.
6. `backend/supabase/railway.env.example`: environment names only; no real credentials.

## Remaining blockers and integration TODOs
- **No SQL migration applied.** A human-approved scoped schema application and independent SQL/security review are required before using the database. Ensure game schema is **not exposed** via Supabase Data API. Never grant game table writes to anon/authenticated.
- No `DATABASE_URL` (must be Railway secret from Supabase connection pooler); `SUPABASE_PUBLISHABLE_KEY` must be provided through Railway env, not GitHub.
- Google provider setup requires Google OAuth Client ID/Secret in the Supabase dashboard, authorized origins and callback URLs. Current connector does not surface an Auth provider configuration setter.
- The generated frontend JS is a source draft and must be reviewed/tested after the owner's testing pause is lifted. No browser/OAuth runtime evidence.
- Existing `backend/railway/postgres-store.cjs` and `backend/railway/001_postgres.sql` are **superseded drafts**; don't apply them.
- Existing `backend/auth/firebase-id-token.cjs` and `backend/storage/d1-store.cjs` remain archival/alternate implementation code, not the active path.
- Current rooms and matchmaking queue still use in-memory Maps; no multi-Railway replica room affinity, process restart recovery or actual load proof.
- Server heartbeat, rate limits, 5 distinct board maps, previous ranking archives, admin web UI, payment, safe user score edit and multi-session policy are still incomplete.
- Potential mobile/OAuth concern: redirect-based Google sign-in must preserve the user's intended Free/VIP mode without trusting client authorization. No automatic login success claim before a real browser session is checked.

## Cost and safety
- In this session: only read-only Supabase data and GitHub source files were written. No Supabase SQL executed for DDL, no new billing resources, no Railway service/deploy, no load or unit tests.
- Previously created Supabase project was quoted $0/month; that does not guarantee future usage will remain free.

## NEXT SINGLE ACTION
Continue P1 with a focused read-only review of Supabase Auth provider config/connection options and security constraints, then submit a migration for a **scoped and authorized** schema change when owner lifts documentation-only restraint. Independently refine source-level reconnect and OAuth return logic without altering UI. Do not start testing or deploy until explicit approval.
