# Lucky Game — Supabase Room Lease Test Readiness (26 November 2026)

**Owner's testing pause remains in force. This file describes tests WRITTEN, NOT EXECUTED.**

## Test artifact
- `qa/supabase-room-lease-contract.test.cjs` (source commit `66d435c116343994ee59013cedc67d9efe34392a`) uses Node's built-in `node:test` and a small mock `pg` pool. No real Supabase/Railway/Google secrets needed.
- Covers: guarded room UPDATE and award INSERT in one transaction; rejection when conditional lease/revision UPDATE affects no rows; rollback after duplicate score event or INSERT error; rejecting awards for non-seat UIDs; +10 winner constraint; lease acquisition contention; rejecting missing deadline for an unfinished game.
- `backend/supabase/room-lease-store.cjs` comment corrected (commit `99cfc431103d3e050e53c8c52a12ccc28cbe5b29`): **source-wired** to Railway server, but **not tested, not migrated, not deployed**.

## Coverage limitations — do not claim PASS
- The test doubles simulate PostgreSQL transaction replies; they cannot establish real PostgreSQL lock ordering, RLS/privileges, `ON CONFLICT` partial unique indexes, `jsonb` encoding, connection-pool outages, or crash recovery.
- The test does NOT cover real concurrent clients, user Google OAuth, JWT verification, VIP entitlements, connected/free-room matching, score resets, payment, 5 boards, or 10,000 CCU.
- No real SQL schema 001/002 is applied. Startup `health()` requires both migrations before a Railway service could start; owner has not approved applying these.
- A second **real database integration suite** should later exercise two owners with independent DB sessions against isolated staging data, expiry/renew races, lost lease during COMMIT, restart without any client connected, and safe cleanup of orphaned room reservations. Only run after explicit authorization and cost review.
- No changes to visual UI v12.

## Execution gate
1. Owner explicitly lifts the testing pause for a limited **local mock** test. When authorized, run `node --test qa/supabase-room-lease-contract.test.cjs`; save true output, commit SHA and PASS/FAIL evidence.
2. Before SQL migration or hosting: review permission/RLS isolation, migration idempotence and budget. Owner authorizes separately.
3. Only after actual Supabase staging migration and approval, run a **real PostgreSQL transaction test** in an isolated staging namespace, then production-equivalent Railway + WebSocket verification.
4. Continue from `PROJECT_STATUS_TH.md`; do not rerun historical guest-only 7/7 suite without a reason.

## Next source-only task
Prepare isolated PostgreSQL integration-test fixtures / teardown design (not executed), or refine `commitFencedTurn` and `room-lease-store.cjs` error cases based on static review. Keep all feature gates open until independently verified.
