// node tools/test-backend.js — ทดสอบ Code.gs จริงบน shim
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = { console, Date, JSON, Math, Object, Array, String, Number, Error, Buffer, TextEncoder, setTimeout };
ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'gas-shim.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8') + '\nglobalThis.rpc=rpc;globalThis.dailyJob=dailyJob;', ctx);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const R = (fn, tok, ...a) => ctx.rpc(fn, tok, a);
const b = R('bootstrap', null);
ok(b.ok && b.data.config.schoolName === 'Classroom +', 'bootstrap ' + JSON.stringify(b).slice(0, 200));
ok(b.data.classes.length === 4, 'seed classes');
ok(!('lineToken' in b.data.config), 'private config hidden');
let r = R('login', null, { mode: 'admin', username: 'admin', password: 'wrong' });
ok(!r.ok, 'bad admin pw');
r = R('login', null, { mode: 'admin', username: 'admin', password: 'admin123' });
ok(r.ok && r.data.user.mustChangePassword === 'true' && !r.data.user.passHash, 'admin login');
const A = r.data.token;
ok(R('me', 'x'.repeat(64)).code === 'AUTH', 'invalid token rejected');
// student register
r = R('registerStudent', null, { prefix: 'เด็กชาย', fullName: 'สมชาย ใจดี', birthDate: '2013-05-04', grade: 'ม.1', room: '1', studentCode: '12345', consent: true });
ok(r.ok, 'register student ' + r.error);
const T = r.data.token;
ok(R('checkStudentCode', null, '12345').data.available === false, 'code taken');
ok(!R('registerStudent', null, { prefix: 'นาย', fullName: 'ซ้ำ กัน', birthDate: '2013-05-04', grade: 'ม.1', studentCode: '12345', consent: true }).ok, 'dup code');
ok(!R('registerStudent', null, { prefix: 'นาย', fullName: 'เด็ก เล็ก', birthDate: '2024-05-04', grade: 'ม.1', studentCode: '22222', consent: true }).ok, 'age check');
ok(R('adminDashboard', T).code === 'FORBIDDEN', 'student cannot admin');
// student login code+birth
ok(R('login', null, { mode: 'student', studentCode: '12345' }).ok, 'student login code only');
ok(!R('login', null, { mode: 'student', studentCode: '99998' }).ok, 'unknown code');
ok(R('registerStudent', null, { prefix: 'นาย', fullName: 'ม หก', birthDate: '2008-01-01', grade: 'ม.6', room: '3', studentCode: '60001', consent: true }).ok, 'grade ม.6 without class row');
// home & courses
r = R('studentHome', T); ok(r.ok && r.data.courses.length === 1 && r.data.stats.pending === 1, 'home ' + JSON.stringify(r).slice(0, 300));
const cid = r.data.courses[0].id;
r = R('getCourse', T, cid); ok(r.ok && r.data.lessons.length === 2, 'course lessons');
const lid = r.data.lessons[0].id;
r = R('getLesson', T, lid); ok(r.ok && r.data.nextId, 'lesson');
r = R('saveProgress', T, lid, { videoPos: 42, completed: true, videoDone: true }); ok(r.ok && r.data.completed === 'true', 'progress');
r = R('studentHome', T); ok(r.data.stats.lessonsDone === 1 && r.data.stats.percent === 50 && r.data.stats.videosDone === 1, 'progress stats');
// other grade cannot see
const o = R('registerStudent', null, { prefix: 'เด็กหญิง', fullName: 'สมหญิง รักเรียน', birthDate: '2012-01-01', grade: 'ม.2', room: '1', studentCode: '54321', consent: true }).data.token;
ok(R('listCourses', o).data.length === 0 && !R('getCourse', o, cid).ok, 'grade filtering');
// assignments
const asg = R('listAssignments', T).data; ok(asg.length === 1 && asg[0].status === 'pending', 'assign list');
r = R('uploadFile', T, { name: 'งาน.pdf', mime: 'application/pdf', data: Buffer.from('hello').toString('base64'), kind: 'submission' }); ok(r.ok && r.data.url.startsWith('https://'), 'upload');
ok(!R('uploadFile', T, { name: 'x.exe', data: 'aGk=' }).ok, 'block exe');
r = R('submitWork', T, asg[0].id, { text: 'คำตอบ', files: [r.data] }); ok(r.ok && r.data.status === 'ontime', 'submit');
r = R('submitWork', T, asg[0].id, { text: 'แก้ไข' }); ok(r.ok && JSON.parse(r.data.history).length === 1, 'edit history');
ok(R('notifications', A).data.some(n => n.title === 'มีงานส่งใหม่'), 'teacher notified');
const subs = R('listSubmissions', A, asg[0].id).data; ok(subs.rows.length === 1 && subs.rows[0].sub, 'list submissions');
ok(!R('gradeSubmission', A, subs.rows[0].sub.id, 11, '').ok, 'score > max');
ok(R('gradeSubmission', A, subs.rows[0].sub.id, 8, 'ดีมาก').ok, 'grade');
ok(!R('submitWork', T, asg[0].id, { text: 'x' }).ok, 'cannot edit graded');
ok(R('notifications', T).data.some(n => n.title === 'ครูตรวจงานแล้ว'), 'student notified grade');
// admin CRUD + notifications
r = R('save', A, 'Announcements', { title: 'สอบกลางภาค', type: 'แจ้งสอบ', body: '=HYPERLINK("x")', grade: 'ม.1' }); ok(r.ok, 'announce');
ok(R('listAnnouncements', T).data.length === 2 && R('listAnnouncements', o).data.length === 1, 'announce targeting');
ok(R('listAnnouncements', T).data.some(a => a.body.startsWith('=HYPERLINK')), 'formula stored as text');
r = R('save', A, 'Lessons', { courseId: cid, title: 'อนาคต', publishAt: '2099-01-01T00:00' }); ok(r.ok, 'future lesson');
ok(R('getCourse', T, cid).data.lessons.length === 2, 'unpublished hidden');
ok(!R('save', A, 'Users', {}).ok, 'Users not generic editable');
// search
ok(R('search', T, { q: 'แยกส่วน' }).data.length >= 2, 'search');
// reports
['attendance', 'views', 'submissions', 'scores', 'courses'].forEach(t => { const x = R('report', A, t, {}); ok(x.ok && x.data.rows.length, 'report ' + t + ' ' + x.error); });
ok(R('adminDashboard', A).ok, 'dashboard');
// users management
const users = R('listUsers', A).data; const stu = users.find(u => u.studentCode === '12345');
ok(!R('deleteUser', A, users.find(u => u.username === 'admin').id).ok, 'cannot delete self');
ok(!R('setRole', A, users.find(u => u.username === 'admin').id, 'student', { studentCode: '99999' }).ok, 'cannot demote self/last');
r = R('setRole', A, stu.id, 'admin', { username: 'kru.a', password: 'password1' }); ok(r.ok, 'promote');
ok(R('me', T).code === 'AUTH', 'sessions killed on role change');
ok(R('login', null, { mode: 'admin', username: 'kru.a', password: 'password1' }).ok, 'promoted login');
r = R('changeCredentials', A, { currentPassword: 'admin123', username: 'boss', newPassword: 'newpass123' }); ok(r.ok && r.data.mustChangePassword === 'false', 'change creds');
ok(R('login', null, { mode: 'admin', username: 'boss', password: 'newpass123' }).ok, 'new creds login');
r = R('importStudents', A, [{ studentCode: '11111', prefix: 'นาย', fullName: 'นำเข้า หนึ่ง', grade: 'ม.1' }, { studentCode: '11111', fullName: 'ซ้ำ' }, { studentCode: 'abc', fullName: 'x' }]);
ok(r.ok && r.data.added === 1 && r.data.skipped.length === 2, 'import');
r = R('forgotCode', null, { fullName: 'สมหญิง รักเรียน', birthDate: '2012-01-01', newCode: '67890' }); ok(r.ok, 'forgot code');
ok(R('login', null, { mode: 'student', studentCode: '67890' }).ok, 'login new code');
// admin signup w/ approval
R('saveSettings', A, { config: { requireApproval: 'true' } });
r = R('registerAdmin', null, { prefix: 'นาง', fullName: 'ครู ใหม่', birthDate: '1990-01-01', username: 'kru.new', password: 'abcdefgh', confirm: 'abcdefgh', consent: true });
ok(r.ok && r.data.pending, 'pending admin');
ok(!R('login', null, { mode: 'admin', username: 'kru.new', password: 'abcdefgh' }).ok, 'pending cannot login');
// cascade delete course
r = R('remove', A, 'Courses', cid); ok(r.ok && r.data.Lessons === 3 && r.data.Submissions === 1, 'cascade ' + JSON.stringify(r.data));
// throttle
const T2v = R('login', null, { mode: 'student', studentCode: '60001' }).data.token, A2v = R('login', null, { mode: 'admin', username: 'boss', password: 'newpass123' }).data.token;
function T2() { return T2v; } function A2() { return A2v; }
for (let i = 0; i < 5; i++) R('login', null, { mode: 'admin', username: 'boss', password: 'x' });
ok(R('login', null, { mode: 'admin', username: 'boss', password: 'newpass123' }).code === 'THROTTLE', 'throttle');
// classNo + menus + theme
ok(R('updateProfile', T2(), { classNo: '07' }).data.classNo === '7', 'classNo');
ok(!R('saveSettings', A2(), { config: { themeColor: 'red' } }).ok, 'bad color');
R('saveSettings', A2(), { config: { themeColor: '#16a34a', studentMenus: JSON.stringify({ hidden: ['search', 'home'], custom: [{ name: 'แบบฟอร์ม', url: 'https://forms.gle/x', icon: 'fa-list' }, { name: 'bad', url: 'javascript:1' }] }) } });
const mc = JSON.parse(R('bootstrap', null).data.config.studentMenus); ok(mc.hidden.join() === 'search' && mc.custom.length === 1 && R('bootstrap', null).data.config.themeColor === '#16a34a', 'menus/theme config');
// chunked upload + folders + purge
const DB = ctx.__shimDB();
const st = R('uploadStart', T2(), { name: 'big.mp4', mime: 'video/mp4', size: 20 * 1024 * 1024, folder: 'การบ้าน' });
ok(st.ok && st.data.chunk === 8 * 1024 * 1024, 'upload start ' + st.error);
let pos = 0, last; const chunk = Buffer.alloc(8 * 1024 * 1024).toString('base64');
while (true) { const size = Math.min(8 * 1024 * 1024, 20 * 1024 * 1024 - pos); last = R('uploadChunk', T2(), st.data.uploadId, pos, size === 8 * 1024 * 1024 ? chunk : Buffer.alloc(size).toString('base64')); if (!last.ok || last.data.done) break; pos = last.data.next; }
ok(last.ok && last.data.done && last.data.file.size === 20 * 1024 * 1024, 'chunks done ' + JSON.stringify(last).slice(0, 200));
ok(DB.files[last.data.file.id].folder.endsWith('การบ้าน/งานที่นักเรียนส่ง'), 'student folder forced ' + DB.files[last.data.file.id].folder);
ok(!R('uploadStart', T2(), { name: 'x.mp4', size: 3 * 1024 * 1024 * 1024 }).ok, 'over 2GB rejected');
const a2 = R('save', A2(), 'Assignments', { courseId: R('save', A2(), 'Courses', { name: 'วิชาลบ' }).data.id, title: 'งานลบ', dueAt: '2099-01-01T10:00', maxScore: 5, type: 'สรุปเนื้อหา' }).data;
const up1 = R('uploadFile', A2(), { name: 'a.pdf', data: Buffer.from('x').toString('base64'), folder: 'สรุปเนื้อหา/ไฟล์จากครู' }).data;
const up2 = R('uploadFile', A2(), { name: 'b.pdf', data: Buffer.from('y').toString('base64'), folder: 'สรุปเนื้อหา/ไฟล์จากครู' }).data;
ok(DB.files[up1.id].folder.endsWith('สรุปเนื้อหา/ไฟล์จากครู'), 'teacher folder');
R('save', A2(), 'Assignments', { id: a2.id, attachments: [up1, up2] });
R('save', A2(), 'Assignments', { id: a2.id, attachments: [up2] });
ok(!DB.files[up1.id] && DB.files[up2.id], 'removed attachment purged');
R('remove', A2(), 'Assignments', a2.id); ok(!DB.files[up2.id], 'delete purges files');
const up3 = R('uploadFile', A2(), { name: 'c.pdf', data: 'eA==' }).data; R('discardUploads', T2(), [up3.id]); ok(DB.files[up3.id], 'cannot discard others file');
R('discardUploads', A2(), [up3.id]); ok(!DB.files[up3.id], 'discard own upload');
const bt = R('batch', A2(), [['list', ['Courses']], ['listUsers', []], ['nope', []]]); ok(bt.ok && bt.data[0].ok && bt.data[1].ok && !bt.data[2].ok, 'batch');
ok(R('batch', T2(), [['listUsers', []]]).data[0].code === 'FORBIDDEN', 'batch rbac');
R('saveSettings', A2(), { config: { assignmentTypes: 'การบ้าน, ใบงาน,โครงงาน,การบ้าน' } }); ok(R('bootstrap', null).data.config.assignmentTypes === 'การบ้าน,ใบงาน,โครงงาน', 'assignment types');
// cache consistency
ctx.__clearCache(); const n1 = R('listUsers', A2()).data.length; R('importStudents', A2(), [{ studentCode: '70001', fullName: 'แคช ทดสอบ' }]); ok(R('listUsers', A2()).data.length === n1 + 1, 'cache invalidated on write');
// backup / triggers / daily
ok(R('backupNow', A).ok && R('listBackups', A).data.length === 1, 'backup');
ok(R('installTriggers', A).ok, 'triggers'); ctx.dailyJob(); ok(true, 'daily');
ok(R('auditLog', A, {}).data.total > 10, 'audit');
ok(R('logout', A).ok && R('me', A).code === 'AUTH', 'logout');
console.log(`backend tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
