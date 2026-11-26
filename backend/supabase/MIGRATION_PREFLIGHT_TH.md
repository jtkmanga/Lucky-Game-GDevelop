# Lucky Game — Supabase SQL 001/002 preflight and approval gate

**Date:** 2026-11-26 (Asia/Bangkok). **Document only. DO NOT apply migrations, run test queries, or deploy until the owner explicitly authorizes the scoped operation.**

## Target and current known status

- Active repo/branch: `jtkmanga/Lucky-Game-GDevelop` / `main`.
- Supabase project: `Lucky-Game` (`llbkxnazkliskzcureec`), Singapore. It was previously created successfully with a $0/month project-creation quote. Actual future usage charges are **not established**.
- Owner's testing and deployment pause remains active. No game schema has been confirmed installed; the latest earlier read-only inspection reported no `game` schema or game tables.
- Source migrations `backend/supabase/001_game_private_schema.sql` and `002_room_lease_draft.sql` are **drafts only**, not migrations recorded by Supabase's migration history.

## Read-only prerequisites before authorization

1. Check actual current project state and table/migration list again only immediately before a planned application (avoid repeated pointless checks in new chats).
2. Confirm the `game` schema is not in the Data API exposed schemas; browser must never use a PostgreSQL database URL or service-role/secret key.
3. Review permissions on `game` and existing/default table privileges. Private game tables must not grant `anon` or `authenticated` access; RLS remains enabled as defense-in-depth. Identify the intended **server-only DB role**.
4. Assess whether migration 001 references `auth.users(id)` with appropriate FK behavior and whether any preexisting table names or custom objects conflict. Protect current identities and data.
5. **Migration 002 is not idempotent as written**: named constraint `game_rooms_lease_consistency` is added without checking if it already exists. Require a review/refinement before running; never blindly rerun.
6. Verify the server source requires 002 lease columns at startup and `commitFencedTurn` uses the same room UPDATE transaction as reward insert. Draft server cannot start on an un-migrated database by design.
7. Document exact backup/recovery plan, expected SQL locks, projected provider usage/budget and a tested non-destructive rollback or forward-fix approach.
8. Check Google OAuth provider/redirect setup separately. Configuring Auth does not prove multiplayer or DB migration success.

## Approval is needed separately for
- Applying migration 001 and 002 to the real Supabase project (explicitly specify project and change scope).
- Running any unit, mock, real SQL, browser, OAuth or load test. The current pause is still in place.
- Creating/configuring Railway services, entering secrets, exposing any staging/production endpoint, increasing replicas or incurring charges.

## Safe read-only inspection template (NOT executed)

```sql
SELECT nspname FROM pg_namespace WHERE nspname='game';
SELECT table_schema,table_name FROM information_schema.tables WHERE table_schema='game' ORDER BY table_name;
SELECT column_name FROM information_schema.columns WHERE table_schema='game' AND table_name='rooms' ORDER BY ordinal_position;
SELECT conname FROM pg_constraint WHERE conrelid=to_regclass('game.rooms') ORDER BY conname;
SELECT schemaname,tablename,rowsecurity FROM pg_tables WHERE schemaname='game';
```

Read-only inspection does not replace an approved migration review. Do **not** execute inserts, updates, DDL or destructive teardown simply because this checklist exists.

## Source-only exception handling checkpoint

- `backend/supabase/room-lease-store.cjs` reports `AMBIGUOUS_COMMIT` and discards the uncertain PostgreSQL client.
- `backend/railway/secure-server.cjs` now halts affected rooms and reads the authoritative checkpoint for diagnostic classification; it deliberately does **not** replay dice, scores, or turn events.
- A stored revision change alone is not complete proof that the intended rewards were committed. Reconciliation must eventually inspect game state plus score ledger transactionally and make an explicit safe recovery decision before resuming; this **remains unimplemented**.
- Both above changes are **UNTESTED**. Multi-replica session routing and cross-process matchmaking are still incomplete.

## Next source-only work unit

Prepare a read-only **room+award ledger reconciliation** helper and an unexecuted mock test that distinguishes missing, stale, or duplicate award events without playing a new turn. Keep a manual/explicit resume gate. Reuse previous authored tests and never claim PASS without running them.
