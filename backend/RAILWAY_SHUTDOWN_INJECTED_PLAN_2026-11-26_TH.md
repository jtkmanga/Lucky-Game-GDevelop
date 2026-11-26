# Lucky Game — Railway SIGTERM WebSocket drain source checkpoint
**2026-11-26 Asia/Bangkok — SOURCE WRITTEN ONLY / NOT RUN OR DEPLOYED**

## Reused verified evidence
Owner Codespaces **injected startup 5/5 PASS** at tested HEAD `abb0e1d0c89855c887df4ce5ff8c93912db6a5e1` (recorded in `PROJECT_STATUS_TH.md`). Earlier local HTTP loopback 3/3 and Node pg TLS/Auth PASS remain valid in their respective limited scopes. No reason to rerun those acceptance checks.

## Issue found in source
The prior `secure-server.cjs` SIGTERM handler halted room timers then called `wss.close()` and `server.close()`. It did **not** explicitly close connected WebSocket clients before waiting for the HTTP close callback. Live upgraded connections can keep the underlying listener/clients from draining, so the process could remain stuck rather than exit gracefully. The original handler did not guard repeated SIGTERM.

## Source-only changes
- `backend/railway/socket-shutdown.cjs`, commit `1220667176cf39d8a72ec9516fd6d2c1a77c83b6`: close each tracked WebSocket with code 1001, close WebSocket listener and HTTP server if opened; after a 3-second grace, terminate remaining tracked WS connections and resolve shutdown. Isolates shutdown mechanics from DB calls and `process.exit`.
- `backend/railway/secure-server.cjs`, commit `3596d2ce8c8c8eb1349d62a60f8dbce6bccb6503`: SIGTERM now gates repeated handling with `shutdownStarted`, sets `shuttingDown`, `startupReady=false`, halts room timers, then awaits bounded socket shutdown and closes DB pool before exit.
- `tools/prepare_railway_secure.py`, commit `fbd826731181da6e6647dd6bac4c5ce987582d6d`: copy socket-shutdown helper into generated draft runtime.
- `qa/railway-socket-shutdown-injected.test.cjs`, commit `c03e4e84e0731d664269e7fc803d0944c599cbe1`: four proposed fake-only Node tests for graceful socket close ordering, never-opened listener, stuck HTTP close timeout with terminate, and invalid shutdown grace. Does not open a real socket or send a signal.

## Boundaries / known limitations
- No tests run for this source change; do **not** label SIGTERM or WebSocket drains PASS. The test mocks local method calls, not real sockets or process exit; a real process SIGTERM and WebSocket handshake is still unverified.
- Bounded HTTP drain timeout does not itself prove that `store.close()` completes promptly, or that room state is persisted. Closing a pool while active writes are in flight remains a separate integration risk.
- A tiny window may remain between `server.listen` and stop during startup; no claim that all races are eliminated.
- No UI v12 visual changes; no database SQL or Supabase credentials touched; no Railway services or deployment, no testing spend, and no new Codespaces.
- Existing test pause remains in force for each new scope.

## Next single action: narrowly authorize one local fake-only test
After owner explicitly approves, run only this new test + generator + syntax from existing Codespaces:
```bash
cd /workspaces/Lucky-Game-GDevelop && \
git pull --ff-only origin main && \
node --test qa/railway-socket-shutdown-injected.test.cjs && \
python3 tools/prepare_railway_secure.py && \
test -f railway-runtime/backend/railway/socket-shutdown.cjs && \
node --check railway-runtime/backend/railway/socket-shutdown.cjs && \
node --check railway-runtime/backend/railway/secure-server.cjs && \
git rev-parse HEAD && \
echo "RAILWAY_SHUTDOWN_INJECTED_OFFLINE_PASS"
```
Do not run real server, `SIGTERM`, live WebSockets, Supabase, Google Auth, Railway Deploy or GitHub Actions under this approval. If a command fails, capture sanitized error and stop without repeating the whole suite.

Overall completion estimate stays **22%** until integration milestone acceptance.
