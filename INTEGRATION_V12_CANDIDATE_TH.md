# Lucky Game v12: สาขารวมสำหรับตรวจสอบเท่านั้น

ใช้สาขานี้เพื่อทบทวน source และทดสอบออฟไลน์ ไม่ใช่คำอนุมัติให้ deploy, merge main, apply schema หรือเปิดรับชำระเงิน ดูแหล่งที่มาและ blob ของไฟล์ที่นำมารวมใน `INTEGRATION_V12_CANDIDATE.json` ฐานเป็น candidate Free4/VIP ที่คงค่าเริ่มต้นเดิมและยังไม่ได้เปิด atomic VIP

| ส่วน | สิ่งที่ทดสอบได้ตอนนี้ | สิ่งที่ยังไม่เปิดหรือยังไม่พิสูจน์ |
|---|---|---|
| VIP2 | Controller/store ใช้ client เดียวตรวจ gate และ INSERT; ปฏิเสธไม่เขียน, ผล COMMIT ไม่ชัดไม่ประกาศหรือสร้างห้องซ้ำ | ปิดโดยค่าเริ่มต้น; ยังไม่ apply gate, ทดสอบ revoke/INSERT พร้อมกันหรือ recovery ข้าม process |
| สิทธิ์ไอเทม | ตัวอ่าน PostgreSQL ใช้ DB clock เดียว คืนผลครบแยกจาก VIP; บัญชีอ่านอย่างเดียว | ยังไม่ต่อเข้าห้องและไม่มี issuer จริง; ต้องยืนยันหมดสิทธิ์กลางเกม/การคืนสิทธิ์ก่อนเปิด |
| อันดับ | ทดลองปิดรอบก่อนหน้าของ Free/VIP ด้วยช่วงกรุงเทพฯ และเวลาเริ่มธุรกรรมเดิม, replay ไม่เขียนทับ | ไม่เรียกจาก endpoint/scheduler; ต้องพิสูจน์ผู้เขียนทุกทางและสิทธิ์ที่ไม่ให้แก้ย้อนหลัง; ทั้งหมดยัง provisional |
| Admin | ตรวจผู้สั่งจาก Auth แยกจากสิทธิ์ operator และผูก receipt กับคนสั่ง; role/audit proposal แยก | Node adapter และ SQL proposal ต่อกันในซอร์สที่ยังไม่ได้เปิดใช้; ตรวจ binding แยก และยังต้องพิสูจน์ TLS, pool และ auth จริงก่อน mount route |
| Sandbox | คำสั่งซื้อและผลจากผู้ให้บริการจำลองใน process เดียว, ลงบัญชีจำลองกันซ้ำและคืนเงินเต็มจำนวน | ไม่เชื่อมผู้ให้บริการ ไม่รับเงินจริง ไม่ให้สิทธิ์จริง และไม่พิสูจน์ความทนหลัง restart |

ตรวจเฉพาะเคสใหม่และความเข้ากันของสาขารวม:

```sh
node --test --test-name-pattern='^atomic VIP creation' qa/free4-pilot-admission.test.cjs
node --test qa/pg-item-entitlements.test.cjs qa/admin-room-count-grant-command.test.cjs qa/pg-room-count-grant.test.cjs qa/archive-previous-candidate.test.cjs qa/payment-sandbox/local-settlement.test.cjs
python3 tools/prepare_railway_secure.py
```

แพ็กเกจในเครื่องใช้เพื่อตรวจ UI v12 เดิม SHA-256 `2f3e23aeb338c202a198b54aca4f7b30006ad2472aebc0a6aad47c9daeedef97` ไม่ใช่ artifact สำหรับ deploy ตัวตรวจร่วม `qa/cross-track-lab/run-latest.py` ใช้ชุด source ที่ pin แยกและให้ผลจาก fixture เท่านั้น

### ทดสอบคืนเงินและสิทธิ์ไอเทมจากหลายคำสั่งซื้อ (จำลอง)

`node --test qa/payment-sandbox/refund-item-origins.test.cjs` ตรวจว่าการคืนเงินจำลองตัดเฉพาะสิทธิ์จากคำสั่งซื้อนั้น ไม่ตัดสิทธิ์ที่ยังใช้ได้จากคำสั่งอื่น ช่องว่างระหว่างช่วงสิทธิ์ต้องไม่ให้ไอเทม และ cold resume ไม่เติมโล่ที่ใช้ไปแล้ว ใช้ settlement และตัวอ่าน Node จริงกับ provider และ pool จำลอง **ไม่ได้รัน SQL หรือแก้ schema** และไม่ถือว่าอนุมัติซ้อนสิทธิ์ ต่ออายุ หรือคืนเงินจริง

ก่อนออกแบบ writer จริงต้องคงที่มาของแต่ละ grant และรวม Boolean จากสิทธิ์ที่ active จริง ณ เวลาที่อ่าน ห้ามรวมช่วงแยกกันเป็นช่วงเดียวตั้งแต่เวลาเริ่มเร็วที่สุดถึงหมดอายุช้าที่สุด. Receipt, สถานะคำสั่งซื้อ และการเปลี่ยน grant ควรอยู่ในธุรกรรมเดียวกันเมื่อพัฒนา DB จริง.

### เก็บคำสั่งซื้อ/สิทธิ์แยกตามต้นทาง (SQLite ใน QA เท่านั้น)

ดู `qa/payment-sandbox/DURABLE_LEDGER_TH.md` และรันเทสต์เฉพาะชุด sandbox. มีไฟล์ SQLite ชั่วคราวและธุรกรรมจริงในเครื่องทดสอบ แต่ไม่ใช่ PostgreSQL หรือระบบรับเงิน และไม่มีส่วนใดถูก mount เข้ากับเกมหรือเปลี่ยน UI v12.

### Admin reader และ candidate ป้องกันคะแนนผิดรอบ

Admin reader ตรวจสิทธิ์ EXECUTE ของทั้ง login และ effective role บนทุก overload ของ `game.set_room_count_grant` ตรวจด้วย SQL จาก entry point จริงใน PostgreSQL single-user แบบสังเคราะห์เท่านั้น. ดู `qa/award-period-fence-TH.md` สำหรับ Free/VIP writer ที่แยก opt-in และยังไม่เปิดใช้งาน; การรอ PostgreSQL หลาย session และ predicate ที่เห็น snapshot ครบยังไม่เปลี่ยนสถานะ.

ส่วน SQL predicate ที่ตัว writer รออยู่มีตัวทดลองเฉพาะ `qa/award-period-open/` แล้ว: native PG17 single-user 13 กรณี โดยไม่ติดตั้งกับ runtime. ยังไม่ใช่หลักฐาน archive ถาวรหรือการทำงานหลาย session.
