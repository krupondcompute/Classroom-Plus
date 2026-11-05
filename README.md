# Classroom Plus

เว็บแอปเพื่อการเรียนรู้สำหรับครูและนักเรียน หน้าเว็บเป็น HTML/CSS/JavaScript แบบ static ที่ GitHub Pages ให้บริการ ส่วน Google Apps Script เป็น backend สำหรับบัญชีและข้อมูล Google Sheets/Drive

## GitHub Pages

GitHub Pages ให้บริการหน้า Landing Page และตัวแอป static จาก HTML/CSS/JavaScript ใน `site/`; ไม่ต้องเปิดหน้า HTML Service ของ Apps Script เพื่อใช้งาน. ข้อมูลและ authorization ทำงานใน Apps Script/Sheets. Admin ตั้ง URL backend ครั้งแรกและแชร์ลิงก์จากหน้าตั้งค่าให้ผู้ใช้รายอื่น ลิงก์จะเชื่อม backend ให้โดยอัตโนมัติ. การเรียก backend ใช้ `Bridge.html` ใน iframe และตรวจ origin ของ Pages; ห้ามเปลี่ยน origin ของ bridge เว้นแต่ปรับ allowlist ให้ตรงกัน

เปิด **Repository Settings → Pages → Build and deployment → Source: GitHub Actions** หนึ่งครั้ง แล้ว workflow `Deploy GitHub Pages` จะเผยแพร่หน้า `site/` เมื่อมี push. การตั้งค่าอัตโนมัติจาก workflow ไม่ได้เปิดใช้ได้ด้วย `GITHUB_TOKEN` มาตรฐานใน repository ปัจจุบัน. URL Pages ที่คาดไว้คือ `https://krupondcompute.github.io/Classroom-Plus/`; ใช้งานได้หลังตั้งค่า Pages และ workflow สำเร็จ

## ติดตั้ง

1. สร้าง standalone Apps Script project แล้วคัดลอก `Code.gs`, `Index.html`, `Styles.html`, `Client.html`, `Bridge.html` และ `appsscript.json` เข้าไป (เปิดการแสดง manifest ใน Project Settings)
2. เจ้าของโปรเจกต์เปิด Apps Script editor, เลือก `prepareAdminBootstrap` (ไม่มี `_` ต่อท้าย) จากรายการฟังก์ชันข้างปุ่ม Run แล้วกด Run. อนุญาตสิทธิ์เมื่อ Google ถาม จากนั้นเปิด **Execution log** เพื่อคัดลอกรหัส bootstrap. รหัสใช้ได้ 30 นาทีและใช้ได้ครั้งเดียว ยังไม่ต้องตั้ง Spreadsheet ID หรือรัน `setup()`. ฟังก์ชันนี้ตรวจว่าเป็นเจ้าของโปรเจกต์และไม่เปิดผ่าน API ให้ผู้ใช้ทั่วไป
3. Deploy → New deployment → Web app. เลือก **Execute as: Me** และตั้งผู้เข้าถึงเป็น **Anyone, including anonymous** เพื่อให้หน้า GitHub Pages เรียก bridge ได้. ผู้ deploy อนุญาต scopes ของ Sheets/Drive ตามที่ระบบร้องขอ เก็บรหัส bootstrap เป็นความลับและห้ามใส่ใน repo
4. เปิด [หน้า GitHub Pages](https://krupondcompute.github.io/Classroom-Plus/), เลือกเปิดแอป, Admin วาง Apps Script `/exec` URL เพียงครั้งแรก แล้วกรอกรหัส bootstrap เพื่อสร้างบัญชี Admin ด้วย username/password ของตนเอง. ยังไม่ต้องกรอก Sheet/Drive ID
5. Admin ลงชื่อเข้าใช้ แล้วกรอก Spreadsheet ID และ Drive folder ID ในหน้าตั้งค่าครั้งแรก Backend ตรวจว่าเปิดทั้งสองรายการได้ สร้างแท็บ/หัวคอลัมน์ที่ขาดโดยไม่ลบข้อมูล และบันทึก ID ใน Script Properties เท่านั้น
6. Admin สร้างห้องเรียนก่อน จากนั้นตั้งนโยบายว่าจะเปิดสมัครนักเรียน/ต้องอนุมัติหรือไม่ หรือสร้างคำเชิญครู/นักเรียน ระบบแสดงรหัสผ่านชั่วคราวครั้งเดียวและบังคับผู้รับเปลี่ยนหลัง login
7. เมื่อพร้อม ให้ Admin สร้างคำเชิญผู้ใช้หรือเปิดรับสมัครนักเรียน แล้วคัดลอก **ลิงก์สำหรับแชร์** ในหน้าตั้งค่าเพื่อส่งให้ผู้ใช้ ลิงก์นี้บรรจุ URL backend สาธารณะของ Apps Script แต่ไม่มี Spreadsheet/Drive ID หรือรหัสผ่าน; แต่ละผู้ใช้ยังต้องใช้บัญชีที่ได้รับเชิญหรือสมัครตามนโยบาย

การตั้ง **Anyone, including anonymous** ทำให้ URL Apps Script เรียกได้จากอินเทอร์เน็ต; endpoint ที่เข้าถึงข้อมูลจะตรวจ session และ role ฝั่ง server ทุกครั้ง และหน้า Pages ส่งคำขอผ่าน bridge ที่จำกัด origin. ถ้านโยบาย Workspace ไม่อนุญาต anonymous access ให้ใช้โฮสติ้ง/backend ที่โรงเรียนอนุญาต หรือเปิดหน้า Apps Script โดยตรง

### การอัปเดต

บันทึกเวอร์ชันใน Apps Script แล้ว Deploy → Manage deployments → Edit → เลือกเวอร์ชันใหม่. URL เดิมใช้งานต่อได้เมื่อแก้ deployment เดิม

## การตั้งค่าข้อมูล

`SPREADSHEET_ID` และ `DRIVE_FOLDER_ID` ตั้งค่าจากหน้า Admin แล้วเก็บใน Script Properties; ไม่ส่งกลับไปหน้าเว็บ. แท็บ Config จัดเก็บ `requireApproval` และ `allowStudentSignup` (ค่าเริ่มต้นปิดการสมัคร). รุ่นนี้ใช้ URL HTTPS สำหรับไฟล์/สื่อและไม่เปลี่ยนสิทธิ์แชร์ Drive อัตโนมัติ

## ฟีเจอร์ใน MVP

- Bootstrap Admin ด้วย code ใช้ครั้งเดียวหมดอายุใน 30 นาที; hash รหัสและรหัสผ่านอยู่ฝั่ง Apps Script
- Admin ตั้งค่า Sheet/Drive ID หลัง login, สร้าง schema และตั้งนโยบายสมัคร/อนุมัติ
- เชิญครู/นักเรียนพร้อมรหัสผ่านชั่วคราว; เปลี่ยน role ได้โดยป้องกัน Admin คนสุดท้ายและบัญชี bootstrap หลัก
- สมัครนักเรียนด้วยรหัส 5 หลักและ join code ห้องเรียน, เข้าสู่ระบบ และ session หมดอายุใน 7 วัน
- ครูสร้างห้องและแชร์ join code; นักเรียนต้องใช้รหัสห้องเพื่อลงทะเบียนเข้าห้องนั้น
- ครูดูผู้เรียนในห้องของตนและอนุมัติ/ระงับบัญชีได้; ผู้ใช้เปลี่ยนชื่อ/อีเมลและรหัสผ่านได้
- Dashboard, ห้องเรียนและรหัสเข้าห้อง, อนุมัติ/ระงับผู้เรียน, วิชา, บทเรียน/ลิงก์สื่อ, ประกาศ, งาน, ส่ง/แก้คำตอบก่อนกำหนด, ตรวจและให้คะแนน, แก้ไขโปรไฟล์/เปลี่ยนรหัสผ่าน
- UI responsive ภาษาไทย, audit log สำหรับสมัคร, CRUD เนื้อหา, bootstrap และให้คะแนน
- Idempotent `setup()`, backend validation, session token hash, per-user salted password hash, authorization ใน server, script lock ตอนเขียนแถว

## Schema

`Config(key,value,updatedAt)`, `Users(id,role,username,studentCode,passwordSalt,passwordHash,displayName,email,classId,status,mustChangePassword,createdAt,updatedAt,deletedAt)`, `Sessions(id,userId,tokenHash,expiresAt,createdAt)`, `Classes(id,name,grade,joinCode,ownerId,createdAt,updatedAt,deletedAt)`, `Courses(id,classId,name,description,ownerId,createdAt,updatedAt,deletedAt)`, `Lessons(id,courseId,title,content,mediaUrl,ownerId,createdAt,updatedAt,deletedAt)`, `Announcements(id,classId,title,body,ownerId,createdAt,updatedAt,deletedAt)`, `Assignments(id,courseId,title,description,dueAt,maxPoints,ownerId,createdAt,updatedAt,deletedAt)`, `Submissions(id,assignmentId,studentId,text,fileUrl,submittedAt,updatedAt,deletedAt)`, `Grades(id,submissionId,studentId,points,feedback,gradedBy,gradedAt)`, `AuditLog(id,actorId,action,entityType,entityId,details,createdAt)`. ใช้ UUID เป็นรหัส ไม่ใช้เลขแถวเป็น key; ความสัมพันธ์อ้าง ID. รายการเนื้อหามี deletedAt เผื่อ soft delete; UI ลบรายการยังไม่รวมใน MVP. ควรกำหนดระยะเก็บ/ลบข้อมูลตามนโยบายโรงเรียนก่อนใช้ข้อมูลจริง

## ข้อจำกัดและสิ่งที่ยังไม่ทำ

- ยังไม่ได้เชื่อมบัญชี Google/SSO, กู้รหัสผ่าน, ย้ายผู้เรียน, อัปโหลดไฟล์ผ่าน Drive, รายงาน/ส่งออก, แจ้งเตือน, real-time และ backup
- ยังไม่ได้ทดสอบการ authorize, bridge และการทำงานกับ Sheet/Drive จริงในบัญชีโรงเรียน เปลี่ยนค่า Execute as/Who has access ได้ตามนโยบาย Workspace แต่ต้องทดสอบสิทธิ์ใหม่
- มีการตรวจสิทธิ์พื้นฐานฝั่ง server; ระบบยังไม่ผ่าน security review หรือทดสอบใน deployment จริง ห้ามใช้เป็น production จนตรวจ role boundaries, access scope, session expiry, XSS, file-sharing policy และ concurrency ในบัญชี Google เป้าหมาย
- Apps Script/Sheets มี quota และเวลารันจำกัด ไม่เหมาะกับโหลดสูงหรือไฟล์ใหญ่; รุ่นนี้ไม่อัปโหลดไฟล์และลิงก์ Drive ยังคงตามสิทธิ์ของ Drive ต้นทาง
- Password KDF เป็น SHA-256 ซ้ำพร้อม salt เนื่องจาก GAS ไม่มี password KDF แบบมาตรฐานให้ใช้ใน runtime นี้; สำหรับระบบข้อมูลอ่อนไหวควรย้าย auth ไปบริการที่รองรับ Argon2id/scrypt และ session cookie ที่ปลอดภัยกว่า
- session token เก็บใน sessionStorage ของแท็บ browser; token ไม่ป้องกัน XSS. จาก Pages ใช้ message bridge ที่ตรึง Pages origin และตรวจ `event.source`/origin; URL backend เป็น Apps Script deployment ที่ผู้ดูแลต้องกำหนดเอง
- การใช้ CDN (Bootstrap, Font Awesome, Sarabun) ต้องมีอินเทอร์เน็ต

## Prompt ที่ปรับสำหรับการพัฒนาต่อยอด

ดู `PROMPT-CLASSROOM-PLUS.md` สำหรับ prompt ภาษาไทยฉบับเต็ม
