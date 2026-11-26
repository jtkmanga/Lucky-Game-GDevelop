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


## 2026-11-26 — COMMIT ambiguity and isolated real-PostgreSQL fixture design (not executed)

### New source-only checks
- `backend/supabase/room-lease-store.cjs` commit `5f28d88c91b64f189257da0a1e058bb104a5f338`: a transport exception after `COMMIT` was submitted is now classified `AMBIGUOUS_COMMIT`. It must not trigger a retry or a second roll, and its PostgreSQL connection is discarded from the pool. A ROLLBACK failure before COMMIT also discards its connection.
- `qa/supabase-room-commit-ambiguity.test.cjs` commit `6d4f440dce22693c5b5dfce6a27b5cc22c3d4c32`: mock cases for lost COMMIT acknowledgement, ordinary pre-COMMIT rollback, and failed ROLLBACK. **File authored only, zero tests run.**

### Future real DB test isolation / teardown protocol — planning ONLY
1. **Owner approval first:** explicitly authorize a finite staging test budget and lift testing pause. Do not create a new Supabase project or enable Railway until then. Prefer a dedicated disposable database or independent Supabase test project; never run destructive fixtures against production player data.
2. Confirm migrations 001+002, privileges, Data API exposure and allowed private schemas. Use **test-specific verified Supabase Auth UUID identities** created via an authorized supported path; never insert arbitrary `game.players.uid` values that violate the foreign key to `auth.users`.
3. Reserve a unique test run identifier / UUIDs and a test-data registry that records **only** run-owned player IDs, room IDs, score event IDs, and entitlement references. Limit inserts, concurrent connections, query duration and execution cost.
4. In that dedicated environment, use two **independent PostgreSQL connections** (not mock replies) to race lease acquisition. Verify one valid owner, monotonically increasing lease epoch on successful reacquisition, refusal of stale owner renew/commit, no duplicate winner or Lucky Box, and no phantom points when an award INSERT fails.
5. For ambiguous COMMIT, deliberately drop a **test-owned** connection between server commit and acknowledgement, then **read the canonical room revision + award ledger with a fresh connection**. Do not replay the random roll; reconcile committed/uncommitted state before any further action. Also verify that failing ROLLBACK causes client eviction.
6. Exercise process-restart recovery and an all-players-disconnected room. Confirm the max 10-room startup sweep does not silently claim all rooms, and that >10 candidates are handled by approved later reconciler. Confirm no two independent Railway replicas write to the same room before enabling scale.
7. Teardown must be **explicitly restricted to IDs recorded for the current isolated test run**. Delete score events and dependent orders/audit entries, then rooms/entitlements/players in FK-safe order. Account deletion, if applicable, is a separately scoped provider action; never bulk-delete `auth.users`, `public`, or `game` without a narrow ownership predicate.
8. Preserve actual results (UTC/Bangkok timestamp, commit SHA, SQL migration version, user IDs redacted, affected row counts, measured cost, PASS/FAIL) in GitHub. If cleanup fails, **stop** and record the exact leftover IDs privately rather than deleting unknown data.

### Completion gates
The mock suite cannot establish actual PostgreSQL behavior or prove recovery at scale. Real DB fixture setup, any tests, SQL migrations and deployment remain blocked pending explicit owner authorization. No source change in this section modifies UI v12.
