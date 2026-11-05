# Classroom Plus

เว็บแอปเพื่อการเรียนรู้สำหรับครูและนักเรียน ใช้ Google Apps Script V8, HTML Service และ Google Sheets เป็นฐานข้อมูล

## GitHub Pages

GitHub Pages ให้บริการหน้าแอป static ใน `site/` ส่วนข้อมูลและ authorization ยังทำงานใน Google Apps Script และ Google Sheets. หน้า Pages เรียก Apps Script ผ่าน `Bridge.html` ใน iframe แบบจำกัด origin; ต้องเพิ่มไฟล์ Bridge ใน Apps Script, deploy Web App และวาง URL ในแอป Pages ครั้งแรกต่อ browser. ห้ามเปลี่ยน origin ของ bridge เว้นแต่แก้ allowlist ให้ตรงกัน

เปิด **Repository Settings → Pages → Build and deployment → Source: GitHub Actions** หนึ่งครั้ง แล้ว workflow `Deploy GitHub Pages` จะเผยแพร่หน้า `site/` เมื่อมี push. การตั้งค่าอัตโนมัติจาก workflow ไม่ได้เปิดใช้ได้ด้วย `GITHUB_TOKEN` มาตรฐานใน repository ปัจจุบัน. URL Pages ที่คาดไว้คือ `https://krupondcompute.github.io/Classroom-Plus/`; ใช้งานได้หลังตั้งค่า Pages และ workflow สำเร็จ

## ติดตั้ง

1. สร้าง Google Spreadsheet เปล่า และคัดลอก ID จาก URL
2. สร้างโปรเจกต์ Apps Script แบบ standalone และเพิ่มไฟล์ `Code.gs`, `Index.html`, `Styles.html`, `Client.html`, `Bridge.html` และ manifest จาก repo นี้ (เปิดใช้การแสดง `appsscript.json` ใน Project Settings)
3. ใน **Project Settings → Script Properties** เพิ่ม `SPREADSHEET_ID` (จำเป็น) และ `DRIVE_FOLDER_ID` (เผื่อใช้ไฟล์ Drive ในการต่อยอด). เพิ่ม `BOOTSTRAP_NAME` เป็นชื่อผู้ดูแลเริ่มต้นก่อนสร้างผู้ดูแล
4. จาก editor รัน `setup()` แล้วอนุญาตสิทธิ์ Google ที่ร้องขอ ฟังก์ชันนี้สร้างแท็บ/หัวคอลัมน์ที่ขาดโดยไม่ล้างข้อมูล
5. จาก editor รัน `bootstrapFirstTeacher()` เพียงครั้งเดียว จด username/password ที่ผลการรันแสดงไว้ทันที จากนั้นลบ `BOOTSTRAP_NAME` ออกจาก Script Properties. การ bootstrap หยุดทำงานเองเมื่อพบบัญชีครูแล้ว
6. Deploy → New deployment → Web app. แนะนำ **Execute as: Me** และ **Who has access: Anyone** (จำเป็นสำหรับ Pages bridge); สิทธิ์ในแอปตรวจด้วย session และ authorization ฝั่ง backend. หากนโยบาย Google Workspace ไม่อนุญาต Anyone ให้ใช้หน้า Apps Script โดยตรงในโดเมนโรงเรียนแทน Pages bridge
7. เปิด Pages URL แล้ววาง Apps Script `/exec` URL ในหน้าตั้งค่าครั้งแรก. URL เก็บเฉพาะใน localStorage ของ browser นั้น คัดลอก URL ให้ผู้ใช้อื่นตั้งค่าแยก
8. ใน Pages ให้ตั้ง **Repository Settings → Pages → Build and deployment → Source: GitHub Actions**. Workflow สร้าง `site/app.html` จาก UI กลาง และ deploy `site/` เมื่อ push

### การอัปเดต

บันทึกเวอร์ชันใน Apps Script แล้ว Deploy → Manage deployments → Edit → เลือกเวอร์ชันใหม่. URL เดิมใช้งานต่อได้เมื่อแก้ deployment เดิม

## การตั้งค่าข้อมูล

`SPREADSHEET_ID` และ `DRIVE_FOLDER_ID` อยู่ใน Script Properties เท่านั้น; ห้ามใส่ secret ใน HTML/ชีต. แท็บ Config รองรับ `requireApproval` (`true`/`false`, ค่าเริ่มต้น false). เปิดอนุมัติบัญชีโดยแก้ค่าในแถว Config. DRIVE_FOLDER_ID เตรียมไว้ให้ workflow อัปโหลดไฟล์รุ่นต่อไป; รุ่นนี้ให้แนบลิงก์ HTTPS ไปยัง Drive/สื่อเท่านั้น และไม่ได้เปลี่ยนสิทธิ์แชร์ Drive ให้อัตโนมัติ

## ฟีเจอร์ใน MVP

- สมัครนักเรียนด้วยรหัส 5 หลักและชื่อบัญชีเฉพาะ, เข้าสู่ระบบ และ session หมดอายุใน 7 วัน
- ครูสร้างห้องและแชร์ join code; นักเรียนต้องใช้รหัสห้องเพื่อลงทะเบียนเข้าห้องนั้น
- ครูดูผู้เรียนในห้องของตนและอนุมัติ/ระงับบัญชีได้; ผู้ใช้เปลี่ยนชื่อ/อีเมลและรหัสผ่านได้
- บัญชีครูเริ่มต้นแบบสุ่มครั้งเดียวผ่าน editor; bootstrap ปิดเมื่อมีครู
- Dashboard, ห้องเรียนและรหัสเข้าห้อง, อนุมัติ/ระงับผู้เรียน, วิชา, บทเรียน/ลิงก์สื่อ, ประกาศ, งาน, ส่ง/แก้คำตอบก่อนกำหนด, ตรวจและให้คะแนน, แก้ไขโปรไฟล์/เปลี่ยนรหัสผ่าน
- UI responsive ภาษาไทย, audit log สำหรับสมัคร, CRUD เนื้อหา, bootstrap และให้คะแนน
- Idempotent `setup()`, backend validation, session token hash, per-user salted password hash, authorization ใน server, script lock ตอนเขียนแถว

## Schema

`Config(key,value,updatedAt)`, `Users(id,role,username,studentCode,passwordSalt,passwordHash,displayName,email,classId,status,createdAt,updatedAt,deletedAt)`, `Sessions(id,userId,tokenHash,expiresAt,createdAt)`, `Classes(id,name,grade,joinCode,ownerId,createdAt,updatedAt,deletedAt)`, `Courses(id,classId,name,description,ownerId,createdAt,updatedAt,deletedAt)`, `Lessons(id,courseId,title,content,mediaUrl,ownerId,createdAt,updatedAt,deletedAt)`, `Announcements(id,classId,title,body,ownerId,createdAt,updatedAt,deletedAt)`, `Assignments(id,courseId,title,description,dueAt,maxPoints,ownerId,createdAt,updatedAt,deletedAt)`, `Submissions(id,assignmentId,studentId,text,fileUrl,submittedAt,updatedAt,deletedAt)`, `Grades(id,submissionId,studentId,points,feedback,gradedBy,gradedAt)`, `AuditLog(id,actorId,action,entityType,entityId,details,createdAt)`. ใช้ UUID เป็นรหัส ไม่ใช้เลขแถวเป็น key; ความสัมพันธ์อ้าง ID. รายการเนื้อหามี deletedAt เผื่อ soft delete; UI ลบรายการยังไม่รวมใน MVP. ควรกำหนดระยะเก็บ/ลบข้อมูลตามนโยบายโรงเรียนก่อนใช้ข้อมูลจริง

## ข้อจำกัดและสิ่งที่ยังไม่ทำ

- ยังไม่ได้เชื่อมบัญชี Google/SSO, กู้รหัสผ่าน, ย้ายห้อง/จัดการสิทธิ์ครูเพิ่มเติม, upload ไฟล์ผ่าน Drive, รายงาน/ส่งออก, แจ้งเตือน, real-time และ backup
- บัญชีครู bootstrap ได้ครั้งเดียว; การสร้างบัญชีครูเพิ่มเติมต้องทำผ่าน Apps Script editor/จัดการชีตโดยผู้ดูแลที่เชื่อถือได้
- มีการตรวจสิทธิ์พื้นฐานฝั่ง server; ระบบยังไม่ผ่าน security review หรือทดสอบใน deployment จริง ห้ามใช้เป็น production จนตรวจ role boundaries, access scope, session expiry, XSS, file-sharing policy และ concurrency ในบัญชี Google เป้าหมาย
- Apps Script/Sheets มี quota และเวลารันจำกัด ไม่เหมาะกับโหลดสูงหรือไฟล์ใหญ่; รุ่นนี้ไม่อัปโหลดไฟล์และลิงก์ Drive ยังคงตามสิทธิ์ของ Drive ต้นทาง
- Password KDF เป็น SHA-256 ซ้ำพร้อม salt เนื่องจาก GAS ไม่มี password KDF แบบมาตรฐานให้ใช้ใน runtime นี้; สำหรับระบบข้อมูลอ่อนไหวควรย้าย auth ไปบริการที่รองรับ Argon2id/scrypt และ session cookie ที่ปลอดภัยกว่า
- session token เก็บใน sessionStorage ของแท็บ browser; token ไม่ป้องกัน XSS. จาก Pages ใช้ message bridge ที่ตรึง Pages origin และตรวจ `event.source`/origin; URL backend เป็น Apps Script deployment ที่ผู้ดูแลต้องกำหนดเอง
- การใช้ CDN (Bootstrap, Font Awesome, Sarabun) ต้องมีอินเทอร์เน็ต

## Prompt ที่ปรับสำหรับการพัฒนาต่อยอด

ดู `PROMPT-CLASSROOM-PLUS.md` สำหรับ prompt ภาษาไทยฉบับเต็ม
