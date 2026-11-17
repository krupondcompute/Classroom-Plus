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
ok(dOld.past && dOld.cards.courses <= dNow.cards.courses && dOld.days.length === 14 && dOld.days[13] === '2007-10-20', 'dashboard past term');
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
console.log(`backend tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
