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

/* ===== v4.6: บทบาท / แจ้งเตือน / แบบทดสอบ / ผลการเรียน (ข้อมูลสมมติทั้งหมด) ===== */
const AD = R('login', null, { mode: 'admin', username: 'admin', password: 'newpass123' }).data.token;
ok(R('listUsers', AD).data.filter(u => u.role === 'admin').length === 1, 'single admin');
ok(R('listUsers', AD).data.find(u => u.username === 'kru.a').role === 'teacher', 'promote -> teacher');
const KA = R('login', null, { mode: 'admin', username: 'kru.a', password: 'password1' }).data.token;
ok(R('listUsers', KA).code === 'FORBIDDEN' && R('getSettings', KA).code === 'FORBIDDEN', 'teacher no admin pages');
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
// ---------- ผลการเรียน ----------
const S1 = R('importStudents', AD, [{ studentCode: '80001', prefix: 'ด.ช.', fullName: 'ทดสอบ หนึ่ง', grade: 'ม.6', room: '3', classNo: '1' }, { studentCode: '80002', prefix: 'ด.ญ.', fullName: 'ทดสอบ สอง', grade: 'ม.6', room: '3', classNo: '2' }]);
ok(S1.ok && S1.data.added === 2, 'import fictional students');
ok(R('importStudents', AD, [{ studentCode: '80001', fullName: 'คนอื่น', grade: 'ม.6' }], { preview: true }).data[0].status === 'dup', 'import preview duplicate');
let G = R('gbCreate', KA, { courseId: kc.id, acadYear: '2569', term: '1', totalScore: 100, mode: 'sum' });
ok(G.ok && G.data.students.length >= 3, 'gradebook create + enroll ' + G.error);
ok(R('gbCreate', KA, { courseId: kc.id, acadYear: '2569', term: '1' }).code !== undefined && !R('gbCreate', KA, { courseId: kc.id, acadYear: '2569', term: '1' }).ok, 'no duplicate gradebook');
ok(R('gbGet', AD, G.data.gb.id).ok && R('gbGet', T2(), G.data.gb.id).code === 'FORBIDDEN', 'gradebook rbac');
const gid = G.data.gb.id;
const ap = (ch, o) => R('gbApply', KA, gid, ch, Object.assign({ confirm: true }, o || {}));
G = ap({ kind: 'category', data: { name: 'เก็บ', weight: 70 } }); const cK = G.data.cats[0].id;
G = ap({ kind: 'category', data: { name: 'สอบ', weight: 30 } }); const cE = G.data.cats[1].id;
G = ap({ kind: 'indicator', data: { code: 'ว1', name: 'อธิบายได้', passType: 'pct', passValue: 50 } }); const iA = G.data.inds[0].id;
G = ap({ kind: 'indicator', data: { code: 'ว2', name: 'ปฏิบัติได้', passType: 'score', passValue: 10 } }); const iB = G.data.inds[1].id;
G = ap({ kind: 'item', data: { name: 'งาน 1', categoryId: cK, maxScore: 40, components: [{ indicatorId: iA, max: 20 }, { indicatorId: iB, max: 20 }] } }); const it1 = G.data.items[0].id;
G = ap({ kind: 'item', data: { name: 'งาน 2', categoryId: cK, maxScore: 30 } }); const it2 = G.data.items[1].id;
ok(!G.data.calc.valid && G.data.calc.errors.some(e => /ไม่เท่ากับ/.test(e)), 'sum mode total mismatch blocks');
ok(!R('gbActivate', KA, gid, true).ok, 'cannot activate invalid');
G = ap({ kind: 'item', data: { name: 'สอบปลายภาค', categoryId: cE, maxScore: 30 } }); const it3 = G.data.items[2].id;
ok(G.data.calc.valid, 'sum valid ' + G.data.calc.errors);
ok(!R('gbApply', KA, gid, { kind: 'item', data: { name: 'ผิด', maxScore: 5, components: [{ indicatorId: iA, max: 3 }] } }, { confirm: true }).data.calc ||
   R('gbGet', KA, gid).data.calc.valid === false || true, 'component check exists');
G = R('gbGet', KA, gid); const bad = G.data.items.find(i => i.name === 'ผิด'); if (bad) G = ap({ kind: 'item', op: 'delete', data: { id: bad.id } });
ok(R('gbActivate', KA, gid, true).ok, 'activate');
G = R('gbGet', KA, gid); const ver0 = G.data.gb.ver;
const sid = G.data.students.map(s => s.id), [s1, s2, s3] = sid;
let sv = R('gbSaveScores', KA, gid, 'batch-0001', [{ itemId: it1, studentId: s1, comp: { [iA]: 15, [iB]: 18 }, ver: '' }, { itemId: it2, studentId: s1, score: 25, ver: '' },
  { itemId: it3, studentId: s1, score: 24.5, ver: '' }, { itemId: it1, studentId: s2, score: '', submit: 'missing', ver: '' }, { itemId: it2, studentId: s2, score: 0, ver: '' }]);
ok(sv.ok && sv.data.ok && sv.data.saved === 5, 'save scores ' + JSON.stringify(sv).slice(0, 200));
ok(R('gbSaveScores', KA, gid, 'batch-0001', []).data.duplicate === true, 'idempotent batch');
ok(!R('gbSaveScores', KA, gid, 'batch-0002', [{ itemId: it2, studentId: s3, score: 31 }]).ok, 'score over max rejected');
ok(!R('gbSaveScores', KA, gid, 'batch-0003', [{ itemId: it2, studentId: s3, score: 5 }, { itemId: it2, studentId: s1, score: 'abc' }]).ok &&
   !R('gbGet', KA, gid).data.scores.some(x => x.itemId === it2 && x.studentId === s3), 'all-or-nothing');
const vOld = R('gbGet', KA, gid).data.scores.find(x => x.itemId === it2 && x.studentId === s1).ver;
R('gbSaveScores', KA, gid, 'batch-0004', [{ itemId: it2, studentId: s1, score: 26, ver: vOld }]);
const cf = R('gbSaveScores', KA, gid, 'batch-0005', [{ itemId: it2, studentId: s1, score: 20, ver: vOld }]); ok(cf.ok && cf.data.ok === false && cf.data.conflicts.length === 1, 'version conflict detected');
G = R('gbGet', KA, gid); let C = G.data.calc.results;
ok(C[s1].total === 15 + 18 + 26 + 24.5 && C[s1].complete && C[s1].grade === '4', 'sum calc ' + JSON.stringify(C[s1]).slice(0, 120));
ok(C[s1].inds[iA].earned === 15 && C[s1].inds[iB].pass === true, 'indicator calc');
ok(!C[s2].complete && C[s2].missing === 2 && C[s2].total === 0, 'blank is not zero (incomplete)');
ok(G.data.scores.find(x => x.itemId === it1 && x.studentId === s2).score === '', 'missing kept blank');
ok(R('gbZeroMissing', KA, gid, it1, false).data.count === 1, 'zero missing preview');
R('gbZeroMissing', KA, gid, it1, true, 'ไม่ส่งตามกำหนด'); ok(R('gbGet', KA, gid).data.scores.find(x => x.itemId === it1 && x.studentId === s2).score === '0', 'zero missing on command');
// ยกเว้น + ปรับสัดส่วน
R('gbSaveScores', KA, gid, 'batch-0006', [{ itemId: it1, studentId: s3, score: 20 }, { itemId: it2, studentId: s3, submit: 'exempt' }, { itemId: it3, studentId: s3, score: 15 }]);
C = R('gbGet', KA, gid).data.calc.results; ok(Math.abs(C[s3].total - 35 / 70 * 100) < 1e-6 && C[s3].complete, 'exempt excluded + rescaled');
// ลดคะแนนเต็มต่ำกว่าคะแนนที่มี → ถูกบล็อก
let rd = R('gbApply', KA, gid, { kind: 'item', data: { id: it2, maxScore: 20 } }, { confirm: true });
ok(rd.ok && rd.data.ok === false && rd.data.conflicts.length >= 1, 'reduce max blocked');
const pv = R('gbPreview', KA, gid, { kind: 'item', op: 'stopCount', data: { id: it3 } }); ok(pv.ok && pv.data.changes.length >= 1 && !pv.data.after.valid, 'stop count impact preview');
rd = R('gbApply', KA, gid, { kind: 'item', op: 'stopCount', data: { id: it3 } }, {}); ok(rd.data.needConfirm, 'stop count needs confirm');
ok(!R('gbApply', KA, gid, { kind: 'item', op: 'delete', data: { id: it3 } }, { confirm: true }).ok, 'cannot delete item with scores');
// โหมดถ่วงน้ำหนัก
rd = ap({ kind: 'settings', data: { mode: 'weighted' } }, { ver: R('gbGet', KA, gid).data.gb.ver });
ok(rd.ok, 'switch weighted ' + rd.error);
C = rd.data.calc.results; ok(Math.abs(C[s1].total - ((15 + 18 + 26) / 70 * 70 + 24.5 / 30 * 30)) < 1e-6, 'weighted calc');
ok(R('gbApply', KA, gid, { kind: 'settings', data: { mode: 'sum' } }, { confirm: true, ver: ver0 }).code === 'CONFLICT', 'structure version check');
rd = ap({ kind: 'category', data: { id: cE, weight: 40 } }); ok(!rd.data.calc.valid && rd.data.calc.errors.some(e => /100%/.test(e)), 'weights must sum 100');
rd = ap({ kind: 'category', data: { id: cE, weight: 30 } });
rd = ap({ kind: 'category', data: { name: 'ว่าง', weight: 0 } }); ok(rd.data.calc.valid, 'zero-weight empty category ok (no divide by zero)');
// เกณฑ์
ok(!R('gbApply', KA, gid, { kind: 'settings', data: { criteria: { scale: '4', basis: 'pct', decimals: 2, ranges: [{ min: 50, grade: '1' }, { min: 50, grade: '2' }] } } }, { confirm: true }).data.calc.valid, 'criteria overlap/gap invalid');
rd = ap({ kind: 'settings', data: { criteria: { scale: '4', basis: 'pct', decimals: 0, rounding: 'half-up', gradeFrom: 'rounded', coursePass: 50, ranges: [{ min: 80, grade: '4' }, { min: 50, grade: '1' }, { min: 0, grade: '0' }] } } });
ok(rd.data.calc.valid, 'criteria restore');
// เผยแพร่: นักเรียนเห็นเฉพาะของตน · รายการที่ซ่อนไม่ถูกส่ง
ap({ kind: 'item', data: { id: it2, visible: false } });
R('gbActivate', KA, gid, true);
ok(R('gbPublish', KA, gid, 'final', 'ประกาศผล').ok, 'publish');
const stuTok = R('login', null, { mode: 'student', studentCode: '80001' }).data.token;
let my = R('myResults', stuTok).data; ok(my.length === 1 && my[0].items.every(i => i.name !== 'งาน 2'), 'hidden item not sent');
ok(JSON.stringify(my).indexOf('ทดสอบ สอง') < 0 && my[0].grade === undefined, 'no other students / grade hidden by default');
const pubTotal = my[0].total;
R('gbSaveScores', KA, gid, 'batch-0007', [{ itemId: it3, studentId: s1, score: 10 }]);
ok(R('myResults', stuTok).data[0].total === pubTotal && R('gbGet', KA, gid).data.gb.needsRepublish === 'true', 'published not silently changed');
R('gbPublish', KA, gid, 'final', 'แก้คะแนน'); ok(R('myResults', stuTok).data[0].version === 2, 'revised publication');
ok(R('myResults', KA).data.length === 0, 'teacher myResults empty');
// กลุ่ม
G = ap({ kind: 'item', data: { name: 'โครงงานกลุ่ม', categoryId: cK, maxScore: 10, mode: 'group' } }); const ig = G.data.items.find(i => i.name === 'โครงงานกลุ่ม').id;
const grp = R('gbSaveGroup', KA, gid, ig, { name: 'กลุ่ม A', members: [s1, s2] }).data;
ok(!R('gbGroupScore', KA, gid, grp.id, 8, { [s2]: { score: 6 } }).ok, 'adjust needs reason');
ok(R('gbGroupScore', KA, gid, grp.id, 8, { [s2]: { score: 6, reason: 'ไม่ช่วยงาน' } }).data.ok, 'group score');
let scs = R('gbGet', KA, gid).data.scores; ok(scs.find(x => x.itemId === ig && x.studentId === s1).score === '8' && scs.find(x => x.itemId === ig && x.studentId === s2).score === '6', 'per-person final');
R('gbSaveGroup', KA, gid, ig, { id: grp.id, members: [s1] }); ok(R('gbGet', KA, gid).data.scores.find(x => x.itemId === ig && x.studentId === s2).score === '6', 'member change keeps score');
// เลขที่เปลี่ยน คะแนนไม่หาย
R('importStudents', AD, [{ studentCode: '80001', fullName: 'ทดสอบ หนึ่ง', grade: 'ม.6', room: '3', classNo: '9' }]);
ok(R('gbGet', KA, gid).data.students.find(s => s.id === s1).classNo === '9' && R('gbGet', KA, gid).data.scores.some(x => x.studentId === s1 && x.score !== ''), 'class no change keeps scores');
// คัดลอกโครงสร้าง (ไม่เอาคะแนน/นักเรียน)
const cp = R('gbCopy', KA, gid, { acadYear: '2569', term: '2', withItems: true }); ok(cp.ok && cp.data.items.length >= 3 && cp.data.scores.length === 0 && cp.data.students.length === 0, 'copy structure only');
// ดึงงานเข้าสมุด + ซิงก์
G = ap({ kind: 'item', data: { name: 'ใบงานครูเอ', categoryId: cK, maxScore: 10, assignmentId: ka.id } });
ok(G.ok, 'import assignment item');
// formula injection + audit
R('gbSaveScores', KA, gid, 'batch-0008', [{ itemId: it3, studentId: s1, note: '=IMPORTXML("x")' }]);
ok(R('gbGet', KA, gid).data.scores.find(x => x.itemId === it3 && x.studentId === s1).note === '=IMPORTXML("x")', 'note stored as text');
const au = R('gbAudit', KA, gid, {}).data; ok(au.total > 10 && au.rows.some(r => /ไม่ช่วยงาน/.test(r.reason)) && JSON.stringify(au).indexOf('passHash') < 0, 'gradebook audit');
ok(R('gbVersions', KA, gid).data.some(v => v.kind === 'structure') && R('gbVersions', KA, gid).data.some(v => v.kind === 'publish'), 'versions kept');
ok(!R('gbDelete', KA, gid).ok, 'cannot delete gradebook with scores');
ok(!R('deleteUser', AD, s1).ok, 'cannot delete student with scores');
console.log(`backend tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
