# Lucky Game — Start a New Chat Without Rework

**Use the complete ready-to-copy message below** whenever switching chats or Work sessions. The assistant has no persistent background worker here; each new chat must perform a new tool-backed session.

## New Chat Command (Thai)

> ดำเนินโครงการ **Lucky Game ใหม่** โดยใช้ GitHub Repository **`jtkmanga/Lucky-Game-GDevelop`**, branch **`main`** ต่อจากสถานะล่าสุดทันที อย่าสับสนกับ Repository เก่า `jtkmanga/Snakes-and-Ladders-Private` และ **ห้ามสร้างโปรเจกต์เกมใหม่หรือ Repository ใหม่** โดยไม่จำเป็น
>
> **ต้องอ่านไฟล์จาก GitHub ตามลำดับ:** `AGENTS.md` → `PROJECT_STATUS_TH.md` → `PROJECT_MASTER_PLAN_TH.md` → `DECISIONS_TH.md` → `NEW_CHAT_HANDOFF_TH.md`. หากงานที่จะทำเกี่ยวกับ Backend/QA ให้เปิดเอกสารเฉพาะส่วน `RAILWAY_STAGING_AUTH_INTEGRATION_TH.md`, `backend/INTEGRATION_STATUS.md`, `qa/STATUS_2026-11-25.md` และไฟล์โค้ดที่เกี่ยวข้องเท่านั้น อ่านหลักฐานเก่าพอจำเป็นและนำผลที่ผ่านแล้วกลับมาใช้ **ไม่ต้องเริ่มตรวจซ้ำทั้งโปรเจกต์**
>
> **สถาปัตยกรรมที่ตกลงแล้ว:** GitHub/Codespaces = เกม UI v12 + Admin + งานพัฒนา; Railway = Multiplayer Node.js WebSocket; Supabase = Google Login ผ่าน Supabase Auth และ PostgreSQL คะแนน/VIP/ห้อง/ข้อมูลผู้เล่น ไม่มี Firebase เป็นบริการล็อกอินหลัก ไม่สร้าง Railway Postgres ซ้ำ ไม่ใช้ Render/GDevelop เป็นเส้นทางเปิดเกมหลัก
>
> **ทรัพยากรที่มีแล้ว:** Railway private project `Lucky-Game-GDevelop` ID `5d695e45-30fe-4b08-b0d0-0b0d250937eb`, environment `staging` ID `e0202327-924e-4913-9a3b-6c4493b2c31b` (**ยังไม่มี service/deploy**); Supabase project `Lucky-Game` ID `llbkxnazkliskzcureec`, Singapore `ap-southeast-1` (**ACTIVE_HEALTHY แต่ยังไม่ตั้งค่า Google OAuth/schema สำหรับเกม**). GitHub Repository เดิมมีไฟล์ ZIP, ร่าง Firebase/D1 และร่าง Railway/Postgres ซึ่งยังต้องแปลงเป็น Supabase Auth/PostgreSQL จริง
>
> **ข้อบังคับ:** รักษา UI v12 เหมือนเดิมทุกตำแหน่งและสี; กติกา Free 4 / VIP 2, ลูกเต๋าเซิร์ฟเวอร์ 1–6, 20 วินาทีไม่ทอยให้เอง, ชนะเมื่อถึงหรือเกิน 100 ได้ +10, Lucky Box 1 กล่อง, 5 แผนที่, Resume UID, Free reset วันอาทิตย์/VIP ทุกวันเที่ยงคืนไทย, Admin แยก, จ่าย VIP จริงเมื่อได้รับอนุมัติ
>
> **Standing approval D14:** เทสต์ที่จำเป็นใน Codex Cloud แบบแยกและเทสต์เกมบน Railway Staging เดิมด้วยบัญชีทดสอบที่อนุญาตเท่านั้น โดยไม่มีค่าใช้จ่ายเพิ่ม ไม่ใช้ผู้เล่นจริงหรือเงินจริง ขาดบัญชี Google ให้ใช้ mock/fixtures เฉพาะในระบบแยก ห้าม Deploy ใหม่ ห้าม Merge เข้า main ที่อาจ Deploy อัตโนมัติ ห้ามแก้/ลบข้อมูล Production และห้ามเผย secrets
>
> **เริ่มจากงานค้างอันดับแรก** ใน checkpoint ล่าสุดของ `PROJECT_STATUS_TH.md` และ `PROJECT_AUTONOMOUS_BACKLOG_TH.md` บนสาขาเอกสาร หากยังไม่ได้รวมเข้า main ให้อ่านทั้งสองชุด ใช้ Codex ทำงานใน feature branch ตรวจ diff/ผลเทสต์ และบันทึกหลักฐานกับ SHA จริงกลับ GitHub โดยไม่ Deploy
>
> ให้ดำเนินงานภายในสิทธิ์เชื่อมต่อ GitHub/Railway/Supabase ที่มีอยู่โดยอัตโนมัติให้มากที่สุด ลดการถามซ้ำ และอย่าสร้างขั้นตอนใหม่ที่ไม่จำเป็น ไม่ต้องขอให้ผมทดสอบด้วยตัวเอง หากต้องใช้การยืนยันบัญชีจริง/ค่าใช้จ่าย/Deploy/การชำระเงินจริงให้หยุดเฉพาะจุดนั้นแล้วทำงานที่ไม่ติดเงื่อนไขต่อทันที

## How to use
Copy the message above to a **new chat**. No need to paste all prior chat messages, screenshots or ZIP contents as the linked GitHub repository holds the project files and authoritative instructions.

## Session-end checkpoint schema (required)
```text
DATE (Asia/Bangkok):
REPO / BRANCH:
LAST SOURCE COMMIT(S):
DONE (code only / deployed / actually verified — distinguish):
NOT RUN (tests, deployments):
SERVICE CHANGES (Railway, Supabase):
COST / CREDIT DELTA (if measured; else unknown):
BLOCKERS / APPROVAL GATES:
NEXT SINGLE ACTION:
FILES UPDATED: PROJECT_STATUS_TH.md [and DECISIONS_TH.md if changed]
```

## New chat assistant behavior
- The user requests continuity without repeated questioning. Start with actual GitHub document reads and a focused work task; do not start with general questions.
- You may read connector current state, but never infer credentials persist unless plugin access actually works in that session.
- Never promise work continues after a chat ends; the handoff works because the next session explicitly reads the files.
