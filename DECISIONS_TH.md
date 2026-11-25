# Lucky Game — Owner Decisions and Change Log

## Current approved decisions (2026-11-25)
| ID | Decision | Meaning for implementation |
|---|---|---|
| D01 | Use current repo `jtkmanga/Lucky-Game-GDevelop`, branch `main` | No new repository needed now. Old repo separate. |
| D02 | Freeze visual UI at HTML playable v12 | Technical wiring only; do not redesign frontend. |
| D03 | GitHub/Codespaces + Railway + Supabase | Minimize tools; Railway handles Node.js WebSocket host, Supabase handles Auth and PostgreSQL; Google remains OAuth provider. |
| D04 | Supabase Auth instead of Firebase | Replace previously drafted Firebase-only gateway and browser client. Current code still Firebase-based; migration not finished. |
| D05 | Supabase PostgreSQL as the single game database | Do not provision duplicate Railway PostgreSQL. No schema installed as of checkpoint. |
| D06 | No tests now | Owner explicitly paused game unit/smoke/bot/load/browser/manual tests; can author tests only. Restart only with explicit approval. |
| D07 | No spending or Deploy without explicit scoped approval | Empty Railway staging and Supabase $0 project created; no running services. |
| D08 | Multiplayer Free=4 / VIP=2; server-authored dice | 20s SKIP; win on >=100, +10 points; 1 Lucky Box; eventual 5 distinct random maps. |
| D09 | Free reset Sunday 00:00 / VIP daily 00:00 Asia/Bangkok | Keep auditable history and no double-awards. |
| D10 | Prefer fully automated tests from Codespaces once owner unpauses tests | Last-mile real Google OAuth/payment and Railway capacity still need proof. |
| D11 | Admin is a distinct secured web interface | Server side admin authorization; account/score/VIP/reset/online/users/pricing. |
| D12 | Test 100→1,000→5,000→10,000 CCU with step gates, staging only | 10K for 24h×30d is research target, not proven capacity; charge approval before high resource use. |

## Known limitations and competing historic artifacts
- `render.yaml` and GDevelop import packages are alternatives/archives, **not** the selected live hosting path. Do not enable them or start a parallel migration.
- `backend/auth/firebase-id-token.cjs`, `backend/storage/d1-*.cjs` and `backend/railway/secure-server.cjs` are legacy/draft modules. **Not** a working Supabase login.
- User selected Supabase organization `jtkmanga@gmail.com's Org` and approved a new **$0/month** `Lucky-Game` project in Singapore; confirmed created. No permission was given to enable paid services.
- Prior WebSocket synthetic client and Rules tests are source-only authoring after test pause; do not report a pass rate on them.
- If any later owner decision overrides an earlier item, append dated change here, update master plan and status and maintain a single active architecture; do not silently switch architecture.
