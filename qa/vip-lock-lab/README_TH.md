# VIP2: ต้นแบบตรวจสิทธิ์ในธุรกรรมเดียวกับการสร้างห้อง

**ทดลองออฟไลน์เท่านั้น** ฐานโค้ด `9135b9c` ยังใช้การตรวจตอนเข้าคิวและก่อนสร้างห้องตามเดิม ต้นแบบอยู่ใน `qa/` และไม่ได้เรียกจากเกม ไม่ใช่ migration และห้ามนำไป apply บน Staging หรือ Production

รันในเครื่องทดสอบที่แยกแล้วเท่านั้น โดยชี้ PostgreSQL 17 ที่มี `initdb`/`postgres` และไฟล์ migration 001–005 ตรง Git blobs ใน runner:

```sh
python3 qa/vip-lock-lab/run.py /absolute/pg17/bin /absolute/checkout/backend/supabase
```

Runner สร้างฐานว่างใหม่ด้วยข้อมูลสังเคราะห์ในพื้นที่ชั่วคราว ใช้แบ็กเอนด์ single-user ทีละชุด ไม่เปิด socket ไม่ต้องใช้รหัสผ่าน ไม่แก้ checkout และหยุดเมื่อเจอ SQL error หรือ hash ไม่ตรง

## สัญญาที่เสนอสำหรับ runtime ในอนาคต

- รับเฉพาะ UID สองคนที่ server ยืนยันและสงวนไว้จริง ใช้ `FOR SHARE` ล็อกทั้งคู่ตาม UID (ไม่ใช้ `FOR KEY SHARE` ซึ่งไม่กั้นการเปลี่ยนสถานะ non-key) แล้วจึงตรวจด้วย `clock_timestamp()` ของฐานข้อมูล ทั้งคู่ต้อง active และ expiry ต้องมากกว่าเวลาที่ตรวจ ไม่ใช้เวลาจาก client และไม่เปลี่ยนสิทธิ์ในห้องที่เริ่มไปแล้ว
- เกมยังอ่านตารางสิทธิ์ได้แต่ไม่มี UPDATE หรือสิทธิ์ล็อกโดยตรง ต้นแบบให้เรียกฟังก์ชัน private จาก login เฉพาะ โดย owner เป็น NOLOGIN ไม่เป็นเจ้าของตารางและอยู่ใต้ RLS มีสิทธิ์ UPDATE เฉพาะคอลัมน์ที่ใช้ผ่านเงื่อนไขการล็อก แต่ restrictive policy ไม่ยอมให้แก้แถวจริง อ้างอิง [PostgreSQL SELECT locking privileges](https://www.postgresql.org/docs/17/sql-select.html) และ [row locks](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS)
- เรียก gate และ INSERT ด้วย client/transaction เดียวที่ตรึง session ไว้ ห้ามคืน client ระหว่างนั้น; ตรวจว่า verified UID ตรงกับ seats ที่ INSERT ถ้าฟังก์ชันคืน false และ rollback ยืนยันแล้วจึงจัดเป็น “ปฏิเสธโดยไม่เขียน” ปลด reservation ของเดิมและตรวจสิทธิ์ของ socket ปัจจุบันก่อนจัดใหม่ตาม FIFO ห้ามวน retry คู่เดิมโดยไม่จำกัด หาก connection หลุดหรือผล COMMIT ไม่ชัด ให้คง quarantine/readback เดิม ห้ามเดาว่าไม่มีห้อง
- นิยามสิทธิ์ที่เวลาตรวจหลังล็อก ไม่ใช่เวลาที่ COMMIT; การล็อกไม่ได้หยุดนาฬิกา งานนี้ยังไม่คุม SQL writer ทุกตัว เพราะ login เดิมยังมี INSERT rooms ต้องตรวจผู้เขียนทั้งหมดและ cutover จึงอ้างว่าฐานบังคับทุกเส้นทางได้

## หลักฐานและสิ่งที่ยังต้องพิสูจน์

ชุด SQL ตรวจคู่ active, UID ซ้ำ/ผิดรูป/ไม่พบ, revoked, expired, infinity, การใช้เวลาจริงแทนเวลาเริ่มธุรกรรม, ไม่แตะ INSERT เมื่อปฏิเสธ, บัญชีที่มีสิทธิ์เรียก, และบังคับ RLS ไม่ให้แก้ entitlement แม้มี permissive policy เพิ่มใน fixture.

ก่อนเปิดใช้ต้องทดสอบ DB หลาย session และ driver จริง: เมื่อ revoke มาก่อน admission ต้องเห็นการเปลี่ยน, เมื่อ admission ได้ล็อกก่อน revoke ต้องรอจนกว่าธุรกรรมสร้างห้องจบ, และเมื่อ INSERT/COMMIT ไม่แน่ชัดต้องแยกจากการปฏิเสธที่ยืนยันแล้ว. หลักฐานรอบนี้ยังไม่ครอบคลุมการรอ/rollback หลาย session หรือการทำงานของ pool จริง
