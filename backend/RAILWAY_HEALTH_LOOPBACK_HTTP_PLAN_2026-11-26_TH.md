# Lucky Game — /health isolated loopback HTTP verification
**2026-11-26 Asia/Bangkok — SOURCE WRITTEN / NOT RUN**

## Why this is a separate test
Existing owner evidence: pure health state cases **4/4 PASS** from the original Codespaces. They do not demonstrate a real HTTP response.
The production `secure-server.cjs` startup performs `store.health()` and `recoverOrphanedRoomsAtStartup()`. The recovery process may claim room leases (DB writes) if eligible rows exist. Therefore do **not** run a real game server just to check HTTP status under the offline-only test approval.

## Changes prepared
- `backend/railway/health-http-handler.cjs` commit `46c1e7a60a202755745fc0277ef6f5087a6668c9`: shared HTTP serialization and security/no-cache headers from existing pure `healthResponse`, no DB or network code in module.
- `backend/railway/secure-server.cjs` commit `66cd2479b7d8080e6fda1fe4b1da0e727eeac207`: actual `/health` route now delegates to shared handler, retaining existing readiness lifecycle, all other route behavior and unchanged UI v12.
- `tools/prepare_railway_secure.py` commit `274a471b24a77fb717a4ba69ca6b9e73996ecf35`: copy shared handler into generated runtime.
- `qa/railway-health-loopback-http.test.cjs` commit `019c11fce9ff91937570d423eb26c95552ef1074`: **3 local HTTP tests**, with a temporary Node HTTP server bound to `127.0.0.1:0` (OS-assigned ephemeral local port), GET `/health`, check 503 while starting, 200 when ready, 503 stopping, content-type/cache headers, and no internal DB fields in body. Closes local server in `finally`.
- Tests use the exact shared handler invoked by production `/health`, but **do not** load or run real `secure-server.cjs` or its startup/WS/auth/DB work.

## Approved boundary vs new approval
The previous owner scope authorized *pure offline* health 4/4 and runtime/syntax only, and is already PASS. This new loopback HTTP test opens a local transient network socket; request a **fresh narrow authorization** before running. No external port forwarding or Codespaces Public Port needed.

### One-shot command for owner after approval, existing Codespaces only
```bash
cd /workspaces/Lucky-Game-GDevelop && \
git pull --ff-only origin main && \
node --test qa/railway-health-loopback-http.test.cjs && \
python3 tools/prepare_railway_secure.py && \
test -f railway-runtime/backend/railway/health-http-handler.cjs && \
node --check railway-runtime/backend/railway/health-http-handler.cjs && \
node --check railway-runtime/backend/railway/secure-server.cjs && \
git rev-parse HEAD && \
echo "RAILWAY_HEALTH_LOOPBACK_HTTP_PASS"
```

**Expected**, not yet observed: 3 tests pass, generated handler file exists, syntax checks exit zero, final marker is printed.

## What passing would and would not mean
PASS would verify the **shared HTTP handler** over a local TCP loopback with real HTTP status and JSON headers. It would **not** prove the full game server starts against Supabase, that Railway is healthy, nor multi-player/Auth, room lease recovery, or SIGTERM lifecycle. In particular simulated readiness state does not prove production lifecycle transitions happen on schedule.

No code was executed for this checkpoint. No Supabase query/write, Railway service/deploy/credits, public listener, secrets, new Codespace or UI v12 changes.

**NEXT SINGLE ACTION:** approval for one isolated HTTP loopback test in existing Codespaces. If provided, owner runs command once, sends sanitized screenshot with HEAD, and evidence is recorded in `PROJECT_STATUS_TH.md`. Stop on error and avoid redundant runs.
