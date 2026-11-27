# P3 sandbox: ตรวจว่ารอบคะแนนยังเปิด

`proposal.sql` เป็นส่วนประกอบทดลองของ `createArchiveWriterCandidate` ที่ยังไม่เปิดใช้ ไม่ใช่ migration สำหรับ Railway หรือ Supabase. ตั้งชื่อฐานทดสอบแยก, guard และใช้ native PostgreSQL แบบ single-user เท่านั้น.

- ตรวจ Free/VIP แยกตามช่วง Bangkok ที่คำนวณจาก `transaction_timestamp()` เวลาเดียวกับ DEFAULT now() ของคะแนนเดิม ไม่เปลี่ยนคะแนนหรือช่วง reset. ตรวจ login ที่กำหนดและ shared advisory lock ของ backend บน key รอบนั้น; ผู้เรียกยังต้องใช้ direct session และล็อกก่อน BEGIN ตามสัญญา.
- Owner ของ SECURITY DEFINER ไม่ใช่เจ้าของตาราง, NOLOGIN/NOBYPASSRLS; เห็นเพียง mode/เวลา ไม่เห็น snapshot หรือข้อมูลผู้เล่น และไม่มีสิทธิ์เขียน. ถ้า RLS ไม่ active, policy ยืนยันขอบเขตหาย/ถูกแก้, หรือมี restrictive SELECT/ALL policy ให้ปฏิเสธแทนสรุปว่าไม่มี archive. ทุก overlap กับ archive ของโหมดเดียวกันปิดทางเขียน แม้ขอบเดิมคลาดเคลื่อน.
- รัน `python3 qa/award-period-open/verify.py /absolute/pg17/bin /absolute/schema-dir` โดย schema-dir มีไฟล์ฐาน 001–005 ที่ pin ในสคริปต์. Harness สร้างฐานใหม่ใน temp โดยใช้ `initdb` และ `postgres --single`; ไม่เปิด socket ไม่เชื่อมบริการจริง. บน PG17.12 ผ่าน 13 กรณี (ขอบ/lock/identity/privileges/RLS, archive/overlap และแยก Free/VIP).
- ยังไม่พิสูจน์ shared/exclusive lock contention, concurrent policy changes, การตัดผู้เขียนรุ่นเดิมหรือ archive ที่แก้ไม่ได้ในระบบจริง. ผลย้อนหลังยัง provisional. ไม่ติดตั้ง predicate หรือเปิด opt-in ในแอป.
