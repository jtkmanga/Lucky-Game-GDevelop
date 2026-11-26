# Lucky Game — ย้าย UI ต้นฉบับ V99 ไป Railway + Supabase (WIP)

**สถานะ: UI EXTRACTED + RAILWAY BROWSER ADAPTER IMPLEMENTED (STATIC CHECK PASS) / LIVE TEST OPEN / NOT DEPLOYED**

## เป้าหมายและที่มา
- อ้างอิง UI จริงจาก `jtkmanga/Snakes-and-Ladders-Private` → `static.js` → `/index.html` และ `/style.css` (แหล่งข้อมูลเดิมเป็น Private V99 mirror; URL ที่เจ้าของระบุ: `snakes-and-ladders-staging.jtkmanga.workers.dev/?v=security-sprint-1106b`)
- ใช้ต้นฉบับเป็น **รูปแบบ UI/ประสบการณ์เล่น** เท่านั้น **ไม่ใช้ Cloudflare ใน Runtime ใหม่**
- จัดวางหน้า Welcome, Google Login, Lobby, Board, Avatar, Shop ด้วย HTML/CSS เดิม ปรับ Free Server จาก 3 เป็น **4 คน/ห้อง**; VIP คง 2
- ไม่สร้างค่าใช้จ่ายหรือ Service ใหม่; คง Railway Staging + Supabase เดิม; **ไม่เปิดการชำระเงินจริง**

## งานที่ทำบน Branch นี้
1. `migration/legacy-ui/index.html`: นำ HTML ที่ใช้จริงจาก `static.js` มาใช้เป็นฐาน; เปลี่ยนป้าย Free 3 → 4; เอาป้าย STAGING, ปุ่มเล่นกับบอท, คำว่า คะแนนทดลอง และหน้าจ่ายเงินจริงทดสอบออก; ปุ่ม VIP ไม่สามารถซื้อได้
2. `migration/legacy-ui/style.css`: คัดรูปแบบ CSS จาก UI ต้นฉบับตามจริงโดยยังไม่แต่งใหม่
3. `migration/legacy-ui/railway-app.js`: สร้าง browser adapter ใหม่ ใช้ Supabase Google OAuth, ชื่อผูก Google UID, Free 4 คน, WebSocket Railway /ws, waiting/state/roll, render กระดานและผู้เล่น โดยไม่เรียก Cloudflare/Firebase
4. `qa/legacy-ui-free4-source.test.cjs`: ชุดตรวจความสอดคล้อง Source ฝั่ง UI / Railway rule; ตรวจแบบ static ใน connector ผ่าน (รวม JS parser) แต่ **ยังไม่ได้รัน Node/Codespaces จริง**
4. Backend ใหม่ที่มีอยู่แล้ว `backend/railway/secure-server.cjs` และ `backend/railway/rules.js` ใช้ Free=4 และ VIP=2 อยู่แล้ว จึงไม่ต้องแก้ซ้ำ

## จุดที่ยังเปิด (ห้ามประกาศว่าเกมพร้อมออนไลน์)
- HTML/CSS เหล่านี้เป็น **UI source/reference**; ไฟล์ `game.js` เก่ามี Firebase ID token, Cloudflare endpoints, payment flows, demo bots จึง **ไม่นำมาใช้กับ Railway**
- มี adapter รุ่นแรกสำหรับ `/api/supabase-config`, Supabase Google OAuth, `wss://<Railway-domain>/ws`, `join/waiting/state/roll` และกลับ Lobby แล้ว แต่ **ยังไม่ทดสอบ browser จริง**; reconnect ปัจจุบันเป็นกดใหม่ด้วย Google UID (ยังไม่ใช่อัตโนมัติ)
- ต้องเทียบ state/render ของบอร์ด: กติกา `backend/railway/rules.js` ปัจจุบันต่างจาก V99 (หลายแผนที่/ไอเทม/ระบบคะแนน); ห้ามอ้างว่าประสบการณ์เล่นเท่าต้นฉบับก่อนตรวจ mapping จริง
- ตรวจการแสดงผลทั้งมือถือ/เดสก์ท็อปและตรวจว่าไม่มีปุ่มทดลองที่เปิดได้, Google login/ชื่อผู้เล่นตรงกัน
- ทดสอบจริง Free 4 คน บัญชี Google แยกกัน/ซิงก์เกมจนจบ/รีคอนเน็กต์ และการใช้เครดิต Railway Trial ก่อน Merge/Deploy

## ข้อห้าม
- ห้าม Deploy Cloudflare; ไม่เพิ่ม Cloudflare binding/Workers
- ห้ามแก้หน้าเกมเดิมบน Workers
- ห้าม Merge หรือนำ UI นี้ขึ้น Railway Staging จนกว่าจะเชื่อมครบและตรวจหน้าเกมไม่หลอกผู้เล่นว่าระบบทำงาน
- ไม่เปิด VIP/PromptPay หรือระบบซื้อจริงโดยไม่มีคำสั่งใหม่

**ขั้นตอนถัดไป:** รัน QA ใน Codespaces และทดสอบ browser staging แบบจำกัดความเสี่ยงก่อน Merge/Deploy; แก้ความแตกต่างเรื่องกติกา/5 maps/ไอเทมให้เท่าต้นฉบับ และทดสอบ Google 4 บัญชี


## One-command Codespaces 4 workstreams (27 พ.ย. 2569)
```bash
cd /workspaces/Lucky-Game-GDevelop && git fetch origin feature/legacy-ui-railway-free4 && git switch feature/legacy-ui-railway-free4 && git pull --ff-only origin feature/legacy-ui-railway-free4 && bash scripts/lucky_4in1_codespaces.sh
```
- Script runs source tests, syntax, exact 5-map authoritative board and Lucky Box/timeout contracts, local Railway runtime generation, optional existing Chromium Playwright smoke on localhost, and writes UTC report/log in `qa/reports/legacy-migration/`. It only stages generated report files (not secrets or other changes) if working tree is clean and pushes that report to GitHub. No public server, external DB writes, Cloudflare calls or Deploy.
- Real 4 distinct Google accounts, 4/4 online play, reconnect after real socket loss, end-game scores **cannot be declared PASS** by a Codespaces mock or without browser sessions and a deployed migration build; report BLOCKED until independently verified.
- Original V99 UI source has 5 map layouts; branch `backend/railway/board-definitions.json` now matches V99 snakes/ladders/map names exactly. `multi-board-rules.cjs` uses canonical board mapping for map1–5 and `secure-server.cjs` selects random 1–5 at new room creation **on this branch only**. Existing rooms and live Staging main remain unchanged.
- **Original items NOT complete**: win ×2 and snake-shield entitlement gameplay/parity remain open; do not remove this blocker just because Lucky Box tests pass.
- The generated runtime is local and uses existing `tools/prepare_railway_secure.py`, then overlays this new original UI and browser JS. Do not run its start command or deploy as part of this script.
