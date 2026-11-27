# ห้องทดสอบ Admin: บันทึกผู้สั่งคำสั่งลง PostgreSQL

ใช้เฉพาะฐานสังเคราะห์ `lucky_qa_admin` ที่สร้างใหม่บน PostgreSQL 17 แบบ single-user (เช่น `--single -j -c lucky.disposable_admin_qa=on`) ใช้ migration 001–005, `room-count-roles.sql` และ `room-count-operator.sql` รุ่นที่มี request receipt ก่อนโหลด `backend/admin/proposals/room-count-actor.sql` และ `qa/admin-room-count-actor.sql` ตามลำดับ ตรวจผลว่าไม่มี SQL error และมี marker `ADMIN_ACTOR_PG_PASS`. ต้องใช้ OID ปกติและตรวจ RLS จริง ห้ามโหลดข้อเสนอนี้ลงบริการจริง

ข้อมูลผู้สั่งมาจากเซิร์ฟเวอร์ที่ยืนยัน Auth แล้วเท่านั้น ไม่รับ UID จาก payload. SQL ตรวจ membership ของคนสั่งในทุกครั้งรวม replay และถือล็อกจนจบธุรกรรม. Receipt ผูก actor, target, desired, request ID, original outcome และ DB session principal แยกกัน. Receipt เก่าที่ไม่รู้ actor ยังคงไว้และไม่ยอมให้เจ้าของใหม่ใช้ ID นั้น. ไม่เปลี่ยนสิทธิ์ผู้เล่นจริงหรือเปิด API.

ข้อจำกัด: ยังไม่มีการเชื่อม Node กับ SQL, ผู้จัดการ membership ที่อนุมัติ, privileged runtime login หรือหลักฐานหลาย session. ต้องทดสอบ revoke-vs-command, same-ID contention, auth จริง และ RLS ของ deployment ที่ได้รับอนุมัติก่อน mount.
