# Lucky Game v12: สาขารวมสำหรับตรวจสอบเท่านั้น

ใช้สาขานี้เพื่อทบทวน source และทดสอบออฟไลน์ ไม่ใช่คำอนุมัติให้ deploy, merge main, apply schema หรือเปิดรับชำระเงิน ดูแหล่งที่มาและ blob ของไฟล์ที่นำมารวมใน `INTEGRATION_V12_CANDIDATE.json` ฐานเป็น candidate Free4/VIP ที่คงค่าเริ่มต้นเดิมและยังไม่ได้เปิด atomic VIP

| ส่วน | สิ่งที่ทดสอบได้ตอนนี้ | สิ่งที่ยังไม่เปิดหรือยังไม่พิสูจน์ |
|---|---|---|
| VIP2 | Controller/store ใช้ client เดียวตรวจ gate และ INSERT; ปฏิเสธไม่เขียน, ผล COMMIT ไม่ชัดไม่ประกาศหรือสร้างห้องซ้ำ | ปิดโดยค่าเริ่มต้น; ยังไม่ apply gate, ทดสอบ revoke/INSERT พร้อมกันหรือ recovery ข้าม process |
| สิทธิ์ไอเทม | ตัวอ่าน PostgreSQL ใช้ DB clock เดียว คืนผลครบแยกจาก VIP; บัญชีอ่านอย่างเดียว | ยังไม่ต่อเข้าห้องและไม่มี issuer จริง; ต้องยืนยันหมดสิทธิ์กลางเกม/การคืนสิทธิ์ก่อนเปิด |
| อันดับ | ทดลองปิดรอบก่อนหน้าของ Free/VIP ด้วยช่วงกรุงเทพฯ และเวลาเริ่มธุรกรรมเดิม, replay ไม่เขียนทับ | ไม่เรียกจาก endpoint/scheduler; ต้องพิสูจน์ผู้เขียนทุกทางและสิทธิ์ที่ไม่ให้แก้ย้อนหลัง; ทั้งหมดยัง provisional |
| Admin | ตรวจผู้สั่งจาก Auth แยกจากสิทธิ์ operator และผูก receipt กับคนสั่ง; role/audit proposal แยก | ยังไม่ต่อแหล่งสิทธิ์ operator และ DB receipt ที่เก็บ actor จริง ไม่เปิดหน้า/route ใหม่ |
| Sandbox | คำสั่งซื้อและผลจากผู้ให้บริการจำลองใน process เดียว, ลงบัญชีจำลองกันซ้ำและคืนเงินเต็มจำนวน | ไม่เชื่อมผู้ให้บริการ ไม่รับเงินจริง ไม่ให้สิทธิ์จริง และไม่พิสูจน์ความทนหลัง restart |

ตรวจเฉพาะเคสใหม่และความเข้ากันของสาขารวม:

```sh
node --test --test-name-pattern='^atomic VIP creation' qa/free4-pilot-admission.test.cjs
node --test qa/pg-item-entitlements.test.cjs qa/admin-room-count-grant-command.test.cjs qa/archive-previous-candidate.test.cjs qa/payment-sandbox/local-settlement.test.cjs
python3 tools/prepare_railway_secure.py
```

แพ็กเกจในเครื่องใช้เพื่อตรวจ UI v12 เดิม SHA-256 `2f3e23aeb338c202a198b54aca4f7b30006ad2472aebc0a6aad47c9daeedef97` ไม่ใช่ artifact สำหรับ deploy ตัวตรวจร่วม `qa/cross-track-lab/run-latest.py` ใช้ชุด source ที่ pin แยกและให้ผลจาก fixture เท่านั้น
