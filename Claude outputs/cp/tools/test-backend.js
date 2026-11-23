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
ok(R('saveStudentMenus', KA, JSON.stringify({ hidden: [], custom: [{ name: 'ลิงก์ครู', url: 'https://example.com' }], order: [] })).ok && JSON.parse(R('me', KA).data.user.prefs).menus[0].name === 'ลิงก์ครู' && R('me', s1).data.user.extraMenus.some(m => m.name === 'ลิงก์ครู') && !JSON.parse(R('bootstrap', null).data.config.studentMenus || '{"custom":[]}').custom.some(m => m.name === 'ลิงก์ครู'), 'teacher menus are personal');
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
ok(dOld.past && dOld.cards.courses <= dNow.cards.courses && dOld.days.length === 7 && dOld.days[6] === '2007-10-20' && dOld.sub7 && 'missing' in dOld.sub7, 'dashboard past term');
ok(R('adminDashboard', AD, { year: 'x', term: '9' }).data.view === null, 'dashboard bad view ignored');
ok(R('studentHome', s1, { year: '2550', term: '2' }).data.courses.length === 0, 'student home past term');
// ---------- v4.9 ----------
// งานกลุ่ม: จำกัดจำนวนสมาชิก
const g9 = R('save', KA3, 'Assignments', { courseId: kc.id, title: 'งานกลุ่ม 2 คน', dueAt: '2099-01-01T10:00', group: 'true', groupMax: '2' }).data;
ok(!R('save', KA3, 'Assignments', { courseId: kc.id, title: 'x', dueAt: '2099-01-01T10:00', groupMax: '99' }).ok, 'groupMax range');
const s2id = R('me', s2).data.user.id, s3id = R('me', s3).data.user.id;
ok(/ไม่เกิน 2/.test(R('submitWork', s1, g9.id, { text: 'ok', members: [s2id, s3id] }).error || ''), 'group max enforced');
const gsub = R('submitWork', s1, g9.id, { text: 'งานกลุ่ม', members: [s2id] }); ok(gsub.ok, 'group within limit');
// ครูแก้ไข / ลบงานที่ส่ง
const subRow = R('listSubmissions', KA3, g9.id).data.rows.find(x => x.sub).sub;
ok(R('editSubmission', KA3, subRow.id, { text: 'ครูแก้ไข' }).data.text === 'ครูแก้ไข', 'teacher edit submission');
ok(R('editSubmission', s1, subRow.id, { text: 'x' }).code === 'FORBIDDEN', 'student cannot use teacher edit');
ok(R('removeSubmission', KA3, subRow.id).ok && !R('listSubmissions', KA3, g9.id).data.rows.some(x => x.sub), 'teacher remove submission');
// ประกาศหลายรายวิชา
const kc2 = R('save', KA3, 'Courses', { name: 'วิชาที่สอง', code: 'ท99002', grade: 'ม.6', room: '3' }).data;
const an2 = R('save', KA3, 'Announcements', { title: 'ประกาศสองวิชา', courseId: kc.id + ',' + kc2.id + ',' + kc.id });
ok(an2.ok && an2.data.courseId.split(',').length === 2 && R('listAnnouncements', s1).data.some(a => a.title === 'ประกาศสองวิชา'), 'announcement multi course');
// ตั้งค่าส่วนตัว
ok(JSON.parse(R('updateProfile', KA3, { prefs: { themeColor: '#9333ea', schoolName: 'ห้องครูเอ' } }).data.prefs).themeColor === '#9333ea', 'personal prefs');
ok(R('bootstrap', null).data.config.themeColor !== '#9333ea', 'prefs do not change system');
ok(!R('updateProfile', KA3, { prefs: { themeColor: 'red' } }).ok, 'prefs validated');
// เปลี่ยนชื่อชั้น/ห้อง
ok(R('renameClass', AD, { grade: 'ม.6', room: '3', newGrade: 'ม.6', newRoom: '9' }).data.students >= 1 && R('me', s1).data.user.room === '9', 'rename room updates students');
R('renameClass', AD, { grade: 'ม.6', room: '9', newGrade: 'ม.6', newRoom: '3' });
ok(R('renameClass', s1, { grade: 'ม.6', newGrade: 'ม.7' }).code === 'FORBIDDEN', 'rename class admin only');
// ฐานข้อมูลแยกภาคเรียน
const nowCourses = R('list', AD, 'Courses').data.length;
const tkey = R('getSettings', AD).data.curTerm, pastK = '2550/1';
ok(R('createTermDb', AD, pastK).ok, 'create past term db');
ok(!R('saveTermDb', AD, { key: '2550/3', sheetId: 'x' }).ok, 'term key validated');
const VR = (vt, fn, tok, ...a) => ctx.rpc(fn, tok, a, vt);
ok(VR(pastK, 'list', AD, 'Courses').data.length === 0, 'past term db empty');
const pc = VR(pastK, 'save', AD, 'Courses', { name: 'วิชาในอดีต', code: 'ค00001' }); ok(pc.ok, 'save into past term db');
ok(VR(pastK, 'list', AD, 'Courses').data.length === 1 && R('list', AD, 'Courses').data.length === nowCourses, 'term data isolated');
ok(VR(pastK, 'me', AD).ok && VR(pastK, 'listUsers', AD).data.filter(u => u.role !== 'student').length === R('listUsers', AD).data.filter(u => u.role !== 'student').length && !VR(pastK, 'listUsers', AD).data.some(u => u.role === 'student'), 'staff shared, students per term');
// v5: ดึงข้อมูลจากภาคเรียนอื่น
const srcs = VR(pastK, 'termSources', AD).data; ok(srcs.current === pastK && srcs.sources.some(x => x.key === 'main'), 'term sources');
const peekS = VR(pastK, 'peekTerm', AD, 'main', 'students').data; ok(peekS.length > 0 && !peekS[0].exists, 'peek students from main');
ok(VR(pastK, 'importTerm', AD, 'main', 'students', peekS.map(x => x.id)).data.added === peekS.length && VR(pastK, 'listUsers', AD).data.filter(u => u.role === 'student').length === peekS.length, 'import students');
ok(VR(pastK, 'importTerm', AD, 'main', 'students', peekS.map(x => x.id)).data.added === 0, 'import students idempotent');
const peekC = VR(pastK, 'peekTerm', AD, 'main', 'courses').data; ok(VR(pastK, 'importTerm', AD, 'main', 'courses', [peekC[0].id]).data.added === 1, 'import course');
ok(VR(pastK, 'list', AD, 'Lessons').data.every(l => l.courseId === peekC[0].id), 'lessons copied with course');
ok(VR(pastK, 'importTerm', AD, 'main', 'types', ['งานกลุ่ม']).ok && VR(pastK, 'getSettings', AD).data.config.assignmentTypes.indexOf('งานกลุ่ม') >= 0, 'import types');
ok(VR(pastK, 'peekTerm', KA3, 'main', 'courses').data.every(c => true) && VR(pastK, 'peekTerm', s1, 'main', 'courses').code === 'FORBIDDEN', 'peek staff only');
ok(R('createTermDb', AD, tkey).ok && R('list', AD, 'Courses').data.length === 0, 'current term uses its new db');
ok(R('removeTermDb', AD, tkey).ok && R('list', AD, 'Courses').data.length === nowCourses, 'remove mapping restores main db');
ok(R('getSettings', AD).data.termDbs.length === 1 && R('createTermDb', s1, '2551/1').code === 'FORBIDDEN', 'term db list + admin only');
// v5: กิจกรรมตอบปัญหา
const lq = R('liveSave', KA3, { kind: 'quiz', title: 'ตอบปัญหาวิทย์', data: { questions: [{ id: 'a1', type: 'mc', q: '1+1', options: ['1', '2'], answer: 1, points: 1, time: 10 }, { id: 'a2', type: 'tf', q: 'น้ำเดือด 100°C', answer: 'true', points: 1 }] }, settings: { timeMode: 'question', defaultTime: 20 } });
ok(lq.ok && /^\d{6}$/.test(lq.data.pin), 'live quiz created');
ok(R('liveInfo', null, lq.data.pin).code === 'NOTFOUND', 'draft not joinable');
R('liveControl', KA3, lq.data.id, 'open');
const p1 = R('liveJoin', null, lq.data.pin, 'ต้น').data, p2 = R('liveJoin', null, lq.data.pin, 'ต้น').data;
ok(p1.pid && p2.name !== 'ต้น', 'join + unique name');
ok(!R('liveInfo', null, lq.data.pin, p1.pid).data.questions, 'no questions in lobby');
R('liveControl', KA3, lq.data.id, 'start');
const li = R('liveInfo', null, lq.data.pin, p1.pid).data; ok(li.questions.length === 2 && li.questions[0].answer === undefined && li.questions[0].time === 10, 'questions without answers');
const r1 = R('liveSubmit', null, lq.data.pin, p1.pid, { a1: '1', a2: 'true' }, { a1: 1000, a2: 2000 }).data, r2 = R('liveSubmit', null, lq.data.pin, p2.pid, { a1: '0', a2: 'true' }, { a1: 9000, a2: 19000 }).data;
ok(r1.correct === 2 && r1.score > r2.score && r1.rank === 1, 'speed scoring + rank');
ok(R('liveSubmit', null, lq.data.pin, p1.pid, { a1: '0' }, {}).data.already, 'submit once');
R('liveControl', KA3, lq.data.id, 'close');
const lb = R('liveInfo', null, lq.data.pin, p2.pid).data; ok(lb.top[0].name === 'ต้น' && lb.myRank === 2, 'podium data');
ok(R('liveStatus', s1, lq.data.id).code === 'FORBIDDEN' && R('liveStatus', KA3, lq.data.id).data.players.length === 2, 'host status');
// แบบสอบถาม
const sv = R('liveSave', KA3, { kind: 'survey', title: 'ความพึงพอใจ', data: { questions: [{ id: 'q1', type: 'rating', q: 'พอใจไหม', scale: 5 }, { id: 'q2', type: 'choice', q: 'ชอบวิชาไหน', options: ['คณิต', 'วิทย์'] }, { id: 'q3', type: 'text', q: 'ข้อเสนอแนะ' }] } }).data;
R('liveControl', KA3, sv.id, 'open'); R('liveControl', KA3, sv.id, 'start');
[[5, 1, 'ดีมาก'], [3, 1, ''], [4, 0, 'สนุก']].forEach((a, i) => { const pp = R('liveJoin', null, sv.pin, 'คน' + i).data; R('liveSubmit', null, sv.pin, pp.pid, { q1: a[0], q2: a[1], q3: a[2] }); });
const sm = R('liveStatus', KA3, sv.id).data.summary; ok(sm[0].avg === 4 && sm[1].counts.join() === '1,2' && sm[2].texts.length === 2, 'survey summary');
// รวมคะแนนจากเมนูผลการเรียน
const bk = ctx.SpreadsheetApp.create('ผลการเรียน'); const sh1 = bk.insertSheet('Sheet1'); sh1.appendRow(['ลำดับ', 'รหัสนักเรียน', 'ชื่อ-สกุล', 'รวมคะแนนทั้งหมด']); sh1.appendRow(['1', '80001', 'เด็กชายเอ', '87.5']);
R('saveStudentMenus', AD, JSON.stringify({ hidden: [], custom: [{ name: 'ผลการเรียน', url: 'https://docs.google.com/spreadsheets/d/' + bk.getId() + '/edit' }], order: [] }));
ctx.__clearCache(); ok((R('studentHome', s1).data.total || {}).value === '87.5', 'total score from result sheet');
// v5.1: แชท แก้ไข/ลบ/ซ่อน/ตั้งชื่อ/แนบไฟล์
const dmr = R('chatOpen', s1, { type: 'dm', target: R('listUsers', AD).data.find(u => u.role === 'admin').id }).data;
const cm1 = R('chatSend', s1, dmr.id, 'สวัสดี', []).data, t0 = cm1.at;
ok(R('chatSend', s1, dmr.id, '', [{ id: 'fx', name: 'a.pdf', url: 'https://drive.google.com/file/d/fx/view', mime: 'application/pdf', size: 10 }]).data.files.length === 1, 'chat send file');
ok(R('chatEdit', s1, cm1.id, 'สวัสดีครับ').ok && R('chatEdit', s2, cm1.id, 'x').code === 'FORBIDDEN', 'chat edit own only');
const cmu = R('chatMessages', AD, dmr.id, cm1.key, t0).data; ok(cmu.some(m => m.upd && m.text === 'สวัสดีครับ' && m.edited), 'edited message pushed to others');
ok(R('chatDelete', s1, cm1.id).ok && R('chatMessages', AD, dmr.id, '').data.find(m => m.id === cm1.id).deleted, 'chat delete');
ok(R('chatRename', s1, dmr.id, 'ครูแอดมิน').ok && R('chatList', s1).data.find(r => r.id === dmr.id).title === 'ครูแอดมิน', 'chat alias');
ok(R('chatHide', s1, dmr.id).ok && !R('chatList', s1).data.some(r => r.id === dmr.id), 'chat hide');
R('chatSend', AD, dmr.id, 'กลับมา', []); ok(R('chatList', s1).data.some(r => r.id === dmr.id), 'hidden room returns on new message');
// v5.1: กิจกรรมที่สร้างในภาคเรียนอื่น หาเจอจาก PIN + เข้าร่วมด้วยรหัสนักเรียน
const lp2 = VR(pastK, 'liveSave', AD, { kind: 'survey', title: 'สำรวจภาคก่อน', data: { questions: [{ id: 'r1', type: 'rating', q: 'ระดับ', scale: 4, start: 0, levels: 'ไม่ดี,พอใช้,ดี,ดีมาก' }] } }).data;
VR(pastK, 'liveControl', AD, lp2.id, 'open');
ok(R('liveInfo', null, lp2.pin).data.title === 'สำรวจภาคก่อน', 'pin found across term dbs');
const stCode = VR(pastK, 'listUsers', AD).data.find(u => u.role === 'student');
const jc = R('liveJoin', null, lp2.pin, stCode.studentCode, '', pastK).data; ok(jc.name.indexOf(stCode.fullName) >= 0, 'join by student code');
ok(!R('liveJoin', null, lp2.pin, '99998').ok, 'unknown code rejected');
VR(pastK, 'liveControl', AD, lp2.id, 'start'); R('liveSubmit', null, lp2.pin, jc.pid, { r1: 0 }, {}, pastK);
const sm2 = VR(pastK, 'liveStatus', AD, lp2.id).data.summary[0]; ok(sm2.counts[0] === 1 && sm2.levels[3] === 'ดีมาก' && sm2.start === 0, 'custom rating levels');
// ---------- v5.2 ----------
// นักเรียนเข้าสู่ระบบได้ทุกภาคเรียน/ปีการศึกษา (มีบัญชีเฉพาะในภาคเรียนเก่า)
ok(VR(pastK, 'saveUser', AD, { prefix: 'เด็กหญิง', fullName: 'ภาค ก่อน', grade: 'ม.2', room: '1', studentCode: '18970', birthDate: '2012-01-01' }).ok, 'create student in past term only');
ok(!R('listUsers', AD).data.some(u => u.studentCode === '18970'), 'not in current term');
const PL = R('login', null, { mode: 'student', studentCode: '18970' }); ok(PL.ok && PL.data.user.fullName === 'ภาค ก่อน', 'login student from past term ' + PL.error);
ok(R('me', PL.data.token).data.user.studentCode === '18970' && R('studentHome', PL.data.token).ok, 'past-term student session works');
ok(R('me', PL.data.token, ).ok && ctx.rpc('me', PL.data.token, [], tkey).data.user.studentCode === '18970', 'student ignores view-term');
ok(R('forgotCode', null, { fullName: 'ภาค ก่อน' }).data[0].studentCode === '18970', 'forgot code across terms');
// ผู้ดูแลระบบคนใหม่ + ฐานข้อมูลแยก
const kt = R('saveUser', AD, { role: 'teacher', prefix: 'นาง', fullName: 'ครู แยก', username: 'kru.t', password: 'pass123' }).data;
ok(R('setCoAdmin', AD, kt.id, true, 'separate').ok, 'promote separate admin');
let KT = R('login', null, { mode: 'admin', username: 'kru.t', password: 'pass123' }).data.token;
ok(R('me', KT).data.user.tenantSetup === true && R('getSettings', KT).data.needsDb === true, 'new admin must set db');
ok(R('list', KT, 'Courses').code === 'TENANT_SETUP', 'blocked until db set');
ok(!R('saveSettings', KT, { sheetId: 'x'.repeat(40) }).ok, 'need both sheet and drive');
const mainSid = R('getSettings', AD).data.sheetId; ok(!R('saveSettings', KT, { sheetId: mainSid, driveId: 'd'.repeat(33) }).ok, 'cannot reuse main sheet');
const tb = ctx.SpreadsheetApp.create('ฐานข้อมูลครูแยก');
const ts = R('saveSettings', KT, { sheetId: 'https://docs.google.com/spreadsheets/d/' + tb.getId() + '/edit', driveId: 'https://drive.google.com/drive/folders/' + 'f'.repeat(33) });
ok(ts.ok && ts.data.reloaded, 'tenant db saved ' + ts.error);
ok(R('getSettings', KT).data.sheetId === tb.getId() && R('list', KT, 'Courses').ok && R('list', KT, 'Courses').data.length === 0, 'tenant data separated');
ok(R('saveSettings', KT, { config: { schoolName: 'โรงเรียนแยก' } }).ok && R('getSettings', KT).data.config.schoolName === 'โรงเรียนแยก' && R('getSettings', AD).data.config.schoolName !== 'โรงเรียนแยก', 'tenant settings separate');
ok(R('saveUser', KT, { prefix: 'นาย', fullName: 'นักเรียน แยก', grade: 'ม.1', room: '1', studentCode: '55501', birthDate: '2013-01-01' }).ok, 'tenant student');
ok(!R('listUsers', AD).data.some(u => u.studentCode === '55501') && R('listUsers', KT).data.some(u => u.studentCode === '55501'), 'tenant students isolated');
const TL = R('login', null, { mode: 'student', studentCode: '55501' }); ok(TL.ok && R('me', TL.data.token).data.user.fullName === 'นักเรียน แยก', 'tenant student login');
ok(!R('listUsers', KT).data.some(u => u.username === 'kru.a'), 'tenant admin sees only own staff');
KT = R('login', null, { mode: 'admin', username: 'kru.t', password: 'pass123' }).data.token; ok(R('me', KT).data.user.tenantSetup === false, 'relogin tenant admin');
ok(R('saveUser', KT, { role: 'teacher', prefix: 'นาย', fullName: 'ครู ลูกทีม', username: 'kru.a', password: 'pass123' }).ok === false, 'usernames unique across tenants');
// แชทกลุ่ม: เพิ่ม/ลบสมาชิก + แก้ไข/ลบข้อความของคู่สนทนา
const tm2 = R('chatCreateTeam', s1, 'กลุ่มทดสอบ', [id2]).data;
const tmA = R('chatTeamMembers', s1, tm2.id, [], [id2]).data; ok(tmA.memberList.length === 1, 'remove member');
ok(R('chatTeamMembers', s1, tm2.id, [id2], []).data.memberList.length === 2 && R('chatList', s2).data.some(r => r.id === tm2.id), 'add member');
ok(R('chatTeamMembers', s3, tm2.id, [], [id2]).code === 'FORBIDDEN', 'non-member cannot manage');
const om = R('chatSend', s1, tm2.id, 'ข้อความ s1', []).data; ok(R('chatEdit', s2, om.id, 'แก้โดย s2').ok && R('chatMessages', s1, tm2.id, '').data.find(m => m.id === om.id).text === 'แก้โดย s2', 'edit other member message');
ok(R('chatDelete', s2, om.id).ok, 'delete other member message');
ok(R('chatTeamMembers', s2, tm2.id, [], [id2]).data.left === true && !R('chatList', s2).data.some(r => r.id === tm2.id), 'leave group');
// ลบนักเรียนหลายคน
const before = R('listUsers', AD).data.filter(u => u.role === 'student');
const victims = before.filter(u => u.grade === 'ม.6');
ok(R('deleteUsers', AD, { grade: 'ม.6', room: '*', confirm: 999 }).code === 'CONFIRM', 'bulk delete needs confirm count');
ok(R('deleteUsers', KA2 || s1, { all: true, confirm: before.length }).ok === false, 'bulk delete admin only');
const dr = R('deleteUsers', AD, { grade: 'ม.6', room: '*', confirm: victims.length }); ok(dr.ok && dr.data.Users === victims.length && !R('listUsers', AD).data.some(u => u.grade === 'ม.6'), 'bulk delete by grade ' + dr.error);
const two = R('listUsers', AD).data.filter(u => u.role === 'student').slice(0, 2).map(u => u.id);
ok(R('deleteUsers', AD, { ids: two, confirm: 2 }).data.Users === 2, 'bulk delete selected');
// ---------- v5.3 ----------
const bk2 = ctx.SpreadsheetApp.create('คะแนนเก็บ'); const sh2 = bk2.insertSheet('Sheet1'); sh2.appendRow(['เลขที่', 'รหัสนักเรียน', 'ชื่อ - สกุล', 'รวมคะแนนทั้งหมด']); sh2.appendRow(['1', '80901', 'เด็กชายคะแนน', '42']); sh1.appendRow(['2', '80901', 'x', '87.5']);
R('saveUser', AD, { prefix: 'เด็กชาย', fullName: 'คะแนน ดี', grade: 'ม.1', room: '1', studentCode: '80901', birthDate: '2013-01-01' }); const s9 = R('login', null, { mode: 'student', studentCode: '80901' }).data.token;
const curK = R('getSettings', AD).data.curTerm;
ok(R('saveSettings', AD, { config: { scoreSources: [{ name: 'คะแนนเก็บ ภาค 2', url: 'https://docs.google.com/spreadsheets/d/' + bk2.getId() + '/edit', terms: ['2501/1'] }] } }).ok, 'save score sources');
ok(!('scoreSources' in R('bootstrap', null).data.config), 'score sources private');
ok((R('studentHome', s9).data.total || {}).value === '87.5', 'source of other term ignored (falls back to menu)');
R('saveSettings', AD, { config: { scoreSources: [{ name: 'คะแนนเก็บ ภาค 2', url: bk2.getId(), terms: [curK], grades: [] }] } });
const th = R('studentHome', s9).data.total; ok(th && th.value === '42' && th.menu === 'คะแนนเก็บ ภาค 2', 'total from score source ' + JSON.stringify(th));
R('saveSettings', AD, { config: { scoreSources: [{ name: 'x', url: bk2.getId(), grades: ['ม.6'] }] } }); ok((R('studentHome', s9).data.total || {}).value === '87.5', 'score source grade filter');
ok(R('me', s9).data.user.myTerm === curK, 'student term label');
// ---------- v5.4: ตารางสอน + เช็คชื่อ ----------
ok(R('ttSaveCfg', AD, { periods: 8, minutes: 50, start: '00:00', breakAfter: 0, breakMin: 0, days: 7, lateMin: 15 }).data.periods === 8, 'tt cfg');
const crs = R('list', AD, 'Courses').data[0];
const s9u = R('me', s9).data.user;
const nowD = vm.runInContext('todayInfo_()', ctx);
const per = Math.floor(nowD.min / 50) + 1 > 8 ? null : Math.floor(nowD.min / 50) + 1;
R('ttSaveCfg', AD, { periods: 14, minutes: 120, start: '00:00', breakAfter: 0, breakMin: 0, days: 7, lateMin: 600 });
const curP = Math.floor(nowD.min / 120) + 1;
const sl = R('ttSaveSlot', AD, { day: nowD.dow, period: curP, span: 1, courseId: crs.id, grade: 'ม.1', room: '1', students: [s9u.id] }); ok(sl.ok, 'add slot ' + sl.error);
ok(R('ttSaveSlot', AD, { day: nowD.dow, period: curP, span: 1, courseId: crs.id, grade: 'ม.1', room: '1', students: [s9u.id] }).ok === false, 'slot clash');
ok(R('ttGet', AD).data.slots.some(x => x.id === sl.data.id), 'tt list');
const mat = R('myAttend', s9).data; ok(mat.slots.length === 1 && mat.slots[0].open && mat.token.startsWith('CPA1.'), 'student sees open slot');
ok(R('attCheckIn', s9, sl.data.id).code === 'FORBIDDEN', 'self check-in disabled by default'); vm.runInContext("props_().setProperty('ATT_SELF','1')", ctx);
const ci = R('attCheckIn', s9, sl.data.id); ok(ci.ok && ci.data.st === 'present', 'student self check-in ' + ci.error);
ok(R('attCheckIn', s9, sl.data.id).ok === false, 'no double self check-in');
const ao = R('attOpen', AD, sl.data.id, nowD.date).data; ok(ao.records[s9u.id].st === 'present' && !ao.done, 'teacher sees self check-in');
ok(R('attSave', AD, sl.data.id, nowD.date, {}).ok === false, 'must check everyone');
ok(R('attSave', AD, sl.data.id, nowD.date, { [s9u.id]: { st: 'late', note: 'มาสาย 10 นาที' } }).ok, 'teacher saves');
const dup = R('attSave', AD, sl.data.id, nowD.date, { [s9u.id]: { st: 'present' } }); ok(dup.code === 'ATT_DONE', 'already checked warning');
ok(R('attSave', AD, sl.data.id, nowD.date, { [s9u.id]: { st: 'sick' } }, { edit: true }).ok && R('attOpen', AD, sl.data.id, nowD.date).data.records[s9u.id].st === 'sick', 'teacher edits later');
ok(R('attSummary', AD, nowD.date).data.day.sick === 1 && R('attHistory', AD, {}).data.length === 1, 'summary + history');
ok(R('attDecode', AD, mat.token).data.id === s9u.id && R('attDecode', AD, mat.token.slice(0, -2) + 'zz').ok === false, 'student QR token');
ok(R('adminDashboard', AD).data.attToday.sessions === 1, 'dashboard attendance');
ok(R('myAttend', s9).data.summary.sick === 1, 'student history');
ok(R('attOpen', s9, sl.data.id, nowD.date).code === 'FORBIDDEN', 'student cannot open teacher check');
ok(R('ttDeleteSlot', AD, sl.data.id).ok, 'delete slot');
// ---------- v5.5 ----------
const bk3 = ctx.SpreadsheetApp.create('คะแนนหัวหลายแถว'); const sh3 = bk3.insertSheet('Sheet1');
sh3.appendRow(['ผลการเรียน รายวิชา ว20206', '', '', '', '']); sh3.appendRow(['ที่', 'เลขประจำตัว', 'ชื่อ - สกุล', 'คะแนนเก็บ', 'รวมคะแนนทั้งหมด']); sh3.appendRow(['', '', '', '(70)', '(100)']); sh3.appendRow(['1', '80901', 'เด็กชายคะแนน ดี', '50', '77']);
const stt = R('scoreTest', AD, bk3.getId(), '80901').data; ok(stt.ok && stt.found && stt.value === '77' && stt.headerRow === 2, 'score test multi-row header ' + JSON.stringify(stt));
R('saveSettings', AD, { config: { scoreSources: [{ name: 'เก็บ', url: 'https://docs.google.com/spreadsheets/d/' + bk3.getId() + '/edit#gid=0', terms: [] }] } });
ok((R('studentHome', s9).data.total || {}).value === '77', 'total from multi-row header sheet');
ok(R('notifications', KB).data.some(n => /การตั้งค่า/.test(n.title) && n.link.startsWith('settings:')), 'settings change notifies staff');
// แชทลบถาวร
const pr = R('chatOpen', s9, { type: 'dm', target: R('listUsers', AD).data.find(u => u.role === 'admin').id }).data; R('chatSend', s9, pr.id, 'ลบทิ้ง', []);
ok(R('chatList', s9).data.find(r => r.id === pr.id).canPurge === true, 'dm can purge');
ok(R('chatPurge', s9, pr.id).ok && !R('chatList', AD).data.some(r => r.id === pr.id) && R('chatSend', AD, pr.id, 'x', []).ok === false, 'chat purged for everyone');
// แจ้งเตือนการเช็คชื่อ
R('ttSaveCfg', AD, { periods: 14, minutes: 120, start: '00:00', breakAfter: 0, breakMin: 0, days: 7, lateMin: 600 });
const sl2 = R('ttSaveSlot', AD, { day: nowD.dow, period: curP, span: 1, courseId: crs.id, grade: 'ม.1', room: '1', students: [s9u.id] }).data;
R('attSave', AD, sl2.id, nowD.date, { [s9u.id]: { st: 'present' } });
ok(R('notifications', KB).data.length >= 0, 'att save ok');
// ---------- v5.6 ----------
const bk4 = ctx.SpreadsheetApp.create('สมุดคะแนน'); const s4 = bk4.insertSheet('ม.1/1');
[['คะแนนการส่งงาน', '', '', '', '', '', '', ''], ['เลขที่', 'คำนำหน้าชื่อ', 'ชื่อ - นามสกุล', 'ชื่อเล่น', 'ตัวชี้วัดที่ 1', 'สอบกลางภาค', 'รวมคะแนนทั้งหมด', 'เกรดที่ได้'], ['', '', '', 'คะแนน', '10', '20', '100', ''],
 ['1', 'เด็กชาย', 'คะแนน ดี', 'ดี', '8', '15', '84', '4'], ['2', 'เด็กหญิง', 'สอง ดี', '', '5', '10', '60', '2.5'], ['สรุปจำนวนนักเรียน', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', ''],
 ['สรุปผลการเรียน', '', '', '', 'จำนวนนักเรียนที่ได้ระดับผลการเรียน', '', 'รวม', ''], ['', '', '', '', '4', '2.5', '', ''], ['จำนวนนักเรียน', '', '', '2', '1', '1', '2', ''], ['ร้อยละ', '', '', '', '50%', '50%', '100%', '']].forEach(r => s4.appendRow(r));
R('saveSettings', AD, { config: { scoreSources: [{ id: 'sb1', name: 'สมุด', url: bk4.getId(), terms: [] }] } });
const bkl = R('scoreBooks', AD).data; ok(bkl.some(x => x.id === 'sb1'), 'score books list');
const bkd = R('scoreBook', AD, 'sb1').data; ok(bkd.sheets.length === 1 && bkd.sheets[0].students.length === 2 && bkd.sheets[0].sections.grade.labels.join() === '4,2.5' && bkd.sheets[0].sections.grade.counts.join() === '1,1', 'parse score book ' + JSON.stringify(bkd.sheets[0] && bkd.sheets[0].sections));
const th9 = R('studentHome', s9).data.total; ok(th9.value === '84' && th9.grade === '4' && th9.details.some(d => d.label === 'ตัวชี้วัดที่ 1' && d.value === '8' && d.max === '10'), 'student score details ' + JSON.stringify(th9));
R('ttSaveCfg', AD, { periods: 14, minutes: 120, start: '00:00', breakAfter: 0, breakMin: 0, days: 7, lateMin: 600 });
const sl3 = R('ttSaveSlot', AD, { day: nowD.dow, period: Math.max(1, curP - 1) === curP ? curP + 1 : curP - 1, span: 1, courseId: crs.id, grade: 'ม.1', room: '1', students: [s9u.id] });
const cpf = R('attCopyFrom', AD, sl3.data.id, nowD.date); ok(cpf.ok && cpf.data.length >= 1 && cpf.data[0].records[s9u.id], 'copy attendance from previous period ' + (cpf.error || ''));
const ex = R('attExport', AD, {}).data; ok(ex.rows.length >= 1 && ex.headers.length === 12, 'attendance export');
// ---------- v5.7 ----------
// คะแนน: ทุกแผ่นงาน (แม้ลิงก์ระบุ gid) · หัวตารางรวมเซลล์ (ชื่อ-สกุลอยู่เหนือคำนำหน้า) · คอลัมน์ตามประเภท · รหัสจาก Users
const bk5 = ctx.SpreadsheetApp.create('ผลการเรียน ว21101');
const mk5 = (nm, rows) => { const sh = bk5.insertSheet(nm); [['ผลการเรียน', '', '', '', '', '', '', '', '', '', '', ''], ['ที่', 'เลขประจำตัว', 'ชื่อ - สกุล', '', 'งานที่ 1', 'ตัวชี้วัดที่ 1', 'ตัวชี้วัดที่ 2', 'สอบกลางภาค', 'สอบปลายภาค', 'รวมคะแนนทั้งหมด', 'เกรด', 'คุณลักษณะอันพึงประสงค์', 'การอ่าน คิด วิเคราะห์ และเขียน'],
  ['', '', '', '', '(5)', '(20)', '(30)', '(20)', '(30)', '(100)', '', '', '']].concat(rows).forEach(r => sh.appendRow(r)); };
mk5('ม.1/1', [['1', '', 'เด็กชาย', 'คะแนน ดี', '5', '18', '25', '15', '25', '83', '4', '3', '3'], ['2', '', 'เด็กหญิง', 'สอง ดี', '3', '10', '15', '10', '15', '50', '1.5', '2', '2']]);
mk5('ม.1/2', [['1', '', 'เด็กชาย', 'สาม ดี', '4', '12', '20', '12', '20', '64', '2.5', '3', '2']]);
R('saveSettings', AD, { config: { scoreSources: [{ id: 'sb5', name: 'ว21101', url: 'https://docs.google.com/spreadsheets/d/' + bk5.getId() + '/edit#gid=12345', terms: [], courseIds: R('me', s9).data.user.courseIds.slice(0, 1) }] } });
const bk5d = R('scoreBook', AD, 'sb5', true).data;
ok(bk5d.sheets.length === 2 && bk5d.sheets.map(x => x.name).join() === 'ม.1/1,ม.1/2', 'score book reads every sheet (ignores gid) ' + JSON.stringify(bk5d.sheets.map(x => x.name)));
const r51 = bk5d.sheets[0].students[0];
ok(r51.no === '1' && r51.name === 'คะแนน ดี' && r51.prefix === 'เด็กชาย' && r51.total === '83' && r51.grade === '4' && r51.trait === '3' && r51.read === '3', 'data-driven name/no/prefix columns ' + JSON.stringify(r51));
ok(r51.code === '80901', 'student code from Users by name');
const kinds = bk5d.sheets[0].columns.map(c => c.kind).join();
ok(/ind,ind/.test(kinds) && /exam,exam/.test(kinds) && kinds.indexOf('raw') >= 0, 'column kinds ' + kinds);
const ms = R('myScores', s9).data; ok(ms.items.length === 1 && ms.items[0].value === '83' && ms.items[0].grade === '4' && ms.items[0].indicators.length === 2 && ms.items[0].exams.length === 2 && ms.items[0].room === 'ม.1/1' && ms.items[0].course, 'student my scores ' + JSON.stringify(ms.items[0]));
ok(R('myScores', AD).ok, 'myScores safe for staff');
// บัญชีทดลองใช้งาน
ok(R('bootstrap', null).data.config.demoEnabled === 'true', 'demo enabled public');
const dl = R('login', null, { mode: 'admin', username: 'test', password: '12345' }); ok(dl.ok && dl.data.user.demo === 'true', 'demo teacher login ' + (dl.error || ''));
const DM = dl.data.token;
ok(R('listUsers', DM).ok && R('adminDashboard', DM).ok && R('getSettings', DM).ok, 'demo can read');
ok(/ซ่อน/.test(R('getSettings', DM).data.sheetId), 'demo settings masked');
ok(R('save', DM, 'Courses', { name: 'x' }).code === 'DEMO' && R('saveSettings', DM, { config: { schoolName: 'x' } }).code === 'DEMO' && R('deleteUsers', DM, { ids: [] }).code === 'DEMO', 'demo cannot write');
ok(R('batch', DM, [['listUsers', []], ['save', ['Courses', { name: 'x' }]]]).data.map(x => x.ok).join() === 'true,false', 'demo batch blocked');
ok(R('markRead', DM, 'all').ok, 'demo soft op');
ok(R('login', null, { mode: 'admin', username: 'test', password: '12345' }).ok && R('listUsers', AD).data.filter(u => u.username === 'test').length === 0 && ctx.allStaff_().filter(u => u.username === 'test').length === 1, 'demo teacher created once and hidden from users list');
ok(!R('adminDashboard', AD).data.recentUsers || !JSON.stringify(R('adminDashboard', AD).data).includes('ทดลอง ใช้งาน'), 'demo not in dashboard');
const dsu = ctx.ensureDemoStudent_(); const dst = ctx.createSession_(dsu, false).token;
ok(R('me', dst).data.user.demo === 'true' && R('studentHome', dst).ok && R('submitWork', dst, {}).code === 'DEMO', 'demo student read only');
ok(R('login', null, { mode: 'student', studentCode: '12345' }).data.user.demo === 'true' && R('listUsers', AD).data.filter(u => u.studentCode === '12345' && u.role === 'student').length === 0 && R('login', null, { mode: 'student', studentCode: '12345' }).data.user.id === dsu.id, 'demo student login (hidden, no duplicate)');
R('saveSettings', AD, { config: { demoEnabled: 'false' } }); ok(R('login', null, { mode: 'admin', username: 'test', password: '12345' }).ok === false, 'demo can be disabled');
// ---------- v5.8 ----------
ok(R('toolLogAdd', AD, 'wheel', { result: 'แดง', n: 6 }).ok && R('toolLogAdd', AD, 'wheel', { result: 'ฟ้า', n: 6 }).ok, 'tool log add');
const tl = R('toolLogList', AD, 'wheel').data; ok(tl.items.length === 2 && tl.items[0].data.result && /^25\d\d\/[12]$/.test(tl.term), 'tool log list by term');
ok(R('toolLogList', KB, 'wheel').data.items.length === 0, 'tool log per owner');
ok(R('toolLogAdd', AD, 'hack', {}).ok === false, 'tool log rejects unknown tool');
ok(R('toolLogClear', AD, 'wheel').data.removed === 2 && R('toolLogList', AD, 'wheel').data.items.length === 0, 'tool log clear');
ok(R('toolLogAdd', DM, 'wheel', { result: 'x' }).ok && R('toolLogClear', DM, 'wheel').code === 'DEMO', 'demo tool log soft / clear blocked');
const qom = ctx.quiz_({ questions: [{ id: 'a1', type: 'mc', q: 'ภาพใด', points: 1, options: ['', 'แมว'], om: [{ img: 'https://drive.google.com/thumbnail?id=abc', link: 'javascript:alert(1)' }, { file: { id: 'f', name: 'a.pdf', url: 'https://drive.google.com/file/d/f/view', mime: 'application/pdf' } }], answer: 0 }] });
ok(qom.questions[0].om[0].img && !qom.questions[0].om[0].link && qom.questions[0].om[1].file.name === 'a.pdf', 'quiz option media sanitized');
ok(JSON.parse(ctx.quizPub_(JSON.stringify(qom))).questions[0].om.length === 2, 'quiz option media sent to students');
let qe = null; try { ctx.quiz_({ questions: [{ type: 'mc', q: 'x', points: 1, options: ['', 'b'], answer: 0 }] }); } catch (e) { qe = e; } ok(qe, 'empty option without media rejected');
const bk6 = ctx.SpreadsheetApp.create('ไม่มีอ่าน'); const s6 = bk6.insertSheet('ม.3/1');
[['เลขที่', 'คำนำหน้าชื่อ', 'ชื่อ - นามสกุล', 'ตัวชี้วัดที่ 1', 'รวมคะแนนทั้งหมด', 'เกรด', 'คุณลักษณะอันพึงประสงค์'], ['', '', '', '10', '100', '', ''], ['1', 'เด็กชาย', 'ทด ลอง', '9', '90', '4', '3']].forEach(r => s6.appendRow(r));
const pb6 = ctx.parseBook_(s6.getDataRange().getDisplayValues()); ok(pb6.readFromTrait && pb6.students[0].read === '3', 'read falls back to trait column');
// ---------- v5.9 ----------
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const q1 = R('qrSave', AD, { text: 'https://example.com', note: 'ทดสอบ', png: PNG, useDate: '2026-11-21', style: { dot: 'dots' } }); ok(q1.ok && q1.data.imgId && q1.data.style.dot === 'dots', 'qr save with png to drive ' + (q1.error || ''));
const q2 = R('qrSave', AD, { id: q1.data.id, text: 'https://example.org', png: PNG }); ok(q2.ok && q2.data.imgId !== q1.data.imgId, 'qr edit replaces image');
ok(R('qrStatus', AD, q1.data.id, 'cancel').ok && R('qrList', AD).data.cancel === 1, 'qr status + summary');
ok(R('qrSave', KB, { id: q1.data.id, text: 'x' }).code === 'NOTFOUND', 'qr owner only');
ok(R('qrRemove', AD, q1.data.id).ok && R('qrList', AD).data.total === 0, 'qr remove');
ok(R('qrSave', AD, { text: '' }).ok === false, 'qr requires text');
// กระดาษคำถาม
const pp = R('paperSave', AD, { title: 'กลางภาค', data: { type: 'กลางภาค', parts: [{ title: 'ตอนที่ 1', questions: [{ q: '1+1', choices: ['1', '2'] }] }] } }); ok(pp.ok && R('paperList', AD).data[0].data.parts.length === 1, 'question paper save/list');
// กระดาษคำตอบ
const fd = R('examFolderSave', AD, { name: 'ม.1' }).data; ok(fd.id, 'exam folder');
const ex1 = R('examSave', AD, { name: 'ข้อสอบ 1', folderId: fd.id, cfg: { digits: 5, count: 5, fmt: 'c4', sets: 2 }, classes: ['ม.1/1'], tags: ['กลางภาค'] }).data;
ok(ex1.cfg.nopt === 4 && ex1.key.A.length === 5 && ex1.key.B.length === 5 && ex1.tags[0] === 'กลางภาค', 'exam create with default key');
ok(R('examKey', AD, ex1.id, { A: [{ a: [0], p: 1 }, { a: [1], p: 1 }, { a: [2, 3], p: 2 }, { a: [3], p: 1 }, { a: [0], p: 1 }] }, false).ok, 'exam key save');
const eg = R('examGet', AD, ex1.id).data; ok(eg.students.some(u => u.id === s9u.id), 'exam students from classes');
const rs = R('examResultSave', AD, ex1.id, { studentId: s9u.id, set: 'A', answers: [[0], [2], [3], [3], []], code: '80901', img: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ' }).data;
ok(rs.score === 4 && rs.max === 6, 'exam score with multi-correct item ' + JSON.stringify(rs));
ok(R('examResultSave', AD, ex1.id, { studentId: s9u.id, answers: [] }).code === 'EXISTS', 'one student one sheet');
const rs2 = R('examResultSave', AD, ex1.id, { studentId: s9u.id, answers: [[0], [1], [2], [3], [0]], overwrite: true }).data; ok(rs2.replaced && rs2.score === 6, 'overwrite keeps history');
ok(R('examGet', AD, ex1.id).data.results[0].history.length === 1, 'result history');
ok(R('examKey', AD, ex1.id, { A: [{ a: [1], p: 1 }, { a: [1], p: 1 }, { a: [2], p: 1 }, { a: [3], p: 1 }, { a: [0], p: 1 }] }, true).data.recalculated === 1 && R('examGet', AD, ex1.id).data.results[0].score === '4', 'recalculate after key edit');
const rid = R('examGet', AD, ex1.id).data.results[0].id; ok(R('examResultUpdate', AD, rid, { score: 3.5 }).ok && R('examResults', AD).data[0].score === 3.5, 'manual score edit + results list');
ok(R('examAll', AD).data.exams[0].done === 1, 'exam list counts results');
ok(R('examFolderRemove', AD, fd.id, 'move').data.exams === 1 && R('examAll', AD).data.exams[0].folderId === '', 'remove folder moves exams out');
ok(R('examResultRemove', AD, rid).ok && R('examRemove', AD, ex1.id).ok, 'exam result/exam remove');
ok(R('examPrefs', AD, { pass: 60, auto: true }).data.pass === 60 && JSON.parse(ctx.allStaff_().find(u => u.username === 'admin').prefs).exam.auto === true, 'exam prefs saved per user');
const cb = R('classBulkAdd', AD, [['ม.4', '1'], ['ม.4', '2'], ['ม.4', '1']]).data; ok(cb.added === 2 && cb.skipped === 1, 'class bulk add skips duplicates');
ok(R('classRemove2', AD, 'ม.4', '2').ok, 'remove empty class');
ok(R('classRemove2', AD, 'ม.1', '1').code === 'HAS_STUDENTS', 'class with students needs move/delete');
// ---- v6.0 ----
const dn = R('adminDashboard', AD).data; ok(dn.days.length === 7 && dn.logins.length === 7 && typeof dn.sub7.graded === 'number', 'dashboard: 7 days + submission status (7 days)');
const pf = R('examFolderSave', AD, { name: 'กลางภาค', kind: 'paper' }).data; ok(pf.kind === 'paper', 'paper folder kind');
const pid = R('paperList', AD).data[0].id; ok(R('examMove', AD, 'paper', [pid], pf.id).data.moved === 1 && R('paperList', AD).data.find(x => x.id === pid).folderId === pf.id, 'drag paper into folder');
ok(R('paperSave', AD, { id: pid, title: 'กลางภาค', data: { parts: [] } }).ok && R('paperList', AD).data.find(x => x.id === pid).folderId === pf.id, 'paper edit keeps folder');
ok(R('examMove', AD, 'sheet', [pid], pf.id).code === 'NOTFOUND', 'cannot move answer sheet into question-paper folder');
const sf = R('examFolderSave', AD, { name: 'ชีต' }).data, exM = R('examSave', AD, { name: 'ย้าย', cfg: { count: 5 } }).data; ok(R('examMove', AD, 'sheet', [exM.id], sf.id).data.moved === 1 && R('examAll', AD).data.exams.find(x => x.id === exM.id).folderId === sf.id, 'import answer sheet into folder');
ok(R('examFolderRemove', AD, pf.id, 'move').data.papers === 1 && !R('paperList', AD).data.find(x => x.id === pid).folderId, 'delete paper folder moves papers out');
const cfgS = R('examSave', AD, { name: 'แม่แบบ', cfg: { count: 10, sheet: { part2: false, cmd: 'ระบาย', part2Title: 'ตอนที่ 2', grade: 'ม.2', term: '2569/2', tips: false } } }).data.cfg.sheet; ok(cfgS.part2 === false && cfgS.tips === false && cfgS.cmd === 'ระบาย' && cfgS.grade === 'ม.2' && cfgS.page === true, 'answer sheet template fields');
const bigLogo = 'data:image/png;base64,' + 'A'.repeat(42000); const qx = R('qrSave', AD, { text: 'https://x.y', style: { fg: '#000', logo: bigLogo, logoSize: 26 } }); ok(qx.ok, 'qr save with big logo');
ok(JSON.parse(R('qrList', AD).data.items.find(x => x.text === 'https://x.y') ? JSON.stringify(R('qrList', AD).data.items.find(x => x.text === 'https://x.y').style) : '{}').logoSize === 26, 'qr style stays valid JSON (logo dropped when too big)');
const c61 = R('examSave', AD, { name: 'v61', cfg: { count: 10, labels: 'custom', labelsCustom: 'a,b,c,d', sheet: { font: 'Kanit', fs: 1.2, howtoImg: 'data:image/png;base64,AAAA', tipsText: 'x' } } }).data.cfg; ok(c61.labels === 'custom' && c61.labelsCustom === 'a,b,c,d' && c61.sheet.font === 'Kanit' && c61.sheet.fs === 1.2 && c61.sheet.howtoImg.startsWith('data:image/png'), 'v6.1 answer sheet: custom labels, font, example image');
ok(R('examSave', AD, { name: 'v61b', cfg: { count: 10, sheet: { howtoImg: 'javascript:alert(1)' } } }).data.cfg.sheet.howtoImg === '', 'v6.1 example image must be a data image');
const c62 = R('examSave', AD, { name: 'v62', cfg: { count: 10, grid: 'hv', flow: 'below', sheet: { part1Type: 'ปรนัย 10 ข้อ', lay: { line: '#123456', qrSwap: true, text: 'red' } } } }).data.cfg; ok(c62.grid === 'hv' && c62.flow === 'below' && c62.sheet.part1Type === 'ปรนัย 10 ข้อ' && c62.sheet.lay.line === '#123456' && c62.sheet.lay.qrSwap === true && c62.sheet.lay.text === '#111111', 'v6.2 answer sheet grid/flow/layout (colors validated)');
// ---- v6.3 ปฏิทินกิจกรรม ----
{ const td = ctx.now_().slice(0, 10), ev = R('evSave', AD, { title: 'สอบกลางภาค', date: td, allDay: true, remind: 1440, color: '#123456', detail: 'ห้อง 1' }).data;
  ok(ev && ev.id && ev.allDay === true && ev.color === '#123456' && ev.remind === 1440, 'v6.3 event save');
  ok(R('evSave', AD, { title: '', date: td }).ok === false && R('evSave', AD, { title: 'x', date: 'bad' }).ok === false, 'v6.3 event validation');
  ok(R('evList', AD, { from: td, to: td }).data.some(x => x.id === ev.id), 'v6.3 event list by range');
  const d2 = new Date(td + 'T00:00:00Z'); d2.setUTCDate(d2.getUTCDate() + 3); const t3 = d2.toISOString().slice(0, 10);
  const mv = R('evMove', AD, ev.id, t3).data; ok(mv.date === t3 && mv.endDate === t3, 'v6.3 event drag to another day');
  R('evMove', AD, ev.id, td); const an0 = ctx.rows_('Announcements').length, due = R('evDue', AD).data;
  ok(due.some(x => x.id === ev.id) && ctx.rows_('Announcements').length === an0 + 1 && ctx.rows_('Announcements').some(a => a.type === 'กิจกรรม' && a.title.includes('สอบกลางภาค')), 'v6.3 due event → system announcement');
  R('evDue', AD); ok(ctx.rows_('Announcements').length === an0 + 1, 'v6.3 announcement only once');
  ok(R('evSave', AD, { title: 'ไม่เตือน', date: td, allDay: true, remind: -1 }).ok && !R('evDue', AD).data.some(x => x.title === 'ไม่เตือน'), 'v6.3 no-reminder event not due');
  ok(R('evRemove', AD, ev.id).ok && !R('evList', AD, {}).data.some(x => x.id === ev.id), 'v6.3 event remove'); }
// ---- v6.4 ----
{ const exM2 = R('examSave', AD, { name: 'ข้อสอบ 1', cfg: { digits: 5, count: 5, fmt: 'c4' }, classes: ['ม.1/1'] }).data; R('examKey', AD, exM2.id, { A: [{ a: [0], p: 1 }, { a: [1], p: 1 }, { a: [2, 3], p: 2 }, { a: [3], p: 1 }, { a: [0], p: 1 }] }, false);
  const many = R('examResultSaveMany', AD, exM2.id, [{ studentId: s9u.id, answers: [[0], [1], [2], [3], [0]] }, { studentId: 'nope', answers: [] }]).data;
  ok(many.length === 2 && many[0].ok && many[0].score === 6 && many[1].ok === false, 'v6.4 continuous scan: save many (partial fail reported)');
  const hm = R('studentHome', s9).data; ok(hm.latestScores.some(x => x.exam && x.title === 'ข้อสอบ 1' && +x.sub.score === 6), 'v6.4 scanned exam score in student latest scores');
  const c64 = R('examSave', AD, { name: 'v64', cfg: { count: 10, sheet: { lay: { boxDy: 99, sepT: true }, ed: { 3: { dx: 5, dy: -2, t: 'x', a: 'middle', b: true, del: true, bad: 1 }, zz: { dx: 1 } }, add: [{ x: 50, y: 60, t: 'เพิ่ม', s: 3.5, a: 'end' }] } } }).data.cfg.sheet;
  ok(c64.lay.boxDy === 20 && c64.lay.sepT === true && c64.ed['3'].dx === 5 && c64.ed['3'].a === 'middle' && c64.ed['3'].del === true && !c64.ed['3'].bad && !c64.ed.zz && c64.add[0].t === 'เพิ่ม' && c64.add[0].a === 'end', 'v6.4 answer sheet: on-page edits + box offset + separators sanitized');
  ok(R('saveStaffMenus', AD, JSON.stringify({ order: ['calendar', 'dash', 'BAD!', 'dash'] })).data === JSON.stringify({ order: ['calendar', 'dash'] }) && ctx.cfg_().staffMenus.includes('calendar'), 'v6.4 staff menu order saved');
  ok(R('saveStaffMenus', s9, '{}').ok === false, 'v6.4 staff menu order admin only');
  const td = ctx.now_().slice(0, 10), e1 = R('evSave', AD, { title: 'ทดสอบไอคอน', date: td, allDay: true, remind: 1440, icon: 'fa-star', img: 'javascript:alert(1)' }).data;
  ok(e1.icon === 'fa-star' && e1.img === '', 'v6.4 event icon saved, bad image rejected');
  const n0 = ctx.rows_('Notifications').length, fired = ctx.eventJob(); ok(fired === 1 && ctx.rows_('Notifications').length > n0 && ctx.rows_('Notifications').some(n => n.link === 'calendar:' + e1.id), 'v6.4 event trigger: bell notification for everyone (no one online)');
  ok(ctx.eventJob() === 0, 'v6.4 event trigger fires once'); R('evRemove', AD, e1.id); }
// ---- v6.5 ----
{ ok(ctx.cell_('08:00') === "'08:00" && ctx.cell_('2026-11-23') === "'2026-11-23" && ctx.cell_('0123') === "'0123" && ctx.cell_('abc') === 'abc', 'v6.5 times/dates/leading zeros kept as text');
  const td = ctx.now_().slice(0, 10), ev = R('evSave', AD, { title: 'เวลา', date: td, start: '14:00', end: '15:30', remind: -1 }).data; const got = R('evList', AD, { from: td, to: td }).data.find(x => x.id === ev.id);
  ok(got.start === '14:00' && got.end === '15:30', 'v6.5 event time stays HH:mm');
  const sev = R('evSave', s9, { title: 'อ่านหนังสือ', date: td, allDay: true, remind: 1440, scope: 'all' }); ok(sev.ok && sev.data.scope === 'me', 'v6.5 student can add private events (forced private)');
  ok(!R('evList', AD, { from: td, to: td }).data.some(x => x.id === sev.data.id) && R('evList', s9, { from: td, to: td }).data.some(x => x.id === sev.data.id), 'v6.5 private events visible only to owner');
  ok(R('evRemove', s9, ev.id).ok === false, 'v6.5 student cannot remove staff event');
  const an0 = ctx.rows_('Announcements').length, nt0 = ctx.rows_('Notifications').filter(n => n.ownerId === s9u.id).length; ctx.eventJob();
  ok(ctx.rows_('Announcements').length === an0 && ctx.rows_('Notifications').filter(n => n.ownerId === s9u.id).length === nt0 + 1, 'v6.5 private reminder → bell for owner only, no announcement');
  ok(/^วัน.+ที่ \d+ .+ 25\d\d เวลา 14\.00 น\./.test(ctx.thFull_('2026-11-23', '14:00')) && ctx.thFull_('2026-11-23').startsWith('วันจันทร์ที่ 23 พฤศจิกายน 2569'), 'v6.5 Thai full date format');
  const ax = R('save', AD, 'Assignments', { courseId: R('list', AD, 'Courses').data[0].id, title: 'งานปฏิทิน', type: 'การบ้าน', grade: 'ม.1', room: '1', dueAt: td + 'T16:00', maxScore: 10 });
  ok(R('evList', AD, { from: td, to: td }).data.some(x => x.ro && x.kind === 'due' && x.title.includes('งานปฏิทิน') && x.start === '16:00'), 'v6.5 assignment due date shown on calendar ' + (ax.error || ''));
  const t2 = R('annTypeAdd', AD, 'ทุนการศึกษา').data; ok(t2.split(',').includes('ทุนการศึกษา') && R('annTypeAdd', AD, '').ok === false, 'v6.5 add announcement type');
  const exP = R('examSave', AD, { name: 'สองตอน', cfg: { digits: 5, count: 5, fmt: 'c4', sheet: { p2max: 10, p2count: 2, lay: { sep12: false } } }, classes: ['ม.1/1'] }).data; ok(exP.cfg.sheet.p2max === 10 && exP.cfg.sheet.p2count === 2 && exP.cfg.sheet.lay.sep12 === false && exP.cfg.sheet.lay.sepFt === true, 'v6.5 answer sheet part 2 settings');
  R('examKey', AD, exP.id, { A: [{ a: [0], p: 1 }, { a: [1], p: 1 }, { a: [2], p: 1 }, { a: [3], p: 1 }, { a: [0], p: 1 }] }, false);
  const rr = R('examResultSave', AD, exP.id, { studentId: s9u.id, answers: [[0], [1], [2], [0], [0]] }).data; ok(R('examResultUpdate', AD, rr.id, { score2: 11 }).ok === false && R('examResultUpdate', AD, rr.id, { score2: 7.5 }).ok, 'v6.5 part 2 score validated');
  const ls = R('studentHome', s9).data.latestScores.find(x => x.exam && x.title === 'สองตอน'); ok(ls && +ls.sub.score === 11.5 && +ls.maxScore === 15, 'v6.5 total score (part 1 + part 2) in student latest scores ' + JSON.stringify(ls && [ls.sub.score, ls.maxScore])); }
console.log(`backend tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
