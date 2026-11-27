# ตรวจเส้นทางเริ่มต้น v12 บน Integration Candidate

ใน checkout ชั่วคราวของ candidate ให้รัน:

```sh
python3 tools/prepare_railway_secure.py
node --test qa/cross-track-lab/default-candidate.cjs
```

ใช้ HTML v12 ที่ build ในเครื่อง (ตรวจ SHA-256) หรือระบุ path โดย `LUCKY_V12_FIXTURE_HTML`. ตรวจ Git blobs 19 ไฟล์ของ candidate และ helper ที่นำกลับจากสาขา previous leaderboard. ไม่มี network, browser/transport, OAuth จริง, ฐานข้อมูล หรือการ deploy.

ทดสอบ click → controller → Free/VIP default store → receipt/+10 → protected previous standings และ Admin counts. ปฏิเสธ unauthenticated, method/mode ผิด และผู้ไม่มี VIP ก่อนอ่าน standings; ปฏิเสธ player ที่ขอ Admin counts. ระยะเวลาและรางวัลยังต้องยืนยันกับ staging จริง. HTTP handler เป็น source-only และยังไม่ mount; คะแนนรายงาน provisional.
