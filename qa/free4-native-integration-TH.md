# Free4 native race harnessสำหรับ Integration Candidate

คัดตัวทดสอบจาก `d2757cbfa3902b9479835697f2e1d8928a353aaf` และ pin store ทั้งสองไฟล์ตาม Integration `12452556153f4b53c29e2c17076c3a58d8e04005`. SQL 001–005 ไม่เปลี่ยน. การเลือก Free4 ใน harness ยังคงเรียกเส้นทางปกติ ไม่เปิด VIP หรือ archive writer opt-in, ไม่เปลี่ยน scenarios เดิม.

`node qa/free4-native-postgres-race.cjs --verify-sources` ตรวจ 7 Git blobs อย่างเดียว ไม่โหลด `pg`, เริ่ม process, ตรวจ socket หรือแตะ database. ถ้า bytes ไม่ตรงจะหยุดก่อน database connection; ต้องทบทวน diff และ repin เฉพาะไฟล์ที่เกี่ยวข้อง.

`bash qa/free4-native-local.sh --run-disposable /absolute/pg17/bin` **ยังไม่ได้รัน**. รอเครื่องทดสอบแยกเดิมที่ไม่เพิ่มค่าใช้จ่ายและได้รับอนุญาต, PG17/psql/Node/pg และ private Unix socket ที่ใช้งานได้. ตัวรันสร้าง cluster ชั่วคราวของตัวเองเท่านั้น ไม่ใช้ TCP, Production, Codespaces หรือ CI. ผล 3 race ยังคง **0/3 RUN**, ไม่ใช่ acceptance.
