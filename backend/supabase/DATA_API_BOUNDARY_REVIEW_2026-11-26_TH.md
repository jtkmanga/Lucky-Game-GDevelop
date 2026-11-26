# Lucky Game — Supabase P1 verified schema & Data API boundary

**Snapshot:** 2026-11-26 Asia/Bangkok  
**Project:** `Lucky-Game` / `llbkxnazkliskzcureec`  
**Repository:** `jtkmanga/Lucky-Game-GDevelop` / `main`

## What is verified (read-only connector evidence)

- Supabase project status: `ACTIVE_HEALTHY`; region `ap-southeast-1`.
- Migration history contains exactly the three expected game migrations:
  - `20261126121717` — `lucky_001_game_private_schema`
  - `20261126121728` — `lucky_002_room_lease_draft`
  - `20261126121739` — `lucky_003_turn_receipts_draft`
- `game` tables: `players`, `vip_entitlements`, `rooms`, `score_events`, `leaderboard_archives`, `orders`, `admin_audit`, `turn_receipts` (8 total, all RLS enabled and zero rows at inspection).
- `game` schema owner is `postgres`, ACL `{postgres=UC/postgres}`; `anon` and `authenticated` have neither `USAGE` nor `CREATE` on the schema.
- Every one of the eight `game` tables has only `postgres=arwdDxtm/postgres` in its reported table ACL, **zero RLS policies**, and `has_table_privilege(..., 'SELECT')=false` for both `anon` and `authenticated`.
- Inspection used connector `get_project`, `list_tables`, `list_migrations` and **SELECT-only** SQL queries. No SQL mutation.

## Open boundary: exposed schemas / Data API settings

**NOT VERIFIED:** Supabase dashboard's current **Data API → Exposed schemas** setting. Database grants and RLS findings are meaningful independent protection, **but do not prove** the `game` schema is excluded from PostgREST's exposed list.

Read-only confirmation (no settings changes yet):
1. Open [Supabase project Data API settings](https://supabase.com/dashboard/project/llbkxnazkliskzcureec/integrations/data_api/settings) in the authenticated owner Dashboard.
2. Inspect **Exposed schemas** and verify `game` is **absent**. Capture an unredacted schema list only if it contains no credentials; never send service-role keys, secret values, connection strings or user data in screenshots.
3. If `game` is listed, **stop** and separately authorize a safe settings correction before wiring any Railway DB credentials or deploying.
4. The absence of a Postgres `pgrst.db_schemas` setting in SQL is not proof of a dashboard setting. Never infer exclusion from SQL role catalogs alone.

Supabase documentation: https://supabase.com/docs/guides/api/securing-your-api — Data API grants and RLS are separate controls. Do not enable the Data API or grant client access as a workaround.

## Railway connection plan — preparation only

- Preferred architecture: Railway Node.js WebSocket service holds a server-only PostgreSQL connection; browser uses only Supabase publishable key for Auth. **No browser database credentials.**
- Do not create a second Railway PostgreSQL, production service, role, or connection at this step.
- Before any service config: verify appropriate least-privilege server database role / RLS strategy with owner-approved scoped SQL changes and review. Current `postgres`-owned schema is not an authorization to paste a privileged database URL into Railway or client code.
- Check Google OAuth provider separately: its callback/origin allowlist remains unverified.
- Authored server code and previously passed mocked WebSocket tests do not prove real PostgreSQL transactions, Google login or production safety.
- Never alter existing UI v12 or enable random maps while these gates remain open.

## Verification and execution boundaries

- **PASS:** existing migration history, eight-table catalog/RLS, table/schema access gates for `anon` and `authenticated`.
- **NOT VERIFIED:** Data API exposed schemas, effective dedicated server role, actual Railway-to-Postgres session, live OAuth and staged multiplayer.
- **NOT RUN:** new Node/browser/load/real-DB tests.
- **NOT CHANGED:** schema, Auth settings, Railway configuration, UI v12, deployment, resource or billing plans.
- Cost delta: not measured; no new billed resource created by this read-only review.

**NEXT SINGLE ACTION:** read the project's Data API **Exposed schemas** setting from its authenticated dashboard and confirm `game` is absent. After that, prepare a separately approved scoped server-role / Railway connection plan without posting secrets.


## 2026-11-26 19:28 Asia/Bangkok — Owner Dashboard visual confirmation

- Owner-provided screenshot of authenticated Supabase `Lucky-Game` → Integrations → Data API → Settings → **Exposed schemas** dropdown explicitly shows **two of three schemas exposed**: `graphql_public` (checked), `public` (checked), and **`game` (unchecked)**.
- Dashboard also shows **0 of 8 tables exposed**. This is a visual current-settings confirmation; no settings were changed and no Save action was requested.
- **Data API schema-exclusion gate: VERIFIED (owner screenshot)**. Together with independent read-only SQL grant/RLS checks recorded above, `game` is excluded from the displayed Data API exposure list. This does not prove future changes cannot alter this configuration.
- Dashboard's **Automatically expose new tables** toggle appears enabled. No change authorized in this review; avoid creating tables in exposed schemas and review this setting separately before any future public table migrations.
- **Still blocked:** dedicated least-privilege PostgreSQL runtime role, Railway DB connection credentials, actual service integration, Google OAuth provider and real staging acceptance. No deployment, migration, Auth/role mutation, tests or new spending in this checkpoint.
- **NEXT SINGLE ACTION:** prepare and review a source-only least-privilege database runtime-role / Railway connection contract, with no secrets, DDL execution or Deploy.
