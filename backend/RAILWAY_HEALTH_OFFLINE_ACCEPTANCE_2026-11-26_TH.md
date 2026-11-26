# Lucky Game — Railway /health local-only acceptance plan
**2026-11-26 Asia/Bangkok | PREPARED — NOT EXECUTED**

## Grounded checkpoint
- Owner Codespaces Node `pg` read-only TLS/auth PASS at previously recorded commits; do **not** repeat it.
- Draft secure-server's startup first calls `store.health()`, then scans up to 10 recoverable rooms before opening HTTP/WebSocket listener. The recovery step **may claim room leases and mutate PostgreSQL if matching rooms exist**; it is therefore not safe to describe a full live server boot as a read-only test.
- The 2026-11-26 `/health` change now makes HTTP status depend on startup readiness and shutdown. It **does not continuously check** DB availability.

## Source-only changes
- `backend/railway/health-readiness.cjs` commit `9c4262357a4a9df67873ccd70bd615cd8186367d`: pure `healthResponse(startupReady,shuttingDown)` returns 503/starting before listen, 200/ready after successful initialization/listen, 503/stopping on shutdown.
- `backend/railway/secure-server.cjs` commit `1ef4ff678c322d1046f22d6480d92b31a2ed9ce1`: calls the pure helper from existing `/health` HTTP handler, without changes to UI v12 or network/deploy configuration.
- `tools/prepare_railway_secure.py` commit `486b5af8d580d92ac318fef54c186ef221d5d056`: copies new helper into the generated Railway runtime.
- `qa/railway-health-readiness.test.cjs` commit `f7b3b3cbf34f59473a9686c76e3e4834bbe66e10`: 4 offline checks with no DB, OAuth or server socket.

## Narrow next test requiring scoped owner permission
Run **only the pure offline logic / generated build and syntax preflight** from existing Codespaces; do not launch the server and do not run gameplay, DB, OAuth or Railway deployment.

```bash
cd /workspaces/Lucky-Game-GDevelop && \
git pull --ff-only origin main && \
node --test qa/railway-health-readiness.test.cjs && \
python3 tools/prepare_railway_secure.py && \
test -f railway-runtime/backend/railway/health-readiness.cjs && \
node --check railway-runtime/backend/railway/health-readiness.cjs && \
node --check railway-runtime/backend/railway/secure-server.cjs && \
git rev-parse HEAD && \
echo "RAILWAY_HEALTH_OFFLINE_PREFLIGHT_PASS"
```

A genuine HTTP integration test (starting/ready/stopping through a listener) is **a separately scoped approval**, because actual server startup can access/mutate room leases. Do not treat offline test PASS as proof of a complete runtime /health response. Stop on any error and do not retry blind. Never disclose passwords in logs.

## Environment impact
No service creation, deploy, credentials, DB mutation or billing occurred from authoring these changes. Offline tests have **not** been run by the assistant. Railway workspace previously displayed Trial $5 / Usage $0 but has not been rechecked. Overall project estimate remains **22%**.

**NEXT SINGLE ACTION:** owner approval for the single Codespaces **offline** health test + generator/syntax check, followed by owner terminal screenshot with result and tested commit SHA. Then record actual PASS/FAIL.
