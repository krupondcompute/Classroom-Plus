# Prompt: Classroom Plus เว็บแอปเพื่อการศึกษา

## บทบาทและเป้าหมาย
คุณคือ Senior Full-Stack Developer และ UX/UI Designer ที่เชี่ยวชาญระบบการเรียนรู้ดิจิทัล จงพัฒนา **Classroom Plus** สำหรับครูและนักเรียน โดยตรวจ repository ก่อน สรุปแนวทาง/ข้อจำกัดสั้น ๆ แล้วทำงานต่อให้จบเป็นส่วนที่ใช้งานและตรวจสอบได้ ห้ามอ้างว่าฟีเจอร์เสร็จหากยังไม่ได้ทำ

## ขอบเขตส่งมอบ
เริ่ม MVP ที่ติดตั้งได้: การตั้งค่า, บัญชี/บทบาท, ห้องเรียนและวิชา, บทเรียนและสื่อ, ประกาศ, งาน/ส่งงาน, คะแนน/ความคืบหน้า, responsive UI และคู่มือติดตั้ง ต่อด้วยรายงาน/ส่งออก/แจ้งเตือน/บันทึกกิจกรรม/สำรองข้อมูลตามเวลาและข้อจำกัดจริง ระบุชัดเจนว่าอะไรยังไม่ทำ

## เทคโนโลยี
- Backend Google Apps Script V8 Web App, Frontend HTML Service, Vanilla JS/CSS mobile-first, Bootstrap 5.3, Font Awesome 6 Free, Sarabun CDN เท่าที่จำเป็น
- Google Sheets เป็นฐานข้อมูล; Spreadsheet ID และ Google Drive folder ID ให้ผู้ดูแลกำหนดภายหลังใน Script Properties. ห้ามฝัง secret ใน browser
- หากเผยแพร่ UI บน GitHub Pages ให้แยก static frontend จาก Apps Script backend ชัดเจน; ใช้ bridge ที่ตรวจ `event.origin`, `event.source` และ allowlist ที่เจาะจงก่อนส่งคำขอไป `google.script.run`; ห้ามอ้างว่า Pages รัน Apps Script ได้เอง
- แยกไฟล์ตามหน้าที่, setup() ต้องเรียกซ้ำได้โดยไม่ทำข้อมูลเดิมหาย, ใช้ UUID ไม่ใช้เลขแถวเป็นรหัส, รวมงานอ่าน/เขียนชีตและใช้ LockService เมื่อต้องป้องกันการชน
- เรียก google.script.run ผ่าน Promise wrapper, allowlist ชื่อ backend, รับส่งเฉพาะ plain data, แสดง loading/error/success และป้องกันการส่งซ้ำ

## ความสามารถ
- นักเรียนสมัครด้วยข้อมูลขั้นต่ำและรหัสนักเรียน 5 หลักที่ตรวจซ้ำบน server, ดูวิชา/บทเรียน/ประกาศ, ส่งและแก้คำตอบก่อนกำหนด, ดูผลคะแนน/ข้อเสนอแนะ/ความคืบหน้าของตัวเอง
- ครูจัดการห้อง/วิชา/บทเรียน/ประกาศ/งาน, ตรวจงานและให้คะแนน, ดูภาพรวมผู้เรียนและงานค้าง
- รองรับ first-run โดยยังไม่มี Sheet ID: owner ออกรหัส bootstrap แบบสุ่มใช้ครั้งเดียวใน editor, Admin ตั้ง password ผ่าน Pages, login, ตั้ง Spreadsheet/Drive IDs ให้ backend ตรวจและบันทึกใน Script Properties, แล้วจึงสร้าง schema
- Admin เปิด/ปิดสมัครนักเรียนและอนุมัติบัญชี, เชิญผู้ใช้ด้วยรหัสชั่วคราวและกำหนด role. บังคับเปลี่ยนรหัสชั่วคราว; ป้องกันการลดสิทธิ์หรือลบบัญชี Admin หลัก/คนสุดท้าย
- รองรับการอนุมัติบัญชีเป็น option ปิดไว้โดยค่าเริ่มต้น; หากเปิดต้องมีสถานะ pending ชัดเจน
- ใช้เวลาแบบมาตรฐานเดียวกัน เก็บ ISO timestamp และแสดงวัน พ.ศ. เมื่อเหมาะกับ UI ไทย

## ความปลอดภัย/ความเป็นส่วนตัว
- ตรวจ authentication, role, ownership และ class/course access ฝั่ง server ทุกครั้ง; ไม่เชื่อ role/userId/คะแนน/สถานะจาก client
- เก็บเฉพาะ hash ของ session token แบบสุ่ม entropy สูง พร้อม expiry; client เก็บเฉพาะ session ชั่วคราวและล้างเมื่อออก. อธิบายว่า token ฝั่ง browser ไม่ป้องกัน XSS
- hash รหัสผ่านพร้อม salt ต่อบัญชี; ไม่เก็บ plaintext และไม่ log secret. ห้ามใช้ admin/admin123
- validate input ทั้ง client/server, escape output, จำกัด URL เป็น HTTPS และจำกัดชนิด/ขนาดไฟล์หากมี upload; ตรวจสิทธิ์ Drive จริงและอย่าเปิดไฟล์เป็น public อัตโนมัติ
- ใช้ audit log กับการเปลี่ยนสิทธิ์/ข้อมูลสำคัญ/คะแนน/ตั้งค่าโดยลดข้อมูลอ่อนไหวใน log
- ระบุข้อจำกัด CSRF ที่ตรงกับ google.script.run; เก็บข้อมูลส่วนบุคคลเท่าที่จำเป็นและให้โรงเรียนกำหนดวัตถุประสงค์ ระยะเก็บ และวิธีลบ

## UX/UI และประสิทธิภาพ
- ภาพลักษณ์เรียบง่าย ทันสมัย CSS variables, radius 16–24px, เงานุ่ม, transition 150–250ms, mobile/tablet/desktop
- พื้นที่แตะอย่างน้อย 44px, input มือถือ 16px, semantic HTML, label/aria, focus ชัด, contrast ดี, prefers-reduced-motion, safe area และ 100dvh พร้อม fallback
- มี loading, empty, error และ success states; รายการยาวค้นหาแบบ debounce และแบ่งหน้า/โหลดเพิ่ม; ตารางมือถือไม่ทำข้อมูลหาย
- อ่าน/เขียนชีตเป็น batch, ระวัง quota, เวลารัน, concurrent users และขนาด payload; ห้ามอ้าง real-time หรือรองรับโหลดสูงหากไม่มีระบบรองรับ
- ยืนยันการลบ/การกระทำสำคัญอย่างเหมาะสม ไม่เพิ่มขั้นตอนยืนยันทุก action

## ข้อมูลตั้งต้นและเอกสาร
พิจารณาชีต Config, Users, Sessions, Classes, Courses, Lessons, Announcements, Assignments, Submissions, Grades, AuditLog พร้อมระบุ headers, unique IDs, relationships, timestamps, owner/createdBy และ retention/soft delete. ห้าม seed ข้อมูลจริงหรือ credential อ่อนแอ

ส่งมอบโค้ดแยกไฟล์, README การตั้งค่า Script Properties, setup(), scopes/authorization, bootstrap ผู้ดูแล, deployment และผลของ Execute as/Who has access, การอัปเดต deployment, ข้อจำกัด quota และรายการที่ยังไม่ทำ

## การตรวจรับ
ตรวจ navigation, responsive states, validation, error handling, authorization (รวมผู้ใช้อื่น/unauthenticated/ผู้ดูแลคนสุดท้าย), setup ซ้ำ, ID เมื่อเขียนพร้อมกัน, output/input safety, file access และ session expiry เท่าที่ environment อนุญาต รันเฉพาะคำสั่งตรวจที่มีอยู่หรือที่ผู้ใช้ร้องขอ รายงานสิ่งที่ตรวจจริงและสิ่งที่ต้องตรวจหลังติดตั้ง ห้ามเรียกงาน production-ready ก่อนผ่านการ deploy และทดสอบสิทธิ์จริง

## เริ่มงาน
ตรวจ repo และคำแนะนำใน AGENTS.md ก่อน จากนั้นทำ MVP ให้ใช้งานได้จริงตามข้อจำกัด Google Apps Script บันทึกเหตุผลของการปรับสถาปัตยกรรม และจัดเตรียมสิ่งส่งมอบให้ตรวจทานได้ก่อน commit/push เมื่อผู้ใช้ร้องขอ
