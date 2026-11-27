# ตัวทดลองเก็บผลรอบย้อนหลัง

ฐานซอร์ส `1273c138efd0b988589d1abbbb3c917e5826701f` บน feature/lucky-previous-leaderboard

| อินพุต | Git blob |
|---|---|
| LEADERBOARD_ARCHIVE_DECISION_TH.md | a7c0c7edfe0e8a50aeef807280ba00b3ab6a1215 |
| backend/storage/score-periods.cjs | 3c305490864150a2184ab3d46a3b41fea7792796 |
| qa/leaderboard-period-key-check.py | 029cea2528a7758be0ff9fd0c2f178605e9c1e04 |
| backend/railway/v12-leaderboard-rows.cjs | 5154aaa260f9a77e9ebf769023c7346ecbf04888 |
| backend/supabase/game-store.cjs | 17d983eac7d52c866721f907412ce4f19d7fdd00 |
| backend/supabase/001_game_private_schema.sql | b7439dfb87b1ed4d90d0d9d2a63a5749ee5070f6 |
| backend/railway/historical-leaderboard.cjs | db30c3ee7cfe07239371c14052924a878f1b26f7 |

สั่ง `node --test qa/archive-previous-candidate.test.cjs` จากรากซอร์สที่มีไฟล์ตัวทดลอง ตัวทดสอบใช้ scripted client และตรวจลำดับคำสั่งกับพารามิเตอร์

ฟังก์ชันภายในรับ pool ที่ bootstrap เชื่อถือและโหมดเท่านั้น DB คำนวณขอบรอบก่อนหน้ากับเลขวันกรุงเทพฯ จากเวลาที่อ่านครั้งเดียว แล้วเทียบกับ helper เดิม ใช้ exclusive session lock ของรอบเก่า หากคีย์ไม่ว่างให้พักการปิดรอบ เมื่อได้ล็อกแล้วจึง BEGIN ตรวจรอบอีกครั้ง และอ่าน ledger จาก snapshot ใหม่ใน statement ถัดไป รวมคะแนนตาม created_at เดิมของรายการ เก็บ 50 อันดับในรูปแถว v12 ที่ไม่มี UID หากพบแถว archive เดิมต้องตรวจ end และ snapshot ตรงกันก่อนจบ เมื่อ COMMIT คลุมเครือหรือ DB ไม่ได้ยืนยันด้วย tag COMMITให้ตามอ่านหลักฐานรอบที่ระบุใน error จาก session ใหม่ ทุกทางออกทิ้ง physical client

การใช้จริงยังต้องยืนยัน namespace ของล็อก เวลาฐานข้อมูล session affinity และ pool เฉพาะที่จำกัดเวลา checkout/statement และคืน client ด้วยการตัด connection จริง ต้องพิสูจน์ว่า backends เดิมถูกระบาย ทุก writer รวมงานซ่อมและ backfill เคารพ shared lock ก่อน BEGIN และตรวจรอบหลัง BEGIN ตลอดจนตรวจสิทธิ์และ RLS ให้เห็นคะแนนครบ และกันการแก้ไข/ลบ archive และ ledger ย้อนหลัง ตัวต้นแบบทำเฉพาะ INSERT หรืออ่านเทียบผลเดิม ผู้ถือสิทธิ์นอกต้นแบบยังเปลี่ยนข้อมูลได้ การทดสอบหลาย session พร้อม writer เก่า/ใหม่และ acknowledgement หายยังค้างอยู่ คงผลย้อนหลัง provisional และสิทธิ์เดิมทุกกรณี
