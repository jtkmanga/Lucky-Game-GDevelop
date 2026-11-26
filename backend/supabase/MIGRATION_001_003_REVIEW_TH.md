# Lucky Game — Migration 001 → 002 → 003 source review gate

**Version:** 2026-11-26 | **Status:** Document only. NO SQL execution or tests authorized.

## Required sequence

| Order | File | Purpose | Preflight issue |
|---|---|---|---|
| 1 | `backend/supabase/001_game_private_schema.sql` | Private player/VIP/room/award tables and RLS | Compare actual schema first; schema/table IF NOT EXISTS does not verify definitions or permissions. |
| 2 | `backend/supabase/002_room_lease_draft.sql` | Lease owner/epoch/expiry and recovery index | CHECK guard is normalization-based and unverified; verify existing column types and recovery-index definition. |
| 3 | `backend/supabase/003_turn_receipts_draft.sql` | Immutable per-(room, revision) receipts | Requires 001/002; IF NOT EXISTS does not prove existing table/index shape; reconcile grants/RLS/FK. |

**Never apply any of these migrations simply because this file exists.**
Database migrations require a separately scoped owner approval; current project has no independently verified deployed game schema.

## Static preflight (non-executing checklist)

- Confirm connected project ID and staging boundary, effective PostgreSQL role, backups/rollback method, migration order and budget.
- Verify `game` is NOT in Supabase exposed Data API schemas. No browser `DATABASE_URL`, `service_role` or SQL secret.
- Compare server requirements to column names/types and table existence; `game.turn_receipts` must exist before the source-selected server health check could pass.
- Verify reward-index uniqueness for `(game_id,kind)` only for win/Lucky Box and event ID uniqueness; `turn_receipts(room_id,revision)` is the per-turn uniqueness key.
- Verify `turn_receipts.event_type='timeout'` requires `roll IS NULL`; `roll` requires 1–6; actor index must be checked against actual persisted seat count in the transaction (not enforceable by current SQL CHECK).
- Review FK to `auth.users`, RLS, schema grants and index definitions before applying anything to data.
- Confirm outbox delivery remains **unimplemented**. A turn receipt is persisted evidence, not a queued or acknowledged outbound message.
- Consider existing database connection limits, lock impact and safe rollback before any staged application.

## Acceptance tests to execute only after separate test approval
- Unit mocked precondition cases: missing or duplicate turn receipt; timeout with reward; out-of-range actor; lost lease; rollback on receipt INSERT failure; ambiguous COMMIT acknowledgement; missing and mismatched historical ledger.
- On an isolated approved real PostgreSQL staging dataset: two competing lease owners; exactly-one receipt+room+award within one transaction; failure rollback across all three tables; read-only repeatable-read forensic snapshot; after-crash reconciliation.
- Record real SHA, SQL revision, PASS/FAIL logs, duration, resources used and cleanup scope. No production data deletion or mass cleanup.

## Source-only review result
- Hardened fenced atomic transaction to reject a timeout award or actor index outside persisted room seat count: `backend/supabase/room-lease-store.cjs`, commit `f5a54932f17681fa42b961aee873d894321e9a87`.
- Added two unexecuted mock test cases to `qa/supabase-room-lease-contract.test.cjs`, commit `00dad43f932ecd0929f2bab3a479fa82fcb00cdc`.
- **Remaining unverified:** test fixtures, JSONB roundtrip semantics, production schema diff, historical data migration strategy, payment/Admin workflows, multiple Railway replicas and 10K capacity.

## Next source-only action
Review and harden receipt reconciliation against *unrelated later receipts and stale snapshots* and prepare transaction-wide receipt-insert failure mocks. Do not automatically resume halted rooms.
