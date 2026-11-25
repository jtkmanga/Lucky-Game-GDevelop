# Lucky Game — Automated Codespaces Lab (prepared, NOT executed)

## Current owner instruction
All manual and automated game tests are still **paused**. This commit writes test utilities only. No bots have been launched, no public endpoint contacted, no Railway resources created, and no costs incurred by the scripts.

## What the scripts cover
- `qa/lucky-rules-automated.test.cjs` checks the *actual* source `rules.js` copied from `Lucky_Game_Multiplayer_Test_v1.zip`: Free 4, VIP 2, dice bounds, no auto-roll on timeout, overshoot wins +10, snake/ladder transitions, Lucky Box once, and the **known gap** that the engine still exposes only `map:1`.
- `qa/lucky-ws-load.cjs` creates synthetic WebSocket clients against the **legacy test-only server** on `/ws`. They join Free/VIP queues, take turns automatically, count rooms and games completed, and summarize event latency, WebSocket errors and bytes transmitted. No real Google accounts or payment verification is performed.

## When owner explicitly reauthorizes testing: local Codespace commands
Run in `jtkmanga/Lucky-Game-GDevelop` Codespaces. **Do not run yet under current pause.**

Terminal 1:
```bash
cd /workspaces/Lucky-Game-GDevelop
git pull --ff-only origin main
python3 tools/prepare_render_web.py
cd render-web
npm install --omit=dev --no-audit --no-fund
node server.js
```

Terminal 2:
```bash
cd /workspaces/Lucky-Game-GDevelop
node --test qa/lucky-rules-automated.test.cjs
node qa/lucky-ws-load.cjs --players=100 --mode=free --seconds=90 --pace-ms=25 --completed-games=1
```

Subsequent increments **only after real owner approval and evidence review**:

```bash
node qa/lucky-ws-load.cjs --players=1000 --mode=free --seconds=240 --pace-ms=10 --completed-games=10
node qa/lucky-ws-load.cjs --players=5000 --mode=free --seconds=600 --pace-ms=10 --completed-games=10
node qa/lucky-ws-load.cjs --players=10000 --mode=free --seconds=900 --pace-ms=10 --completed-games=10
```

The 10K command may exceed Codespaces memory/socket/CPU quotas. A Codespace load generator is not proof that Railway can support 10K concurrent users. The actual target environment must be tested separately to verify production-like capacity, network and costs. Avoid large tests on the same machine as the server when measuring realistic server capacity.

## Defaults and safety controls
- Default target: `ws://127.0.0.1:8080/ws`; it refuses remote targets unless `ALLOW_EXTERNAL_LOAD=I_ACCEPT_THE_RISK` is set by the operator.
- Default load: 100 test clients, test duration 90s, startup spacing 25ms; maximum 10,000 requested clients, maximum duration 2 hours per invocation.
- Stops at target completed games, time limit or error threshold. Reports JSON and exits nonzero on failure.
- The test protocol accepts **unauthenticated guest joins** and therefore MUST NOT be exposed publicly. The Render preview Blueprint intentionally blocks this old protocol (`ENABLE_INSECURE_GUEST_WS=false`). Never enable guest WS on public Render to facilitate this lab.
- There is no automated charge-limit enforcement; use a local Codespace only, and seek approval before any external target load or paid service.
- There is no Google Login, VIP entitlement, persistent database, admin, billing, reconnect-after-server-restart or five-map coverage in this initial harness. Those must be integrated before meaningful end-to-end validation.

## Recommended next development work
1. Build the authenticated production WebSocket listener using the previously drafted `backend/online/persistence-gateway.cjs` and `backend/online/turn-coordinator.cjs`; replace the guest token resume.
2. Choose the database adapter for the final Node.js host (PostgreSQL if Railway, rather than assuming Cloudflare D1 works in Node).
3. Add the five authoritative maps, secure billing/Admin and durable period resets.
4. Expand tests to cover real validated end-to-end flows. Only **then** test scaling and 10K CCU.

## Results
**None in this step.** No tests were run and no pass/fail percentages have been claimed.
