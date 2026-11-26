# Lucky Game — Railway staging launch and cost gate (read-only review)
**2026-11-26 Asia/Bangkok — PLANNING ONLY, NO SERVICE/DEPLOY**

## Verified current Railway state (connector, read-only)
- Project `Lucky-Game-GDevelop`: `5d695e45-30fe-4b08-b0d0-0b0d250937eb`
- Environment `staging`: `e0202327-924e-4913-9a3b-6c4493b2c31b`, non-ephemeral.
- `list_services` and `describe_environment`: **0 services, 0 volumes, 0 buckets, 0 shared variables, no staged patch**; `list_deployments`: **0 deployments**.
- This is not evidence of available account balance, active billing plan, resource credit remaining, or global workspace usage. None was accessible through the read tools used.
- No Railway changes made in this review.

## Official Railway pricing context (NOT account billing confirmation)
- Railway official Free Plan: $0 subscription, $1 monthly resource usage credit after trial, sleeping services, limited per-service CPU and memory. Free Trial: once-off $5 credit for up to 30 days.
- Hobby: $5/month minimum, with $5 usage credit; usage above that can be charged separately. Not equivalent to unlimited use.
- Railway resource accounting includes active memory, CPU and network egress (and storage if applicable). A long-lived WebSocket connection may prevent sleeping and generate idle resource charges.
- Official sources: https://docs.railway.com/pricing/free-plan , https://docs.railway.com/pricing/free-trial , https://docs.railway.com/pricing/understanding-your-bill , https://docs.railway.com/pricing/cost-control .
- **DO NOT ASSUME** owner's subscription, account usage credit, allowance, paid method, stop limit or affordability from public plan rates.
- Before any create/deploy action, inspect **Railway workspace Usage, current Plan, active credits and cost-control limit** in the account. Agree a maximum financial authorization and a test window. Set any supported usage limit before deploy. Verify whether the control is a hard cap, and account for reporting/stop latency; do not assume automatic immediate shutoff without evidence.

## Exact proposed minimal staging resource (separate owner approval needed)
- Reuse the **existing** Railway project and **existing staging** environment; one Node/WebSocket application service connected to `jtkmanga/Lucky-Game-GDevelop` `main`, NOT a new project or Railway Postgres.
- Limit to **one replica**. Use a conservative ceiling suited to actual plan and observed memory needs, e.g. candidate **0.5 GB RAM / 0.5 vCPU**, **not a guaranteed minimum**, and verify provider limits before saving.
- No volume, new database, autoscale, public payments, VIP fulfillment, admin mutation, 10K bot runner or production endpoint.
- Set `DATABASE_URL` only in a confidential service variable using **restricted** PostgreSQL login `lucky_game_server_login`, never `postgres`. Require verified CA/TLS hostname validation in the Node `pg` client before real connections.
- `SUPABASE_URL` and public/publishable key through server environment only as currently required; Supabase Google provider/redirect settings are still not end-to-end validated. Never put credentials in GitHub or public build logs.
- Only consider staging deployment when server Auth/DB integration and UI v12 compatibility are ready and owner separately authorizes a deployment and maximum spend.

## Source-specific blockers found
- Root `railway.json` uses Nixpacks, runs `python3 tools/prepare_railway_secure.py && cd railway-runtime && npm install --omit=dev --no-audit --no-fund`, then `cd railway-runtime && npm start`; health path `/health`; auto-restart on failure up to three times. No deployment proof for this repo.
- `backend/railway/secure-server.cjs` has a conservative `MAX_CONNECTIONS=500`, one-process Maps and a fallback to board 1 while client rendering remains unverified. The source explicitly says it is a DRAFT, not tested/deployed/production-ready; do not claim 10K readiness.
- `backend/supabase/railway.env.example` contains placeholders only; no service exists to receive secrets today.
- The privileged `postgres` user was used **only** for role credential provisioning; game runtime must use restricted custom role and verified TLS.
- The owner-run restricted SQL acceptance `INSERT 0 1`, `UPDATE 1`, `ROLLBACK`, `remaining_test_rows=0` is **PASS** for that DB fixture, not Railway deployment approval.

## Pre-deploy checklist and authorization boundary
1. Confirm workspace plan, measured credits, usage/budget limit from authenticated Railway billing (read-only).
2. Review and if needed fix source-only Node TLS CA validation and fail-closed readiness checks; no browser UI redesign.
3. Specify one service, one replica, region, memory/CPU limits, source branch, time window, allowed route(s), monitoring and emergency stop. Ensure this proposal meets actual provider plan.
4. Get **explicit approval for service creation, deployment, cost ceiling and duration**. Public exposure is a separate gated decision; no production deployment.
5. Stage service/config without secrets in GitHub; supply secrets privately through the provider; verify from provider that no variable is public.
6. When separately approved, deploy controlled staging, check health/auth/real DB activity and shutdown/billing; record deployment ID, SHA, outcome and measured cost in `PROJECT_STATUS_TH.md`.

## Final state
**NOT DONE:** Railway service creation, secrets, deployment, real runtime Auth/DB integration, Google OAuth and external multiplayer tests.

**NEXT SINGLE ACTION:** verify authenticated workspace **Plan / Usage / Credits / Cost Control** and decide an explicit staging cost ceiling before service creation. If inaccessible via connector, owner may inspect dashboard; do not invent account-specific prices.

**No spending or provider mutation in this review.** Project completion remains **22% estimated**.


## 2026-11-26 20:28 Asia/Bangkok — Owner Railway Usage screenshot, measured zero usage
- Authenticated Railway workspace `JTK Manga's Projects` screenshot shows Usage interval **Nov 25–Nov 27**, `Current Usage $0.00`, `Discounts $0.00`, `Credits Used $0.00`, `Estimated Month's Cost $0.00`, `Credits Available $5.00`, `Est Credits Required $0.00`, and **No project usage this month**.
- Trial Plan text reports **one-time $5.00 credit**, **1 GB RAM, 2 vCPU, 1 GB disk**, and top banner **"30 days or $5.00 left"**. Previous Billing screenshot: no payment method, no billing history.
- This confirms *dashboard-reported workspace credit/usage at screenshot time*. It does not establish real future burn rate, a configurable spending cap or application readiness. No running service; Railway connector inventory still has 0 services/deployments as previously checked.
- **Conservative proposed staging envelope**, not yet authorized: one service, one replica, no additional PostgreSQL/database/volume, no payments or production, keep total Trial consumption bounded by available credit and a short manually monitored session. A hard cap below $5 is **not verified**; require explicit owner's acceptable credit spend and duration, confirm supported resource limits and cleanup behavior before provisioning. Stay under Trial plan's stated limits, but do not claim specific $/hour without measured resources and pricing.
- **Unresolved deployment gate:** trusted Node `pg` CA/verify-full TLS wiring, private `DATABASE_URL` injection and Auth/OAuth runtime prerequisites; test source readiness before spending credit. Owner's prior DB `INSERT→UPDATE→ROLLBACK` PASS remains valid, not full Railway runtime verification.
- No Railway change, plan upgrade, credit consumption by a new deployment, Codespace action or UI v12 modification in this checkpoint. **NEXT:** review source-only server TLS/readiness wiring and prepare a service creation/deployment approval proposal with a specific maximum spend and time limit; no deploy automatically.
