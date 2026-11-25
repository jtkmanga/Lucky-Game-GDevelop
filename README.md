# Lucky Game — Multiplayer (current project)

> **AI / ChatGPT / Work:** Read [AGENTS.md](AGENTS.md) first, then [PROJECT_STATUS_TH.md](PROJECT_STATUS_TH.md). This is a separate project from the old `Snakes-and-Ladders-Private` game.

## เริ่มต้นต่อจากแชตเดิม / Resume from last session
- **[AGENTS.md](AGENTS.md)** — กฎบังคับสำหรับ AI ก่อนลงมือ
- **[PROJECT_STATUS_TH.md](PROJECT_STATUS_TH.md)** — สถานะจริงล่าสุด, หลักฐาน, Blocker, งานถัดไปที่ต้องทำ (ตัวอ้างอิงหลัก)
- **[PROJECT_MASTER_PLAN_TH.md](PROJECT_MASTER_PLAN_TH.md)** — แผน P0–P6 จนเปิดเกมและทดสอบ 10,000 CCU
- **[DECISIONS_TH.md](DECISIONS_TH.md)** — สิ่งที่เจ้าของโปรเจกต์ตัดสินใจไว้
- **[NEW_CHAT_HANDOFF_TH.md](NEW_CHAT_HANDOFF_TH.md)** — คำสั่งคัดลอกไปแชตใหม่ เพื่อทำต่อทันที
- [RAILWAY_STAGING_AUTH_INTEGRATION_TH.md](RAILWAY_STAGING_AUTH_INTEGRATION_TH.md) — รายละเอียด Staging/Backend และการย้าย Firebase→Supabase ที่ยังค้าง
- [qa/STATUS_2026-11-25.md](qa/STATUS_2026-11-25.md) — หลักฐานการทดสอบเก่า; **ห้ามอ้างว่าโค้ดใหม่ผ่านการทดสอบแล้ว**

## Current platform decision
GitHub/Codespaces (source + future tests) → Railway (Node.js + authoritative WebSocket) ↔ Supabase (Google Auth + PostgreSQL). Keep the existing Lucky Game HTML v12 visual UI. The game server, Google provider, permanent storage, admin and payments are **not yet wired together or deployed**.

## Safe status
- Supabase project `Lucky-Game`, ref `llbkxnazkliskzcureec` in Singapore — created, ACTIVE_HEALTHY; project creation quoted $0/month.
- Railway private project `Lucky-Game-GDevelop` with `staging` environment — created **empty**; no services or deployments.
- No tests or load tests run since the owner's test pause; no production deployment.
- Public repository may be accessible to others: never commit API tokens, OAuth secrets, database credentials or user data.

**Do not create a duplicate repository, platform project or new UI.** Follow [PROJECT_STATUS_TH.md](PROJECT_STATUS_TH.md) for the next source-only task.
