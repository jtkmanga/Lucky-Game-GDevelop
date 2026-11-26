# Lucky Game — Injected full startup sequence preflight (2026-11-26)
**SOURCE PREPARED, NOT EXECUTED; no real game server launched**

## Verified baseline
- Owner Codespaces `main` tested `qa/railway-health-loopback-http.test.cjs` **3/3 PASS**, generated runtime/syntax PASS at commit `47f0a03477699625f98c6f5f22a84c3998e7c983`. Recorded status commit `a7f9c21e02e9bffafe3b28463f72dc29a6a4399b`.
- Previous pure health 4/4 and Node pg restricted login/read-only TLS PASS remain historical verified evidence. **Do not rerun** just to advance this step.
- Real game-server startup calls `store.health()` followed by `recoverOrphanedRoomsAtStartup()`; the latter may **write to room leases**, even if a test only requests GET /health. Thus no live game-server boot against real Supabase is permitted within this draft test.

## Source changes
- `backend/railway/startup-lifecycle.cjs` commit `42da8de0bd35876be0ee0e44740176a5671efdd3`: injectable, production-used `beginListening` that calls health, checks stopping flag, calls recovery, checks stopping flag, waits for listener `listening` or error event, and signals readiness last.
- `backend/railway/secure-server.cjs` commit `4122373010c8263ef7de3540de99d45acc3af566`: uses production `beginListening` with actual `store.health`, bounded recovery and the existing listener; keeps `/health` HTTP handler, SIGTERM and UI v12 unchanged.
- `tools/prepare_railway_secure.py` commit `8b42d404dc73eeae82d8f9ee542f49f9f523e696`: copy startup lifecycle into draft Railway runtime.
- `qa/railway-startup-injected.test.cjs` commit `9051c9061abda043f6ace6c21417aeba5944bd65`: 5 unit cases on the *same* production-used bootstrap function, using injected fake DB/recovery and EventEmitter fake listener; no TCP binding, no credentials, no database or OAuth calls.

## Narrow one-shot test proposal — separate owner approval required
Use only **existing Codespaces**, run this one new offline startup test + generator and syntax. No full server boot and no actual Supabase connections; no new npm dependencies required:
```bash
cd /workspaces/Lucky-Game-GDevelop && \
git pull --ff-only origin main && \
node --test qa/railway-startup-injected.test.cjs && \
python3 tools/prepare_railway_secure.py && \
test -f railway-runtime/backend/railway/startup-lifecycle.cjs && \
node --check railway-runtime/backend/railway/startup-lifecycle.cjs && \
node --check railway-runtime/backend/railway/secure-server.cjs && \
git rev-parse HEAD && \
echo "RAILWAY_STARTUP_INJECTED_OFFLINE_PASS"
```
- Proposed expected: 5/5 pass, no skipped/fail, runtime includes module and syntax checks succeed. These are expectations only and **not observed**.
- If command fails, stop, capture sanitized output and do not retry or change scope. The generated runtime is Git-ignored and should never be committed.
- **Even 5/5 PASS would not prove** real process lifecycle under SIGTERM, HTTP listener status transitions on Railway, Supabase Auth/Google, actual lease recovery, playable rooms, end-to-end WS or 10K load.
- Railway project has **0 services / deployments** at last read-only inventory, with owner Trial Usage screenshot showing **$5 credits available / $0 used** at that time. No charge/start resources with this source work.

## Current state
**Not tested. Not deployed.** Previous tests' evidence retained as independent PASS. UI v12 locked; no new game/app, database change or secrets. Overall project progress estimate remains **22%**.

**NEXT SINGLE ACTION:** owner approves this precise offline injected-startup preflight, then runs it once from the existing Codespaces; record tested SHA and actual results before proceeding toward Railway staging approval.
