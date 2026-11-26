# Lucky Game P1 — restricted PostgreSQL RLS write test: approval boundary (2026-11-26)

## Evidence reused, not rerun
- Supabase migration 001–005 installed; RLS role policies under `game` exist, with `lucky_game_server_login` effective inheritance via `lucky_game_runtime`.
- Owner-run Codespaces `psql` using `sslmode=verify-full` through Session Pooler: restricted login and `SELECT count(*) FROM game.rooms` succeeded with **0 rooms**, `SELECT count(*) FROM game.orders` was **permission denied**, as intended.
- Reviewed **live schema via SELECT-only plugin calls**: `game.rooms` columns and CHECK constraints agree with source migrations 001–002, and no non-internal triggers were returned for `game.rooms`.
- The existing test authorizations cover **read-only** login verification. This proposed write/rollback test is not executed.

## Proposed one-off command (DO NOT RUN until owner approves this exact write test)
File: `backend/supabase/qa_rooms_rollback_rls_PROPOSAL.sql`

To run after separate approval, from the **existing** Codespaces:
```bash
cd /workspaces/Lucky-Game-GDevelop
git pull --ff-only origin main
psql "host=aws-1-ap-southeast-1.pooler.supabase.com port=5432 dbname=postgres user=lucky_game_server_login.llbkxnazkliskzcureec sslmode=verify-full sslrootcert=$HOME/.postgresql/root.crt connect_timeout=10" -X -W -v ON_ERROR_STOP=1 -P pager=off -f backend/supabase/qa_rooms_rollback_rls_PROPOSAL.sql
```

The command prompts for the **restricted role password privately**; never paste a password, a full connection URI containing credentials, or a private key into GitHub, logs or chat. It is a bounded live DB write despite its rollback, and requires scoped owner authorization.

## Expected evidence and caveats

- Identity must be **`lucky_game_server_login`**, not `postgres`. Schema USAGE and room INSERT/UPDATE privileges are expected true.
- The precheck fixture UUID must have zero rows before test. If nonzero, **STOP and review**; do not overwrite or delete existing data.
- Within one transaction, the temporary `free` room with empty seats and placeholder game state is inserted, revision updated from 0 to 1, checked, and then **explicitly rolled back**. The placeholder is a database privilege fixture only, **never a playable room**.
- After ROLLBACK, `remaining_test_rows` must equal 0. A nonzero count means FAIL and requires investigation, not automatic destructive cleanup.
- The table currently has no user-defined triggers; PostgreSQL transaction rollback should undo normal INSERT/UPDATE to `game.rooms`. Nevertheless, do not claim rollback reverses arbitrary external side effects in every system. If SQL fails mid-transaction, `ON_ERROR_STOP=1` ends psql; the server rolls back the open transaction when the connection closes. Confirm no leftover fixture with a separate SELECT-only query if this happens.
- Do **not** repeat earlier 20/20 Node suite, local WS 2/2, auth fixture, prior migration checks or owner read permission tests.
- Test **does not prove** multi-player game persistence, transaction recovery after restart, policy row isolation with multiple identities, PostgreSQL INSERT permissions on other tables, real Google OAuth or Railway service network configuration.
- No provider Secrets stored on disk, no new services, migration or deployment.

## Approval / exit
**Status: SOURCE AUTHORED / NOT RUN**. A user instruction to continue coding is not approval to write to real Supabase tables; request explicit scoped approval before running the test. Overall estimated project progress **22% unchanged**.

**NEXT SINGLE ACTION:** owner approves one restricted-login room INSERT/UPDATE in an explicit transaction with ROLLBACK, then owner runs only the prepared file in the existing Codespaces and sends sanitized output. After verifying PASS, assess Railway staging service setup/cost without provisioning by default.


## 2026-11-26 20:21 Asia/Bangkok — Scoped owner authorization received, fixture hardened
- Owner explicitly authorized **only** the existing Codespaces restricted-login `game.rooms` INSERT → UPDATE → ROLLBACK test, with no persistent data, deploy, new service or new spending. This lifts the test pause **only for this fixture**, not for any other tests.
- Pre-execution review found that the draft's `existing_test_rows` check displayed a count but did not fail closed if nonzero. Patched `qa_rooms_rollback_rls_PROPOSAL.sql` at commit `25cae95f8864a6dcad44c595cba345f5a7aeb299` to reject wrong `current_user` or `session_user`, unexpected privileges, missing expected permissions, an existing fixture UUID, and leftover rows following ROLLBACK. All guard failures raise an exception with `ON_ERROR_STOP=1`, so the connection exits; the open transaction rolls back on disconnect.
- **No test has run yet**. The available connector in this chat does not offer existing Codespaces terminal execution; owner runs the single pre-authorized command below.
- Run **once** from the existing Codespace, with the restricted role password only in the hidden interactive psql prompt:
```bash
cd /workspaces/Lucky-Game-GDevelop && git pull --ff-only origin main && psql "host=aws-1-ap-southeast-1.pooler.supabase.com port=5432 dbname=postgres user=lucky_game_server_login.llbkxnazkliskzcureec sslmode=verify-full sslrootcert=$HOME/.postgresql/root.crt connect_timeout=10" -X -W -v ON_ERROR_STOP=1 -P pager=off -f backend/supabase/qa_rooms_rollback_rls_PROPOSAL.sql
```
- Expected result: `INSERT 0 1`/RETURNING, `UPDATE 1`/RETURNING revision 1, `ROLLBACK`, `remaining_test_rows=0`, final `DO` without exception; shell exit 0. If error: **STOP**, do not retry or run DELETE; capture sanitized error and run only an independently reviewed SELECT-only residue inspection if needed.
- No Admin/payment/other table writes, no full game tests, no Railway staging or production. Avoid claiming write PASS until owner provides the exact terminal output.
