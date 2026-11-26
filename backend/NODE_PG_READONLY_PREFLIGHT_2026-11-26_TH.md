# Lucky Game — Node pg Session Pooler read-only preflight (owner-run)
**2026-11-26, Bangkok | SOURCE ONLY — NOT RUN**

## Purpose
Confirm that Node.js `pg` (not merely `psql`) can use the project's Supabase Session Pooler via the existing restricted account, project CA and hostname-verified TLS. This is a **single read-only SQL query** and **not** a Railway deployment.

## Current verified facts (reuse without retesting)
- Existing Codespaces offline Node TLS config tests 4/4 PASS at `32b431044dfc5b7547921747b1f4e183cce9128f`, generator and Node syntax PASS.
- Owner `psql` custom-role login, `game.rooms` access, `game.orders` denial and bounded INSERT→UPDATE→ROLLBACK with remaining test rows 0 PASS in earlier evidence.
- Railway workspace Trial: $5.00 available, $0.00 used as of owner screenshot, zero services/deployments as of connector inspection.
- The above **does not establish Node pg authentication or TLS handshake**.

## Preflight source
`qa/railway-pg-readonly-preflight.cjs`, commit `f71fc32f8701eed1e369f2c5fbdfca5f74c13266`.

- Requires owner to run from an existing interactive Codespaces terminal; if no TTY, fails.
- Password is prompted without echo in the Node `readline` terminal. Nothing gets written to GitHub, files, shell arguments or a service variable.
- Requires the `pg` runtime dependency to be installed **in local generated** `railway-runtime/node_modules`; no Railway service needed.
- Constructs strict approved restricted `postgresql://` URI inside the process only, checks it through existing `poolConnectionOptions`, loads public CA, and uses `ssl.rejectUnauthorized=true`.
- Creates a pool max=1 and sends one SELECT for `current_user`, `session_user`, `current_database`, game schema USAGE, rooms SELECT and orders SELECT.
- PASS only when both roles match restricted login, database is postgres, game USAGE=true, rooms SELECT=true and orders SELECT=false.
- Catches errors without logging raw exception objects or connection string, then closes pool. No SQL writes, migrations or schema changes.
- This confirms live Node PostgreSQL and grants only; it does not prove app startup, multiplayer, RLS row isolation, connection recovery, Railway hosting or Google OAuth.

## Single owner-run command — scoped approval needed
The next step requires a separate owner approval for one **Node read-only network connection** and for installing the project's `pg` and `ws` dependencies in the existing Codespaces generated runtime if absent. No Railway credits should be consumed, but existing Codespaces resource use and npm network dependency retrieval may occur.

```bash
cd /workspaces/Lucky-Game-GDevelop && \
git pull --ff-only origin main && \
python3 tools/prepare_railway_secure.py && \
npm install --prefix railway-runtime --omit=dev --no-audit --no-fund --ignore-scripts && \
node qa/railway-pg-readonly-preflight.cjs
```

The final Node command requests **the restricted `lucky_game_server_login` password** via hidden prompt; do not paste password into chat, issue tracker, environment variables, or commands. Running `npm install` is limited to existing Codespaces and may consume the existing Codespaces allowance; stop if it proposes new charges.

**Stop conditions:** Authentication error, TLS certificate error, expected result mismatch, unexpected npm scripts/install behavior, terminal not interactive, dependency installation issue, or any missing prerequisites. Do not retry blindly, do not set `rejectUnauthorized:false`, and do not use the `postgres` owner account to force PASS. Record only sanitized console result and checked-out SHA.

**No execution or Deploy performed in this authoring session.**
**NEXT SINGLE ACTION:** receive scoped approval for one existing Codespaces Node pg SELECT connectivity check (including local dependencies if missing), owner runs the one command, then record PASS/FAIL from evidence in `PROJECT_STATUS_TH.md`.
