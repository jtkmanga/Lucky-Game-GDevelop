# Lucky Game — Railway ↔ Supabase server-only runtime role contract (proposal)

**2026-11-26 | SOURCE REVIEW ONLY | NOT AN APPLIED MIGRATION**

## Confirmed starting point

- Supabase project `llbkxnazkliskzcureec` has migrations 001–003 installed, eight `game` tables with RLS enabled and zero client policies.
- Owner's Dashboard screenshot confirms `game` is **unchecked** in Data API exposed schemas; `graphql_public` and `public` are checked.
- SQL catalog confirms `anon` and `authenticated` do not have schema USAGE/CREATE or game table SELECT. Never modify these grants to make the game work.

## Required runtime access from actual selected Node source

| Table | Server operations observed | Notes |
|---|---|---|
| `game.players` | SELECT, INSERT, UPDATE | `player(uid,name)`, leaderboard joins |
| `game.vip_entitlements` | SELECT | Verify entitlement before VIP queue |
| `game.rooms` | SELECT, INSERT, UPDATE | Owned room insert, lease claim/heartbeat, revision-fenced transitions, restart lookup |
| `game.score_events` | SELECT, INSERT | Award ledger and leaderboard; no routine update/delete |
| `game.turn_receipts` | SELECT, INSERT | Immutable turn receipts; no update/delete |
| `game.orders`, `game.admin_audit`, `game.leaderboard_archives` | None in current selected realtime server path | **Do not grant yet**; separate Admin/payment/reset role later |

These operations are source-observed, not a verified deployed privilege trace. Re-review against the exact service source commit before applying permissions.

## Safe migration design (requires separately scoped owner approval)

1. Create a dedicated **non-superuser, non-CREATEDB, non-CREATEROLE, non-BYPASSRLS** LOGIN role for the Railway server only; generate its password in a secure provider control plane. Never place secrets in GitHub, chat, or a screenshot.
2. Grant only `USAGE` on the private `game` schema and the listed per-table operations; exclude `orders`, `admin_audit` and `leaderboard_archives` until their specific workflows are implemented.
3. Because all game tables have RLS enabled with zero policies, grants alone will not allow the ordinary server role to access rows. Prepare explicit **role-scoped** RLS policies allowing the trusted server role only the operations needed above. Policies must not target `anon`, `authenticated`, or `PUBLIC`; do not use BYPASSRLS or SECURITY DEFINER as a shortcut.
4. Audit PostgreSQL object ownership, role inheritance, default privileges, and the actual server connection identity. Keep Data API `game` exclusion unchanged. A dedicated role still needs careful credential security and server-authorized business checks.
5. Apply grants/policies only in a reviewed migration after cost/scope approval, then verify with that effective role under an approved staging test. Revoke or rotate credentials if leaked; audit rollback/forward-fix plans.
6. Provision Railway **only after separate deployment approval** and verified costs. Put `DATABASE_URL` in Railway secret variables; browser should receive only Supabase URL and publishable key, never PG credentials.

## Current gates

**Verified:** Data API schema exclusion (owner screenshot), SQL migration history, eight-table RLS and client-role privilege denial.

**Not configured/tested:** runtime role, role-specific RLS, Railway PG secret, actual DB session, Google OAuth, payment/Admin credentials, real game persistence or staging.

**NEXT SINGLE ACTION:** review and approve precise SQL role/grant/RLS migration proposal before any mutation; preserve UI v12 and existing Railway/Supabase projects.
