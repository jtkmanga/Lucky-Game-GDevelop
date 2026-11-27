# ทดลองจำกัดสิทธิ์เขียนและอ่าน archive

อ้างอิง checkpoint `da44c03` และ integration `3f60d72` ตามที่รับมอบหมาย โดยปรับตัวตรวจให้ตรงกับตัวปิดรอบล่าสุดที่ `64e1c53` ใช้ซอร์สในเครื่อง ตรวจ Git blob ก่อนเริ่ม โดย verify.py ระบุค่าเต็มของ schema 001–005, period predicate, ตัวเก็บอันดับ และตัวแปลงผลทั้งสองไฟล์ ตัวเก็บอันดับคือ `d30f9a6b5660291ee5504140882fcf666855dc47` และ predicate คือ `fc1f2bbf4882b35f777bf04e43a86b8f93a3ca23`

ใช้ Python 3, Node, GNU stdbuf และ PostgreSQL 17 ที่ติดตั้งอยู่แล้ว จากโฟลเดอร์ที่รวมซอร์สอ้างอิงให้เรียก

```sh
python3 qa/archive-append/verify.py "$PG17_BIN" "$SCHEMA_DIR" "$PREDICATE_SQL" "$RAILWAY_DIR"
```

ตัวรันสร้าง cluster ใน temporary directory และส่งคำสั่งผ่าน stdin ของ postgres --single เรียก archivePreviousCandidate() จริงด้วยตัวแปลง query สำหรับ fixture และใช้ session ใหม่ทุกครั้ง ตัวแปลงนี้รองรับเฉพาะรูปแบบข้อมูลที่ชุดทดสอบใช้ สถานะ I/T/I มาจาก test shim หลัง SQL สำเร็จ ไม่ใช่สถานะ pg driver จริง การยืนยันผลอาศัยทั้งแถวที่อ่านกลับ และการตรวจ SQL ERROR จาก backend

**สิทธิ์** Writer เป็น NOLOGIN ไม่มีสมาชิก และใช้ได้เฉพาะคอลัมน์ที่ aggregate กับการ INSERT/SELECT archive ต้องถือ exclusive lock ที่ตรงกับโหมดและรอบกรุงเทพฯ ก่อน INSERT ข้อมูลจาก writer ถือเป็นข้อมูลเชื่อถือได้ ผู้มีสิทธิ์ writer สามารถสร้าง snapshot ปลอมของรอบที่อนุญาตหากควบคุม session ได้ จึงต้องรักษาขอบเขตการให้สมาชิกแยกจากบทบาทเกม Reader อ่านประวัติทุกโหมดได้เฉพาะสี่คอลัมน์ของ archive จึงเป็นบทบาทภายในสำหรับเซิร์ฟเวอร์ ผู้เรียกยังต้องผ่านการตรวจสิทธิ์ Free/VIP และนโยบายการเปิดเผยผลอีกชั้น บทบาท predicate เดิมเห็นเฉพาะหัวรอบ

**ก่อน cutover** ข้อเสนอนี้รับเฉพาะ archive ว่างใน QA จริง ในฐานที่มีประวัติต้องแยก migration สำหรับตรวจ bounds, ช่วงซ้อน, รูปแบบ snapshot, จำนวนและ checksum เดิม ก่อนมอบสิทธิ์ใด ๆ ตรวจ owner, memberships, RLS, physical session และวิธีกั้น writer/backfill ทุกราย แล้วพักและระบายงานเขียนขณะเปลี่ยนนโยบาย รักษาแถวเดิมและหลักฐานการสำรองที่ตรวจคืนได้ เปิด role/predicate และการเรียก archive เป็นการอนุมัติคนละส่วน ผลย้อนหลังยังเป็น provisional

**การย้อนและกู้คืน** หากต้องหยุดให้หยุด caller และถอนการเข้าถึงเฉพาะ role เก็บ archive และกลไกป้องกันการแก้ไขไว้ เจ้าของตารางและ superuser ยังเปลี่ยน DDL หรือถอด trigger ได้ การป้องกันนี้ครอบคลุม DML ปกติ รวมถึง TRUNCATE การกู้ประวัติต้องเป็นงานที่อนุมัติแยก กู้ backup ไปฐานแยกก่อนติดตั้ง guard สำหรับ INSERT แล้วตรวจ key, snapshot, archived_at และ checksum กับต้นฉบับ เปิด trigger/RLS และทวน ACL ก่อนสลับฐาน ห้ามใช้ writer ย้อนใส่ช่วงเก่าหรือแก้ snapshot ที่เผยแพร่แล้ว

ไม่มีการให้สมาชิก role, credential, migration บนฐานเชื่อมต่อ, การเปลี่ยนกติกาคะแนน/เวลา หรือการเปิดอ่านผลถาวรในชุดทดสอบนี้
