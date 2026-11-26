# Lucky Game — authoritative rules vs Turn Receipt (source review)

Updated: 2026-11-26 (Asia/Bangkok) — **SOURCE REVIEW ONLY, NO TESTS EXECUTED**

## Source of truth
- Exact original ZIP input: `Lucky_Game_Multiplayer_Test_v1.zip`, entry `rules.js`.
- A verbatim copy of that entry is now tracked at `backend/railway/rules.js` (commit `12405b0a2f9af742b7da531b2ccd2449b744f889`). It is not a new game or a redesign.
- `tools/prepare_railway_secure.py` copies this tracked source and refuses to build if the ZIP's `rules.js` bytes differ (commit `cfc01db2541a5b3fc1c898481daacd8e5486ea3c`).
- Previously authored rules assertions now import the tracked source (commit `3bea03fb292adc18cffb3b4d3619e8886307c561`). No command was run.

## Actual rules.js contract inspected
- `create(names,mode,rng)`: Free 4 seats, VIP 2 seats, fixed `map:1` **still does not satisfy 5 random boards**.
- `turn(game,roll,rng)`: validates integer dice 1–6, updates trusted game state, and returns an object containing **`type`, `from`, `landing`, `position`, `reward`, `events`, `gameOver`**.
- On roll, game state also records `lastRoll`, `current`, `turn`, `players[actor].pos`, `giftUsed`, `winner` and `over`. When position reaches/overshoots 100, the engine sets winner +10; if Lucky Box is landed on and unused, it awards weighted points from `REWARDS`.
- `timeout(game)` returns a text event and advances `current` and `turn`, sets `lastRoll=null`; **no dice roll or score award**.
- `backend/railway/secure-server.cjs` currently builds a `receipt` with `type='roll'|'timeout'`, `actorIndex`, `dice`, `outcome`; the roll outcome is copied from the trusted `Rules.turn` result. It persists room checkpoint, awards and receipt in one PostgreSQL transaction (source-only). The timeout outcome is `{}`.
- `backend/supabase/room-lease-store.cjs` now requires roll `outcome.reward` to be a nonnegative integer matching any Lucky Box score ledger award; timeout cannot carry roll outcome or awards (commit `5ef3dd92ecd7038eecef298a23b5a81d499c4315`).

## Remaining gaps and verification gates
- Current new server still has **no deployed Supabase DB schema 001–003**, no executed acceptance tests, no Railway service, no OAuth integration validated, and no 10K capacity proof.
- Existing rule engine only defines one board; five distinct random boards must later be implemented with explicit acceptance before increasing overall progress.
- Receipt `outcome` field's **position/type/gameOver relationship** to final persisted game state has not been validated by a full source-level validator; ensure these are reconciled rather than trusting partially formed outcome objects.
- Static review confirms the source's field names but **does not validate executable equality of archive vs committed file**, deployed build, runtime behavior or PostgreSQL transaction correctness. An eventual approved build must exercise the byte-for-byte build guard and test suite.
- UI v12 remains unchanged; no gameplay tests, CI, SQL execution, deploy or paid services were initiated.

## Next single action
Author a focused server-only outcome/state consistency guard (actor, `position`, `gameOver`, `lastRoll`, winner) and corresponding **unexecuted** test cases. Keep UI frozen and honor the testing pause.


## 2026-11-26 — Source-level transition guard (UNTESTED)

- Added `backend/railway/rule-transition-guard.cjs` to statically validate a server-authored transition against the tracked original `rules.js`. Checks authoritative actor, from/landing/dice, snake/ladder mapping, resulting position, `lastRoll`, turn counter, active seat rotation, winner/finished game, score deltas, Lucky Box and absence of other player changes. It also enforces timeout=skip-only (no dice, score or movement). Commits `be5869f9983c6b29471c523315f663e73c47ccf1`, `b396738de1cd5dd9f1586b031e2ff0ac0ef70290`.
- `backend/railway/secure-server.cjs` invokes `requireRuleTransition(old,next,receipt,awards)` before calling `commitFencedTurn`. Failed validation halts room without writing/broadcasting a guessed state. Commit `c463c81328a756726dec15839aaf8967a58a3498`.
- `backend/supabase/room-lease-store.cjs` now binds award UID to the **acting seat**, not just any member of the room, within the fenced SQL transaction. Commit `76acd70bfabc82c675d19fe9b67869a41fc7227e`.
- New unexecuted `qa/rule-transition-receipt.test.cjs` includes normal, snake, ladder, overshoot, Lucky Box, timeout and tampering scenarios (commit `66fcaf6ab81b894095cc029ab80a7c51ea81efef`). Extended the unexecuted lease suite to reject awards paid to a different valid seat in the room (commit `c5369cc812160ef04ccfb0896f8674754ee4e355`).
- **No tests run, no migration applied, no deploy, no measured PASS.** Source still has only one board map. Multi-replica routing, SQL 001–003, Google provider, live Admin and purchases remain incomplete.
