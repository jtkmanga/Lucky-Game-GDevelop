# Lucky Game — Backlog การพัฒนาต่อเนื่อง
ฐาน: `main` `20a0a76a1bebcf63e41e23a0b081d7848672aaf4`; หลักฐานการตรวจ V99 เฉพาะจุด `4669ae14b482c3aad7f3dd08e151985c118cd313`. ใช้กับ [Master plan](PROJECT_MASTER_PLAN_TH.md), [สถานะ](PROJECT_STATUS_TH.md) และ [D14](DECISIONS_TH.md) ไม่ใช่การแทนแผนเดิม

| ID | งานและหลักฐานก่อนปิด | สถานะ |
|---|---|---|
| P0 | ยึด ZIP/HTML v12 และ source เดิม; คงชุด 7/7 เป็นหลักฐาน historical guest-only ไม่รันซ้ำ | เก็บหลักฐานแล้ว |
| P1a | ตรวจ auth config และ redirect ของ Supabase/Staging ปัจจุบันโดยไม่อ่าน secrets; ยืนยัน Google account → UID → WebSocket จาก test account | มีหลักฐาน sign-in จากเจ้าของ แต่ไม่ใช่ E2E |
| P1b | เทียบ migration 001–005 กับ private game schema, RLS และ least-privilege runtime; ทบทวน rollback และ fail-closed โดยไม่ apply เพิ่ม | ติดตั้งแล้ว 001–005; acceptance ยังต้องตรวจ |
| P2a | ทดสอบ Free 4/VIP 2, entitlement, dice 1–6, 20s SKIP, overshoot, Lucky Box หนึ่งครั้ง และคะแนน +10 ตามปกติ; แยก fixture จากระบบจริง | ต้องการหลักฐานระดับห้อง |
| P2b | ตรวจ maps 1–5, ความสอดคล้อง client/server, path และ map เดิมหลัง reconnect; ใช้ v12 เท่านั้น ไม่รวม V99 UI | มี code/หลักฐานบางชั้น; acceptance ยังไม่ผ่าน |
| P2c | ตรวจ lease/revision, ความสอดคล้อง roll → receipt → score และ retry ไม่สร้างผลซ้ำ; ห้าม broadcast ผลก่อน durable commit | source มีแล้วบางส่วน; เกณฑ์ negative/retry ยังต้องยืนยัน |
| P2d | เตรียม V99 shield/win ×2 ฝั่ง server แบบปิดโดยค่าเริ่มต้น; verified UID entitlement ถูก freeze ตอนเข้าคู่; shield หนึ่งครั้งต่อห้อง, ×2 ใช้เฉพาะคะแนนชนะ; ไม่เปลี่ยน v12 หรือเปิดจ่ายเงิน | งานถัดไป; ไม่เพิ่ม entitlement ในระบบจริง |
| P3a | Resume ด้วย verified UID หลังหลุดและหลัง restart, เช็ก deadline/ownership และรางวัลไม่ซ้ำ | ห้องจริงยังไม่ยืนยัน |
| P3b | ทำ leaderboard แยกโหมดและ atomic Bangkok rollover, Free อาทิตย์ 00:00 และ VIP ทุกวัน 00:00; archive/catch-up และ late awards | ค้างการต่อ Supabase/หลักฐาน |
| P3c | Admin แยก, server-side authorization, audit; online/rooms/accounts/scores, VIP grants และราคา | ค้าง implementation/verification ตาม guardrails |
| P3d | คัด provider, signed sandbox status/webhook, idempotent grant, refund และ audit; ไม่รับเงินจริงก่อนอนุมัติ | ตัวเลือกและ source-only ต่อได้; เงินจริง blocked |
| P4a | รัน targeted isolated fixtures ก่อนเมื่อไม่ครบ 4 Google identities; ยืนยันว่าไม่มี mock ใน build/service จริง | อนุญาต D14; ยังต้องเก็บผล |
| P4b | Existing staging 1 vertical slice: Google → socket → Free4 → roll sync → reconnect → finish/score; จำกัดบัญชี test เท่านั้น และไม่มีค่าใช้จ่ายเพิ่ม | รอแหล่งบัญชี test ที่ได้รับอนุญาตครบ; ไม่ถือว่า fixture ผ่าน staging |
| P4c | Acceptance v12 มือถือ/เดสก์ท็อปและ VIP2, resets, Admin, payment sandbox; แยก deployment SHA กับ source SHA และเก็บผลจริง | ค้าง; การ Deploy ใหม่ต้องอนุมัติแยก |
| P5 | แผน 100→1K→5K→10K, throughput/latency/DB/egress, soak และ cost cap, backups/rollback/alerts; ไม่มี load จริงเกินขอบเขต | งานออกแบบทำได้; capacity/cost gate ยังไม่ผ่าน |
| P6 | Audit privacy/security, operational readiness และ rollout/rollback; เกณฑ์ release-ready จากหลักฐานก่อนเสนอ go/no-go | ห้ามเปิด Production โดยไม่ได้รับอนุมัติ |

**วิธีเดินงาน:** ให้ Codex ทำ change ขนาดเล็กบนฐาน `main`, review diff, รันเฉพาะเทสต์ที่เกี่ยวข้องที่อนุญาต, บันทึก SHA และขอบเขต evidence. ใช้ branch/PR ที่ไม่กระตุ้น Deploy หรือค่าใช้จ่าย. สถานะเงินจริงและ live E2E ต้องนับแยกจาก isolated tests. ถ้าติด gate ให้เดินงานอื่นที่ปลอดภัยก่อน
