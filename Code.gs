/**
 * Classroom PLus — Google Apps Script backend (ไฟล์เดียว)
 * ฐานข้อมูล: Google Sheets | ไฟล์: Google Drive | หน้าเว็บ: Index.html (HTML Service)
 * Admin เปลี่ยน Sheet ID / Drive ID ได้จากหน้า "ตั้งค่าระบบ" (เก็บใน Script Properties)
 */
const APP_VERSION = '4.0.0';
const TZ = 'Asia/Bangkok';
const DEFAULTS = {
  SHEET_ID: '14mpQC_8KSKd-V8Wn_sj2gdreJfB_q9haOnarBbqQ4r8',
  DRIVE_ID: '1GqxqZyDJPb7C27kBjyeyimD9VKqiKJ2Y'
};
const MAX_UPLOAD_MB = 20; // google.script.run รับข้อมูลได้จำกัด ไฟล์ใหญ่กว่านี้ให้แนบลิงก์ Google Drive
const ALLOWED_EXT = ['pdf','doc','docx','ppt','pptx','xls','xlsx','csv','txt','jpg','jpeg','png','gif','webp',
  'zip','rar','7z','mp4','mov','webm','mp3','m4a'];
const CONFIG_DEFAULTS = {
  schoolName: 'Classroom PLus', logo: '', welcome: 'ยินดีต้อนรับ สู่ห้องเรียนออนไลน์แห่งอนาคต',
  studentLogin: 'code+birth',  // 'code' = รหัสนักเรียนอย่างเดียว, 'code+birth' = รหัส + วันเกิด (แนะนำ)
  allowAdminSignup: 'true', requireApproval: 'false', sessionHours: '8', rememberDays: '30',
  emailNotify: 'false', lineToken: '', autoBackup: 'true', webNotify: 'true'
};
const PRIVATE_CONFIG = ['lineToken'];
const SCHEMA = {
  Config: ['key','value','updatedAt'],
  Users: ['id','role','username','studentCode','passSalt','passHash','prefix','fullName','birthDate','grade','room',
    'email','avatar','status','mustChangePassword','createdAt','updatedAt','lastLoginAt'],
  Sessions: ['id','userId','tokenHash','expiresAt','createdAt'],
  Classes: ['id','grade','room','order','createdAt'],
  Categories: ['id','name','createdAt'],
  Courses: ['id','code','name','description','category','grade','room','cover','teacher','order','ownerId','createdAt','updatedAt'],
  Lessons: ['id','courseId','unit','title','description','cover','videoUrl','videoDuration','attachments','links',
    'duration','order','publishAt','closeAt','ownerId','createdAt','updatedAt'],
  Progress: ['id','ownerId','lessonId','courseId','completed','videoPos','videoDone','views','updatedAt'],
  Assignments: ['id','courseId','type','title','description','attachments','dueAt','maxScore','ownerId','createdAt','updatedAt'],
  Submissions: ['id','assignmentId','ownerId','text','files','driveLink','status','submittedAt','score','feedback',
    'gradedBy','gradedAt','history','updatedAt'],
  Announcements: ['id','type','title','body','attachments','image','pinned','courseId','grade','room','ownerId','createdAt','updatedAt'],
  Notifications: ['id','ownerId','title','body','link','read','createdAt'],
  AuditLog: ['id','userId','action','detail','createdAt']
};
// ตารางที่ Admin แก้ไขผ่าน save()/remove() ได้ และฟิลด์ที่อนุญาต
const EDITABLE = {
  Classes: ['grade','room','order'],
  Categories: ['name'],
  Courses: ['code','name','description','category','grade','room','cover','teacher','order','ownerId'],
  Lessons: ['courseId','unit','title','description','cover','videoUrl','videoDuration','attachments','links','duration','order','publishAt','closeAt','ownerId'],
  Assignments: ['courseId','type','title','description','attachments','dueAt','maxScore','ownerId'],
  Announcements: ['type','title','body','attachments','image','pinned','courseId','grade','room','ownerId']
};
const REQUIRED = { Classes: ['grade'], Categories: ['name'], Courses: ['name'], Lessons: ['courseId','title'],
  Assignments: ['courseId','title','dueAt'], Announcements: ['title'] };

/* ============================== Web App ============================== */
function doGet() {
  let title = 'Classroom PLus';
  try { title = cfg_().schoolName || title; } catch (e) {}
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** จุดเข้าเดียวจากหน้าเว็บ: google.script.run.rpc(fn, token, args) */
function rpc(fn, token, args) {
  try {
    const route = ROUTES[fn];
    if (!route) throw err_('ไม่พบคำสั่ง ' + fn);
    const ctx = { token: token, user: null };
    if (route[0] !== 'public') {
      ctx.user = auth_(token);
      if (!ctx.user) throw err_('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'AUTH');
      if (route[0] === 'admin' && ctx.user.role !== 'admin') throw err_('คุณไม่มีสิทธิ์ใช้งานส่วนนี้', 'FORBIDDEN');
    }
    const data = route[1].apply(null, [ctx].concat(args || []));
    return JSON.parse(JSON.stringify({ ok: true, data: data === undefined ? null : data }));
  } catch (e) {
    if (!e.code) console.error(fn, e && e.stack);
    return { ok: false, error: e.message || String(e), code: e.code || 'ERR' };
  }
}

const ROUTES = {
  // public
  bootstrap: ['public', bootstrap_], login: ['public', login_], registerStudent: ['public', registerStudent_],
  registerAdmin: ['public', registerAdmin_], checkStudentCode: ['public', checkStudentCode_],
  checkUsername: ['public', checkUsername_], forgotCode: ['public', forgotCode_],
  // user (นักเรียน + Admin)
  me: ['user', me_], logout: ['user', logout_], updateProfile: ['user', updateProfile_],
  studentHome: ['user', studentHome_], listCourses: ['user', listCourses_], getCourse: ['user', getCourse_],
  getLesson: ['user', getLesson_], saveProgress: ['user', saveProgress_], listAssignments: ['user', listAssignments_],
  submitWork: ['user', submitWork_], deleteSubmission: ['user', deleteSubmission_],
  listAnnouncements: ['user', listAnnouncements_], search: ['user', search_], uploadFile: ['user', uploadFile_],
  notifications: ['user', notifications_], markRead: ['user', markRead_],
  // admin
  adminDashboard: ['admin', adminDashboard_], list: ['admin', list_], save: ['admin', save_], remove: ['admin', remove_],
  listUsers: ['admin', listUsers_], saveUser: ['admin', saveUser_], deleteUser: ['admin', deleteUser_], importStudents: ['admin', importStudents_],
  setRole: ['admin', setRole_], changeCredentials: ['admin', changeCredentials_],
  listSubmissions: ['admin', listSubmissions_], gradeSubmission: ['admin', gradeSubmission_],
  getSettings: ['admin', getSettings_], saveSettings: ['admin', saveSettings_], report: ['admin', report_],
  auditLog: ['admin', auditLog_], backupNow: ['admin', function () { return backup_(); }],
  listBackups: ['admin', listBackups_], restoreBackup: ['admin', restoreBackup_], installTriggers: ['admin', installTriggers_]
};

/* ============================== Data layer ============================== */
const MEM_ = {};
let SS_ = null;
function props_() { return PropertiesService.getScriptProperties(); }
function sheetId_() { return props_().getProperty('SHEET_ID') || DEFAULTS.SHEET_ID; }
function driveId_() { return props_().getProperty('DRIVE_ID') || DEFAULTS.DRIVE_ID; }
function ss_() { return SS_ || (SS_ = SpreadsheetApp.openById(sheetId_())); }
function sheet_(name) {
  let sh = ss_().getSheetByName(name);
  if (!sh) { ensureSheet_(ss_(), name); sh = ss_().getSheetByName(name); }
  return sh;
}
function ensureSheet_(ss, name) {
  const headers = SCHEMA[name];
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const lastCol = sh.getLastColumn();
  const cur = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String).filter(String) : [];
  const missing = headers.filter(h => cur.indexOf(h) < 0);
  if (missing.length) sh.getRange(1, cur.length + 1, 1, missing.length).setValues([missing]);
  const cols = Math.max(cur.length + missing.length, 1);
  sh.getRange(1, 1, sh.getMaxRows(), cols).setNumberFormat('@'); // เก็บเป็นข้อความ กันวันที่/เลข 0 นำหน้าเพี้ยน
  sh.getRange(1, 1, 1, cols).setFontWeight('bold').setBackground('#dbeafe');
  sh.setFrozenRows(1);
}
function headers_(name) {
  const k = '_h_' + name;
  if (!MEM_[k]) { const sh = sheet_(name); MEM_[k] = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String); }
  return MEM_[k];
}
function rows_(name) {
  if (MEM_[name]) return MEM_[name];
  const values = sheet_(name).getDataRange().getValues();
  const h = values.shift() || [];
  MEM_[name] = values.map((r, i) => {
    const o = { _r: i + 2 };
    h.forEach((k, j) => { if (k) o[k] = r[j] instanceof Date ? Utilities.formatDate(r[j], TZ, "yyyy-MM-dd'T'HH:mm:ss") : String(r[j]); });
    return o;
  }).filter(o => o[h[0]] !== '');
  return MEM_[name];
}
function cell_(v) {
  let s = v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  if (/^[=+@]/.test(s)) s = "'" + s; // กัน formula injection
  return s;
}
function insert_(name, obj) {
  const h = headers_(name);
  const sh = sheet_(name);
  sh.appendRow(h.map(k => cell_(obj[k])));
  const o = { _r: sh.getLastRow() };
  h.forEach(k => o[k] = obj[k] === undefined || obj[k] === null ? '' : (typeof obj[k] === 'object' ? JSON.stringify(obj[k]) : String(obj[k])));
  if (MEM_[name]) MEM_[name].push(o);
  return o;
}
function insertMany_(name, list) {
  if (!list.length) return;
  const h = headers_(name), sh = sheet_(name);
  sh.getRange(sh.getLastRow() + 1, 1, list.length, h.length).setValues(list.map(o => h.map(k => cell_(o[k]))));
  delete MEM_[name];
}
function updateRow_(name, row, patch) {
  const h = headers_(name);
  Object.keys(patch).forEach(k => { if (h.indexOf(k) >= 0) row[k] = typeof patch[k] === 'object' && patch[k] !== null ? JSON.stringify(patch[k]) : String(patch[k] === null || patch[k] === undefined ? '' : patch[k]); });
  sheet_(name).getRange(row._r, 1, 1, h.length).setValues([h.map(k => cell_(row[k]))]);
  return row;
}
function find_(name, id) { return rows_(name).find(r => r.id === String(id)); }
function deleteWhere_(name, pred) {
  const sh = sheet_(name);
  const list = rows_(name).filter(pred).sort((a, b) => b._r - a._r);
  list.forEach(r => sh.deleteRow(r._r));
  delete MEM_[name];
  return list.length;
}
function lock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function id_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 12); }
function now_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"); }
function dt_(s) { return String(s || '').replace(' ', 'T'); }
function err_(msg, code) { const e = new Error(msg); e.code = code || 'VALIDATION'; return e; }
function json_(s, d) { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } }
function str_(v, max) { return String(v === undefined || v === null ? '' : v).trim().slice(0, max || 500); }
function log_(userId, action, detail) {
  try { insert_('AuditLog', { id: id_(), userId: userId || '', action: action, detail: str_(typeof detail === 'object' ? JSON.stringify(detail) : detail, 1000), createdAt: now_() }); } catch (e) {}
}

/* ============================== Setup & Config ============================== */
/** รันครั้งแรกจากตัวแก้ไข Apps Script (หรือระบบรันเองเมื่อมีผู้เปิดเว็บครั้งแรก) — ไม่ลบข้อมูลเดิม */
function setup() {
  return lock_(() => {
    const ss = ss_();
    Object.keys(SCHEMA).forEach(n => ensureSheet_(ss, n));
    Object.keys(MEM_).forEach(k => delete MEM_[k]);
    const cfg = rows_('Config');
    Object.keys(CONFIG_DEFAULTS).forEach(k => { if (!cfg.some(r => r.key === k)) insert_('Config', { key: k, value: CONFIG_DEFAULTS[k], updatedAt: now_() }); });
    if (!rows_('Users').some(u => u.role === 'admin')) {
      const salt = id_();
      insert_('Users', { id: id_(), role: 'admin', username: 'admin', passSalt: salt, passHash: hashPw_('admin123', salt),
        prefix: 'นาย', fullName: 'ผู้ดูแลระบบ', status: 'active', mustChangePassword: 'true', createdAt: now_(), updatedAt: now_() });
    }
    if (!rows_('Courses').length && props_().getProperty('SEEDED') !== sheetId_()) seed_();
    props_().setProperty('SETUP_DONE', sheetId_() + '|' + APP_VERSION);
    return { ok: true, sheetUrl: ss.getUrl(), message: 'สร้าง/ตรวจโครงสร้างชีตเรียบร้อย (ไม่ลบข้อมูลเดิม) Admin เริ่มต้น: admin / admin123' };
  });
}
function ensureSetup_() { if (props_().getProperty('SETUP_DONE') !== sheetId_() + '|' + APP_VERSION) setup(); }
function seed_() {
  const admin = rows_('Users').find(u => u.role === 'admin');
  const t = now_(), o = admin ? admin.id : '';
  [['ม.1', '1'], ['ม.1', '2'], ['ม.2', '1'], ['ม.3', '1']].forEach((g, i) => insert_('Classes', { id: id_(), grade: g[0], room: g[1], order: i + 1, createdAt: t }));
  ['วิทยาการคำนวณ', 'คณิตศาสตร์', 'ภาษาอังกฤษ'].forEach(n => insert_('Categories', { id: id_(), name: n, createdAt: t }));
  const c = insert_('Courses', { id: id_(), code: 'ว21103', name: 'วิทยาการคำนวณ 1', description: 'พื้นฐานแนวคิดเชิงคำนวณและการเขียนโปรแกรม',
    category: 'วิทยาการคำนวณ', grade: 'ม.1', room: '', teacher: 'ครูผู้สอน', order: 1, ownerId: o, createdAt: t, updatedAt: t });
  insert_('Lessons', { id: id_(), courseId: c.id, unit: 'หน่วยที่ 1 แนวคิดเชิงคำนวณ', title: 'การแยกส่วนประกอบปัญหา', description: 'เรียนรู้การแบ่งปัญหาใหญ่เป็นปัญหาย่อย',
    videoUrl: 'https://www.youtube.com/watch?v=mUJBIfBlRcY', videoDuration: '10:00', attachments: '[]', links: JSON.stringify([{ name: 'Code.org', url: 'https://code.org' }]),
    duration: '50', order: 1, publishAt: '', closeAt: '', ownerId: o, createdAt: t, updatedAt: t });
  insert_('Lessons', { id: id_(), courseId: c.id, unit: 'หน่วยที่ 1 แนวคิดเชิงคำนวณ', title: 'การหารูปแบบ', description: 'ฝึกสังเกตรูปแบบที่ซ้ำกัน',
    videoUrl: '', attachments: '[]', links: '[]', duration: '50', order: 2, publishAt: '', closeAt: '', ownerId: o, createdAt: t, updatedAt: t });
  const due = Utilities.formatDate(new Date(Date.now() + 7 * 864e5), TZ, "yyyy-MM-dd'T'16:30:00");
  insert_('Assignments', { id: id_(), courseId: c.id, type: 'การบ้าน', title: 'ใบงานที่ 1 แยกส่วนประกอบปัญหา', description: 'อธิบายขั้นตอนการทำไข่เจียวเป็นขั้นตอนย่อย',
    attachments: '[]', dueAt: due, maxScore: '10', ownerId: o, createdAt: t, updatedAt: t });
  insert_('Announcements', { id: id_(), type: 'ข่าวสาร', title: 'ยินดีต้อนรับสู่ Classroom PLus', body: 'นักเรียนสามารถเข้าดูบทเรียน ส่งงาน และติดตามคะแนนได้ที่นี่',
    attachments: '[]', image: '', pinned: 'true', courseId: '', grade: '', room: '', ownerId: o, createdAt: t, updatedAt: t });
  props_().setProperty('SEEDED', sheetId_());
}
function cfg_() {
  const o = Object.assign({}, CONFIG_DEFAULTS);
  rows_('Config').forEach(r => o[r.key] = r.value);
  return o;
}
function publicCfg_() { const c = cfg_(); PRIVATE_CONFIG.forEach(k => delete c[k]); return c; }
function setCfg_(key, value) {
  const r = rows_('Config').find(x => x.key === key);
  if (r) updateRow_('Config', r, { value: value, updatedAt: now_() });
  else insert_('Config', { key: key, value: value, updatedAt: now_() });
}

/* ============================== Auth ============================== */
function sha_(s) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)); }
function hashPw_(pw, salt) { let h = salt + ':' + pw; for (let i = 0; i < 300; i++) h = sha_(h + salt); return h; }
function pub_(u) {
  if (!u) return null;
  const o = {}; Object.keys(u).forEach(k => { if (['passSalt', 'passHash', '_r'].indexOf(k) < 0) o[k] = u[k]; });
  return o;
}
function throttle_(key, max, minutes) {
  const c = CacheService.getScriptCache(), n = Number(c.get('t_' + key) || 0);
  if (n >= max) throw err_('ทำรายการผิดหลายครั้งเกินไป กรุณารอ ' + minutes + ' นาทีแล้วลองใหม่', 'THROTTLE');
  return () => c.put('t_' + key, String(n + 1), minutes * 60);
}
function createSession_(user, remember) {
  const c = cfg_();
  const hours = remember ? Number(c.rememberDays || 30) * 24 : Number(c.sessionHours || 8);
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const exp = Date.now() + hours * 3600e3;
  const th = sha_(token);
  insert_('Sessions', { id: id_(), userId: user.id, tokenHash: th, expiresAt: String(exp), createdAt: now_() });
  CacheService.getScriptCache().put('s_' + th, JSON.stringify({ u: user.id, e: exp }), Math.min(21600, hours * 3600));
  updateRow_('Users', user, { lastLoginAt: now_() });
  log_(user.id, 'login', user.role);
  return { token: token, expiresAt: exp, user: pub_(user) };
}
function auth_(token) {
  if (!token || typeof token !== 'string' || token.length < 40) return null;
  const th = sha_(token), cache = CacheService.getScriptCache();
  let s = json_(cache.get('s_' + th), null);
  if (!s) {
    const row = rows_('Sessions').find(r => r.tokenHash === th);
    if (!row) return null;
    s = { u: row.userId, e: Number(row.expiresAt) };
    if (s.e > Date.now()) cache.put('s_' + th, JSON.stringify(s), Math.max(1, Math.min(21600, Math.floor((s.e - Date.now()) / 1000))));
  }
  if (s.e < Date.now()) return null;
  const u = find_('Users', s.u);
  return u && u.status === 'active' ? u : null;
}
function killSessions_(userId) {
  const cache = CacheService.getScriptCache();
  rows_('Sessions').filter(r => r.userId === userId).forEach(r => cache.remove('s_' + r.tokenHash));
  deleteWhere_('Sessions', r => r.userId === userId);
}
function bootstrap_() {
  ensureSetup_();
  return { config: publicCfg_(), classes: rows_('Classes').map(pub_).sort((a, b) => a.order - b.order), version: APP_VERSION, maxUploadMB: MAX_UPLOAD_MB };
}
function login_(ctx, f) {
  f = f || {};
  const c = cfg_();
  if (f.mode === 'admin') {
    const un = str_(f.username, 40).toLowerCase();
    const done = throttle_('a_' + un, 5, 10);
    const u = rows_('Users').find(x => x.role === 'admin' && x.username === un);
    if (!u || hashPw_(String(f.password || ''), u.passSalt) !== u.passHash) { done(); throw err_('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'); }
    if (u.status === 'pending') throw err_('บัญชีของคุณรอการอนุมัติจาก Admin');
    if (u.status !== 'active') throw err_('บัญชีนี้ถูกระงับการใช้งาน');
    return createSession_(u, !!f.remember);
  }
  const code = str_(f.studentCode, 5);
  const done = throttle_('s_' + code, 5, 10), doneAll = throttle_('s_all', 60, 10);
  const u = rows_('Users').find(x => x.role === 'student' && x.studentCode === code);
  const birthOk = c.studentLogin !== 'code+birth' || (u && u.birthDate === str_(f.birthDate, 10));
  if (!/^\d{5}$/.test(code) || !u || !birthOk) { done(); doneAll(); throw err_(c.studentLogin === 'code+birth' ? 'รหัสนักเรียนหรือวันเกิดไม่ถูกต้อง' : 'ไม่พบรหัสนักเรียนนี้'); }
  if (u.status !== 'active') throw err_('บัญชีนี้ยังใช้งานไม่ได้ กรุณาติดต่อครูผู้สอน');
  return createSession_(u, !!f.remember);
}
function validPerson_(d) {
  const prefix = str_(d.prefix, 30), fullName = str_(d.fullName, 100).replace(/\s+/g, ' '), birthDate = str_(d.birthDate, 10);
  if (!prefix) throw err_('กรุณาเลือกคำนำหน้าชื่อ');
  if (fullName.length < 3 || fullName.indexOf(' ') < 0) throw err_('กรุณากรอกชื่อและนามสกุล (เว้นวรรคระหว่างชื่อกับสกุล)');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) throw err_('กรุณาเลือกวันเกิด');
  const age = (Date.now() - new Date(birthDate + 'T00:00:00').getTime()) / (365.25 * 864e5);
  if (!(age >= 5 && age <= 100)) throw err_('วันเกิดไม่สมเหตุสมผล (อายุ 5–100 ปี)');
  if (!d.consent) throw err_('กรุณายืนยันความถูกต้องและให้ความยินยอม PDPA');
  return { prefix: prefix, fullName: fullName, birthDate: birthDate };
}
function codeTaken_(code, exceptId) { return rows_('Users').some(u => u.studentCode === code && u.id !== exceptId); }
function userTaken_(un, exceptId) { return rows_('Users').some(u => u.username === un && u.id !== exceptId); }
function checkStudentCode_(ctx, code) {
  throttle_('chk', 120, 10)();
  code = str_(code, 5);
  if (!/^\d{5}$/.test(code)) return { available: false, message: 'ต้องเป็นตัวเลข 5 หลัก' };
  return { available: !codeTaken_(code) };
}
function checkUsername_(ctx, un) {
  throttle_('chk', 120, 10)();
  un = str_(un, 20).toLowerCase();
  if (!/^[a-z0-9._]{4,20}$/.test(un)) return { available: false, message: '4–20 ตัว a-z 0-9 . _' };
  return { available: !userTaken_(un) };
}
function registerStudent_(ctx, d) {
  d = d || {};
  const p = validPerson_(d), code = str_(d.studentCode, 5);
  if (!/^\d{5}$/.test(code)) throw err_('รหัสนักเรียนต้องเป็นตัวเลข 5 หลัก');
  const classes = rows_('Classes');
  if (classes.length && !classes.some(c => c.grade === d.grade && (!d.room || c.room === d.room))) throw err_('กรุณาเลือกระดับชั้น/ห้อง');
  return lock_(() => {
    delete MEM_.Users;
    if (codeTaken_(code)) throw err_('รหัสนักเรียนนี้ถูกใช้แล้ว');
    const u = insert_('Users', Object.assign(p, { id: id_(), role: 'student', studentCode: code, grade: str_(d.grade, 20), room: str_(d.room, 20),
      email: str_(d.email, 100), status: 'active', mustChangePassword: 'false', createdAt: now_(), updatedAt: now_() }));
    log_(u.id, 'register', 'student');
    return createSession_(u, !!d.remember);
  });
}
function registerAdmin_(ctx, d) {
  d = d || {};
  const c = cfg_();
  if (c.allowAdminSignup !== 'true') throw err_('ระบบปิดการสมัครบัญชีครูผู้สอน');
  const p = validPerson_(d), un = str_(d.username, 20).toLowerCase(), pw = String(d.password || '');
  if (!/^[a-z0-9._]{4,20}$/.test(un)) throw err_('Username ต้องมี 4–20 ตัว (a-z 0-9 . _)');
  if (pw.length < 8) throw err_('รหัสผ่านอย่างน้อย 8 ตัว');
  if (pw !== String(d.confirm || '')) throw err_('ยืนยันรหัสผ่านไม่ตรงกัน');
  return lock_(() => {
    delete MEM_.Users;
    if (userTaken_(un)) throw err_('Username นี้ถูกใช้แล้ว');
    const salt = id_(), pending = c.requireApproval === 'true';
    const u = insert_('Users', Object.assign(p, { id: id_(), role: 'admin', username: un, passSalt: salt, passHash: hashPw_(pw, salt),
      email: str_(d.email, 100), status: pending ? 'pending' : 'active', mustChangePassword: 'false', createdAt: now_(), updatedAt: now_() }));
    log_(u.id, 'register', 'admin' + (pending ? ' (pending)' : ''));
    if (pending) return { pending: true };
    return createSession_(u, !!d.remember);
  });
}
function forgotCode_(ctx, d) {
  d = d || {};
  const done = throttle_('fg', 20, 10);
  const name = str_(d.fullName, 100).replace(/\s+/g, ' '), bd = str_(d.birthDate, 10), code = str_(d.newCode, 5);
  const list = rows_('Users').filter(u => u.role === 'student' && u.fullName === name && u.birthDate === bd);
  if (list.length !== 1) { done(); throw err_('ข้อมูลไม่ตรงกับในระบบ กรุณาติดต่อครูผู้สอน'); }
  if (!/^\d{5}$/.test(code)) throw err_('รหัสนักเรียนใหม่ต้องเป็นตัวเลข 5 หลัก');
  return lock_(() => {
    if (codeTaken_(code, list[0].id)) throw err_('รหัสนักเรียนนี้ถูกใช้แล้ว');
    updateRow_('Users', list[0], { studentCode: code, updatedAt: now_() });
    killSessions_(list[0].id);
    log_(list[0].id, 'forgot_code', '');
    return { ok: true };
  });
}
function me_(ctx) {
  return { user: pub_(ctx.user), config: publicCfg_(), classes: rows_('Classes').map(pub_),
    unread: rows_('Notifications').filter(n => n.ownerId === ctx.user.id && n.read !== 'true').length };
}
function logout_(ctx) {
  const th = sha_(ctx.token);
  CacheService.getScriptCache().remove('s_' + th);
  deleteWhere_('Sessions', r => r.tokenHash === th);
  log_(ctx.user.id, 'logout', '');
  return true;
}
function updateProfile_(ctx, d) {
  d = d || {};
  const u = ctx.user, patch = { updatedAt: now_() };
  if (d.prefix !== undefined) patch.prefix = str_(d.prefix, 30);
  if (d.fullName !== undefined) { const n = str_(d.fullName, 100).replace(/\s+/g, ' '); if (n.length < 3) throw err_('กรุณากรอกชื่อ-สกุล'); patch.fullName = n; }
  if (d.email !== undefined) { const e = str_(d.email, 100); if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw err_('อีเมลไม่ถูกต้อง'); patch.email = e; }
  if (d.avatar !== undefined) { if (d.avatar && (!/^data:image\/(jpeg|png|webp);base64,/.test(d.avatar) || d.avatar.length > 45000)) throw err_('รูปโปรไฟล์ไม่ถูกต้องหรือใหญ่เกินไป'); patch.avatar = d.avatar; }
  return lock_(() => {
    if (u.role === 'student' && d.studentCode !== undefined && d.studentCode !== u.studentCode) {
      const code = str_(d.studentCode, 5);
      if (!/^\d{5}$/.test(code)) throw err_('รหัสนักเรียนต้องเป็นตัวเลข 5 หลัก');
      if (codeTaken_(code, u.id)) throw err_('รหัสนักเรียนนี้ถูกใช้แล้ว');
      patch.studentCode = code;
    }
    updateRow_('Users', u, patch);
    log_(u.id, 'update_profile', Object.keys(patch).join(','));
    return pub_(u);
  });
}

/* ============================== สิทธิ์การมองเห็น ============================== */
function match_(u, grade, room) { return u.role === 'admin' || ((!grade || grade === u.grade) && (!room || room === u.room)); }
function courseOk_(u, c) { return !!c && match_(u, c.grade, c.room); }
function lessonOk_(u, l) {
  if (!l || !courseOk_(u, find_('Courses', l.courseId))) return false;
  if (u.role === 'admin') return true;
  const n = now_();
  return (!l.publishAt || dt_(l.publishAt) <= n) && (!l.closeAt || dt_(l.closeAt) > n);
}
function annOk_(u, a) { return match_(u, a.grade, a.room) && (!a.courseId || courseOk_(u, find_('Courses', a.courseId))); }
function byOrder_(a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.createdAt).localeCompare(String(b.createdAt)); }
function subStatus_(a, s) {
  if (s && s.score !== '') return 'graded';
  if (s) return s.status || 'submitted';
  return dt_(a.dueAt) < now_() ? 'overdue' : 'pending';
}

/* ============================== นักเรียน ============================== */
function myProgress_(uid) { const m = {}; rows_('Progress').filter(p => p.ownerId === uid).forEach(p => m[p.lessonId] = p); return m; }
function courseCards_(u) {
  const prog = myProgress_(u.id), lessons = rows_('Lessons');
  return rows_('Courses').filter(c => courseOk_(u, c)).sort(byOrder_).map(c => {
    const ls = lessons.filter(l => l.courseId === c.id && lessonOk_(u, l));
    const done = ls.filter(l => prog[l.id] && prog[l.id].completed === 'true').length;
    return Object.assign(pub_(c), { lessonCount: ls.length, doneCount: done, percent: ls.length ? Math.round(done * 100 / ls.length) : 0 });
  });
}
function studentHome_(ctx) {
  const u = ctx.user, courses = courseCards_(u), prog = myProgress_(u.id);
  const asg = assignmentsFor_(u);
  const graded = asg.filter(a => a.status === 'graded').sort((a, b) => String(b.sub.gradedAt).localeCompare(String(a.sub.gradedAt)));
  const totalL = courses.reduce((s, c) => s + c.lessonCount, 0), doneL = courses.reduce((s, c) => s + c.doneCount, 0);
  const scores = graded.map(a => Number(a.sub.score) * 100 / (Number(a.maxScore) || 100));
  return {
    courses: courses,
    stats: { lessonsDone: doneL, lessonsTotal: totalL, percent: totalL ? Math.round(doneL * 100 / totalL) : 0,
      videosDone: Object.keys(prog).filter(k => prog[k].videoDone === 'true').length,
      submitted: asg.filter(a => a.sub).length, pending: asg.filter(a => !a.sub).length,
      avgScore: scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : null },
    pending: asg.filter(a => !a.sub).sort((a, b) => dt_(a.dueAt).localeCompare(dt_(b.dueAt))).slice(0, 6),
    latestScores: graded.slice(0, 5),
    announcements: listAnnouncements_(ctx).slice(0, 3)
  };
}
function listCourses_(ctx) { return courseCards_(ctx.user); }
function getCourse_(ctx, id) {
  const u = ctx.user, c = find_('Courses', id);
  if (!courseOk_(u, c)) throw err_('ไม่พบรายวิชา หรือคุณไม่มีสิทธิ์เข้าถึง', 'FORBIDDEN');
  const prog = myProgress_(u.id);
  const lessons = rows_('Lessons').filter(l => l.courseId === c.id && lessonOk_(u, l)).sort(byOrder_)
    .map(l => Object.assign(pub_(l), { progress: prog[l.id] ? pub_(prog[l.id]) : null }));
  return { course: pub_(c), lessons: lessons, assignments: assignmentsFor_(u).filter(a => a.courseId === c.id) };
}
function getLesson_(ctx, id) {
  const u = ctx.user, l = find_('Lessons', id);
  if (!lessonOk_(u, l)) throw err_('บทเรียนนี้ยังไม่เปิดหรือปิดการเข้าถึงแล้ว', 'FORBIDDEN');
  const p = upsertProgress_(u, l, { viewed: true });
  log_(u.id, 'view_lesson', l.id);
  const c = find_('Courses', l.courseId);
  const sib = rows_('Lessons').filter(x => x.courseId === l.courseId && lessonOk_(u, x)).sort(byOrder_);
  const i = sib.findIndex(x => x.id === l.id);
  return { lesson: pub_(l), course: pub_(c), progress: pub_(p), prevId: i > 0 ? sib[i - 1].id : '', nextId: i < sib.length - 1 ? sib[i + 1].id : '' };
}
function upsertProgress_(u, l, d) {
  return lock_(() => {
    delete MEM_.Progress;
    let p = rows_('Progress').find(x => x.ownerId === u.id && x.lessonId === l.id);
    const patch = { updatedAt: now_() };
    if (d.viewed) patch.views = String((p ? Number(p.views) || 0 : 0) + 1);
    if (d.videoPos !== undefined) patch.videoPos = String(Math.max(0, Math.floor(Number(d.videoPos) || 0)));
    if (d.videoDone) patch.videoDone = 'true';
    if (d.completed !== undefined) patch.completed = d.completed ? 'true' : 'false';
    if (!p) return insert_('Progress', Object.assign({ id: id_(), ownerId: u.id, lessonId: l.id, courseId: l.courseId, completed: 'false', videoPos: '0', videoDone: 'false', views: '0' }, patch));
    return updateRow_('Progress', p, patch);
  });
}
function saveProgress_(ctx, lessonId, d) {
  const l = find_('Lessons', lessonId);
  if (!lessonOk_(ctx.user, l)) throw err_('ไม่มีสิทธิ์', 'FORBIDDEN');
  return pub_(upsertProgress_(ctx.user, l, d || {}));
}
function assignmentsFor_(u) {
  const subs = {}; rows_('Submissions').filter(s => s.ownerId === u.id).forEach(s => subs[s.assignmentId] = s);
  const courses = {}; rows_('Courses').forEach(c => courses[c.id] = c);
  return rows_('Assignments').filter(a => courseOk_(u, courses[a.courseId])).map(a => {
    const s = subs[a.id] || null;
    return Object.assign(pub_(a), { courseName: courses[a.courseId].name, sub: s ? pub_(s) : null, status: subStatus_(a, s) });
  });
}
function listAssignments_(ctx) { return assignmentsFor_(ctx.user).sort((a, b) => dt_(b.dueAt).localeCompare(dt_(a.dueAt))); }
function cleanFiles_(files) {
  return (Array.isArray(files) ? files : []).slice(0, 20).map(f => ({ id: str_(f.id, 100), name: str_(f.name, 200), url: str_(f.url, 500), mime: str_(f.mime, 100), size: Number(f.size) || 0 }))
    .filter(f => /^https:\/\//.test(f.url));
}
function submitWork_(ctx, assignmentId, d) {
  d = d || {};
  const u = ctx.user, a = find_('Assignments', assignmentId);
  if (!a || !courseOk_(u, find_('Courses', a.courseId))) throw err_('ไม่พบงานนี้', 'FORBIDDEN');
  const text = str_(d.text, 5000), files = cleanFiles_(d.files), link = str_(d.driveLink, 500);
  if (link && !/^https:\/\/(drive|docs)\.google\.com\//.test(link)) throw err_('ลิงก์ต้องเป็น Google Drive/Docs');
  if (!text && !files.length && !link) throw err_('กรุณาแนบไฟล์ ลิงก์ หรือพิมพ์ข้อความอย่างน้อย 1 อย่าง');
  return lock_(() => {
    delete MEM_.Submissions;
    const s = rows_('Submissions').find(x => x.assignmentId === a.id && x.ownerId === u.id);
    const late = dt_(a.dueAt) < now_();
    if (s) {
      if (s.score !== '') throw err_('งานนี้ครูตรวจแล้ว แก้ไขไม่ได้');
      if (late) throw err_('หมดเวลาแก้ไขงานแล้ว');
      const hist = json_(s.history, []); hist.push({ at: s.updatedAt || s.submittedAt, text: s.text, files: json_(s.files, []).length, link: s.driveLink });
      updateRow_('Submissions', s, { text: text, files: files, driveLink: link, history: hist.slice(-20), updatedAt: now_() });
      log_(u.id, 'edit_submission', a.id);
      return pub_(s);
    }
    const n = insert_('Submissions', { id: id_(), assignmentId: a.id, ownerId: u.id, text: text, files: files, driveLink: link,
      status: late ? 'late' : 'ontime', submittedAt: now_(), score: '', feedback: '', history: '[]', updatedAt: now_() });
    log_(u.id, 'submit', a.id);
    if (a.ownerId && a.ownerId !== u.id) notifyUsers_([a.ownerId], 'มีงานส่งใหม่', u.fullName + ' ส่ง "' + a.title + '"' + (late ? ' (ส่งช้า)' : ''), 'grade:' + a.id);
    return pub_(n);
  });
}
function deleteSubmission_(ctx, assignmentId) {
  const a = find_('Assignments', assignmentId);
  return lock_(() => {
    delete MEM_.Submissions;
    const s = rows_('Submissions').find(x => x.assignmentId === assignmentId && x.ownerId === ctx.user.id);
    if (!s) throw err_('ไม่พบงานที่ส่ง');
    if (s.score !== '') throw err_('งานนี้ครูตรวจแล้ว ยกเลิกไม่ได้');
    if (a && dt_(a.dueAt) < now_()) throw err_('หมดเวลาแก้ไขงานแล้ว');
    deleteWhere_('Submissions', x => x.id === s.id);
    log_(ctx.user.id, 'unsubmit', assignmentId);
    return true;
  });
}
function listAnnouncements_(ctx) {
  const u = ctx.user;
  return rows_('Announcements').filter(a => annOk_(u, a)).map(pub_)
    .sort((a, b) => (b.pinned === 'true') - (a.pinned === 'true') || String(b.createdAt).localeCompare(String(a.createdAt)));
}
function notifications_(ctx) {
  return rows_('Notifications').filter(n => n.ownerId === ctx.user.id).map(pub_).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 40);
}
function markRead_(ctx) {
  return lock_(() => {
    delete MEM_.Notifications;
    rows_('Notifications').filter(n => n.ownerId === ctx.user.id && n.read !== 'true').forEach(n => updateRow_('Notifications', n, { read: 'true' }));
    return true;
  });
}
function search_(ctx, f) {
  f = f || {};
  const u = ctx.user, q = str_(f.q, 100).toLowerCase(), out = [];
  const users = {}; rows_('Users').forEach(x => users[x.id] = x.fullName);
  const courses = {}; rows_('Courses').forEach(c => courses[c.id] = c);
  const has = s => !q || String(s).toLowerCase().indexOf(q) >= 0;
  const inDate = d => (!f.from || String(d).slice(0, 10) >= f.from) && (!f.to || String(d).slice(0, 10) <= f.to);
  const extOk = att => !f.fileType || json_(att, []).some(x => String(x.name).toLowerCase().split('.').pop() === f.fileType);
  const roomOk = c => !f.room || (c && (c.grade + '/' + c.room) === f.room) || (c && c.grade === f.room.split('/')[0] && !c.room);
  rows_('Courses').filter(c => courseOk_(u, c) && (!f.courseId || c.id === f.courseId) && roomOk(c) && inDate(c.createdAt) && !f.fileType)
    .forEach(c => { if (has(c.name + c.code + c.description + c.category + c.teacher + users[c.ownerId])) out.push({ kind: 'course', id: c.id, title: c.name, sub: c.category + ' · ' + (c.teacher || users[c.ownerId] || ''), date: c.createdAt }); });
  rows_('Lessons').filter(l => lessonOk_(u, l) && (!f.courseId || l.courseId === f.courseId) && roomOk(courses[l.courseId]) && inDate(l.createdAt) && extOk(l.attachments))
    .forEach(l => { const c = courses[l.courseId]; if (has(l.title + l.description + l.unit + c.name + c.category + c.teacher + users[l.ownerId])) out.push({ kind: 'lesson', id: l.id, title: l.title, sub: c.name + ' · ' + l.unit, date: l.createdAt }); });
  rows_('Assignments').filter(a => courseOk_(u, courses[a.courseId]) && (!f.courseId || a.courseId === f.courseId) && roomOk(courses[a.courseId]) && inDate(a.createdAt) && extOk(a.attachments))
    .forEach(a => { if (has(a.title + a.description + a.type + courses[a.courseId].name)) out.push({ kind: 'assignment', id: a.id, title: a.title, sub: courses[a.courseId].name + ' · กำหนดส่ง ' + a.dueAt, date: a.createdAt }); });
  rows_('Announcements').filter(a => annOk_(u, a) && !f.courseId && inDate(a.createdAt) && extOk(a.attachments))
    .forEach(a => { if (has(a.title + a.body + a.type)) out.push({ kind: 'announcement', id: a.id, title: a.title, sub: a.type, date: a.createdAt }); });
  return out.slice(0, 200);
}

/* ============================== ไฟล์ (Google Drive) ============================== */
function folder_(sub) {
  const root = DriveApp.getFolderById(driveId_());
  if (!sub) return root;
  const it = root.getFoldersByName(sub);
  return it.hasNext() ? it.next() : root.createFolder(sub);
}
function uploadFile_(ctx, f) {
  f = f || {};
  const name = str_(f.name, 200).replace(/[\\/:*?"<>|]/g, '_'), ext = name.toLowerCase().split('.').pop();
  if (ALLOWED_EXT.indexOf(ext) < 0) throw err_('ไม่รองรับไฟล์ชนิด .' + ext);
  const data = String(f.data || '');
  if (data.length * 0.75 > MAX_UPLOAD_MB * 1048576) throw err_('ไฟล์ใหญ่เกิน ' + MAX_UPLOAD_MB + ' MB กรุณาอัปโหลดไว้ใน Google Drive แล้วแนบเป็นลิงก์');
  const sub = ctx.user.role === 'admin' && f.kind !== 'submission' ? 'Materials' : 'Submissions';
  const blob = Utilities.newBlob(Utilities.base64Decode(data), str_(f.mime, 100) || 'application/octet-stream', name);
  const file = folder_(sub).createFile(blob);
  file.setDescription('owner:' + ctx.user.id);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* Workspace บางแห่งห้ามแชร์สาธารณะ */ }
  log_(ctx.user.id, 'upload', name);
  return { id: file.getId(), name: name, url: file.getUrl(), mime: blob.getContentType(), size: file.getSize() };
}

/* ============================== แจ้งเตือน ============================== */
function studentsFor_(grade, room, courseId) {
  if (courseId) { const c = find_('Courses', courseId); if (c) { grade = grade || c.grade; room = room || c.room; } }
  return rows_('Users').filter(u => u.role === 'student' && u.status === 'active' && (!grade || u.grade === grade) && (!room || u.room === room));
}
function notifyUsers_(ids, title, body, link) {
  insertMany_('Notifications', ids.map(id => ({ id: id_(), ownerId: id, title: title, body: body, link: link || '', read: 'false', createdAt: now_() })));
}
function broadcast_(students, title, body, link) {
  notifyUsers_(students.map(s => s.id), title, body, link);
  const c = cfg_();
  if (c.emailNotify === 'true') {
    students.filter(s => s.email).slice(0, Math.max(0, MailApp.getRemainingDailyQuota() - 5)).forEach(s => {
      try { MailApp.sendEmail(s.email, '[' + c.schoolName + '] ' + title, body + '\n\n' + ScriptApp.getService().getUrl()); } catch (e) {}
    });
  }
  if (c.lineToken) { // LINE Messaging API (LINE Notify ปิดบริการแล้วตั้งแต่ 31 มี.ค. 2025)
    try {
      UrlFetchApp.fetch('https://api.line.me/v2/bot/message/broadcast', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + c.lineToken }, payload: JSON.stringify({ messages: [{ type: 'text', text: '📢 ' + title + '\n' + body }] }) });
    } catch (e) {}
  }
}

/* ============================== Admin: ข้อมูลทั่วไป ============================== */
function list_(ctx, entity) {
  if (!EDITABLE[entity]) throw err_('ไม่รู้จักตาราง ' + entity);
  return rows_(entity).map(pub_).sort(byOrder_);
}
function save_(ctx, entity, obj) {
  if (!EDITABLE[entity]) throw err_('ไม่รู้จักตาราง ' + entity);
  obj = obj || {};
  const data = {};
  EDITABLE[entity].forEach(k => { if (obj[k] !== undefined) data[k] = typeof obj[k] === 'object' ? obj[k] : str_(obj[k], k === 'description' || k === 'body' ? 20000 : (k === 'cover' || k === 'image' ? 48000 : 2000)); });
  (REQUIRED[entity] || []).forEach(k => { if (!obj.id && !String(data[k] || '').trim()) throw err_('กรุณากรอกข้อมูลให้ครบ (' + k + ')'); });
  ['attachments', 'links'].forEach(k => { if (data[k] !== undefined) data[k] = k === 'links' ? (Array.isArray(data[k]) ? data[k] : json_(data[k], [])).filter(x => /^https?:\/\//.test(x.url)).slice(0, 30) : cleanFiles_(Array.isArray(data[k]) ? data[k] : json_(data[k], [])); });
  if (data.maxScore !== undefined && !(Number(data.maxScore) > 0)) throw err_('คะแนนเต็มต้องมากกว่า 0');
  ['dueAt', 'publishAt', 'closeAt'].forEach(k => { if (data[k]) data[k] = dt_(data[k]); });
  if (data.publishAt && data.closeAt && data.closeAt <= data.publishAt) throw err_('วันปิดการเข้าถึงต้องหลังวันเผยแพร่');
  if (data.courseId && !find_('Courses', data.courseId)) throw err_('ไม่พบรายวิชา');
  return lock_(() => {
    let row;
    if (obj.id) {
      row = find_(entity, obj.id);
      if (!row) throw err_('ไม่พบข้อมูลที่จะแก้ไข');
      data.updatedAt = now_();
      updateRow_(entity, row, data);
      log_(ctx.user.id, 'update_' + entity, obj.id);
    } else {
      row = insert_(entity, Object.assign({ id: id_(), ownerId: ctx.user.id, createdAt: now_(), updatedAt: now_() }, data));
      log_(ctx.user.id, 'create_' + entity, row.id);
      if (entity === 'Lessons' && !(row.publishAt && row.publishAt > now_())) broadcast_(studentsFor_('', '', row.courseId), 'บทเรียนใหม่: ' + row.title, find_('Courses', row.courseId).name, 'lesson:' + row.id);
      if (entity === 'Assignments') broadcast_(studentsFor_('', '', row.courseId), row.type + 'ใหม่: ' + row.title, 'กำหนดส่ง ' + row.dueAt.replace('T', ' ').slice(0, 16), 'assignment:' + row.id);
      if (entity === 'Announcements') broadcast_(studentsFor_(row.grade, row.room, row.courseId), (row.type || 'ประกาศ') + ': ' + row.title, str_(row.body, 200), 'announcement:' + row.id);
    }
    return pub_(row);
  });
}
function remove_(ctx, entity, id) {
  if (!EDITABLE[entity]) throw err_('ไม่รู้จักตาราง ' + entity);
  return lock_(() => {
    const row = find_(entity, id);
    if (!row) throw err_('ไม่พบข้อมูล');
    const counts = {};
    if (entity === 'Courses') {
      const asg = rows_('Assignments').filter(a => a.courseId === id).map(a => a.id);
      counts.Submissions = deleteWhere_('Submissions', s => asg.indexOf(s.assignmentId) >= 0);
      counts.Assignments = deleteWhere_('Assignments', a => a.courseId === id);
      counts.Progress = deleteWhere_('Progress', p => p.courseId === id);
      counts.Lessons = deleteWhere_('Lessons', l => l.courseId === id);
    }
    if (entity === 'Lessons') counts.Progress = deleteWhere_('Progress', p => p.lessonId === id);
    if (entity === 'Assignments') counts.Submissions = deleteWhere_('Submissions', s => s.assignmentId === id);
    deleteWhere_(entity, r => r.id === id);
    log_(ctx.user.id, 'delete_' + entity, { id: id, name: row.name || row.title || row.grade, cascade: counts });
    return counts;
  });
}

/* ============================== Admin: ผู้ใช้ ============================== */
function listUsers_() { return rows_('Users').map(pub_).sort((a, b) => (a.role > b.role ? 1 : -1) || String(a.studentCode).localeCompare(String(b.studentCode))); }
function activeAdmins_(exceptId) { return rows_('Users').filter(u => u.role === 'admin' && u.status === 'active' && u.id !== exceptId).length; }
function saveUser_(ctx, d) {
  d = d || {};
  return lock_(() => {
    const isNew = !d.id, u = isNew ? null : find_('Users', d.id);
    if (!isNew && !u) throw err_('ไม่พบผู้ใช้');
    const role = isNew ? (d.role === 'admin' ? 'admin' : 'student') : u.role;
    const patch = { updatedAt: now_() };
    ['prefix', 'fullName', 'birthDate', 'grade', 'room', 'email'].forEach(k => { if (d[k] !== undefined) patch[k] = str_(d[k], 100); });
    if (d.status !== undefined) {
      if (['active', 'pending', 'disabled'].indexOf(d.status) < 0) throw err_('สถานะไม่ถูกต้อง');
      if (!isNew && u.role === 'admin' && d.status !== 'active' && !activeAdmins_(u.id)) throw err_('ต้องมี Admin ที่ใช้งานได้อย่างน้อย 1 คน');
      if (!isNew && u.id === ctx.user.id && d.status !== 'active') throw err_('ระงับบัญชีที่กำลังใช้งานอยู่ไม่ได้');
      patch.status = d.status;
    }
    if (role === 'student' && (isNew || d.studentCode !== undefined)) {
      const code = str_(d.studentCode, 5);
      if (!/^\d{5}$/.test(code)) throw err_('รหัสนักเรียนต้องเป็นตัวเลข 5 หลัก');
      if (codeTaken_(code, d.id)) throw err_('รหัสนักเรียนนี้ถูกใช้แล้ว');
      patch.studentCode = code;
    }
    if (role === 'admin' && (isNew || d.username)) {
      const un = str_(d.username, 20).toLowerCase();
      if (!/^[a-z0-9._]{4,20}$/.test(un)) throw err_('Username ต้องมี 4–20 ตัว (a-z 0-9 . _)');
      if (userTaken_(un, d.id)) throw err_('Username นี้ถูกใช้แล้ว');
      patch.username = un;
    }
    if (role === 'admin' && (isNew || d.password)) {
      if (String(d.password || '').length < 8) throw err_('รหัสผ่านอย่างน้อย 8 ตัว');
      patch.passSalt = id_(); patch.passHash = hashPw_(String(d.password), patch.passSalt); patch.mustChangePassword = 'true';
    }
    if (!String(patch.fullName || (u && u.fullName) || '').trim()) throw err_('กรุณากรอกชื่อ-สกุล');
    let row;
    if (isNew) row = insert_('Users', Object.assign({ id: id_(), role: role, status: 'active', createdAt: now_() }, patch));
    else { row = updateRow_('Users', u, patch); if (patch.studentCode || patch.passHash || patch.status === 'disabled') killSessions_(u.id); }
    log_(ctx.user.id, isNew ? 'create_user' : 'update_user', row.id);
    return pub_(row);
  });
}
/** นำเข้านักเรียนจาก Excel/CSV: [{studentCode,prefix,fullName,birthDate,grade,room,email}] */
function importStudents_(ctx, list) {
  list = (Array.isArray(list) ? list : []).slice(0, 2000);
  return lock_(() => {
    const out = { added: 0, skipped: [] }, add = [];
    const codes = {}; rows_('Users').forEach(u => { if (u.studentCode) codes[u.studentCode] = 1; });
    list.forEach((r, i) => {
      const code = str_(r.studentCode, 5).padStart(5, '0'), name = str_(r.fullName, 100).replace(/\s+/g, ' ');
      if (!/^\d{5}$/.test(code) || !name) return out.skipped.push('แถว ' + (i + 2) + ': รหัส/ชื่อไม่ถูกต้อง');
      if (codes[code]) return out.skipped.push('แถว ' + (i + 2) + ': รหัส ' + code + ' ซ้ำ');
      codes[code] = 1;
      add.push({ id: id_(), role: 'student', studentCode: code, prefix: str_(r.prefix, 30), fullName: name, birthDate: str_(r.birthDate, 10),
        grade: str_(r.grade, 20), room: str_(r.room, 20), email: str_(r.email, 100), status: 'active', mustChangePassword: 'false', createdAt: now_(), updatedAt: now_() });
    });
    insertMany_('Users', add);
    out.added = add.length;
    log_(ctx.user.id, 'import_students', out.added + ' added');
    return out;
  });
}
function deleteUser_(ctx, id) {
  return lock_(() => {
    const u = find_('Users', id);
    if (!u) throw err_('ไม่พบผู้ใช้');
    if (u.id === ctx.user.id) throw err_('ลบบัญชีที่กำลังใช้งานอยู่ไม่ได้');
    if (u.role === 'admin' && !activeAdmins_(u.id)) throw err_('ลบ Admin คนสุดท้ายไม่ได้');
    killSessions_(id);
    const counts = { Submissions: deleteWhere_('Submissions', s => s.ownerId === id), Progress: deleteWhere_('Progress', p => p.ownerId === id),
      Notifications: deleteWhere_('Notifications', n => n.ownerId === id) };
    deleteWhere_('Users', x => x.id === id);
    log_(ctx.user.id, 'delete_user', { id: id, name: u.fullName, cascade: counts });
    return counts;
  });
}
function setRole_(ctx, id, role, extra) {
  extra = extra || {};
  return lock_(() => {
    const u = find_('Users', id);
    if (!u) throw err_('ไม่พบผู้ใช้');
    if (u.role === role) return pub_(u);
    if (role === 'admin') {
      const un = str_(extra.username, 20).toLowerCase(), pw = String(extra.password || '');
      if (!/^[a-z0-9._]{4,20}$/.test(un)) throw err_('Username ต้องมี 4–20 ตัว (a-z 0-9 . _)');
      if (userTaken_(un, id)) throw err_('Username นี้ถูกใช้แล้ว');
      if (pw.length < 8) throw err_('รหัสผ่านอย่างน้อย 8 ตัว');
      const salt = id_();
      updateRow_('Users', u, { role: 'admin', username: un, passSalt: salt, passHash: hashPw_(pw, salt), mustChangePassword: 'true', updatedAt: now_() });
    } else if (role === 'student') {
      if (u.id === ctx.user.id) throw err_('ลดสิทธิ์บัญชีที่กำลังใช้งานอยู่ไม่ได้');
      if (!activeAdmins_(u.id)) throw err_('ลดสิทธิ์ Admin คนสุดท้ายไม่ได้');
      const code = str_(extra.studentCode || u.studentCode, 5);
      if (!/^\d{5}$/.test(code)) throw err_('กรุณากำหนดรหัสนักเรียน 5 หลัก');
      if (codeTaken_(code, id)) throw err_('รหัสนักเรียนนี้ถูกใช้แล้ว');
      updateRow_('Users', u, { role: 'student', studentCode: code, updatedAt: now_() });
    } else throw err_('สิทธิ์ไม่ถูกต้อง');
    killSessions_(id);
    log_(ctx.user.id, 'set_role', { id: id, role: role });
    return pub_(u);
  });
}
function changeCredentials_(ctx, d) {
  d = d || {};
  const u = ctx.user;
  if (hashPw_(String(d.currentPassword || ''), u.passSalt) !== u.passHash) throw err_('รหัสผ่านปัจจุบันไม่ถูกต้อง');
  return lock_(() => {
    const patch = { updatedAt: now_() };
    const un = str_(d.username || u.username, 20).toLowerCase();
    if (!/^[a-z0-9._]{4,20}$/.test(un)) throw err_('Username ต้องมี 4–20 ตัว (a-z 0-9 . _)');
    if (userTaken_(un, u.id)) throw err_('Username นี้ถูกใช้แล้ว');
    patch.username = un;
    if (d.newPassword) {
      if (String(d.newPassword).length < 8) throw err_('รหัสผ่านใหม่อย่างน้อย 8 ตัว');
      if (d.newPassword === 'admin123') throw err_('กรุณาใช้รหัสผ่านอื่นที่ไม่ใช่ค่าเริ่มต้น');
      patch.passSalt = id_(); patch.passHash = hashPw_(String(d.newPassword), patch.passSalt); patch.mustChangePassword = 'false';
    }
    updateRow_('Users', u, patch);
    log_(u.id, 'change_credentials', '');
    return pub_(u);
  });
}

/* ============================== Admin: งาน / คะแนน ============================== */
function listSubmissions_(ctx, assignmentId) {
  const a = find_('Assignments', assignmentId);
  if (!a) throw err_('ไม่พบงาน');
  const c = find_('Courses', a.courseId);
  const subs = rows_('Submissions').filter(s => s.assignmentId === a.id);
  const students = studentsFor_(c.grade, c.room);
  const ids = {}; students.forEach(s => ids[s.id] = 1);
  subs.forEach(s => { if (!ids[s.ownerId]) { const u = find_('Users', s.ownerId); if (u) students.push(u); } });
  return { assignment: pub_(a), course: pub_(c), rows: students.map(u => {
    const s = subs.find(x => x.ownerId === u.id) || null;
    return { user: { id: u.id, fullName: u.prefix + u.fullName, studentCode: u.studentCode, grade: u.grade, room: u.room }, sub: s ? pub_(s) : null, status: subStatus_(a, s) };
  }).sort((x, y) => String(x.user.studentCode).localeCompare(String(y.user.studentCode))) };
}
function gradeSubmission_(ctx, subId, score, feedback) {
  return lock_(() => {
    const s = find_('Submissions', subId);
    if (!s) throw err_('ไม่พบงานที่ส่ง');
    const a = find_('Assignments', s.assignmentId), n = Number(score);
    if (score === '' || isNaN(n) || n < 0 || n > Number(a.maxScore)) throw err_('คะแนนต้องอยู่ระหว่าง 0–' + a.maxScore);
    updateRow_('Submissions', s, { score: String(n), feedback: str_(feedback, 2000), gradedBy: ctx.user.id, gradedAt: now_(), updatedAt: now_() });
    notifyUsers_([s.ownerId], 'ครูตรวจงานแล้ว', a.title + ' ได้ ' + n + '/' + a.maxScore + ' คะแนน', 'assignment:' + a.id);
    log_(ctx.user.id, 'grade', { sub: subId, score: n });
    return pub_(s);
  });
}

/* ============================== Admin: Dashboard / รายงาน ============================== */
function days_(n) { const out = []; for (let i = n - 1; i >= 0; i--) out.push(Utilities.formatDate(new Date(Date.now() - i * 864e5), TZ, 'yyyy-MM-dd')); return out; }
function adminDashboard_() {
  const users = rows_('Users'), d = days_(14), logs = rows_('AuditLog');
  const count = (list, field) => d.map(day => list.filter(x => String(x[field]).slice(0, 10) === day).length);
  const subs = rows_('Submissions');
  return {
    cards: { courses: rows_('Courses').length, lessons: rows_('Lessons').length, students: users.filter(u => u.role === 'student').length,
      ungraded: subs.filter(s => s.score === '').length, assignments: rows_('Assignments').length, pendingUsers: users.filter(u => u.status === 'pending').length },
    days: d, logins: count(logs.filter(l => l.action === 'login'), 'createdAt'), views: count(logs.filter(l => l.action === 'view_lesson'), 'createdAt'),
    submissions: count(subs, 'submittedAt'),
    status: { ontime: subs.filter(s => s.status === 'ontime').length, late: subs.filter(s => s.status === 'late').length, graded: subs.filter(s => s.score !== '').length },
    recent: logs.slice(-10).reverse().map(l => ({ action: l.action, at: l.createdAt, user: (find_('Users', l.userId) || {}).fullName || '-' }))
  };
}
function report_(ctx, type, f) {
  f = f || {};
  const users = rows_('Users').filter(u => u.role === 'student' && (!f.grade || u.grade === f.grade) && (!f.room || u.room === f.room));
  const name = u => u.prefix + u.fullName;
  const courses = rows_('Courses').filter(c => !f.courseId || c.id === f.courseId);
  const cids = courses.map(c => c.id);
  const logs = rows_('AuditLog');
  if (type === 'attendance') {
    return { title: 'รายงานการเข้าเรียน (การเข้าสู่ระบบ)', headers: ['รหัส', 'ชื่อ-สกุล', 'ชั้น/ห้อง', 'จำนวนครั้งที่เข้าระบบ', 'เข้าล่าสุด'],
      rows: users.map(u => { const l = logs.filter(x => x.userId === u.id && x.action === 'login'); return [u.studentCode, name(u), u.grade + '/' + u.room, l.length, u.lastLoginAt]; }) };
  }
  if (type === 'views') {
    const lessons = rows_('Lessons').filter(l => cids.indexOf(l.courseId) >= 0), prog = rows_('Progress');
    return { title: 'รายงานการรับชมบทเรียน', headers: ['รหัส', 'ชื่อ-สกุล', 'บทเรียนที่เปิด', 'เรียนจบ', 'ดูวิดีโอครบ', 'ความคืบหน้า %'],
      rows: users.map(u => { const p = prog.filter(x => x.ownerId === u.id && cids.indexOf(x.courseId) >= 0); const done = p.filter(x => x.completed === 'true').length;
        return [u.studentCode, name(u), p.length, done, p.filter(x => x.videoDone === 'true').length, lessons.length ? Math.round(done * 100 / lessons.length) : 0]; }) };
  }
  const asg = rows_('Assignments').filter(a => cids.indexOf(a.courseId) >= 0), subs = rows_('Submissions');
  if (type === 'submissions' || type === 'scores') {
    const headers = ['รหัส', 'ชื่อ-สกุล'].concat(asg.map(a => a.title + (type === 'scores' ? ' (' + a.maxScore + ')' : '')));
    if (type === 'scores') headers.push('รวม', 'เต็ม');
    else headers.push('ส่งแล้ว', 'ค้างส่ง');
    return { title: type === 'scores' ? 'รายงานคะแนน' : 'รายงานการส่งงาน', headers: headers, rows: users.map(u => {
      let total = 0, sent = 0;
      const cells = asg.map(a => { const s = subs.find(x => x.assignmentId === a.id && x.ownerId === u.id);
        if (s) sent++; if (s && s.score !== '') total += Number(s.score);
        if (type === 'scores') return s && s.score !== '' ? Number(s.score) : '';
        return s ? (s.status === 'late' ? 'ส่งช้า' : 'ตรงเวลา') : (dt_(a.dueAt) < now_() ? 'ไม่ส่ง' : 'ยังไม่ส่ง'); });
      return [u.studentCode, name(u)].concat(cells, type === 'scores' ? [total, asg.reduce((s, a) => s + Number(a.maxScore), 0)] : [sent, asg.length - sent]);
    }) };
  }
  // course stats
  return { title: 'สถิติรายวิชา', headers: ['รหัสวิชา', 'ชื่อวิชา', 'ระดับชั้น', 'บทเรียน', 'งาน', 'งานที่ส่ง', 'ตรวจแล้ว', 'คะแนนเฉลี่ย %'],
    rows: courses.map(c => { const a = asg.filter(x => x.courseId === c.id), s = subs.filter(x => a.some(y => y.id === x.assignmentId));
      const g = s.filter(x => x.score !== ''), pct = g.map(x => Number(x.score) * 100 / Number((a.find(y => y.id === x.assignmentId) || {}).maxScore || 100));
      return [c.code, c.name, (c.grade || 'ทุกชั้น') + (c.room ? '/' + c.room : ''), rows_('Lessons').filter(l => l.courseId === c.id).length, a.length, s.length, g.length,
        pct.length ? Math.round(pct.reduce((x, y) => x + y, 0) / pct.length) : '-']; }) };
}
function auditLog_(ctx, f) {
  f = f || {};
  const q = str_(f.q, 50).toLowerCase(), users = {}; rows_('Users').forEach(u => users[u.id] = u.fullName);
  const list = rows_('AuditLog').slice().reverse().map(l => ({ at: l.createdAt, user: users[l.userId] || l.userId, action: l.action, detail: l.detail }))
    .filter(l => !q || (l.user + l.action + l.detail).toLowerCase().indexOf(q) >= 0);
  const page = Math.max(1, Number(f.page) || 1), size = 50;
  return { total: list.length, page: page, pages: Math.ceil(list.length / size), rows: list.slice((page - 1) * size, page * size) };
}

/* ============================== Admin: ตั้งค่า / สำรองข้อมูล ============================== */
function getSettings_() {
  return { config: cfg_(), sheetId: sheetId_(), driveId: driveId_(), sheetUrl: 'https://docs.google.com/spreadsheets/d/' + sheetId_(),
    driveUrl: 'https://drive.google.com/drive/folders/' + driveId_(), webAppUrl: ScriptApp.getService().getUrl(),
    triggers: ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction()) };
}
function extractId_(s) { s = str_(s, 300); const m = s.match(/[-\w]{25,}/); return m ? m[0] : ''; }
function saveSettings_(ctx, d) {
  d = d || {};
  const res = { reloaded: false };
  if (d.driveId !== undefined && extractId_(d.driveId) !== driveId_()) {
    const id = extractId_(d.driveId);
    try { DriveApp.getFolderById(id).getName(); } catch (e) { throw err_('เปิดโฟลเดอร์ Google Drive นี้ไม่ได้ ตรวจสอบ ID และสิทธิ์'); }
    props_().setProperty('DRIVE_ID', id);
  }
  lock_(() => {
    Object.keys(CONFIG_DEFAULTS).forEach(k => {
      if (d.config && d.config[k] !== undefined) {
        let v = typeof d.config[k] === 'boolean' ? String(d.config[k]) : str_(d.config[k], k === 'logo' ? 48000 : 500);
        if (k === 'logo' && v && !/^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(v)) throw err_('โลโก้ไม่ถูกต้อง');
        setCfg_(k, v);
      }
    });
  });
  if (d.sheetId !== undefined && extractId_(d.sheetId) !== sheetId_()) {
    const id = extractId_(d.sheetId);
    try { SpreadsheetApp.openById(id).getName(); } catch (e) { throw err_('เปิด Google Sheet นี้ไม่ได้ ตรวจสอบ ID และสิทธิ์'); }
    props_().setProperty('SHEET_ID', id);
    SS_ = null; Object.keys(MEM_).forEach(k => delete MEM_[k]);
    setup();
    res.reloaded = true;
  }
  log_(ctx.user.id, 'save_settings', Object.keys(d.config || {}).join(','));
  return res;
}
function backup_() {
  const name = 'Backup ' + cfg_().schoolName + ' ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HHmm');
  const f = DriveApp.getFileById(sheetId_()).makeCopy(name, folder_('Backups'));
  const files = [], it = folder_('Backups').getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort((a, b) => b.getDateCreated() - a.getDateCreated()).slice(30).forEach(x => x.setTrashed(true)); // เก็บ 30 ชุดล่าสุด
  log_('', 'backup', name);
  return { id: f.getId(), name: name, url: f.getUrl() };
}
function listBackups_() {
  const out = [], it = folder_('Backups').getFiles();
  while (it.hasNext()) { const f = it.next(); out.push({ id: f.getId(), name: f.getName(), url: f.getUrl(), at: Utilities.formatDate(f.getDateCreated(), TZ, 'yyyy-MM-dd HH:mm') }); }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
function restoreBackup_(ctx, fileId) {
  const src = SpreadsheetApp.openById(extractId_(fileId));
  backup_(); // สำรองสถานะปัจจุบันก่อนกู้คืนเสมอ
  return lock_(() => {
    Object.keys(SCHEMA).forEach(n => {
      const s = src.getSheetByName(n);
      if (!s || n === 'Sessions') return;
      const v = s.getDataRange().getValues(), dst = sheet_(n);
      dst.clearContents();
      if (v.length && v[0].length) dst.getRange(1, 1, v.length, v[0].length).setNumberFormat('@').setValues(v);
      delete MEM_[n]; delete MEM_['_h_' + n];
    });
    Object.keys(SCHEMA).forEach(n => ensureSheet_(ss_(), n));
    log_(ctx.user.id, 'restore', src.getName());
    return { ok: true, name: src.getName() };
  });
}
function installTriggers_() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'dailyJob').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(6).inTimezone(TZ).create();
  return { ok: true };
}
/** Trigger รายวัน: เตือนงานใกล้ครบกำหนด, สำรองข้อมูล, ล้างเซสชันหมดอายุ */
function dailyJob() {
  const n = now_(), tomorrow = Utilities.formatDate(new Date(Date.now() + 36 * 3600e3), TZ, "yyyy-MM-dd'T'HH:mm:ss");
  rows_('Assignments').filter(a => dt_(a.dueAt) > n && dt_(a.dueAt) <= tomorrow).forEach(a => {
    const key = 'remind_' + a.id;
    if (props_().getProperty(key)) return;
    const sent = rows_('Submissions').filter(s => s.assignmentId === a.id).map(s => s.ownerId);
    broadcast_(studentsFor_('', '', a.courseId).filter(s => sent.indexOf(s.id) < 0), 'ใกล้ครบกำหนดส่ง: ' + a.title, 'กำหนดส่ง ' + a.dueAt.replace('T', ' ').slice(0, 16), 'assignment:' + a.id);
    props_().setProperty(key, '1');
  });
  deleteWhere_('Sessions', s => Number(s.expiresAt) < Date.now());
  if (cfg_().autoBackup === 'true') backup_();
}
