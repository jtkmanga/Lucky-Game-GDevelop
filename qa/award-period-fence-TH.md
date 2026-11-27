# P3 writer candidate

ฐานสถานะ `529ffe29eb52f97f2efe6cec0c71e6143005071c` ฐานแพตช์ `3123f38e208d7978f61ce6213822b0ae4dfeed65`

| ไฟล์ฐาน | Git blob |
|---|---|
| backend/supabase/room-lease-store.cjs | 780cca5ebbe1a7e8863f605e62e7edbb16b22a56 |
| backend/railway/archive-previous-candidate.cjs | 869ea24ca1e1707917ecc019db37bc20d3c17fd7 |
| backend/storage/score-periods.cjs | 3c305490864150a2184ab3d46a3b41fea7792796 |

เรียก `node --test qa/award-period-fence.test.cjs` จากรากต้นทาง ตัวทดสอบเรียก `createArchiveWriterCandidate(pool).commitFencedTurn(turn)` โดยใช้ไดรเวอร์จำลอง

ผู้เขียนจับคู่ namespace ของตัวปิดรอบและวันที่เริ่มรอบจากเวลาฐานข้อมูล ขอ shared session lock ก่อน BEGIN แล้วตรวจคีย์จาก transaction_timestamp() ซ้ำ หากข้ามรอบจะทิ้ง connection ก่อนเขียนห้อง คะแนน หรือ receipt ตัวทดลองหยุดตานั้นโดยไม่ทอยใหม่ การเล่นตาที่เริ่มในรอบเดิมและยังถือล็อกอยู่ยังใช้ DEFAULT now() ของ ledger ตามเดิม การเปรียบเทียบ mode กับแถวห้องและ fence ของ lease/revision ยังอยู่ใน transaction เดียวกัน

ต้องใช้ direct session แยกที่สะอาดและจำกัดเวลา ตรวจ transaction status ของ driver ก่อนล็อก หลัง BEGIN และหลัง COMMIT ฟังก์ชัน `game.award_period_is_open(text,bigint,bigint)` เป็นสัญญาที่เสนอ ฐานต้องตรวจได้ว่าช่วง canonical นี้เปิดจริงด้วยสิทธิ์ที่เห็น archive ครบ รวมทั้งปฏิเสธเมื่อพบหลักฐานขัดกัน การค้นหาแถวด้วยบทบาทที่ RLS ซ่อนได้อาจให้ผลเปิดผิด ชุดนี้ไม่มี migration หรือ grant เมื่อ predicate หายหรือไม่ยืนยัน true ผู้เขียนหยุดก่อน UPDATE ห้อง การ throw หลัง COMMIT เริ่มแล้วให้ตรวจหลักฐานตามรหัสห้อง/ตาเดิม

constructor เกมเดิมยังใช้เส้นทางเดิม ตัวทดลองยังไม่ได้ mount หรือรวมในแพ็กเกจรันจริง ก่อนเชื่อมต้องตรวจสิทธิ์ การยุติ physical session การครอบคลุมทุก writer/backfill การระบายผู้เขียนรุ่นเดิม และลำดับ writer/closer หลาย session ตัวอ่านย้อนหลังยัง provisional
