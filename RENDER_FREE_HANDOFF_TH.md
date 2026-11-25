# Lucky Game — Render Free preparation (TH)

สถานะ: **พร้อมให้ผู้ใช้เชื่อม GitHub กับ Render เพื่อสร้าง Preview เท่านั้น**; ยังไม่มี Render Service / Deploy / การทดสอบ / ค่าใช้จ่ายใหม่

## ไฟล์ที่เพิ่ม
- `render.yaml`: Render Blueprint แผน `free`, Node.js, `autoDeployTrigger: off` และ health check `/health`
- `tools/prepare_render_web.py`: ขณะ Build แตก `Lucky_Game_Multiplayer_Test_v1.zip` (มี UI v12, server.js, rules.js, package.json) เข้า `render-web/` โดยไม่แก้ UI ภาพ/สี/ตำแหน่ง
- `.gitignore`: ป้องกันอัปโหลดไฟล์ build และ .env โดยไม่ตั้งใจ

## การทำงานเมื่อ Render ถูกสร้างในอนาคต
Render จะใช้ `python3 tools/prepare_render_web.py && cd render-web && npm install --omit=dev --no-audit --no-fund` เป็น Build Command และ `node render-web/server.js` เป็น Start Command โดยอ่าน `PORT` จาก Render อัตโนมัติ

**ค่าเริ่มต้น: WebSocket guest/VIP ถูกปิด** (`ENABLE_INSECURE_GUEST_WS=false`) เพราะต้นแบบ ZIP เดิมไม่มี Google Login, สิทธิ์ VIP หรือระบบคะแนนถาวรที่เชื่อมแล้ว หน้า HTML v12 สามารถถูกเสิร์ฟเป็น Preview แต่ยังไม่มี Multiplayer จริงจากชุด Backend ใหม่ ห้ามเปลี่ยน flag เป็น true ในบริการที่สาธารณะ; จะเปิดโหมดทดสอบ guest แบบไม่มีสิทธิ์ตรวจสอบและไม่ปลอดภัย

## วิธีเชื่อม Render ภายหลัง (ยังไม่ให้ทำตอนนี้)
1. ไปที่ [Render Dashboard](https://dashboard.render.com) → New → Blueprint เลือก Repository `jtkmanga/Lucky-Game-GDevelop`
2. ตรวจไฟล์ `render.yaml` ว่า Service `lucky-game-gdevelop-preview` มี Plan **Free** และ Auto Deploy **Off** ไม่เลือก Paid และไม่สร้าง Database
3. **หยุดก่อนกดยืนยันสร้างบริการ/Deploy** หากยังไม่อนุมัติการ Deploy และการใช้โควต้า Render

การ Commit ลง GitHub เพียงอย่างเดียวไม่ได้สร้างบริการ Render อัตโนมัติ ถ้าจะเชื่อมและ Deploy ในอนาคตให้ตรวจการอนุมัติและความพร้อมของระบบอีกครั้ง

## ข้อจำกัด Render Free (ข้อมูลปัจจุบันอ้างอิงเอกสารผู้ให้บริการ)
- หลังไม่มี inbound HTTP/WebSocket เป็นเวลา 15 นาที บริการอาจพักและเริ่มใหม่เมื่อมีคำขอ
- ข้อมูลในหน่วยความจำหายเมื่อ Restart / Spin Down; ดิสก์ชั่วคราวไม่ใช่ฐานข้อมูลถาวร
- มีโควต้า Free instance hours / build minutes / bandwidth; หากเกินโควต้าบางประเภท อาจมีการคิดเงินหรือต้องอัปเกรดตามบัญชี
- **ไม่รับประกัน 24/7 หรือ 10,000 ผู้เล่นพร้อมกัน**; แผน Free ไม่รองรับ scale มากกว่า 1 instance
- ยังไม่เชื่อม `backend/auth`, `backend/storage`, `backend/online` เข้ากับเซิร์ฟเวอร์จาก ZIP

เอกสารอ้างอิง:
- https://render.com/docs/free
- https://render.com/docs/blueprint-spec
- https://render.com/docs/web-services

## งานที่เหลือก่อนเปิดเกมให้ผู้เล่นจริง
- เปลี่ยน WebSocket เข้าห้องแบบ guest เป็น Firebase ID token verification + verified UID + VIP entitlement, ไม่ใช้ token resume อย่างเดียว
- เลือกฐานข้อมูลถาวรที่ได้รับอนุมัติ เชื่อมการบันทึกเกม คะแนน รีเซ็ต และคิวรางวัล + การกู้คืน
- ตรวจระบบและค่าใช้จ่าย ก่อนขออนุมัติ Deploy ใด ๆ
- UI ต้องคง v12 เดิม / แยกจากโครงการเก่า / ห้ามเผยแพร่ Secret ลง Public Repo

## คำสั่งทดสอบ
ผู้ใช้ **สั่งข้ามการทดสอบทั้งหมด** ดังนั้นรอบนี้ไม่ได้รันคำสั่ง ทดสอบ Build หรือ Health Check และไม่ยืนยัน Runtime ว่าทำงานผ่านแล้ว
