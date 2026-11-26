# Lucky Game — SQL 005 restricted LOGIN: review-only plan

**Date:** 2026-11-26 (Asia/Bangkok)  
**State:** NOT APPROVED / NOT EXECUTED. No passwords, credentials, or deploy actions in this file.

## Provider confirmation vs project verification

- Supabase's current managed database connection documentation and troubleshooting guidance describe custom PostgreSQL roles through the **Shared Supavisor Pooler**. The custom pooler username format is `[ROLE].[PROJECT_REF]`, rather than the database owner's `postgres.[PROJECT_REF]`. See:
  - https://supabase.com/docs/guides/database/connecting-to-postgres
  - https://supabase.com/kb/troubleshooting/tenant-or-user-not-found
  - https://supabase.com/docs/guides/database/postgres/roles
- Owner's Connect screenshot confirms this project's *session* endpoint `aws-1-ap-southeast-1.pooler.supabase.com:5432`, database `postgres`. It shows a default *owner* username; **do not use owner credentials for the game service**.
- **Not demonstrated:** a new custom LOGIN authenticating on this particular project, actual TLS handshake, query privileges, or railway service traffic. Published documentation is capability evidence, not an integration PASS.

## Proposed identity (no changes made)

- Existing privilege bundle: `lucky_game_runtime` — `NOLOGIN`, non-owner, no BYPASSRLS, RLS policies and grants installed in Migration 004.
- Proposed distinct LOGIN role name: `lucky_game_server_login`. Name is an **unapplied proposal**, not an account that currently exists.
- Proposed principal attributes: `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT`, with **no ownership, direct table grants, default grants, or memberships in** `postgres`, `anon`, `authenticated`, `service_role`.
- Proposed sole membership: `GRANT lucky_game_runtime TO lucky_game_server_login WITH INHERIT TRUE, SET FALSE, ADMIN FALSE` (PostgreSQL 17 semantics; review actual engine policy before execution).
- Password/credential generation is not defined in GitHub source: generate and deliver it entirely within an approved secure provider workflow; never put it into SQL migration text, tool arguments, GitHub, chat, screenshots, shell history or stdout. Database authentication cannot be tested until that secure workflow has been authorized.

## Proposed SQL structure (schematic; deliberately **not** copy/paste executable)

1. Before any mutation, verify the LOGIN name is unused and that `lucky_game_runtime` still has exactly the grants and policies from Migration 004.
2. Create the role with the exact restricted attributes above **only after an independent secure credential provisioning workflow is selected**. A role without a usable secret is not a completed database connection.
3. Grant the sole membership with inheritance enabled but SET/ADMIN disabled; check `pg_auth_members.inherit_option=true`, `set_option=false`, `admin_option=false`. Check no unintended role memberships and no superuser/bypassRLS flags.
4. Verify effective privileges using the actual login. Never use `postgres` to claim the limited login was tested. Keep `game` excluded from Data API.
5. Verify server's `pg.Pool` TLS trust and hostname verification. Do not set `rejectUnauthorized:false`. Session pooler must preserve each checked-out connection through the server's multi-statement transactions.
6. Consider credential rotation/revoke, pooler authentication caching, safe rollback (revoke LOGIN membership + disable LOGIN before deleting a role), and cost/connection limits. Never alter the provider-managed `postgres` membership found after Migration 004 without separate support review.

## Proposed connection parameters (non-secret reference only)

- Mode: Session Pooler (IPv4), `5432`
- Host: `aws-1-ap-southeast-1.pooler.supabase.com`
- Database: `postgres`
- **Possible custom username convention to validate:** `lucky_game_server_login.llbkxnazkliskzcureec` — from published format, NOT a tested project login.
- Password: must remain unknown to GitHub/ChatGPT; Railway secret only *after* separate service/cost/deploy authorization.

## Authorization gates

- **Gate A:** approve new restricted LOGIN identity + sole role membership, and separately approve a secure password establishment method. Applying Migration 004 previously did **not** authorize any of this.
- **Gate B:** approve bounded live credential and RLS connectivity checks without creating real player/game data, after credentials exist.
- **Gate C:** approve Railway staging service and associated resource costs/deployment separately.
- **Gate D:** approve real OAuth/multiplayer staging acceptance separately.

No SQL, credentials, schema/role membership, Railway environment, Codespaces, tests or service changes performed during this planning stage. UI v12 remains unchanged. Project estimate 22%.

**NEXT SINGLE ACTION:** get scoped owner approval for Gate A, including an agreed safe path for credential creation without exposing it in tool calls or transcript.
