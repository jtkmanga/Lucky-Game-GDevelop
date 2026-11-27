# Lucky Game — Mandatory AI Agent Instructions

> **Read this first at the beginning of EVERY new ChatGPT / Codex / Work session.** This file governs work in `jtkmanga/Lucky-Game-GDevelop` (`main`). Do not use the old repo `jtkmanga/Snakes-and-Ladders-Private` as this project's working tree.

## Reading order (required before implementation)
1. `AGENTS.md` (this file).
2. `PROJECT_STATUS_TH.md` — authoritative current verified status and next action.
3. `PROJECT_MASTER_PLAN_TH.md` — fixed scope, milestones, exit criteria, dependencies.
4. `DECISIONS_TH.md` — owner decisions and boundaries.
5. `NEW_CHAT_HANDOFF_TH.md` — ready-to-use next-session workflow.
6. Read targeted `backend/INTEGRATION_STATUS.md`, `RAILWAY_STAGING_AUTH_INTEGRATION_TH.md`, `qa/STATUS_2026-11-25.md`, source code and associated recent commits ONLY when relevant. Existing evidence must be reused; do not repeat all prior research/tests.

## Owner mandates
- **Preserve Lucky Game playable HTML UI v12 exactly**: no redesign, rearranged layout, colors or graphics. Only make minimum technical wiring changes.
- Build on the existing ZIP prototype `Lucky_Game_Multiplayer_Test_v1.zip` and current backend drafts; **do not start a new game, repo or duplicate project** without concrete technical need and explicit agreement.
- Keep game rules: Free 4 players, VIP 2 players; server-origin dice 1–6; 20s per turn then SKIP (never automatic roll); overshoot 100 wins, +10 winner points; exactly one Lucky Box per game with visible award; 5 randomly selected distinct board maps (NOT completed in the new engine); UID-bound resume; daily VIP / Sunday Free reset at 00:00 Bangkok time; separate secure Admin; paid VIP/items eventually.
- Preferred architecture **GitHub + Codespaces for source/automation; Railway Node.js/WebSocket for authoritative multiplayer; Supabase Auth (Google) + Supabase PostgreSQL for identity/durable data**. Payment provider only when ready. Do not create a second Railway PostgreSQL DB or use Firebase as the production login without a documented new owner decision.
- **Current execution policy: D15 in DECISIONS_TH.md**. Use `docs/lucky-autonomous-backlog` for the newest written policy/checkpoint when main is stale. Routine technical work, isolated test resources and scoped Staging deploys within approved budgets do not require per-step approval.
- Never exceed approved budgets, enable paid upgrades, buy credits, expose a new public service, or authorize large-scale load outside approved scope. See D15; keep production isolated.
- The repository may be public. NEVER write API keys, access tokens, database password, OAuth client secret, payment details, service_role keys or actual customer data to commits, logs or chat. Prefer server-side environment settings, least privilege, and private game tables protected by schema/RLS. Do not expose insecure guest/VIP listener to the internet.
- Work autonomously across development, isolated QA and approved Staging. Keep scope and ownership separate for parallel tasks; no Scheduled Task.
- Continue from the first eligible incomplete milestone in the status file. Write changes to GitHub with useful commits; record exact commit SHA, files, test status (including "not run"), environment impact, blockers, next single action. Never mark a milestone complete based on code written without verification.
- Do not claim background execution or 24/7 continuation. New chat must explicitly read these files again; it cannot inherently resume background work.

## Safety decision gates
- Database schema mutations in newly created Supabase may be allowable development work after reviewing RLS, but **do not apply migrations silently** while owner asks documentation-only, and do not mutate existing production/paid resources. Check real cost and impact first.
- Production, public exposure, real payment and spending outside approved scope require separate consent. No main change that could deploy Production. Maintain test-only identities and least privilege.
- If a task is blocked by OAuth credentials, owner action, plan limits, or tool failure, document the precise blocker and continue other nondependent work. Never use dummy credentials to declare success.

## Source of truth
The **current app** is `jtkmanga/Lucky-Game-GDevelop` (main). The old Cloudflare Lucky Game remains historical reference, not proof of feature parity. Refer to `PROJECT_STATUS_TH.md` for authoritative current state; update it after actual changes. Avoid conflicting '100%' claims in older notes.
