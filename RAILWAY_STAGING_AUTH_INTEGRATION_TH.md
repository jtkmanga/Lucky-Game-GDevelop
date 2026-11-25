# Railway Staging + Firebase Auth + PostgreSQL integration checkpoint
Date: 2026-11-25

## Railway access & actual state
Authenticated Railway connector confirmed account access. Created private empty Railway project:
- Project: Lucky-Game-GDevelop
- Project ID: `5d695e45-30fe-4b08-b0d0-0b0d250937eb`
- Environment: `staging` (`e0202327-924e-4913-9a3b-6c4493b2c31b`)
- Dashboard: https://railway.com/project/5d695e45-30fe-4b08-b0d0-0b0d250937eb
- Read-after-create: zero services, zero volumes, zero buckets; **no deployment** and no database.
- Trial account screenshot: credit $5, no payment method. Never provision a paid resource without checking expected cost / owner authorization.

## New drafted files committed
- `backend/railway/001_postgres.sql` — PostgreSQL players, VIP entitlements, rooms, score event ledger (not migrated).
- `backend/railway/postgres-store.cjs` — parameterized PostgreSQL player and VIP reads, room snapshots, single-transaction revision update + idempotent win/Lucky Box events, period leaderboard query (draft, not tested).
- `backend/railway/secure-server.cjs` — Node WebSocket listener draft requiring Firebase ID Token on every join/rejoin and checking VIP against trusted PostgreSQL data. Uses server-owned `crypto.randomInt(1,7)`, in-memory single-room coordinator, 20s skip, database commit before broadcast. Blocks service startup before DB/schema readiness. Limitation: in-memory room queues/recovery and single-instance logic; MAX_CONNECTIONS=500 is an unvalidated, intentionally conservative gate. Not production / not 10K ready.
- `tools/prepare_railway_secure.py` — extracts **original** HTML v12 and `rules.js` from committed prototype ZIP into `railway-runtime/`; injects Firebase Google sign-in and token-backed WebSocket join. Visible colors/layout untouched. This is a source change only; browser popup behavior and actual login still require validation.
- `railway.json` — Nixpacks build and run commands; committed for future Railway GitHub integration. No service currently connected.
- `.gitignore` ignores `railway-runtime/`.
- The old `render.yaml` remains a dormant alternative; do **not** also connect Render.

## Configuration to be provisioned in a future Railway Service (none created)
- `DATABASE_URL` — managed PostgreSQL connection URL, Secret.
- `FIREBASE_PROJECT_ID` — Firebase project ID (server and browser).
- `FIREBASE_API_KEY` — public Firebase Web API key; set as service variable, not in repo.
- `FIREBASE_AUTH_DOMAIN` — authorized Firebase login domain for deployed host.

Important: Allow the actual Railway domain in Firebase Authentication authorized domains and enable Google provider. These changes require Firebase account access. The presence of Firebase verification code is not proof Google Login works. Never commit service account keys, bank data or access tokens.

## Explicit blockers before a production game
1. PostgreSQL service absent; schema not applied. No scoreboard storage live.
2. Firebase client has no configured real project keys or authorized domain. Real login not tested.
3. No authenticated VIP grant/payment/admin workflow, and no existing paid entitlements migrated.
4. The real WebSocket listener has not been deployed or run. The prototype remains separate.
5. No persistent resume after server restarts; matchmaking queues in memory; no shared per-room coordinator / multi-replica architecture.
6. Five distinct boards not implemented in original rules (still map:1).
7. No scheduled Sunday Free or daily VIP archive/reset job.
8. No large-scale results; 10K CCU is not verified. Current draft deliberately caps sockets to 500 per process.
9. Do not enable unauthenticated `ENABLE_INSECURE_GUEST_WS` from legacy Render preview in a public deployment.

## Owner's testing and deployment policy
Prior directive: pause all tests; avoid unapproved spending and no production deployments. In this task only an empty private Railway staging project was created, and source-only drafts were committed to GitHub. **No tests, paid database creation, running services, deployments or charge-incurring load were triggered.**

Next steps are configuration and integration; deploy only when owner explicitly enables staging and the billing scope is clear.
