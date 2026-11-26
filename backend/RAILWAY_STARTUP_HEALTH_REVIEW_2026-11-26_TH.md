# Lucky Game — Railway server startup and health-readiness review
**2026-11-26 Asia/Bangkok | SOURCE CHANGED, NOT TESTED, NOT DEPLOYED**

## Scope and current prior evidence
- Previous owner-run Node `pg` read-only TLS/auth against Supabase restricted login: **PASS**, including role and grants; this was connectivity-only, **not server startup**.
- Current Railway staging inventory at prior inspection: **0 services and 0 deployments**. Trial workspace screen: **$5 credit remaining / $0 usage**, not a guarantee of future service cost.
- `railway.json` uses `/health` as the deploy healthcheck and starts generated `railway-runtime/backend/railway/secure-server.cjs`. The runtime generator copies `backend/railway/secure-server.cjs` to runtime without a visual/UI redesign.

## Source review and targeted change
- Existing startup sequence already called `store.health()` then the bounded orphan recovery before `server.listen`; DB health checks verify actual restricted role, expected grants, and required schema. However previous `/health` handler returned static HTTP 200 and `{ok:true}` for any request even without an explicit lifecycle state.
- Updated `backend/railway/secure-server.cjs` at commit `b7bb3599d9fc0dd8e97f63a5b30c6ac2b2367387`:
  - Initialize `startupReady=false`, `shuttingDown=false`.
  - Return HTTP **503** with status `starting` until initialization/listen finished; HTTP **200** with status `ready` after successful server listening; HTTP **503** with `stopping` during shutdown. No credential or internal DB details emitted.
  - Explicitly handle listen-startup errors and abort startup without falsely advertising health, logging only a safe error code.
  - SIGTERM flips readiness off and closes the WebSocket/HTTP listener and database pool; if the server never opened, close the DB pool without calling an unlistened `server.close`.
- `/health` does NOT make database queries on each request, minimizing extra Supabase requests. This is a **startup readiness** check, not continuously proven DB or Auth availability. A later readiness/liveness policy may need bounded reconnection/ongoing monitoring; do not claim end-to-end runtime health.

## Test scope and next gate
- **NOT RUN:** Node syntax checks of this updated source, process startup/health requests, graceful SIGTERM verification, DB connection retry, Google OAuth, multiplayer, Railway deployment.
- Existing test pause remains; this source-only change does not authorize a test.
- No changes to `railway.json` routing, UI v12, payment/VIP, schema, PostgreSQL permissions, Supabase settings, Railway services or billing.
- **NEXT SINGLE ACTION:** obtain narrow consent for one existing-Codespaces local startup/healthcheck test (no Railway deploy; no persistent SQL writes), with secret supplied privately, then record actual result and tested SHA. Before deployment separately approve Railway staging scope/spend/time window.
