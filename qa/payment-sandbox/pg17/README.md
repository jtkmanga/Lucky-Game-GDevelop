# PostgreSQL 17 synthetic item ledger

Canonical checkpoint supplied for this task is da44c0301c6d05026ee64105ef3ab03247206fc0. Integration checkpoint is 3f60d72dea15f96c70c64a8c5498519428b139ad. Local SQLite reference files used:

- `qa/payment-sandbox/DURABLE_LEDGER_TH.md` — `81409e1214e90e1bb61b7dde68908717e171b1ad`
- `qa/payment-sandbox/durable-settlement.cjs` — `d20589b5c5e681f17e70bb006058c6b81c65fc1f`
- `qa/payment-sandbox/local-settlement.cjs` — `0d282a8d50b4858119bdc766d077bb6f17258bd7`

Run from the repository root with a trusted local PG17 installation:

```sh
python3 qa/payment-sandbox/pg17/run.py /absolute/pg17/bin
```

The only argument is the installed binaries directory. The runner owns a temporary cluster and invokes initdb and postgres --single. Each phase ends before the next backend starts. The DDL checks the major version, dedicated database name, explicit opt-in, and standalone PID-file identity before creating objects. The disabled-opt-in check runs first. The bootstrap role seeds synthetic pending orders; only the restricted verified-fixture role gets schema usage and permission to invoke apply_verified. The function checks supplied payment facts against the locked order, separately verifies the synthetic full-refund amount and derives the state change. A second, read-only fixture role can query effective shield/×2 booleans from one database clock sample, but cannot access orders/audit or change ledger state. Receiving authority to call that function is the trust boundary. Real provider authentication, issuer authorization, commercial terms and partial refunds are outside this proposal.

The pinned-search-path definer is a dedicated NOLOGIN table owner. It intentionally exercises owner authority; the invoker has no direct table grants, no owner membership, and is subject to RLS. A privileged schema owner can alter history. The test-only public.fixture helper runs with invoker permissions and exists only in cases.sql. Audit attribution records the database session role and order-linked issue/refund events. Same-event redelivery does not append history; a distinct redundant action is recorded as unapplied. Pending refunds are terminal under the inherited lab convention. The half-open 24-hour window and full refund are fixture assumptions.

Reopened standalone backends verify committed history, remaining independent grants and absence of partial writes. Tests include failure after audit/status changes on both issue and refund, explicit outer rollback, and unauthorized function and table access. The callable reader is a sandbox sibling, not a replacement for the gameplay reader. No production reader, gameplay privileges, clock-regression policy, concurrent interleaving, pool/commit-ack recovery, or native payment integration was exercised. The isolated lookup role calls reconcile_verified in a fresh read-committed read-only session. committed_exact proves the matching event was recorded (including a recorded no-op), conflict means facts differ, and absent_unknown does not prove rollback. This path never resubmits the operation; a trusted caller must establish a fresh checkout and keep ambiguous receipts pending. Concurrent same-ID conflicts may surface as unique-constraint failures; classification after rollback requires a fresh read. Neither scenario was simulated.
