# P1–P4: ตรวจรวมแบบออฟไลน์บน controller รุ่นล่าสุด

ชุดนี้ยกเฉพาะตัวทดสอบไอเทมมาทดลองกับ Free4 controller ที่ส่ง `revision` ทั้งตอนทอยและเมื่อกลับเข้าห้อง โดยไม่ใช้แพ็กเกจเก่าแทน controller และไม่แก้สาขาเดิม ให้ตรวจ SHA ทั้งห้าชุดตาม `latest-source-blobs.json` แล้วใช้ checkout/worktree แยกที่มีอยู่แล้ว:

```sh
python3 qa/cross-track-lab/run-latest.py --offline PILOT_ROOT ITEM_ROOT LEADER_ROOT ADMIN_ROOT SUITE_ROOT
```

- ต้องมี Python, Git และ Node ไฟล์ที่ใช้จริง 39 ไฟล์ต้องตรง blob ที่ระบุ สคริปต์จะสร้างและลบเฉพาะไดเรกทอรีชั่วคราว ไม่เขียนทับ checkout และไม่เริ่มเซิร์ฟเวอร์ เบราว์เซอร์ หรือฐานข้อมูล
- สร้างแพ็กเกจ v12 ปกติแล้วตรวจ hash ว่าไม่เปลี่ยน จากนั้นจึงสร้างชุดทดลองแยกเพื่อฉีด snapshot ไอเทมสังเคราะห์เมื่อปิด pilot ใน fixture เท่านั้น ไม่มีการเปิดไอเทมให้ Free4 pilot จริง
- ตรวจว่า +10 Free / +20 VIP แบบสังเคราะห์ตรงกันระหว่าง state packet, receipt, ledger และกล่องผล UI ใน DOM จำลอง แล้วส่งหลักฐานเดียวกันเข้า historical leaderboard (provisional แยกโหมด) และ Admin room-count reader (เฉพาะผู้ได้รับอนุญาต)
- สิ่งที่ยังไม่พิสูจน์: เปิดสิทธิ์ไอเทมจริง, Google OAuth, Chromium, PostgreSQL driver/หลาย session, การเปิดหน้า Admin/ตารางย้อนหลังในบริการจริง หรือการปิดรอบถาวร ไม่ใช้ผลนี้แทนเกณฑ์ Staging หรือเผยแพร่เป็น runtime
