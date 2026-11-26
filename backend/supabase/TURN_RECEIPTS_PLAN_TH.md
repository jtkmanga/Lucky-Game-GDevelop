# Lucky Game — per-turn receipt / outbox source checkpoint (2026-11-26)

**UNTESTED and NOT APPLIED.** No GitHub Actions, mock tests, real Supabase queries, migrations, Railway deployment or new costs were triggered.

## Artifacts prepared
- `backend/supabase/003_turn_receipts_draft.sql` (commit `b57e8c549f326fb222890182948f5c91c2f214e2`): private `game.turn_receipts`, unique by `(room_id, revision)`, recording prior/new revision, lease epoch, actor, roll/timeout, resulting game state, outcome and award entries. RLS enabled; no grants to `anon` or `authenticated`. **Draft schema only**, after SQL 001 and 002.
- `backend/supabase/room-lease-store.cjs` (commit `848af1094bab8713fc3202166a1eeedf099d5c78`): `commitFencedTurn` inserts receipt after the fenced game-room update and reward ledger inserts, **before the same COMMIT**. Reused receipt key or insert failure rolls back the entire transaction. No extra transaction or automatic retry.
- `backend/railway/secure-server.cjs` (commit `64608c5d14181f5700c5f2965f5f00eac16cee3b`): roll/timeout sends authoritative receipt built from server-generated dice and turn outcome, not user-provided points.
- `backend/supabase/game-store.cjs` (commit `318130ebd6f62251bd3122a210def463549f258e`): startup health requires the receipt table; forensic snapshot reads room, awards and latest two receipts under one read-only repeatable-read transaction.
- `backend/supabase/room-reconciliation.cjs` and `manual-room-recovery.cjs` (commits `2b6b96274b632dd65cd28af6ee09be80aac88ca3`, `e4d3240edce034bb75c8c724c96799343be8d9e2`): evidence classifier reports MATCHED/MISSING/MISMATCH/UNAVAILABLE receipt, and manual-recovery advice is BLOCK if the expected receipt does not match. The app never unhalts a room automatically.
- `backend/railway/secure-server.cjs` logs receipt classification (commit `10d870c21c3f064e5cbe776a01c6bc0043433847`).
- Tests authored but **not run**: `qa/turn-receipt-recovery.test.cjs` (`4d56f19605e8a53cc051e90e50e6eb3814b4293d`), and existing unexecuted mock suites updated for mandatory receipt (`92370465777178773f22a3f66bbfda61045f3411`, `d0119c81110a85a5e927b26f27d02f62d748ae7a`, `9f3d7544c73689e0762d2e048dd3eb827b633326`).

## Constraints / blockers
- Receipt is **durable turn evidence**, not a complete *outbox publisher*. No delivery queue, acknowledgements, retries, replay or admin review UI is implemented. Do not treat logs or message sending as exactly-once delivery.
- The exact roll/outcome serialization, PostgreSQL JSONB comparisons, transaction atomicity, schema privilege behavior, duplicate receipt rejection and new mock expectations must be independently verified after owner lifts test pause.
- The current ledger lacks externally verifiable prior-turn receipts until migration and runtime launch; historical rooms cannot be assumed upgraded automatically.
- SQL migration 003 is NOT guaranteed safe against conflicting existing schema merely because `CREATE TABLE IF NOT EXISTS` is present. Check real schema/privileges/index names and costs before owner-authorized application.
- Multiprocess matchmaking, routing by owner, Google OAuth configuration, 5 boards, Admin, paid VIP, resets and 10K validation remain open.

## Next single action
Static-review receipt payload invariants and mock assertions for missing/duplicate receipts; plan an authorized migration 001→002→003 and isolated, bounded SQL acceptance once owner separately unpauses tests and deploy.


## 2026-11-26 static hardening checkpoint (NOT TESTED)
- Receipt actor is now compared with the DB-stored seat count inside `commitFencedTurn`; an invalid actor index aborts the transaction.
- A timeout with any positive reward events now aborts the transaction; timeout is skip-only, never auto-roll or award. Commit `f5a54932f17681fa42b961aee873d894321e9a87`.
- Added unexecuted mock cases in `qa/supabase-room-lease-contract.test.cjs`, commit `00dad43f932ecd0929f2bab3a479fa82fcb00cdc`.
- New consolidated preflight `backend/supabase/MIGRATION_001_003_REVIEW_TH.md`, commit `030b51b6c8f371747493be88cd1f7cca4ce9bdc0`.
- No actual test execution, PostgreSQL schema mutation, Railway deployment or billable resource launch. All outcomes are assumptions until approved verification.
