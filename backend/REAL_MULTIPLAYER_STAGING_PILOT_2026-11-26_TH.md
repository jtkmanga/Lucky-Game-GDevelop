# Lucky Game — Real staging multiplayer pilot gate (2026-11-26)
**Decision D13: test real play, not a new sequence of mocks. PLAN ONLY — NOT DEPLOYED**

## Verified read-only state
- Railway project `Lucky-Game-GDevelop`, environment `staging`: connector reports **0 services**, **0 volumes**, **0 buckets**, **0 shared variables**, and **no staged patch**. Therefore no Railway application URL or running server to test.
- Supabase project `Lucky-Game` (`llbkxnazkliskzcureec`, Singapore): connector reports **ACTIVE_HEALTHY**. Migration history shows `lucky_001_game_private_schema`, `lucky_002_room_lease_draft`, `lucky_003_turn_receipts_draft`, `lucky_004_railway_runtime_access`, `lucky_005_restricted_login_no_password`. These entries alone do not prove all user-facing features or Google OAuth.
- Existing owner-run Node pg restricted TLS/Auth **PASS** from Codespaces, prior RLS rollback and offline health/startup/shutdown checks retained as limited historical evidence.
- Owner Railway workspace screenshot at 20:28 on 2026-11-26: Trial `Credits Available $5.00`, `Current Usage $0.00`; not real-time usage or an approval to consume it.
- GitHub source `backend/auth/supabase-access-token.cjs` validates Supabase Auth user via `/auth/v1/user`; `tools/prepare_railway_secure.py` injects client-side Supabase Google OAuth into original UI v12. **Source integration exists; live Google login remains unverified.**
- Connected Supabase toolset does **not expose a hosted-project Auth provider configuration getter**. Real Google Provider enabled/client ID/secret and allowed redirect URLs are therefore **UNKNOWN**, not PASS; earlier user screenshot did not prove completed configuration.
- The README-style `RAILWAY_STAGING_AUTH_INTEGRATION_TH.md` and `backend/INTEGRATION_STATUS.md` contain older Firebase/unmigrated claims from 2026-11-25: use current tested source and current connector state over those outdated snapshots.

## Single real-play vertical slice once authorized
1. Owner approves **one staging Railway service**, one replica only, no extra PostgreSQL/storage. Define Trial credit spend ceiling and shutdown duration first. Review whether platform offers enforceable budget limit; if not use a limited manually monitored pilot rather than claiming an automatic $ cap.
2. Verify Google Provider is actually enabled in Supabase and Google OAuth callback to `https://llbkxnazkliskzcureec.supabase.co/auth/v1/callback`, plus browser app's return URL after its Railway domain exists. Never publish client secret.
3. Configure Railway service privately: restricted `DATABASE_URL` only, `SUPABASE_URL`, publishable key, bundled public CA path; ensure server startup health and source-generated web v12 are deployed from selected reviewed SHA. No guest bypass or payment/VIP enable.
4. Run one real staging scenario: authenticated Google sessions → 4 genuine users in one Free room → server-authoritative dice/turn/same map across all → reconnect one user → verified persisted outcome if game implementation supports it. Mark scenario PASS only with observed session evidence, else FAIL/OPEN and fix only that specific blocker.
5. Record service/deployment ID, tested SHA, sanitized response evidence, DB relevant state, beginning/ending credit and service shutdown/cleanup; do not re-run older mocks by default.

## Explicit gates / limits
- This file **does not grant** permission to create Railway services, deploy a public host, spend Trial credit, change Google Cloud credentials or send real Google sessions through new infrastructure.
- Opening real game server may mutate Supabase room leases, turns and ledgers; the owner must authorize such staging writes in the same controlled pilot.
- Prior 10K/24h is separate and far beyond one Trial service; do not infer production or load readiness from pilot PASS.
- No real-money payments; UI v12 locked. Treat protected token config / database role verification and spending shutoff as runtime guards, not another mock-test ladder.
- IMPORTANT: before deployment source preflight must check `secure-server.cjs` shutdown path for races and `railway.json` build/runtime compatibility, but do not expand into another suite of source-only mock tests.

**NEXT SINGLE ACTION:** confirm actual Google OAuth provider and allowed redirect URLs using appropriate read-only dashboard/connector capability, then seek a **single combined staging pilot approval** (credit maximum, max duration, one service, auth+DB writes, auto/owner shutdown) before provisioning.
