# Lucky Game — Railway ↔ Supabase connection preflight and approval gate

**2026-11-26 (Asia/Bangkok) | DOCUMENT ONLY — NO LOGIN, SECRET, TEST OR DEPLOY**

## 1. Actual current state verified via connected providers

- Supabase: `Lucky-Game`, project `llbkxnazkliskzcureec`; migrations 001–004 already recorded. The `lucky_game_runtime` role is **NOLOGIN**, non-superuser, non-BYPASSRLS, with a limited set of SQL grants and 11 role-scoped policies. No database connection can authenticate as this NOLOGIN role.
- Data API: owner dashboard previously showed `game` **unchecked** in exposed schemas; game table access is denied to `anon` and `authenticated`.
- Railway: existing project `Lucky-Game-GDevelop` (`5d695e45-30fe-4b08-b0d0-0b0d250937eb`) has staging environment `e0202327-924e-4913-9a3b-6c4493b2c31b`. Direct Railway inventory shows **0 services, 0 volumes, 0 buckets, 0 shared variables, no pending staged patch**. No service exists to receive secret variables or be deployed yet.
- This inventory was **read-only**. No local Codespaces, Auth tests or database mutations.

## 2. Smallest follow-on scope, requiring separate approval

A. Review whether the managed Supabase network endpoint (direct or pooler) supports the proposed dedicated login for this project; confirm host, region, port, TLS verification, connection limits and actual username format from the project's **Connect** dialog without copying password or URI into GitHub/chat. Do not assume the role name alone will work with every pooler mode.

B. Create a separate non-superuser **LOGIN** identity only after owner approval, with an independently generated secret delivered through a secure channel (not chat/GitHub). Its membership in `lucky_game_runtime` must be explicit and verified. Do not give it `postgres` / `service_role` / `anon` memberships, table ownership, CREATEDB, CREATEROLE or BYPASSRLS. Review `INHERIT`/membership options for effective permissions on the installed PostgreSQL version.

C. Independently verify the **effective login** has only authorized schema/table access and actually obeys RLS. Verify that `anon` and `authenticated` permissions and Data API exclusion remain unchanged. No inserts into real player/room tables without an approved isolated integration test.

D. A Railway staging **service** would need a **separate deploy / cost approval** before creation. Only then set private `DATABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and public `SUPABASE_URL` as service variables through the provider's secret controls; the database URL must never be sent to browser build, public config endpoint or logs. `NODE_ENV=production` is a runtime flag, not evidence of production readiness.

E. Runtime integration test, real Google OAuth, and staging deployment each require their own explicit scope. Do not use PostgreSQL owner credentials as a convenience shortcut. `backend/supabase/railway.env.example` is placeholders only.

## 3. Important role-membership observation

SQL catalog after migration 004 reports `postgres` a member of `lucky_game_runtime`, grantor `supabase_admin`, `admin_option=true`, `inherit_option=false`, `set_option=false`. It was not written in the SQL 004 source. A later preflight must inspect whether this is provider-managed behavior and ensure an effective LOGIN identity is not accidentally elevated. **Do not revoke or mutate this membership without separate provider review.**

## 4. Blocker / exit criteria

**Current blocker:** no approved LOGIN credential and no Railway service; managed pooler username/TLS behavior not verified. A server deployment cannot yet be meaningfully tested against this private schema.

**Next owner approval candidate:** a tightly scoped, separately reviewed database LOGIN + membership plan. Do not create this account, stage variables, authorize new spending, or deploy based on this document alone.

**Outcome:** architecture/preflight documentation only; migration 004 unchanged, UI v12 unchanged, tests not run, no new resource created, no provider cost measured. Overall project estimate remains **22%**.


## 2026-11-26 — Connection-mode research (read-only, not project connection verified)

Official managed-Supabase connection guide: https://supabase.com/docs/guides/database/connecting-to-postgres

| Route | Typical port / network | Relevance to Railway long-lived Node process |
|---|---|---|
| Direct Postgres | `5432`, IPv6 on Free projects absent a separately purchased IPv4 option | Suitable for persistent Node process **only if Railway runtime network can reach the project's IPv6 endpoint** |
| Supavisor shared **session** pooler | `5432`, IPv4 | Preferred fallback for a persistent Node process where direct IPv6 is unavailable |
| Supavisor shared **transaction** pooler | `6543`, IPv4 | Prefer for short-lived/serverless clients, not the first choice for this persistent service; prepared-statement behavior differs |

These are **general Supabase platform modes**, not a verified Lucky-Game connection string, availability test or guarantee that the custom PostgreSQL role can authenticate through the selected pooler. **Do not hardcode** an example host, placeholder account or user form in Railway: confirm the project-specific Connect dialog and the effective custom-role username format directly, without sharing secrets.

### Technical source gap to resolve before deployment

- The selected backend `backend/supabase/game-store.cjs` creates `new Pool({connectionString,max:8,connectionTimeoutMillis:5000,idleTimeoutMillis:30000})`. No explicit SSL CA/verification option is configured in this source snippet; review `node-postgres` TLS configuration and the actual Supabase root certificate/endpoint requirements before adding security-sensitive connection behavior. **Do not just set `rejectUnauthorized:false`**.
- The runtime stores state through an explicit `BEGIN`/UPDATE/INSERT/COMMIT transaction and repeatable-read forensic inspection. Preserve connection pinning and ensure any pooler chosen supports its transaction semantics. Never treat a failed network request as a confirmed rollback.
- Before any approved LOGIN action, confirm the provider's support for a **custom role through direct vs session pooler**; verify actual DNS/IP reachability, region, connection count and server trust chain **without exposing a URI/password**. Avoid assuming the published sample `postgres.project-ref` username format applies to a custom role.
- If effective custom-role access cannot be established with available free-tier endpoints, **stop** rather than downgrading to the database owner password or buying an IPv4 add-on without explicit approval.

**Current finding:** architecture choices documented; custom user/pooler compatibility and target-specific TLS are **NOT VERIFIED**. No credential, test, provider setting, role membership or deployment was changed.

**NEXT SINGLE ACTION:** inspect the authenticated Supabase `Connect` panel for project-specific direct/session connection modes and verify support for a custom non-owner LOGIN identity **read-only**; then review the exact scoped SQL LOGIN/membership proposal before requesting separate approval.
