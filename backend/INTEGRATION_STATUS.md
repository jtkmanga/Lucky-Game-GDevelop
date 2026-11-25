# Authentication and VIP access integration — implementation checkpoint

Date: 2026-11-25
Status: **code drafted; NOT integrated, NOT tested, NOT deployed**

## Owner instruction
Skip all system testing for now. Do not run GitHub Actions manually, Codespaces testing, bots, load tests, or manual mobile sessions. Existing previously verified results remain historical evidence only. Do not mark new modules as tested or production ready.

## Implemented (non-invasive additions)
- `backend/auth/firebase-id-token.cjs`: verify Firebase Authentication ID token signature with Google's Firebase Secure Token public certificates, reject wrong audience/issuer, expired tokens, missing identity, and malformed tokens. Requires trusted server-side `FIREBASE_PROJECT_ID`.
- `backend/auth/room-access.cjs`: authorize Free for verified identities; require an active, unexpired VIP entitlement retrieved by a trusted server-side storage adapter for VIP. VIP access fails closed when the adapter is missing or returns an error.
- Neither file is yet imported by `Lucky_Game_Multiplayer_Test_v1.zip` / the running `server.js`, so the current WebSocket server still accepts guest players and unverified VIP users. Do **not** use its public link as a secure production lobby.

## Required wiring (still pending)
1. Recover the server sources from the ZIP into source-controlled text files. Review join and resume handlers.
2. At every online WebSocket join: obtain Firebase ID token from client SDK; call `requirePlayerIdentity({idToken}, {projectId:process.env.FIREBASE_PROJECT_ID})`; reject invalid claims; use the returned `uid` as the identity key (never trust client-supplied `uid`).
3. Before matching a VIP room call `requireRoomAccess(identity,'vip', storage)`. Provide `storage.getVipEntitlement(uid)` from trusted server-side persistent storage, not from client input. Do not infer paid access from the UI.
4. Bind resume/reconnect session to the verified `uid` and room/seat; expire tokens appropriately. Consider Firebase revocation-check strategy with Admin SDK if account disabling/revocation is required.
5. Add persistent player records, score ledger, room state snapshots, and reset jobs. No persistence exists in the current in-memory test server.
6. Ensure authentication configuration exists in the chosen host, then **separately authorize** staging deployment and verify before real player launch.

## Constraints / caveats
- Verification here is cryptographic, not an online revocation check. The module does not independently validate Firebase refresh-token revocation, Google provider identity or email-verification policy.
- Server cert retrieval needs outbound HTTPS access and a recent system clock. Certificate errors reject access.
- Verified identity does not confer VIP, ownership of purchased items, or payment settlement.
- New modules have **not** been executed or tested under the owner's pause instruction. Avoid declaring authentication or VIP complete.
- Preserve all existing UI layout/colors and keep the original Cloudflare game separate. No new costs, no production changes.


## Persistence development checkpoint (2026-11-25, untested)
- Added `backend/storage/schema.sql`: SQLite/D1 schema for players, unique display names, append-only score ledger, VIP entitlements, completed game results.
- Added `backend/storage/d1-store.cjs`: D1-compatible server-side adapter for player creation/rename, VIP lookup, winner +10 with game-result idempotency, Lucky Box ledger idempotency, score lookup, and Free/VIP leaderboard.
- These are **draft modules only**: no D1 database was created or migrated, no server imports these modules, and no tests were run by owner instruction.
- Winner and Lucky Box events MUST originate from authoritative gameplay, never client-provided event/score values. VIP grants are deliberately not exposed to the game client; future admin/payment fulfillment requires separately authenticated trusted backend logic and auditable grant records.
- Current score sum includes all events since creation. The Free weekly and VIP daily reset/snapshot rules are **not yet implemented**; leaderboard here is therefore NOT the final resettable leaderboard.
- `recordGameWinner` requires transactional `db.batch`; any target environment must support its D1 atomic semantics.
- A production durability, concurrency, migration, restore, and performance review is still necessary when testing resumes. Do not count this as a completed live feature.


## Daily/weekly leaderboard periods (2026-11-25; untested draft)
- `backend/storage/score-periods.cjs` computes Bangkok UTC+07:00 score periods: VIP daily at 00:00; Free weekly on Sunday at 00:00. Boundaries use half-open ranges `[startMs, endMs)`.
- `backend/storage/migrations/001_score_period_archives.sql` defines idempotent historical leaderboard archive tables; it is **NOT APPLIED**.
- `backend/storage/score-period-service.cjs` provides mode-scoped current rankings and score reads; archival snapshots for the previous closed period; readback of archived rankings. Keeps the append-only ledger, and archives at most 100 ranked entries per period.
- These files have **NOT been run or tested** at the owner's request; no scheduled worker or background job was configured and no database was created.
- CRITICAL: `backend/storage/d1-store.cjs` still exposes lifetime `leaderboard` and `getScore` methods. The current server still does not use `score-period-service.cjs`. A future integration must route UI leaderboard reads to the period-scoped service and remove/avoid lifetime totals for rankings.
- CRITICAL: completed periods MUST reject backdated ledger writes; otherwise archival snapshots can become inconsistent. Implement authoritative event timestamps, transactional closure/append fencing, and idempotent scheduled catch-up before deploy.
- CRITICAL: snapshotting alone is not a scheduling mechanism. Choose a supported job mechanism, handle missed period boundaries and empty periods, and only then label resets operational.
- Architecture remains provisional; the project owner asked to use GDevelop as primary platform, and D1 is only one candidate backend. Selecting a Cloudflare billing/deployment path requires separate owner approval.


## Persistent room / backend gateway checkpoint (2026-11-25, UNTESTED)
- Added `backend/storage/migrations/002_room_checkpoints.sql`: room state checkpoints and UID-bound seats.
- Added `backend/storage/room-checkpoints.cjs`: initialize rooms with verified UIDs, load state, optimistic-revision save, verified seat lookup, and query recoverable rooms.
- Added `backend/online/persistence-gateway.cjs`: composes Firebase join verification, fail-closed VIP authorization, player profiles, room checkpoints, UID-based resume, scoring hooks, period leaderboards, and previous-period snapshot hook.
- **NOT integrated:** the ZIP test server still runs its older in-memory handlers. No database exists, no migration was applied, no scheduled archiver is active, and no tests were run.
- **Critical before any live deployment:** commit room state + score events atomically, or implement a durable transactional event outbox with replay on restart. Current `persistGameState` + `applyWinner` / `applyLuckyBox` are distinct calls and can be interrupted between steps, so this gateway alone does NOT guarantee exactly-once delivery.
- **Critical:** choose one authoritative coordinator for each room; optimistic revision guards prevent overwrites but do not alone resolve competing turn calculations or clock races.
- **Critical:** resume requires verifying Firebase UID again, rechecking VIP entitlement, and binding the current WebSocket to that UID. Old bearer-token-only resumes in the ZIP server must be removed before production.
- **Critical:** `listRecoverableRooms` returns candidates only; automatic restoration, timers, waiting queues, and multi-instance synchronization are not implemented.
- **Critical:** `backend/storage/score-period-service.cjs` has a previous-period archive function, but no scheduled invocation, missed-run catch-up, or closed-period event fence. Leaderboard resets are not operational.
- **Product fit:** This SQL backend is a provisional independent server architecture, NOT native GDevelop Multiplayer/Cloud. If GDevelop-managed multiplayer is required, design the service boundaries and compatibility separately rather than claim automatic integration.
- **Security:** the original project repository is public. Do not commit Firebase credentials, private keys or service-account JSON. Do not deploy the prototype with unrestricted VIP rooms.


## Transactional room transition + score outbox (2026-11-25; UNTESTED)
- `backend/storage/migrations/003_turn_award_outbox.sql`: room revision receipts via SQLite trigger, FK-constrained transition marker, durable score award outbox, one winner + one Lucky Box event constraint per game.
- `backend/storage/turn-outbox.cjs`: a D1 `db.batch` attempts checkpoint revision update, required transition marker insertion and award intents in one transaction. Missing revision receipts cause the marker FK to fail, rolling back an unsuccessful version update. Must run with foreign keys enforced.
- `backend/storage/award-outbox-drain.cjs`: processes pending trusted events into score_ledger and game_results using transactional, idempotent inserts, then marks outbox applied; can be invoked again after failures.
- **Neither module is integrated with the ZIP game's event engine or any scheduler, nor tested.** The server still uses in-memory state. This is scaffolding, NOT a working durable-game release.
- **Before deploying:** remove or replace earlier `persistGameState` + separate scoring calls in `persistence-gateway.cjs`; route all server-authored turns through `commitRoomTurn`, ensure event identifiers and award values are derived from authoritative rules, and drain outbox through a trusted process.
- **Before deploying:** enforce that historical score snapshots are never finalized while pending outbox awards exist for that score period. Any late-drained event must not silently change an already archived ranking.
- **Before deploying:** review consistency under concurrently executing outbox drains, prevent duplicate/conflicting event IDs, verify strict timestamp boundaries, enforce one coordinator per room and restore interrupted turn deadlines.
- **No tests performed** as requested. No migrations, scheduled tasks, external hosting or costs introduced.
