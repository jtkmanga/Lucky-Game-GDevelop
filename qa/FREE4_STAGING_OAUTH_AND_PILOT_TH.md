# Free4 Staging: เช็ก Google ก่อนเริ่มนับเวลาทดสอบ
 
**แผนเท่านั้น • ยังไม่ได้ล็อกอินแทนผู้ทดสอบ, เข้าคิว, เปลี่ยนตัวแปรหรือ Deploy**
 
- Railway connector ยืนยันเมื่อ 27 พ.ย. 2026: service เดิม `lucky-game-staging` (project `5d695e45-30fe-4b08-b0d0-0b0d250937eb`, staging `e0202327-924e-4913-9a3b-6c4493b2c31b`, service `b78b5c66-746f-4d4d-b6e0-263e9b180da0`) ยังอยู่ที่ `56e41aa8b6d70fc024e59d97bcad47de6a558f88` deployment `ec4df7e7-10fe-4b7c-89e5-be984c0b141a` SUCCESS และ metadata `canRollback=true`; อ่านซ้ำก่อน action จริง. Integration เป้าหมายสำหรับ review `f17b732178d06cd5bdd23d006af5933be1cada32`, ไม่ใช่ build ที่อยู่บน Staging. Free4 local 3/3 และ VIP2 local 2/2 ผ่านแล้ว ไม่ต้องรันซ้ำ.
 
## A. OAuth อย่างเดียว ใน Staging เดิม
 
เมื่อเจ้าของยืนยันผู้ทดสอบ Google 4 บัญชีสำหรับเกมโดยเฉพาะ ให้เปิด root ของ Staging เดิม `https://lucky-game-staging-staging.up.railway.app/` แยก browser profile/session ต่อคน. ให้แต่ละคนทำ consent เอง กดเฉพาะ **เข้าสู่ระบบด้วย Google** ซึ่งใน build เดิมกลับสู่ path เดิมและตรวจด้วย Supabase getUser. ตรวจว่ากลับมาที่ origin/path ถูกต้อง บัญชีถูกต้อง และสถานะยืนยันหลังโหลดใหม่. **ห้ามกดจับคู่หรือเปิด WebSocket เกมเก่า**. การรายงานเก็บแค่ Tester A–D และ pass/blocked; UID ที่ยืนยันจาก server/Auth ให้ map แบบ private สำหรับ allowlist เท่านั้น ไม่ใช้ email, access token, cookie, screenshot ที่มีข้อมูลส่วนตัวลง GitHub. บัญชี console owner ไม่ใช่ tester โดยอัตโนมัติ. ไม่มีการ Deploy หรือแก้ redirects ในขั้นนี้; หาก callback ไม่ตรงให้หยุดและแยกขออนุมัติการแก้.
 
## B. ขออนุมัติจากเจ้าของครั้งเดียว ก่อน timed pilot
 
กรอกเฉพาะเมื่อ A ผ่าน 4/4: exact reviewed SHA, service/environment เดิมเท่านั้น, 1 replica / ไม่มี service หรือ DB ใหม่, fresh fixed room UUID, 4 verified UIDs (private), ระยะเวลาเป้าหมายเสนอไม่เกิน 30 นาทีหลัง A ผ่านและเวลาตัดจริงเป็น UTC `LUCKY_FREE4_PILOT_CUTOFF_MS`, permissions สำหรับ staging writes ของห้องสังเคราะห์เท่านั้น, งบ Railway แยกและวิธีตรวจต้น/ปลาย, prior deployment ID และเงื่อนไข rollback ด้านล่าง. การแก้ variables อาจเริ่ม deployment; ไม่ตั้งหรือเปิด flag ก่อนอนุมัติ. $5 Codespaces ไม่ใช่วงเงิน Railway. ห้าม merge `main`, แตะ Production, เพิ่มทรัพยากร, เปิด Admin/VIP/payment, หรือรับเงินจริง.
 
## C. Acceptance / rollback ถ้าได้รับอนุมัติ
 
ยืนยัน deployment target, fixed pilot, SHA และ cutoff; ตรวจหนึ่งห้อง Free 4 คน, ลูกเต๋า authoritative หนึ่งครั้งและ revision เดียวกัน, ตัดการเชื่อมต่อแล้วกลับที่นั่งเดิม และบันทึกผล/receipt จากข้อมูลทดสอบโดยไม่ลง identifiers. เลือก **finish** หรือ **unfinished cutoff** เป็น scenario ต่อ fixed room; ห้องที่ finished ไม่สร้างซ้ำ. ถ้าต้องการทั้งสอง scenario ให้ใช้แผน/room ที่อนุมัติแยก. ก่อนปิด pilot/rollback ไป build เก่า ให้ยืนยันจากฐานข้อมูลว่า exact pilot row **absent, closed หรือ finished**. ถ้า row เป็น playing หรืออ่านกลับไม่ได้ ให้หยุดเปลี่ยนแปลงและแจ้งเจ้าของ ไม่ rollback แบบเดา: Railway ย้อน image และตัวแปร แต่ไม่ย้อน Supabase row. หลัง rollback ที่ได้รับอนุมัติให้ตรวจ deployment/health และบันทึกหลักฐานกับค่าใช้จ่ายจริง.
