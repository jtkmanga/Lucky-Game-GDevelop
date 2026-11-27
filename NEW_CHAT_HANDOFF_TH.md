# Lucky Game — Start a New Chat Without Rework

**Use the complete ready-to-copy message below** whenever switching chats or Work sessions. The assistant has no persistent background worker here; each new chat must perform a new tool-backed session.

## New Chat Command (Thai)

> ดำเนินโครงการ **Lucky Game ใหม่** โดยใช้ GitHub Repository **`jtkmanga/Lucky-Game-GDevelop`**, branch **`main`** ต่อจากสถานะล่าสุดทันที อย่าสับสนกับ Repository เก่า `jtkmanga/Snakes-and-Ladders-Private` และ **ห้ามสร้างโปรเจกต์เกมใหม่หรือ Repository ใหม่** โดยไม่จำเป็น
>
> **ต้องอ่านไฟล์จาก GitHub ตามลำดับ:** `AGENTS.md` → `PROJECT_STATUS_TH.md` → `PROJECT_MASTER_PLAN_TH.md` → `DECISIONS_TH.md` → `NEW_CHAT_HANDOFF_TH.md`. หากงานที่จะทำเกี่ยวกับ Backend/QA ให้เปิดเอกสารเฉพาะส่วน `RAILWAY_STAGING_AUTH_INTEGRATION_TH.md`, `backend/INTEGRATION_STATUS.md`, `qa/STATUS_2026-11-25.md` และไฟล์โค้ดที่เกี่ยวข้องเท่านั้น อ่านหลักฐานเก่าพอจำเป็นและนำผลที่ผ่านแล้วกลับมาใช้ **ไม่ต้องเริ่มตรวจซ้ำทั้งโปรเจกต์**
>
> **สถาปัตยกรรมที่ตกลงแล้ว:** GitHub/Codespaces = เกม UI v12 + Admin + งานพัฒนา; Railway = Multiplayer Node.js WebSocket; Supabase = Google Login ผ่าน Supabase Auth และ PostgreSQL คะแนน/VIP/ห้อง/ข้อมูลผู้เล่น ไม่มี Firebase เป็นบริการล็อกอินหลัก ไม่สร้าง Railway Postgres ซ้ำ ไม่ใช้ Render/GDevelop เป็นเส้นทางเปิดเกมหลัก
>
> **ทรัพยากรปัจจุบัน:** ใช้ Railway Staging เดิมและ Supabase Auth/PostgreSQL เดิมเท่านั้นตาม checkpoint ที่ตรวจล่าสุด; ดู SHA/migrations/ผล OAuth ที่ยืนยันใน `PROJECT_STATUS_TH.md` บน `docs/lucky-autonomous-backlog` ไม่ใช้ข้อมูลทรัพยากรเก่าจาก main.
>
> **ข้อบังคับ:** รักษา UI v12 เหมือนเดิมทุกตำแหน่งและสี; กติกา Free 4 / VIP 2, ลูกเต๋าเซิร์ฟเวอร์ 1–6, 20 วินาทีไม่ทอยให้เอง, ชนะเมื่อถึงหรือเกิน 100 ได้ +10, Lucky Box 1 กล่อง, 5 แผนที่, Resume UID, Free reset วันอาทิตย์/VIP ทุกวันเที่ยงคืนไทย, Admin แยก, จ่าย VIP จริงเมื่อได้รับอนุมัติ
>
> **นโยบายปัจจุบัน D15:** ตัดสินใจและดำเนินงานเทคนิคเอง รวมเปิดเครื่องทดสอบและ Deploy/ทดสอบซ้ำใน Staging ภายในงบเดิม; ไม่ต้องขออนุมัติรายขั้นตอน ไม่สร้าง Scheduled Task ไม่ Touch Production ไม่เปิดสาธารณะ ไม่รับเงินจริง ไม่เปิดเผย secrets.
>
> **เริ่มจากงานค้างอันดับแรก** ที่ `PROJECT_STATUS_TH.md` บน `docs/lucky-autonomous-backlog`; ใช้ feature/Integration branch ตามความเสี่ยง ตรวจ diff/CI/ผลจริง และบันทึก SHA, งาน, เวลา, โควต้า, ค่าใช้จ่าย และ P0–P6 กลับ GitHub.
>
> ให้ทำงานที่ไม่ติดก่อนและขอความช่วยเหลือจากเจ้าของเฉพาะยืนยันตัวตน เพิ่มสิทธิ์ เพิ่มงบ หรือการกระทำนอกขอบเขต. ไม่ให้เจ้าของเล่นเทสต์แทน.

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
