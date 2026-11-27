# Sandbox: เก็บคำสั่งซื้อและสิทธิ์ไอเทมแยกตามต้นทาง

รัน `node --test qa/payment-sandbox/{local-settlement,refund-item-origins,durable-settlement}.test.cjs` จากราก repo ด้วย Node 24 ที่มี `node:sqlite` (ตรวจบน 24.22.3 / Linux) สร้าง SQLite แบบ private ในไดเรกทอรีชั่วคราวของผู้รัน และลบทิ้งหลังทดสอบ ไม่มี network, HTTP endpoint, payment provider, credential จริง หรือ migration ของเกม

- คำสั่งซื้อสังเคราะห์มี provider reference ไม่ซ้ำและตรวจยอด/สกุลเงิน/สินค้า/UID เทียบกับ provider fixture ฝั่งเซิร์ฟเวอร์ก่อนเขียน ใช้ HMAC จำลองในหน่วยความจำ ไม่บันทึก secret หรือ raw payload ลงไฟล์ ไม่ใช่ลายเซ็นของ provider จริง
- คำสั่งซื้อ สิทธิ์ตาม order ID และ event receipt/audit ถูกเขียนในธุรกรรมเดียวกัน; เมื่อเขียนสิทธิ์หรือคืนเงินล้ม ทั้ง receipt และสถานะคำสั่งซื้อ rollback; re-delivery ใช้ event ID เดิม ผลซ้ำไม่แก้ประวัติหรือยืดช่วงสิทธิ์
- การคืนเงินเต็มจำนวนตัดเฉพาะต้นทางนั้นและเก็บร่องรอย issue/refund ไว้ คืนก่อนชำระถือเป็น terminal ใน lab; ไม่จำลอง partial refund, VIP หรือ lifecycle ของ provider จริง
- ตัวอ่านคืน Boolean ต่อไอเทมจากอย่างน้อยหนึ่ง origin ที่ active ในช่วงครึ่งเปิด `[starts,expires)` ด้วยเวลาเดียว ไม่ปิดช่องว่างต่างช่วงหรือสะสมจำนวนโล่; 24 ชั่วโมงเป็นค่า fixture ไม่ใช่อนุมัตินโยบายขายหรือซ้อนสิทธิ์จริง
- รันด้วย fixture/provider ที่เชื่อถือได้และไฟล์ทดสอบที่ผู้รันเป็นเจ้าของเท่านั้น SQLite ACL/trigger ไม่ใช่สิทธิ์ระดับผู้ใช้ของ PostgreSQL และไม่ป้องกันผู้ที่ควบคุมไฟล์/แก้ schema ได้ ไม่ mount เข้ากับ gameplay, Admin, Railway หรือ Supabase
- ถัดไป: กำหนด issuer/นโยบาย revoke และออกแบบ PostgreSQL ใน sandbox แยกให้เทียบ invariants เดิม พร้อม RLS, order lock, event uniqueness, durable reconciliation และ privileged-role/หลาย session tests ก่อนพิจารณาเปิดใช้งาน
