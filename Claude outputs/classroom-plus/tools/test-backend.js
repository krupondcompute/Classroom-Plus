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
ok(r.ok && r.data.user.mustChangePassword === 'false' && r.data.user.role === 'admin' && !r.data.user.passHash, 'admin login');
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
r = R('changeCredentials', A, { currentPassword: 'admin123', username: 'admin', newPassword: 'newpass123' }); ok(r.ok && r.data.mustChangePassword === 'false', 'change creds');
ok(R('login', null, { mode: 'admin', username: 'admin', password: 'newpass123' }).ok, 'new creds login');
r = R('importStudents', A, [{ studentCode: '11111', prefix: 'นาย', fullName: 'นำเข้า หนึ่ง', grade: 'ม.1' }, { studentCode: '11111', fullName: 'ซ้ำ' }, { studentCode: 'abc', fullName: 'x' }]);
ok(r.ok && r.data.added === 1 && r.data.skipped.length === 2, 'import');
r = R('forgotCode', null, { fullName: 'เด็กหญิงสมหญิง  รักเรียน' }); ok(r.ok && r.data[0].studentCode === '54321', 'forgot code by name only');
ok(!R('forgotCode', null, { fullName: 'ไม่มี ในระบบ' }).ok, 'forgot code unknown');
// admin signup w/ approval
R('saveSettings', A, { config: { requireApproval: 'true' } });
r = R('registerAdmin', null, { prefix: 'นาง', fullName: 'ครู ใหม่', birthDate: '1990-01-01', username: 'kru.new', password: 'abcdefgh', confirm: 'abcdefgh', consent: true });
ok(r.ok && r.data.pending, 'pending admin');
ok(!R('login', null, { mode: 'admin', username: 'kru.new', password: 'abcdefgh' }).ok, 'pending cannot login');
// cascade delete course
r = R('remove', A, 'Courses', cid); ok(r.ok && r.data.Lessons === 3 && r.data.Submissions === 1, 'cascade ' + JSON.stringify(r.data));
// throttle
const T2v = R('login', null, { mode: 'student', studentCode: '60001' }).data.token, A2v = R('login', null, { mode: 'admin', username: 'admin', password: 'newpass123' }).data.token;
function T2() { return T2v; } function A2() { return A2v; }
for (let i = 0; i < 5; i++) R('login', null, { mode: 'admin', username: 'admin', password: 'x' });
ok(R('login', null, { mode: 'admin', username: 'admin', password: 'newpass123' }).code === 'THROTTLE', 'throttle');
// multi grade/room targeting
const mc1 = R('save', A2(), 'Courses', { name: 'หลายชั้น', grade: 'ม.6,ม.2', room: '' }).data;
ok(R('listCourses', T2()).data.some(c => c.id === mc1.id), 'multi-grade course visible to ม.6');
const ma = R('save', A2(), 'Assignments', { courseId: mc1.id, title: 'เฉพาะห้อง 9', dueAt: '2099-01-01T10:00', maxScore: 5, grade: 'ม.6', room: '9' }).data;
ok(!R('listAssignments', T2()).data.some(a => a.id === ma.id), 'assignment room targeting hides from room 3');
R('save', A2(), 'Assignments', { id: ma.id, room: '3,9' }); ok(R('listAssignments', T2()).data.some(a => a.id === ma.id), 'assignment multi-room visible');
ok(R('listSubmissions', A2(), ma.id).data.rows.length === 1, 'submission roster follows targeting');
// group work
const g2 = R('registerStudent', null, { prefix: 'นาย', fullName: 'เพื่อน กลุ่ม', birthDate: '2008-02-02', grade: 'ม.6', room: '3', studentCode: '60002', consent: true }).data.token;
const ga = R('save', A2(), 'Assignments', { courseId: mc1.id, title: 'โครงงานกลุ่ม', dueAt: '2099-01-01T10:00', maxScore: 20, type: 'งานกลุ่ม', grade: 'ม.6' }).data;
const cand = R('groupCandidates', T2(), ga.id, 'ม.6', '3'); ok(cand.ok && cand.data.length === 1, 'group candidates ' + JSON.stringify(cand).slice(0, 150));
const gs = R('submitWork', T2(), ga.id, { text: 'งานกลุ่ม', members: [cand.data[0].id] }); ok(gs.ok && gs.data.memberList.length === 1, 'group submit');
const seen = R('listAssignments', g2).data.find(a => a.id === ga.id); ok(seen && seen.sub && !seen.sub.isLeader && seen.status === 'ontime', 'member sees group work');
ok(!R('submitWork', g2, ga.id, { text: 'แยกส่ง' }).ok, 'member cannot submit separately');
ok(R('groupCandidates', T2(), ga.id, '', '').data.length === 1, 'leader still sees own member');
const gl = R('listSubmissions', A2(), ga.id).data.rows; ok(gl.filter(r => r.sub).length === 2 && gl.some(r => r.group === 'member'), 'grade view shows group');
R('gradeSubmission', A2(), gs.data.id, 18, 'ดี'); ok(R('listAssignments', g2).data.find(a => a.id === ga.id).sub.score === '18', 'member gets same score');
ok(R('save', A2(), 'Categories', { code: 'ว21102', name: 'วิทยาการคำนวณ' }).data.code === 'ว21102', 'category code');
// classNo + menus + theme
ok(R('updateProfile', T2(), { classNo: '07' }).data.classNo === '7', 'classNo');
ok(!R('saveSettings', A2(), { config: { themeColor: 'red' } }).ok, 'bad color');
R('saveSettings', A2(), { config: { themeColor: '#16a34a', studentMenus: JSON.stringify({ hidden: ['search', 'home'], custom: [{ name: 'แบบฟอร์ม', url: 'https://forms.gle/x', icon: 'fa-list' }, { name: 'bad', url: 'javascript:1' }] }) } });
const mc = JSON.parse(R('bootstrap', null).data.config.studentMenus); ok(mc.hidden.join() === 'search' && mc.custom.length === 1 && R('bootstrap', null).data.config.themeColor === '#16a34a', 'menus/theme config');
// chunked upload + folders + purge
const DB = ctx.__shimDB();
const st = R('uploadStart', T2(), { name: 'big.mp4', mime: 'video/mp4', size: 20 * 1024 * 1024, folder: 'การบ้าน' });
ok(st.ok && st.data.chunk === 16 * 1024 * 1024, 'upload start ' + st.error);
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

/* ===== v4.6: บทบาท / แจ้งเตือน / แบบทดสอบ / ผลการเรียน (ข้อมูลสมมติทั้งหมด) ===== */
const AD = R('login', null, { mode: 'admin', username: 'admin', password: 'newpass123' }).data.token;
ok(R('listUsers', AD).data.filter(u => u.role === 'admin').length === 1, 'single admin');
ok(R('listUsers', AD).data.find(u => u.username === 'kru.a').role === 'teacher', 'promote -> teacher');
const KA = R('login', null, { mode: 'admin', username: 'kru.a', password: 'password1' }).data.token;
ok(R('listUsers', KA).ok && R('getSettings', KA).code === 'FORBIDDEN' && R('deleteUser', KA, 'x').code === 'FORBIDDEN', 'teacher limited admin pages');
ok(R('saveUser', KA, { role: 'teacher', prefix: 'นาย', fullName: 'แอบ เพิ่มครู', username: 'sneaky', password: 'pass123' }).ok === false, 'teacher cannot create teacher');
ok(R('saveUser', KA, { prefix: 'ด.ช.', fullName: 'ครูเพิ่ม นักเรียน', studentCode: '81111', grade: 'ม.6', room: '3' }).ok, 'teacher adds student');
const kc = R('save', KA, 'Courses', { name: 'วิชาครูเอ', code: 'ท99001', grade: 'ม.6', room: '3' }).data;
ok(kc.ownerId && R('list', KA, 'Courses').data.every(c => c.ownerId === kc.ownerId), 'teacher sees own courses only');
ok(R('list', AD, 'Courses').data.length > R('list', KA, 'Courses').data.length, 'admin sees all');
ok(R('save', KA, 'Lessons', { courseId: mc1.id, title: 'แอบเพิ่ม' }).code === 'FORBIDDEN', 'teacher cannot write others course');
ok(R('listSubmissions', KA, ga.id).code === 'FORBIDDEN', 'teacher cannot grade others');
ok(R('adminDashboard', KA).data.cards.courses === 1 && R('adminDashboard', KA).data.role === 'teacher', 'teacher dashboard scoped');
ok(!R('setRole', AD, R('listUsers', AD).data.find(u => u.username === 'admin').id, 'student', { studentCode: '99999' }).ok, 'admin role locked');
ok(/^ภาคเรียนที่|^ปิดภาคเรียนที่/.test(R('bootstrap', null).data.term.label), 'term label');
ok(R('classSummary', AD).data.classes.some(c => c.grade === 'ม.6' && c.room === '3' && c.students >= 2), 'classes synced from users');
// แจ้งเตือนงานค้าง + อ่านทีละรายการ
const ka = R('save', KA, 'Assignments', { courseId: kc.id, title: 'ใบงานครูเอ', dueAt: '2099-01-01T10:00', maxScore: 10 }).data;
let nt = R('notifications', T2()).data; ok(nt.some(n => n.link === 'assignment:' + ka.id && n.read === 'false'), 'pending notification');
R('markRead', T2(), [nt[0].id]); ok(R('notifications', T2()).data.find(n => n.id === nt[0].id).read === 'true', 'mark one read');
R('markRead', T2()); ok(R('notifications', T2()).data.every(n => n.read === 'true'), 'mark all read (stays read)');
// แบบทดสอบ
const qz = { style: 'th', questions: [{ id: 'q1', type: 'mc', q: '1+1', options: ['1', '2', '3', '4'], answer: 1, points: 2 },
  { id: 'q2', type: 'tf', q: 'ฟ้าสีฟ้า', answer: 'true', points: 1 }, { id: 'q3', type: 'match', q: 'จับคู่', pairs: [{ l: 'แมว', r: 'cat' }, { l: 'หมา', r: 'dog' }], points: 2 },
  { id: 'q4', type: 'text', q: 'อธิบาย', answer: '', points: 5 }] };
const qa = R('save', KA, 'Assignments', { courseId: kc.id, title: 'แบบทดสอบ', dueAt: '2099-01-01T10:00', maxScore: 1, quiz: qz }); ok(qa.ok && qa.data.maxScore === '10', 'quiz total auto ' + qa.error);
ok(!R('save', KA, 'Assignments', { courseId: kc.id, title: 'x', dueAt: '2099-01-01T10:00', quiz: { questions: [{ type: 'mc', q: 'a', options: ['x', 'y'], points: 1 }] } }).ok, 'quiz needs answer');
const sq = R('listAssignments', T2()).data.find(a => a.id === qa.data.id); const pq = JSON.parse(sq.quiz);
ok(pq.questions[0].answer === undefined && pq.questions[2].pairs === undefined && pq.questions[2].right.length === 2, 'answers hidden from student');
let qs = R('submitWork', T2(), qa.data.id, { answers: { q1: 1, q2: 'false', q3: { 0: 'cat', 1: 'cat' }, q4: 'เพราะว่า' } });
ok(qs.ok && qs.data.score === '' && JSON.parse(qs.data.autoScore).q1 === 2 && JSON.parse(qs.data.autoScore).q3 === 1, 'autograde partial ' + qs.error);
ok(R('gradeSubmission', KA, qs.data.id, '', 'ok', { q4: 4 }).data.score === '7', 'manual text item -> total');
// ---------- ครูร่วมสอน ----------
const users2 = R('listUsers', AD).data, kaId = users2.find(u => u.username === 'kru.a').id;
R('saveUser', AD, { role: 'teacher', prefix: 'นาง', fullName: 'ครู บี', username: 'kru.b', password: 'pass123' });
const KB = R('login', null, { mode: 'admin', username: 'kru.b', password: 'pass123' }).data.token;
ok(R('list', KB, 'Courses').data.length === 0, 'teacher B sees nothing');
ok(R('save', KA, 'Courses', { id: kc.id, teachers: R('listTeachers', KA).data.filter(t => t.name.includes('ครู บี')).map(t => t.id).join(',') }).ok, 'add co-teacher');
ok(R('list', KB, 'Courses').data.some(c => c.id === kc.id) && R('save', KB, 'Assignments', { courseId: kc.id, title: 'งานครูบี', dueAt: '2099-01-01T10:00', maxScore: 5 }).ok, 'co-teacher can assign');
ok(R('listSubmissions', KB, qa.data.id).ok, 'co-teacher can grade');
ok(R('remove', KB, 'Courses', kc.id).code === 'FORBIDDEN', 'co-teacher cannot delete course');
ok(!R('save', KB, 'Courses', { id: kc.id, teachers: '' }).data.teachers === false || R('list', KA, 'Courses').data.find(c => c.id === kc.id).teachers !== '', 'co-teacher cannot change teacher list');
// ---------- แชท ----------
const S1 = R('importStudents', AD, [{ studentCode: '80001', prefix: 'ด.ช.', fullName: 'ทดสอบ หนึ่ง', grade: 'ม.6', room: '3', classNo: '1' }, { studentCode: '80002', prefix: 'ด.ญ.', fullName: 'ทดสอบ สอง', grade: 'ม.6', room: '3', classNo: '2' }, { studentCode: '80003', fullName: 'ต่าง ห้อง', grade: 'ม.1', room: '1' }]);
const s1 = R('login', null, { mode: 'student', studentCode: '80001' }).data.token, s2 = R('login', null, { mode: 'student', studentCode: '80002' }).data.token, s3 = R('login', null, { mode: 'student', studentCode: '80003' }).data.token;
const cs1 = R('chatContacts', s1).data;
ok(cs1.people.some(p => p.name.includes('ทดสอบ สอง')) && !cs1.people.some(p => p.name.includes('ต่าง ห้อง')) && cs1.people.some(p => p.role === 'admin'), 'student contacts = classmates + staff');
const id2 = cs1.people.find(p => p.name.includes('ทดสอบ สอง')).id, id3 = R('chatContacts', AD).data.people.find(p => p.name.includes('ต่าง ห้อง')).id;
ok(R('chatOpen', s1, { type: 'dm', target: id3 }).code === 'FORBIDDEN', 'student cannot DM other class');
const dm = R('chatOpen', s1, { type: 'dm', target: id2 }).data; ok(dm.id.startsWith('dm:'), 'open dm');
ok(R('chatSend', s1, dm.id, 'สวัสดี').ok && R('chatUnread', s2).data === 1, 'dm unread');
ok(R('chatMessages', s2, dm.id, '').data[0].text === 'สวัสดี' && R('chatUnread', s2).data === 0, 'read clears unread');
ok(R('chatMessages', s3, dm.id, '').code === 'FORBIDDEN', 'outsider cannot read dm');
const cls = R('chatList', s1).data.find(r => r.type === 'class'); ok(cls && cls.id === 'cls:ม.6|3', 'own class room listed');
ok(R('chatSend', s1, cls.id, 'ห้องเรา').ok && R('chatSend', s3, cls.id, 'แอบ').code === 'FORBIDDEN' && R('chatMessages', KA, cls.id, '').data.length === 1, 'class chat access');
const tm = R('chatCreateTeam', s1, 'ทีมโครงงาน', [id2]); ok(tm.ok && R('chatList', s2).data.some(r => r.id === tm.data.id), 'team chat');
ok(R('chatCreateTeam', s1, 'x', [id3]).ok === false, 'team member must be contact');
ok(R('chatSend', AD, R('chatOpen', AD, { type: 'dm', target: id3 }).data.id, 'จากแอดมิน').ok && R('chatUnread', s3).data === 1, 'admin dm anyone');
const after = R('chatMessages', s1, dm.id, '').data.pop().key; R('chatSend', s2, dm.id, 'ตอบ'); ok(R('chatMessages', s1, dm.id, after).data.length === 1, 'incremental fetch');
ok(R('saveStudentMenus', KA, JSON.stringify({ hidden: [], custom: [{ name: 'ลิงก์ครู', url: 'https://example.com' }], order: [] })).ok && JSON.parse(R('bootstrap', null).data.config.studentMenus).custom[0].name === 'ลิงก์ครู', 'teacher saves student menus');
ok(R('saveStudentMenus', s1, '{}').code === 'FORBIDDEN', 'student cannot save menus');
const us = R('uploadStart', KA, { name: 'a.mp4', mime: 'video/mp4', size: 1000, origin: 'https://example.github.io' }); ok(us.ok && us.data.direct, 'direct upload session');
// ---------- v4.8 ----------
// ครูลืมรหัสผ่าน
R('updateProfile', KA, { birthDate: '1990-05-05', contacts: [{ type: 'phone', value: '081-234-5678' }, { type: 'line', value: 'kru.a' }] });
ok(!R('resetStaffPassword', null, { fullName: 'ทดสอบ ระบบดี', birthDate: '1990-05-05', password: 'newpw1', confirm: 'newpw1' }).ok, 'reset wrong name');
const kaName = R('listUsers', AD).data.find(u => u.username === 'kru.a').fullName;
ok(R('resetStaffPassword', null, { fullName: kaName, birthDate: '1990-05-05', password: 'newpw1', confirm: 'newpw1' }).data.username === 'kru.a', 'staff reset password');
ok(R('login', null, { mode: 'admin', username: 'kru.a', password: 'newpw1' }).ok, 'login after reset');
const KA2 = R('login', null, { mode: 'admin', username: 'kru.a', password: 'newpw1' }).data.token;
ok(!R('updateProfile', KA2, { contacts: [{ type: 'email', value: 'bad' }] }).ok, 'contact validation');
// ผู้ดูแลระบบร่วม
const kaId2 = R('listUsers', AD).data.find(u => u.username === 'kru.a').id;
ok(R('setCoAdmin', KA2, kaId2, true).code === 'FORBIDDEN', 'teacher cannot self-promote');
ok(R('setCoAdmin', AD, kaId2, true).ok, 'grant co-admin');
const KA3 = R('login', null, { mode: 'admin', username: 'kru.a', password: 'newpw1' }).data.token;
ok(R('getSettings', KA3).ok && R('list', KA3, 'Courses').data.length === R('list', AD, 'Courses').data.length, 'co-admin sees all');
ok(R('setCoAdmin', KA3, kaId2, false).code === 'FORBIDDEN', 'co-admin cannot change co-admin');
// นักเรียน: ติดต่อครู
const mt = R('myTeachers', s1).data; ok(mt.some(t => t.role === 'admin') && mt.every(t => !t.contacts), 'my teachers list (no contacts)');
const kaT = mt.find(t => t.id === kaId2); ok(kaT, 'course teacher listed');
ok(R('staffContact', s1, kaId2, '99999').code !== undefined && !R('staffContact', s1, kaId2, '00000').ok, 'contact needs code');
ok(R('staffContact', s1, kaId2, '80001').data.contacts.some(c => c.type === 'line'), 'contact with code');
// แบบทดสอบตอบหลายข้อ + สื่อ
const qm = R('save', KA3, 'Assignments', { courseId: kc.id, title: 'หลายคำตอบ', dueAt: '2099-01-01T10:00', quiz: { questions: [{ id: 'm1', type: 'mc', multi: true, q: 'จำนวนคู่ x²', options: ['2', '3', '4', '5'], answer: [0, 2], points: 2, link: 'https://example.com', image: 'https://lh3.googleusercontent.com/d/abc' }] } });
ok(qm.ok && JSON.parse(qm.data.quiz).questions[0].multi, 'multi answer quiz');
const pq2 = JSON.parse(R('listAssignments', s1).data.find(a => a.id === qm.data.id).quiz).questions[0]; ok(pq2.multi && pq2.answer === undefined && pq2.link, 'multi public no answer');
ok(R('submitWork', s1, qm.data.id, { answers: { m1: ['0', '1', '2'] } }).data.score === '1', 'multi partial scoring (2 right - 1 wrong)');
// เมนูลิงก์ตามรายวิชา/ชั้น/ห้อง
R('saveStudentMenus', KA3, JSON.stringify({ hidden: [], custom: [{ name: 'เฉพาะ ม.6', url: 'https://x.com', grades: ['ม.6'], rooms: ['3'], courseIds: [kc.id] }], order: [] }));
ok(JSON.parse(R('bootstrap', null).data.config.studentMenus).custom[0].grades[0] === 'ม.6', 'menu targeting saved');
ok(R('me', s1).data.user.courseIds.indexOf(kc.id) >= 0, 'student courseIds');
// ดูข้อมูลย้อนหลังตามภาคเรียน
const dNow = R('adminDashboard', AD).data, dOld = R('adminDashboard', AD, { year: '2550', term: '1' }).data;
ok(dOld.past && dOld.cards.courses <= dNow.cards.courses && dOld.days.length === 14 && dOld.days[13] === '2007-10-20', 'dashboard past term');
ok(R('adminDashboard', AD, { year: 'x', term: '9' }).data.view === null, 'dashboard bad view ignored');
ok(R('studentHome', s1, { year: '2550', term: '2' }).data.courses.length === 0, 'student home past term');
console.log(`backend tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
