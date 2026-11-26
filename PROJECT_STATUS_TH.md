# Lucky Game — Canonical Project Status / Resume Checkpoint

**Snapshot date:** 2026-11-25 (Asia/Bangkok). **This file is the single authoritative living status.** Update it after every substantial GitHub change and after each independently verified external state change. Do not copy "100%" from older chats.

## Identity / repositories
- **ACTIVE repository:** `jtkmanga/Lucky-Game-GDevelop`, branch **`main`**, primary source for this **NEW** Lucky Game prototype. Do not create a second repo now.
- Historical project `jtkmanga/Snakes-and-Ladders-Private` (branch `lucky-cloudflare-do-v1`) is **another project**, not this new app. Consult only for optional reference, never overwrite.
- Main user constraint: mobile-only; prefer connected plugins and one-step Codespaces scripts, minimize user actions and duplicate work.

## Approved architecture (source of truth)
1. **GitHub + Codespaces**: source, web game UI HTML v12, Admin, testing harness (tests currently PAUSED).
2. **Railway**: future authoritative Node.js / WebSocket multiplayer host. A **private empty staging project** exists. **No service, DB, deployment, volume or buckets**.
3. **Supabase**: **Supabase Auth with Google login + PostgreSQL** for player identity, persistent score, VIP, rooms/admin. Supabase project exists and is **ACTIVE_HEALTHY**. **Do NOT provision duplicate PostgreSQL on Railway**.
4. Real payment needs a payment provider later only when the owner approves it. GDevelop and Render are dormant alternatives, not the current pipeline. Firebase/D1 prototype modules are dormant, not active auth/storage.

## External resources — connector-verified (2026-11-25)
| Resource | Verified state | Identifiers / links |
|---|---|---|
| GitHub | GitHub integration writable; source and docs committed to current repo | https://github.com/jtkmanga/Lucky-Game-GDevelop |
| Railway | `Lucky-Game-GDevelop`, private `staging` environment; read after create showed `services=[]`, `volumes=[]`, `buckets=[]`, no staged changes | project `5d695e45-30fe-4b08-b0d0-0b0d250937eb`, environment `e0202327-924e-4913-9a3b-6c4493b2c31b`, https://railway.com/project/5d695e45-30fe-4b08-b0d0-0b0d250937eb |
| Supabase | `Lucky-Game`, org `jtkmanga@gmail.com's Org`, Singapore `ap-southeast-1`, PostgreSQL 17, `ACTIVE_HEALTHY`; quoted project creation cost $0/month | project ref `llbkxnazkliskzcureec`, https://supabase.com/dashboard/project/llbkxnazkliskzcureec |
| Billing | Railway trial screenshot shows $5 credit and no payment card; not an authorization to consume it. Supabase create quote $0/month; future usage/upgrade costs not verified | Review provider quotes before provisioning |
| Railway↔Supabase | **NOT connected** | No DB connection string, auth keys, env vars or service configured |
| Supabase Google provider | **NOT VERIFIED/CONFIGURED** | Google OAuth client ID/secret and redirect allowlist may require owner OAuth consent |

## Feature inventory / verified distinctions
| Feature | Existing asset | Functional status |
|---|---|---|
| UI v12, art, lobby | Original `Lucky_Game_Multiplayer_Test_v1.zip` and GDevelop v3 import preview | Visual source available; do not redesign |
| Free room 4 / VIP room 2, queue, server dice, snake/ladder, 20s skip, 1 Lucky Box, win+10 | Legacy ZIP `server.js` and `rules.js` | Historical 7/7 smoke checks on **guest-only in-memory prototype**; NOT authenticated/persistent |
| Five different random maps | Old design request | **NOT PRESENT in new original engine**; current `map:1` |
| Resume | Legacy guest token and in-memory seat | Not durable or UID-secure across restart |
| Google login on real WS | `backend/auth/supabase-access-token.cjs` + Supabase OAuth browser builder | Source-only draft; provider not configured and NOT TESTED |
| VIP verification | `backend/auth/room-access.cjs` checks trusted storage; PostgreSQL draft `getVipEntitlement` | Source draft only; not live and no grants/payments |
| Persistent rooms/scores | `backend/supabase/001_game_private_schema.sql` + `game-store.cjs` | Unapplied private-schema UUID draft; **no app tables yet established** in Supabase |
| WebSocket with secure joining + DB turns | `backend/railway/secure-server.cjs`; `tools/prepare_railway_secure.py`; `railway.json` | Draft now targets Supabase Auth/private PostgreSQL; single-process limit 500; **NOT tested/deployed** |
| Free weekly/VIP daily rankings | D1 period service draft | Not wired to Supabase, no active schedule |
| Admin, price editing, real payment/VIP entitlement | Old game requirements | Not integrated into new app |
| Test scripts | `qa/lucky-rules-automated.test.cjs`, `qa/lucky-ws-load.cjs` | Authored, **not run since testing pause** |
| Production 10K CCU / 24h×30 days | Goal | **NOT verified**; need sharded authoritative rooms, capacity/cost evidence |

## Historical evidence — reuse, don't redo
- `qa/STATUS_2026-11-25.md` records earlier legacy integration check **7/7 PASS** (Actions run `45616521660`) for unauthenticated test server. Its scope excludes real Auth, payment, permanent data, restart recovery and scale.
- Later new `backend/` integration and `qa/` source files were authored **without tests** due owner pause. Never label them PASS.
- Codespaces previously successfully generated GDevelop preview import v3; actual import/cloud save NOT done and **not needed** on selected Railway architecture.
- Railway private staging project and Supabase free project successfully created through plugins; **no app server or database schema has been deployed**.

## Current constraints / gates
- Owner's last known directive: **SKIP ALL TESTING FOR NOW**. No smoke/unit/bot/browser/Google/payment/Actions runs without explicit repeal; writing test code is allowed.
- No deploy, public URL, paid tools/upgrades, new charge-incurring services, real payment, migration touching existing production data or large load tests without scoped consent and cost visibility.
- Existing UI visual freeze. GitHub repository may be PUBLIC; never commit secrets, customer PII, auth tokens or database credentials.
- Authorized work: documentation, source code preparation, connector read-only inspection; responsible and explicitly scoped staging-only mutations after user approval.

## Active next task (start here; do not restart planning)
**P1.1/P1.2 — Supabase Auth/PostgreSQL migration preparation**
1. Read `AGENTS.md`, this status, `PROJECT_MASTER_PLAN_TH.md`, `DECISIONS_TH.md`, `NEW_CHAT_HANDOFF_TH.md`.
2. Inspect the actual Supabase project schema/auth provider settings using connected Supabase tools (read-only) and related GitHub code. Do **not** create another Supabase/Railway project, deploy or test.
3. **Source complete; migration NOT applied:** private game schema UUID/RLS SQL draft has been committed. A scoped review/authorization is required before applying.
4. **Source drafted, NOT tested:** Supabase token verification, public browser OAuth redirect, private Postgres store and selected Railway source references updated. Remaining work includes provider configuration and actual integration verification once tests are authorized.
5. Update docs with exact source commits, remaining blockers and next step.

## Progress / gates (accurate, not guessed percentages)
- P0 legacy source & historical evidence: **DONE as reference**.
- P1 Auth/PostgreSQL source integration: **IN PROGRESS**.
- P2 all five board maps + authoritative game parity: **PENDING**.
- P3 persistence/resume/Admin/payment/resets: **PENDING**.
- P4 staging + acceptance: **BLOCKED** by explicit test/deploy pause, costs/provider settings.
- P5 scale / 10K evidence: **BLOCKED**.
- P6 production release: **BLOCKED**.

## Last documentation baseline commits
- `AGENTS.md`: `7744b217716ed944997e239d327f0c001168cdbb`
- `DECISIONS_TH.md`: `c01538f669333bf379d3b69180bd7747349c7fef`
- `PROJECT_MASTER_PLAN_TH.md`: `b2162adc694b96184336f8c0a8dde0c48b5f8b29`
- Source-of-truth older integration notes: `RAILWAY_STAGING_AUTH_INTEGRATION_TH.md`, `backend/INTEGRATION_STATUS.md`, `qa/STATUS_2026-11-25.md`.

## Mandatory after every future engineering session
Append a dated checkpoint or edit this file: date, files changed, commit IDs, what is source-only vs actually configured/tested, outside services mutated, costs, explicit pending gates and **one next action**. Avoid claiming 100% before successful acceptance.

## Session checkpoint — 2026-11-25 Supabase P1 source work
- Required canonical files and relevant Railway/Supabase source inspected in order.
- Supabase read-only table listing for public/game returned none; game schema absent. Google OAuth configuration not verified.
- Draft private game schema + RLS, Supabase access-token verifier, private PostgreSQL store, Railway WebSocket Supabase auth integration, browser OAuth bridge and no-secrets env template have been committed to GitHub.
- Source commits: 3149bbf, 8c6e4ac, 253309b, 00a1c93, afc80d9, ad20c0e, 5e2c4b8, 41b1c1e, 4095aea.
- No migration applied; no Railway service, deploy, Google OAuth actual configuration, unit tests, smoke tests or load tests. All new code is UNTESTED DRAFT.
- Existing D1/Firebase and Railway public-schema Postgres files are superseded drafts; selected server now references Supabase. Do not apply old SQL.
- No new paid resources or charge-incurring operations.
- Detailed latest engineering checkpoint: backend/supabase/P1_STATUS_TH.md.
- NEXT SINGLE ACTION: Review Supabase Google OAuth provider configuration and migration prerequisites read-only. Improve UID reconnect implementation in source; do not apply schema or deploy without scoped permission.

## Session checkpoint — 2026-11-26 (Asia/Bangkok); P1 source-only
- Read canonical AGENTS/STATUS/PLAN/DECISIONS/HANDOFF before editing. Resumed from last documented Supabase source checkpoint, not the old game.
- Fixed the *unapplied* Supabase score ledger draft: remove overbroad UNIQUE(game_id,kind) while retaining the partial unique index for win/Lucky Box. Commit `3b853e4c5cd1eaf8ee8e037fbf888dd6a7292970`.
- Drafted `backend/supabase/game-store.cjs` method `findResumableRoomForUid(uid)` scoped to playing rooms and verified UID in persisted seats; commit `6ded17a1954460745795a911cf35abb47992e8ba`.
- Drafted Railway WebSocket `restoreRoom` for verified Supabase UID: load authoritative game, seats, deadline, revision from DB; deduplicate in-process restorations; reconstruct timers and bound seat identity. Commits `c6b05ee916330271dcb3209decf99171cc68058c`, `84a43ff3f84ccdc417712f6aab1b0b8c63c1ef1b`.
- Detailed checkpoint in `backend/supabase/P1_STATUS_TH.md`, commit `c582db239bcb12b2ec7e31accd5b095a4e537968`.
- **Source-only, UNTESTED:** no unit/browser/bot/Google login tests, no migrations, no Railway service/deploy, no paid resources or external load. Supabase game schema and Google provider setup are still incomplete.
- Known recovery limitations: one in-process coordinator; not safe across Railway replicas, long outages, or all startup recovery cases. No 10K proof.
- **NEXT SINGLE ACTION:** Review/fix concurrency around restored room/repeated join and timeout failure paths as source work; separately request scoped authorization before applying the Supabase migration or deploying.


## Session checkpoint — 2026-11-26 (Asia/Bangkok), WS concurrency source fixes
- Followed AGENTS/STATUS/PLAN/DECISIONS/HANDOFF before editing and inspected the then-current secure-server source, which already contained UID join locks.
- Source-only fixes in `backend/railway/secure-server.cjs`: recheck deferred turn deadline when a commit is in-flight; late roll triggers timeout processing instead of relying solely on a possibly consumed timer; reject turns in halted rooms; avoid ghost matchmaking sessions after socket closes during DB player upsert; guard replacement socket before disconnecting the old verified session.
- Commits: `7af27cbed389117086ebc5bfd2ed5c9b110cf188`, `0c58ca5ce14fa8e3a46083fbc7b440c28c4ec5e2`. Detailed notes in `backend/supabase/P1_STATUS_TH.md` commit `b88fc7bbf7a9a393ed319efeb7e84162e1921daa`.
- **No unit tests, browser tests, GitHub Actions, bots, migrations, Google OAuth setup, Railway service/deploy or paid resource use in this session. No PASS asserted.**
- Known open risks: players disconnecting during room insertion; server restart and timer catch-up under long outage; multi-replica room ownership; all Supabase Google OAuth/provider credential and schema migration gates.
- **NEXT SINGLE ACTION:** safeguard matchmaking if a seat disconnects while room creation is awaiting DB persistence, then document DB reconciliation implications. Continue source-only until owner explicitly lifts testing/deploy pause.


## Session checkpoint — 2026-11-26 (Asia/Bangkok), DB-pending seat disconnect protection
- Read current source and canonical handoff files; resumed first eligible task, **no new repository**.
- Changed `backend/railway/secure-server.cjs` to reserve matching seats synchronously before async room INSERT; disconnects during insertion no longer return those seats to matchmaking. On commit, previously disconnected players retain the durable room seat for verified UID reconnect.
- Ambiguous INSERT failure now **quarantines** seats instead of requeuing into a possible second room. During verified reconnect, check the persisted room ID: if playing, restore; if confirmed absent, release all reserved seats and requeue only connected clients; if DB is down, remain quarantined. Switching from Free/VIP while reservation is outstanding is rejected.
- Source commits `d9d6eb9e728bfe4e904ec332ea38cb88d60247cd` and `c0d961cd844f217fe872a182e90d169cce9e06b1`. Detailed engineering note: `backend/supabase/P1_STATUS_TH.md` commit `2f5403fbdbfdbaada11eced006a2ab595e2f54b6`.
- All changes remain **UNTESTED SOURCE ONLY**. No Supabase migration was applied; no Google OAuth configured, no Railway service created/deployed, no tests/CI/bots/load run, no new charge-incurring resources.
- Known blockers: Google provider credentials, database migration approval, restart sweeping of orphaned rooms, distributed room coordinator for multiple replicas, full game parity and 10K evidence.
- **NEXT SINGLE ACTION:** prepare durable room ownership/lease and restart reconciliation design (source only), then identify scoped permissions required to apply Supabase schema when owner explicitly authorizes it.


## Session checkpoint — 2026-11-26 (Asia/Bangkok), room lease / restart sweep groundwork
- Resumed from canonical handoff files and the existing matching persistence code; no duplicate project/repository created.
- Added **UNAPPLIED** SQL lease/fencing schema extension `backend/supabase/002_room_lease_draft.sql` (commit `38dcf0d19e1b4609978de24924296f7905344e8c`).
- Added **UNUSED/UNTESTED** `backend/supabase/room-lease-store.cjs` helper with acquire/renew/release/recoverable-room scan and a fenced update example (commit `82c2794e5bd826c2ae90a9aaef43ffc4cbe30c73`).
- Authored protocol document `backend/supabase/ROOM_RECOVERY_PLAN_TH.md` (commit `292e55d33897887d7faec10335b853a01a3b27b2`) showing how to safely integrate ownership checks into **the same DB transaction** as scores and room changes, and handle crash/ambiguous writes.
- **Important:** lease helper is NOT connected to the runtime; `secure-server.cjs` remains single-process and cannot safely operate multiple Railway replicas. The helper's `guardedCheckpoint` is NOT an atomic award workflow and must not be used to replace `commitTurn`.
- This session did NOT apply Supabase SQL, run tests/CI, configure Google OAuth, deploy Railway, run bots, or create paid resources. No evidence of live recovery or 10K performance.
- **NEXT SINGLE ACTION:** implement the full fenced room+score atomic transaction in source and only then connect the lease protocol to the Railway runtime; respect the current testing/deploy pause. Separately Google OAuth and migration remain gated on scoped approval.


## Session checkpoint — 2026-11-26 (Asia/Bangkok), atomic fenced turn + score draft
- Read the authoritative GitHub handoff files and actual Supabase PostgreSQL game store, room lease helper, lease schema draft, and room recovery plan. No new repo or service.
- Changed `backend/supabase/room-lease-store.cjs`: `commitFencedTurn` performs conditional room update guarded by `room_id`, verified server `owner_id`, `lease_epoch`, active lease and expected `revision`; it inserts at most one winner and one Lucky Box event in the **same PostgreSQL transaction**. Award UID must be in stored room seats; duplicate event aborts the transaction. Source commit `d12ac0bc86a8ffae81fd0fc439078b9b6c257912`.
- Updated `backend/supabase/ROOM_RECOVERY_PLAN_TH.md` to document this method, its preconditions, ambiguous COMMIT errors and incomplete wiring (commit `d8d76396489235fd7c1a72f263cba8518d546e1f`).
- **UNTESTED and NOT ACTIVE.** The actual `backend/railway/secure-server.cjs` still uses an unfenced `game-store.cjs.commitTurn`. Do not deploy multiple Railway replicas or claim durable single-writer correctness. SQL migration 001/002 remains unapplied; Supabase Google OAuth still unconfigured. All tests/CI/load/Deploy remain paused, no paid resources or credit consumed through tool operations this session.
- **NEXT SINGLE ACTION:** design and source-wire lease ownership through room INSERT, recovery, heartbeat and the sole server turn commit path; do not activate/deploy without verifying the atomic transaction, migration and owner testing permission.


## Session checkpoint — 2026-11-26 (Asia/Bangkok), lease-wired Railway source
- Followed AGENTS/STATUS/PLAN/DECISIONS/HANDOFF and examined the latest Railway server, Supabase game store, room lease helper, and 001/002 SQL drafts.
- `backend/supabase/game-store.cjs` now creates owned-lease rooms with epoch 1, exposes room lease acquire/renew/release/recovery and atomic `commitFencedTurn`, removes the unfenced `commitTurn` method, and requires migration 002 lease columns at health check. Commit `2c6126284c5cac271714548d83cb252f94da1c5e`.
- `backend/railway/secure-server.cjs` now uses an instance owner UUID, stores lease epoch per room, claims before restore, renews leases, halts on loss, and calls the fenced atomic room+score transaction for roll/timeout; added bounded startup sweep for 10 orphaned rooms and suppresses broadcasts if the lease is lost concurrently with commit. Commits `4306ea3198890b16667ae51558bec46f4ac39eb2`, `0702c1553fc611bc2f486346112be027313fa411`, `7155b730331bb0d3904e41513926b8bd3f63a9b1`.
- Updated focused protocol in `backend/supabase/ROOM_RECOVERY_PLAN_TH.md`, commit `10cfdaefe1a1aa029df45d154e0392e3ac99272c`.
- **ALL SOURCE-ONLY AND UNTESTED.** No Supabase migration, Google OAuth provider setup, Railway service creation/deploy, CI/tests, load, money or credit usage initiated. Not production-ready or verified multi-replica safe.
- Remaining gaps: shared WebSocket routing and distributed matchmaking identity; periodic reconciliation beyond a 10-room startup sweep; failure recovery from locally halted room; OAuth setup; safe SQL migration; 5 maps, Admin, payments, resets, 10K proof.
- **NEXT SINGLE ACTION:** review and prepare source-level tests for lease fencing, concurrent room ownership, transaction rollback and recovery (do not execute while testing pause remains), then request scoped approval before applying SQL 001/002 or staging deployment.


## Session checkpoint — 2026-11-26 (Asia/Bangkok), source-only lease test preparation
- Continued directly from the canonical GitHub handoff and latest leased Railway server/source state. No new repository or infrastructure.
- Authored (NOT RUN) `qa/supabase-room-lease-contract.test.cjs`, Node `node:test` with a simulated PostgreSQL pool. Cases cover lease/epoch/revision fencing, atomic room/score writes, rollback after duplicate award or SQL failure, rejection for non-seat UIDs, winner +10, lease contention and unfinished-game deadline validation. Source commit `66d435c116343994ee59013cedc67d9efe34392a`.
- Updated an outdated comment in `backend/supabase/room-lease-store.cjs` to say source-wired but NOT TESTED or deployed (commit `99cfc431103d3e050e53c8c52a12ccc28cbe5b29`).
- Added `qa/SUPABASE_LEASE_TEST_PLAN_TH.md` describing expected assertions and limits of mock-only coverage, isolated real-DB acceptance gates and how to retain existing evidence without needless reruns (commit `6e8b81666b4e658a499f7303729a58dc9b41e43e`).
- **Zero tests executed.** No Actions/CI, Supabase migrations, Railway service/deploy, Google OAuth setup, load tests, new paid resources or new credit usage. No PASS claim. Mock tests cannot certify real PostgreSQL, RLS, external recovery or 10K.
- **NEXT SINGLE ACTION:** static-review the fenced transaction for ambiguous commit/rollback failures and draft isolated real-PostgreSQL test fixture/teardown only, still without running tests or deploying; separate scoped approval required for tests, migrations and deployment.


## Session checkpoint — 2026-11-26 (Asia/Bangkok), ambiguous COMMIT safety and isolated DB test design
- Resumed first eligible incomplete P1/QA task after reading AGENTS, canonical STATUS, MASTER PLAN, DECISIONS, HANDOFF and relevant code/test files. No new project/repository.
- **Source-only code:** `backend/supabase/room-lease-store.cjs` now explicitly distinguishes ambiguous `COMMIT` acknowledgement loss from pre-commit SQL failures. After an issued COMMIT fails to acknowledge, it returns `AMBIGUOUS_COMMIT`, does not attempt ROLLBACK/replay and discards the database client. A failed pre-COMMIT rollback also discards the client. Source commit `5f28d88c91b64f189257da0a1e058bb104a5f338`.
- **Tests authored, not run:** `qa/supabase-room-commit-ambiguity.test.cjs` contains mock cases for lost COMMIT response, pre-COMMIT SQL rollback, and failed rollback. Commit `6d4f440dce22693c5b5dfce6a27b5cc22c3d4c32`.
- **Test isolation design:** `qa/SUPABASE_LEASE_TEST_PLAN_TH.md` now defines a dedicated/disposable DB setup, verified test identities, test-owned UUID fixtures, two independent DB connections, post-commit reconciliation, FK-aware narrow teardown, and evidence/cost recording (commit `bb88062e8be3d8fb881a82addfd100ab26850d04`).
- **NOT VERIFIED:** No mock tests, real PostgreSQL tests, CI/Actions, Google OAuth, SQL migrations, database mutations, Railway service/deploy, load tests or spending in this session. Results remain unknown; do not claim PASS or multi-replica readiness.
- **NEXT SINGLE ACTION:** source-only review and harden the server's behavior after an `AMBIGUOUS_COMMIT` (read canonical state under valid lease and stop stale broadcasts), then prepare the staged migration approval checklist. Do not run tests or apply migrations until separately authorized.
