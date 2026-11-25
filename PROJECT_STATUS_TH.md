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
| Google login on real WS | `backend/auth/firebase-id-token.cjs` + Firebase-based draft Railway bridge | Supabase source replacement drafted; NOT TESTED |
| VIP verification | `backend/auth/room-access.cjs` checks trusted storage; PostgreSQL draft `getVipEntitlement` | Source draft only; not live and no grants/payments |
| Persistent rooms/scores | `backend/railway/001_postgres.sql`, `postgres-store.cjs`; older D1 drafts | Unapplied SQL draft; **no app tables yet established** in Supabase |
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
3. Produce a **Supabase-native, RLS-safe schema migration draft** using Supabase `auth.users.id` UUID and private `game` schema; resolve mismatch with text-UID Railway draft. Commit draft in GitHub; **do not apply migration** during documentation-only/testing pause without proper scoped approval.
4. Draft/implement Supabase token verification and browser Google OAuth bridge replacing Firebase in active Railway source while keeping the UI visually untouched; no claims of test success.
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
