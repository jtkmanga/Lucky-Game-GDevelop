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
5. **Migration 002 source updated but NOT run**: the named constraint is now conditionally added if absent. If a same-named constraint exists with a different normalized definition, the migration fails closed instead of silently accepting it. Review existing constraints and the existing recovery-index definition separately before any run; `CREATE INDEX IF NOT EXISTS` does not verify index equivalence.
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
- The source now has `game-store.cjs.readRoomAndAwards` to read room/award rows in one PostgreSQL `REPEATABLE READ READ ONLY` transaction and `room-reconciliation.cjs` for deterministic evidence classification. The server logs classification after `AMBIGUOUS_COMMIT` but does NOT unhalt/replay a room. This is still **UNTESTED**, and manual/explicit safe recovery decision remains unimplemented.
- Both above changes are **UNTESTED**. Multi-replica session routing and cross-process matchmaking are still incomplete.

## Next source-only work unit

Prepare a read-only **room+award ledger reconciliation** helper and an unexecuted mock test that distinguishes missing, stale, or duplicate award events without playing a new turn. Keep a manual/explicit resume gate. Reuse previous authored tests and never claim PASS without running them.


## 2026-11-26 — source-only gap closure, not verified
- Migration 002 source commits `4fede6df0538b53bd4bdf1f79e6e8f134bf31c54`, `f328be1b91eb36c4a0bea5076675d5f10cf3ce03`: conditional named CHECK creation with normalized-definition conflict guard. Column types, existing index definition, locks and RLS privileges still require read-only review; there is **no claim of tested idempotence**.
- `backend/supabase/room-reconciliation.cjs` added in `b1532d70570631e3feb2305aa5d59805f35511a6` to distinguish revision/state/award mismatches, duplicates and unknown outcomes. All classifications require manual review.
- `backend/supabase/game-store.cjs` added consistent read-only room+award ledger snapshot in `b7444909ae019178ba4e6ff8ff027b7206551622`.
- `backend/railway/secure-server.cjs` wired the evidence inspection on ambiguous COMMIT (no automatic restart) in `642d248e6303111857e25efdae034512487e77ea`.
- `qa/supabase-room-reconciliation.test.cjs` source added in `8d17cc7d56e964fc8230a2f05dbb7706c4b4fb14` but NOT EXECUTED.
- No schema changed, no tests run, no deployments, new secrets or new services.
