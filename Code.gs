/**
 * Classroom + — Google Apps Script backend (ไฟล์เดียว)
 * ฐานข้อมูล: Google Sheets | ไฟล์: Google Drive | หน้าเว็บ: Index.html (HTML Service)
 * Admin เปลี่ยน Sheet ID / Drive ID ได้จากหน้า "ตั้งค่าระบบ" (เก็บใน Script Properties)
 */
const APP_VERSION = '4.6.0';
const TZ = 'Asia/Bangkok';
const DEFAULTS = {
  SHEET_ID: '14mpQC_8KSKd-V8Wn_sj2gdreJfB_q9haOnarBbqQ4r8',
  DRIVE_ID: '1GqxqZyDJPb7C27kBjyeyimD9VKqiKJ2Y'
};
const MAX_UPLOAD_MB = 2048;            // ไฟล์ใหญ่สุด 2 GB (อัปโหลดเป็นชิ้น ๆ ผ่าน Drive resumable upload)
const CHUNK_BYTES = 8 * 1024 * 1024;   // ขนาดชิ้นละ 8 MB (ต้องเป็นทวีคูณของ 256 KB)
const GRADES = ['ม.1', 'ม.2', 'ม.3', 'ม.4', 'ม.5', 'ม.6'];
const ALLOWED_EXT = ['pdf','doc','docx','ppt','pptx','xls','xlsx','csv','txt','jpg','jpeg','png','gif','webp',
  'zip','rar','7z','mp4','mov','webm','mp3','m4a'];
const CONFIG_DEFAULTS = {
  schoolName: 'Classroom +', logo: '', welcome: 'ยินดีต้อนรับ สู่ห้องเรียนออนไลน์แห่งอนาคต',
  allowAdminSignup: 'true', requireApproval: 'false', sessionHours: '8', rememberDays: '30',
  emailNotify: 'false', lineToken: '', autoBackup: 'true', webNotify: 'true', siteUrl: '',
  assignmentTypes: 'การบ้าน,ใบงาน,แบบฝึกหัด,สรุปเนื้อหา',
  themeColor: '#2563eb',   // สีหลักของระบบ
  studentMenus: ''         // JSON {hidden:[...], custom:[{name,url,icon}]} เมนูฝั่งนักเรียน
};
const PRIVATE_CONFIG = ['lineToken'];
const SCHEMA = {
  Config: ['key','value','updatedAt'],
  Users: ['id','role','username','studentCode','passSalt','passHash','prefix','fullName','birthDate','grade','room',
    'email','avatar','status','mustChangePassword','createdAt','updatedAt','lastLoginAt','classNo','acadYear','nickname'],
  Sessions: ['id','userId','tokenHash','expiresAt','createdAt'],
  Classes: ['id','grade','room','order','createdAt'],
  Categories: ['id','name','createdAt','code'],
  Courses: ['id','code','name','description','category','grade','room','cover','teacher','order','ownerId','createdAt','updatedAt'],
  Lessons: ['id','courseId','unit','title','description','cover','videoUrl','videoDuration','attachments','links',
    'duration','order','publishAt','closeAt','ownerId','createdAt','updatedAt'],
  Progress: ['id','ownerId','lessonId','courseId','completed','videoPos','videoDone','views','updatedAt'],
  Assignments: ['id','courseId','type','title','description','attachments','dueAt','maxScore','ownerId','createdAt','updatedAt','grade','room','group','quiz'],
  Submissions: ['id','assignmentId','ownerId','text','files','driveLink','status','submittedAt','score','feedback',
    'gradedBy','gradedAt','history','updatedAt','members','answers','autoScore'],
  Announcements: ['id','type','title','body','attachments','image','pinned','courseId','grade','room','ownerId','createdAt','updatedAt'],
  Notifications: ['id','ownerId','title','body','link','read','createdAt'],
  AuditLog: ['id','userId','action','detail','createdAt'],
  // ---------- ผลการเรียน (Gradebook) ----------
  Gradebooks: ['id','courseId','name','acadYear','term','grade','rooms','totalScore','mode','criteria','visibility','exemptPolicy','status',
    'structVersion','pubKind','pubVersion','publishedAt','needsRepublish','ownerId','createdAt','updatedAt','ver'],
  GbCategories: ['id','gbId','name','weight','order','status','createdAt','updatedAt'],
  GbIndicators: ['id','gbId','code','name','description','passType','passValue','order','status','createdAt','updatedAt'],
  GbItems: ['id','gbId','name','type','categoryId','description','maxScore','components','assignedAt','dueAt','rooms','mode','counted','status',
    'assignmentId','visible','order','createdAt','updatedAt'],
  GbScores: ['id','gbId','itemId','studentId','score','comp','submit','check','note','groupId','adjust','adjustReason','ver','updatedBy','updatedAt'],
  GbGroups: ['id','gbId','itemId','name','members','groupScore','createdBy','createdAt','updatedAt'],
  GbEnroll: ['id','gbId','studentId','status','createdAt'],
  GbResults: ['id','gbId','studentId','kind','version','data','publishedAt'],
  GbVersions: ['id','gbId','kind','version','snapshot','reason','by','at'],
  GbAudit: ['id','gbId','entity','entityId','field','oldValue','newValue','reason','batchId','by','at']
};
// ตารางที่ Admin แก้ไขผ่าน save()/remove() ได้ และฟิลด์ที่อนุญาต
const EDITABLE = {
  Classes: ['grade','room','order'],
  Categories: ['code','name'],
  Courses: ['code','name','description','category','grade','room','cover','teacher','order','ownerId'],
  Lessons: ['courseId','unit','title','description','cover','videoUrl','videoDuration','attachments','links','duration','order','publishAt','closeAt','ownerId'],
  Assignments: ['courseId','type','title','description','attachments','dueAt','maxScore','ownerId','grade','room','group','quiz'],
  Announcements: ['type','title','body','attachments','image','pinned','courseId','grade','room','ownerId']
};
const REQUIRED = { Classes: ['grade'], Categories: ['name'], Courses: ['name'], Lessons: ['courseId','title'],
  Assignments: ['courseId','title','dueAt'], Announcements: ['title'] };

/* ============================== Web App ============================== */
function doGet() {
  let title = 'Classroom +';
  try { title = cfg_().schoolName || title; } catch (e) {}
  return HtmlService.createHtmlOutputFromFile('Index')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** API สำหรับหน้าเว็บบน GitHub Pages: POST (text/plain) {fn, token, args} → JSON */
function doPost(e) {
  let req = {};
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (x) {}
  const out = rpc(String(req.fn || ''), req.token || null, Array.isArray(req.args) ? req.args : []);
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
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
      routeOk_(route, ctx.user);
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
  listAnnouncements: ['user', listAnnouncements_], search: ['user', search_], uploadFile: ['user', uploadFile_], uploadStart: ['user', uploadStart_], uploadChunk: ['user', uploadChunk_],
  discardUploads: ['user', discardUploads_], groupCandidates: ['user', groupCandidates_], batch: ['user', batch_],
  notifications: ['user', notifications_], markRead: ['user', markRead_],
  myResults: ['user', myResults_],
  // staff = แอดมิน + ครูผู้สอน (ครูเห็นเฉพาะรายวิชาของตนเอง)
  adminDashboard: ['staff', adminDashboard_], list: ['staff', list_], save: ['staff', save_], remove: ['staff', remove_],
  changeCredentials: ['staff', changeCredentials_], listSubmissions: ['staff', listSubmissions_], gradeSubmission: ['staff', gradeSubmission_],
  report: ['staff', report_], classSummary: ['staff', classSummary_], addAssignmentType: ['staff', addAssignmentType_],
  gbList: ['staff', gbList_], gbCreate: ['staff', gbCreate_], gbGet: ['staff', gbGet_], gbPreview: ['staff', gbPreview_], gbApply: ['staff', gbApply_],
  gbActivate: ['staff', gbActivate_], gbSaveScores: ['staff', gbSaveScores_], gbZeroMissing: ['staff', gbZeroMissing_],
  gbSaveGroup: ['staff', gbSaveGroup_], gbDeleteGroup: ['staff', gbDeleteGroup_], gbGroupScore: ['staff', gbGroupScore_],
  gbSyncAssignment: ['staff', gbSyncAssignment_], gbEnroll: ['staff', gbEnroll_], gbImportPreview: ['staff', gbImportPreview_],
  gbCopy: ['staff', gbCopy_], gbPublish: ['staff', gbPublish_], gbUnpublish: ['staff', gbUnpublish_], gbAudit: ['staff', gbAudit_],
  gbVersions: ['staff', gbVersions_], gbDelete: ['staff', gbDelete_], listTeachers: ['staff', listTeachers_],
  // admin (ผู้ดูแลระบบคนเดียว)
  listUsers: ['admin', listUsers_], saveUser: ['admin', saveUser_], deleteUser: ['admin', deleteUser_], importStudents: ['admin', importStudents_],
  setRole: ['admin', setRole_], getSettings: ['admin', getSettings_], saveSettings: ['admin', saveSettings_],
  auditLog: ['admin', auditLog_], backupNow: ['admin', function () { return backup_(); }],
  listBackups: ['admin', listBackups_], restoreBackup: ['admin', restoreBackup_], installTriggers: ['admin', installTriggers_]
};

const isAdmin_ = u => !!u && u.role === 'admin';
const staff_ = u => !!u && (u.role === 'admin' || u.role === 'teacher');
function routeOk_(route, u) {
  if ((route[0] === 'admin' && !isAdmin_(u)) || (route[0] === 'staff' && !staff_(u))) throw err_('คุณไม่มีสิทธิ์ใช้งานส่วนนี้', 'FORBIDDEN');
}
/** รวมหลายคำสั่งใน 1 รอบการเรียก (ลดเวลาโหลดหน้า) */
function batch_(ctx, calls) {
  return (Array.isArray(calls) ? calls : []).slice(0, 12).map(c => {
    const fn = String(c && c[0]), route = ROUTES[fn];
    try {
      if (!route || fn === 'batch' || route[0] === 'public') throw err_('ไม่พบคำสั่ง ' + fn);
      routeOk_(route, ctx.user);
      return { ok: true, data: route[1].apply(null, [ctx].concat(c[1] || [])) };
    } catch (e) { return { ok: false, error: e.message, code: e.code || 'ERR' }; }
  });
}

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
  bump_(name);
}
/* แคชข้อมูลชีตใน CacheService (เร็วกว่าอ่านชีตทุกครั้งมาก) — เปลี่ยนเวอร์ชันทุกครั้งที่เขียน */
const NO_CACHE = { Sessions: 1 };
function cache_() { return CacheService.getScriptCache(); }
function ver_(name) { let v = cache_().get('v_' + name); if (!v) { v = id_(); cache_().put('v_' + name, v, 21600); } return v; }
function bump_(name) { try { cache_().put('v_' + name, id_(), 21600); } catch (e) {} }
function cacheGet_(name) {
  if (NO_CACHE[name]) return null;
  try {
    const c = cache_(), v = ver_(name), n = Number(c.get('n_' + name + v) || 0);
    if (!n) return null;
    const keys = []; for (let i = 0; i < n; i++) keys.push('c_' + name + v + '_' + i);
    const got = c.getAll(keys);
    if (keys.some(k => got[k] == null)) return null;
    return JSON.parse(keys.map(k => got[k]).join(''));
  } catch (e) { return null; }
}
function cachePut_(name, list) {
  if (NO_CACHE[name]) return;
  try {
    const s = JSON.stringify(list), size = 30000;
    if (s.length > 3000000) return;
    const c = cache_(), v = ver_(name), obj = {}; let n = 0;
    for (let i = 0; i < s.length; i += size) obj['c_' + name + v + '_' + (n++)] = s.slice(i, i + size);
    if (!n) obj['c_' + name + v + '_' + (n++)] = '[]';
    c.putAll(obj, 21600); c.put('n_' + name + v, String(n), 21600);
  } catch (e) {}
}
function headers_(name) {
  const k = '_h_' + name;
  if (!MEM_[k]) { const sh = sheet_(name); MEM_[k] = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String); }
  return MEM_[k];
}
function rows_(name) {
  if (MEM_[name]) return MEM_[name];
  const cached = cacheGet_(name);
  if (cached) return MEM_[name] = cached;
  const values = sheet_(name).getDataRange().getValues();
  const h = values.shift() || [];
  MEM_[name] = values.map((r, i) => {
    const o = { _r: i + 2 };
    h.forEach((k, j) => { if (k) o[k] = r[j] instanceof Date ? Utilities.formatDate(r[j], TZ, "yyyy-MM-dd'T'HH:mm:ss") : String(r[j]); });
    return o;
  }).filter(o => o[h[0]] !== '');
  cachePut_(name, MEM_[name]);
  return MEM_[name];
}
function cell_(v) {
  let s = v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  if (/^[=+@\t\r]|^-[^\d.]/.test(s)) s = "'" + s; // กัน formula injection
  return s;
}
function insert_(name, obj) {
  const h = headers_(name);
  const sh = sheet_(name);
  sh.appendRow(h.map(k => cell_(obj[k]))); bump_(name);
  const o = { _r: sh.getLastRow() };
  h.forEach(k => o[k] = obj[k] === undefined || obj[k] === null ? '' : (typeof obj[k] === 'object' ? JSON.stringify(obj[k]) : String(obj[k])));
  if (MEM_[name]) MEM_[name].push(o);
  return o;
}
function insertMany_(name, list) {
  if (!list.length) return;
  const h = headers_(name), sh = sheet_(name);
  sh.getRange(sh.getLastRow() + 1, 1, list.length, h.length).setValues(list.map(o => h.map(k => cell_(o[k])))); bump_(name);
  delete MEM_[name];
}
function updateRow_(name, row, patch) {
  const h = headers_(name);
  Object.keys(patch).forEach(k => { if (h.indexOf(k) >= 0) row[k] = typeof patch[k] === 'object' && patch[k] !== null ? JSON.stringify(patch[k]) : String(patch[k] === null || patch[k] === undefined ? '' : patch[k]); });
  sheet_(name).getRange(row._r, 1, 1, h.length).setValues([h.map(k => cell_(row[k]))]); bump_(name);
  return row;
}
function find_(name, id) { return rows_(name).find(r => r.id === String(id)); }
function deleteWhere_(name, pred) {
  const sh = sheet_(name);
  const list = rows_(name).filter(pred).sort((a, b) => b._r - a._r);
  list.forEach(r => sh.deleteRow(r._r));
  delete MEM_[name]; if (list.length) bump_(name);
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
    const nm = rows_('Config').find(r => r.key === 'schoolName');
    if (nm && nm.value === 'Classroom PLus') updateRow_('Config', nm, { value: 'Classroom +', updatedAt: now_() }); // เปลี่ยนชื่อโปรแกรม v4.2
    // v4.6: ผู้ดูแลระบบมีคนเดียว (username admin) — บัญชี Admin อื่นเดิมกลายเป็น "ครูผู้สอน" (ข้อมูลเดิมยังเป็นของครูคนนั้น)
    rows_('Users').filter(u => u.role === 'admin' && u.username !== 'admin').forEach(u => updateRow_('Users', u, { role: 'teacher', updatedAt: now_() }));
    const adm = rows_('Users').find(u => u.username === 'admin');
    if (!adm) {
      const salt = id_();
      insert_('Users', { id: id_(), role: 'admin', username: 'admin', passSalt: salt, passHash: hashPw_('admin123', salt),
        prefix: 'นาย', fullName: 'ผู้ดูแลระบบ', status: 'active', mustChangePassword: 'false', createdAt: now_(), updatedAt: now_() });
    } else if (adm.role !== 'admin' || adm.status !== 'active') updateRow_('Users', adm, { role: 'admin', status: 'active', updatedAt: now_() });
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
  insert_('Announcements', { id: id_(), type: 'ข่าวสาร', title: 'ยินดีต้อนรับสู่ Classroom +', body: 'นักเรียนสามารถเข้าดูบทเรียน ส่งงาน และติดตามคะแนนได้ที่นี่',
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
  log_(user.id, 'login', user.role); // ไม่เขียนชีต Users ทุกครั้งที่ login (เร็วขึ้น) — เวลาเข้าล่าสุดดูจาก AuditLog
  const pu = pub_(user); pu.lastLoginAt = now_();
  // ส่งข้อมูลหน้าแรกกลับไปพร้อมกัน → เข้าหน้าหลักได้ทันทีไม่ต้องเรียกซ้ำ
  const ctx = { user: user, token: token }, boot = {};
  try { if (staff_(user)) boot.adminDashboard = adminDashboard_(ctx); else boot.studentHome = studentHome_(ctx); } catch (e) {}
  try { boot.notifications = notifications_(ctx); } catch (e) {}
  return { token: token, expiresAt: exp, user: pu, boot: boot };
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
/** ภาคเรียน/ปีการศึกษา (พ.ศ.) อัตโนมัติ: ภาค 1 = 16 พ.ค.–30 ก.ย. · ปิดภาค 1–20 ต.ค. · ภาค 2 = 21 ต.ค.–31 มี.ค. · ปิดภาค 1 เม.ย.–15 พ.ค. */
function term_(d) {
  d = d || new Date();
  const s = Utilities.formatDate(d, TZ, 'yyyy-MM-dd'), y = Number(s.slice(0, 4)), md = s.slice(5);
  const year = (md >= '05-16' ? y : y - 1) + 543;
  if (md >= '05-16' && md <= '09-30') return { term: '1', year: String(year), open: true, label: 'ภาคเรียนที่ 1 ปีการศึกษา ' + year };
  if (md >= '10-01' && md <= '10-20') return { term: '1', year: String(year), open: false, label: 'ปิดภาคเรียนที่ 1 ปีการศึกษา ' + year };
  if (md >= '04-01' && md <= '05-15') return { term: '2', year: String(year), open: false, label: 'ปิดภาคเรียนที่ 2 ปีการศึกษา ' + year };
  return { term: '2', year: String(year), open: true, label: 'ภาคเรียนที่ 2 ปีการศึกษา ' + year };
}
function bootstrap_() {
  ensureSetup_();
  return { term: term_(), config: publicCfg_(), classes: rows_('Classes').map(pub_).sort((a, b) => a.order - b.order), grades: GRADES, version: APP_VERSION, maxUploadMB: MAX_UPLOAD_MB };
}
function login_(ctx, f) {
  f = f || {};
  const c = cfg_();
  if (f.mode === 'admin') {
    const un = str_(f.username, 40).toLowerCase();
    const done = throttle_('a_' + un, 5, 10);
    const u = rows_('Users').find(x => staff_(x) && x.username === un);
    if (!u || hashPw_(String(f.password || ''), u.passSalt) !== u.passHash) { done(); throw err_('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'); }
    if (u.status === 'pending') throw err_('บัญชีของคุณรอการอนุมัติจาก Admin');
    if (u.status !== 'active') throw err_('บัญชีนี้ถูกระงับการใช้งาน');
    return createSession_(u, !!f.remember);
  }
  const code = str_(f.studentCode, 5);
  const done = throttle_('s_' + code, 5, 10), doneAll = throttle_('s_all', 60, 10);
  const u = rows_('Users').find(x => x.role === 'student' && x.studentCode === code);
  if (!/^\d{5}$/.test(code) || !u) { done(); doneAll(); throw err_('ไม่พบรหัสนักเรียนนี้ กรุณาตรวจสอบหรือลงทะเบียนก่อน'); }
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
function classNo_(v) { v = str_(v, 3); if (v && !/^\d{1,3}$/.test(v)) throw err_('เลขที่ต้องเป็นตัวเลข'); return v ? String(Number(v)) : ''; }
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
  const okGrades = GRADES.concat(rows_('Classes').map(c => c.grade));
  if (okGrades.indexOf(str_(d.grade, 20)) < 0) throw err_('กรุณาเลือกระดับชั้น');
  return lock_(() => {
    delete MEM_.Users;
    if (codeTaken_(code)) throw err_('รหัสนักเรียนนี้ถูกใช้แล้ว');
    const u = insert_('Users', Object.assign(p, { id: id_(), role: 'student', studentCode: code, grade: str_(d.grade, 20), room: str_(d.room, 20), classNo: classNo_(d.classNo),
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
    const u = insert_('Users', Object.assign(p, { id: id_(), role: 'teacher', username: un, passSalt: salt, passHash: hashPw_(pw, salt),
      email: str_(d.email, 100), status: pending ? 'pending' : 'active', mustChangePassword: 'false', createdAt: now_(), updatedAt: now_() }));
    log_(u.id, 'register', 'teacher' + (pending ? ' (pending)' : ''));
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
function lastLogin_(uid) { const l = rows_('AuditLog'); for (let i = l.length - 1; i >= 0; i--) if (l[i].userId === uid && l[i].action === 'login') return l[i].createdAt; return ''; }
function me_(ctx) {
  const pu = pub_(ctx.user); pu.lastLoginAt = lastLogin_(ctx.user.id) || pu.lastLoginAt;
  return { user: pu, term: term_(), config: publicCfg_(), classes: rows_('Classes').map(pub_), maxUploadMB: MAX_UPLOAD_MB,
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
  if (d.classNo !== undefined) patch.classNo = classNo_(d.classNo);
  if (d.email !== undefined) { const e = str_(d.email, 100); if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw err_('อีเมลไม่ถูกต้อง'); patch.email = e; }
  if (d.avatar !== undefined) { if (d.avatar && !imgOk_(d.avatar)) throw err_('รูปโปรไฟล์ไม่ถูกต้องหรือใหญ่เกินไป'); patch.avatar = d.avatar; }
  return lock_(() => {
    if (u.role === 'student' && d.studentCode !== undefined && d.studentCode !== u.studentCode) {
      const code = str_(d.studentCode, 5);
      if (!/^\d{5}$/.test(code)) throw err_('รหัสนักเรียนต้องเป็นตัวเลข 5 หลัก');
      if (codeTaken_(code, u.id)) throw err_('รหัสนักเรียนนี้ถูกใช้แล้ว');
      patch.studentCode = code;
    }
    const oldAvatar = u.avatar;
    updateRow_('Users', u, patch);
    if (patch.avatar !== undefined && oldAvatar !== patch.avatar) purge_([driveIdOf_(oldAvatar)]);
    log_(u.id, 'update_profile', Object.keys(patch).join(','));
    return pub_(u);
  });
}

/* ============================== สิทธิ์การมองเห็น ============================== */
/** ระดับชั้น/ห้องเก็บแบบหลายค่าคั่นด้วย , (ว่าง = ทั้งหมด) */
function inList_(list, v) { const a = String(list || '').split(',').map(s => s.trim()).filter(Boolean); return !a.length || a.indexOf(String(v || '')) >= 0; }
function match_(u, grade, room) { return staff_(u) || (inList_(grade, u.grade) && inList_(room, u.room)); }
/** แอดมินเห็นทุกวิชา · ครูเห็นเฉพาะวิชาที่ตนเป็นเจ้าของ · นักเรียนเห็นตามชั้น/ห้อง */
function courseOk_(u, c) { return !!c && (isAdmin_(u) || (u.role === 'teacher' ? c.ownerId === u.id : match_(u, c.grade, c.room))); }
function ownCourse_(u, cid) { const c = find_('Courses', cid); return !!c && (isAdmin_(u) || c.ownerId === u.id); }
function lessonOk_(u, l) {
  if (!l || !courseOk_(u, find_('Courses', l.courseId))) return false;
  if (staff_(u)) return true;
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
    announcements: listAnnouncements_(ctx).slice(0, 3),
    term: term_()
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
/* ---------- งานกลุ่ม ---------- */
const isGroup_ = a => a.group === 'true' || /กลุ่ม/.test(a.type || '');
const members_ = s => json_(s && s.members, []);
const inSub_ = (s, uid) => s.ownerId === uid || members_(s).indexOf(uid) >= 0;
function subOf_(aid, uid) { return rows_('Submissions').find(s => s.assignmentId === aid && inSub_(s, uid)) || null; }
function nameOf_(uid) { const u = find_('Users', uid); return u ? u.prefix + u.fullName : '-'; }
function subPub_(s, uid) {
  if (!s) return null;
  const o = pub_(s); o.isLeader = s.ownerId === uid; o.leaderName = nameOf_(s.ownerId);
  o.memberList = members_(s).map(id => { const u = find_('Users', id); return u ? { id: id, name: u.prefix + u.fullName, classNo: u.classNo, grade: u.grade, room: u.room } : null; }).filter(Boolean);
  return o;
}
/** รายชื่อนักเรียนที่เพิ่มเข้ากลุ่มได้ (ตามชั้น/ห้องที่เลือก) */
function groupCandidates_(ctx, assignmentId, grade, room) {
  const a = find_('Assignments', assignmentId), u = ctx.user;
  if (!a || !isGroup_(a)) throw err_('งานนี้ไม่ใช่งานกลุ่ม');
  const mine = rows_('Submissions').find(s => s.assignmentId === a.id && s.ownerId === u.id);
  const taken = {}; rows_('Submissions').filter(s => s.assignmentId === a.id && s !== mine).forEach(s => { taken[s.ownerId] = 1; members_(s).forEach(m => taken[m] = 1); });
  return studentsFor_(a.grade, a.room, a.courseId).filter(s => s.id !== u.id && !taken[s.id] && (!grade || s.grade === grade) && (!room || s.room === room))
    .map(s => ({ id: s.id, name: s.prefix + s.fullName, classNo: s.classNo, grade: s.grade, room: s.room, code: s.studentCode }))
    .sort((x, y) => (Number(x.classNo) || 999) - (Number(y.classNo) || 999));
}
function assignmentsFor_(u) {
  const subs = {}; rows_('Submissions').filter(s => inSub_(s, u.id)).forEach(s => subs[s.assignmentId] = s);
  const courses = {}; rows_('Courses').forEach(c => courses[c.id] = c);
  return rows_('Assignments').filter(a => courseOk_(u, courses[a.courseId]) && match_(u, a.grade, a.room)).map(a => {
    const s = subs[a.id] || null;
    return Object.assign(pub_(a), { quiz: quizPub_(a.quiz), courseName: courses[a.courseId].name, courseCode: courses[a.courseId].code, isGroup: isGroup_(a), sub: subPub_(s, u.id), status: subStatus_(a, s) });
  });
}
/* ---------- แบบทดสอบในงาน (ปรนัย ถูก/ผิด จับคู่ เติมคำ/เขียนตอบ) ---------- */
const r2_ = x => Math.round(Number(x) * 100) / 100;
function quiz_(v) {
  const o = typeof v === 'string' ? json_(v, null) : v;
  if (!o || !Array.isArray(o.questions) || !o.questions.length) return null;
  const seen = {};
  const qs = o.questions.slice(0, 200).map((q, i) => {
    const n = 'ข้อ ' + (i + 1) + ': ', type = ['mc', 'tf', 'text', 'match'].indexOf(q.type) >= 0 ? q.type : 'mc';
    const pts = r2_(Math.max(0, Number(q.points) || 0));
    if (!(pts > 0)) throw err_(n + 'คะแนนต้องมากกว่า 0');
    let qid = str_(q.id, 20).replace(/[^\w]/g, '') || id_(); if (seen[qid]) qid = id_(); seen[qid] = 1;
    const out = { id: qid, type: type, q: str_(q.q, 3000), points: pts };
    if (!out.q) throw err_(n + 'กรุณาพิมพ์คำถาม');
    if (type === 'mc') {
      out.options = (Array.isArray(q.options) ? q.options : []).map(x => str_(x, 500)).slice(0, 10);
      if (out.options.length < 2 || out.options.some(x => !x)) throw err_(n + 'ตัวเลือกต้องมีอย่างน้อย 2 ข้อและห้ามว่าง');
      const a = Number(q.answer); if (!(a >= 0 && a < out.options.length) || q.answer === '' || q.answer === null) throw err_(n + 'กรุณาเลือกคำตอบที่ถูกต้อง');
      out.answer = a;
    } else if (type === 'tf') {
      if (['true', 'false'].indexOf(String(q.answer)) < 0) throw err_(n + 'กรุณาเลือกว่าข้อความ ถูก หรือ ผิด');
      out.answer = String(q.answer);
    } else if (type === 'text') out.answer = str_(q.answer, 500); // ว่าง = ครูตรวจเอง · มีค่า = ตรวจอัตโนมัติ (หลายคำตอบคั่นด้วย |)
    else {
      out.pairs = (Array.isArray(q.pairs) ? q.pairs : []).map(x => ({ l: str_(x && x.l, 300), r: str_(x && x.r, 300) })).filter(x => x.l && x.r).slice(0, 15);
      if (out.pairs.length < 2) throw err_(n + 'การจับคู่ต้องมีอย่างน้อย 2 คู่');
    }
    return out;
  });
  return { style: ['th', 'en', 'num', 'custom'].indexOf(o.style) >= 0 ? o.style : 'th', labels: str_(o.labels, 200), questions: qs, total: r2_(qs.reduce((t, q) => t + q.points, 0)) };
}
/** แบบทดสอบสำหรับนักเรียน: ตัดเฉลยออก (ฝั่ง server) */
function quizPub_(json) {
  const q = json_(json, null);
  if (!q) return '';
  q.questions = q.questions.map(x => {
    const o = { id: x.id, type: x.type, q: x.q, points: x.points };
    if (x.type === 'mc') o.options = x.options;
    if (x.type === 'match') { o.left = x.pairs.map(p => p.l); o.right = x.pairs.map(p => p.r).slice().sort(); }
    if (x.type === 'text') o.auto = !!x.answer;
    return o;
  });
  return JSON.stringify(q);
}
const norm_ = t => String(t === undefined || t === null ? '' : t).toLowerCase().replace(/\s+/g, ' ').trim();
/** ตรวจอัตโนมัติ → { scores: {qid: คะแนน | null (รอครูตรวจ)}, pending, total } */
function gradeQuiz_(q, ans) {
  const scores = {}; let pending = false;
  q.questions.forEach(x => {
    const a = ans[x.id];
    if (x.type === 'mc') scores[x.id] = String(a) === String(x.answer) ? x.points : 0;
    else if (x.type === 'tf') scores[x.id] = String(a) === x.answer ? x.points : 0;
    else if (x.type === 'match') { const m = a && typeof a === 'object' ? a : {}; const ok = x.pairs.filter((p, i) => norm_(m[i]) === norm_(p.r)).length; scores[x.id] = r2_(x.points * ok / x.pairs.length); }
    else if (x.answer) scores[x.id] = x.answer.split('|').map(norm_).filter(String).indexOf(norm_(a)) >= 0 ? x.points : 0;
    else { scores[x.id] = null; pending = true; }
  });
  return { scores: scores, pending: pending, total: r2_(Object.keys(scores).reduce((t, k) => t + (Number(scores[k]) || 0), 0)) };
}
function cleanAnswers_(q, ans) {
  const o = {}; ans = ans && typeof ans === 'object' ? ans : {};
  q.questions.forEach(x => { const a = ans[x.id]; if (a === undefined || a === null || a === '') return;
    if (x.type === 'match') { const m = {}; Object.keys(a || {}).slice(0, 15).forEach(k => m[k] = str_(a[k], 300)); o[x.id] = m; }
    else o[x.id] = str_(a, x.type === 'text' ? 5000 : 10); });
  return o;
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
  const quiz = json_(a.quiz, null), answers = quiz ? cleanAnswers_(quiz, d.answers) : null;
  if (link && !/^https:\/\/(drive|docs)\.google\.com\//.test(link)) throw err_('ลิงก์ต้องเป็น Google Drive/Docs');
  if (quiz && !Object.keys(answers).length) throw err_('กรุณาตอบแบบทดสอบอย่างน้อย 1 ข้อ');
  if (!quiz && !text && !files.length && !link) throw err_('กรุณาแนบไฟล์ ลิงก์ หรือพิมพ์ข้อความอย่างน้อย 1 อย่าง');
  const g = quiz ? gradeQuiz_(quiz, answers) : null;
  const qPatch = g ? { answers: answers, autoScore: g.scores, score: g.pending ? '' : String(g.total), gradedAt: g.pending ? '' : now_(), gradedBy: g.pending ? '' : 'auto',
    feedback: g.pending ? '' : 'ตรวจอัตโนมัติ' } : {};
  return lock_(() => {
    delete MEM_.Submissions;
    const s = rows_('Submissions').find(x => x.assignmentId === a.id && x.ownerId === u.id);
    const other = rows_('Submissions').find(x => x.assignmentId === a.id && x.ownerId !== u.id && members_(x).indexOf(u.id) >= 0);
    if (other) throw err_('คุณเป็นสมาชิกในกลุ่มของ ' + nameOf_(other.ownerId) + ' แล้ว — ตัวแทนกลุ่มเป็นผู้ส่ง/แก้ไขงาน');
    let members = [];
    if (isGroup_(a) && Array.isArray(d.members)) {
      const ok = {}; groupCandidates_(ctx, a.id, '', '').forEach(x => ok[x.id] = 1);
      members = d.members.map(String).filter((m, i, arr) => arr.indexOf(m) === i && m !== u.id).slice(0, 15);
      const bad = members.find(m => !ok[m] && !(s && members_(s).indexOf(m) >= 0));
      if (bad) throw err_(nameOf_(bad) + ' อยู่ในกลุ่มอื่นหรือส่งงานนี้แล้ว');
    }
    const added = members.filter(m => !s || members_(s).indexOf(m) < 0);
    const late = dt_(a.dueAt) < now_();
    if (s) {
      if (s.score !== '') throw err_('งานนี้ครูตรวจแล้ว แก้ไขไม่ได้');
      if (late) throw err_('หมดเวลาแก้ไขงานแล้ว');
      const hist = json_(s.history, []); hist.push({ at: s.updatedAt || s.submittedAt, text: s.text, files: json_(s.files, []).length, link: s.driveLink });
      const removed = fileIds_({ files: s.files }).filter(id => fileIds_({ files: files }).indexOf(id) < 0);
      updateRow_('Submissions', s, Object.assign({ text: text, files: files, driveLink: link, history: hist.slice(-20), updatedAt: now_(), members: isGroup_(a) ? members : members_(s) }, qPatch));
      purge_(removed);
      if (g && !g.pending) gbFromSubmission_(null, a, s);
      if (added.length) notifyUsers_(added, 'คุณถูกเพิ่มเข้ากลุ่มงาน', u.fullName + ' เพิ่มคุณในกลุ่ม "' + a.title + '"', 'assignment:' + a.id);
      log_(u.id, 'edit_submission', a.id);
      return subPub_(s, u.id);
    }
    const n = insert_('Submissions', Object.assign({ id: id_(), assignmentId: a.id, ownerId: u.id, text: text, files: files, driveLink: link,
      status: late ? 'late' : 'ontime', submittedAt: now_(), score: '', feedback: '', history: '[]', updatedAt: now_(), members: members }, qPatch));
    log_(u.id, 'submit', a.id);
    if (g && !g.pending) gbFromSubmission_(null, a, n); else gbFromSubmission_(null, a, n, true);
    if (added.length) notifyUsers_(added, 'คุณถูกเพิ่มเข้ากลุ่มงาน', u.fullName + ' เพิ่มคุณในกลุ่ม "' + a.title + '"', 'assignment:' + a.id);
    if (a.ownerId && a.ownerId !== u.id) notifyUsers_([a.ownerId], 'มีงานส่งใหม่', u.fullName + ' ส่ง "' + a.title + '"' + (late ? ' (ส่งช้า)' : ''), 'grade:' + a.id);
    return subPub_(n, u.id);
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
    purge_(fileIds_(s));
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
/** แจ้งเตือนของฉัน — นักเรียน: สร้างแจ้งเตือน "งานค้าง" ให้อัตโนมัติสำหรับงานที่ยังไม่ส่งและยังไม่เคยแจ้ง (ครั้งเดียวต่องาน) */
function notifications_(ctx) {
  const u = ctx.user;
  if (u.role === 'student') {
    const have = {}; rows_('Notifications').forEach(n => { if (n.ownerId === u.id) have[n.link] = 1; });
    const miss = assignmentsFor_(u).filter(a => !a.sub && !have['assignment:' + a.id]);
    if (miss.length) lock_(() => {
      delete MEM_.Notifications;
      const again = {}; rows_('Notifications').forEach(n => { if (n.ownerId === u.id) again[n.link] = 1; });
      insertMany_('Notifications', miss.filter(a => !again['assignment:' + a.id]).map(a => ({ id: id_(), ownerId: u.id,
        title: (dt_(a.dueAt) < now_() ? 'งานค้างส่ง: ' : (a.type || 'งาน') + 'ใหม่: ') + a.title,
        body: a.courseName + ' · กำหนดส่ง ' + dt_(a.dueAt).replace('T', ' ').slice(0, 16), link: 'assignment:' + a.id, read: 'false', createdAt: now_() })));
    });
  }
  return rows_('Notifications').filter(n => n.ownerId === u.id).map(pub_).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 40);
}
/** อ่านแล้ว: ids = รายการที่ระบุ (ไม่ระบุ = ทั้งหมด) — เขียนเฉพาะคอลัมน์ read ทีละเซลล์ (เร็วและไม่ทับข้อมูลอื่น) */
function markRead_(ctx, ids) {
  const only = Array.isArray(ids) ? ids.map(String) : null;
  return lock_(() => {
    delete MEM_.Notifications;
    const col = headers_('Notifications').indexOf('read') + 1, sh = sheet_('Notifications');
    const list = rows_('Notifications').filter(n => n.ownerId === ctx.user.id && n.read !== 'true' && (!only || only.indexOf(n.id) >= 0));
    list.forEach(n => { sh.getRange(n._r, col).setValue('true'); n.read = 'true'; });
    if (list.length) bump_('Notifications');
    return list.length;
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
  const roomOk = c => !f.room || (c && inList_(c.grade, f.room.split('/')[0]) && inList_(c.room, f.room.split('/')[1]));
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
const DRIVE_API = 'https://www.googleapis.com';
function cleanSeg_(s) { return String(s || '').replace(/[\\:*?"<>|#%]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60); }
/** โฟลเดอร์ย่อยใน Drive ตามประเภทการอัปโหลด เช่น "การบ้าน/ไฟล์จากครู", "บทเรียน/วิทยาการคำนวณ 1", "รูปภาพ/ปก" */
function folderFor_(user, path) {
  let segs = String(path || '').split('/').map(cleanSeg_).filter(String).slice(0, 3);
  if (!staff_(user)) { // นักเรียนอัปโหลดได้เฉพาะโฟลเดอร์งานที่ส่ง / รูปโปรไฟล์
    const types = cfg_().assignmentTypes.split(',').map(cleanSeg_);
    segs = segs[0] === 'รูปภาพ' ? ['รูปภาพ', 'โปรไฟล์'] : [types.indexOf(segs[0]) >= 0 ? segs[0] : 'งานอื่น ๆ', 'งานที่นักเรียนส่ง'];
  }
  if (!segs.length) segs = ['ไฟล์ทั่วไป'];
  const key = 'fd_' + driveId_() + '_' + segs.join('/'), cached = cache_().get(key);
  if (cached) { try { return DriveApp.getFolderById(cached); } catch (e) {} }
  let f = DriveApp.getFolderById(driveId_());
  segs.forEach(s => { const it = f.getFoldersByName(s); f = it.hasNext() ? it.next() : f.createFolder(s); });
  cache_().put(key, f.getId(), 21600);
  return f;
}
function folder_(sub) { return sub ? folderFor_({ role: 'admin' }, sub) : DriveApp.getFolderById(driveId_()); }
function checkFile_(name, size) {
  const ext = name.toLowerCase().split('.').pop();
  if (ALLOWED_EXT.indexOf(ext) < 0) throw err_('ไม่รองรับไฟล์ชนิด .' + ext);
  if (size > MAX_UPLOAD_MB * 1048576) throw err_('ไฟล์ใหญ่เกิน ' + (MAX_UPLOAD_MB / 1024) + ' GB');
}
function share_(file) {
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); return true; } catch (e) { return false; } // Workspace บางแห่งห้ามแชร์สาธารณะ
}
function fileOut_(id, name, mime, size, shared) {
  return { id: id, name: name, url: 'https://drive.google.com/file/d/' + id + '/view', mime: mime, size: size, shared: shared,
    displayUrl: 'https://lh3.googleusercontent.com/d/' + id };
}
/** ไฟล์เล็ก (≤ 8 MB): ส่งครั้งเดียว */
function uploadFile_(ctx, f) {
  f = f || {};
  const name = str_(f.name, 200).replace(/[\\/:*?"<>|]/g, '_'), data = String(f.data || '');
  checkFile_(name, data.length * 0.75);
  if (data.length * 0.75 > CHUNK_BYTES * 1.5) throw err_('ไฟล์ใหญ่ ให้อัปโหลดแบบแบ่งชิ้น');
  const blob = Utilities.newBlob(Utilities.base64Decode(data), str_(f.mime, 100) || 'application/octet-stream', name);
  const file = folderFor_(ctx.user, f.folder).createFile(blob);
  file.setDescription('cp:' + ctx.user.id);
  const shared = share_(file);
  log_(ctx.user.id, 'upload', name);
  return fileOut_(file.getId(), name, blob.getContentType(), file.getSize(), shared);
}
/** ไฟล์ใหญ่ (สูงสุด 2 GB): เปิด resumable session ของ Drive ฝั่ง server แล้วรับไฟล์ทีละชิ้น */
function uploadStart_(ctx, f) {
  f = f || {};
  const name = str_(f.name, 200).replace(/[\\/:*?"<>|]/g, '_'), size = Number(f.size) || 0, mime = str_(f.mime, 100) || 'application/octet-stream';
  checkFile_(name, size);
  if (!size) throw err_('ไฟล์ว่างเปล่า');
  const folder = folderFor_(ctx.user, f.folder);
  const res = UrlFetchApp.fetch(DRIVE_API + '/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size', {
    method: 'post', contentType: 'application/json; charset=UTF-8', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) },
    payload: JSON.stringify({ name: name, parents: [folder.getId()], description: 'cp:' + ctx.user.id }) });
  const h = res.getHeaders(), loc = h.Location || h.location;
  if (res.getResponseCode() !== 200 || !loc) throw err_('เริ่มอัปโหลดไม่สำเร็จ (' + res.getResponseCode() + ')');
  const uploadId = id_();
  cache_().put('up_' + uploadId, JSON.stringify({ u: ctx.user.id, loc: loc, size: size, name: name, mime: mime }), 21600);
  return { uploadId: uploadId, chunk: CHUNK_BYTES };
}
function uploadChunk_(ctx, uploadId, start, data) {
  const s = json_(cache_().get('up_' + uploadId), null);
  if (!s || s.u !== ctx.user.id) throw err_('ไม่พบรายการอัปโหลด กรุณาเริ่มใหม่');
  const bytes = Utilities.base64Decode(String(data || '')), from = Number(start) || 0, to = from + bytes.length - 1;
  const res = UrlFetchApp.fetch(s.loc, { method: 'put', payload: bytes, contentType: 'application/octet-stream', muteHttpExceptions: true,
    headers: { 'Content-Range': 'bytes ' + from + '-' + to + '/' + s.size } });
  const code = res.getResponseCode();
  if (code === 308) { const r = String(res.getHeaders().Range || res.getHeaders().range || ''); const m = r.match(/-(\d+)$/); return { done: false, next: m ? Number(m[1]) + 1 : to + 1 }; }
  if (code === 200 || code === 201) {
    const meta = JSON.parse(res.getContentText());
    cache_().remove('up_' + uploadId);
    const shared = share_(DriveApp.getFileById(meta.id));
    log_(ctx.user.id, 'upload', s.name);
    return { done: true, file: fileOut_(meta.id, s.name, meta.mimeType || s.mime, Number(meta.size) || s.size, shared) };
  }
  throw err_('อัปโหลดไม่สำเร็จ (' + code + ') กรุณาลองใหม่');
}
/* ---------- ลบไฟล์ใน Drive อัตโนมัติ (เฉพาะไฟล์ที่ระบบอัปโหลดเอง: description ขึ้นต้น "cp:") ---------- */
function driveIdOf_(url) { const m = String(url || '').match(/(?:\/d\/|[?&]id=)([-\w]{20,})/); return m ? m[1] : ''; }
function fileIds_(row) {
  const ids = [];
  ['attachments', 'files'].forEach(k => { if (row[k]) json_(row[k], []).forEach(f => { const i = (f && (f.id || driveIdOf_(f.url))) || ''; if (i) ids.push(i); }); });
  ['cover', 'image', 'avatar', 'videoUrl'].forEach(k => { const i = driveIdOf_(row[k]); if (i) ids.push(i); });
  return ids;
}
function purge_(ids, onlyOwner) {
  const seen = {};
  (ids || []).filter(Boolean).forEach(id => {
    if (seen[id]) return; seen[id] = 1;
    try {
      const f = DriveApp.getFileById(id), d = String(f.getDescription() || '');
      if (d.indexOf('cp:') !== 0 || (onlyOwner && d !== 'cp:' + onlyOwner)) return;
      const r = UrlFetchApp.fetch(DRIVE_API + '/drive/v3/files/' + id + '?supportsAllDrives=true', { method: 'delete', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } });
      if (r.getResponseCode() >= 300) f.setTrashed(true);
    } catch (e) {}
  });
}
function purgeRows_(name, pred) { const ids = []; rows_(name).filter(pred).forEach(r => fileIds_(r).forEach(i => ids.push(i))); purge_(ids); }
/** ไฟล์ที่อัปโหลดในฟอร์มแต่ไม่ได้บันทึก (กดยกเลิก/ลบออกก่อนบันทึก) */
function discardUploads_(ctx, ids) { purge_((Array.isArray(ids) ? ids : []).slice(0, 50).map(String), ctx.user.id); return true; }
function imgOk_(v) { return /^data:image\/(jpeg|png|webp);base64,/.test(v) ? v.length < 46000 : /^https:\/\/(lh3\.googleusercontent\.com|drive\.google\.com)\//.test(v); }

/* ============================== แจ้งเตือน ============================== */
function studentsFor_(grade, room, courseId) {
  const co = courseId ? find_('Courses', courseId) : null;
  return rows_('Users').filter(u => u.role === 'student' && u.status === 'active' && inList_(grade, u.grade) && inList_(room, u.room)
    && (!co || (inList_(co.grade, u.grade) && inList_(co.room, u.room))));
}
function notifyUsers_(ids, title, body, link) {
  insertMany_('Notifications', ids.map(id => ({ id: id_(), ownerId: id, title: title, body: body, link: link || '', read: 'false', createdAt: now_() })));
}
function broadcast_(students, title, body, link) {
  notifyUsers_(students.map(s => s.id), title, body, link);
  const c = cfg_();
  if (c.emailNotify === 'true') {
    students.filter(s => s.email).slice(0, Math.max(0, MailApp.getRemainingDailyQuota() - 5)).forEach(s => {
      try { MailApp.sendEmail(s.email, '[' + c.schoolName + '] ' + title, body + '\n\n' + (c.siteUrl || ScriptApp.getService().getUrl())); } catch (e) {}
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
/** ครูผู้สอนแก้ไข/ดูได้เฉพาะข้อมูลในรายวิชาของตนเอง (แอดมินได้ทั้งหมด) */
function rowOwned_(u, entity, r) {
  if (isAdmin_(u)) return true;
  if (entity === 'Classes' || entity === 'Categories') return true;
  if (entity === 'Courses') return r.ownerId === u.id;
  if (entity === 'Announcements') return r.courseId ? ownCourse_(u, r.courseId) : r.ownerId === u.id;
  return ownCourse_(u, r.courseId);
}
function list_(ctx, entity) {
  if (!EDITABLE[entity]) throw err_('ไม่รู้จักตาราง ' + entity);
  if (entity === 'Classes') return classSummary_(ctx).classes;
  const users = {}; if (entity === 'Courses') rows_('Users').forEach(u => users[u.id] = u.prefix + u.fullName);
  return rows_(entity).filter(r => rowOwned_(ctx.user, entity, r)).map(r => { const o = pub_(r); if (entity === 'Courses') o.ownerName = users[r.ownerId] || ''; return o; }).sort(byOrder_);
}
/** ชั้นเรียน/ห้อง: รวมจากข้อมูลผู้ใช้จริง (นับจำนวนนักเรียน) + เพิ่มรายการที่ยังไม่มีในชีต Classes ให้อัตโนมัติ */
function classSummary_(ctx) {
  const studs = rows_('Users').filter(u => u.role === 'student' && u.grade);
  const key = (g, r) => g + '|' + (r || '');
  const have = {}; rows_('Classes').forEach(c => have[key(c.grade, c.room)] = 1);
  const add = [], seen = {};
  studs.forEach(u => { const k = key(u.grade, u.room); if (!have[k] && !seen[k]) { seen[k] = 1; add.push({ id: id_(), grade: u.grade, room: u.room || '', order: '', createdAt: now_() }); } });
  if (add.length) lock_(() => { delete MEM_.Classes; insertMany_('Classes', add.filter(a => !rows_('Classes').some(c => key(c.grade, c.room) === key(a.grade, a.room)))); });
  const gOrder = g => { const i = GRADES.indexOf(g); return i < 0 ? 99 : i; };
  const classes = rows_('Classes').map(c => Object.assign(pub_(c), {
    students: studs.filter(u => u.grade === c.grade && (!c.room || u.room === c.room)).length }))
    .sort((a, b) => gOrder(a.grade) - gOrder(b.grade) || String(a.grade).localeCompare(String(b.grade)) || (Number(a.room) || 0) - (Number(b.room) || 0));
  const years = {}; studs.forEach(u => { if (u.acadYear) years[u.acadYear] = (years[u.acadYear] || 0) + 1; });
  return { classes: classes, years: years, total: studs.length };
}
function save_(ctx, entity, obj) {
  if (!EDITABLE[entity]) throw err_('ไม่รู้จักตาราง ' + entity);
  obj = obj || {};
  const me = ctx.user;
  if (entity === 'Classes' && !isAdmin_(me)) throw err_('เฉพาะผู้ดูแลระบบจัดการชั้นเรียนได้', 'FORBIDDEN');
  const data = {};
  EDITABLE[entity].forEach(k => { if (obj[k] !== undefined) data[k] = typeof obj[k] === 'object' ? obj[k] : str_(obj[k], k === 'description' || k === 'body' ? 20000 : (k === 'cover' || k === 'image' ? 48000 : k === 'quiz' ? 45000 : 2000)); });
  if (data.quiz !== undefined) { const q = quiz_(data.quiz); data.quiz = q ? JSON.stringify(q) : ''; if (q && q.total > 0) data.maxScore = String(q.total); }
  if (!isAdmin_(me)) {
    delete data.ownerId;
    if (data.courseId && !ownCourse_(me, data.courseId)) throw err_('คุณไม่ใช่ครูผู้สอนของรายวิชานี้', 'FORBIDDEN');
    if (obj.id) { const old = find_(entity, obj.id); if (old && !rowOwned_(me, entity, old)) throw err_('คุณไม่มีสิทธิ์แก้ไขข้อมูลนี้', 'FORBIDDEN'); }
  } else if (entity === 'Courses' && data.ownerId === '') delete data.ownerId;
  else if (entity === 'Courses' && data.ownerId) {
    const t = find_('Users', data.ownerId); if (!t || !staff_(t)) throw err_('ครูผู้สอนไม่ถูกต้อง');
  }
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
      const before = fileIds_(row);
      updateRow_(entity, row, data);
      const after = fileIds_(row);
      purge_(before.filter(i => after.indexOf(i) < 0));
      log_(ctx.user.id, 'update_' + entity, obj.id);
    } else {
      row = insert_(entity, Object.assign({ id: id_(), ownerId: ctx.user.id, createdAt: now_(), updatedAt: now_() }, data));
      log_(ctx.user.id, 'create_' + entity, row.id);
      if (entity === 'Lessons' && !(row.publishAt && row.publishAt > now_())) broadcast_(studentsFor_('', '', row.courseId), 'บทเรียนใหม่: ' + row.title, find_('Courses', row.courseId).name, 'lesson:' + row.id);
      if (entity === 'Assignments') broadcast_(studentsFor_(row.grade, row.room, row.courseId), row.type + 'ใหม่: ' + row.title, 'กำหนดส่ง ' + row.dueAt.replace('T', ' ').slice(0, 16), 'assignment:' + row.id);
      if (entity === 'Announcements') broadcast_(studentsFor_(row.grade, row.room, row.courseId), (row.type || 'ประกาศ') + ': ' + row.title, str_(row.body, 200), 'announcement:' + row.id);
    }
    return pub_(row);
  });
}
function remove_(ctx, entity, id) {
  if (!EDITABLE[entity]) throw err_('ไม่รู้จักตาราง ' + entity);
  if (entity === 'Classes' && !isAdmin_(ctx.user)) throw err_('เฉพาะผู้ดูแลระบบจัดการชั้นเรียนได้', 'FORBIDDEN');
  return lock_(() => {
    const row = find_(entity, id);
    if (!row) throw err_('ไม่พบข้อมูล');
    if (!rowOwned_(ctx.user, entity, row) || (entity === 'Categories' && !isAdmin_(ctx.user) && rows_('Courses').some(c => c.category === row.name && c.ownerId !== ctx.user.id)))
      throw err_('คุณไม่มีสิทธิ์ลบข้อมูลนี้', 'FORBIDDEN');
    const counts = {};
    if (entity === 'Courses') {
      const asg = rows_('Assignments').filter(a => a.courseId === id).map(a => a.id);
      purgeRows_('Submissions', s => asg.indexOf(s.assignmentId) >= 0); purgeRows_('Assignments', a => a.courseId === id); purgeRows_('Lessons', l => l.courseId === id);
      counts.Submissions = deleteWhere_('Submissions', s => asg.indexOf(s.assignmentId) >= 0);
      counts.Assignments = deleteWhere_('Assignments', a => a.courseId === id);
      counts.Progress = deleteWhere_('Progress', p => p.courseId === id);
      counts.Lessons = deleteWhere_('Lessons', l => l.courseId === id);
    }
    if (entity === 'Lessons') counts.Progress = deleteWhere_('Progress', p => p.lessonId === id);
    if (entity === 'Assignments') { purgeRows_('Submissions', s => s.assignmentId === id); counts.Submissions = deleteWhere_('Submissions', s => s.assignmentId === id); }
    purge_(fileIds_(row));
    deleteWhere_(entity, r => r.id === id);
    log_(ctx.user.id, 'delete_' + entity, { id: id, name: row.name || row.title || row.grade, cascade: counts });
    return counts;
  });
}

/* ============================== Admin: ผู้ใช้ ============================== */
function listUsers_() {
  const r = { admin: 0, teacher: 1, student: 2 };
  return rows_('Users').map(pub_).sort((a, b) => (r[a.role] - r[b.role]) || String(b.acadYear).localeCompare(String(a.acadYear)) || String(a.grade).localeCompare(String(b.grade))
    || (Number(a.room) || 0) - (Number(b.room) || 0) || (Number(a.classNo) || 999) - (Number(b.classNo) || 999) || String(a.studentCode).localeCompare(String(b.studentCode)));
}
function listTeachers_() { return rows_('Users').filter(u => staff_(u) && u.status === 'active').map(u => ({ id: u.id, name: u.prefix + u.fullName, role: u.role })); }
function acadYear_(v) { v = str_(v, 4); if (v && !/^25\d\d$/.test(v)) throw err_('ปีการศึกษาต้องเป็น พ.ศ. 4 หลัก เช่น 2569'); return v; }
function saveUser_(ctx, d) {
  d = d || {};
  return lock_(() => {
    const isNew = !d.id, u = isNew ? null : find_('Users', d.id);
    if (!isNew && !u) throw err_('ไม่พบผู้ใช้');
    const role = isNew ? (d.role === 'teacher' || d.role === 'admin' ? 'teacher' : 'student') : u.role;
    const patch = { updatedAt: now_() };
    ['prefix', 'fullName', 'birthDate', 'grade', 'room', 'email', 'nickname'].forEach(k => { if (d[k] !== undefined) patch[k] = str_(d[k], 100); });
    if (d.classNo !== undefined) patch.classNo = classNo_(d.classNo);
    if (d.acadYear !== undefined) patch.acadYear = acadYear_(d.acadYear);
    if (d.status !== undefined) {
      if (['active', 'pending', 'disabled'].indexOf(d.status) < 0) throw err_('สถานะไม่ถูกต้อง');
      if (!isNew && u.role === 'admin' && d.status !== 'active') throw err_('ระงับบัญชีผู้ดูแลระบบไม่ได้');
      if (!isNew && u.id === ctx.user.id && d.status !== 'active') throw err_('ระงับบัญชีที่กำลังใช้งานอยู่ไม่ได้');
      patch.status = d.status;
    }
    if (role === 'student' && (isNew || d.studentCode !== undefined)) {
      const code = str_(d.studentCode, 5);
      if (!/^\d{5}$/.test(code)) throw err_('รหัสนักเรียนต้องเป็นตัวเลข 5 หลัก');
      if (codeTaken_(code, d.id)) throw err_('รหัสนักเรียนนี้ถูกใช้แล้ว');
      patch.studentCode = code;
    }
    if (role === 'teacher' && (isNew || d.username)) {
      const un = str_(d.username, 20).toLowerCase();
      if (!/^[a-z0-9._]{4,20}$/.test(un) || un === 'admin') throw err_('Username ต้องมี 4–20 ตัว (a-z 0-9 . _) และไม่ใช่ admin');
      if (userTaken_(un, d.id)) throw err_('Username นี้ถูกใช้แล้ว');
      patch.username = un;
    }
    if (role !== 'student' && (isNew || d.password)) {
      if (String(d.password || '').length < 6) throw err_('รหัสผ่านอย่างน้อย 6 ตัว');
      patch.passSalt = id_(); patch.passHash = hashPw_(String(d.password), patch.passSalt); patch.mustChangePassword = role === 'admin' ? 'false' : 'true';
    }
    if (!String(patch.fullName || (u && u.fullName) || '').trim()) throw err_('กรุณากรอกชื่อ-สกุล');
    let row;
    if (isNew) row = insert_('Users', Object.assign({ id: id_(), role: role, status: 'active', createdAt: now_() }, patch));
    else { row = updateRow_('Users', u, patch); if (patch.studentCode || patch.passHash || patch.status === 'disabled') killSessions_(u.id); }
    log_(ctx.user.id, isNew ? 'create_user' : 'update_user', row.id);
    return pub_(row);
  });
}
/** ตรวจรายการนำเข้านักเรียน (ใช้ทั้งพรีวิวและบันทึก) → [{row, status: new|update|dup|invalid, message, data}] */
function checkImport_(list) {
  const byCode = {}; rows_('Users').forEach(u => { if (u.studentCode) byCode[u.studentCode] = u; });
  const seen = {};
  return (Array.isArray(list) ? list : []).slice(0, 2000).map((r, i) => {
    const raw = str_(r.studentCode, 10).replace(/\D/g, '');
    const code = raw ? raw.padStart(5, '0') : '', name = str_(r.fullName, 100).replace(/\s+/g, ' ');
    const data = { studentCode: code, prefix: str_(r.prefix, 30), fullName: name, nickname: str_(r.nickname, 40), birthDate: str_(r.birthDate, 10),
      grade: str_(r.grade, 20), room: str_(r.room, 20), classNo: /^\d{1,3}$/.test(str_(r.classNo, 3)) ? String(Number(r.classNo)) : '', email: str_(r.email, 100), acadYear: /^25\d\d$/.test(str_(r.acadYear, 4)) ? str_(r.acadYear, 4) : '' };
    const out = { row: i + 1, data: data, status: 'new', message: 'เพิ่มใหม่' };
    if (!/^\d{5}$/.test(code)) return Object.assign(out, { status: 'invalid', message: 'รหัสนักเรียนต้องเป็นตัวเลข 5 หลัก' });
    if (!name) return Object.assign(out, { status: 'invalid', message: 'ไม่มีชื่อ-สกุล' });
    if (seen[code]) return Object.assign(out, { status: 'dup', message: 'รหัสซ้ำกับแถว ' + seen[code] + ' ในไฟล์' });
    seen[code] = i + 1;
    const ex = byCode[code];
    if (ex && ex.fullName !== name) return Object.assign(out, { status: 'dup', message: 'รหัสนี้เป็นของ ' + ex.fullName + ' อยู่แล้ว', userId: ex.id });
    if (ex) return Object.assign(out, { status: 'update', message: 'มีอยู่แล้ว (อัปเดตชั้น/ห้อง/เลขที่)', userId: ex.id });
    return out;
  });
}
/** นำเข้านักเรียน: preview=true คืนผลตรวจอย่างเดียว · ไม่ทับรหัสที่เป็นของคนอื่น · เลขที่เปลี่ยนได้ คะแนนเดิมไม่หาย (ผูกกับ id ถาวร) */
function importStudents_(ctx, list, opts) {
  opts = opts || {};
  if (opts.preview) return checkImport_(list);
  return lock_(() => {
    delete MEM_.Users;
    const res = checkImport_(list), add = [], out = { added: 0, updated: 0, skipped: [], ids: [] };
    res.forEach(r => {
      if (r.status === 'new') {
        const idv = id_(); out.ids.push(idv);
        add.push(Object.assign({}, r.data, { id: idv, role: 'student', status: 'active', mustChangePassword: 'false', createdAt: now_(), updatedAt: now_() }));
      } else if (r.status === 'update' && opts.update !== false) {
        const u = find_('Users', r.userId), patch = { updatedAt: now_() };
        ['grade', 'room', 'classNo', 'nickname', 'acadYear', 'prefix'].forEach(k => { if (r.data[k]) patch[k] = r.data[k]; });
        updateRow_('Users', u, patch); out.updated++; out.ids.push(u.id);
      } else if (r.status !== 'update') out.skipped.push('แถว ' + r.row + ': ' + r.message);
    });
    insertMany_('Users', add);
    out.added = add.length;
    log_(ctx.user.id, 'import_students', out.added + ' added, ' + out.updated + ' updated');
    return out;
  });
}
function deleteUser_(ctx, id) {
  return lock_(() => {
    const u = find_('Users', id);
    if (!u) throw err_('ไม่พบผู้ใช้');
    if (u.id === ctx.user.id) throw err_('ลบบัญชีที่กำลังใช้งานอยู่ไม่ได้');
    if (u.role === 'admin') throw err_('ลบบัญชีผู้ดูแลระบบไม่ได้');
    if (rows_('GbScores').some(x => x.studentId === id && x.score !== '')) throw err_('นักเรียนคนนี้มีคะแนนในสมุดผลการเรียนแล้ว — ใช้ "ระงับ" แทนการลบ เพื่อไม่ให้คะแนนสูญหาย');
    killSessions_(id);
    purgeRows_('Submissions', s => s.ownerId === id); purge_(fileIds_(u));
    const counts = { Submissions: deleteWhere_('Submissions', s => s.ownerId === id), Progress: deleteWhere_('Progress', p => p.ownerId === id),
      Notifications: deleteWhere_('Notifications', n => n.ownerId === id) };
    deleteWhere_('Users', x => x.id === id);
    log_(ctx.user.id, 'delete_user', { id: id, name: u.fullName, cascade: counts });
    return counts;
  });
}
/** สลับบทบาท ครูผู้สอน ↔ นักเรียน (ผู้ดูแลระบบมีคนเดียว เปลี่ยนไม่ได้) */
function setRole_(ctx, id, role, extra) {
  extra = extra || {};
  if (role === 'admin') role = 'teacher';
  return lock_(() => {
    const u = find_('Users', id);
    if (!u) throw err_('ไม่พบผู้ใช้');
    if (u.role === 'admin') throw err_('เปลี่ยนบทบาทผู้ดูแลระบบไม่ได้');
    if (u.role === role) return pub_(u);
    if (role === 'teacher') {
      const un = str_(extra.username, 20).toLowerCase(), pw = String(extra.password || '');
      if (!/^[a-z0-9._]{4,20}$/.test(un) || un === 'admin') throw err_('Username ต้องมี 4–20 ตัว (a-z 0-9 . _) และไม่ใช่ admin');
      if (userTaken_(un, id)) throw err_('Username นี้ถูกใช้แล้ว');
      if (pw.length < 6) throw err_('รหัสผ่านอย่างน้อย 6 ตัว');
      const salt = id_();
      updateRow_('Users', u, { role: 'teacher', username: un, passSalt: salt, passHash: hashPw_(pw, salt), mustChangePassword: 'true', updatedAt: now_() });
    } else if (role === 'student') {
      if (u.id === ctx.user.id) throw err_('ลดสิทธิ์บัญชีที่กำลังใช้งานอยู่ไม่ได้');
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
    const un = u.role === 'admin' ? 'admin' : str_(d.username || u.username, 20).toLowerCase(); // ผู้ดูแลระบบใช้ชื่อ admin เสมอ
    if (!/^[a-z0-9._]{4,20}$/.test(un) || (u.role !== 'admin' && un === 'admin')) throw err_('Username ต้องมี 4–20 ตัว (a-z 0-9 . _)');
    if (userTaken_(un, u.id)) throw err_('Username นี้ถูกใช้แล้ว');
    patch.username = un;
    if (d.newPassword) {
      if (String(d.newPassword).length < 6) throw err_('รหัสผ่านใหม่อย่างน้อย 6 ตัว');
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
  if (!ownCourse_(ctx.user, a.courseId)) throw err_('คุณไม่มีสิทธิ์ดูงานของรายวิชานี้', 'FORBIDDEN');
  const c = find_('Courses', a.courseId);
  const subs = rows_('Submissions').filter(s => s.assignmentId === a.id);
  const students = studentsFor_(a.grade, a.room, a.courseId);
  const ids = {}; students.forEach(s => ids[s.id] = 1);
  subs.forEach(s => [s.ownerId].concat(members_(s)).forEach(id => { if (!ids[id]) { const u = find_('Users', id); if (u) { students.push(u); ids[id] = 1; } } }));
  return { assignment: pub_(a), course: pub_(c), rows: students.map(u => {
    const s = subs.find(x => inSub_(x, u.id)) || null;
    return { group: s && members_(s).length ? (s.ownerId === u.id ? 'leader' : 'member') : '', leaderName: s ? nameOf_(s.ownerId) : '', groupSize: s ? members_(s).length + 1 : 0, user: { id: u.id, fullName: u.prefix + u.fullName, studentCode: u.studentCode, grade: u.grade, room: u.room, classNo: u.classNo }, sub: s ? pub_(s) : null, status: subStatus_(a, s) };
  }).sort((x, y) => (Number(x.user.classNo) || 999) - (Number(y.user.classNo) || 999) || String(x.user.studentCode).localeCompare(String(y.user.studentCode))) };
}
function gradeSubmission_(ctx, subId, score, feedback, qScores) {
  return lock_(() => {
    const s = find_('Submissions', subId);
    if (!s) throw err_('ไม่พบงานที่ส่ง');
    const a = find_('Assignments', s.assignmentId);
    if (!ownCourse_(ctx.user, a.courseId)) throw err_('คุณไม่มีสิทธิ์ตรวจงานของรายวิชานี้', 'FORBIDDEN');
    const patch = {};
    if (qScores && typeof qScores === 'object') { // คะแนนรายข้อ (ข้อเขียนที่ครูตรวจเอง)
      const q = json_(a.quiz, null), auto = json_(s.autoScore, {});
      (q ? q.questions : []).forEach(x => { if (qScores[x.id] !== undefined && qScores[x.id] !== '') {
        const v = Number(qScores[x.id]); if (isNaN(v) || v < 0 || v > x.points) throw err_('คะแนนข้อ "' + str_(x.q, 30) + '" ต้องอยู่ระหว่าง 0–' + x.points); auto[x.id] = v; } });
      patch.autoScore = auto;
      if (score === '' || score === undefined || score === null) score = Math.round(Object.keys(auto).reduce((t, k) => t + (Number(auto[k]) || 0), 0) * 100) / 100;
    }
    const n = Number(score);
    if (score === '' || isNaN(n) || n < 0 || n > Number(a.maxScore)) throw err_('คะแนนต้องอยู่ระหว่าง 0–' + a.maxScore);
    updateRow_('Submissions', s, Object.assign(patch, { score: String(n), feedback: str_(feedback, 2000), gradedBy: ctx.user.id, gradedAt: now_(), updatedAt: now_() }));
    gbFromSubmission_(ctx.user, a, s);
    notifyUsers_([s.ownerId].concat(members_(s)), 'ครูตรวจงานแล้ว', a.title + ' ได้ ' + n + '/' + a.maxScore + ' คะแนน', 'assignment:' + a.id);
    log_(ctx.user.id, 'grade', { sub: subId, score: n });
    return pub_(s);
  });
}

/* ============================== Admin: Dashboard / รายงาน ============================== */
function days_(n) { const out = []; for (let i = n - 1; i >= 0; i--) out.push(Utilities.formatDate(new Date(Date.now() - i * 864e5), TZ, 'yyyy-MM-dd')); return out; }
/** นักเรียนที่อยู่ในรายวิชาของครูคนนี้ (แอดมิน = ทุกคน) */
function myStudents_(u) {
  const studs = rows_('Users').filter(x => x.role === 'student');
  if (isAdmin_(u)) return studs;
  const cs = rows_('Courses').filter(c => c.ownerId === u.id), ids = {};
  rows_('GbEnroll').forEach(e => { const g = find_('Gradebooks', e.gbId); if (g && cs.some(c => c.id === g.courseId)) ids[e.studentId] = 1; });
  return studs.filter(x => ids[x.id] || cs.some(c => inList_(c.grade, x.grade) && inList_(c.room, x.room)));
}
function adminDashboard_(ctx) {
  const me = ctx.user, admin = isAdmin_(me), users = rows_('Users'), d = days_(14);
  const count = (list, field) => d.map(day => list.filter(x => String(x[field]).slice(0, 10) === day).length);
  const courses = rows_('Courses').filter(c => courseOk_(me, c)), cid = {}; courses.forEach(c => cid[c.id] = 1);
  const asg = rows_('Assignments').filter(a => cid[a.courseId]), aid = {}; asg.forEach(a => aid[a.id] = 1);
  const subs = rows_('Submissions').filter(s => aid[s.assignmentId]);
  const studs = myStudents_(me), sid = {}; studs.forEach(u => sid[u.id] = 1);
  const lessons = rows_('Lessons').filter(l => cid[l.courseId]), lid = {}; lessons.forEach(l => lid[l.id] = 1);
  const logs = rows_('AuditLog').filter(l => admin || sid[l.userId] || l.userId === me.id);
  return {
    role: me.role, term: term_(),
    cards: { announcements: rows_('Announcements').filter(a => rowOwned_(me, 'Announcements', a)).length, courses: courses.length, lessons: lessons.length, students: studs.length,
      ungraded: subs.filter(s => s.score === '').length, assignments: asg.length, pendingUsers: admin ? users.filter(u => u.status === 'pending').length : 0,
      teachers: admin ? users.filter(u => u.role === 'teacher').length : 0 },
    days: d, logins: count(logs.filter(l => l.action === 'login'), 'createdAt'), views: count(logs.filter(l => l.action === 'view_lesson' && (admin || lid[l.detail])), 'createdAt'),
    submissions: count(subs, 'submittedAt'),
    status: { ontime: subs.filter(s => s.status === 'ontime').length, late: subs.filter(s => s.status === 'late').length, graded: subs.filter(s => s.score !== '').length },
    recent: logs.slice(-10).reverse().map(l => ({ action: l.action, at: l.createdAt, user: (find_('Users', l.userId) || {}).fullName || '-' }))
  };
}
function report_(ctx, type, f) {
  f = f || {};
  const users = myStudents_(ctx.user).filter(u => (!f.grade || u.grade === f.grade) && (!f.room || u.room === f.room));
  const name = u => u.prefix + u.fullName;
  const courses = rows_('Courses').filter(c => courseOk_(ctx.user, c) && (!f.courseId || c.id === f.courseId));
  const cids = courses.map(c => c.id);
  const logs = rows_('AuditLog');
  if (type === 'attendance') {
    return { title: 'รายงานการเข้าเรียน (การเข้าสู่ระบบ)', headers: ['รหัส', 'ชื่อ-สกุล', 'ชั้น/ห้อง', 'จำนวนครั้งที่เข้าระบบ', 'เข้าล่าสุด'],
      rows: users.map(u => { const l = logs.filter(x => x.userId === u.id && x.action === 'login'); return [u.studentCode, name(u), u.grade + '/' + u.room, l.length, l.length ? l[l.length - 1].createdAt : (u.lastLoginAt || '-')]; }) };
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
      const cells = asg.map(a => { const s = subs.find(x => x.assignmentId === a.id && inSub_(x, u.id));
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

/* ============================== ผลการเรียน (Gradebook) ==============================
 * โครงสร้าง: Gradebooks (1 รายวิชา × ปีการศึกษา × ภาคเรียน) → หมวดคะแนน / ตัวชี้วัด / รายการคะแนน → คะแนนรายคน (GbScores)
 * หลักการ: ช่องว่าง ≠ 0 · ไม่ส่งงานไม่ถูกแปลงเป็น 0 เว้นแต่ครูสั่ง · ไม่ลบรายการที่มีคะแนน (เก็บถาวรแทน)
 *          ผลที่เผยแพร่แล้วเป็นสำเนา (GbResults) ไม่เปลี่ยนเงียบ ๆ ต้องเผยแพร่ฉบับปรับปรุง · นักเรียนได้รับเฉพาะสำเนาของตนเอง
 */
const GB_CRITERIA = { scale: '4', basis: 'pct', decimals: 2, rounding: 'half-up', gradeFrom: 'rounded', coursePass: 50,
  ranges: [{ min: 80, grade: '4' }, { min: 75, grade: '3.5' }, { min: 70, grade: '3' }, { min: 65, grade: '2.5' }, { min: 60, grade: '2' },
    { min: 55, grade: '1.5' }, { min: 50, grade: '1' }, { min: 0, grade: '0' }] };
const GB_VIS = { items: true, categories: true, indicators: true, total: true, grade: false, notes: true };
const SUBMIT = ['', 'missing', 'submitted', 'late', 'exempt'], CHECK = ['', 'unchecked', 'checked', 'revise'];
const r6_ = x => Math.round(Number(x) * 1e6) / 1e6;
function round_(x, d, mode) {
  const f = Math.pow(10, Math.max(0, Math.min(4, Number(d) || 0))), y = r6_(x * f);
  return (mode === 'down' ? Math.floor(y) : mode === 'up' ? Math.ceil(y) : Math.round(y)) / f;
}
function gbRow_(id) { const g = find_('Gradebooks', id); if (!g) throw err_('ไม่พบสมุดผลการเรียน'); return g; }
function gbCan_(u, g) { return isAdmin_(u) || g.ownerId === u.id || ownCourse_(u, g.courseId); }
function gbOk_(u, g) { if (!gbCan_(u, g)) throw err_('คุณไม่มีสิทธิ์ในสมุดผลการเรียนนี้', 'FORBIDDEN'); return g; }
function gbItem_(r) { return Object.assign({}, r, { max: Number(r.maxScore) || 0, components: json_(r.components, []) }); }
/** โหลดสถานะทั้งหมดของสมุด 1 เล่ม (ใช้ทั้งคำนวณจริงและพรีวิว) */
function gbLoad_(gbId) {
  const g = gbRow_(gbId);
  const gb = Object.assign({}, g, { criteria: Object.assign({}, GB_CRITERIA, json_(g.criteria, {})), visibility: Object.assign({}, GB_VIS, json_(g.visibility, {})) });
  const users = {}; rows_('Users').forEach(u => users[u.id] = u);
  const enroll = rows_('GbEnroll').filter(e => e.gbId === gbId);
  const scores = {}; rows_('GbScores').filter(s => s.gbId === gbId).forEach(s => scores[s.itemId + '|' + s.studentId] = s);
  return {
    gb: gb,
    cats: rows_('GbCategories').filter(c => c.gbId === gbId).map(c => Object.assign({}, c)).sort(byOrder_),
    inds: rows_('GbIndicators').filter(c => c.gbId === gbId).map(c => Object.assign({}, c)).sort(byOrder_),
    items: rows_('GbItems').filter(c => c.gbId === gbId).map(gbItem_).sort(byOrder_),
    enroll: enroll,
    students: enroll.filter(e => e.status !== 'dropped' && users[e.studentId]).map(e => users[e.studentId])
      .sort((a, b) => String(a.grade).localeCompare(String(b.grade)) || (Number(a.room) || 0) - (Number(b.room) || 0) || (Number(a.classNo) || 999) - (Number(b.classNo) || 999) || String(a.studentCode).localeCompare(String(b.studentCode))),
    scores: scores,
    groups: rows_('GbGroups').filter(x => x.gbId === gbId)
  };
}
function criteriaErrors_(c, total) {
  const e = [];
  if (['4', 'pf', 'custom'].indexOf(String(c.scale)) < 0) e.push('รูปแบบผลการเรียนไม่ถูกต้อง');
  if (['pct', 'raw'].indexOf(c.basis) < 0) e.push('ฐานการตัดเกรดต้องเป็นร้อยละหรือคะแนนดิบ');
  if (!(Number(c.decimals) >= 0 && Number(c.decimals) <= 4)) e.push('ทศนิยมต้องอยู่ระหว่าง 0–4 ตำแหน่ง');
  const r = Array.isArray(c.ranges) ? c.ranges : [], top = c.basis === 'raw' ? total : 100, mins = {};
  if (!r.length) e.push('ยังไม่ได้กำหนดเกณฑ์ช่วงคะแนน');
  r.forEach(x => {
    const m = Number(x.min);
    if (x.min === '' || isNaN(m) || m < 0 || m > top) e.push('ช่วงคะแนน "' + x.grade + '" ต้องอยู่ระหว่าง 0–' + top);
    if (!String(x.grade || '').trim()) e.push('ช่วงคะแนนเริ่ม ' + x.min + ' ยังไม่มีผลการเรียน');
    if (mins[m]) e.push('ช่วงคะแนนซ้อนกัน: เริ่มที่ ' + m + ' ซ้ำ'); mins[m] = 1;
  });
  if (r.length && !r.some(x => Number(x.min) === 0)) e.push('เกณฑ์ต้องครอบคลุมถึง 0 (มีช่องว่างของช่วงคะแนนด้านล่าง)');
  if (isNaN(Number(c.coursePass)) || Number(c.coursePass) < 0 || Number(c.coursePass) > top) e.push('เกณฑ์ผ่านรายวิชาต้องอยู่ระหว่าง 0–' + top);
  return e;
}
function gradeOf_(v, c) {
  const r = (c.ranges || []).slice().sort((a, b) => Number(b.min) - Number(a.min));
  const x = r.find(x => v >= Number(x.min) - 1e-9);
  return x ? String(x.grade) : '';
}
/** เครื่องคำนวณหลัก — ใช้ตัวเดียวกันทั้งพรีวิวและผลจริง */
function gbCalc_(S) {
  const gb = S.gb, total = Number(gb.totalScore) || 0, cr = gb.criteria, mode = gb.mode === 'weighted' ? 'weighted' : 'sum';
  const errors = [], warnings = [];
  const cats = S.cats.filter(c => c.status !== 'archived'), catById = {}; cats.forEach(c => catById[c.id] = c);
  const inds = S.inds.filter(i => i.status !== 'archived'), indById = {}; inds.forEach(i => indById[i.id] = i);
  const live = S.items.filter(i => i.status !== 'archived');
  const items = live.filter(i => i.counted !== 'false');
  const sumMax = r6_(items.reduce((t, i) => t + i.max, 0));
  let sumW = 0;
  if (!(total > 0)) errors.push('ยังไม่ได้กำหนดคะแนนเต็มของรายวิชา');
  if (mode === 'sum' && total > 0 && Math.abs(sumMax - total) > 1e-6) errors.push('คะแนนเต็มของรายการที่นับรวม = ' + sumMax + ' ยังไม่เท่ากับคะแนนเต็มรายวิชา ' + total);
  if (mode === 'weighted') {
    cats.forEach(c => {
      const w = Number(c.weight) || 0; sumW += w;
      if (w < 0) errors.push('น้ำหนักหมวด "' + c.name + '" ติดลบไม่ได้');
      const m = items.filter(i => i.categoryId === c.id).reduce((t, i) => t + i.max, 0);
      if (w > 0 && !(m > 0)) errors.push('หมวด "' + c.name + '" มีน้ำหนัก ' + w + '% แต่ยังไม่มีรายการคะแนนที่มีคะแนนเต็ม');
    });
    sumW = r6_(sumW);
    if (Math.abs(sumW - 100) > 1e-6) errors.push('น้ำหนักรวมของหมวดคะแนน = ' + sumW + '% ต้องเท่ากับ 100%');
    items.filter(i => !catById[i.categoryId]).forEach(i => errors.push('รายการ "' + i.name + '" ยังไม่อยู่ในหมวดคะแนน (โหมดถ่วงน้ำหนักต้องระบุหมวด)'));
  }
  live.forEach(i => {
    if (!(i.max > 0)) errors.push('รายการ "' + i.name + '" ต้องมีคะแนนเต็มมากกว่า 0');
    if (i.components.length) {
      const cm = r6_(i.components.reduce((t, c) => t + (Number(c.max) || 0), 0)), seen = {};
      if (Math.abs(cm - i.max) > 1e-6) errors.push('รายการ "' + i.name + '": คะแนนองค์ประกอบตามตัวชี้วัดรวม ' + cm + ' ≠ คะแนนเต็ม ' + i.max);
      i.components.forEach(c => { if (seen[c.indicatorId]) errors.push('รายการ "' + i.name + '": ตัวชี้วัดซ้ำในรายการเดียวกัน (จะนับซ้ำ)'); seen[c.indicatorId] = 1;
        if (!indById[c.indicatorId]) warnings.push('รายการ "' + i.name + '" อ้างถึงตัวชี้วัดที่ถูกเก็บถาวร/ลบแล้ว'); });
    }
    if (i.categoryId && !catById[i.categoryId] && mode === 'sum') warnings.push('รายการ "' + i.name + '" อยู่ในหมวดที่ถูกเก็บถาวร');
  });
  criteriaErrors_(cr, total).forEach(x => errors.push(x));
  if (!S.students.length) warnings.push('ยังไม่มีนักเรียนในสมุดนี้');
  const dec = Number(cr.decimals) || 0, rnd = v => round_(v, dec, cr.rounding);
  const results = {};
  S.students.forEach(st => {
    const R = { earned: 0, max: 0, missing: 0, exempt: 0, recorded: 0, cats: {}, inds: {} };
    cats.forEach(c => R.cats[c.id] = { earned: 0, max: 0, weight: Number(c.weight) || 0, score: null, missing: 0 });
    inds.forEach(x => R.inds[x.id] = { earned: 0, max: 0, missing: 0 });
    items.forEach(it => {
      const rec = S.scores[it.id + '|' + st.id] || {}, ex = rec.submit === 'exempt';
      const sc = rec.score === '' || rec.score === undefined ? null : Number(rec.score);
      const C = R.cats[it.categoryId];
      if (ex) { R.exempt++; return; } // ยกเว้น: ไม่นับทั้งคะแนนที่ได้และคะแนนเต็ม
      R.max += it.max; if (C) C.max += it.max;
      if (sc === null) { R.missing++; if (C) C.missing++; } else { R.earned += sc; R.recorded++; if (C) C.earned += sc; }
      const comp = json_(rec.comp, {});
      it.components.forEach(cp => {
        const I = R.inds[cp.indicatorId]; if (!I) return;
        I.max += Number(cp.max) || 0;
        const v = comp[cp.indicatorId] !== undefined && comp[cp.indicatorId] !== '' ? Number(comp[cp.indicatorId]) : (it.components.length === 1 && sc !== null ? sc : null);
        if (v === null) I.missing++; else I.earned += v;
      });
    });
    let t;
    if (mode === 'weighted') {
      let sum = 0, wUsed = 0;
      Object.keys(R.cats).forEach(k => { const C = R.cats[k]; if (C.weight > 0 && C.max > 0) { C.score = C.earned / C.max * C.weight; sum += C.score; wUsed += C.weight; } });
      t = wUsed > 0 ? sum / wUsed * total : 0;
    } else {
      const exMax = items.filter(it => (S.scores[it.id + '|' + st.id] || {}).submit === 'exempt').reduce((a, it) => a + it.max, 0);
      t = exMax > 0 && gb.exemptPolicy !== 'none' ? (R.max > 0 ? R.earned / R.max * total : 0) : R.earned;
      Object.keys(R.cats).forEach(k => { const C = R.cats[k]; C.score = C.earned; });
    }
    R.total = r6_(t); R.pct = total > 0 ? r6_(t / total * 100) : 0;
    R.totalR = rnd(R.total); R.pctR = rnd(R.pct);
    const basisVal = cr.basis === 'raw' ? (cr.gradeFrom === 'raw' ? R.total : R.totalR) : (cr.gradeFrom === 'raw' ? R.pct : R.pctR);
    R.grade = gradeOf_(basisVal, cr);
    R.pass = basisVal >= Number(cr.coursePass) - 1e-9;
    R.complete = R.missing === 0;
    Object.keys(R.inds).forEach(k => { const I = R.inds[k], def = indById[k]; I.pct = I.max > 0 ? r6_(I.earned / I.max * 100) : null;
      I.complete = I.missing === 0; I.pass = I.max > 0 ? (def.passType === 'score' ? I.earned >= Number(def.passValue) - 1e-9 : I.pct >= (Number(def.passValue) || 50) - 1e-9) : null; });
    R.earned = r6_(R.earned); R.max = r6_(R.max);
    results[st.id] = R;
  });
  const itemStats = {};
  live.forEach(it => {
    const v = [], st = { recorded: 0, blank: 0, missing: 0, late: 0, exempt: 0, unchecked: 0, revise: 0 };
    S.students.forEach(s => { const rec = S.scores[it.id + '|' + s.id] || {};
      if (rec.submit === 'exempt') st.exempt++; else if (rec.score === '' || rec.score === undefined) st.blank++; else { st.recorded++; v.push(Number(rec.score)); }
      if (rec.submit === 'missing') st.missing++; if (rec.submit === 'late') st.late++; if (rec.check === 'unchecked') st.unchecked++; if (rec.check === 'revise') st.revise++; });
    st.mean = v.length ? r6_(v.reduce((a, b) => a + b, 0) / v.length) : null; st.min = v.length ? Math.min.apply(null, v) : null; st.max = v.length ? Math.max.apply(null, v) : null;
    itemStats[it.id] = st;
  });
  const all = S.students.map(s => results[s.id]), done = all.filter(r => r.complete), dist = {};
  done.forEach(r => dist[r.grade] = (dist[r.grade] || 0) + 1);
  const mean = list => list.length ? r6_(list.reduce((a, r) => a + r.pct, 0) / list.length) : null;
  return { valid: !errors.length, errors: errors, warnings: warnings, sumMax: sumMax, sumWeight: sumW, mode: mode, results: results, itemStats: itemStats,
    summary: { students: all.length, complete: done.length, incomplete: all.length - done.length, meanPctComplete: mean(done), meanPctAll: mean(all), grades: dist,
      passed: done.filter(r => r.pass).length, basis: 'ค่าเฉลี่ยและการกระจายเกรดคิดเฉพาะนักเรียนที่คะแนนครบ (' + done.length + ' คน)' } };
}
function stuInfo_(u) { return { id: u.id, code: u.studentCode, prefix: u.prefix, fullName: u.fullName, nickname: u.nickname, grade: u.grade, room: u.room, classNo: u.classNo, status: u.status }; }
function gbPub_(S) {
  const c = find_('Courses', S.gb.courseId) || {};
  const g = Object.assign(pub_(S.gb), { criteria: S.gb.criteria, visibility: S.gb.visibility });
  delete g.updatedBy;
  return { gb: g, course: c.id ? { id: c.id, code: c.code, name: c.name, teacher: c.teacher || nameOf_(c.ownerId), grade: c.grade, room: c.room } : null,
    cats: S.cats.map(pub_), inds: S.inds.map(pub_), items: S.items.map(i => Object.assign(pub_(i), { components: i.components })),
    students: S.students.map(stuInfo_), dropped: S.enroll.filter(e => e.status === 'dropped').map(e => e.studentId),
    scores: Object.keys(S.scores).map(k => pub_(S.scores[k])), groups: S.groups.map(g2 => Object.assign(pub_(g2), { members: json_(g2.members, []) })) };
}
function gbList_(ctx, f) {
  f = f || {};
  const u = ctx.user, courses = {}; rows_('Courses').forEach(c => courses[c.id] = c);
  const en = {}; rows_('GbEnroll').forEach(e => { if (e.status !== 'dropped') en[e.gbId] = (en[e.gbId] || 0) + 1; });
  const it = {}; rows_('GbItems').forEach(i => { if (i.status !== 'archived') it[i.gbId] = (it[i.gbId] || 0) + 1; });
  return rows_('Gradebooks').filter(g => gbCan_(u, g) && (!f.acadYear || g.acadYear === f.acadYear) && (!f.term || g.term === f.term))
    .map(g => { const c = courses[g.courseId] || {}; return Object.assign(pub_(g), { criteria: undefined, visibility: undefined, courseName: c.name || '(ลบแล้ว)', courseCode: c.code || '',
      ownerName: nameOf_(g.ownerId), students: en[g.id] || 0, items: it[g.id] || 0 }); })
    .sort((a, b) => String(b.acadYear).localeCompare(String(a.acadYear)) || String(b.term).localeCompare(String(a.term)) || String(a.courseCode).localeCompare(String(b.courseCode)));
}
function gbGet_(ctx, gbId) {
  const g = gbOk_(ctx.user, gbRow_(gbId)), S = gbLoad_(g.id), out = gbPub_(S);
  out.calc = gbCalc_(S);
  out.assignments = rows_('Assignments').filter(a => a.courseId === g.courseId).map(a => ({ id: a.id, title: a.title, type: a.type, maxScore: a.maxScore, dueAt: a.dueAt, group: isGroup_(a) }));
  out.versions = rows_('GbVersions').filter(v => v.gbId === g.id).length;
  return out;
}
function newGb_(u, d) {
  const c = find_('Courses', d.courseId);
  if (!c) throw err_('กรุณาเลือกรายวิชา');
  if (!ownCourse_(u, c.id)) throw err_('คุณไม่ใช่ครูผู้สอนของรายวิชานี้', 'FORBIDDEN');
  const year = acadYear_(d.acadYear) || term_().year, term = String(d.term) === '2' ? '2' : '1';
  if (rows_('Gradebooks').some(g => g.courseId === c.id && g.acadYear === year && g.term === term)) throw err_('รายวิชานี้มีสมุดผลการเรียนของภาคเรียน ' + term + '/' + year + ' แล้ว');
  const total = Number(d.totalScore || 100);
  if (!(total > 0) || total > 10000) throw err_('คะแนนเต็มรายวิชาต้องมากกว่า 0');
  return insert_('Gradebooks', { id: id_(), courseId: c.id, name: str_(d.name, 120) || c.name, acadYear: year, term: term,
    grade: str_(d.grade !== undefined ? d.grade : c.grade, 200), rooms: str_(d.rooms !== undefined ? d.rooms : c.room, 200), totalScore: String(total),
    mode: d.mode === 'weighted' ? 'weighted' : 'sum', criteria: JSON.stringify(d.criteria || GB_CRITERIA), visibility: JSON.stringify(d.visibility || GB_VIS),
    exemptPolicy: d.exemptPolicy === 'none' ? 'none' : 'rescale', status: 'draft', structVersion: '1', pubKind: '', pubVersion: '0', publishedAt: '', needsRepublish: 'false',
    ownerId: c.ownerId || u.id, createdAt: now_(), updatedAt: now_(), ver: '1' });
}
function gbCreate_(ctx, d) {
  d = d || {};
  const g = lock_(() => { const row = newGb_(ctx.user, d); gbAuditAdd_([{ gbId: row.id, entity: 'gradebook', entityId: row.id, field: 'create', newValue: row.name + ' ' + row.term + '/' + row.acadYear }], ctx.user, ''); return row; });
  gbEnroll_(ctx, g.id, 'syncRooms');
  return gbGet_(ctx, g.id);
}
/* ---------- เขียนข้อมูลเป็นชุด ---------- */
function updateMany_(name, list) {
  if (!list.length) return;
  const h = headers_(name), sh = sheet_(name);
  list = list.slice().sort((a, b) => a._r - b._r);
  for (let i = 0; i < list.length;) {
    let j = i; while (j + 1 < list.length && list[j + 1]._r === list[j]._r + 1) j++;
    sh.getRange(list[i]._r, 1, j - i + 1, h.length).setValues(list.slice(i, j + 1).map(r => h.map(k => cell_(r[k]))));
    i = j + 1;
  }
  bump_(name);
}
/** ประวัติการแก้ไข: ผู้แก้ เวลา ค่าเดิม ค่าใหม่ เหตุผล รหัสชุด (ไม่บันทึกรหัสผ่าน/โทเคน) */
function gbAuditAdd_(list, u, batchId) {
  insertMany_('GbAudit', list.map(a => ({ id: id_(), gbId: a.gbId, entity: a.entity, entityId: a.entityId || '', field: a.field || '', oldValue: str_(a.oldValue, 2000),
    newValue: str_(a.newValue, 2000), reason: str_(a.reason, 300), batchId: batchId || '', by: u ? u.id : 'system', at: now_() })));
}
function markChanged_(g) { if (g.pubKind) updateRow_('Gradebooks', g, { needsRepublish: 'true', updatedAt: now_() }); }
const num2_ = v => /^\d+(\.\d{1,2})?$/.test(String(v));
/**
 * บันทึกคะแนนชุดเดียว (ต้องอยู่ใน lock) — ตรวจครบทุกแถวก่อน ถ้าผิดแม้แถวเดียวจะไม่บันทึกเลย
 * entries: [{itemId, studentId, score?, comp?, submit?, check?, note?, ver?, groupId?, adjust?, adjustReason?}]
 */
function writeScores_(u, g, entries, batchId, reason, opts) {
  opts = opts || {};
  delete MEM_.GbScores;
  const items = {}; rows_('GbItems').filter(i => i.gbId === g.id).forEach(i => items[i.id] = gbItem_(i));
  const enrolled = {}; rows_('GbEnroll').filter(e => e.gbId === g.id && e.status !== 'dropped').forEach(e => enrolled[e.studentId] = 1);
  const cur = {}; rows_('GbScores').filter(s => s.gbId === g.id).forEach(s => cur[s.itemId + '|' + s.studentId] = s);
  const errs = [], conflicts = [], plan = [], seen = {};
  (Array.isArray(entries) ? entries : []).slice(0, 5000).forEach((e, n) => {
    const it = items[e.itemId], tag = 'แถว ' + (n + 1) + ': ', key = e.itemId + '|' + e.studentId;
    if (!it) return errs.push(tag + 'ไม่พบรายการคะแนน');
    if (it.status === 'archived' && !opts.allowArchived) return errs.push(tag + 'รายการ "' + it.name + '" ถูกเก็บถาวรแล้ว');
    if (!enrolled[e.studentId]) return errs.push(tag + 'นักเรียนไม่อยู่ในสมุดนี้');
    if (seen[key]) return errs.push(tag + 'ข้อมูลซ้ำในชุดเดียวกัน'); seen[key] = 1;
    const old = cur[key], next = {};
    if (!opts.skipVer && old && e.ver !== undefined && String(e.ver) !== String(old.ver)) return conflicts.push({ itemId: e.itemId, studentId: e.studentId, current: pub_(old) });
    if (!opts.skipVer && !old && e.ver !== undefined && e.ver !== '' && e.ver !== null) return conflicts.push({ itemId: e.itemId, studentId: e.studentId, current: null });
    if (e.comp !== undefined && it.components.length > 1) {
      const comp = {}; let sum = 0, all = true;
      it.components.forEach(cp => { const v = e.comp && e.comp[cp.indicatorId];
        if (v === undefined || v === null || v === '') { all = false; return; }
        if (!num2_(v) || Number(v) > Number(cp.max)) errs.push(tag + 'คะแนนองค์ประกอบต้องอยู่ระหว่าง 0–' + cp.max + ' (ทศนิยมไม่เกิน 2 ตำแหน่ง)');
        comp[cp.indicatorId] = Number(v); sum += Number(v); });
      next.comp = JSON.stringify(comp);
      if (all) next.score = String(r6_(sum)); else if (e.score === undefined) next.score = '';
    }
    if (e.score !== undefined && next.score === undefined) {
      const v = e.score === null ? '' : String(e.score).trim();
      if (v !== '' && (!num2_(v) || Number(v) > it.max)) return errs.push(tag + '"' + it.name + '" คะแนนต้องอยู่ระหว่าง 0–' + it.max + ' (ทศนิยมไม่เกิน 2 ตำแหน่ง)');
      next.score = v === '' ? '' : String(Number(v));
    }
    if (e.submit !== undefined) { if (SUBMIT.indexOf(e.submit) < 0) return errs.push(tag + 'สถานะการส่งไม่ถูกต้อง'); next.submit = e.submit; }
    if (e.check !== undefined) { if (CHECK.indexOf(e.check) < 0) return errs.push(tag + 'สถานะการตรวจไม่ถูกต้อง'); next.check = e.check; }
    if (e.note !== undefined) next.note = str_(e.note, 500);
    ['groupId', 'adjust', 'adjustReason'].forEach(k => { if (e[k] !== undefined) next[k] = str_(e[k], 300); });
    plan.push({ key: key, it: it, e: e, old: old, next: next });
  });
  if (errs.length) throw err_('บันทึกไม่สำเร็จ ข้อมูลยังไม่ถูกบันทึก:\n' + errs.slice(0, 15).join('\n'));
  if (conflicts.length) return { ok: false, conflicts: conflicts, saved: 0 };
  const ups = [], ins = [], aud = [];
  plan.forEach(p => {
    const row = p.old, changes = Object.keys(p.next).filter(k => !row || String(row[k] || '') !== String(p.next[k]));
    if (!changes.length) return;
    changes.forEach(k => aud.push({ gbId: g.id, entity: 'score', entityId: p.key, field: k, oldValue: row ? row[k] : '', newValue: p.next[k], reason: p.e.reason || reason }));
    if (row) { changes.forEach(k => row[k] = p.next[k]); row.ver = String((Number(row.ver) || 0) + 1); row.updatedBy = u ? u.id : 'system'; row.updatedAt = now_(); ups.push(row); }
    else ins.push(Object.assign({ id: id_(), gbId: g.id, itemId: p.it.id, studentId: p.e.studentId, score: '', comp: '', submit: '', check: '', note: '', groupId: '', adjust: '', adjustReason: '' },
      p.next, { ver: '1', updatedBy: u ? u.id : 'system', updatedAt: now_() }));
  });
  updateMany_('GbScores', ups); insertMany_('GbScores', ins); gbAuditAdd_(aud, u, batchId);
  if (ups.length || ins.length) markChanged_(g);
  delete MEM_.GbScores;
  const keys = {}; plan.forEach(p => keys[p.key] = 1);
  return { ok: true, saved: ups.length + ins.length, unchanged: plan.length - ups.length - ins.length,
    rows: rows_('GbScores').filter(s => s.gbId === g.id && keys[s.itemId + '|' + s.studentId]).map(pub_) };
}
/** บันทึกคะแนนจากหน้าเว็บ — idempotent ด้วย batchId (กดซ้ำ/เน็ตหลุดแล้วส่งใหม่ จะไม่บันทึกซ้ำ) และตรวจเวอร์ชันกันเขียนทับกัน */
function gbSaveScores_(ctx, gbId, batchId, entries, reason) {
  batchId = str_(batchId, 40);
  if (!/^[\w-]{6,40}$/.test(batchId)) throw err_('รหัสชุดบันทึกไม่ถูกต้อง');
  const g = gbOk_(ctx.user, gbRow_(gbId)), ck = 'gbb_' + batchId;
  const prev = cache_().get(ck); if (prev) return Object.assign(JSON.parse(prev), { duplicate: true });
  return lock_(() => {
    const again = cache_().get(ck); if (again) return Object.assign(JSON.parse(again), { duplicate: true });
    if (rows_('GbAudit').some(a => a.batchId === batchId)) return { ok: true, duplicate: true, saved: 0, rows: [] };
    const res = writeScores_(ctx.user, g, entries, batchId, str_(reason, 300));
    if (res.ok) { try { cache_().put(ck, JSON.stringify(res).slice(0, 90000), 21600); } catch (e) {} }
    return res;
  });
}
/** แปลง "ไม่ส่ง" ที่ยังไม่มีคะแนนเป็น 0 — ทำเฉพาะเมื่อครูสั่งและยืนยันเท่านั้น */
function gbZeroMissing_(ctx, gbId, itemId, confirm, reason) {
  const g = gbOk_(ctx.user, gbRow_(gbId));
  return lock_(() => {
    const S = gbLoad_(g.id), list = S.students.filter(s => { const r = S.scores[itemId + '|' + s.id]; return r && r.submit === 'missing' && r.score === ''; });
    if (!confirm) return { count: list.length, preview: true };
    return writeScores_(ctx.user, g, list.map(s => ({ itemId: itemId, studentId: s.id, score: '0' })), 'zero_' + id_(), str_(reason, 300) || 'ครูสั่งให้ "ไม่ส่ง" = 0 คะแนน', { skipVer: true });
  });
}
/* ---------- งานกลุ่ม ---------- */
function gbSaveGroup_(ctx, gbId, itemId, d) {
  d = d || {};
  const g = gbOk_(ctx.user, gbRow_(gbId));
  return lock_(() => {
    const it = find_('GbItems', itemId); if (!it || it.gbId !== g.id) throw err_('ไม่พบรายการคะแนน');
    const en = {}; rows_('GbEnroll').filter(e => e.gbId === g.id && e.status !== 'dropped').forEach(e => en[e.studentId] = 1);
    const members = (Array.isArray(d.members) ? d.members : []).map(String).filter((m, i, a) => a.indexOf(m) === i && en[m]).slice(0, 30);
    if (!members.length) throw err_('กรุณาเลือกสมาชิกอย่างน้อย 1 คน');
    const other = rows_('GbGroups').filter(x => x.itemId === itemId && x.id !== d.id);
    const dup = members.find(m => other.some(x => json_(x.members, []).indexOf(m) >= 0));
    if (dup) throw err_(nameOf_(dup) + ' อยู่ในกลุ่มอื่นของรายการนี้แล้ว');
    let row;
    if (d.id) { row = find_('GbGroups', d.id); if (!row) throw err_('ไม่พบกลุ่ม');
      gbAuditAdd_([{ gbId: g.id, entity: 'group', entityId: row.id, field: 'members', oldValue: row.members, newValue: JSON.stringify(members), reason: 'เปลี่ยนสมาชิก (คะแนนรายคนเดิมไม่เปลี่ยน)' }], ctx.user, '');
      updateRow_('GbGroups', row, { name: str_(d.name, 80) || row.name, members: members, updatedAt: now_() }); }
    else row = insert_('GbGroups', { id: id_(), gbId: g.id, itemId: itemId, name: str_(d.name, 80) || 'กลุ่ม ' + (other.length + 1), members: members, groupScore: '', createdBy: ctx.user.id, createdAt: now_(), updatedAt: now_() });
    return Object.assign(pub_(row), { members: members });
  });
}
function gbDeleteGroup_(ctx, gbId, groupId) {
  const g = gbOk_(ctx.user, gbRow_(gbId));
  return lock_(() => { const row = find_('GbGroups', groupId); if (!row || row.gbId !== g.id) throw err_('ไม่พบกลุ่ม');
    gbAuditAdd_([{ gbId: g.id, entity: 'group', entityId: groupId, field: 'delete', oldValue: row.members, reason: 'ลบกลุ่ม (คะแนนรายคนยังอยู่)' }], ctx.user, '');
    deleteWhere_('GbGroups', x => x.id === groupId); return true; });
}
/** คะแนนกลุ่ม → เสนอให้สมาชิกทุกคนเท่ากัน · ปรับรายคนได้พร้อมเหตุผล · ผลสุดท้ายเก็บเป็นคะแนนรายคน */
function gbGroupScore_(ctx, gbId, groupId, score, adjust, batchId) {
  const g = gbOk_(ctx.user, gbRow_(gbId));
  adjust = adjust || {};
  return lock_(() => {
    const grp = find_('GbGroups', groupId); if (!grp || grp.gbId !== g.id) throw err_('ไม่พบกลุ่ม');
    const it = gbItem_(find_('GbItems', grp.itemId)), v = String(score === null || score === undefined ? '' : score).trim();
    if (v === '' || !num2_(v) || Number(v) > it.max) throw err_('คะแนนกลุ่มต้องอยู่ระหว่าง 0–' + it.max);
    const entries = json_(grp.members, []).map(m => {
      const a = adjust[m];
      if (a && a.score !== undefined && a.score !== '' && String(a.score) !== v) {
        if (!str_(a.reason, 300)) throw err_('กรุณาระบุเหตุผลการปรับคะแนนของ ' + nameOf_(m));
        return { itemId: it.id, studentId: m, score: String(a.score), groupId: grp.id, adjust: String(r6_(Number(a.score) - Number(v))), adjustReason: str_(a.reason, 300), reason: 'ปรับคะแนนรายคน: ' + str_(a.reason, 200) };
      }
      return { itemId: it.id, studentId: m, score: v, groupId: grp.id, adjust: '', adjustReason: '' };
    });
    const res = writeScores_(ctx.user, g, entries, str_(batchId, 40) || 'grp_' + id_(), 'คะแนนกลุ่ม ' + grp.name, { skipVer: true });
    if (res.ok) updateRow_('GbGroups', grp, { groupScore: v, updatedAt: now_() });
    return res;
  });
}
/* ---------- เชื่อมกับ "งาน/การบ้าน" ---------- */
function subToEntry_(a, s, uid, withScore) {
  const e = { studentId: uid, submit: s ? (s.status === 'late' ? 'late' : 'submitted') : (dt_(a.dueAt) < now_() ? 'missing' : '') };
  if (s) e.check = s.score !== '' ? 'checked' : 'unchecked';
  if (withScore && s && s.score !== '') e.score = s.score;
  return e;
}
/** เมื่อนักเรียนส่งงาน/ครูตรวจงาน → อัปเดตสมุดผลการเรียนที่ผูกกับงานนี้ (ต้องเรียกใน lock) */
function gbFromSubmission_(u, a, s, statusOnly) {
  try {
    rows_('GbItems').filter(i => i.assignmentId === a.id && i.status !== 'archived').forEach(it => {
      const g = find_('Gradebooks', it.gbId); if (!g) return;
      const en = {}; rows_('GbEnroll').filter(e => e.gbId === g.id && e.status !== 'dropped').forEach(e => en[e.studentId] = 1);
      const entries = [s.ownerId].concat(members_(s)).filter(id => en[id]).map(id => Object.assign(subToEntry_(a, s, id, !statusOnly), { itemId: it.id }));
      if (entries.length) writeScores_(u, g, entries, 'sync_' + id_(), 'ซิงก์จากงาน "' + a.title + '"', { skipVer: true });
    });
  } catch (e) { console.error('gbFromSubmission_', e && e.stack); }
}
function syncItem_(u, g, it) {
  const a = find_('Assignments', it.assignmentId); if (!a) throw err_('ไม่พบงานที่ผูกไว้');
  const S = gbLoad_(g.id), subs = rows_('Submissions').filter(s => s.assignmentId === a.id);
  const entries = S.students.map(st => {
    const s = subs.find(x => inSub_(x, st.id)) || null, cur = S.scores[it.id + '|' + st.id] || {};
    const e = Object.assign(subToEntry_(a, s, st.id, true), { itemId: it.id });
    if (!s && cur.submit) delete e.submit; // ไม่ทับสถานะที่ครูกำหนดเอง (เช่น ยกเว้น)
    if (cur.submit === 'exempt') delete e.submit;
    return e;
  });
  if (isGroup_(a) && !rows_('GbGroups').some(x => x.itemId === it.id)) { // สร้างกลุ่มตามที่นักเรียนจัดไว้ตอนส่งงาน
    const en = {}; S.students.forEach(s => en[s.id] = 1);
    insertMany_('GbGroups', subs.map((s, i) => ({ id: id_(), gbId: g.id, itemId: it.id, name: 'กลุ่มของ ' + nameOf_(s.ownerId), members: [s.ownerId].concat(members_(s)).filter(m => en[m]),
      groupScore: s.score, createdBy: 'student', createdAt: now_(), updatedAt: now_() })).filter(x => x.members.length));
  }
  return writeScores_(u, g, entries, 'sync_' + id_(), 'ซิงก์จากงาน "' + a.title + '"', { skipVer: true });
}
function gbSyncAssignment_(ctx, gbId, itemId) {
  const g = gbOk_(ctx.user, gbRow_(gbId));
  return lock_(() => { const it = find_('GbItems', itemId); if (!it || it.gbId !== g.id || !it.assignmentId) throw err_('รายการนี้ไม่ได้ดึงมาจากงาน'); return syncItem_(ctx.user, g, it); });
}
/* ---------- นักเรียนในสมุด ---------- */
function gbImportPreview_(ctx, list) { return checkImport_(list); }
function gbEnroll_(ctx, gbId, op, data) {
  data = data || {};
  const g = gbOk_(ctx.user, gbRow_(gbId));
  let ids = (Array.isArray(data.ids) ? data.ids : []).map(String);
  if (op === 'import') { const r = importStudents_(ctx, data.rows, { update: true }); ids = r.ids; op = 'add'; data.result = r; }
  return lock_(() => {
    delete MEM_.GbEnroll;
    const cur = {}; rows_('GbEnroll').filter(e => e.gbId === g.id).forEach(e => cur[e.studentId] = e);
    if (op === 'syncRooms') ids = rows_('Users').filter(u => u.role === 'student' && u.status === 'active' && inList_(g.grade, u.grade) && inList_(g.rooms, u.room)).map(u => u.id).filter(id => !cur[id]);
    const add = [], ups = [];
    if (op === 'syncRooms' || op === 'add' || op === 'restore') ids.forEach(id => {
      const u = find_('Users', id); if (!u || u.role !== 'student') return;
      if (!cur[id]) add.push({ id: id_(), gbId: g.id, studentId: id, status: 'active', createdAt: now_() });
      else if (cur[id].status === 'dropped') { cur[id].status = 'active'; ups.push(cur[id]); }
    });
    else if (op === 'drop') ids.forEach(id => { if (cur[id] && cur[id].status !== 'dropped') { cur[id].status = 'dropped'; ups.push(cur[id]); } });
    else throw err_('คำสั่งไม่ถูกต้อง');
    insertMany_('GbEnroll', add); updateMany_('GbEnroll', ups);
    if (add.length || ups.length) gbAuditAdd_([{ gbId: g.id, entity: 'enroll', field: op, newValue: (add.length + ups.length) + ' คน', reason: op === 'drop' ? 'ย้ายออก (คะแนนเดิมยังเก็บไว้)' : '' }], ctx.user, '');
    return { added: add.length, updated: ups.length, result: data.result || null };
  });
}
/* ---------- โครงสร้าง: พรีวิวผลกระทบ → ยืนยัน ---------- */
const GB_ENT = { category: 'GbCategories', indicator: 'GbIndicators', item: 'GbItems' };
function cleanCriteria_(c) {
  c = c || {};
  return { scale: ['4', 'pf', 'custom'].indexOf(String(c.scale)) >= 0 ? String(c.scale) : '4', basis: c.basis === 'raw' ? 'raw' : 'pct',
    decimals: Math.max(0, Math.min(4, Math.floor(Number(c.decimals) || 0))), rounding: ['half-up', 'down', 'up'].indexOf(c.rounding) >= 0 ? c.rounding : 'half-up',
    gradeFrom: c.gradeFrom === 'raw' ? 'raw' : 'rounded', coursePass: Number(c.coursePass) || 0,
    ranges: (Array.isArray(c.ranges) ? c.ranges : []).slice(0, 20).map(x => ({ min: x.min === '' ? '' : Number(x.min), grade: str_(x.grade, 20) })) };
}
/** ใช้การเปลี่ยนแปลงกับสำเนาในหน่วยความจำ — คืนรายการที่ต้องเขียนลงชีต */
function applyChange_(S, ch, opts) {
  const ent = ch.kind, d = ch.data || {}, op = ch.op || 'save', out = { rows: [], conflicts: [], scale: null, created: null, desc: '' };
  const list = ent === 'category' ? S.cats : ent === 'indicator' ? S.inds : ent === 'item' ? S.items : null;
  const hasScores = id => Object.keys(S.scores).some(k => k.split('|')[0] === id && S.scores[k].score !== '');
  if (ent === 'settings') {
    const gb = S.gb;
    if (d.name !== undefined) gb.name = str_(d.name, 120);
    if (d.totalScore !== undefined) { const t = Number(d.totalScore); if (!(t > 0) || t > 10000) throw err_('คะแนนเต็มรายวิชาต้องมากกว่า 0'); gb.totalScore = String(r6_(t)); }
    if (d.mode !== undefined) gb.mode = d.mode === 'weighted' ? 'weighted' : 'sum';
    if (d.exemptPolicy !== undefined) gb.exemptPolicy = d.exemptPolicy === 'none' ? 'none' : 'rescale';
    if (d.criteria !== undefined) gb.criteria = cleanCriteria_(d.criteria);
    if (d.visibility !== undefined) { const v = {}; Object.keys(GB_VIS).forEach(k => v[k] = !!(d.visibility || {})[k]); gb.visibility = v; }
    if (d.grade !== undefined) gb.grade = str_(d.grade, 200);
    if (d.rooms !== undefined) gb.rooms = str_(d.rooms, 200);
    out.desc = 'ตั้งค่ารายวิชา';
    return out;
  }
  if (!list) throw err_('ชนิดข้อมูลไม่ถูกต้อง');
  if (op === 'reorder') {
    (Array.isArray(d.ids) ? d.ids : []).forEach((id, i) => { const r = list.find(x => x.id === id); if (r) { r.order = String(i + 1); out.rows.push(r); } });
    out.desc = 'จัดลำดับ'; return out;
  }
  let row = d.id ? list.find(x => x.id === d.id) : null;
  if (d.id && !row) throw err_('ไม่พบข้อมูลที่จะแก้ไข');
  if (op === 'save') {
    const isNew = !row;
    if (isNew) { row = { id: id_(), gbId: S.gb.id, status: ent === 'item' ? 'open' : 'active', order: String(list.length + 1), createdAt: now_() }; list.push(row); out.created = row; }
    row.updatedAt = now_();
    if (ent === 'category') {
      if (d.name !== undefined) row.name = str_(d.name, 80);
      if (d.weight !== undefined) { const w = Number(d.weight); if (isNaN(w) || w < 0 || w > 100) throw err_('น้ำหนักหมวดต้องอยู่ระหว่าง 0–100'); row.weight = String(r6_(w)); }
      if (!row.name) throw err_('กรุณาตั้งชื่อหมวดคะแนน');
      if (S.cats.some(c => c !== row && c.status !== 'archived' && c.name === row.name)) throw err_('ชื่อหมวดซ้ำ');
    } else if (ent === 'indicator') {
      ['code', 'name'].forEach(k => { if (d[k] !== undefined) row[k] = str_(d[k], k === 'name' ? 300 : 40); });
      if (d.description !== undefined) row.description = str_(d.description, 1000);
      if (d.passType !== undefined) row.passType = d.passType === 'score' ? 'score' : 'pct';
      if (d.passValue !== undefined) { const v = Number(d.passValue); if (isNaN(v) || v < 0) throw err_('เกณฑ์ผ่านตัวชี้วัดไม่ถูกต้อง'); row.passValue = String(v); }
      if (!row.passType) row.passType = 'pct'; if (row.passValue === undefined || row.passValue === '') row.passValue = '50';
      if (!row.code || !row.name) throw err_('กรุณากรอกรหัสและชื่อตัวชี้วัด');
      if (S.inds.some(c => c !== row && c.status !== 'archived' && c.code === row.code)) throw err_('รหัสตัวชี้วัดซ้ำ');
    } else {
      const oldMax = isNew ? null : row.max, oldComp = isNew ? [] : row.components;
      ['name', 'type', 'categoryId', 'rooms', 'assignmentId'].forEach(k => { if (d[k] !== undefined) row[k] = str_(d[k], 200); });
      if (d.description !== undefined) row.description = str_(d.description, 2000);
      ['assignedAt', 'dueAt'].forEach(k => { if (d[k] !== undefined) row[k] = dt_(str_(d[k], 19)); });
      if (d.mode !== undefined) row.mode = d.mode === 'group' ? 'group' : 'individual';
      if (d.counted !== undefined) row.counted = d.counted === false || d.counted === 'false' ? 'false' : 'true';
      if (d.visible !== undefined) row.visible = d.visible === false || d.visible === 'false' ? 'false' : 'true';
      if (d.status !== undefined && ['open', 'closed'].indexOf(d.status) >= 0) row.status = d.status;
      if (d.maxScore !== undefined) { const m = Number(d.maxScore); if (!(m > 0) || !num2_(d.maxScore)) throw err_('คะแนนเต็มของรายการต้องมากกว่า 0 (ทศนิยมไม่เกิน 2 ตำแหน่ง)'); row.max = m; row.maxScore = String(m); }
      if (d.components !== undefined) row.components = (Array.isArray(d.components) ? d.components : []).map(c => ({ indicatorId: str_(c.indicatorId, 20), max: Number(c.max) || 0 })).filter(c => c.indicatorId).slice(0, 20);
      row.components = row.components || [];
      if (row.components.some(c => !S.inds.some(i => i.id === c.indicatorId))) throw err_('ตัวชี้วัดที่เลือกไม่ถูกต้อง');
      row.componentsJson = JSON.stringify(row.components);
      if (isNew) { row.mode = row.mode || 'individual'; row.counted = row.counted || 'true'; row.visible = row.visible || 'true'; row.type = row.type || 'งาน'; }
      if (!row.name) throw err_('กรุณาตั้งชื่อรายการคะแนน');
      if (!(row.max > 0)) throw err_('กรุณากำหนดคะแนนเต็มของรายการ');
      if (row.categoryId && !S.cats.some(c => c.id === row.categoryId)) throw err_('หมวดคะแนนไม่ถูกต้อง');
      if (row.assignmentId && isNew && S.items.some(i => i !== row && i.assignmentId === row.assignmentId && i.status !== 'archived')) throw err_('งานนี้ถูกดึงเข้าสมุดแล้ว');
      if (!isNew) { // ลดคะแนนเต็มต่ำกว่าคะแนนที่บันทึกไว้แล้ว → หยุดและให้ครูเลือก
        const over = Object.keys(S.scores).filter(k => k.split('|')[0] === row.id).map(k => S.scores[k]).filter(r => r.score !== '' && Number(r.score) > row.max + 1e-9);
        const compOver = Object.keys(S.scores).filter(k => k.split('|')[0] === row.id).map(k => S.scores[k]).filter(r => { const c = json_(r.comp, {});
          return row.components.some(cp => c[cp.indicatorId] !== undefined && Number(c[cp.indicatorId]) > cp.max + 1e-9); });
        if (over.length || compOver.length) {
          if (opts.onConflict === 'scale' && oldMax > 0) out.scale = { itemId: row.id, factor: row.max / oldMax, oldComp: oldComp };
          else out.conflicts = over.concat(compOver.filter(x => over.indexOf(x) < 0)).map(r => ({ studentId: r.studentId, name: nameOf_(r.studentId), score: r.score, max: row.max }));
        }
      }
    }
    out.rows.push(row); out.desc = (isNew ? 'เพิ่ม' : 'แก้ไข') + ' ' + (row.name || row.code);
    return out;
  }
  if (!row) throw err_('ไม่พบข้อมูล');
  if (op === 'archive' || op === 'restore') { row.status = op === 'archive' ? 'archived' : (ent === 'item' ? 'open' : 'active'); out.desc = (op === 'archive' ? 'เก็บถาวร ' : 'นำกลับมาใช้ ') + (row.name || row.code); }
  else if (op === 'stopCount' || op === 'startCount') { if (ent !== 'item') throw err_('ใช้ได้กับรายการคะแนนเท่านั้น'); row.counted = op === 'stopCount' ? 'false' : 'true'; out.desc = (op === 'stopCount' ? 'หยุดนับคะแนน ' : 'กลับมานับคะแนน ') + row.name; }
  else if (op === 'delete') {
    if (ent === 'item' && (hasScores(row.id) || Object.keys(S.scores).some(k => k.split('|')[0] === row.id))) throw err_('รายการนี้มีข้อมูลคะแนน/สถานะแล้ว ลบไม่ได้ — ใช้ "เก็บถาวร" แทน');
    if (ent === 'category' && S.items.some(i => i.categoryId === row.id)) throw err_('ยังมีรายการคะแนนอยู่ในหมวดนี้ — ย้ายรายการหรือใช้ "เก็บถาวร"');
    if (ent === 'indicator' && S.items.some(i => i.components.some(c => c.indicatorId === row.id))) throw err_('ตัวชี้วัดนี้ถูกใช้ในรายการคะแนนแล้ว — ใช้ "เก็บถาวร" แทน');
    list.splice(list.indexOf(row), 1); out.deleted = row; out.desc = 'ลบ ' + (row.name || row.code); return out;
  } else throw err_('คำสั่งไม่ถูกต้อง');
  row.updatedAt = now_(); out.rows.push(row);
  return out;
}
function cloneS_(S) {
  const sc = {}; Object.keys(S.scores).forEach(k => sc[k] = Object.assign({}, S.scores[k]));
  return { gb: Object.assign({}, S.gb, { criteria: JSON.parse(JSON.stringify(S.gb.criteria)), visibility: Object.assign({}, S.gb.visibility) }),
    cats: S.cats.map(x => Object.assign({}, x)), inds: S.inds.map(x => Object.assign({}, x)), items: S.items.map(x => Object.assign({}, x, { components: x.components.slice() })),
    enroll: S.enroll, students: S.students, scores: sc, groups: S.groups };
}
function scaleScores_(S, sc) {
  const changed = [];
  Object.keys(S.scores).filter(k => k.split('|')[0] === sc.itemId).forEach(k => {
    const r = S.scores[k], before = { score: r.score, comp: r.comp };
    if (r.score !== '') r.score = String(round_(Number(r.score) * sc.factor, 2));
    const c = json_(r.comp, {}); Object.keys(c).forEach(i => c[i] = round_(c[i] * sc.factor, 2)); if (r.comp) r.comp = JSON.stringify(c);
    changed.push({ row: r, before: before });
  });
  return changed;
}
function impact_(S0, S1) {
  const a = gbCalc_(S0), b = gbCalc_(S1), rows = [];
  S1.students.forEach(s => { const x = a.results[s.id], y = b.results[s.id];
    if (!x || !y || Math.abs(x.total - y.total) > 1e-6 || x.grade !== y.grade || x.complete !== y.complete)
      rows.push({ studentId: s.id, name: s.prefix + s.fullName, classNo: s.classNo, room: s.grade + '/' + s.room, before: { total: x ? x.totalR : null, grade: x ? x.grade : '', complete: x ? x.complete : null }, after: { total: y.totalR, grade: y.grade, complete: y.complete } }); });
  return { before: { valid: a.valid, errors: a.errors, summary: a.summary }, after: { valid: b.valid, errors: b.errors, warnings: b.warnings, summary: b.summary, sumMax: b.sumMax, sumWeight: b.sumWeight }, changes: rows };
}
/** พรีวิวผลกระทบ (ไม่บันทึก) — ใช้เครื่องคำนวณเดียวกับของจริง */
function gbPreview_(ctx, gbId, ch, opts) {
  const g = gbOk_(ctx.user, gbRow_(gbId)), S0 = gbLoad_(g.id), S1 = cloneS_(S0);
  const res = applyChange_(S1, ch || {}, opts || {});
  if (res.scale) scaleScores_(S1, res.scale);
  return Object.assign(impact_(S0, S1), { conflicts: res.conflicts, desc: res.desc, hasScores: Object.keys(S0.scores).some(k => S0.scores[k].score !== '' || S0.scores[k].submit),
    published: !!g.pubKind, ver: g.ver });
}
function snapshot_(S) { return JSON.stringify({ settings: { name: S.gb.name, totalScore: S.gb.totalScore, mode: S.gb.mode, criteria: S.gb.criteria, exemptPolicy: S.gb.exemptPolicy, visibility: S.gb.visibility },
  cats: S.cats.map(pub_), inds: S.inds.map(pub_), items: S.items.map(i => { const o = pub_(i); delete o.max; delete o.componentsJson; o.components = i.components; return o; }) }); }
/** บันทึกการเปลี่ยนโครงสร้าง: ต้องส่ง ver ล่าสุด (กันเขียนทับ) · ถ้ามีคะแนนแล้วต้อง confirm · เก็บเวอร์ชันโครงสร้างทุกครั้ง */
function gbApply_(ctx, gbId, ch, opts) {
  opts = opts || {};
  const g0 = gbOk_(ctx.user, gbRow_(gbId));
  const out = lock_(() => {
    delete MEM_.Gradebooks;
    const g = gbRow_(g0.id);
    if (opts.ver !== undefined && String(opts.ver) !== String(g.ver)) throw err_('มีการแก้ไขโครงสร้างจากที่อื่นก่อนหน้านี้ กรุณาโหลดข้อมูลใหม่แล้วลองอีกครั้ง', 'CONFLICT');
    const S = gbLoad_(g.id), S0 = cloneS_(S), res = applyChange_(S, ch || {}, opts);
    if (res.conflicts.length) return { ok: false, conflicts: res.conflicts, message: 'มีนักเรียนได้คะแนนมากกว่าคะแนนเต็มใหม่ — เลือก "ปรับคะแนนตามสัดส่วน" หรือยกเลิก' };
    const scaled = res.scale ? scaleScores_(S, res.scale) : [];
    const has = Object.keys(S0.scores).some(k => S0.scores[k].score !== '' || S0.scores[k].submit);
    const imp = impact_(S0, S);
    if (has && !opts.confirm && (imp.changes.length || ch.kind === 'settings' || ch.op !== 'save' || scaled.length)) return { ok: false, needConfirm: true, preview: imp };
    const reason = str_(opts.reason, 300);
    // เขียนลงชีต
    const ent = GB_ENT[ch.kind], aud = [];
    if (ch.kind === 'settings') {
      const before = find_('Gradebooks', g.id);
      ['name', 'totalScore', 'mode', 'exemptPolicy', 'grade', 'rooms'].forEach(k => { if (String(before[k]) !== String(S.gb[k])) aud.push({ gbId: g.id, entity: 'settings', entityId: g.id, field: k, oldValue: before[k], newValue: S.gb[k], reason: reason }); });
      ['criteria', 'visibility'].forEach(k => { const nv = JSON.stringify(S.gb[k]); if (before[k] !== nv) aud.push({ gbId: g.id, entity: 'settings', entityId: g.id, field: k, oldValue: before[k], newValue: nv, reason: reason }); });
      updateRow_('Gradebooks', before, { name: S.gb.name, totalScore: S.gb.totalScore, mode: S.gb.mode, exemptPolicy: S.gb.exemptPolicy, grade: S.gb.grade, rooms: S.gb.rooms,
        criteria: JSON.stringify(S.gb.criteria), visibility: JSON.stringify(S.gb.visibility) });
    } else {
      const sheetRows = {}; rows_(ent).filter(r => r.gbId === g.id).forEach(r => sheetRows[r.id] = r);
      if (res.deleted) { deleteWhere_(ent, r => r.id === res.deleted.id); aud.push({ gbId: g.id, entity: ch.kind, entityId: res.deleted.id, field: 'delete', oldValue: res.deleted.name || res.deleted.code, reason: reason }); }
      const ups = [], ins = [];
      res.rows.forEach(r => {
        const w = Object.assign({}, r); if (ch.kind === 'item') { w.components = r.componentsJson || JSON.stringify(r.components || []); w.maxScore = String(r.max); }
        const cur = sheetRows[r.id];
        if (cur) { const h = headers_(ent); h.forEach(k => { if (k !== 'id' && w[k] !== undefined && String(cur[k]) !== String(w[k])) { if (k !== 'updatedAt' && k !== 'order') aud.push({ gbId: g.id, entity: ch.kind, entityId: r.id, field: k, oldValue: cur[k], newValue: w[k], reason: reason }); cur[k] = String(w[k]); } }); ups.push(cur); }
        else { ins.push(w); aud.push({ gbId: g.id, entity: ch.kind, entityId: r.id, field: 'create', newValue: r.name || r.code, reason: reason }); }
      });
      updateMany_(ent, ups); insertMany_(ent, ins);
    }
    if (scaled.length) {
      const live = {}; rows_('GbScores').filter(s => s.gbId === g.id).forEach(s => live[s.id] = s);
      const ups = scaled.map(x => { const r = live[x.row.id]; aud.push({ gbId: g.id, entity: 'score', entityId: r.itemId + '|' + r.studentId, field: 'score', oldValue: x.before.score, newValue: x.row.score, reason: 'ปรับตามสัดส่วนคะแนนเต็มใหม่ ' + (reason || '') });
        r.score = x.row.score; r.comp = x.row.comp; r.ver = String((Number(r.ver) || 0) + 1); r.updatedBy = ctx.user.id; r.updatedAt = now_(); return r; });
      updateMany_('GbScores', ups);
    }
    delete MEM_.Gradebooks;
    const gr = find_('Gradebooks', g.id), sv = (Number(gr.structVersion) || 1) + (aud.length ? 1 : 0);
    updateRow_('Gradebooks', gr, { ver: String((Number(gr.ver) || 1) + 1), structVersion: String(sv), updatedAt: now_(), needsRepublish: gr.pubKind && aud.length ? 'true' : gr.needsRepublish,
      status: gr.status === 'active' && !imp.after.valid ? 'draft' : gr.status });
    if (aud.length) {
      gbAuditAdd_(aud, ctx.user, 'st_' + id_());
      insert_('GbVersions', { id: id_(), gbId: g.id, kind: 'structure', version: String(sv), snapshot: snapshot_(S), reason: (res.desc + (reason ? ' — ' + reason : '')).slice(0, 300), by: ctx.user.id, at: now_() });
    }
    return { ok: true, created: res.created ? res.created.id : '', desc: res.desc, deactivated: g.status === 'active' && !imp.after.valid };
  });
  if (out.ok && out.created && ch.kind === 'item' && (ch.data || {}).assignmentId) lock_(() => syncItem_(ctx.user, gbRow_(gbId), find_('GbItems', out.created)));
  if (!out.ok) return out;
  return Object.assign(gbGet_(ctx, gbId), { applied: out });
}
function gbActivate_(ctx, gbId, on) {
  const g = gbOk_(ctx.user, gbRow_(gbId));
  return lock_(() => {
    const c = gbCalc_(gbLoad_(g.id));
    if (on && !c.valid) throw err_('ยังเปิดใช้งานไม่ได้:\n' + c.errors.join('\n'));
    updateRow_('Gradebooks', find_('Gradebooks', g.id), { status: on ? 'active' : 'draft', ver: String((Number(g.ver) || 1) + 1), updatedAt: now_() });
    gbAuditAdd_([{ gbId: g.id, entity: 'gradebook', entityId: g.id, field: 'status', oldValue: g.status, newValue: on ? 'active' : 'draft' }], ctx.user, '');
    return gbGet_(ctx, gbId);
  });
}
/** คัดลอกโครงสร้างไปยังรายวิชา/ภาคเรียนอื่น — ไม่คัดลอกคะแนนและรายชื่อนักเรียนเด็ดขาด */
function gbCopy_(ctx, fromId, d) {
  d = d || {};
  const src = gbOk_(ctx.user, gbRow_(fromId)), S = gbLoad_(src.id);
  const ng = lock_(() => {
    const g = newGb_(ctx.user, { courseId: d.courseId || src.courseId, acadYear: d.acadYear, term: d.term, totalScore: src.totalScore, mode: src.mode,
      criteria: S.gb.criteria, visibility: S.gb.visibility, exemptPolicy: src.exemptPolicy, grade: d.grade, rooms: d.rooms });
    const cmap = {}, imap = {};
    insertMany_('GbCategories', S.cats.filter(c => c.status !== 'archived').map(c => { cmap[c.id] = id_(); return { id: cmap[c.id], gbId: g.id, name: c.name, weight: c.weight, order: c.order, status: 'active', createdAt: now_(), updatedAt: now_() }; }));
    insertMany_('GbIndicators', S.inds.filter(c => c.status !== 'archived').map(c => { imap[c.id] = id_(); return { id: imap[c.id], gbId: g.id, code: c.code, name: c.name, description: c.description, passType: c.passType, passValue: c.passValue, order: c.order, status: 'active', createdAt: now_(), updatedAt: now_() }; }));
    if (d.withItems) insertMany_('GbItems', S.items.filter(i => i.status !== 'archived').map(i => ({ id: id_(), gbId: g.id, name: i.name, type: i.type, categoryId: cmap[i.categoryId] || '', description: i.description,
      maxScore: i.maxScore, components: JSON.stringify(i.components.filter(c => imap[c.indicatorId]).map(c => ({ indicatorId: imap[c.indicatorId], max: c.max }))), assignedAt: '', dueAt: '', rooms: '', mode: i.mode,
      counted: i.counted, status: 'open', assignmentId: '', visible: i.visible, order: i.order, createdAt: now_(), updatedAt: now_() })));
    gbAuditAdd_([{ gbId: g.id, entity: 'gradebook', entityId: g.id, field: 'copy', oldValue: src.id, newValue: d.withItems ? 'โครงสร้าง + รายการ' : 'โครงสร้างอย่างเดียว' }], ctx.user, '');
    return g;
  });
  return gbGet_(ctx, ng.id);
}
/* ---------- เผยแพร่ผล (สำเนาต่อคน — นักเรียนเห็นเฉพาะของตน) ---------- */
function studentView_(S, calc, st, kind, version) {
  const v = S.gb.visibility, R = calc.results[st.id], c = find_('Courses', S.gb.courseId) || {}, cats = {};
  S.cats.forEach(x => cats[x.id] = x.name);
  const o = { course: { code: c.code, name: c.name, teacher: c.teacher || nameOf_(c.ownerId) }, name: S.gb.name, acadYear: S.gb.acadYear, term: S.gb.term, kind: kind, version: version,
    publishedAt: now_(), complete: R.complete, missing: R.missing };
  if (v.items) o.items = S.items.filter(i => i.status !== 'archived' && i.visible !== 'false').map(i => { const r = S.scores[i.id + '|' + st.id] || {};
    return { name: i.name, type: i.type, category: cats[i.categoryId] || '', max: i.max, score: r.score === undefined ? '' : r.score, submit: r.submit || '', check: r.check || '', counted: i.counted !== 'false',
      note: v.notes ? (r.note || '') : '' }; });
  if (v.categories) o.cats = S.cats.filter(x => x.status !== 'archived').map(x => { const C = R.cats[x.id] || {}; return { name: x.name, weight: S.gb.mode === 'weighted' ? Number(x.weight) : null, earned: r6_(C.earned || 0), max: r6_(C.max || 0),
    score: C.score === null || C.score === undefined ? null : round_(C.score, 2) }; });
  if (v.indicators) o.inds = S.inds.filter(x => x.status !== 'archived').map(x => { const I = R.inds[x.id] || {}; return { code: x.code, name: x.name, earned: r6_(I.earned || 0), max: r6_(I.max || 0), pass: I.pass, complete: I.complete }; });
  if (v.total) { o.total = R.totalR; o.totalMax = Number(S.gb.totalScore); o.pct = R.pctR; }
  if (v.grade) { o.grade = R.grade; o.pass = R.pass; }
  return o;
}
function gbPublish_(ctx, gbId, kind, reason) {
  kind = kind === 'final' ? 'final' : 'preliminary';
  const g = gbOk_(ctx.user, gbRow_(gbId));
  return lock_(() => {
    const S = gbLoad_(g.id), calc = gbCalc_(S);
    if (!calc.valid) throw err_('ยังเผยแพร่ไม่ได้ — โครงสร้างคะแนนยังไม่ถูกต้อง:\n' + calc.errors.join('\n'));
    if (kind === 'final' && g.status !== 'active') throw err_('ต้องยืนยันเปิดใช้งานโครงสร้างก่อนเผยแพร่ผลฉบับสมบูรณ์');
    const ver = (Number(g.pubVersion) || 0) + 1;
    delete MEM_.GbResults;
    const cur = {}; rows_('GbResults').filter(r => r.gbId === g.id).forEach(r => cur[r.studentId] = r);
    const ups = [], ins = [], live = {};
    S.students.forEach(st => {
      live[st.id] = 1;
      const data = JSON.stringify(studentView_(S, calc, st, kind, ver));
      if (cur[st.id]) { Object.assign(cur[st.id], { kind: kind, version: String(ver), data: data, publishedAt: now_() }); ups.push(cur[st.id]); }
      else ins.push({ id: id_(), gbId: g.id, studentId: st.id, kind: kind, version: String(ver), data: data, publishedAt: now_() });
    });
    updateMany_('GbResults', ups); insertMany_('GbResults', ins);
    deleteWhere_('GbResults', r => r.gbId === g.id && !live[r.studentId]); // นักเรียนที่ย้ายออก
    updateRow_('Gradebooks', find_('Gradebooks', g.id), { pubKind: kind, pubVersion: String(ver), publishedAt: now_(), needsRepublish: 'false', updatedAt: now_() });
    insert_('GbVersions', { id: id_(), gbId: g.id, kind: 'publish', version: String(ver), snapshot: JSON.stringify({ kind: kind, summary: calc.summary, structVersion: g.structVersion }), reason: str_(reason, 300), by: ctx.user.id, at: now_() });
    gbAuditAdd_([{ gbId: g.id, entity: 'publish', entityId: g.id, field: kind, oldValue: g.pubVersion, newValue: String(ver), reason: str_(reason, 300) }], ctx.user, '');
    S.students.length && notifyUsers_(S.students.map(s => s.id), (ver > 1 ? 'ผลการเรียนฉบับปรับปรุง: ' : 'ประกาศผลการเรียน: ') + S.gb.name, kind === 'final' ? 'ผลฉบับสมบูรณ์' : 'ผลเบื้องต้น', 'results:' + g.id);
    return gbGet_(ctx, gbId);
  });
}
function gbUnpublish_(ctx, gbId, reason) {
  const g = gbOk_(ctx.user, gbRow_(gbId));
  return lock_(() => {
    deleteWhere_('GbResults', r => r.gbId === g.id);
    updateRow_('Gradebooks', find_('Gradebooks', g.id), { pubKind: '', needsRepublish: 'false', updatedAt: now_() });
    gbAuditAdd_([{ gbId: g.id, entity: 'publish', entityId: g.id, field: 'unpublish', oldValue: g.pubKind, reason: str_(reason, 300) }], ctx.user, '');
    return gbGet_(ctx, gbId);
  });
}
/** นักเรียน: ผลการเรียนที่เผยแพร่แล้วของตนเองเท่านั้น (ไม่มีข้อมูลเพื่อน) */
function myResults_(ctx) {
  const u = ctx.user;
  if (u.role !== 'student') return [];
  const en = {}; rows_('GbEnroll').filter(e => e.studentId === u.id && e.status !== 'dropped').forEach(e => en[e.gbId] = 1);
  return rows_('GbResults').filter(r => r.studentId === u.id && en[r.gbId]).map(r => Object.assign({ gbId: r.gbId }, json_(r.data, {}), { kind: r.kind, version: Number(r.version), publishedAt: r.publishedAt }))
    .sort((a, b) => String(b.acadYear + b.term).localeCompare(String(a.acadYear + a.term)));
}
function gbAudit_(ctx, gbId, f) {
  f = f || {};
  const g = gbOk_(ctx.user, gbRow_(gbId)), items = {}, users = {};
  rows_('GbItems').filter(i => i.gbId === g.id).forEach(i => items[i.id] = i.name);
  rows_('Users').forEach(u => users[u.id] = u.prefix + u.fullName);
  const list = rows_('GbAudit').filter(a => a.gbId === g.id).slice().reverse().map(a => {
    const p = a.entityId.split('|');
    return { at: a.at, by: users[a.by] || a.by, entity: a.entity, target: a.entity === 'score' ? (items[p[0]] || '') + ' · ' + (users[p[1]] || '') : (items[a.entityId] || a.entityId),
      field: a.field, oldValue: a.oldValue, newValue: a.newValue, reason: a.reason, batchId: a.batchId };
  }).filter(a => !f.q || JSON.stringify(a).indexOf(f.q) >= 0);
  const page = Math.max(1, Number(f.page) || 1), size = 100;
  return { total: list.length, page: page, pages: Math.max(1, Math.ceil(list.length / size)), rows: list.slice((page - 1) * size, page * size) };
}
function gbVersions_(ctx, gbId) {
  const g = gbOk_(ctx.user, gbRow_(gbId));
  return rows_('GbVersions').filter(v => v.gbId === g.id).map(v => Object.assign(pub_(v), { byName: nameOf_(v.by), snapshot: v.kind === 'publish' ? json_(v.snapshot, {}) : undefined }))
    .reverse();
}
function gbDelete_(ctx, gbId) {
  const g = gbOk_(ctx.user, gbRow_(gbId));
  return lock_(() => {
    if (rows_('GbScores').some(s => s.gbId === g.id && (s.score !== '' || s.submit))) throw err_('สมุดนี้มีคะแนนแล้ว ลบไม่ได้ (ป้องกันคะแนนสูญหาย)');
    ['GbCategories', 'GbIndicators', 'GbItems', 'GbScores', 'GbGroups', 'GbEnroll', 'GbResults'].forEach(n => deleteWhere_(n, r => r.gbId === g.id));
    deleteWhere_('Gradebooks', r => r.id === g.id);
    log_(ctx.user.id, 'delete_gradebook', g.name + ' ' + g.term + '/' + g.acadYear);
    return true;
  });
}

/* ============================== Admin: ตั้งค่า / สำรองข้อมูล ============================== */
/** เมนูฝั่งนักเรียน: ซ่อนเมนูมาตรฐาน + เมนูลิงก์ที่ครูเพิ่มเอง */
function menus_(v) {
  const o = typeof v === 'string' ? json_(v, {}) : (v || {});
  const KEYS = ['home', 'courses', 'assignments', 'results', 'announcements', 'search', 'profile'];
  return JSON.stringify({
    hidden: (Array.isArray(o.hidden) ? o.hidden : []).filter(k => KEYS.indexOf(k) >= 0 && k !== 'home' && k !== 'profile'),
    custom: (Array.isArray(o.custom) ? o.custom : []).slice(0, 12).map(m => ({ id: str_(m.id, 20).replace(/[^\w]/g, '') || id_(), name: str_(m.name, 40), url: str_(m.url, 500), icon: str_(m.icon, 60).replace(/[^a-z0-9- ]/g, '') || 'auto', mode: m.mode === 'tab' ? 'tab' : 'app' }))
      .filter(m => m.name && /^https:\/\//.test(m.url)),
    order: (Array.isArray(o.order) ? o.order : []).map(k => str_(k, 30)).filter(k => /^(c:\w+|[a-z]+)$/.test(k)).slice(0, 40)
  });
}
/** ครูผู้สอนเพิ่มประเภทงานได้ (ลบได้เฉพาะผู้ดูแลระบบ ผ่านหน้าตั้งค่า) */
function addAssignmentType_(ctx, name) {
  const v = cleanSeg_(str_(name, 40));
  if (!v || /[,/\\]/.test(v)) throw err_('ชื่อประเภทงานไม่ถูกต้อง');
  return lock_(() => { delete MEM_.Config; const list = cfg_().assignmentTypes.split(',').filter(Boolean); if (list.indexOf(v) < 0) list.push(v); setCfg_('assignmentTypes', list.slice(0, 30).join(',')); return cfg_().assignmentTypes; });
}
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
        let v = typeof d.config[k] === 'boolean' ? String(d.config[k]) : str_(d.config[k], k === 'logo' ? 48000 : k === 'studentMenus' ? 6000 : 500);
        if (k === 'logo' && v && !(imgOk_(v) || /^data:image\/svg\+xml;base64,/.test(v))) throw err_('โลโก้ไม่ถูกต้อง');
        if (k === 'themeColor' && !/^#[0-9a-f]{6}$/i.test(v)) throw err_('รหัสสีไม่ถูกต้อง');
        if (k === 'studentMenus') v = menus_(d.config[k]);
        if (k === 'assignmentTypes') v = v.split(',').map(cleanSeg_).filter((x, i, a) => x && a.indexOf(x) === i).slice(0, 30).join(',') || CONFIG_DEFAULTS.assignmentTypes;
        const old = cfg_()[k];
        setCfg_(k, v);
        if (k === 'logo' && old !== v) purge_([driveIdOf_(old)]);
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
      delete MEM_[n]; delete MEM_['_h_' + n]; bump_(n);
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
    broadcast_(studentsFor_(a.grade, a.room, a.courseId).filter(s => sent.indexOf(s.id) < 0), 'ใกล้ครบกำหนดส่ง: ' + a.title, 'กำหนดส่ง ' + a.dueAt.replace('T', ' ').slice(0, 16), 'assignment:' + a.id);
    props_().setProperty(key, '1');
  });
  deleteWhere_('Sessions', s => Number(s.expiresAt) < Date.now());
  if (cfg_().autoBackup === 'true') backup_();
}
