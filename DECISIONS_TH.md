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


## 2026-11-26 21:03 Asia/Bangkok — D13: Switch to real-game acceptance; stop proliferating mock checks
- **Owner directive (latest):** stop/remove the repetitive preflight/checklist *workstream* and focus on testing the **real game**, with a simple PASS when actual behavior meets acceptance; when FAIL, fix cause and rerun only the affected real scenario. Do not create another series of isolated mock/TLS/health/shutdown tests merely as incremental progress.
- **Interpretation:** drop **redundant test processes**, not critical runtime protections. Keep restricted database role, TLS/CA verification, RLS/auth checks, fail-closed startup, trustworthy health/status, WebSocket/room cleanup, and budget controls in place. Do not delete/disable these to obtain green tests.
- **Test priority:** one limited **end-to-end Staging multiplayer vertical slice** on the existing v12 interface: Supabase Google sign-in → authenticate server socket → Free 4 players in same real room → one server-authored roll and synchronized board/turn → disconnect/reconnect → finish a game/record outcome when supported. Use existing verified read-only Node pg, RLS rollback and offline evidence; do not rerun already passing suites without a regression cause.
- **Scope gate retained:** this is a strategy authorization, NOT blanket approval for new Railway service, paid deployment, persistent DB fixture writes, public exposure, real payments, Google-account automation, or large-scale load. Explicit owner cost ceiling, duration, test accounts/retention and staging deployment approval remain required before those mutations.
- **Stop rule:** report real PASS/FAIL against defined acceptance; never mark as passing if Google Auth, runtime, room synchronization or persistence is untested. Preserve UI v12 and single existing project architecture.
- **Next:** check actual Google OAuth/provider and real staging runtime blockers via available read-only connectors, prepare one concrete scoped end-to-end pilot proposal and seek one combined approval when deploy/spend is needed. Do not restart the previous mock-test escalation.

## 2026-11-27 (Asia/Bangkok) — D14: Standing approval สำหรับการพัฒนาและทดสอบ Lucky Game
1. ให้ Codex พัฒนา/แก้บั๊ก และรันเทสต์ที่จำเป็นใน Codex Cloud แบบแยกจากบริการจริง ไม่มีค่าใช้จ่ายเพิ่ม ผู้จัดการโครงการตรวจ diff และหลักฐานทุกครั้ง แก้และรันซ้ำเฉพาะส่วนที่กระทบ
2. อนุญาตทดสอบเกมกับ Railway Staging เดิมเฉพาะบัญชีทดสอบที่ได้รับอนุญาต ไม่ใช้บัญชีผู้เล่นจริง ไม่เปิดเงินจริง ไม่สร้างค่าใช้จ่ายเพิ่ม ไม่เปิด Codespaces หรือ CI ที่เสี่ยงมีค่าใช้จ่าย ถ้ายังไม่ครบ 4 Google identities ให้ใช้ mock Auth หรือ test fixtures **ในสภาพแวดล้อมแยกเท่านั้น** ไม่ลดความปลอดภัยระบบจริง และไม่ถือเป็นหลักฐาน Google OAuth จริง
3. อนุญาต Feature Branch, Commit และ Pull Request ตามความจำเป็น ทำงานถัดไปโดยไม่รออนุมัติซ้ำเมื่ออยู่ในขอบเขต หากติดเงื่อนไขให้ทำงานที่ไม่ติดก่อน บันทึกผลจริง, Commit SHA, ตัวค้างและงานถัดไปบน GitHub และใช้ scheduled checks ที่ระบบรองรับ
4. **ไม่อนุญาต Deploy ใหม่, Merge เข้า main หากอาจ trigger Auto-deploy, ค่าใช้จ่ายเพิ่ม หรือการแก้/ลบข้อมูล Production** ไม่เผย secrets ไม่เพิ่ม/เปิดช่องทางรับเงินจริง และไม่ถือว่าการทดสอบเป็นสิทธิ์สร้างบริการใหม่
5. คง UI v12 และเป้าหมายเดิมทั้งหมด V99 เป็นแหล่งอ้างอิงพฤติกรรมเท่านั้น ไม่ใช้ V99 UI แทน v12 ไม่เปิดใช้งาน Draft PR #1 บนบริการจริง
D14 แทนการพักเทสต์ใน D06 เฉพาะขอบเขตนี้; เงื่อนไขความปลอดภัยและการอนุมัติ deploy/ค่าใช้จ่ายตาม D07/D13 ยังอยู่ ไม่รับรองผลที่ยังไม่ทดสอบ
