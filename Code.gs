/**
 * Classroom + — Google Apps Script backend (ไฟล์เดียว)
 * ฐานข้อมูล: Google Sheets | ไฟล์: Google Drive | หน้าเว็บ: Index.html (HTML Service)
 * Admin เปลี่ยน Sheet ID / Drive ID ได้จากหน้า "ตั้งค่าระบบ" (เก็บใน Script Properties)
 */
const APP_VERSION = '6.2.0';
const TZ = 'Asia/Bangkok';
const DEFAULTS = {
  SHEET_ID: '14mpQC_8KSKd-V8Wn_sj2gdreJfB_q9haOnarBbqQ4r8',
  DRIVE_ID: '1GqxqZyDJPb7C27kBjyeyimD9VKqiKJ2Y'
};
const MAX_UPLOAD_MB = 2048;            // ไฟล์ใหญ่สุด 2 GB (อัปโหลดเป็นชิ้น ๆ ผ่าน Drive resumable upload)
const CHUNK_BYTES = 16 * 1024 * 1024;  // ขนาดชิ้นละ 16 MB (ต้องเป็นทวีคูณของ 256 KB) — กรณีส่งผ่าน server
const GRADES = ['ม.1', 'ม.2', 'ม.3', 'ม.4', 'ม.5', 'ม.6'];
const ALLOWED_EXT = ['pdf','doc','docx','ppt','pptx','xls','xlsx','csv','txt','jpg','jpeg','png','gif','webp',
  'zip','rar','7z','mp4','mov','webm','mp3','m4a'];
const CONFIG_DEFAULTS = {
  schoolName: 'Classroom +', logo: '', welcome: 'ยินดีต้อนรับ สู่ห้องเรียนออนไลน์แห่งอนาคต',
  allowAdminSignup: 'true', requireApproval: 'false', sessionHours: '8', rememberDays: '30',
  emailNotify: 'false', lineToken: '', demoEnabled: 'true', autoBackup: 'true', webNotify: 'true', siteUrl: '',
  assignmentTypes: 'การบ้าน,ใบงาน,แบบฝึกหัด,สรุปเนื้อหา,งานเดี่ยว,งานกลุ่ม',
  themeColor: '#2563eb',   // สีหลักของระบบ
  studentMenus: '',        // JSON {hidden:[...], custom:[{name,url,icon}]} เมนูฝั่งนักเรียน
  scoreSources: '[]'       // JSON [{id,name,url,terms:[ปี/ภาค],courseIds,grades,rooms}] ที่มาของ "รวมคะแนนทั้งหมด"
};
const PRIVATE_CONFIG = ['lineToken', 'scoreSources'];
const SCHEMA = {
  Config: ['key','value','updatedAt'],
  Users: ['id','role','username','studentCode','passSalt','passHash','prefix','fullName','birthDate','grade','room',
    'email','avatar','status','mustChangePassword','createdAt','updatedAt','lastLoginAt','classNo','acadYear','nickname','contacts','coAdmin','prefs','tenant','demo'],
  Sessions: ['id','userId','tokenHash','expiresAt','createdAt','tenant','term'],
  Classes: ['id','grade','room','order','createdAt'],
  Categories: ['id','name','createdAt','code'],
  Courses: ['id','code','name','description','category','grade','room','cover','teacher','order','ownerId','createdAt','updatedAt','teachers','acadYear','term'],
  Lessons: ['id','courseId','unit','title','description','cover','videoUrl','videoDuration','attachments','links',
    'duration','order','publishAt','closeAt','ownerId','createdAt','updatedAt'],
  Progress: ['id','ownerId','lessonId','courseId','completed','videoPos','videoDone','views','updatedAt'],
  Assignments: ['id','courseId','type','title','description','attachments','dueAt','maxScore','ownerId','createdAt','updatedAt','grade','room','group','quiz','groupMax'],
  Submissions: ['id','assignmentId','ownerId','text','files','driveLink','status','submittedAt','score','feedback',
    'gradedBy','gradedAt','history','updatedAt','members','answers','autoScore'],
  Announcements: ['id','type','title','body','attachments','image','pinned','courseId','grade','room','ownerId','createdAt','updatedAt'],
  Notifications: ['id','ownerId','title','body','link','read','createdAt'],
  AuditLog: ['id','userId','action','detail','createdAt'],
  // ---------- แชท ----------
  ChatRooms: ['id','type','name','members','grade','room','createdBy','createdAt','lastAt','lastText','lastBy'],
  ChatMessages: ['id','roomId','senderId','text','createdAt','files','editedAt','deleted'],
  ChatReads: ['id','userId','roomId','at','hidden','alias'],
  // ---------- v5: ค่าตั้งค่าระดับภาคเรียน + กิจกรรมตอบปัญหา/แบบสอบถาม ----------
  TermConfig: ['key','value','updatedAt'],
  LiveSessions: ['id','kind','title','pin','ownerId','data','settings','status','startedAt','endsAt','createdAt','updatedAt'],
  ToolLogs: ['id','ownerId','tool','term','data','createdAt'],
  QrCodes: ['id','ownerId','text','note','status','useDate','style','imgId','fileJson','createdAt','updatedAt'],
  ExamPapers: ['id','ownerId','title','data','createdAt','updatedAt','folderId'],
  ExamFolders: ['id','ownerId','name','createdAt','kind'],
  Exams: ['id','ownerId','name','folderId','cfg','key','classes','tags','createdAt','updatedAt'],
  ExamResults: ['id','examId','ownerId','studentId','code','set','answers','score','max','img','meta','history','createdAt','updatedAt'],
  LiveAnswers: ['id','sessionId','pid','name','userId','answers','score','correct','timeMs','finishedAt','createdAt','updatedAt'],
  // ---------- v5.4: ตารางสอน + เช็คชื่อ (แยกตามภาคเรียน) ----------
  Timetables: ['id','ownerId','cfg','updatedAt'],
  TtSlots: ['id','ownerId','day','period','span','courseId','grade','room','students','note','createdAt','updatedAt','extras'],
  Attendance: ['id','slotId','date','ownerId','courseId','records','checkedBy','checkedAt','createdAt','updatedAt']
};
// ตารางที่ Admin แก้ไขผ่าน save()/remove() ได้ และฟิลด์ที่อนุญาต
const EDITABLE = {
  Classes: ['grade','room','order'],
  Categories: ['code','name'],
  Courses: ['code','name','description','category','grade','room','cover','teacher','order','ownerId','teachers','acadYear','term'],
  Lessons: ['courseId','unit','title','description','cover','videoUrl','videoDuration','attachments','links','duration','order','publishAt','closeAt','ownerId'],
  Assignments: ['courseId','type','title','description','attachments','dueAt','maxScore','ownerId','grade','room','group','quiz','groupMax'],
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
  const out = rpc(String(req.fn || ''), req.token || null, Array.isArray(req.args) ? req.args : [], String(req.vt || ''));
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** จุดเข้าเดียวจากหน้าเว็บ: google.script.run.rpc(fn, token, args) */
function rpc(fn, token, args, vt) {
  try {
    useTenant_(''); useTerm_(''); // ยืนยันตัวตนกับภาคเรียนปัจจุบันเสมอ แล้วจึงสลับไปภาคเรียนที่กำลังดู
    const route = ROUTES[fn];
    if (!route) throw err_('ไม่พบคำสั่ง ' + fn);
    const ctx = { token: token, user: null };
    if (route[0] !== 'public') {
      ctx.user = auth_(token);
      if (!ctx.user) throw err_('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'AUTH');
      routeOk_(route, ctx.user);
      if (isDemo_(ctx.user) && !DEMO_OK[fn]) { if (DEMO_SOFT[fn]) return { ok: true, data: null }; throw err_(DEMO_MSG, 'DEMO'); }
    }
    if (ctx.user && tenant_().unset && !SETUP_OK[fn]) throw err_('กรุณาตั้งค่าฐานข้อมูล (Google Sheet และ Google Drive) ของคุณก่อนใช้งาน — ไปที่ ตั้งค่าระบบ → ฐานข้อมูล', 'TENANT_SETUP');
    if (vt && ctx.user && staff_(ctx.user)) useTerm_(String(vt)); // นักเรียนใช้ภาคเรียนของบัญชีตนเองเสมอ
    let data = route[1].apply(null, [ctx].concat(args || []));
    if (isDemo_(ctx.user)) data = demoMask_(fn, data);
    return JSON.parse(JSON.stringify({ ok: true, data: data === undefined ? null : data }));
  } catch (e) {
    if (!e.code) console.error(fn, e && e.stack);
    return { ok: false, error: e.message || String(e), code: e.code || 'ERR' };
  }
}

/* ---------- v5.7 บัญชีทดลองใช้งาน (ดูข้อมูลได้อย่างเดียว) ---------- */
const DEMO_USER = 'test', DEMO_PASS = '12345', DEMO_CODE = '12345', DEMO_MSG = 'บัญชีทดลองใช้งาน ดูข้อมูลได้อย่างเดียว — ไม่สามารถเพิ่ม/แก้ไข/ลบ หรือตั้งค่าได้';
const demoIds_ = () => MEM_._demo || (MEM_._demo = String(props_().getProperty('DEMO_IDS') || '').split(',').filter(String));
const isDemo_ = u => !!u && (u.demo === 'true' || demoIds_().indexOf(u.id) >= 0);
function markDemo_(u) { const l = demoIds_().concat([u.id]).slice(-50); props_().setProperty('DEMO_IDS', l.join(',')); MEM_._demo = l; if (MEM_.Users) MEM_.Users = MEM_.Users.filter(x => x.id !== u.id); return u; }
/** อ่านผู้ใช้จากไฟล์จริงโดยไม่กรองบัญชีทดลอง (ใช้ยืนยันตัวตนบัญชีทดลองเท่านั้น) */
function rawUser_(pred) { try { return prows_('Users', 'g').find(pred) || (tenant_().unset ? null : prows_('Users', split_() ? 't' : 'c').find(pred)) || null; } catch (e) { return null; } }
const DEMO_OK = {}; ('me logout studentHome listCourses getCourse getLesson listAssignments listAnnouncements search notifications groupCandidates batch myTeachers staffContact '
  + 'adminDashboard list listSubmissions report classSummary listUsers listTeachers chatContacts chatList chatMessages chatUnread chatTeamMembers getSettings auditLog listBackups '
  + 'liveList liveGet liveStatus termSources peekTerm fileData scoreTest scoreBooks scoreBook attExport ttGet attOpen attHistory attSummary attDecode myAttend myScores toolLogList qrList paperList examAll examGet examResults').split(' ').forEach(k => DEMO_OK[k] = 1);
const DEMO_SOFT = { markRead: 1, saveProgress: 1, discardUploads: 1, toolLogAdd: 1 }; // คำสั่งเบื้องหลังที่หน้าเว็บเรียกอัตโนมัติ → ข้ามเงียบ ๆ
function demoMask_(fn, data) {
  if (!data) return data;
  const hide = '•••• (ซ่อนในบัญชีทดลอง)';
  if (fn === 'getSettings') { data = Object.assign({}, data, { sheetId: hide, driveId: hide, sheetUrl: '', driveUrl: '', webAppUrl: '' });
    const c = Object.assign({}, data.config || {}); c.lineToken = ''; try { c.scoreSources = JSON.stringify(json_(c.scoreSources, []).map(x => Object.assign({}, x, { url: hide }))); } catch (e) {} data.config = c;
    data.termDbs = (data.termDbs || []).map(t => Object.assign({}, t, { sheetId: hide, driveId: hide })); }
  if (fn === 'scoreBook') data = Object.assign({}, data, { url: '' });
  return data;
}
const demoOn_ = () => { try { return cfg_().demoEnabled !== 'false'; } catch (e) { return true; } };
/** สร้างบัญชีทดลองเมื่อมีผู้เข้าสู่ระบบด้วยข้อมูลทดลองครั้งแรก (ไม่ทับบัญชีจริงที่มีอยู่แล้ว) */
function ensureDemoStaff_() {
  if (!demoOn_() || allStaff_().some(x => x.username === DEMO_USER)) return;
  const salt = id_();
  markDemo_(insert_('Users', { id: id_(), role: 'teacher', username: DEMO_USER, passSalt: salt, passHash: hashPw_(DEMO_PASS, salt), prefix: 'นาย', fullName: 'ทดลอง ใช้งาน',
    status: 'active', mustChangePassword: 'false', coAdmin: 'true', demo: 'true', createdAt: now_(), updatedAt: now_() }));
}
function ensureDemoStudent_() {
  if (!demoOn_()) return null;
  useTenant_(''); useTerm_('');
  const ex = rawUser_(x => x.role === 'student' && x.studentCode === DEMO_CODE && isDemo_(x)); if (ex) return ex;
  const cl = rows_('Classes').slice().sort((a, b) => a.order - b.order)[0] || { grade: 'ม.1', room: '1' };
  return markDemo_(insert_('Users', { id: id_(), role: 'student', studentCode: DEMO_CODE, prefix: 'เด็กชาย', fullName: 'นักเรียน ทดลองใช้งาน', grade: cl.grade, room: cl.room, classNo: '99',
    status: 'active', mustChangePassword: 'false', demo: 'true', createdAt: now_(), updatedAt: now_() }));
}
/** คำสั่งที่ใช้ได้ระหว่างที่ผู้ดูแลระบบคนใหม่ยังไม่ได้ตั้งฐานข้อมูลของตนเอง */
const SETUP_OK = { me: 1, logout: 1, getSettings: 1, saveSettings: 1, changeCredentials: 1, updateProfile: 1 };
const ROUTES = {
  // public
  bootstrap: ['public', bootstrap_], login: ['public', login_], registerStudent: ['public', registerStudent_],
  registerAdmin: ['public', registerAdmin_], checkStudentCode: ['public', checkStudentCode_],
  checkUsername: ['public', checkUsername_], forgotCode: ['public', forgotCode_], resetStaffPassword: ['public', resetStaffPassword_],
  // user (นักเรียน + Admin)
  me: ['user', me_], logout: ['user', logout_], updateProfile: ['user', updateProfile_],
  studentHome: ['user', studentHome_], listCourses: ['user', listCourses_], getCourse: ['user', getCourse_],
  getLesson: ['user', getLesson_], saveProgress: ['user', saveProgress_], listAssignments: ['user', listAssignments_],
  submitWork: ['user', submitWork_], deleteSubmission: ['user', deleteSubmission_],
  listAnnouncements: ['user', listAnnouncements_], search: ['user', search_], uploadFile: ['user', uploadFile_], uploadStart: ['user', uploadStart_], uploadChunk: ['user', uploadChunk_],
  discardUploads: ['user', discardUploads_], groupCandidates: ['user', groupCandidates_], batch: ['user', batch_],
  notifications: ['user', notifications_], markRead: ['user', markRead_],
  // staff = แอดมิน + ครูผู้สอน (ครูเห็นเฉพาะรายวิชาของตนเอง)
  adminDashboard: ['staff', adminDashboard_], list: ['staff', list_], save: ['staff', save_], remove: ['staff', remove_],
  changeCredentials: ['staff', changeCredentials_], listSubmissions: ['staff', listSubmissions_], gradeSubmission: ['staff', gradeSubmission_],
  report: ['staff', report_], classSummary: ['staff', classSummary_], addAssignmentType: ['staff', addAssignmentType_],
  myTeachers: ['user', myTeachers_], staffContact: ['user', staffContact_],
  listUsers: ['staff', listUsers_], saveUser: ['staff', saveUser_], importStudents: ['staff', importStudents_],
  listTeachers: ['staff', listTeachers_], saveStudentMenus: ['staff', saveStudentMenus_], uploadFinish: ['user', uploadFinish_],
  chatContacts: ['user', chatContacts_], chatList: ['user', chatList_], chatOpen: ['user', chatOpen_], chatMessages: ['user', chatMessages_],
  chatSend: ['user', chatSend_], chatEdit: ['user', chatEdit_], chatDelete: ['user', chatDelete_], chatHide: ['user', chatHide_], chatRename: ['user', chatRename_], chatTeamMembers: ['user', chatTeamMembers_], chatPurge: ['user', chatPurge_], chatCreateTeam: ['user', chatCreateTeam_], chatUnread: ['user', chatUnread_],
  // admin (ผู้ดูแลระบบคนเดียว)
  deleteUser: ['admin', deleteUser_], deleteUsers: ['admin', deleteUsers_], setCoAdmin: ['admin', setCoAdmin_],
  setRole: ['admin', setRole_], getSettings: ['admin', getSettings_], saveSettings: ['admin', saveSettings_],
  auditLog: ['admin', auditLog_], backupNow: ['admin', function () { return backup_(); }],
  listBackups: ['admin', listBackups_], liveList: ['staff', liveList_], liveGet: ['staff', liveGet_], liveSave: ['staff', liveSave_], liveRemove: ['staff', liveRemove_],
  liveControl: ['staff', liveControl_], liveStatus: ['staff', liveStatus_], liveInfo: ['public', liveInfo_], liveJoin: ['public', liveJoin_], liveSubmit: ['public', liveSubmit_], termSources: ['staff', termSources_], peekTerm: ['staff', peekTerm_], importTerm: ['staff', importTerm_], saveTermDb: ['admin', saveTermDb_], createTermDb: ['admin', createTermDb_], removeTermDb: ['admin', removeTermDb_],
  fileData: ['user', fileData_],
  scoreTest: ['staff', scoreTest_], scoreBooks: ['staff', scoreBooks_], scoreBook: ['staff', scoreBook_], attCopyFrom: ['staff', attCopyFrom_], attExport: ['staff', attExport_],
  ttGet: ['staff', ttGet_], ttSaveCfg: ['staff', ttSaveCfg_], ttSaveSlot: ['staff', ttSaveSlot_], ttDeleteSlot: ['staff', ttDeleteSlot_],
  attOpen: ['staff', attOpen_], attSave: ['staff', attSave_], attHistory: ['staff', attHistory_], attSummary: ['staff', attSummary_], attDecode: ['staff', attDecode_],
  qrList: ['staff', qrList_], qrSave: ['staff', qrSave_], qrStatus: ['staff', qrStatus_], qrRemove: ['staff', qrRemove_],
  paperList: ['staff', paperList_], paperSave: ['staff', paperSave_], paperRemove: ['staff', paperRemove_],
  examAll: ['staff', examAll_], examFolderSave: ['staff', examFolderSave_], examFolderRemove: ['staff', examFolderRemove_], examMove: ['staff', examMove_], examSave: ['staff', examSave_], examRemove: ['staff', examRemove_], examGet: ['staff', examGet_],
  examKey: ['staff', examKey_], examResultSave: ['staff', examResultSave_], examResultUpdate: ['staff', examResultUpdate_], examResultRemove: ['staff', examResultRemove_], examResults: ['staff', examResults_], examPrefs: ['staff', examPrefs_],
  classBulkAdd: ['staff', classBulkAdd_], classRemove2: ['admin', classRemove2_],
  toolLogAdd: ['staff', toolLogAdd_], toolLogList: ['staff', toolLogList_], toolLogClear: ['staff', toolLogClear_],
  myAttend: ['user', myAttend_], myScores: ['user', myScores_], attCheckIn: ['user', attCheckIn_],
  editSubmission: ['staff', editSubmission_], removeSubmission: ['staff', removeSubmission_], renameClass: ['admin', renameClass_], restoreBackup: ['admin', restoreBackup_], installTriggers: ['admin', installTriggers_]
};

/** ผู้ดูแลระบบ = admin หลัก หรือครูที่ได้รับสิทธิ์ผู้ดูแลระบบร่วม (coAdmin) */
/** เจ้าของระบบ: admin หลัก หรือผู้ดูแลระบบคนใหม่ที่มีฐานข้อมูลแยกของตนเอง */
const ownerAdmin_ = u => !!u && (u.role === 'admin' || (u.role === 'teacher' && u.coAdmin === 'true' && u.tenant === u.id));
const isAdmin_ = u => !!u && (u.role === 'admin' || (u.role === 'teacher' && u.coAdmin === 'true'));
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
      if (isDemo_(ctx.user) && !DEMO_OK[fn]) { if (DEMO_SOFT[fn]) return { ok: true, data: null }; throw err_(DEMO_MSG, 'DEMO'); }
      const data = route[1].apply(null, [ctx].concat(c[1] || []));
      return { ok: true, data: isDemo_(ctx.user) ? demoMask_(fn, data) : data };
    } catch (e) { return { ok: false, error: e.message, code: e.code || 'ERR' }; }
  });
}

/* ============================== Data layer ============================== */
const MEM_ = {};
let SS_ = null, GSS_ = null, TENANT_ = null;
function props_() { return PropertiesService.getScriptProperties(); }
/* ---------- ผู้ดูแลระบบหลายคน (v5.2): ผู้ดูแลระบบแต่ละคนมีฐานข้อมูลของตนเอง (tenant) ----------
 * ไฟล์หลักของระบบ (SHEET_ID): บัญชีครู/ผู้ดูแลระบบทุกคน + เซสชัน + ข้อมูลของผู้ดูแลระบบหลัก
 * ผู้ดูแลระบบที่ได้รับการตั้งแบบ "ฐานข้อมูลแยก": ตั้งค่า Google Sheet + Drive ของตนเอง → ตั้งค่าระบบ/ภาคเรียน/ข้อมูลทั้งหมดเก็บแยก */
function mainSheetId_() { return props_().getProperty('SHEET_ID') || DEFAULTS.SHEET_ID; }
function mainDriveId_() { return props_().getProperty('DRIVE_ID') || DEFAULTS.DRIVE_ID; }
function tenants_() { const m = json_(props_().getProperty('TENANTS'), {}); return m && typeof m === 'object' ? m : {}; }
function tenant_() { return TENANT_ || (TENANT_ = { id: '', sheetId: '', driveId: '' }); }
const tenantOf_ = u => (u && u.tenant) || '';
function useTenant_(tid) {
  tid = String(tid || ''); const reg = tid ? tenants_()[tid] || {} : {}, old = tenant_();
  const t = tid ? { id: tid, sheetId: reg.sheetId || '', driveId: reg.driveId || '', unset: !reg.sheetId } : { id: '', sheetId: '', driveId: '' };
  TENANT_ = t;
  if (old.id !== t.id || old.sheetId !== t.sheetId) { SS_ = null; TSS_ = null; TERM_ = null; Object.keys(MEM_).forEach(k => delete MEM_[k]);
    if (t.id && !t.unset && props_().getProperty('SETUP_T_' + t.id) !== t.sheetId + '|' + APP_VERSION) setupTenant_(); }
}
function sheetId_() { const t = tenant_(); if (t.id) { if (t.unset) throw err_('กรุณาตั้งค่าฐานข้อมูล (Google Sheet และ Google Drive) ของคุณก่อนใช้งาน — ไปที่ ตั้งค่าระบบ → ฐานข้อมูล', 'TENANT_SETUP'); return t.sheetId; } return mainSheetId_(); }
function coreDriveId_() { const t = tenant_(); return t.id && t.driveId ? t.driveId : mainDriveId_(); }
function gss_() { return tenant_().id ? (GSS_ || (GSS_ = SpreadsheetApp.openById(mainSheetId_()))) : ss_(); }
/** บัญชีครู/ผู้ดูแลระบบทั้งหมดทุกฐานข้อมูล (ใช้เข้าสู่ระบบ / ตรวจชื่อผู้ใช้ซ้ำ) */
function allStaff_() { return MEM_._staff || (MEM_._staff = prows_('Users', 'g').filter(u => u.role !== 'student')); }
/** เตรียมไฟล์ฐานข้อมูลของผู้ดูแลระบบ (ตาราง + ค่าเริ่มต้น) */
function setupTenant_() {
  const t = tenant_(), ss = SpreadsheetApp.openById(t.sheetId);
  Object.keys(SCHEMA).filter(n => n !== 'Sessions').forEach(n => ensureSheet_(ss, n));
  const cfg = ss.getSheetByName('Config'), have = cfg.getLastRow() > 1 ? cfg.getRange(2, 1, cfg.getLastRow() - 1, 1).getValues().map(r => String(r[0])) : [];
  Object.keys(CONFIG_DEFAULTS).forEach(k => { if (have.indexOf(k) < 0) cfg.appendRow([k, CONFIG_DEFAULTS[k], now_()]); });
  props_().setProperty('SETUP_T_' + t.id, t.sheetId + '|' + APP_VERSION);
  Object.keys(MEM_).forEach(k => delete MEM_[k]);
}
/** โฟลเดอร์เก็บไฟล์: ใช้โฟลเดอร์ของภาคเรียน (ถ้าตั้งไว้) ไม่งั้นใช้โฟลเดอร์หลัก */
function driveId_() { return termDb_().driveId || coreDriveId_(); }
function ss_() { return SS_ || (SS_ = SpreadsheetApp.openById(sheetId_())); }
/* ---------- ฐานข้อมูลแยกตามภาคเรียน/ปีการศึกษา (v5) ----------
 * ไฟล์หลัก: ตั้งค่าระบบ (Config) · เซสชัน · บัญชีผู้ดูแลระบบ/ครู
 * ไฟล์ภาคเรียน: ข้อมูลอื่นทั้งหมด — นักเรียน ชั้นเรียน หมวดหมู่ ประเภทงาน รายวิชา บทเรียน งาน งานที่ส่ง ประกาศ แจ้งเตือน แชท Log กิจกรรมตอบปัญหา/แบบสอบถาม
 * ภาคเรียนที่ยังไม่ได้ตั้งไฟล์ → ใช้ไฟล์หลักทั้งหมด (เหมือนเดิม) */
const CORE_TABLES = { Config: 1, Sessions: 1 };
let TERM_ = null, TSS_ = null;
const dbKey_ = () => 'DB_MAP' + (tenant_().id ? '_' + tenant_().id : '');
function dbMap_() { const m = json_(props_().getProperty(dbKey_()), {}); return m && typeof m === 'object' ? m : {}; }
function curTermKey_() { const t = term_(); return t.year + '/' + t.term; }
function resolveTerm_(vt) {
  if (vt === 'main') return { key: 'main', sheetId: '', driveId: '' };
  const m = dbMap_(), k = vt && /^25\d\d\/[12]$/.test(vt) ? vt : curTermKey_(), e = m[k];
  return e && e.sheetId ? { key: k, sheetId: e.sheetId, driveId: e.driveId || '' } : { key: k, sheetId: '', driveId: '' };
}
function termDb_() { return TERM_ || (TERM_ = resolveTerm_('')); }
const split_ = () => !!termDb_().sheetId;
/** เลือกฐานข้อมูลภาคเรียนสำหรับคำขอนี้ (vt = 'ปี/ภาค' ที่หน้าเว็บกำลังดู · 'main' = ไฟล์หลัก) */
function useTerm_(vt) {
  const t = resolveTerm_(vt), old = termDb_();
  TERM_ = t;
  if (old.sheetId !== t.sheetId) { TSS_ = null; Object.keys(MEM_).forEach(k => { if (!/^(Config|Sessions)(#c)?$|^_h_(Config|Sessions)#c$/.test(k)) delete MEM_[k]; }); }
}
/** ทำงานกับฐานข้อมูลของอีกภาคเรียนชั่วคราว แล้วกลับมาที่เดิม */
function withTerm_(vt, fn) { const was = termDb_(); useTerm_(vt); try { return fn(); } finally { useTerm_(was.key); TERM_ = was; } }
/** ส่วนของตาราง: 'c' = ไฟล์หลัก · 't' = ไฟล์ภาคเรียน (Users แยกตามบทบาท) */
/** 'g' = ไฟล์หลักของระบบ (บัญชีครู/ผู้ดูแลระบบ เซสชัน) · 'c' = ไฟล์ของผู้ดูแลระบบ (ตั้งค่า + ข้อมูลเมื่อไม่ได้แยกภาค) · 't' = ไฟล์ภาคเรียน */
function partOf_(name, row) {
  if (name === 'Sessions') return 'g';
  if (name === 'Users') return row && row.role === 'student' ? (split_() ? 't' : 'c') : 'g';
  if (name === 'Config') return 'c';
  return split_() ? 't' : 'c';
}
function ssPart_(part) { return part === 't' ? (TSS_ || (TSS_ = SpreadsheetApp.openById(termDb_().sheetId))) : part === 'g' ? gss_() : ss_(); }
/** คีย์แคชแยกตามไฟล์ฐานข้อมูล */
function ck_(name, part) { part = part || partOf_(name); if (part === 't') return termDb_().sheetId.slice(-10) + ':' + name; if (part === 'c' && tenant_().id) return sheetId_().slice(-10) + '#' + name; return name; }
function sheet_(name, part) {
  const ss = ssPart_(part || partOf_(name));
  let sh = ss.getSheetByName(name);
  if (!sh) { ensureSheet_(ss, name); sh = ss.getSheetByName(name); }
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
  try { const id = String(ss.getId ? ss.getId() : ''), tsid = tenant_().id ? tenant_().sheetId : ''; cache_().put('v_' + (id === mainSheetId_() || !id ? '' : id === tsid ? id.slice(-10) + '#' : id.slice(-10) + ':') + name, id_(), 21600); } catch (e) {}
  Object.keys(MEM_).forEach(k => { if (k === '_h_' + name + '#c' || k === '_h_' + name + '#t') delete MEM_[k]; });
}
/* แคชข้อมูลชีตใน CacheService (เร็วกว่าอ่านชีตทุกครั้งมาก) — เปลี่ยนเวอร์ชันทุกครั้งที่เขียน */
const NO_CACHE = { Sessions: 1 };
function cache_() { return CacheService.getScriptCache(); }
function ver_(name, part) { const k = 'v_' + ck_(name, part); let v = cache_().get(k); if (!v) { v = id_(); cache_().put(k, v, 21600); } return v; }
function bump_(name, part) { try { (part ? [part] : name === 'Users' ? ['g', split_() ? 't' : 'c'] : [partOf_(name)]).forEach(p => cache_().put('v_' + ck_(name, p), id_(), 21600)); } catch (e) {} }
function cacheGet_(name, part) {
  if (NO_CACHE[name]) return null;
  try {
    const c = cache_(), v = ver_(name, part), q = ck_(name, part), n = Number(c.get('n_' + q + v) || 0);
    if (!n) return null;
    const keys = []; for (let i = 0; i < n; i++) keys.push('c_' + q + v + '_' + i);
    const got = c.getAll(keys);
    if (keys.some(k => got[k] == null)) return null;
    return JSON.parse(keys.map(k => got[k]).join(''));
  } catch (e) { return null; }
}
function cachePut_(name, list, part) {
  if (NO_CACHE[name]) return;
  try {
    const s = JSON.stringify(list), size = 30000;
    if (s.length > 3000000) return;
    const c = cache_(), v = ver_(name, part), q = ck_(name, part), obj = {}; let n = 0;
    for (let i = 0; i < s.length; i += size) obj['c_' + q + v + '_' + (n++)] = s.slice(i, i + size);
    if (!n) obj['c_' + q + v + '_' + (n++)] = '[]';
    c.putAll(obj, 21600); c.put('n_' + q + v, String(n), 21600);
  } catch (e) {}
}
function headers_(name, part) {
  part = part || (name === 'Users' ? 'g' : partOf_(name));
  const k = '_h_' + name + '#' + part;
  if (!MEM_[k]) { const sh = sheet_(name, part); MEM_[k] = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String); }
  return MEM_[k];
}
/** คอลัมน์ที่เป็นวันที่ล้วน (กันชีตแปลงข้อความเป็นวันที่ → เทียบวันที่ไม่ตรง เช่น ประวัติการเช็คชื่อหาย) */
const DAY_COLS_ = { date: 1, birthDate: 1 };
/** อ่านแถวจากไฟล์จริงหนึ่งไฟล์ */
function prows_(name, part) {
  const cached = cacheGet_(name, part);
  if (cached) { cached.forEach(o => o._db = part); return cached; }
  const values = sheet_(name, part).getDataRange().getValues();
  const h = values.shift() || [];
  const list = values.map((r, i) => {
    const o = { _r: i + 2 };
    h.forEach((k, j) => { if (k) o[k] = r[j] instanceof Date ? Utilities.formatDate(r[j], TZ, DAY_COLS_[k] ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm:ss") : String(r[j]); });
    return o;
  }).filter(o => o[h[0]] !== '');
  cachePut_(name, list, part);
  list.forEach(o => o._db = part);
  return list;
}
function rows_(name) {
  if (MEM_[name]) return MEM_[name];
  if (name === 'Users') { // ครู/ผู้ดูแลระบบของฐานข้อมูลนี้ (จากไฟล์หลัก) + นักเรียนของภาคเรียนนี้
    // บัญชีทดลองใช้งานเป็น "บัญชีแขวนลอย": ไม่อยู่ในรายชื่อ/สถิติใด ๆ (ยืนยันตัวตนผ่าน rawUser_ แทน)
    if (tenant_().unset) return MEM_.Users = prows_('Users', 'g').filter(u => u.role !== 'student' && tenantOf_(u) === tenant_().id && !isDemo_(u));
    const tid = tenant_().id, sp = split_() ? 't' : 'c', g = prows_('Users', 'g'), mine = u => tenantOf_(u) === tid || (!tid && u.tenant && u.tenant === u.id); // ผู้ดูแลระบบหลักเห็นผู้ดูแลระบบที่แยกฐานข้อมูลด้วย (จัดการสิทธิ์ได้)
    if (!tid && sp === 'c') return MEM_.Users = g.filter(u => (u.role === 'student' || mine(u)) && !isDemo_(u));
    return MEM_.Users = g.filter(u => u.role !== 'student' && mine(u) && !isDemo_(u)).concat(prows_('Users', sp).filter(u => u.role === 'student' && !isDemo_(u)));
  }
  return MEM_[name] = prows_(name, partOf_(name));
}
function cell_(v) {
  let s = v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  if (/^[=+@\t\r]|^-[^\d.]/.test(s)) s = "'" + s; // กัน formula injection
  return s;
}
function insert_(name, obj) {
  const part = partOf_(name, obj), h = headers_(name, part), sh = sheet_(name, part);
  sh.appendRow(h.map(k => cell_(obj[k]))); bump_(name, part);
  const o = { _r: sh.getLastRow(), _db: part };
  h.forEach(k => o[k] = obj[k] === undefined || obj[k] === null ? '' : (typeof obj[k] === 'object' ? JSON.stringify(obj[k]) : String(obj[k])));
  if (MEM_[name]) MEM_[name].push(o);
  if (name === 'Users') delete MEM_._staff;
  return o;
}
function insertMany_(name, list) {
  if (!list.length) return;
  ['g', 'c', 't'].forEach(part => {
    const sub = list.filter(o => partOf_(name, o) === part); if (!sub.length) return;
    const h = headers_(name, part), sh = sheet_(name, part);
    sh.getRange(sh.getLastRow() + 1, 1, sub.length, h.length).setValues(sub.map(o => h.map(k => cell_(o[k])))); bump_(name, part);
  });
  delete MEM_[name]; if (name === 'Users') delete MEM_._staff;
}
function updateRow_(name, row, patch) {
  const part = row._db || partOf_(name, row), h = headers_(name, part);
  Object.keys(patch).forEach(k => { if (h.indexOf(k) >= 0) row[k] = typeof patch[k] === 'object' && patch[k] !== null ? JSON.stringify(patch[k]) : String(patch[k] === null || patch[k] === undefined ? '' : patch[k]); });
  sheet_(name, part).getRange(row._r, 1, 1, h.length).setValues([h.map(k => cell_(row[k]))]); bump_(name, part);
  if (name === 'Users') { // บัญชีครูอ่านได้ 2 ทาง (allStaff_ / rows_) — ล้างสำเนาที่อาจค้าง
    delete MEM_._staff; const o = MEM_.Users && MEM_.Users.find(x => x.id === row.id); if (o && o !== row) Object.assign(o, row); }
  return row;
}
function find_(name, id) { return rows_(name).find(r => r.id === String(id)); }
function deleteWhere_(name, pred) {
  const list = rows_(name).filter(pred);
  ['g', 'c', 't'].forEach(part => {
    const sub = list.filter(r => (r._db || partOf_(name, r)) === part).sort((a, b) => b._r - a._r); if (!sub.length) return;
    const sh = sheet_(name, part); sub.forEach(r => sh.deleteRow(r._r)); bump_(name, part);
  });
  delete MEM_[name]; if (name === 'Users') delete MEM_._staff;
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
    // v4.7: ยกเลิกเมนู "ผลการเรียน (สมุดคะแนน)" → ลบชีตที่ไม่ใช้แล้ว (ถ้ามีข้อมูลจะสำรองไฟล์ทั้งชุดไว้ใน Drive ก่อน)
    const OLD = ['Gradebooks', 'GbCategories', 'GbIndicators', 'GbItems', 'GbScores', 'GbGroups', 'GbEnroll', 'GbResults', 'GbVersions', 'GbAudit'].map(n => ss.getSheetByName(n)).filter(Boolean);
    if (OLD.length) { if (OLD.some(sh => sh.getLastRow() > 1)) { try { backup_(); } catch (e) {} } OLD.forEach(sh => { try { ss.deleteSheet(sh); } catch (e) {} }); }
    const cfg = rows_('Config');
    Object.keys(CONFIG_DEFAULTS).forEach(k => { if (!cfg.some(r => r.key === k)) insert_('Config', { key: k, value: CONFIG_DEFAULTS[k], updatedAt: now_() }); });
    if (props_().getProperty('TYPES_V5') !== '1') { const at = rows_('Config').find(r => r.key === 'assignmentTypes');
      if (at) { const l = at.value.split(',').filter(Boolean); BASIC_TYPES.forEach(x => { if (l.indexOf(x) < 0) l.push(x); }); updateRow_('Config', at, { value: l.join(','), updatedAt: now_() }); }
      props_().setProperty('TYPES_V5', '1'); }
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
    try { upgradeV5_(); } catch (e) { console.error('upgradeV5', e); }
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
/** ค่าที่เก็บรายภาคเรียน (ไฟล์ภาคเรียน) — ส่วนอื่นเป็นค่าระบบในไฟล์หลัก */
const TERM_CONFIG = { assignmentTypes: 1 };
const BASIC_TYPES = ['การบ้าน', 'ใบงาน', 'แบบฝึกหัด', 'สรุปเนื้อหา', 'งานเดี่ยว', 'งานกลุ่ม'];
function cfg_() {
  const o = Object.assign({}, CONFIG_DEFAULTS);
  rows_('Config').forEach(r => o[r.key] = r.value);
  if (split_()) rows_('TermConfig').forEach(r => { if (TERM_CONFIG[r.key]) o[r.key] = r.value; });
  return o;
}
function publicCfg_() { const c = cfg_(); PRIVATE_CONFIG.forEach(k => delete c[k]); return c; }
function setCfg_(key, value) {
  const t = TERM_CONFIG[key] && split_() ? 'TermConfig' : 'Config';
  const r = rows_(t).find(x => x.key === key);
  if (r) updateRow_(t, r, { value: value, updatedAt: now_() });
  else insert_(t, { key: key, value: value, updatedAt: now_() });
}

/* ============================== Auth ============================== */
function sha_(s) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)); }
function hashPw_(pw, salt) { let h = salt + ':' + pw; for (let i = 0; i < 300; i++) h = sha_(h + salt); return h; }
function pub_(u) {
  if (!u) return null;
  const o = {}; Object.keys(u).forEach(k => { if (['passSalt', 'passHash', '_r', '_db'].indexOf(k) < 0) o[k] = u[k]; });
  return o;
}
function throttle_(key, max, minutes) {
  const c = CacheService.getScriptCache(), n = Number(c.get('t_' + key) || 0);
  if (n >= max) throw err_('ทำรายการผิดหลายครั้งเกินไป กรุณารอ ' + minutes + ' นาทีแล้วลองใหม่', 'THROTTLE');
  return () => c.put('t_' + key, String(n + 1), minutes * 60);
}
function createSession_(user, remember) {
  let c = CONFIG_DEFAULTS; try { c = cfg_(); } catch (e) {}
  const hours = remember ? Number(c.rememberDays || 30) * 24 : Number(c.sessionHours || 8);
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const exp = Date.now() + hours * 3600e3;
  const th = sha_(token);
  const tn = tenant_().id, tm = user.role === 'student' ? termDb_().key : ''; // นักเรียน: จำฐานข้อมูล/ภาคเรียนที่พบบัญชี
  insert_('Sessions', { id: id_(), userId: user.id, tokenHash: th, expiresAt: String(exp), createdAt: now_(), tenant: tn, term: tm });
  CacheService.getScriptCache().put('s_' + th, JSON.stringify({ u: user.id, e: exp, tn: tn, tm: tm }), Math.min(21600, hours * 3600));
  log_(user.id, 'login', user.role); // ไม่เขียนชีต Users ทุกครั้งที่ login (เร็วขึ้น) — เวลาเข้าล่าสุดดูจาก AuditLog
  const pu = userOut_(user); pu.lastLoginAt = now_();
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
    s = { u: row.userId, e: Number(row.expiresAt), tn: row.tenant || '', tm: row.term || '' };
    if (s.e > Date.now()) cache.put('s_' + th, JSON.stringify(s), Math.max(1, Math.min(21600, Math.floor((s.e - Date.now()) / 1000))));
  }
  if (s.e < Date.now()) return null;
  const st = allStaff_().find(x => x.id === s.u);
  if (st) { useTenant_(tenantOf_(st)); return st.status === 'active' ? st : null; }
  useTenant_(s.tn || ''); if (s.tm) useTerm_(s.tm); // นักเรียน: ใช้ฐานข้อมูล/ภาคเรียนที่เข้าสู่ระบบ
  const u = find_('Users', s.u) || (demoIds_().indexOf(s.u) >= 0 ? rawUser_(x => x.id === s.u) : null);
  return u && u.status === 'active' ? u : null;
}
/** ข้อมูลผู้ใช้ที่ส่งให้หน้าเว็บ */
function userOut_(u) {
  const pu = pub_(u); pu.tenantSetup = !!tenant_().unset; pu.demo = isDemo_(u) ? 'true' : '';
  if (u.role === 'student') { try { const k = termDb_().key; pu.myTerm = /^25\d\d\/[12]$/.test(k || '') ? k : curTermKey_(); } catch (e) {} } // ภาคเรียนของนักเรียน (แสดงในหน้าหลัก — เปลี่ยนเองไม่ได้)
  try { pu.courseIds = myCourseIds_(u); pu.extraMenus = teacherMenus_(u); pu.termDbs = staff_(u) ? Object.keys(dbMap_()) : []; } catch (e) { pu.courseIds = []; pu.extraMenus = []; pu.termDbs = []; }
  return pu;
}
/** ค้นหาในทุกฐานข้อมูล (ผู้ดูแลระบบทุกคน × ภาคปัจจุบัน → ทุกภาคที่ตั้งไว้ → ไฟล์หลัก) — คืนค่าแรกที่พบ (fn คืน truthy) */
function eachDb_(fn, prefer) {
  const tids = [''].concat(Object.keys(tenants_()));
  for (const tid of tids) {
    try { useTenant_(tid); if (tenant_().unset) continue;
      const keys = [prefer || '', ''].concat(Object.keys(dbMap_()).sort().reverse(), ['main']), seen = {};
      for (const k of keys) { const t = resolveTerm_(k), sid = t.sheetId || 'core'; if (seen[sid]) continue; seen[sid] = 1; useTerm_(k); const r = fn(); if (r) return r; }
    } catch (e) { if (e.code === 'THROTTLE') throw e; }
  }
  useTenant_(''); useTerm_(''); return null;
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
  return { webAppUrl: (() => { try { return ScriptApp.getService().getUrl(); } catch (e) { return ''; } })(), term: term_(), config: publicCfg_(), classes: rows_('Classes').map(pub_).sort((a, b) => a.order - b.order), grades: GRADES, version: APP_VERSION, maxUploadMB: MAX_UPLOAD_MB };
}
function login_(ctx, f) {
  f = f || {};
  const c = cfg_();
  if (f.mode === 'admin') {
    const un = str_(f.username, 40).toLowerCase();
    if (un === DEMO_USER && String(f.password || '') === DEMO_PASS) try { ensureDemoStaff_(); } catch (e) { console.error('demo', e); }
    const done = throttle_('a_' + un, 5, 10);
    const u = allStaff_().find(x => x.username === un);
    if (!u || hashPw_(String(f.password || ''), u.passSalt) !== u.passHash) { done(); throw err_('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'); }
    if (u.status === 'pending') throw err_('บัญชีของคุณรอการอนุมัติจาก Admin');
    if (u.status !== 'active') throw err_('บัญชีนี้ถูกระงับการใช้งาน');
    if (isDemo_(u) && !demoOn_()) throw err_('ปิดการทดลองใช้งานแล้ว');
    useTenant_(tenantOf_(u));
    return createSession_(u, !!f.remember);
  }
  const code = str_(f.studentCode, 5);
  const done = throttle_('s_' + code, 5, 10), doneAll = throttle_('s_all', 60, 10);
  // ค้นหาทุกภาคเรียน/ปีการศึกษา (และทุกฐานข้อมูลของผู้ดูแลระบบ) → นักเรียนเข้าสู่ระบบได้เสมอ
  let u = /^\d{5}$/.test(code) ? eachDb_(() => rows_('Users').find(x => x.role === 'student' && x.studentCode === code && x.status === 'active') || null)
    || eachDb_(() => rows_('Users').find(x => x.role === 'student' && x.studentCode === code) || null) : null;
  if (!u && code === DEMO_CODE) try { u = ensureDemoStudent_(); } catch (e) { console.error('demo', e); }
  if (u && isDemo_(u) && !demoOn_()) throw err_('ปิดการทดลองใช้งานแล้ว');
  if (!u) { done(); doneAll(); throw err_('ไม่พบรหัสนักเรียนนี้ กรุณาตรวจสอบหรือลงทะเบียนก่อน'); }
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
function userTaken_(un, exceptId) { return allStaff_().some(u => u.username === un && u.id !== exceptId); }
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
const nameKey_ = n => String(n || '').replace(/^(เด็กชาย|เด็กหญิง|ด\.ช\.|ด\.ญ\.|นางสาว|นาย|นาง|น\.ส\.|ครู|Mr\.?|Mrs\.?|Ms\.?|Miss)\s*/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
/** นักเรียนลืมรหัส: พิมพ์ชื่อ-สกุล (ไม่ต้องมีคำนำหน้า) → แจ้งรหัสนักเรียนที่ชื่อตรงกัน */
function forgotCode_(ctx, d) {
  d = d || {};
  const name = nameKey_(str_(d.fullName, 100));
  if (name.length < 3 || name.indexOf(' ') < 0) throw err_('กรุณาพิมพ์ชื่อและนามสกุล (เว้นวรรคระหว่างชื่อกับสกุล)');
  throttle_('fg_' + name, 8, 10)(); throttle_('fg_all', 200, 10)();
  const list = [], seen = {}; eachDb_(() => { rows_('Users').forEach(u => { if (u.role === 'student' && u.status !== 'disabled' && nameKey_(u.fullName) === name && !seen[u.studentCode]) { seen[u.studentCode] = 1; list.push(u); } }); return list.length >= 5; });
  if (!list.length) throw err_('ไม่พบชื่อนี้ในระบบ กรุณาตรวจสอบการสะกด หรือติดต่อครูผู้สอน');
  log_(list[0].id, 'forgot_code', list.length + ' match');
  return list.map(u => ({ studentCode: u.studentCode, name: u.prefix + u.fullName, grade: u.grade, room: u.room, classNo: u.classNo }));
}
/** ครู/ผู้ดูแลระบบลืมรหัสผ่าน: ชื่อ-สกุล + วันเกิด ต้องตรงกับข้อมูลในระบบ → ตั้งรหัสผ่านใหม่ทันที */
function resetStaffPassword_(ctx, d) {
  d = d || {};
  const name = nameKey_(str_(d.fullName, 100)), bd = str_(d.birthDate, 10), pw = String(d.password || '');
  if (name.length < 3) throw err_('กรุณาพิมพ์ชื่อ-สกุล');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bd)) throw err_('กรุณาเลือกวัน/เดือน/ปีเกิด');
  const done = throttle_('rs_' + name, 5, 15);
  const u = allStaff_().find(x => x.status === 'active' && nameKey_(x.fullName) === name && x.birthDate === bd);
  if (!u) { done(); throw err_('ข้อมูลไม่ตรงกับในระบบ (ถ้ายังไม่เคยบันทึกวันเกิด กรุณาให้ผู้ดูแลระบบรีเซ็ตรหัสผ่านให้)'); }
  if (pw.length < 6) throw err_('รหัสผ่านใหม่อย่างน้อย 6 ตัว');
  if (pw !== String(d.confirm || '')) throw err_('ยืนยันรหัสผ่านไม่ตรงกัน');
  return lock_(() => {
    const salt = id_();
    updateRow_('Users', u, { passSalt: salt, passHash: hashPw_(pw, salt), mustChangePassword: 'false', updatedAt: now_() });
    killSessions_(u.id);
    log_(u.id, 'reset_password', 'self');
    return { username: u.username };
  });
}
function lastLogin_(uid) { const l = rows_('AuditLog'); for (let i = l.length - 1; i >= 0; i--) if (l[i].userId === uid && l[i].action === 'login') return l[i].createdAt; return ''; }
function me_(ctx) {
  const pu = userOut_(ctx.user);
  if (tenant_().unset) { const c = Object.assign({}, CONFIG_DEFAULTS); PRIVATE_CONFIG.forEach(k => delete c[k]); return { user: pu, term: term_(), config: c, classes: [], maxUploadMB: MAX_UPLOAD_MB, unread: 0 }; }
  pu.lastLoginAt = lastLogin_(ctx.user.id) || pu.lastLoginAt;
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
const CONTACT_TYPES = ['phone', 'email', 'line', 'facebook', 'instagram', 'tiktok', 'youtube', 'x', 'website', 'other'];
/** ข้อมูลการติดต่อ: [{type, value, label}] */
function contacts_(v) {
  const list = (Array.isArray(v) ? v : json_(v, [])).slice(0, 12).map(c => ({ type: CONTACT_TYPES.indexOf(c && c.type) >= 0 ? c.type : 'other', value: str_(c && c.value, 200), label: str_(c && c.label, 40) })).filter(c => c.value);
  list.forEach(c => {
    if (c.type === 'phone' && !/^[+\d][\d\s()-]{5,20}$/.test(c.value)) throw err_('เบอร์โทรศัพท์ไม่ถูกต้อง: ' + c.value);
    if (c.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.value)) throw err_('อีเมลไม่ถูกต้อง: ' + c.value);
    if (/^(javascript|data):/i.test(c.value)) throw err_('ข้อมูลการติดต่อไม่ถูกต้อง');
  });
  return list;
}
/** ค่าตั้งค่าส่วนตัวของครู/แอดมิน (ไม่กระทบผู้อื่น): สีระบบ ชื่อระบบ โลโก้ */
function prefs_(v) {
  const o = typeof v === 'string' ? json_(v, {}) : (v || {}), out = {};
  if (o.themeColor) { if (!/^#[0-9a-f]{6}$/i.test(o.themeColor)) throw err_('รหัสสีไม่ถูกต้อง'); out.themeColor = o.themeColor; }
  if (o.schoolName) out.schoolName = str_(o.schoolName, 100);
  if (o.logo) { const l = str_(o.logo, 48000); if (!(imgOk_(l) || /^data:image\/svg\+xml;base64,/.test(l))) throw err_('โลโก้ไม่ถูกต้อง'); out.logo = l; }
  if (o.menus) out.menus = json_(menus_(Array.isArray(o.menus) ? { custom: o.menus } : o.menus), {}).custom || [];
  if (o.scoreSources) out.scoreSources = json_(scoreSources_(o.scoreSources), []);
  if (o.exam && typeof o.exam === 'object') out.exam = o.exam; // ค่าตั้งระบบสอบ (ตรวจค่าแล้วใน examPrefs_)
  return JSON.stringify(out);
}
/** ที่มาของคะแนนเก็บ (Google Sheet ที่มีคอลัมน์ "รวมคะแนนทั้งหมด") + ขอบเขต ภาคเรียน/รายวิชา/ชั้น/ห้อง */
function scoreSources_(v) {
  const a = typeof v === 'string' ? json_(v, []) : v, L = (x, n) => (Array.isArray(x) ? x : []).map(y => str_(y, 40)).filter(Boolean).slice(0, n);
  return JSON.stringify((Array.isArray(a) ? a : []).slice(0, 30).map(x => ({ id: str_(x.id, 20) || id_(), name: str_(x.name, 80) || 'คะแนนเก็บ', url: str_(x.url, 300),
    terms: L(x.terms, 12).filter(k => /^25\d\d\/[12]$/.test(k)), courseIds: L(x.courseIds, 60), grades: L(x.grades, 20), rooms: L(x.rooms, 30) }))
    .filter(x => /docs\.google\.com\/spreadsheets\/d\/|^[\w-]{25,}$/.test(x.url)));
}
/** ที่มาของคะแนนเก็บที่ครูแต่ละคนตั้งไว้ (เฉพาะรายวิชาที่ครูคนนั้นสอนนักเรียนคนนี้) */
function teacherScoreSources_(u) {
  const mine = rows_('Courses').filter(c => courseOk_(u, c)), out = [];
  rows_('Users').filter(t => t.role !== 'student' && t.prefs).forEach(t => {
    const ss = (json_(t.prefs, {}) || {}).scoreSources || []; if (!ss.length) return;
    const cids = mine.filter(c => teaches_(t, c)).map(c => c.id); if (!cids.length) return;
    ss.forEach(x => out.push(Object.assign({}, x, { courseIds: x.courseIds && x.courseIds.length ? x.courseIds.filter(c => cids.indexOf(c) >= 0) : cids })));
  });
  return out.filter(x => x.courseIds.length).slice(0, 20);
}
/** เมนูลิงก์ที่ครูแต่ละคนตั้งไว้ (ตั้งค่าแยกรายครู) → นักเรียนในรายวิชาของครูคนนั้นเห็น */
function teacherMenus_(u) {
  if (!u || u.role !== 'student') return [];
  const mine = rows_('Courses').filter(c => courseOk_(u, c)), out = [];
  rows_('Users').filter(t => t.role !== 'student' && t.prefs).forEach(t => {
    const ms = (json_(t.prefs, {}) || {}).menus || []; if (!ms.length) return;
    const cids = mine.filter(c => teaches_(t, c)).map(c => c.id); if (!cids.length) return;
    ms.forEach(m => out.push(Object.assign({}, m, { id: 't' + t.id.slice(0, 4) + m.id, courseIds: m.courseIds && m.courseIds.length ? m.courseIds : cids, by: t.prefix + t.fullName })));
  });
  return out.slice(0, 30);
}
function myCourseIds_(u) { return u && u.role === 'student' ? rows_('Courses').filter(c => courseOk_(u, c)).map(c => c.id) : []; }
function updateProfile_(ctx, d) {
  d = d || {};
  const u = ctx.user, patch = { updatedAt: now_() };
  if (d.prefix !== undefined) patch.prefix = str_(d.prefix, 30);
  if (d.fullName !== undefined) { const n = str_(d.fullName, 100).replace(/\s+/g, ' '); if (n.length < 3) throw err_('กรุณากรอกชื่อ-สกุล'); patch.fullName = n; }
  if (d.classNo !== undefined) patch.classNo = classNo_(d.classNo);
  if (d.email !== undefined) { const e = str_(d.email, 100); if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw err_('อีเมลไม่ถูกต้อง'); patch.email = e; }
  if (d.avatar !== undefined) { if (d.avatar && !imgOk_(d.avatar)) throw err_('รูปโปรไฟล์ไม่ถูกต้องหรือใหญ่เกินไป'); patch.avatar = d.avatar; }
  if (d.contacts !== undefined) patch.contacts = contacts_(d.contacts);
  if (d.birthDate !== undefined) { const b = str_(d.birthDate, 10); if (b && !/^\d{4}-\d{2}-\d{2}$/.test(b)) throw err_('วันเกิดไม่ถูกต้อง'); patch.birthDate = b; }
  if (d.nickname !== undefined) patch.nickname = str_(d.nickname, 40);
  if (d.prefs !== undefined && staff_(u)) { patch.prefs = prefs_(d.prefs); props_().setProperty('SCORE_V', id_().slice(0, 6)); }
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
/** ครูเจ้าของรายวิชา หรือครูผู้สอนร่วม (Courses.teachers คั่นด้วย ,) */
function teaches_(u, c) { return !!c && (c.ownerId === u.id || String(c.teachers || '').split(',').indexOf(u.id) >= 0); }
function courseOk_(u, c) { return !!c && (isAdmin_(u) || (u.role === 'teacher' ? teaches_(u, c) : match_(u, c.grade, c.room))); }
function ownCourse_(u, cid) { const c = find_('Courses', cid); return !!c && (isAdmin_(u) || teaches_(u, c)); }
function lessonOk_(u, l) {
  if (!l || !courseOk_(u, find_('Courses', l.courseId))) return false;
  if (staff_(u)) return true;
  const n = now_();
  return (!l.publishAt || dt_(l.publishAt) <= n) && (!l.closeAt || dt_(l.closeAt) > n);
}
function annOk_(u, a) { return match_(u, a.grade, a.room) && (!a.courseId || String(a.courseId).split(',').some(c => courseOk_(u, find_('Courses', c)))); }
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
function viewFilters_(view) {
  const cur = term_(), vt = view && /^25\d\d$/.test(String(view.year)) && /^[12]$/.test(String(view.term)) ? { year: String(view.year), term: String(view.term) } : null;
  const past = !!vt && (vt.year + '/' + vt.term) !== (cur.year + '/' + cur.term), key = vt ? vt.year + '/' + vt.term : '';
  return { vt: vt, past: past,
    c: c => !vt || (c.acadYear ? (c.term ? c.acadYear + '/' + c.term === key : String(c.acadYear) === vt.year) : (!past || termKeyOf_(c.createdAt) === key)),
    a: a => !vt || !past || termKeyOf_(a.createdAt) === key || (a.dueAt && termKeyOf_(a.dueAt) === key) };
}
/** "รวมคะแนนทั้งหมด" ของนักเรียน จากเมนู "ผลการเรียน" (ลิงก์ Google Sheet ที่ครู/แอดมินแนบไว้) */
function totalScore_(u) {
  if (!u || u.role !== 'student') return null;
  const ck = 'ts_' + (props_().getProperty('SCORE_V') || '') + u.id, hit = cache_().get(ck); if (hit) return json_(hit, null);
  const sys = (json_(cfg_().studentMenus, {}) || {}).custom || [], cids = myCourseIds_(u);
  const ok = m => (!m.courseIds || !m.courseIds.length || m.courseIds.some(c => cids.indexOf(c) >= 0)) && (!m.grades || !m.grades.length || m.grades.indexOf(u.grade) >= 0) && (!m.rooms || !m.rooms.length || m.rooms.indexOf(u.room) >= 0);
  // 1) ที่มาของคะแนนเก็บที่ตั้งค่าไว้ (ผู้ดูแลระบบ + ครูของรายวิชา) ตามภาคเรียน/รายวิชา/ชั้น/ห้อง
  let tk = ''; try { tk = termDb_().key; } catch (e) {} if (!/^25\d\d\/[12]$/.test(tk || '')) tk = curTermKey_();
  const srcs = json_(cfg_().scoreSources, []).concat(teacherScoreSources_(u));
  const items = [];
  srcs.filter(x => ok(x) && (!x.terms || !x.terms.length || x.terms.indexOf(tk) >= 0)).slice(0, 8).forEach(x => {
    try { const r = sheetTotal_(/^[\w-]{25,}$/.test(x.url) ? 'https://docs.google.com/spreadsheets/d/' + x.url + '/edit' : x.url, u); if (r) items.push(Object.assign(r, { menu: x.name, srcId: x.id || '', courseIds: x.courseIds || [] })); } catch (e) {} });
  let out = items.length ? Object.assign({}, items[0], { items: items }) : null;
  // 2) แบบเดิม: เมนูลิงก์ชื่อ "ผลการเรียน"
  const menus = out ? [] : sys.concat(teacherMenus_(u)).filter(m => ok(m) && /ผลการเรียน|รวมคะแนน|คะแนนรวม/.test(m.name || '') && /docs\.google\.com\/spreadsheets\/d\//.test(m.url || ''));
  for (let i = 0; i < menus.length && !out; i++) { try { out = sheetTotal_(menus[i].url, u); if (out) out.menu = menus[i].name; } catch (e) {} }
  try { cache_().put(ck, JSON.stringify(out), out ? 600 : 180); } catch (e) {}
  return out;
}
/** หาคอลัมน์ "รวมคะแนนทั้งหมด" (หัวตารางกี่แถวก็ได้ / เซลล์รวม) แล้วหาแถวของนักเรียนจากรหัสนักเรียน (เซลล์ใดก็ได้ในแถว) หรือชื่อ-สกุล */
function scanTotal_(tables, codeIn, nameIn) {
  const norm = v => String(v || '').replace(/\s+/g, '').toLowerCase(), code = norm(codeIn), nm = norm(nameKey_(nameIn || '')).replace(/^(เด็กชาย|เด็กหญิง|นาย|นางสาว|นาง|ด\.ช\.|ด\.ญ\.)/, '');
  for (const t of tables) {
    let h = -1, tc = -1;
    for (let i = 0; i < Math.min(15, t.length) && tc < 0; i++) { const j = t[i].findIndex(x => norm(x).indexOf('รวมคะแนนทั้งหมด') >= 0); if (j >= 0) { h = i; tc = j; } }
    if (tc < 0) continue;
    const rows = t.slice(h + 1), out = { header: String(t[h][tc]).trim(), headerRow: h + 1, col: tc + 1, rows: rows.length };
    if (!code && !nm) return out;
    const row = (code && rows.find(r => r.some(c => norm(c) === code))) || (nm && nm.length > 3 && rows.find(r => norm(nameKey_(r.join(' '))).indexOf(nm) >= 0 || norm(r.join('')).indexOf(nm) >= 0));
    if (row) return Object.assign(out, { value: String(row[tc] === undefined ? '' : row[tc]).trim() });
  }
  return null;
}
function sheetTables_(url) {
  const id = (String(url).match(/\/d\/([\w-]{20,})/) || String(url).match(/^([\w-]{25,})$/) || [])[1], gid = ''; // อ่านทุกแผ่นงาน (ชื่อแผ่นงาน = ห้อง) แม้ลิงก์จะระบุ gid
  if (!id) throw err_('ลิงก์ Google Sheet ไม่ถูกต้อง');
  try { const ss = SpreadsheetApp.openById(id), shs = ss.getSheets().filter(sh => !gid || String(sh.getSheetId()) === gid); return { name: ss.getName(), names: shs.map(sh => sh.getName()), tables: shs.map(sh => sh.getDataRange().getDisplayValues()) }; }
  catch (e) { const r = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + id + '/gviz/tq?tqx=out:csv' + (gid ? '&gid=' + gid : ''), { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200 || /<html/i.test(r.getContentText().slice(0, 200))) throw err_('เปิด Google Sheet นี้ไม่ได้ — แชร์ไฟล์ให้บัญชีที่ Deploy เว็บแอป (' + (function () { try { return Session.getEffectiveUser().getEmail(); } catch (x) { return 'เจ้าของสคริปต์'; } })() + ') หรือตั้งค่า "ทุกคนที่มีลิงก์ดูได้"');
    return { name: 'CSV', names: ['Sheet1'], tables: [Utilities.parseCsv(r.getContentText())] }; }
}
const srcUrl_ = u => /^[\w-]{25,}$/.test(u) ? 'https://docs.google.com/spreadsheets/d/' + u + '/edit' : u;
/** แยกตารางคะแนน 1 แผ่นงาน: หัวตาราง (แถวที่มี "รวมคะแนนทั้งหมด") · แถวคะแนนเต็ม · รายชื่อนักเรียน · ส่วนสรุป (ระดับผลการเรียน / คุณลักษณะ / อ่านคิดวิเคราะห์) */
const SC_PREFIX = /^(เด็กชาย|เด็กหญิง|นาย|นางสาว|นาง|ด\.ช\.|ด\.ญ\.|ด\.ช|ด\.ญ|น\.ส\.)\s*/;
/** ประเภทคอลัมน์คะแนน: ind ตัวชี้วัด/บทเรียน · exam สอบ · total รวมทั้งหมด · grade เกรด · trait คุณลักษณะ · read อ่านคิดวิเคราะห์ · sub รวมย่อย · raw งานย่อย */
function colKind_(label) {
  const n = String(label || '').replace(/\s+/g, '');
  if (/รวมคะแนนทั้งหมด/.test(n)) return 'total';
  if (/เกรด|ผลการเรียน|ระดับผลการเรียน/.test(n)) return 'grade';
  if (/คุณลักษณะ/.test(n)) return 'trait';
  if (/อ่าน|คิดวิเคราะห์|วิเคราะห์/.test(n)) return 'read';
  if (/^สอบ|คะแนนสอบ/.test(n)) return 'exam';
  if (/ตัวชี้วัด|บทเรียน|หน่วยการเรียน/.test(n)) return 'ind';
  if (/รวม|ระหว่างภาค|กลางภาค|ปลายภาค/.test(n)) return 'sub';
  return 'raw';
}
/** แยกตารางคะแนน 1 แผ่นงาน — หาคอลัมน์ เลขที่/คำนำหน้า/ชื่อ จากข้อมูลจริง (ไม่พึ่งหัวตารางอย่างเดียว) */
function parseBook_(t) {
  const clean = v => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim(), norm = v => clean(v).replace(/\s/g, '').toLowerCase();
  let h = -1, tc = -1;
  for (let i = 0; i < Math.min(20, t.length) && tc < 0; i++) { const j = t[i].findIndex(x => norm(x).indexOf('รวมคะแนนทั้งหมด') >= 0); if (j >= 0) { h = i; tc = j; } }
  if (tc < 0) return null;
  // แถวข้อมูล: หลังหัวตาราง จนถึงแถว "สรุป"
  let end = t.length; for (let i = h + 1; i < t.length; i++) if (t[i].slice(0, 8).some(c => /^สรุป/.test(clean(c)))) { end = i; break; }
  const isName = v => { v = clean(v); return v.length >= 4 && /[ก-๙]/.test(v) && !/^\d/.test(v) && !/^(คะแนน(เต็ม|เก็บ|รวม|สอบ)?$|ตัวชี้วัด|สรุป|จำนวน|ร้อยละ|รวม)/.test(v); };
  const isPrefix = v => /^(เด็กชาย|เด็กหญิง|นาย|นางสาว|นาง|ด\.ช\.?|ด\.ญ\.?|น\.ส\.?)$/.test(clean(v));
  const body = t.slice(h + 1, end), lead = Math.min(tc, 8), score = j => body.filter(r => isName(r[j]) && !isPrefix(r[j])).length;
  let nameC = -1, best = 0; for (let j = 0; j < lead; j++) { const sc = score(j), n = sc && sc + (/ชื่อ/.test(norm(t[h][j])) && !/ชื่อเล่น|ชื่องาน/.test(norm(t[h][j])) ? 2 : 0); if (n > best) { best = n; nameC = j; } }
  const nameN = nameC >= 0 ? score(nameC) : 0;
  if (nameC < 0) return null;
  let preC = -1; for (let j = 0; j < lead; j++) if (j !== nameC && body.filter(r => isPrefix(r[j])).length >= Math.max(1, body.length / 3)) { preC = j; break; }
  let noC = -1; for (let j = 0; j < nameC; j++) if (j !== preC && body.filter(r => /^\d{1,3}$/.test(clean(r[j]))).length >= Math.max(1, nameN / 2) && body.some(r => clean(r[j]) === '1' || clean(r[j]) === '2')) { noC = j; break; }
  const codeC = t[h].findIndex(x => /รหัส|เลขประจำตัว/.test(norm(x)));
  // หัวคอลัมน์ (รวมแถวหัวหลายแถว เช่น หัวรวมเซลล์ + หัวรอง)
  const lab = j => { let x = clean(t[h][j]); if (!x && h > 0) x = clean(t[h - 1][j]); return x; };
  const r1 = t[h + 1] || []; let maxRow = null; if (!isName(r1[nameC]) && /\d/.test(clean(r1[tc]))) maxRow = r1;
  const idC = [noC, preC, codeC, nameC], cols = [];
  for (let j = 0; j < Math.max.apply(null, t.slice(h, h + 2).map(r => r.length)); j++) { const x = lab(j); if (!x || idC.indexOf(j) >= 0 || j < nameC) continue; const n = norm(x); if (/ชื่อเล่น|ชื่องาน/.test(n)) continue;
    cols.push({ j: j, label: x, max: maxRow ? clean(maxRow[j]) : '', kind: colKind_(x) }); }
  const students = [], hasRead = cols.some(c => c.kind === 'read'); // ไม่มีคอลัมน์อ่านคิดวิเคราะห์ → ใช้ผลประเมินคุณลักษณะฯ (ตามที่โรงเรียนกำหนดให้ตรงกัน)
  body.forEach(r => { if (!isName(r[nameC]) || isPrefix(r[nameC])) return; const vals = {}; cols.forEach(c => vals[c.j] = clean(r[c.j]));
    const pick = k => { const c = cols.find(x => x.kind === k); return c ? vals[c.j] : ''; };
    students.push({ no: noC >= 0 ? clean(r[noC]) : '', prefix: preC >= 0 ? clean(r[preC]) : '', name: clean(r[nameC]), code: codeC >= 0 ? clean(r[codeC]) : '', vals: vals, total: clean(r[tc]), grade: pick('grade'), trait: pick('trait'), read: hasRead ? pick('read') : pick('trait') }); });
  const section = re => { for (let i = end; i < t.length; i++) { const j = t[i].findIndex(c => re.test(norm(c))); if (j < 0) continue;
      const lb = t[i + 1] || [], cnt = t[i + 2] || [], pct = t[i + 3] || [], out = { labels: [], counts: [], percents: [] }; let k = j;
      while (k < lb.length && clean(lb[k]) && !/^รวม/.test(clean(lb[k]))) { out.labels.push(clean(lb[k])); out.counts.push(clean(cnt[k])); out.percents.push(/ร้อยละ/.test(pct.slice(0, j).map(clean).join('')) ? clean(pct[k]) : ''); k++; }
      out.total = clean(cnt[k]); return out.labels.length ? out : null; } return null; };
  let count = ''; for (let i = end; i < t.length; i++) { const j = t[i].findIndex(c => /^จำนวนนักเรียน$/.test(norm(c))); if (j >= 0) { count = clean(t[i].slice(j + 1).find(c => clean(c)) || ''); break; } }
  const gc = cols.find(c => c.kind === 'grade');
  return { readFromTrait: !hasRead, totalCol: tc, gradeCol: gc ? gc.j : -1, columns: cols, students: students, count: count || String(students.length),
    sections: { grade: section(/ได้ระดับผลการเรียน/), trait: section(/คุณลักษณะ/), read: section(/การอ่าน|อ่าน,?คิด/) } };
}
const nmKey_ = v => String(v || '').replace(SC_PREFIX, '').replace(/\s+/g, '').toLowerCase();
/** ผลการเรียนของนักเรียน 1 คน จากแหล่งคะแนน (จับคู่รหัส หรือ ชื่อ-สกุล) */
function studentScore_(tables, u, names) {
  const norm = v => String(v || '').replace(/\s+/g, '').toLowerCase(), code = norm(u.studentCode), nm = nmKey_(u.fullName);
  for (let ti = 0; ti < tables.length; ti++) { const b = parseBook_(tables[ti]); if (!b) continue;
    const st = b.students.find(x => (code && (norm(x.code) === code)) || (nm.length > 3 && nmKey_(x.prefix + x.name) === nm) || (nm.length > 3 && nmKey_(x.name).indexOf(nm) >= 0));
    if (!st) continue;
    const of = k => b.columns.filter(c => c.kind === k).map(c => ({ label: c.label, value: st.vals[c.j], max: c.max })).filter(d => d.value !== '');
    const tcol = b.columns.find(c => c.j === b.totalCol);
    return { value: st.total, header: tcol ? tcol.label : 'รวมคะแนนทั้งหมด', max: tcol ? tcol.max : '', grade: st.grade, trait: st.trait, read: st.read, no: st.no, room: (names || [])[ti] || '',
      indicators: of('ind'), exams: of('exam'), details: of('ind').concat(of('exam')) };
  }
  return null;
}
/** ทดสอบที่มาของคะแนนเก็บ (หน้าตั้งค่า): เปิดไฟล์ได้ไหม · พบคอลัมน์ไหม · ลองค้นหานักเรียน */
function scoreTest_(ctx, url, code) {
  const t = sheetTables_(str_(url, 300)), c = str_(code, 10), u = c ? rows_('Users').find(x => x.role === 'student' && x.studentCode === c) : null;
  const r = scanTotal_(t.tables, c, u ? u.fullName : '');
  if (!r) return { ok: false, name: t.name, message: 'ไม่พบคอลัมน์ "รวมคะแนนทั้งหมด" ใน ' + t.tables.length + ' แผ่นงาน' };
  return { ok: true, name: t.name, header: r.header, headerRow: r.headerRow, col: r.col, rows: r.rows, found: r.value !== undefined, value: r.value, student: u ? userName_(u) : '' };
}
/** ค้นหาแถวของนักเรียน (รหัสนักเรียน หรือชื่อ-สกุล) แล้วอ่านคอลัมน์ "รวมคะแนนทั้งหมด" */
function sheetTotal_(url, u) {
  const id = (url.match(/\/d\/([\w-]{20,})/) || [])[1], gid = '';
  if (!id) return null;
  let tables = [], names = [];
  try { const ss = SpreadsheetApp.openById(id), shs = ss.getSheets(); names = shs.map(sh => sh.getName()); tables = shs.map(sh => sh.getDataRange().getDisplayValues()); }
  catch (e) { // ไฟล์ที่แชร์แบบลิงก์สาธารณะ → อ่านผ่าน CSV
    const r = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + id + '/gviz/tq?tqx=out:csv' + (gid ? '&gid=' + gid : ''), { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return null; tables = [Utilities.parseCsv(r.getContentText())]; }
  const d = studentScore_(tables, u, names); if (d && d.value !== '') return d;
  const r = scanTotal_(tables, u.studentCode, u.fullName);
  return r && r.value !== undefined && r.value !== '' ? { value: r.value, header: r.header } : null;
}
/* ============================== v5.9 เครื่องมือ QR Code ============================== */
/** บันทึกรูป base64 (data URL) ลง Google Drive ของภาคเรียน */
function saveDataUrl_(ctx, dataUrl, name, path) {
  const m = String(dataUrl || '').match(/^data:(image\/(png|jpeg|webp));base64,(.+)$/); if (!m) return null;
  if (m[3].length > 9e6) throw err_('รูปใหญ่เกินไป');
  const file = folderFor_(ctx.user, path).createFile(Utilities.newBlob(Utilities.base64Decode(m[3]), m[1], name));
  file.setDescription('cp:' + ctx.user.id); const shared = share_(file);
  return fileOut_(file.getId(), name, m[1], file.getSize(), shared);
}
/** ย้ายไฟล์เก่าใน Drive ลงถังขยะ (ไม่ให้ล้มถ้าไม่มีสิทธิ์/ไม่พบ) */
function trash_(id) { if (!id) return; try { DriveApp.getFileById(String(id)).setTrashed(true); } catch (e) {} }
const qrOwn_ = (u, r) => r && (r.ownerId === u.id || isAdmin_(u));
function qrOut_(r) { const o = pub_(r); o.style = json_(r.style, {}); o.file = json_(r.fileJson, null); delete o.fileJson; return o; }
function qrList_(ctx) {
  const me = ctx.user, list = rows_('QrCodes').filter(r => r.ownerId === me.id || isAdmin_(me)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(qrOut_);
  return { items: list, total: list.length, active: list.filter(x => x.status !== 'cancel').length, cancel: list.filter(x => x.status === 'cancel').length, term: tkey_() };
}
function qrSave_(ctx, d) {
  d = d || {}; const me = ctx.user, text = str_(d.text, 2000);
  if (!text) throw err_('กรุณากรอกข้อความหรือ URL');
  const useDate = str_(d.useDate, 10); if (useDate && !/^\d{4}-\d{2}-\d{2}$/.test(useDate)) throw err_('วันที่ไม่ถูกต้อง');
  const so = json_(JSON.stringify(d.style || {}), {}); if (so.logo && String(so.logo).length > 40000) delete so.logo; let style = JSON.stringify(so); if (style.length > 45000) { delete so.logo; style = JSON.stringify(so).slice(0, 4000); } // ไม่ตัด JSON กลางคัน
  const file = d.file && d.file.id ? cleanFiles_([d.file])[0] || null : null;
  return lock_(() => {
    const r = d.id ? find_('QrCodes', d.id) : null; if (d.id && !qrOwn_(me, r)) throw err_('ไม่พบ QR Code นี้', 'NOTFOUND');
    const patch = { text: text, note: str_(d.note, 500), status: d.status === 'cancel' ? 'cancel' : 'active', useDate: useDate, style: style, fileJson: file ? JSON.stringify(file) : '', updatedAt: now_() };
    let img = null; if (d.png) img = saveDataUrl_(ctx, d.png, 'QR_' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd_HHmmss') + '.png', 'QR Code');
    if (img) patch.imgId = img.id;
    if (r) { const oldF = json_(r.fileJson, null); if (oldF && oldF.id && (!file || file.id !== oldF.id)) trash_(oldF.id); if (img && r.imgId) trash_(r.imgId); updateRow_('QrCodes', r, patch); log_(me.id, 'qr_edit', r.id); return qrOut_(Object.assign({}, r, patch)); }
    const row = insert_('QrCodes', Object.assign({ id: id_(), ownerId: me.id, createdAt: now_() }, patch)); log_(me.id, 'qr_add', row.id); return qrOut_(row);
  });
}
function qrStatus_(ctx, id, status) { const r = find_('QrCodes', id); if (!qrOwn_(ctx.user, r)) throw err_('ไม่พบ QR Code นี้', 'NOTFOUND'); return lock_(() => { updateRow_('QrCodes', r, { status: status === 'cancel' ? 'cancel' : 'active', updatedAt: now_() }); return true; }); }
function qrRemove_(ctx, id) {
  const r = find_('QrCodes', id); if (!qrOwn_(ctx.user, r)) throw err_('ไม่พบ QR Code นี้', 'NOTFOUND');
  return lock_(() => { trash_(r.imgId); const f = json_(r.fileJson, null); if (f && f.id) trash_(f.id); deleteWhere_('QrCodes', x => x.id === r.id); log_(ctx.user.id, 'qr_del', r.id); return true; });
}
/* ============================== v5.9 สอบเก็บคะแนน: กระดาษคำถาม · กระดาษคำตอบ (OMR) ============================== */
const exOwn_ = (u, r) => r && (r.ownerId === u.id || isAdmin_(u));
function paperList_(ctx) { return rows_('ExamPapers').filter(r => exOwn_(ctx.user, r)).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map(r => Object.assign(pub_(r), { data: json_(r.data, {}) })); }
function paperSave_(ctx, d) {
  d = d || {}; const title = str_(d.title, 200) || 'แบบทดสอบ', js = JSON.stringify(d.data || {}); if (js.length > 45000) throw err_('ข้อสอบยาวเกินไป (แบ่งเป็นหลายชุด)');
  return lock_(() => { const r = d.id ? find_('ExamPapers', d.id) : null; if (d.id && !exOwn_(ctx.user, r)) throw err_('ไม่พบข้อสอบนี้', 'NOTFOUND');
    const fo = d.folderId !== undefined ? str_(d.folderId, 20) : (r ? r.folderId || '' : '');
    if (r) { updateRow_('ExamPapers', r, { title: title, data: js, folderId: fo, updatedAt: now_() }); return { id: r.id }; }
    return { id: insert_('ExamPapers', { id: id_(), ownerId: ctx.user.id, title: title, data: js, folderId: fo, createdAt: now_(), updatedAt: now_() }).id }; });
}
function paperRemove_(ctx, id) { const r = find_('ExamPapers', id); if (!exOwn_(ctx.user, r)) throw err_('ไม่พบข้อสอบนี้', 'NOTFOUND'); return lock_(() => { deleteWhere_('ExamPapers', x => x.id === r.id); return true; }); }
/** ค่าตั้งของกระดาษคำตอบ */
function examCfg_(c) {
  c = c || {}; const n = x => Math.round(Number(x) || 0);
  const out = { digits: Math.min(5, Math.max(2, n(c.digits) || 5)), count: Math.min(200, Math.max(1, n(c.count) || 10)),
    fmt: ['tf', 'c2', 'c3', 'c4', 'c5', 'custom'].indexOf(c.fmt) >= 0 ? c.fmt : 'c4', nopt: Math.min(10, Math.max(2, n(c.nopt) || 4)), labels: ['th', 'en', 'num', 'low', 'rom', 'custom'].indexOf(c.labels) >= 0 ? c.labels : 'th', labelsCustom: str_(c.labelsCustom, 80),
    sets: Math.min(6, Math.max(1, n(c.sets) || 1)), cols: Math.min(5, Math.max(0, n(c.cols))), layout: c.layout === 'side' ? 'side' : 'inline', sheet: {} };
  if (out.fmt === 'tf') out.nopt = 2; else if (out.fmt !== 'custom') out.nopt = Number(out.fmt.slice(1));
  const s = c.sheet || {}; ['info', 'howto', 'idbox', 'logo', 'qr', 'setbox', 'tips', 'part2', 'page', 'foot', 'score'].forEach(k => out.sheet[k] = s[k] !== false);
  [['cmd', 300], ['part1', 60], ['part1Type', 120], ['tipsText', 400], ['part2Title', 120], ['part2Cmd', 300], ['part2Text', 600], ['grade', 20], ['term', 10]].forEach(x => out.sheet[x[0]] = str_(s[x[0]], x[1]));
  out.grid = ['none', 'h', 'v', 'hv'].indexOf(c.grid) >= 0 ? c.grid : 'none'; out.flow = c.flow === 'below' ? 'below' : 'side';
  const ly = s.lay && typeof s.lay === 'object' ? s.lay : {}, col = v => /^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v) : ''; out.sheet.lay = { logo: Math.min(36, Math.max(10, Number(ly.logo) || 23)), lgap: Math.min(8, Math.max(3.5, Number(ly.lgap) || 4.8)), qrSwap: ly.qrSwap === true, text: col(ly.text) || '#111111', line: col(ly.line) || '#000000' };
  out.sheet.font = str_(s.font, 40); out.sheet.fs = Math.min(1.35, Math.max(.8, Number(s.fs) || 1)); const hi = String(s.howtoImg || ''); out.sheet.howtoImg = /^data:image\/(png|jpe?g|webp);base64,/.test(hi) && hi.length <= 30000 ? hi : '';
  out.sheet.howtoText = str_(s.howtoText, 600); out.sheet.school = str_(s.school, 120); out.sheet.subtitle = str_(s.subtitle, 200); out.sheet.courseCode = str_(s.courseCode, 30); out.sheet.courseName = str_(s.courseName, 120);
  return out;
}
/** เฉลย: { A: [{ a: [ตัวเลือกที่ถูก...], p: คะแนน }] } */
function examKeyClean_(k, cfg) {
  const out = {}, sets = 'ABCDEF'.slice(0, cfg.sets).split('');
  sets.forEach(s => { const arr = (k && Array.isArray(k[s]) ? k[s] : []); out[s] = Array.from({ length: cfg.count }, (x, i) => { const it = arr[i] || {};
    return { a: (Array.isArray(it.a) ? it.a : []).map(Number).filter((v, j, l) => v >= 0 && v < cfg.nopt && l.indexOf(v) === j).sort(), p: Math.max(0, Math.min(100, Number(it.p) || 1)) }; }); });
  return out;
}
/** ให้คะแนน: ข้อที่มีคำตอบถูกหลายตัว → ตอบตัวใดตัวหนึ่งที่ถูก (และไม่ฝนตัวผิด) ได้คะแนนเต็ม */
function examScore_(key, set, answers) {
  const k = key[set] || key.A || [], ans = Array.isArray(answers) ? answers : [];
  let score = 0, max = 0, right = 0;
  k.forEach((it, i) => { max += it.p; const a = (Array.isArray(ans[i]) ? ans[i] : ans[i] === null || ans[i] === undefined || ans[i] === '' ? [] : [ans[i]]).map(Number);
    if (it.a.length && a.length && a.every(v => it.a.indexOf(v) >= 0)) { score += it.p; right++; } });
  return { score: r2_(score), max: r2_(max), right: right };
}
function examOut_(r) { const o = pub_(r); o.cfg = examCfg_(json_(r.cfg, {})); o.key = json_(r.key, {}); o.classes = String(r.classes || '').split(',').filter(Boolean); o.tags = String(r.tags || '').split(',').filter(Boolean); return o; }
function examAll_(ctx) {
  const me = ctx.user, res = {}; rows_('ExamResults').forEach(x => res[x.examId] = (res[x.examId] || 0) + 1);
  return { term: tkey_(), folders: rows_('ExamFolders').filter(r => exOwn_(me, r)).map(pub_).sort((a, b) => natural_(a.name, b.name)),
    exams: rows_('Exams').filter(r => exOwn_(me, r)).map(r => Object.assign(examOut_(r), { done: res[r.id] || 0 })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) };
}
const natural_ = (a, b) => String(a).localeCompare(String(b), 'th', { numeric: true });
/** v6.0 ย้ายกระดาษคำถาม/กระดาษคำตอบเข้า-ออกโฟลเดอร์ (ลากวาง / นำเข้าข้อสอบ) */
function examMove_(ctx, kind, ids, folderId) {
  const tb = kind === 'paper' ? 'ExamPapers' : 'Exams', fo = str_(folderId, 20), set = {}; (Array.isArray(ids) ? ids : []).slice(0, 300).forEach(x => set[String(x)] = 1);
  if (fo) { const f = find_('ExamFolders', fo); if (!exOwn_(ctx.user, f) || (f.kind || 'sheet') !== (kind === 'paper' ? 'paper' : 'sheet')) throw err_('ไม่พบโฟลเดอร์', 'NOTFOUND'); }
  return lock_(() => { let n = 0; rows_(tb).filter(r => set[r.id] && exOwn_(ctx.user, r)).forEach(r => { updateRow_(tb, r, { folderId: fo, updatedAt: now_() }); n++; }); return { moved: n }; });
}
function examFolderSave_(ctx, d) { d = d || {}; const name = str_(d.name, 80); if (!name) throw err_('กรุณาตั้งชื่อโฟลเดอร์');
  return lock_(() => { const r = d.id ? find_('ExamFolders', d.id) : null; if (d.id && !exOwn_(ctx.user, r)) throw err_('ไม่พบโฟลเดอร์', 'NOTFOUND');
    if (r) { updateRow_('ExamFolders', r, { name: name }); return { id: r.id, name: name }; } const kind = d.kind === 'paper' ? 'paper' : 'sheet'; return { id: insert_('ExamFolders', { id: id_(), ownerId: ctx.user.id, name: name, kind: kind, createdAt: now_() }).id, name: name, kind: kind }; }); }
function examFolderRemove_(ctx, id, mode) {
  const r = find_('ExamFolders', id); if (!exOwn_(ctx.user, r)) throw err_('ไม่พบโฟลเดอร์', 'NOTFOUND');
  if (r.kind === 'paper') return lock_(() => { const ps = rows_('ExamPapers').filter(e => e.folderId === r.id);
    if (mode === 'all') deleteWhere_('ExamPapers', e => e.folderId === r.id); else ps.forEach(e => updateRow_('ExamPapers', e, { folderId: '', updatedAt: now_() }));
    deleteWhere_('ExamFolders', x => x.id === r.id); return { papers: ps.length }; });
  return lock_(() => { const ex = rows_('Exams').filter(e => e.folderId === r.id);
    if (mode === 'all') { const ids = {}; ex.forEach(e => ids[e.id] = 1); rows_('ExamResults').filter(x => ids[x.examId]).forEach(x => trash_(json_(x.img, {}).id)); deleteWhere_('ExamResults', x => ids[x.examId]); deleteWhere_('Exams', e => ids[e.id]); }
    else ex.forEach(e => updateRow_('Exams', e, { folderId: '', updatedAt: now_() }));
    deleteWhere_('ExamFolders', x => x.id === r.id); return { exams: ex.length }; }); }
function examSave_(ctx, d) {
  d = d || {}; const name = str_(d.name, 150); if (!name) throw err_('กรุณาตั้งชื่อข้อสอบ');
  const cfg = examCfg_(d.cfg), classes = (Array.isArray(d.classes) ? d.classes : []).map(x => str_(x, 30)).filter(Boolean).slice(0, 60).join(','), tags = (Array.isArray(d.tags) ? d.tags : []).map(x => str_(x, 30)).filter(Boolean).slice(0, 20).join(',');
  return lock_(() => { const r = d.id ? find_('Exams', d.id) : null; if (d.id && !exOwn_(ctx.user, r)) throw err_('ไม่พบข้อสอบ', 'NOTFOUND');
    const key = examKeyClean_(d.key !== undefined ? d.key : (r ? json_(r.key, {}) : {}), cfg);
    const patch = { name: name, folderId: str_(d.folderId, 20), cfg: JSON.stringify(cfg), key: JSON.stringify(key), classes: classes, tags: tags, updatedAt: now_() };
    if (r) { updateRow_('Exams', r, patch); return examOut_(Object.assign({}, r, patch)); }
    return examOut_(insert_('Exams', Object.assign({ id: id_(), ownerId: ctx.user.id, createdAt: now_() }, patch))); });
}
function examRemove_(ctx, id) { const r = find_('Exams', id); if (!exOwn_(ctx.user, r)) throw err_('ไม่พบข้อสอบ', 'NOTFOUND');
  return lock_(() => { rows_('ExamResults').filter(x => x.examId === r.id).forEach(x => trash_(json_(x.img, {}).id)); deleteWhere_('ExamResults', x => x.examId === r.id); deleteWhere_('Exams', x => x.id === r.id); return true; }); }
function examGet_(ctx, id) {
  const r = find_('Exams', id); if (!exOwn_(ctx.user, r)) throw err_('ไม่พบข้อสอบ', 'NOTFOUND');
  const ex = examOut_(r), cl = ex.classes, inCl = u => !cl.length || cl.indexOf(u.grade + '/' + u.room) >= 0 || cl.indexOf(u.grade) >= 0;
  const students = rows_('Users').filter(u => u.role === 'student' && u.status !== 'disabled' && inCl(u)).map(u => ({ id: u.id, code: u.studentCode, no: u.classNo, name: (u.prefix || '') + u.fullName, grade: u.grade, room: u.room }))
    .sort((a, b) => natural_(a.grade + '/' + a.room, b.grade + '/' + b.room) || (Number(a.no) || 999) - (Number(b.no) || 999));
  const results = rows_('ExamResults').filter(x => x.examId === r.id).map(x => Object.assign(pub_(x), { answers: json_(x.answers, []), img: json_(x.img, null), meta: json_(x.meta, {}), history: json_(x.history, []) }));
  return { exam: ex, students: students, results: results };
}
/** บันทึกเฉลย (+ คำนวณคะแนนที่สแกนแล้วใหม่ถ้าเลือก) */
function examKey_(ctx, id, key, recalc) {
  const r = find_('Exams', id); if (!exOwn_(ctx.user, r)) throw err_('ไม่พบข้อสอบ', 'NOTFOUND');
  return lock_(() => { const cfg = examCfg_(json_(r.cfg, {})), k = examKeyClean_(key, cfg); updateRow_('Exams', r, { key: JSON.stringify(k), updatedAt: now_() }); let n = 0;
    if (recalc) rows_('ExamResults').filter(x => x.examId === r.id).forEach(x => { const s = examScore_(k, x.set || 'A', json_(x.answers, [])); updateRow_('ExamResults', x, { score: String(s.score), max: String(s.max), updatedAt: now_() }); n++; });
    return { recalculated: n }; });
}
/** บันทึกผลสแกน: คะแนนลงชีตก่อนเสมอ แล้วจึงอัปโหลดรูป (รูปล้มเหลว คะแนนยังอยู่) */
function examResultSave_(ctx, examId, d) {
  d = d || {}; const r = find_('Exams', examId); if (!exOwn_(ctx.user, r)) throw err_('ไม่พบข้อสอบ', 'NOTFOUND');
  const cfg = examCfg_(json_(r.cfg, {})), key = examKeyClean_(json_(r.key, {}), cfg), set = 'ABCDEF'.slice(0, cfg.sets).indexOf(String(d.set || 'A')) >= 0 ? String(d.set || 'A') : 'A';
  const answers = Array.from({ length: cfg.count }, (x, i) => (Array.isArray(d.answers) && Array.isArray(d.answers[i]) ? d.answers[i] : []).map(Number).filter(v => v >= 0 && v < cfg.nopt).slice(0, cfg.nopt));
  const stu = d.studentId ? find_('Users', d.studentId) : null; if (d.studentId && (!stu || stu.role !== 'student')) throw err_('ไม่พบนักเรียน');
  const s = examScore_(key, set, answers), meta = JSON.stringify({ code: str_(d.code, 10), flags: (Array.isArray(d.flags) ? d.flags : []).slice(0, 200), by: ctx.user.id, manual: !!d.manual });
  const row = lock_(() => {
    const old = stu && d.single !== false ? rows_('ExamResults').find(x => x.examId === r.id && x.studentId === stu.id) : null; // ปิด "1 คนต่อ 1 ฉบับ" → เก็บได้หลายผล
    if (old && d.single !== false && !d.overwrite) throw err_('นักเรียนคนนี้มีผลสอบข้อสอบนี้แล้ว', 'EXISTS');
    if (old) { const hist = json_(old.history, []); hist.unshift({ at: old.updatedAt, score: old.score, answers: json_(old.answers, []), set: old.set, img: json_(old.img, null) }); 
      updateRow_('ExamResults', old, { set: set, answers: JSON.stringify(answers), score: String(s.score), max: String(s.max), meta: meta, history: JSON.stringify(hist.slice(0, 5)), updatedAt: now_() }); return Object.assign(old, { replaced: true }); }
    return insert_('ExamResults', { id: id_(), examId: r.id, ownerId: ctx.user.id, studentId: stu ? stu.id : '', code: str_(d.code, 10), set: set, answers: JSON.stringify(answers), score: String(s.score), max: String(s.max), img: '', meta: meta, history: '[]', createdAt: now_(), updatedAt: now_() });
  });
  let img = null, imgErr = '';
  if (d.img) { try { img = saveDataUrl_(ctx, d.img, (stu ? stu.studentCode + '_' : '') + 'scan_' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd_HHmmss') + '.jpg', 'กระดาษคำตอบ/' + cleanSeg_(r.name));
    if (img) lock_(() => { const x = find_('ExamResults', row.id); if (x) updateRow_('ExamResults', x, { img: JSON.stringify(img) }); }); } catch (e) { imgErr = e.message || String(e); } }
  return { id: row.id, score: s.score, max: s.max, right: s.right, replaced: !!row.replaced, img: img, imgError: imgErr };
}
function examResultUpdate_(ctx, id, d) {
  d = d || {}; const x = find_('ExamResults', id), r = x && find_('Exams', x.examId); if (!x || !exOwn_(ctx.user, r)) throw err_('ไม่พบผลสอบ', 'NOTFOUND');
  const cfg = examCfg_(json_(r.cfg, {})), key = examKeyClean_(json_(r.key, {}), cfg);
  return lock_(() => { const patch = { updatedAt: now_() };
    if (d.studentId !== undefined) { const st = d.studentId ? find_('Users', d.studentId) : null; if (d.studentId && (!st || st.role !== 'student')) throw err_('ไม่พบนักเรียน'); patch.studentId = st ? st.id : ''; }
    if (Array.isArray(d.answers)) { patch.answers = JSON.stringify(d.answers.slice(0, cfg.count).map(a => (Array.isArray(a) ? a : []).map(Number).filter(v => v >= 0 && v < cfg.nopt))); const s = examScore_(key, x.set || 'A', json_(patch.answers, [])); patch.score = String(s.score); patch.max = String(s.max); }
    if (d.score !== undefined && d.score !== '') { const sc = Number(d.score); if (!(sc >= 0)) throw err_('คะแนนไม่ถูกต้อง'); patch.score = String(r2_(sc)); }
    updateRow_('ExamResults', x, patch); return true; });
}
function examResultRemove_(ctx, id) { const x = find_('ExamResults', id), r = x && find_('Exams', x.examId); if (!x || !exOwn_(ctx.user, r)) throw err_('ไม่พบผลสอบ', 'NOTFOUND');
  return lock_(() => { trash_(json_(x.img, {}).id); deleteWhere_('ExamResults', y => y.id === x.id); return true; }); }
/** ผลสอบทุกข้อสอบ (หน้า Result) */
function examResults_(ctx) {
  const me = ctx.user, ex = {}; rows_('Exams').filter(r => exOwn_(me, r)).forEach(r => ex[r.id] = r);
  const us = {}; rows_('Users').forEach(u => us[u.id] = u);
  return rows_('ExamResults').filter(x => ex[x.examId]).map(x => { const u = us[x.studentId] || {}; return { id: x.id, examId: x.examId, exam: ex[x.examId].name, studentId: x.studentId, name: u.fullName ? (u.prefix || '') + u.fullName : '(ไม่ระบุ)', code: u.studentCode || x.code, no: u.classNo || '', grade: u.grade || '', room: u.room || '', score: Number(x.score) || 0, max: Number(x.max) || 0, at: x.updatedAt || x.createdAt, img: json_(x.img, null) }; });
}
/** เพิ่มชั้นเรียนครบทุกคู่ผสม ชั้น × ห้อง (ข้ามรายการซ้ำ) */
function classBulkAdd_(ctx, pairs) {
  const list = (Array.isArray(pairs) ? pairs : []).slice(0, 200).map(p => [str_(p && p[0], 20), str_(p && p[1], 20)]).filter(p => p[0]);
  return lock_(() => { const have = {}; rows_('Classes').forEach(c => have[c.grade + '|' + (c.room || '')] = 1); let n = 0, order = rows_('Classes').length;
    list.forEach(p => { const k = p[0] + '|' + p[1]; if (have[k]) return; have[k] = 1; insert_('Classes', { id: id_(), grade: p[0], room: p[1], order: String(++order), createdAt: now_() }); n++; });
    return { added: n, skipped: list.length - n }; });
}
/** ลบชั้นเรียน: ถ้ามีนักเรียน → ย้ายไปชั้น/ห้องอื่น หรือ ลบนักเรียนด้วย */
function classRemove2_(ctx, grade, room, mode, to) {
  grade = str_(grade, 20); room = str_(room, 20); const studs = rows_('Users').filter(u => u.role === 'student' && u.grade === grade && (u.room || '') === room);
  return lock_(() => {
    if (studs.length && mode === 'move') { const tg = str_(to && to[0], 20), tr = str_(to && to[1], 20); if (!tg) throw err_('กรุณาเลือกชั้น/ห้องปลายทาง'); studs.forEach(u => updateRow_('Users', u, { grade: tg, room: tr, updatedAt: now_() })); }
    else if (studs.length && mode === 'delete') { const ids = {}; studs.forEach(u => ids[u.id] = 1); deleteWhere_('Users', u => ids[u.id]); }
    else if (studs.length) throw err_('ชั้นเรียนนี้มีนักเรียน ' + studs.length + ' คน — เลือกย้ายหรือลบนักเรียนก่อน', 'HAS_STUDENTS');
    deleteWhere_('Classes', c => c.grade === grade && (c.room || '') === room); log_(ctx.user.id, 'class_del', grade + '/' + room + ' ' + (mode || '')); return { students: studs.length };
  });
}
/** ค่าตั้งของระบบสอบ (ต่อผู้ใช้) */
function examPrefs_(ctx, o) {
  o = o || {}; const b = (k, d) => o[k] === undefined ? d : !!o[k];
  const ex = { showExam: b('showExam', true), single: b('single', true), warnOver: b('warnOver', true), hideScore: b('hideScore', false), showKey: b('showKey', true), shutter: b('shutter', true), vibrate: b('vibrate', true), light: b('light', true),
    auto: b('auto', false), cont: b('cont', false), pass: Math.min(100, Math.max(0, Number(o.pass) || 50)), sd: o.sd === 'pop' ? 'pop' : 'sample', year: o.year === 'ad' ? 'ad' : 'be' };
  return lock_(() => { const u = staff_(ctx.user) ? allStaff_().find(x => x.id === ctx.user.id) : null; if (!u) throw err_('ไม่พบผู้ใช้');
    const p = json_(u.prefs, {}); p.exam = ex; updateRow_('Users', u, { prefs: JSON.stringify(p), updatedAt: now_() }); return ex; });
}

/* ---------- v5.8 ประวัติเครื่องมือครู (แยกภาคเรียน/ปีการศึกษา) ---------- */
const TOOL_IDS = ['qrcode', 'exam', 'wheel', 'topic', 'color', 'noise', 'letter', 'bomb', 'quizlive', 'survey'];
const tkey_ = () => { let k = ''; try { k = termDb_().key; } catch (e) {} return /^25\d\d\/[12]$/.test(k || '') ? k : curTermKey_(); };
function toolLogAdd_(ctx, tool, data) {
  tool = String(tool || ''); if (TOOL_IDS.indexOf(tool) < 0) throw err_('ไม่รู้จักเครื่องมือนี้');
  const js = JSON.stringify(data === undefined ? {} : data); if (js.length > 6000) throw err_('ข้อมูลยาวเกินไป');
  return lock_(() => {
    const term = tkey_(), row = insert_('ToolLogs', { id: id_(), ownerId: ctx.user.id, tool: tool, term: term, data: js, createdAt: now_() });
    const mine = rows_('ToolLogs').filter(r => r.ownerId === ctx.user.id && r.tool === tool && r.term === term);
    if (mine.length > 600) { const old = {}; mine.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).slice(0, mine.length - 500).forEach(r => old[r.id] = 1); deleteWhere_('ToolLogs', r => old[r.id]); }
    return { id: row.id, term: term };
  });
}
function toolLogList_(ctx, tool, term) {
  const run = () => { const k = tkey_();
    return { term: k, items: rows_('ToolLogs').filter(r => r.ownerId === ctx.user.id && (!tool || r.tool === tool) && r.term === k)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 300).map(r => ({ id: r.id, tool: r.tool, at: r.createdAt, data: json_(r.data, {}) })) }; };
  return term && /^25\d\d\/[12]$/.test(term) ? withTerm_(term, run) : run();
}
function toolLogClear_(ctx, tool, term) {
  const run = () => { const k = tkey_(); return lock_(() => { const n = rows_('ToolLogs').filter(r => r.ownerId === ctx.user.id && r.tool === tool && r.term === k).length;
    deleteWhere_('ToolLogs', r => r.ownerId === ctx.user.id && r.tool === tool && r.term === k); return { removed: n }; }); };
  return term && /^25\d\d\/[12]$/.test(term) ? withTerm_(term, run) : run();
}
/** v5.7 นักเรียน: ผลการเรียนรายบุคคลทุกรายวิชา (จากแหล่งคะแนนที่ตั้งค่าไว้) */
function myScores_(ctx) {
  const u = ctx.user;
  const t = u.role === 'student' ? totalScore_(u) : null, cs = {}; rows_('Courses').forEach(c => cs[c.id] = c);
  let tk = ''; try { tk = termDb_().key; } catch (e) {} if (!/^25\d\d\/[12]$/.test(tk || '')) tk = curTermKey_();
  const items = (t ? (t.items || [t]) : []).map(x => Object.assign({}, x, { course: (x.courseIds || []).map(c => (cs[c] || {}).name).filter(Boolean).join(', ') }));
  return { term: tk, student: { classNo: u.classNo || '', code: u.studentCode, name: (u.prefix || '') + u.fullName, grade: u.grade, room: u.room }, items: items };
}
function studentHome_(ctx, view) {
  const vf = viewFilters_(view), u = ctx.user, courses = courseCards_(u).filter(vf.c), prog = myProgress_(u.id);
  const asg = assignmentsFor_(u).filter(vf.a);
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
    term: term_(), view: vf.vt, past: vf.past, total: (() => { try { return totalScore_(u); } catch (e) { return null; } })()
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
/** จำนวนสมาชิกสูงสุดของกลุ่ม (รวมตัวแทน) — ครูกำหนดได้ 2–50 · ไม่กำหนด = 16 */
const groupMax_ = a => { const n = Math.floor(Number(a && a.groupMax)); return n >= 2 && n <= 50 ? n : 16; };
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
    if (q.time !== undefined && q.time !== '') { const tm = Math.round(Number(q.time)); if (tm >= 5 && tm <= 600) out.time = tm; } // เวลารายข้อ (วินาที) สำหรับกิจกรรมตอบปัญหา
    if (!out.q) throw err_(n + 'กรุณาพิมพ์คำถาม');
    // สื่อประกอบคำถาม: รูป ลิงก์ ไฟล์
    const img = str_(q.image, 48000); if (img && imgOk_(img)) out.image = img;
    const link = str_(q.link, 500); if (link && /^https?:\/\//.test(link)) out.link = link;
    const files = cleanFiles_(q.files || []); if (files.length) out.files = files.slice(0, 5);
    if (type === 'mc') {
      out.options = (Array.isArray(q.options) ? q.options : []).map(x => str_(x, 500)).slice(0, 10);
      // สื่อประกอบตัวเลือก (รูป / ไฟล์ เช่น PDF / ลิงก์) — ตัวเลือกที่มีสื่อเว้นข้อความได้
      const om = (Array.isArray(q.om) ? q.om : []).slice(0, out.options.length).map(m => { m = m || {}; const o2 = {};
        const im = str_(m.img, 48000); if (im && imgOk_(im)) o2.img = im;
        const lk = str_(m.link, 500); if (lk && /^https?:\/\//.test(lk)) o2.link = lk;
        const fl = cleanFiles_(m.file ? [m.file] : []); if (fl.length) o2.file = fl[0];
        return o2; });
      if (om.some(m => Object.keys(m).length)) { while (om.length < out.options.length) om.push({}); out.om = om; }
      if (out.options.length < 2 || out.options.some((x, j) => !x && !(om[j] && Object.keys(om[j]).length))) throw err_(n + 'ตัวเลือกต้องมีอย่างน้อย 2 ข้อและห้ามว่าง (ใส่ข้อความ หรือแนบรูป/ไฟล์/ลิงก์)');
      if (q.multi) { // ตอบได้มากกว่า 1 ข้อ
        const arr = (Array.isArray(q.answer) ? q.answer : [q.answer]).map(Number).filter((a, i, l) => a >= 0 && a < out.options.length && l.indexOf(a) === i).sort();
        if (!arr.length) throw err_(n + 'กรุณาเลือกคำตอบที่ถูกอย่างน้อย 1 ข้อ');
        out.multi = true; out.answer = arr;
      } else {
        const a = Number(q.answer); if (!(a >= 0 && a < out.options.length) || q.answer === '' || q.answer === null) throw err_(n + 'กรุณาเลือกคำตอบที่ถูกต้อง');
        out.answer = a;
      }
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
    ['image', 'link', 'files'].forEach(k => { if (x[k]) o[k] = x[k]; });
    if (x.time) o.time = x.time;
    if (x.type === 'mc') { o.options = x.options; if (x.om) o.om = x.om; if (x.multi) o.multi = true; }
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
    if (x.type === 'mc' && x.multi) { // ถูกได้คะแนน · เลือกผิดหักคะแนน (ไม่ต่ำกว่า 0)
      const sel = (Array.isArray(a) ? a : []).map(Number), right = sel.filter(v => x.answer.indexOf(v) >= 0).length, wrong = sel.length - right;
      scores[x.id] = r2_(x.points * Math.max(0, right - wrong) / x.answer.length);
    } else if (x.type === 'mc') scores[x.id] = String(a) === String(x.answer) ? x.points : 0;
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
    else if (x.type === 'mc' && x.multi) o[x.id] = (Array.isArray(a) ? a : [a]).map(v => str_(v, 3)).slice(0, 10);
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
      members = d.members.map(String).filter((m, i, arr) => arr.indexOf(m) === i && m !== u.id);
      const gmax = groupMax_(a); if (members.length + 1 > gmax) throw err_('กลุ่มนี้มีสมาชิกได้ไม่เกิน ' + gmax + ' คน (รวมตัวแทนกลุ่ม)');
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
      if (added.length) notifyUsers_(added, 'คุณถูกเพิ่มเข้ากลุ่มงาน', u.fullName + ' เพิ่มคุณในกลุ่ม "' + a.title + '"', 'assignment:' + a.id);
      log_(u.id, 'edit_submission', a.id);
      notifyUsers_(teachersOf_(a), 'นักเรียนแก้ไขงานที่ส่ง', u.fullName + ' แก้ไข "' + a.title + '"', 'grade:' + a.id + ':' + s.id);
      return subPub_(s, u.id);
    }
    const n = insert_('Submissions', Object.assign({ id: id_(), assignmentId: a.id, ownerId: u.id, text: text, files: files, driveLink: link,
      status: late ? 'late' : 'ontime', submittedAt: now_(), score: '', feedback: '', history: '[]', updatedAt: now_(), members: members }, qPatch));
    log_(u.id, 'submit', a.id);
    if (added.length) notifyUsers_(added, 'คุณถูกเพิ่มเข้ากลุ่มงาน', u.fullName + ' เพิ่มคุณในกลุ่ม "' + a.title + '"', 'assignment:' + a.id);
    notifyUsers_(teachersOf_(a), 'มีงานส่งใหม่', u.fullName + ' ส่ง "' + a.title + '"' + (late ? ' (ส่งช้า)' : ''), 'grade:' + a.id + ':' + n.id);
    return subPub_(n, u.id);
  });
}
/** ครูที่ควรได้รับแจ้งเตือนงานส่ง: ผู้สร้างงาน + เจ้าของ/ครูร่วมของรายวิชา */
function teachersOf_(a) {
  const c = find_('Courses', a.courseId) || {}, ids = [a.ownerId, c.ownerId].concat(String(c.teachers || '').split(','));
  return ids.filter((x, i, arr) => x && arr.indexOf(x) === i && allStaff_().some(t => t.id === x && t.status === 'active'));
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
/** ครู: แก้ไขรายละเอียดงานที่นักเรียนส่ง (ข้อความ ลิงก์ ไฟล์ สมาชิกกลุ่ม) */
function editSubmission_(ctx, subId, d) {
  d = d || {};
  return lock_(() => {
    delete MEM_.Submissions;
    const s = find_('Submissions', subId); if (!s) throw err_('ไม่พบงานที่ส่ง');
    const a = find_('Assignments', s.assignmentId);
    if (!a || !ownCourse_(ctx.user, a.courseId)) throw err_('คุณไม่มีสิทธิ์แก้ไขงานของรายวิชานี้', 'FORBIDDEN');
    const patch = { updatedAt: now_() };
    if (d.text !== undefined) patch.text = str_(d.text, 20000);
    if (d.driveLink !== undefined) { const l = str_(d.driveLink, 500); if (l && !/^https?:\/\//.test(l)) throw err_('ลิงก์ไม่ถูกต้อง'); patch.driveLink = l; }
    if (d.files !== undefined) { const f = cleanFiles_(d.files); purge_(fileIds_({ files: s.files }).filter(id => fileIds_({ files: f }).indexOf(id) < 0)); patch.files = f; }
    if (d.members !== undefined && isGroup_(a)) {
      const m = (Array.isArray(d.members) ? d.members : []).map(String).filter((x, i, l) => x && x !== s.ownerId && l.indexOf(x) === i);
      if (m.length + 1 > groupMax_(a)) throw err_('กลุ่มนี้มีสมาชิกได้ไม่เกิน ' + groupMax_(a) + ' คน');
      const other = rows_('Submissions').find(x => x.assignmentId === a.id && x.id !== s.id && m.some(id => inSub_(x, id)));
      if (other) throw err_('มีสมาชิกที่อยู่ในกลุ่มอื่นแล้ว');
      patch.members = m;
    }
    if (d.status !== undefined && ['ontime', 'late'].indexOf(d.status) >= 0) patch.status = d.status;
    const hist = json_(s.history, []); hist.push({ at: s.updatedAt || s.submittedAt, text: s.text, files: json_(s.files, []).length, link: s.driveLink, by: 'teacher' }); patch.history = hist.slice(-20);
    updateRow_('Submissions', s, patch);
    log_(ctx.user.id, 'teacher_edit_submission', s.id);
    return pub_(s);
  });
}
/** ครู: ลบงานที่นักเรียนส่ง (ไฟล์ใน Drive ถูกลบด้วย) — นักเรียนส่งใหม่ได้ */
function removeSubmission_(ctx, subId) {
  return lock_(() => {
    delete MEM_.Submissions;
    const s = find_('Submissions', subId); if (!s) throw err_('ไม่พบงานที่ส่ง');
    const a = find_('Assignments', s.assignmentId);
    if (!a || !ownCourse_(ctx.user, a.courseId)) throw err_('คุณไม่มีสิทธิ์ลบงานของรายวิชานี้', 'FORBIDDEN');
    purge_(fileIds_(s));
    deleteWhere_('Submissions', x => x.id === s.id);
    notifyUsers_([s.ownerId].concat(members_(s)), 'ครูลบงานที่ส่ง', 'งาน "' + a.title + '" ถูกลบ กรุณาส่งใหม่', 'assignment:' + a.id);
    log_(ctx.user.id, 'teacher_remove_submission', s.id);
    return true;
  });
}
/** แอดมิน: เปลี่ยนชื่อระดับชั้น/ห้อง — อัปเดตนักเรียนในชั้น/ห้องนั้นให้ด้วย */
function renameClass_(ctx, d) {
  d = d || {};
  const og = str_(d.grade, 30), orr = str_(d.room, 30), ng = cleanSeg_(str_(d.newGrade, 30)), nr = cleanSeg_(str_(d.newRoom, 30));
  if (!og || !ng) throw err_('กรุณาระบุระดับชั้น');
  return lock_(() => {
    delete MEM_.Users; delete MEM_.Classes;
    let nu = 0;
    rows_('Users').forEach(u => { if (u.role === 'student' && u.grade === og && (d.room === undefined || u.room === orr)) { updateRow_('Users', u, d.room === undefined ? { grade: ng } : { grade: ng, room: nr }); nu++; } });
    rows_('Classes').forEach(c => { if (c.grade === og && (d.room === undefined || (c.room || '') === orr)) updateRow_('Classes', c, d.room === undefined ? { grade: ng } : { grade: ng, room: nr }); });
    // รวมรายการซ้ำหลังเปลี่ยนชื่อ
    const seen = {}; deleteWhere_('Classes', c => { const k = c.grade + '|' + (c.room || ''); if (seen[k]) return true; seen[k] = 1; return false; });
    log_(ctx.user.id, 'rename_class', og + '/' + orr + ' → ' + ng + '/' + nr);
    return { students: nu };
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
  const root = segs[0] === 'Backups' || (segs[0] === 'รูปภาพ' && /โปรไฟล์|โลโก้/.test(segs[1] || '')) ? coreDriveId_() : driveId_(); // ไฟล์ส่วนกลางอยู่โฟลเดอร์หลักเสมอ
  const key = 'fd_' + root + '_' + segs.join('/'), cached = cache_().get(key);
  if (cached) { try { return DriveApp.getFolderById(cached); } catch (e) {} }
  let f = DriveApp.getFolderById(root);
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
  const origin = /^https:\/\/[\w.-]+(:\d+)?$/.test(String(f.origin || '')) ? String(f.origin) : '';
  const hdr = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) };
  if (origin) hdr.Origin = origin; // ให้เบราว์เซอร์อัปโหลดตรงเข้า Google Drive ได้ (เร็วกว่าส่งผ่าน Apps Script มาก)
  const res = UrlFetchApp.fetch(DRIVE_API + '/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size', {
    method: 'post', contentType: 'application/json; charset=UTF-8', muteHttpExceptions: true,
    headers: hdr,
    payload: JSON.stringify({ name: name, parents: [folder.getId()], description: 'cp:' + ctx.user.id }) });
  const h = res.getHeaders(), loc = h.Location || h.location;
  if (res.getResponseCode() !== 200 || !loc) throw err_('เริ่มอัปโหลดไม่สำเร็จ (' + res.getResponseCode() + ')');
  const uploadId = id_();
  cache_().put('up_' + uploadId, JSON.stringify({ u: ctx.user.id, loc: loc, size: size, name: name, mime: mime }), 21600);
  return { uploadId: uploadId, chunk: CHUNK_BYTES, direct: origin ? loc : '' };
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
/** หลังเบราว์เซอร์อัปโหลดตรงเข้า Drive เสร็จ: ตรวจว่าเป็นไฟล์ของผู้ใช้คนนี้ แล้วตั้งค่าการแชร์ */
function uploadFinish_(ctx, uploadId, fileId) {
  const s = json_(cache_().get('up_' + uploadId), null);
  if (!s || s.u !== ctx.user.id) throw err_('ไม่พบรายการอัปโหลด กรุณาเริ่มใหม่');
  const file = DriveApp.getFileById(str_(fileId, 100));
  if (String(file.getDescription() || '') !== 'cp:' + ctx.user.id) throw err_('ไฟล์ไม่ถูกต้อง');
  cache_().remove('up_' + uploadId);
  const shared = share_(file);
  log_(ctx.user.id, 'upload', s.name);
  return fileOut_(file.getId(), s.name, file.getMimeType() || s.mime, file.getSize() || s.size, shared);
}
/* ---------- ลบไฟล์ใน Drive อัตโนมัติ (เฉพาะไฟล์ที่ระบบอัปโหลดเอง: description ขึ้นต้น "cp:") ---------- */
function driveIdOf_(url) { const m = String(url || '').match(/(?:\/d\/|[?&]id=|^drive:)([-\w]{20,})/); return m ? m[1] : ''; }
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
  if (entity === 'Courses') return teaches_(u, r);
  if (entity === 'Announcements') return r.courseId ? String(r.courseId).split(',').every(c => ownCourse_(u, c)) : r.ownerId === u.id;
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
  if (data.groupMax !== undefined) { const n = Math.floor(Number(data.groupMax)); if (data.groupMax !== '' && !(n >= 2 && n <= 50)) throw err_('จำนวนสมาชิกต่อกลุ่มต้องอยู่ระหว่าง 2–50 คน'); data.groupMax = data.groupMax === '' ? '' : String(n); }
  if (entity === 'Announcements' && data.courseId !== undefined) data.courseId = String(data.courseId).split(',').map(x => x.trim()).filter((x, i, l) => x && l.indexOf(x) === i).slice(0, 30).join(',');
  if (data.quiz !== undefined) { const q = quiz_(data.quiz); data.quiz = q ? JSON.stringify(q) : ''; if (q && q.total > 0) data.maxScore = String(q.total); }
  if (!isAdmin_(me)) {
    delete data.ownerId;
    if (data.courseId && String(data.courseId).split(',').some(c => !ownCourse_(me, c))) throw err_('คุณไม่ใช่ครูผู้สอนของรายวิชานี้', 'FORBIDDEN');
    if (obj.id) { const old = find_(entity, obj.id); if (old && !rowOwned_(me, entity, old)) throw err_('คุณไม่มีสิทธิ์แก้ไขข้อมูลนี้', 'FORBIDDEN'); }
    if (entity === 'Courses' && obj.id) { const old = find_('Courses', obj.id); if (old && old.ownerId !== me.id) delete data.teachers; } // ครูร่วมสอนแก้รายชื่อครูไม่ได้
  } else if (entity === 'Courses' && data.ownerId === '') delete data.ownerId;
  else if (entity === 'Courses' && data.ownerId) {
    const t = find_('Users', data.ownerId); if (!t || !staff_(t)) throw err_('ครูผู้สอนไม่ถูกต้อง');
  }
  (REQUIRED[entity] || []).forEach(k => { if (!obj.id && !String(data[k] || '').trim()) throw err_('กรุณากรอกข้อมูลให้ครบ (' + k + ')'); });
  ['attachments', 'links'].forEach(k => { if (data[k] !== undefined) data[k] = k === 'links' ? (Array.isArray(data[k]) ? data[k] : json_(data[k], [])).filter(x => /^https?:\/\//.test(x.url)).slice(0, 30) : cleanFiles_(Array.isArray(data[k]) ? data[k] : json_(data[k], [])); });
  if (data.maxScore !== undefined && !(Number(data.maxScore) > 0)) throw err_('คะแนนเต็มต้องมากกว่า 0');
  ['dueAt', 'publishAt', 'closeAt'].forEach(k => { if (data[k]) data[k] = dt_(data[k]); });
  if (data.publishAt && data.closeAt && data.closeAt <= data.publishAt) throw err_('วันปิดการเข้าถึงต้องหลังวันเผยแพร่');
  if (data.courseId && String(data.courseId).split(',').some(c => !find_('Courses', c))) throw err_('ไม่พบรายวิชา');
  if (entity === 'Courses' && data.teachers !== undefined) {
    data.teachers = String(Array.isArray(data.teachers) ? data.teachers.join(',') : data.teachers).split(',').map(x => x.trim())
      .filter((x, i, a) => x && a.indexOf(x) === i && staff_(find_('Users', x) || {})).slice(0, 20).join(',');
  }
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
      if (entity === 'Announcements') broadcast_(row.courseId ? (() => { const seen = {}, out = []; row.courseId.split(',').forEach(c => studentsFor_(row.grade, row.room, c).forEach(x => { if (!seen[x.id]) { seen[x.id] = 1; out.push(x); } })); return out; })() : studentsFor_(row.grade, row.room, ''), (row.type || 'ประกาศ') + ': ' + row.title, str_(row.body, 200), 'announcement:' + row.id);
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
    if (entity === 'Courses' && !isAdmin_(ctx.user) && row.ownerId !== ctx.user.id) throw err_('ลบรายวิชาได้เฉพาะครูเจ้าของรายวิชาหรือผู้ดูแลระบบ', 'FORBIDDEN');
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
/** ให้/ถอนสิทธิ์ผู้ดูแลระบบร่วมแก่ครู (เฉพาะผู้ดูแลระบบหลัก) */
function setCoAdmin_(ctx, id, on, mode) {
  if (!ownerAdmin_(ctx.user)) throw err_('เฉพาะผู้ดูแลระบบหลัก (admin) เท่านั้น', 'FORBIDDEN');
  return lock_(() => {
    const u = find_('Users', id);
    if (!u || u.role !== 'teacher' || u.id === ctx.user.id) throw err_('กำหนดได้เฉพาะครูผู้สอน');
    // mode 'separate' = ผู้ดูแลระบบคนใหม่ ใช้ฐานข้อมูลของตนเอง (ต้องตั้ง Google Sheet + Drive ใหม่) — ข้อมูลทั้งหมดแยกจากเดิม
    const sep = !!on && mode === 'separate';
    const patch = { coAdmin: on ? 'true' : '', updatedAt: now_() };
    if (sep) patch.tenant = u.id; else if (!on && u.tenant === u.id) patch.tenant = tenant_().id;
    updateRow_('Users', u, patch);
    killSessions_(u.id);
    log_(ctx.user.id, 'co_admin', { id: id, on: !!on, mode: sep ? 'separate' : 'shared' });
    return pub_(u);
  });
}
/** นักเรียน: ผู้ดูแลระบบ + ครูที่สอนรายวิชาของตน (รูป + ชื่อ เท่านั้น) */
function myTeacherList_(u) {
  const users = rows_('Users'), courses = rows_('Courses').filter(c => courseOk_(u, c)), out = [], seen = {};
  const add = (x, subj) => { if (!x || x.status !== 'active' || !staff_(x)) return; if (!seen[x.id]) { seen[x.id] = { id: x.id, name: x.prefix + x.fullName, avatar: x.avatar || '', role: isAdmin_(x) ? 'admin' : 'teacher', subjects: [] }; out.push(seen[x.id]); }
    if (subj && seen[x.id].subjects.indexOf(subj) < 0) seen[x.id].subjects.push(subj); };
  courses.forEach(c => [c.ownerId].concat(String(c.teachers || '').split(',')).filter(Boolean).forEach(id => add(users.find(x => x.id === id), (c.code ? c.code + ' ' : '') + c.name)));
  users.filter(x => isAdmin_(x)).forEach(x => add(x, ''));
  return out.sort((a, b) => (a.role === 'admin') - (b.role === 'admin'));
}
function myTeachers_(ctx) { return myTeacherList_(ctx.user); }
/** ช่องทางการติดต่อของครู/ผู้ดูแลระบบ — นักเรียนต้องยืนยันรหัสนักเรียนอีกครั้ง */
function staffContact_(ctx, staffId, code) {
  const u = ctx.user;
  if (u.role === 'student') {
    const done = throttle_('sc_' + u.id, 5, 10);
    if (str_(code, 5) !== u.studentCode) { done(); throw err_('รหัสนักเรียนไม่ถูกต้อง'); }
    if (!myTeacherList_(u).some(t => t.id === staffId)) throw err_('ไม่พบข้อมูล', 'FORBIDDEN');
  } else if (!staff_(u)) throw err_('ไม่มีสิทธิ์', 'FORBIDDEN');
  const t = find_('Users', staffId);
  if (!t || !staff_(t)) throw err_('ไม่พบข้อมูล');
  return { name: t.prefix + t.fullName, email: t.email || '', contacts: json_(t.contacts, []) };
}
function listTeachers_() { return rows_('Users').filter(u => staff_(u) && u.status === 'active').map(u => ({ id: u.id, name: u.prefix + u.fullName, role: u.role })); }
function acadYear_(v) { v = str_(v, 4); if (v && !/^25\d\d$/.test(v)) throw err_('ปีการศึกษาต้องเป็น พ.ศ. 4 หลัก เช่น 2569'); return v; }
function saveUser_(ctx, d) {
  d = d || {};
  return lock_(() => {
    const isNew = !d.id, u = isNew ? null : find_('Users', d.id), adm = isAdmin_(ctx.user);
    if (!isNew && !u) throw err_('ไม่พบผู้ใช้');
    const role = isNew ? (adm && (d.role === 'teacher' || d.role === 'admin') ? 'teacher' : 'student') : u.role;
    if (!adm && role !== 'student') throw err_('ครูผู้สอนเพิ่ม/แก้ไขได้เฉพาะข้อมูลนักเรียน', 'FORBIDDEN');
    if (d.contacts !== undefined) d.contacts = contacts_(d.contacts);
    const patch = { updatedAt: now_() };
    ['prefix', 'fullName', 'birthDate', 'grade', 'room', 'email', 'nickname'].forEach(k => { if (d[k] !== undefined) patch[k] = str_(d[k], 100); });
    if (d.contacts !== undefined) patch.contacts = d.contacts;
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
    if (isNew && role !== 'student') patch.tenant = tenant_().id; // ครูที่เพิ่มอยู่ในฐานข้อมูลของผู้ดูแลระบบที่เพิ่ม
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
    killSessions_(id);
    purgeRows_('Submissions', s => s.ownerId === id); purge_(fileIds_(u));
    const counts = { Submissions: deleteWhere_('Submissions', s => s.ownerId === id), Progress: deleteWhere_('Progress', p => p.ownerId === id),
      Notifications: deleteWhere_('Notifications', n => n.ownerId === id) };
    deleteWhere_('Users', x => x.id === id);
    log_(ctx.user.id, 'delete_user', { id: id, name: u.fullName, cascade: counts });
    return counts;
  });
}
/** ลบนักเรียนหลายคนพร้อมกัน: {ids:[...]} หรือ {all:true} หรือ {grade, room} — ลบงานที่ส่ง/ความก้าวหน้า/การแจ้งเตือนด้วย */
function deleteUsers_(ctx, d) {
  d = d || {};
  return lock_(() => {
    const ids = {};
    rows_('Users').forEach(u => { if (u.role !== 'student') return;
      if (d.all === true || (Array.isArray(d.ids) && d.ids.indexOf(u.id) >= 0) || (d.grade && u.grade === String(d.grade) && (d.room === undefined || d.room === null || String(d.room) === '*' || (u.room || '') === String(d.room)))) ids[u.id] = u; });
    const list = Object.keys(ids); if (!list.length) throw err_('ไม่พบนักเรียนที่เลือก');
    if (d.confirm !== (Array.isArray(d.ids) ? d.ids.length : list.length)) throw err_('จำนวนที่ยืนยันไม่ตรงกับจำนวนนักเรียน (' + list.length + ' คน)', 'CONFIRM');
    const has = x => !!ids[x];
    const cache = CacheService.getScriptCache(); rows_('Sessions').filter(x => has(x.userId)).forEach(x => cache.remove('s_' + x.tokenHash)); deleteWhere_('Sessions', x => has(x.userId));
    purgeRows_('Submissions', x => has(x.ownerId)); purge_([].concat.apply([], list.map(id => fileIds_(ids[id]))));
    const counts = { Users: list.length, Submissions: deleteWhere_('Submissions', x => has(x.ownerId)), Progress: deleteWhere_('Progress', x => has(x.ownerId)),
      Notifications: deleteWhere_('Notifications', x => has(x.ownerId)) };
    deleteWhere_('Users', x => has(x.id));
    log_(ctx.user.id, 'delete_users', { scope: d.all ? 'all' : d.grade ? d.grade + '/' + (d.room || '*') : 'selected', cascade: counts });
    return counts;
  });
}
/** สลับบทบาท ครูผู้สอน ↔ นักเรียน (ผู้ดูแลระบบมีคนเดียว เปลี่ยนไม่ได้) */
/** แก้บัญชี — ถ้าบทบาทเปลี่ยนแล้วต้องย้ายไฟล์ (ครู = ไฟล์หลัก, นักเรียน = ฐานข้อมูล/ภาคเรียน) ให้ย้ายแถว */
function patchUser_(u, patch) {
  const nu = Object.assign({}, u, patch), from = u._db || partOf_('Users', u), to = partOf_('Users', nu);
  if (from === to || ssPart_(from).getId() === ssPart_(to).getId()) return updateRow_('Users', u, patch);
  const id = u.id; deleteWhere_('Users', x => x.id === id && (x._db || partOf_('Users', x)) === from);
  delete nu._r; delete nu._db; return insert_('Users', nu);
}
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
      patchUser_(u, { role: 'teacher', username: un, passSalt: salt, passHash: hashPw_(pw, salt), mustChangePassword: 'true', tenant: tenant_().id, updatedAt: now_() });
    } else if (role === 'student') {
      if (u.id === ctx.user.id) throw err_('ลดสิทธิ์บัญชีที่กำลังใช้งานอยู่ไม่ได้');
      const code = str_(extra.studentCode || u.studentCode, 5);
      if (!/^\d{5}$/.test(code)) throw err_('กรุณากำหนดรหัสนักเรียน 5 หลัก');
      if (codeTaken_(code, id)) throw err_('รหัสนักเรียนนี้ถูกใช้แล้ว');
      patchUser_(u, { role: 'student', studentCode: code, coAdmin: '', updatedAt: now_() });
    } else throw err_('สิทธิ์ไม่ถูกต้อง');
    killSessions_(id);
    log_(ctx.user.id, 'set_role', { id: id, role: role });
    return pub_(find_('Users', id) || u);
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
  const cs = rows_('Courses').filter(c => teaches_(u, c));
  return studs.filter(x => cs.some(c => inList_(c.grade, x.grade) && inList_(c.room, x.room)));
}
/** ช่วงวันที่ของภาคเรียน (ค.ศ.) — ภาค 1: 16 พ.ค.–20 ต.ค. · ภาค 2: 21 ต.ค.–15 พ.ค. ปีถัดไป */
function termSpan_(t) { const y = Number(t.year) - 543; return t.term === '1' ? [y + '-05-16', y + '-10-20'] : [y + '-10-21', (y + 1) + '-05-15']; }
function termKeyOf_(v) { const d = v ? new Date(String(v).replace(' ', 'T')) : null; const t = term_(d && !isNaN(d) ? d : new Date()); return t.year + '/' + t.term; }
function adminDashboard_(ctx, view) {
  const me = ctx.user, admin = isAdmin_(me), users = rows_('Users');
  const cur = term_(), vt = view && /^25\d\d$/.test(String(view.year)) && /^[12]$/.test(String(view.term)) ? { year: String(view.year), term: String(view.term) } : null;
  const past = vt && (vt.year + '/' + vt.term) !== (cur.year + '/' + cur.term), key = vt ? vt.year + '/' + vt.term : '';
  let d = days_(7);
  if (past) { const end = new Date(termSpan_(vt)[1] + 'T12:00:00'); d = []; for (let i = 6; i >= 0; i--) d.push(Utilities.formatDate(new Date(end.getTime() - i * 864e5), TZ, 'yyyy-MM-dd')); }
  const count = (list, field) => d.map(day => list.filter(x => String(x[field]).slice(0, 10) === day).length);
  const cIn = c => !vt || (c.acadYear ? (c.term ? c.acadYear + '/' + c.term === key : String(c.acadYear) === vt.year) : (!past || termKeyOf_(c.createdAt) === key));
  const aIn = a => !vt || termKeyOf_(a.createdAt) === key || (a.dueAt && termKeyOf_(a.dueAt) === key);
  const courses = rows_('Courses').filter(c => courseOk_(me, c) && cIn(c)), cid = {}; courses.forEach(c => cid[c.id] = 1);
  const asg = rows_('Assignments').filter(a => cid[a.courseId] && aIn(a)), aid = {}; asg.forEach(a => aid[a.id] = 1);
  const subs = rows_('Submissions').filter(s => aid[s.assignmentId]);
  const studs = myStudents_(me).filter(u => !vt || (u.acadYear ? String(u.acadYear) === vt.year : !past)), sid = {}; studs.forEach(u => sid[u.id] = 1);
  const lessons = rows_('Lessons').filter(l => cid[l.courseId]), lid = {}; lessons.forEach(l => lid[l.id] = 1);
  const logs = rows_('AuditLog').filter(l => admin || sid[l.userId] || l.userId === me.id);
  return {
    role: me.role, term: cur, view: vt, past: !!past,
    cards: { announcements: rows_('Announcements').filter(a => rowOwned_(me, 'Announcements', a)).length, courses: courses.length, lessons: lessons.length, students: studs.length,
      ungraded: subs.filter(s => s.score === '').length, assignments: asg.length, pendingUsers: admin ? users.filter(u => u.status === 'pending').length : 0,
      teachers: admin ? users.filter(u => u.role === 'teacher').length : 0 },
    days: d, logins: count(logs.filter(l => l.action === 'login'), 'createdAt'), views: count(logs.filter(l => l.action === 'view_lesson' && (admin || lid[l.detail])), 'createdAt'),
    submissions: count(subs, 'submittedAt'),
    sub7: (() => { // v6.0 สถานะการส่งงานในช่วง 7 วัน (งานที่ครบกำหนดในช่วงนี้ + งานที่ส่งเข้ามาในช่วงนี้)
      const d0 = d[0], d1 = d[d.length - 1], inW = v => { const x = String(v || '').slice(0, 10); return x >= d0 && x <= d1; };
      const sw = subs.filter(s => inW(s.submittedAt)), o = { graded: 0, ontime: 0, late: 0, missing: 0 };
      sw.forEach(s => { if (s.score !== '') o.graded++; else if (s.status === 'late') o.late++; else o.ontime++; });
      asg.filter(a => inW(a.dueAt)).forEach(a => { let st = []; try { st = studentsFor_(a.grade, a.room, a.courseId); } catch (e) {}
        const got = {}; subs.filter(s => s.assignmentId === a.id).forEach(s => [s.ownerId].concat(members_(s)).forEach(id => got[id] = 1));
        o.missing += st.filter(u => !got[u.id]).length; });
      return o; })(),
    status: { ontime: subs.filter(s => s.status === 'ontime').length, late: subs.filter(s => s.status === 'late').length, graded: subs.filter(s => s.score !== '').length },
    attToday: (() => { try { const a = attSummary_(ctx, ''); return { present: a.day.present + a.day.late, late: a.day.late, absent: a.day.absent + a.day.skip, sessions: a.sessions, day: a.day }; } catch (e) { return null; } })(),
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
      rows: users.map(u => { const l = logs.filter(x => x.userId === u.id && x.action === 'login'); return [u.studentCode, name(u), u.grade + '/' + u.room, l.length, l.length ? l[l.length - 1].createdAt : (u.lastLoginAt || '-')]; })
        .sort((a, b) => String(b[4] === '-' ? '' : b[4]).localeCompare(String(a[4] === '-' ? '' : a[4]))) }; // เข้าล่าสุดก่อน
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
  const page = Math.max(1, Number(f.page) || 1), size = 30;
  return { total: list.length, page: page, pages: Math.ceil(list.length / size), rows: list.slice((page - 1) * size, page * size) };
}

/* ============================== แชท ==============================
 * ห้องแชท 3 แบบ: dm (รายบุคคล) · class (รายห้อง ชั้น/ห้อง) · team (ทีม/กลุ่มที่สร้างเอง)
 * นักเรียน: คุยกับเพื่อนร่วมห้อง ครู และผู้ดูแลระบบ · ครู/ผู้ดูแลระบบ: คุยกับทุกคน ทุกห้อง
 */
const userName_ = u => u ? (u.prefix || '') + u.fullName : '-';
function canContact_(me, other) {
  if (!other || other.status !== 'active' || other.id === me.id) return false;
  if (staff_(me) || staff_(other)) return true;
  return other.role === 'student' && other.grade === me.grade && other.room === me.room; // นักเรียน ↔ เพื่อนร่วมห้อง
}
function canClass_(me, grade, room) { return staff_(me) || (me.grade === grade && me.room === room); }
function chatCan_(me, r) {
  if (!r) return false;
  if (r.type === 'class') return canClass_(me, r.grade, r.room);
  return json_(r.members, []).indexOf(me.id) >= 0;
}
function chatContacts_(ctx) {
  const me = ctx.user, users = rows_('Users');
  const people = users.filter(u => canContact_(me, u)).map(u => ({ id: u.id, name: userName_(u), role: u.role, grade: u.grade || '', room: u.room || '', classNo: u.classNo || '', nickname: u.nickname || '' }));
  const cls = {}; users.filter(u => u.role === 'student' && u.status === 'active' && u.grade).forEach(u => { if (canClass_(me, u.grade, u.room)) { const k = u.grade + '|' + (u.room || ''); cls[k] = (cls[k] || 0) + 1; } });
  return { people: people, classes: Object.keys(cls).map(k => ({ grade: k.split('|')[0], room: k.split('|')[1], count: cls[k] })) };
}
function chatTitle_(me, r, users) {
  if (r.type === 'class') return { title: 'ห้อง ' + r.grade + (r.room ? '/' + r.room : ''), sub: 'แชทรายห้อง' };
  if (r.type === 'team') return { title: r.name || 'ทีม', sub: 'ทีม · ' + json_(r.members, []).length + ' คน' };
  const other = users[json_(r.members, []).find(id => id !== me.id)];
  return { title: userName_(other), sub: other ? (other.role === 'student' ? 'นักเรียน ' + (other.grade || '') + (other.room ? '/' + other.room : '') : other.role === 'admin' ? 'ผู้ดูแลระบบ' : 'ครูผู้สอน') : '', otherRole: other ? other.role : '' };
}
function readsOf_(uid) { const m = {}; rows_('ChatReads').forEach(r => { if (r.userId === uid) m[r.roomId] = r.at; }); return m; }
function readRows_(uid) { const m = {}; rows_('ChatReads').forEach(r => { if (r.userId === uid) m[r.roomId] = r; }); return m; }
/** แถวสถานะของผู้ใช้ในห้อง (อ่านล่าสุด / ซ่อน / ชื่อที่ตั้งเอง) */
function readRow_(me, roomId, patch) {
  delete MEM_.ChatReads; const id = me.id + '|' + roomId, x = rows_('ChatReads').find(y => y.id === id);
  return x ? updateRow_('ChatReads', x, patch) : insert_('ChatReads', Object.assign({ id: id, userId: me.id, roomId: roomId, at: '', hidden: '', alias: '' }, patch));
}
function chatList_(ctx) {
  const me = ctx.user, users = {}; rows_('Users').forEach(u => users[u.id] = u);
  const reads = readsOf_(me.id), rr = readRows_(me.id), unread = {};
  const rooms = rows_('ChatRooms').filter(r => chatCan_(me, r)), ids = {}; rooms.forEach(r => ids[r.id] = 1);
  const lastKey = {}; rows_('ChatMessages').forEach(m => { if (ids[m.roomId]) lastKey[m.roomId] = m.id; });
  rows_('ChatMessages').forEach(m => { if (ids[m.roomId] && m.senderId !== me.id && (!reads[m.roomId] || m.createdAt > reads[m.roomId])) unread[m.roomId] = (unread[m.roomId] || 0) + 1; });
  const out = rooms.filter(r => { const h = rr[r.id] && rr[r.id].hidden; return !h || h !== 'm:' + (lastKey[r.id] || ''); }) // ห้องที่ลบออกจากรายการ กลับมาเมื่อมีข้อความใหม่
    .map(r => { const o = Object.assign({ id: r.id, type: r.type, canPurge: chatCanPurge_(me, r), lastText: r.lastText, lastAt: r.lastAt || r.createdAt, lastBy: r.lastBy ? userName_(users[r.lastBy]) : '', unread: unread[r.id] || 0 }, chatTitle_(me, r, users)); if (rr[r.id] && rr[r.id].alias) o.title = rr[r.id].alias; return o; });
  if (me.role === 'student' && me.grade && !out.some(r => r.type === 'class' && r.id === 'cls:' + me.grade + '|' + (me.room || '')) && (rr['cls:' + me.grade + '|' + (me.room || '')] || {}).hidden !== 'm:' + (lastKey['cls:' + me.grade + '|' + (me.room || '')] || '')) // ห้องของตัวเองแสดงเสมอ (ยกเว้นลบออกจากรายการ)
    out.push({ id: 'cls:' + me.grade + '|' + (me.room || ''), type: 'class', title: 'ห้อง ' + me.grade + (me.room ? '/' + me.room : ''), sub: 'แชทรายห้อง', lastText: '', lastAt: '', unread: 0, virtual: true });
  return out.sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
}
function chatUnread_(ctx) { return chatList_(ctx).reduce((t, r) => t + r.unread, 0); }
/** เปิด/สร้างห้อง: {type:'dm', target:userId} | {type:'class', grade, room} | {id} */
function chatOpen_(ctx, d) {
  d = d || {};
  const me = ctx.user;
  if (d.id && !/^cls:/.test(d.id)) { const r = find_('ChatRooms', d.id); if (!chatCan_(me, r)) throw err_('ไม่พบห้องแชท', 'FORBIDDEN'); return chatRoomOut_(me, r); }
  return lock_(() => {
    delete MEM_.ChatRooms;
    if (d.type === 'class' || /^cls:/.test(d.id || '')) {
      let g = str_(d.grade, 20), rm = str_(d.room, 20);
      if (d.id) { const k = String(d.id).slice(4).split('|'); g = k[0]; rm = k[1] || ''; }
      if (!g || !canClass_(me, g, rm)) throw err_('คุณไม่มีสิทธิ์เข้าห้องนี้', 'FORBIDDEN');
      const id = 'cls:' + g + '|' + rm;
      const r = find_('ChatRooms', id) || insert_('ChatRooms', { id: id, type: 'class', name: '', members: '[]', grade: g, room: rm, createdBy: me.id, createdAt: now_(), lastAt: '', lastText: '', lastBy: '' });
      return chatRoomOut_(me, r);
    }
    if (d.type === 'dm') {
      const other = find_('Users', d.target);
      if (!canContact_(me, other)) throw err_('ไม่สามารถแชทกับผู้ใช้นี้ได้', 'FORBIDDEN');
      const pair = [me.id, other.id].sort(), id = 'dm:' + pair.join(':');
      const r = find_('ChatRooms', id) || insert_('ChatRooms', { id: id, type: 'dm', name: '', members: pair, grade: '', room: '', createdBy: me.id, createdAt: now_(), lastAt: '', lastText: '', lastBy: '' });
      return chatRoomOut_(me, r);
    }
    throw err_('ประเภทห้องแชทไม่ถูกต้อง');
  });
}
function chatCreateTeam_(ctx, name, ids) {
  const me = ctx.user, nm = str_(name, 60);
  if (!nm) throw err_('กรุณาตั้งชื่อทีม');
  const members = [me.id].concat((Array.isArray(ids) ? ids : []).map(String)).filter((x, i, a) => a.indexOf(x) === i).slice(0, 60);
  if (members.length < 2) throw err_('กรุณาเลือกสมาชิกอย่างน้อย 1 คน');
  members.slice(1).forEach(id => { if (!canContact_(me, find_('Users', id))) throw err_('มีสมาชิกที่คุณไม่สามารถเพิ่มได้'); });
  return lock_(() => chatRoomOut_(me, insert_('ChatRooms', { id: 'team:' + id_(), type: 'team', name: nm, members: members, grade: '', room: '', createdBy: me.id, createdAt: now_(), lastAt: now_(), lastText: 'สร้างทีม "' + nm + '"', lastBy: me.id })));
}
function chatRoomOut_(me, r) {
  const users = {}; rows_('Users').forEach(u => users[u.id] = u);
  const o = Object.assign({ id: r.id, type: r.type, canPurge: chatCanPurge_(me, r) }, chatTitle_(me, r, users));
  const al = (rows_('ChatReads').find(x => x.id === me.id + '|' + r.id) || {}).alias; if (al) o.title = al;
  if (r.type === 'team') { const ids = json_(r.members, []); o.members = ids.map(id => userName_(users[id])); o.canRename = true; o.canManage = true;
    o.memberList = ids.map(id => { const u = users[id]; return { id: id, name: userName_(u), role: u ? u.role : '', grade: u ? u.grade || '' : '', room: u ? u.room || '' : '', me: id === me.id, owner: id === r.createdBy }; }); }
  return o;
}
/** แก้ไข/ลบ ข้อความ: ของตนเอง หรือของคู่สนทนา (แชทรายบุคคล/ทีม) · ห้องเรียน: ครู/ผู้ดูแลระบบจัดการได้ทุกข้อความ */
function msgCan_(me, m) {
  if (!m || m.deleted === 'true') return false;
  if (m.senderId === me.id || isAdmin_(me)) return true;
  const r = /^cls:/.test(m.roomId) ? { type: 'class', grade: m.roomId.slice(4).split('|')[0], room: m.roomId.slice(4).split('|')[1] || '' } : find_('ChatRooms', m.roomId);
  if (!chatCan_(me, r)) return false;
  return r.type === 'class' ? staff_(me) : true;
}
/** เพิ่ม/ลบ สมาชิกแชทกลุ่ม (สมาชิกในกลุ่มจัดการได้) */
function chatTeamMembers_(ctx, roomId, add, remove) {
  const me = ctx.user;
  return lock_(() => { delete MEM_.ChatRooms; const r = find_('ChatRooms', roomId);
    if (!r || r.type !== 'team' || !chatCan_(me, r)) throw err_('ไม่พบแชทกลุ่ม', 'FORBIDDEN');
    let ids = json_(r.members, []);
    (Array.isArray(add) ? add : []).map(String).forEach(id => { if (ids.indexOf(id) >= 0) return; if (!canContact_(me, find_('Users', id))) throw err_('มีสมาชิกที่คุณไม่สามารถเพิ่มได้'); ids.push(id); });
    const rm = (Array.isArray(remove) ? remove : []).map(String); ids = ids.filter(id => rm.indexOf(id) < 0).slice(0, 60);
    if (!ids.length) throw err_('แชทกลุ่มต้องมีสมาชิกอย่างน้อย 1 คน');
    const users = {}; rows_('Users').forEach(u => users[u.id] = u);
    const note = [].concat((add || []).filter(id => json_(r.members, []).indexOf(String(id)) < 0).map(id => 'เพิ่ม ' + userName_(users[id])), rm.filter(id => json_(r.members, []).indexOf(id) >= 0).map(id => (id === me.id ? 'ออกจากกลุ่ม: ' : 'นำออก ') + userName_(users[id]))).join(', ');
    updateRow_('ChatRooms', r, { members: ids, lastAt: now_(), lastText: (note || 'แก้ไขสมาชิก').slice(0, 120), lastBy: me.id });
    log_(me.id, 'chat_members', { room: r.id, add: add, remove: rm });
    return ids.indexOf(me.id) >= 0 ? chatRoomOut_(me, r) : { left: true };
  });
}
/** ข้อความในห้อง (หลัง after = createdAt|id ล่าสุดที่มี) + บันทึกว่าอ่านแล้ว */
function chatMessages_(ctx, roomId, after, since) {
  const me = ctx.user;
  const r = /^cls:/.test(roomId) ? (find_('ChatRooms', roomId) || (function () { const k = roomId.slice(4).split('|'); return { id: roomId, type: 'class', grade: k[0], room: k[1] || '' }; })()) : find_('ChatRooms', roomId);
  if (!chatCan_(me, r)) throw err_('ไม่พบห้องแชท', 'FORBIDDEN');
  const users = {}; rows_('Users').forEach(u => users[u.id] = u);
  let list = rows_('ChatMessages').filter(m => m.roomId === roomId);
  let upd = [];
  if (after) { const all = list, ix = all.findIndex(m => m.createdAt + '|' + m.id === after); list = ix >= 0 ? all.slice(ix + 1) : all.filter(m => m.createdAt > String(after).split('|')[0]);
    const sn = String(since || '') || String(after).split('|')[0]; upd = all.filter(m => m.editedAt && m.editedAt >= sn && list.indexOf(m) < 0).slice(-50); } // ข้อความที่ถูกแก้ไข/ลบหลังโหลดครั้งก่อน
  list = list.slice(-150);
  const last = list.length ? list[list.length - 1].createdAt : '';
  const rd = rows_('ChatReads').find(x => x.id === me.id + '|' + roomId);
  if (last && (!rd || rd.at < last)) lock_(() => { delete MEM_.ChatReads; const x = rows_('ChatReads').find(y => y.id === me.id + '|' + roomId);
    if (x) updateRow_('ChatReads', x, { at: last }); else insert_('ChatReads', { id: me.id + '|' + roomId, userId: me.id, roomId: roomId, at: last }); });
  const out = m => { const u = users[m.senderId]; return { id: m.id, key: m.createdAt + '|' + m.id, text: m.deleted === 'true' ? '' : m.text, files: m.deleted === 'true' ? [] : json_(m.files, []), edited: !!m.editedAt && m.deleted !== 'true', ed: m.editedAt || '', deleted: m.deleted === 'true', at: m.createdAt, mine: m.senderId === me.id, can: m.deleted !== 'true' && (m.senderId === me.id || isAdmin_(me) || (r.type === 'class' ? staff_(me) : true)), sender: userName_(u), role: u ? u.role : '' }; };
  return list.map(out).concat(upd.map(m => Object.assign(out(m), { upd: true })));
}
/** แก้ไข / ลบ ข้อความของตนเอง (ผู้ดูแลระบบลบได้ทุกข้อความ) */
function chatEdit_(ctx, msgId, text) {
  const me = ctx.user, t = str_(text, 1000); if (!t) throw err_('กรุณาพิมพ์ข้อความ');
  return lock_(() => { delete MEM_.ChatMessages; const m = find_('ChatMessages', msgId);
    if (!msgCan_(me, m)) throw err_('คุณไม่มีสิทธิ์แก้ไขข้อความนี้', 'FORBIDDEN');
    updateRow_('ChatMessages', m, { text: t, editedAt: now_() }); if (m.senderId !== me.id) log_(me.id, 'chat_edit_other', m.id); return true; });
}
function chatDelete_(ctx, msgId) {
  const me = ctx.user;
  return lock_(() => { delete MEM_.ChatMessages; const m = find_('ChatMessages', msgId);
    if (!msgCan_(me, m)) throw err_('คุณไม่มีสิทธิ์ลบข้อความนี้', 'FORBIDDEN');
    if (m.senderId !== me.id) log_(me.id, 'chat_delete_other', m.id);
    purge_(fileIds_({ files: m.files })); updateRow_('ChatMessages', m, { text: '', files: '[]', deleted: 'true', editedAt: now_() }); return true; });
}
/** ลบแชทถาวร (ทุกคนในห้องพิมพ์ต่อไม่ได้ ต้องเริ่มแชทใหม่): แชทรายบุคคล = คู่สนทนา · แชทกลุ่ม = ผู้สร้างกลุ่ม/ครู · ห้องเรียน = ครู/ผู้ดูแลระบบ */
function chatCanPurge_(me, r) { if (!r || !chatCan_(me, r)) return false; if (r.type === 'dm') return true; if (r.type === 'team') return r.createdBy === me.id || staff_(me); return staff_(me); }
function chatPurge_(ctx, roomId) {
  const me = ctx.user;
  return lock_(() => { delete MEM_.ChatRooms; delete MEM_.ChatMessages; const id = String(roomId);
    const r = find_('ChatRooms', id) || (/^cls:/.test(id) ? { id: id, type: 'class', grade: id.slice(4).split('|')[0], room: id.slice(4).split('|')[1] || '' } : null);
    if (!chatCanPurge_(me, r)) throw err_('คุณลบแชทนี้ถาวรไม่ได้ (ลบออกจากรายการของคุณได้)', 'FORBIDDEN');
    const ms = rows_('ChatMessages').filter(m => m.roomId === id); purge_([].concat.apply([], ms.map(m => fileIds_({ files: m.files }))));
    deleteWhere_('ChatMessages', m => m.roomId === id); deleteWhere_('ChatReads', x => x.roomId === id); deleteWhere_('ChatRooms', x => x.id === id);
    log_(me.id, 'chat_purge', id + ' ' + ms.length); return true; });
}
/** ลบห้องออกจากรายการแชทของฉัน (ไม่ลบข้อความของคนอื่น — กลับมาเมื่อมีข้อความใหม่) */
function chatHide_(ctx, roomId) { const me = ctx.user; return lock_(() => { const ms = rows_('ChatMessages').filter(m => m.roomId === String(roomId)); readRow_(me, String(roomId), { hidden: 'm:' + (ms.length ? ms[ms.length - 1].id : '') }); return true; }); }
/** ตั้งชื่อห้อง: ทีม = เปลี่ยนชื่อให้ทุกคน · แชทรายบุคคล/ห้องเรียน = ชื่อที่เห็นเฉพาะฉัน */
function chatRename_(ctx, roomId, name) {
  const me = ctx.user, nm = str_(name, 60);
  return lock_(() => { delete MEM_.ChatRooms; const r = find_('ChatRooms', roomId);
    if (r && r.type === 'team') { if (!chatCan_(me, r)) throw err_('ไม่พบห้องแชท', 'FORBIDDEN'); if (!nm) throw err_('กรุณาตั้งชื่อทีม'); updateRow_('ChatRooms', r, { name: nm }); return { title: nm }; }
    readRow_(me, String(roomId), { alias: nm }); return { title: nm }; });
}
function chatSend_(ctx, roomId, text, files) {
  const me = ctx.user, t = str_(text, 1000), fs = cleanFiles_(files || []).slice(0, 5);
  if (!t && !fs.length) throw err_('กรุณาพิมพ์ข้อความหรือแนบไฟล์');
  throttle_('chat_' + me.id, 30, 1)();
  return lock_(() => {
    delete MEM_.ChatRooms;
    let r = find_('ChatRooms', roomId);
    if (!r && /^cls:/.test(roomId)) { const k = roomId.slice(4).split('|'); if (canClass_(me, k[0], k[1] || '')) r = insert_('ChatRooms', { id: roomId, type: 'class', name: '', members: '[]', grade: k[0], room: k[1] || '', createdBy: me.id, createdAt: now_(), lastAt: '', lastText: '', lastBy: '' }); }
    if (!chatCan_(me, r)) throw err_('ไม่พบห้องแชท', 'FORBIDDEN');
    const m = insert_('ChatMessages', { id: id_(), roomId: r.id, senderId: me.id, text: t, files: fs, createdAt: now_(), editedAt: '', deleted: '' });
    updateRow_('ChatRooms', r, { lastAt: m.createdAt, lastText: (t || '📎 ' + fs.map(f => f.name).join(', ')).slice(0, 120), lastBy: me.id });
    return { id: m.id, key: m.createdAt + '|' + m.id, text: t, files: fs, at: m.createdAt, mine: true, can: true, sender: userName_(me), role: me.role };
  });
}

/* ============================== Admin: ตั้งค่า / สำรองข้อมูล ============================== */
/** เมนูฝั่งนักเรียน: ซ่อนเมนูมาตรฐาน + เมนูลิงก์ที่ครูเพิ่มเอง */
function menus_(v) {
  const o = typeof v === 'string' ? json_(v, {}) : (v || {});
  const KEYS = ['home', 'courses', 'assignments', 'attend', 'myscores', 'announcements', 'search', 'profile'];
  return JSON.stringify({
    hidden: (Array.isArray(o.hidden) ? o.hidden : []).filter(k => KEYS.indexOf(k) >= 0 && k !== 'home' && k !== 'profile'),
    custom: (Array.isArray(o.custom) ? o.custom : []).slice(0, 20).map(m => ({ id: str_(m.id, 20).replace(/[^\w]/g, '') || id_(), name: str_(m.name, 40), url: str_(m.url, 500), icon: str_(m.icon, 60).replace(/[^a-z0-9- ]/g, '') || 'auto', mode: m.mode === 'tab' ? 'tab' : 'app',
      courseIds: (Array.isArray(m.courseIds) ? m.courseIds : []).map(x => str_(x, 20)).filter(Boolean).slice(0, 50), grades: (Array.isArray(m.grades) ? m.grades : []).map(x => str_(x, 20)).filter(Boolean).slice(0, 20),
      rooms: (Array.isArray(m.rooms) ? m.rooms : []).map(x => str_(x, 20)).filter(Boolean).slice(0, 30) }))
      .filter(m => m.name && /^https:\/\//.test(m.url)),
    order: (Array.isArray(o.order) ? o.order : []).map(k => str_(k, 30)).filter(k => /^(c:\w+|[a-z]+)$/.test(k)).slice(0, 40)
  });
}
/** ครูผู้สอนเพิ่มประเภทงานได้ (ลบได้เฉพาะผู้ดูแลระบบ ผ่านหน้าตั้งค่า) */
function addAssignmentType_(ctx, name) {
  const v = cleanSeg_(str_(name, 40));
  if (!v || /[,/\\]/.test(v)) throw err_('ชื่อประเภทงานไม่ถูกต้อง');
  return lock_(() => { delete MEM_.Config; const list = cfg_().assignmentTypes.split(',').filter(Boolean); const isNew = list.indexOf(v) < 0; if (isNew) list.push(v); setCfg_('assignmentTypes', list.slice(0, 30).join(',')); if (isNew) settingsChanged_(ctx.user, 'เพิ่มประเภทงาน "' + v + '"', 'general'); return cfg_().assignmentTypes; });
}
/** ครูผู้สอนจัดการเมนูนักเรียน (ลิงก์เพิ่มเติม / ลำดับ) ได้เหมือนผู้ดูแลระบบ */
function saveStudentMenus_(ctx, v) {
  const out = menus_(v);
  if (out.length > 30000) throw err_('ข้อมูลเมนูยาวเกินไป');
  if (!isAdmin_(ctx.user)) { // ครู: เก็บเป็นเมนูส่วนตัว (ไม่กระทบเมนูของระบบ/ครูคนอื่น)
    return lock_(() => { delete MEM_.Users; const me = find_('Users', ctx.user.id), p = json_(me.prefs, {}) || {}; p.menus = json_(out, {}).custom || [];
      updateRow_('Users', me, { prefs: prefs_(p), updatedAt: now_() }); log_(ctx.user.id, 'save_my_menus', ''); return out; });
  }
  lock_(() => { delete MEM_.Config; setCfg_('studentMenus', out); });
  log_(ctx.user.id, 'save_menus', ''); settingsChanged_(ctx.user, 'เมนูนักเรียน', 'menus');
  return out;
}
function getSettings_() {
  const t = tenant_();
  if (t.unset) return { config: Object.assign({}, CONFIG_DEFAULTS), sheetId: '', driveId: '', sheetUrl: '', driveUrl: '', termDbs: [], curTerm: '', webAppUrl: ScriptApp.getService().getUrl(), triggers: [], tenant: t.id, needsDb: true };
  return { tenant: t.id, config: cfg_(), sheetId: sheetId_(), driveId: coreDriveId_(), sheetUrl: 'https://docs.google.com/spreadsheets/d/' + sheetId_(),
    driveUrl: 'https://drive.google.com/drive/folders/' + coreDriveId_(), termDbs: termDbList_(), curTerm: curTermKey_(), webAppUrl: ScriptApp.getService().getUrl(),
    triggers: ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction()) };
}
function extractId_(s) { s = str_(s, 300); const m = s.match(/[-\w]{25,}/); return m ? m[0] : ''; }
function saveSettings_(ctx, d) {
  d = d || {};
  const res = { reloaded: false }, t = tenant_();
  if (t.id) { // ผู้ดูแลระบบคนใหม่ (ฐานข้อมูลแยก): ต้องกำหนด Google Sheet และ Google Drive ของตนเอง
    if (!ownerAdmin_(ctx.user) && t.unset) throw err_('เฉพาะผู้ดูแลระบบเจ้าของฐานข้อมูล', 'FORBIDDEN');
    const sid = d.sheetId !== undefined ? extractId_(d.sheetId) : t.sheetId, did = d.driveId !== undefined ? extractId_(d.driveId) : t.driveId;
    if (sid !== t.sheetId || did !== t.driveId) {
      if (!sid || !did) throw err_('กรุณากรอกทั้ง Google Sheet ID/URL และ Google Drive Folder ID/URL');
      if (sid === mainSheetId_() || did === mainDriveId_()) throw err_('ผู้ดูแลระบบคนใหม่ต้องใช้ Google Sheet และ Google Drive ใหม่ของตนเอง (ห้ามใช้ของระบบเดิม)');
      const tn = tenants_(); if (Object.keys(tn).some(k => k !== t.id && (tn[k].sheetId === sid || tn[k].driveId === did))) throw err_('Google Sheet/Drive นี้ถูกใช้โดยผู้ดูแลระบบคนอื่นแล้ว');
      try { SpreadsheetApp.openById(sid).getName(); } catch (e) { throw err_('เปิด Google Sheet นี้ไม่ได้ ตรวจสอบ ID และสิทธิ์'); }
      try { DriveApp.getFolderById(did).getName(); } catch (e) { throw err_('เปิดโฟลเดอร์ Google Drive นี้ไม่ได้ ตรวจสอบ ID และสิทธิ์'); }
      lock_(() => { const m = tenants_(); m[t.id] = { sheetId: sid, driveId: did, updatedAt: now_() }; props_().setProperty('TENANTS', JSON.stringify(m)); });
      TENANT_ = null; useTenant_(t.id); res.reloaded = true;
    }
    delete d.sheetId; delete d.driveId;
    if (tenant_().unset) return res;
  }
  if (d.driveId !== undefined && extractId_(d.driveId) !== coreDriveId_()) {
    const id = extractId_(d.driveId);
    try { DriveApp.getFolderById(id).getName(); } catch (e) { throw err_('เปิดโฟลเดอร์ Google Drive นี้ไม่ได้ ตรวจสอบ ID และสิทธิ์'); }
    props_().setProperty('DRIVE_ID', id);
  }
  lock_(() => {
    Object.keys(CONFIG_DEFAULTS).forEach(k => {
      if (d.config && d.config[k] !== undefined) {
        let v = typeof d.config[k] === 'boolean' ? String(d.config[k]) : str_(d.config[k], k === 'logo' ? 48000 : k === 'studentMenus' || k === 'scoreSources' ? 30000 : 500);
        if (k === 'logo' && v && !(imgOk_(v) || /^data:image\/svg\+xml;base64,/.test(v))) throw err_('โลโก้ไม่ถูกต้อง');
        if (k === 'themeColor' && !/^#[0-9a-f]{6}$/i.test(v)) throw err_('รหัสสีไม่ถูกต้อง');
        if (k === 'studentMenus') v = menus_(d.config[k]);
        if (k === 'scoreSources') { v = scoreSources_(d.config[k]); props_().setProperty('SCORE_V', id_().slice(0, 6)); }
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
  const ch = Object.keys(d.config || {}).map(k => CFG_TH[k] || k).concat(res.reloaded ? ['ฐานข้อมูล'] : []);
  if (ch.length) settingsChanged_(ctx.user, ch.join(', '), (d.config || {}).scoreSources !== undefined ? 'scores' : res.reloaded ? 'db' : 'general');
  return res;
}
/* ---------- จัดการฐานข้อมูลรายภาคเรียน (แอดมิน) ---------- */
function termDbList_() {
  const m = dbMap_(), cur = curTermKey_();
  return Object.keys(m).sort().reverse().map(k => ({ key: k, sheetId: m[k].sheetId || '', driveId: m[k].driveId || '', current: k === cur,
    sheetUrl: m[k].sheetId ? 'https://docs.google.com/spreadsheets/d/' + m[k].sheetId : '', driveUrl: m[k].driveId ? 'https://drive.google.com/drive/folders/' + m[k].driveId : '', createdAt: m[k].createdAt || '' }));
}
function termKeyOk_(k) { k = str_(k, 7); if (!/^25\d\d\/[12]$/.test(k)) throw err_('ภาคเรียนไม่ถูกต้อง (เช่น 2569/2)'); return k; }
/** เตรียมตารางการเรียนในไฟล์ภาคเรียน */
/** เตรียมแผ่นงานทั้งหมดของไฟล์ภาคเรียน + ประเภทงานพื้นฐาน */
function setupTermSheets_(sheetId) {
  const ss = SpreadsheetApp.openById(sheetId);
  Object.keys(SCHEMA).filter(n => !CORE_TABLES[n]).forEach(n => ensureSheet_(ss, n));
  const tc = ss.getSheetByName('TermConfig');
  if (tc.getLastRow() < 2) tc.appendRow(['assignmentTypes', BASIC_TYPES.join(','), now_()]);
}
/** v5: ไฟล์ภาคเรียนที่สร้างใน v4.9 ยังไม่มีนักเรียน/ชั้นเรียน/หมวดหมู่/แชท → คัดลอกจากไฟล์หลักให้ครั้งเดียว (นักเรียนเข้าสู่ระบบได้ต่อเนื่อง) */
function upgradeV5_() {
  if (props_().getProperty('V5_SPLIT') === '1') return;
  const m = dbMap_(), T = ['Users', 'Classes', 'Categories', 'Notifications', 'ChatRooms', 'ChatMessages', 'ChatReads'];
  Object.keys(m).forEach(k => { if (!m[k].sheetId) return;
    setupTermSheets_(m[k].sheetId);
    const data = withTerm_('main', () => { const o = {}; T.forEach(n => o[n] = rows_(n).filter(r => n !== 'Users' || r.role === 'student').map(r => { const x = Object.assign({}, r); delete x._r; delete x._db; return x; })); o.types = cfg_().assignmentTypes; return o; });
    withTerm_(k, () => { if (rows_('Users').some(u => u.role === 'student')) return; T.forEach(n => { const have = {}; rows_(n).forEach(r => have[r.id] = 1); const add = data[n].filter(r => !have[r.id]); if (add.length) insertMany_(n, add); });
      const tc = rows_('TermConfig').find(r => r.key === 'assignmentTypes'); if (tc) updateRow_('TermConfig', tc, { value: data.types, updatedAt: now_() }); });
  });
  props_().setProperty('V5_SPLIT', '1');
}
/** คัดลอกข้อมูลทั้งหมด (ยกเว้นตั้งค่าระบบ/เซสชัน/บัญชีครู) จากฐานข้อมูลหนึ่งไปอีกฐาน — ใช้ย้ายข้อมูลเดิมจากไฟล์หลักเข้าไฟล์ภาคเรียน */
function copyAllTerm_(from, to) {
  const data = withTerm_(from, () => { const o = {}; Object.keys(SCHEMA).filter(n => !CORE_TABLES[n]).forEach(n => { o[n] = rows_(n).filter(r => n !== 'Users' || r.role === 'student').map(r => { const x = Object.assign({}, r); delete x._r; delete x._db; return x; }); }); return o; });
  return withTerm_(to, () => { let total = 0; Object.keys(data).forEach(n => { if (!data[n].length) return; const have = {}; rows_(n).forEach(r => have[r.id || r.key] = 1);
    const add = data[n].filter(r => !have[r.id || r.key]); if (add.length) { insertMany_(n, add); total += add.length; } }); return total; });
}
function saveTermDb_(ctx, d) {
  d = d || {}; const k = termKeyOk_(d.key), sid = extractId_(d.sheetId), did = extractId_(d.driveId), from = d.copyFrom ? String(d.copyFrom) : '';
  if (!sid) throw err_('กรุณาใส่ Google Sheet ID หรือ URL');
  if (sid === sheetId_()) throw err_('ใช้ไฟล์เดียวกับฐานข้อมูลหลักไม่ได้ — ถ้าต้องการเก็บรวมกัน ให้ลบรายการภาคเรียนนี้แทน');
  try { SpreadsheetApp.openById(sid).getName(); } catch (e) { throw err_('เปิด Google Sheet นี้ไม่ได้ ตรวจสอบ ID และสิทธิ์'); }
  if (did) { try { DriveApp.getFolderById(did).getName(); } catch (e) { throw err_('เปิดโฟลเดอร์ Google Drive นี้ไม่ได้ ตรวจสอบ ID และสิทธิ์'); } }
  return lock_(() => {
    const m = dbMap_(); m[k] = { sheetId: sid, driveId: did, createdAt: (m[k] && m[k].createdAt) || now_() };
    props_().setProperty(dbKey_(), JSON.stringify(m)); setupTermSheets_(sid);
    let copied = 0; if (from && from !== k) copied = copyAllTerm_(from, k);
    log_(ctx.user.id, 'term_db', k + ' ' + sid + (copied ? ' copied ' + copied : '')); settingsChanged_(ctx.user, 'ฐานข้อมูลภาคเรียน ' + k, 'db');
    const out = termDbList_(); out.copied = copied; return out;
  });
}
/** สร้างไฟล์ Google Sheet + โฟลเดอร์ Drive ใหม่ให้ภาคเรียนนั้นอัตโนมัติ */
function createTermDb_(ctx, key, opts) {
  const k = termKeyOk_(key), m = dbMap_(); opts = opts || {};
  if (m[k] && m[k].sheetId) throw err_('ภาคเรียนนี้มีฐานข้อมูลแล้ว');
  const label = 'ภาคเรียนที่ ' + k.split('/')[1] + '-' + k.split('/')[0], name = (cfg_().schoolName || 'Classroom +') + ' — ข้อมูล' + label;
  const book = SpreadsheetApp.create(name), root = DriveApp.getFolderById(coreDriveId_()), it = root.getFoldersByName('ข้อมูล' + label);
  const fd = it.hasNext() ? it.next() : root.createFolder('ข้อมูล' + label);
  try { DriveApp.getFileById(book.getId()).moveTo(fd); } catch (e) {}
  return saveTermDb_(ctx, { key: k, sheetId: book.getId(), driveId: fd.getId(), copyFrom: opts.copyFrom || '' });
}
/* ---------- ดึงข้อมูลจากภาคเรียนอื่น (นักเรียน หมวดหมู่ ประเภทงาน รายวิชา+บทเรียน ประกาศ) ---------- */
const termLabel_ = k => k === 'main' ? 'ฐานข้อมูลหลัก' : 'ภาคเรียนที่ ' + k.split('/')[1] + '/' + k.split('/')[0];
function termSources_(ctx) {
  const cur = termDb_(), m = dbMap_(), keys = Object.keys(m).sort().reverse();
  const out = keys.filter(k => k !== cur.key || !cur.sheetId).filter(k => m[k].sheetId !== cur.sheetId).map(k => ({ key: k, label: termLabel_(k) }));
  if (cur.sheetId) out.push({ key: 'main', label: termLabel_('main') + ' (ข้อมูลก่อนแยกภาคเรียน)' });
  return { current: cur.sheetId ? cur.key : 'main', currentLabel: termLabel_(cur.sheetId ? cur.key : 'main'), sources: out };
}
const IMPORT_KINDS = { students: 1, categories: 1, types: 1, courses: 1, announcements: 1 };
function sourceItems_(ctx, kind) {
  const u = ctx.user;
  if (kind === 'students') return rows_('Users').filter(x => x.role === 'student').map(x => ({ id: x.id, label: x.prefix + x.fullName, sub: (x.grade || '-') + '/' + (x.room || '-') + ' · เลขที่ ' + (x.classNo || '-') + ' · รหัส ' + x.studentCode, group: (x.grade || '-') + '/' + (x.room || '-') }));
  if (kind === 'categories') return rows_('Categories').map(x => ({ id: x.id, label: (x.code ? x.code + ' ' : '') + x.name, sub: '' }));
  if (kind === 'types') return cfg_().assignmentTypes.split(',').filter(Boolean).map(x => ({ id: x, label: x, sub: '' }));
  if (kind === 'courses') { const ls = rows_('Lessons'); return rows_('Courses').filter(c => isAdmin_(u) || teaches_(u, c)).map(c => ({ id: c.id, label: (c.code ? c.code + ' ' : '') + c.name, sub: ls.filter(l => l.courseId === c.id).length + ' บทเรียน · ' + (c.grade || 'ทุกชั้น') + (c.room ? ' ห้อง ' + c.room : '') })); }
  if (kind === 'announcements') return rows_('Announcements').filter(a => rowOwned_(u, 'Announcements', a)).map(a => ({ id: a.id, label: a.title, sub: (a.type || '') + ' · ' + String(a.createdAt).slice(0, 10) }));
  return [];
}
function peekTerm_(ctx, from, kind) {
  if (!IMPORT_KINDS[kind]) throw err_('ไม่รู้จักประเภทข้อมูล');
  const src = termSources_(ctx).sources.find(x => x.key === from); if (!src) throw err_('ไม่พบภาคเรียนต้นทาง');
  const have = {}; sourceItems_(ctx, kind).forEach(x => have[x.id] = 1);
  return withTerm_(from, () => sourceItems_(ctx, kind)).map(x => Object.assign(x, { exists: !!have[x.id] }));
}
function importTerm_(ctx, from, kind, ids, opts) {
  if (!IMPORT_KINDS[kind]) throw err_('ไม่รู้จักประเภทข้อมูล');
  const src = termSources_(ctx).sources.find(x => x.key === from); if (!src) throw err_('ไม่พบภาคเรียนต้นทาง');
  opts = opts || {}; const want = {}; (Array.isArray(ids) ? ids : []).slice(0, 2000).forEach(i => want[String(i)] = 1);
  const u = ctx.user, clean = r => { const x = Object.assign({}, r); delete x._r; delete x._db; return x; }, tk = termDb_().key, year = /^25\d\d\//.test(tk) ? tk.split('/')[0] : '';
  const pick = withTerm_(from, () => {
    if (kind === 'students') return { rows: rows_('Users').filter(x => x.role === 'student' && want[x.id]).map(clean) };
    if (kind === 'categories') return { rows: rows_('Categories').filter(x => want[x.id]).map(clean) };
    if (kind === 'types') return { types: cfg_().assignmentTypes.split(',').filter(t => want[t]) };
    if (kind === 'courses') { const cs = rows_('Courses').filter(c => want[c.id] && (isAdmin_(u) || teaches_(u, c))).map(clean); const cid = {}; cs.forEach(c => cid[c.id] = 1);
      return { rows: cs, lessons: opts.lessons === false ? [] : rows_('Lessons').filter(l => cid[l.courseId]).map(clean) }; }
    return { rows: rows_('Announcements').filter(a => want[a.id] && rowOwned_(u, 'Announcements', a)).map(clean) };
  });
  return lock_(() => {
    let n = 0; const t = now_();
    if (kind === 'types') { const l = cfg_().assignmentTypes.split(',').filter(Boolean); pick.types.forEach(x => { if (l.indexOf(x) < 0) { l.push(x); n++; } }); setCfg_('assignmentTypes', l.join(',')); }
    else {
      const table = { students: 'Users', categories: 'Categories', courses: 'Courses', announcements: 'Announcements' }[kind];
      Object.keys(MEM_).forEach(k => delete MEM_[k]);
      const have = {}, codes = {}; rows_(table).forEach(r => { have[r.id] = 1; if (r.studentCode) codes[r.studentCode] = 1; if (kind === 'categories') codes[(r.code || '') + '|' + r.name] = 1; });
      const add = pick.rows.filter(r => !have[r.id] && !(kind === 'students' && codes[r.studentCode]) && !(kind === 'categories' && codes[(r.code || '') + '|' + r.name]))
        .map(r => { if (kind === 'students' && year) r.acadYear = year; if (kind === 'courses' && year) { r.acadYear = year; r.term = tk.split('/')[1]; } if (kind === 'announcements') { r.createdAt = t; r.updatedAt = t; } return r; });
      if (add.length) insertMany_(table, add); n = add.length;
      if (kind === 'courses' && pick.lessons.length) { const lh = {}; rows_('Lessons').forEach(l => lh[l.id] = 1); const la = pick.lessons.filter(l => !lh[l.id]); if (la.length) insertMany_('Lessons', la); }
    }
    log_(u.id, 'import_' + kind, from + ' → ' + n);
    return { added: n, skipped: Object.keys(want).length - n };
  });
}
function removeTermDb_(ctx, key) {
  const k = termKeyOk_(key);
  return lock_(() => { const m = dbMap_(); delete m[k]; props_().setProperty(dbKey_(), JSON.stringify(m)); log_(ctx.user.id, 'term_db_remove', k); settingsChanged_(ctx.user, 'ลบฐานข้อมูลภาคเรียน ' + k, 'db'); return termDbList_(); });
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
      delete MEM_[n]; delete MEM_['_h_' + n + '#c']; delete MEM_['_h_' + n + '#t']; bump_(n);
    });
    Object.keys(SCHEMA).forEach(n => ensureSheet_(ss_(), n));
    log_(ctx.user.id, 'restore', src.getName());
    return { ok: true, name: src.getName() };
  });
}
/* ============================== กิจกรรมตอบปัญหา (แบบ Kahoot) / แบบสอบถาม ==============================
 * ครูสร้างกิจกรรม → เปิดห้อง (lobby) ให้นักเรียนสแกน QR เข้าร่วม → เริ่ม → นักเรียนตอบบนมือถือ → ปิด → โพเดียม/สรุปผล */
const LIVE_KINDS = { quiz: 1, survey: 1 };
function survey_(v) {
  const o = typeof v === 'string' ? json_(v, null) : v;
  if (!o || !Array.isArray(o.questions) || !o.questions.length) throw err_('กรุณาเพิ่มคำถามอย่างน้อย 1 ข้อ');
  const seen = {};
  return { questions: o.questions.slice(0, 100).map((q, i) => {
    const n = 'ข้อ ' + (i + 1) + ': ', type = ['text', 'choice', 'rating'].indexOf(q.type) >= 0 ? q.type : 'choice';
    let id = str_(q.id, 20).replace(/[^\w]/g, '') || id_(); if (seen[id]) id = id_(); seen[id] = 1;
    const out = { id: id, type: type, q: str_(q.q, 1000), required: !!q.required };
    if (!out.q) throw err_(n + 'กรุณาพิมพ์คำถาม');
    if (type === 'choice') { out.options = (Array.isArray(q.options) ? q.options : []).map(x => str_(x, 200)).filter(Boolean).slice(0, 12); if (out.options.length < 2) throw err_(n + 'ต้องมีตัวเลือกอย่างน้อย 2 ข้อ'); out.multi = !!q.multi; }
    if (type === 'rating') { // กำหนดจำนวนระดับ 2–10 · ป้ายรายระดับ · ค่าคะแนนเริ่มต้น (0 หรือ 1)
      out.scale = Math.min(10, Math.max(2, Math.round(Number(q.scale)) || 5)); out.start = Number(q.start) === 0 ? 0 : 1;
      out.levels = (Array.isArray(q.levels) ? q.levels : String(q.levels || '').split(',')).map(x => str_(x, 40)).slice(0, out.scale); if (!out.levels.some(Boolean)) delete out.levels;
      out.minLabel = str_(q.minLabel, 40); out.maxLabel = str_(q.maxLabel, 40); out.style = q.style === 'star' ? 'star' : q.style === 'emoji' ? 'emoji' : 'number'; }
    return out; }) };
}
function liveSettings_(v, kind) {
  const o = typeof v === 'string' ? json_(v, {}) : (v || {});
  const mode = ['question', 'total', 'none'].indexOf(o.timeMode) >= 0 ? o.timeMode : (kind === 'quiz' ? 'question' : 'none');
  return { timeMode: mode, totalSec: Math.min(7200, Math.max(30, Math.round(Number(o.totalSec) || 600))), defaultTime: Math.min(600, Math.max(5, Math.round(Number(o.defaultTime) || 20))),
    shuffle: !!o.shuffle, showAnswer: o.showAnswer !== false, anonymous: !!o.anonymous, speedBonus: o.speedBonus !== false };
}
function livePub_(r, full) {
  const o = { id: r.id, kind: r.kind, title: r.title, pin: r.pin, status: r.status, startedAt: r.startedAt, endsAt: r.endsAt, createdAt: r.createdAt, settings: json_(r.settings, {}), ownerId: r.ownerId };
  const d = json_(r.data, { questions: [] }); o.count = (d.questions || []).length;
  if (full) o.data = d;
  return o;
}
function liveOwn_(u, r) { if (!r) throw err_('ไม่พบกิจกรรม'); if (!isAdmin_(u) && r.ownerId !== u.id) throw err_('คุณไม่มีสิทธิ์จัดการกิจกรรมนี้', 'FORBIDDEN'); return r; }
function liveList_(ctx, kind) {
  const u = ctx.user, ans = rows_('LiveAnswers');
  return rows_('LiveSessions').filter(r => (!kind || r.kind === kind) && (isAdmin_(u) || r.ownerId === u.id))
    .map(r => Object.assign(livePub_(r), { players: ans.filter(a => a.sessionId === r.id).length })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
function liveGet_(ctx, id) { return livePub_(liveOwn_(ctx.user, find_('LiveSessions', id)), true); }
function newPin_() { const used = {}; rows_('LiveSessions').forEach(r => { if (r.status !== 'closed') used[r.pin] = 1; }); for (let i = 0; i < 50; i++) { const p = String(100000 + Math.floor(Math.random() * 900000)); if (!used[p]) return p; } throw err_('สร้างรหัสกิจกรรมไม่ได้ ลองใหม่'); }
function liveSave_(ctx, d) {
  d = d || {};
  const kind = LIVE_KINDS[d.kind] ? d.kind : 'quiz', title = str_(d.title, 150);
  if (!title) throw err_('กรุณาตั้งชื่อกิจกรรม');
  const data = kind === 'quiz' ? quiz_(d.data) : survey_(d.data);
  if (!data) throw err_('กรุณาเพิ่มคำถามอย่างน้อย 1 ข้อ');
  if (kind === 'quiz' && data.questions.some(q => q.type === 'text' && !q.answer)) throw err_('ข้อเขียนในกิจกรรมตอบปัญหาต้องกำหนดคำตอบ (ตรวจอัตโนมัติ)');
  const st = liveSettings_(d.settings, kind);
  return lock_(() => {
    delete MEM_.LiveSessions;
    if (d.id) { const r = liveOwn_(ctx.user, find_('LiveSessions', d.id)); if (r.status === 'live') throw err_('กิจกรรมกำลังดำเนินอยู่ แก้ไขไม่ได้'); updateRow_('LiveSessions', r, { title: title, data: data, settings: st, updatedAt: now_() }); return livePub_(r, true); }
    return livePub_(insert_('LiveSessions', { id: id_(), kind: kind, title: title, pin: newPin_(), ownerId: ctx.user.id, data: data, settings: st, status: 'draft', startedAt: '', endsAt: '', createdAt: now_(), updatedAt: now_() }), true);
  });
}
function liveRemove_(ctx, id) { return lock_(() => { liveOwn_(ctx.user, find_('LiveSessions', id)); deleteWhere_('LiveAnswers', a => a.sessionId === id); deleteWhere_('LiveSessions', r => r.id === id); return true; }); }
/** open = เปิดห้องรอ (lobby) · start = เริ่มตอบ · close = ปิดกิจกรรม · reset = ล้างผลเพื่อเล่นใหม่ */
function liveControl_(ctx, id, action) {
  return lock_(() => {
    delete MEM_.LiveSessions;
    const r = liveOwn_(ctx.user, find_('LiveSessions', id)), st = json_(r.settings, {}), t = now_();
    if (action === 'open') { if (r.status === 'closed' || r.status === 'draft') { deleteWhere_('LiveAnswers', a => a.sessionId === id); updateRow_('LiveSessions', r, { status: 'lobby', pin: r.status === 'closed' ? newPin_() : r.pin, startedAt: '', endsAt: '', updatedAt: t }); } }
    else if (action === 'start') updateRow_('LiveSessions', r, { status: 'live', startedAt: t, endsAt: st.timeMode === 'total' ? Utilities.formatDate(new Date(Date.now() + st.totalSec * 1000), TZ, "yyyy-MM-dd'T'HH:mm:ss") : '', updatedAt: t });
    else if (action === 'close') updateRow_('LiveSessions', r, { status: 'closed', updatedAt: t });
    else if (action === 'reset') { deleteWhere_('LiveAnswers', a => a.sessionId === id); updateRow_('LiveSessions', r, { status: 'draft', startedAt: '', endsAt: '', updatedAt: t }); }
    else throw err_('คำสั่งไม่ถูกต้อง');
    return livePub_(r);
  });
}
function liveBoard_(r) {
  return rows_('LiveAnswers').filter(a => a.sessionId === r.id).map(a => ({ pid: a.pid, name: a.name, score: Number(a.score) || 0, correct: Number(a.correct) || 0, finished: !!a.finishedAt, timeMs: Number(a.timeMs) || 0, answered: Object.keys(json_(a.answers, {})).length }))
    .sort((a, b) => b.score - a.score || b.correct - a.correct || a.timeMs - b.timeMs || String(a.name).localeCompare(String(b.name)));
}
/** สรุปผลแบบสอบถาม */
function surveySummary_(r) {
  const d = json_(r.data, { questions: [] }), ans = rows_('LiveAnswers').filter(a => a.sessionId === r.id && a.finishedAt).map(a => json_(a.answers, {}));
  return d.questions.map(q => {
    const vals = ans.map(a => a[q.id]).filter(v => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length));
    const o = { id: q.id, type: q.type, q: q.q, n: vals.length };
    if (q.type === 'choice') { o.options = q.options; o.counts = q.options.map((x, i) => vals.filter(v => (Array.isArray(v) ? v : [v]).map(Number).indexOf(i) >= 0).length); }
    else if (q.type === 'rating') { const st = q.start === 0 ? 0 : 1; o.scale = q.scale; o.start = st; o.levels = q.levels || []; o.counts = Array.from({ length: q.scale }, (x, i) => vals.filter(v => Number(v) === i + st).length); o.avg = vals.length ? r2_(vals.reduce((t, v) => t + Number(v), 0) / vals.length) : 0; o.minLabel = q.minLabel; o.maxLabel = q.maxLabel; }
    else o.texts = vals.map(v => str_(v, 1000)).slice(-500);
    return o;
  });
}
function liveStatus_(ctx, id) {
  const r = liveOwn_(ctx.user, find_('LiveSessions', id)), o = livePub_(r, true);
  o.players = liveBoard_(r);
  if (r.kind === 'survey') { o.summary = surveySummary_(r); o.players.forEach(p => delete p.score); }
  return o;
}
/* ---------- ฝั่งผู้เข้าร่วม (ไม่ต้องเข้าสู่ระบบ — ใช้ PIN + ชื่อ) ---------- */
/** หา PIN ในฐานข้อมูลภาคเรียน: ภาคที่ระบุใน QR → ภาคปัจจุบัน → ทุกภาคที่ตั้งไว้ → ไฟล์หลัก แล้วสลับไปใช้ฐานข้อมูลนั้นตลอดคำขอ */
function liveByPin_(pin, tkey) {
  const p = str_(pin, 6), find = () => rows_('LiveSessions').find(x => x.pin === p && x.status !== 'draft');
  const r = eachDb_(() => { try { return find() || null; } catch (e) { return null; } }, tkey && (tkey === 'main' || /^25\d\d\/[12]$/.test(tkey)) ? tkey : '');
  if (r) return r;
  throw err_('ไม่พบกิจกรรมนี้ หรือกิจกรรมยังไม่เปิด', 'NOTFOUND');
}
function liveQs_(r, shuffle) {
  const d = json_(r.data, { questions: [] });
  if (r.kind === 'survey') return d.questions;
  const pub = json_(quizPub_(JSON.stringify(Object.assign({}, d, { questions: d.questions }))), { questions: [] });
  return pub.questions;
}
function liveInfo_(ctx, pin, pid, tkey) {
  const r = liveByPin_(pin, tkey), st = json_(r.settings, {}), o = { kind: r.kind, title: r.title, status: r.status, count: json_(r.data, { questions: [] }).questions.length, settings: { timeMode: st.timeMode, totalSec: st.totalSec, defaultTime: st.defaultTime, shuffle: !!st.shuffle, anonymous: !!st.anonymous }, startedAt: r.startedAt, endsAt: r.endsAt, players: rows_('LiveAnswers').filter(a => a.sessionId === r.id).length };
  if (pid) { const me = rows_('LiveAnswers').find(a => a.sessionId === r.id && a.pid === String(pid)); if (me) { o.me = { name: me.name, finished: !!me.finishedAt, score: Number(me.score) || 0, correct: Number(me.correct) || 0 };
    if (r.status === 'live' && !me.finishedAt) { o.questions = liveQs_(r); o.joinedAt = me.createdAt; } } }
  if (r.status === 'closed' && r.kind === 'quiz') { const b = liveBoard_(r); o.top = b.slice(0, 10).map((x, i) => ({ rank: i + 1, name: x.name, score: x.score })); if (pid) { const i = b.findIndex(x => x.pid === String(pid)); if (i >= 0) o.myRank = i + 1; } }
  return o;
}
function liveJoin_(ctx, pin, name, token, tkey) {
  const r = liveByPin_(pin, tkey), st = json_(r.settings, {});
  if (r.status === 'closed') throw err_('กิจกรรมนี้ปิดแล้ว');
  const raw = str_(name, 40), byCode = /^\d{5}$/.test(raw) ? rows_('Users').find(u => u.role === 'student' && u.studentCode === raw && u.status !== 'disabled') : null;
  if (/^\d{5}$/.test(raw) && !byCode) throw err_('ไม่พบรหัสนักเรียนนี้ในภาคเรียนของกิจกรรม — ตรวจสอบรหัส หรือพิมพ์ชื่อแทน');
  const acc = byCode || (token ? auth_(token) : null);
  let nm = acc ? (acc.prefix + acc.fullName) : raw;
  if (st.anonymous && r.kind === 'survey') nm = nm || 'ผู้ตอบ';
  if (!nm) throw err_('กรุณาพิมพ์ชื่อหรือชื่อเล่น');
  throttle_('lj_' + r.id, 400, 30)();
  return lock_(() => {
    delete MEM_.LiveAnswers;
    if (acc) { const old = rows_('LiveAnswers').find(a => a.sessionId === r.id && a.userId === acc.id); if (old) return { pid: old.pid, name: old.name }; }
    if (rows_('LiveAnswers').some(a => a.sessionId === r.id && a.name === nm)) nm = nm + ' #' + (1 + rows_('LiveAnswers').filter(a => a.sessionId === r.id && a.name.indexOf(nm) === 0).length);
    const pid = id_() + id_();
    insert_('LiveAnswers', { id: id_(), sessionId: r.id, pid: pid, name: nm, userId: acc ? acc.id : '', answers: '{}', score: '0', correct: '0', timeMs: '0', finishedAt: '', createdAt: now_(), updatedAt: now_() });
    return { pid: pid, name: nm };
  });
}
/** ส่งคำตอบทั้งชุด (timings = เวลาที่ใช้ต่อข้อ ms) → คะแนน: ถูก × 1000 × คะแนนข้อ + โบนัสความเร็ว */
function liveSubmit_(ctx, pin, pid, answers, timings, tkey) {
  const r = liveByPin_(pin, tkey), st = json_(r.settings, {});
  if (r.status !== 'live') throw err_(r.status === 'closed' ? 'หมดเวลา — กิจกรรมปิดแล้ว' : 'กิจกรรมยังไม่เริ่ม');
  return lock_(() => {
    delete MEM_.LiveAnswers;
    const me = rows_('LiveAnswers').find(a => a.sessionId === r.id && a.pid === String(pid));
    if (!me) throw err_('ไม่พบผู้เข้าร่วม กรุณาเข้าร่วมใหม่');
    if (me.finishedAt) return { score: Number(me.score), correct: Number(me.correct), already: true };
    const d = json_(r.data, { questions: [] }); timings = timings && typeof timings === 'object' ? timings : {};
    let score = 0, correct = 0, total = 0;
    if (r.kind === 'quiz') {
      const ans = cleanAnswers_(d, answers), g = gradeQuiz_(d, ans);
      d.questions.forEach(q => {
        const got = Number(g.scores[q.id]) || 0, lim = (q.time || st.defaultTime) * 1000, used = Math.max(0, Math.min(lim, Number(timings[q.id]) || lim));
        if (got >= q.points) correct++;
        const speed = st.timeMode === 'question' && st.speedBonus !== false ? 0.5 + 0.5 * (1 - used / lim) : 1;
        score += Math.round(1000 * got * speed);
        total += used;
      });
      updateRow_('LiveAnswers', me, { answers: ans, score: score, correct: correct, timeMs: total, finishedAt: now_(), updatedAt: now_() });
    } else {
      const ans = {}; answers = answers && typeof answers === 'object' ? answers : {};
      d.questions.forEach(q => { const a = answers[q.id]; if (a === undefined || a === null || a === '') { if (q.required) throw err_('กรุณาตอบ: ' + str_(q.q, 40)); return; }
        if (q.type === 'choice') ans[q.id] = (Array.isArray(a) ? a : [a]).map(Number).filter(i => i >= 0 && i < q.options.length).slice(0, q.multi ? 12 : 1);
        else if (q.type === 'rating') { const v = Math.round(Number(a)), st = q.start === 0 ? 0 : 1; if (v >= st && v <= q.scale - 1 + st) ans[q.id] = v; }
        else ans[q.id] = str_(a, 1000); });
      updateRow_('LiveAnswers', me, { answers: ans, finishedAt: now_(), updatedAt: now_() });
    }
    const b = r.kind === 'quiz' ? liveBoard_(r) : [];
    return { score: score, correct: correct, count: d.questions.length, rank: b.findIndex(x => x.pid === String(pid)) + 1, players: b.length };
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

/* ============================== v5.4 ตารางสอน + เช็คชื่อนักเรียน ============================== */
const ATT_TH = { present: 'มาเรียน', late: 'สาย', absent: 'ขาด', sick: 'ลาป่วย', leave: 'ลากิจ', activity: 'ไปกิจกรรม', skip: 'หนีเรียน' };
const ATT_ST = ['present', 'late', 'absent', 'sick', 'leave', 'activity', 'skip']; // มาเรียน สาย ขาด ลาป่วย ลากิจ ไปกิจกรรม หนีเรียน
const TT_DEF = { periods: 8, minutes: 50, start: '08:30', breakAfter: 4, breakMin: 60, days: 5, lateMin: 15 };
const hm_ = v => { const m = String(v || '').match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const fmtHm_ = n => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
function ttCfgOf_(ownerId) { const r = rows_('Timetables').find(x => x.id === ownerId); return Object.assign({}, TT_DEF, r ? json_(r.cfg, {}) : {}); }
/** เวลาเริ่ม/จบ (นาทีของวัน) ของคาบ p (1..n) ตามค่าตั้งของเจ้าของตาราง */
function periodTime_(cfg, p, span) {
  const h0 = hm_(cfg.start), st = h0 === null ? 510 : h0, m = Number(cfg.minutes) || 50, ba = Number(cfg.breakAfter) || 0, bm = Number(cfg.breakMin) || 0;
  const s0 = st + (p - 1) * m + (ba && p > ba ? bm : 0), last = p + (Number(span) || 1) - 1;
  const e0 = st + last * m + (ba && last > ba ? bm : 0);
  return { start: s0, end: e0 };
}
function todayInfo_() { const n = now_(), day = n.slice(0, 10), g = new Date(day + 'T00:00:00Z').getUTCDay(); return { date: day, dow: g || 7, min: Number(n.slice(11, 13)) * 60 + Number(n.slice(14, 16)) }; }
function dowOf_(date) { const g = new Date(String(date).slice(0, 10) + 'T00:00:00Z').getUTCDay(); return g || 7; }
/** คาบที่ครูคนนี้เห็น: ของตนเอง + รายวิชาที่สอนร่วม (ผู้ดูแลระบบเห็นทั้งหมด) */
function ttVisible_(me) {
  const cs = {}; rows_('Courses').forEach(c => cs[c.id] = c);
  return rows_('TtSlots').filter(x => isAdmin_(me) || x.ownerId === me.id || teaches_(me, cs[x.courseId]));
}
function slotOut_(x, me, cs, users) {
  const c = cs[x.courseId] || {}, cfg = ttCfgOf_(x.ownerId), t = periodTime_(cfg, Number(x.period), x.span), o = users[x.ownerId];
  return { id: x.id, ownerId: x.ownerId, ownerName: o ? userName_(o) : '', mine: x.ownerId === me.id, day: Number(x.day), period: Number(x.period), span: Number(x.span) || 1,
    courseId: x.courseId, courseName: c.name || '-', courseCode: c.code || '', grade: x.grade, room: x.room, students: slotStudentIds_(x), extras: json_(x.extras, []), note: x.note,
    start: fmtHm_(t.start), end: fmtHm_(t.end) };
}
function ttGet_(ctx) {
  const me = ctx.user, cs = {}, users = {}; rows_('Courses').forEach(c => cs[c.id] = c); rows_('Users').forEach(u => users[u.id] = u);
  return { cfg: ttCfgOf_(me.id), slots: ttVisible_(me).map(x => slotOut_(x, me, cs, users)), today: todayInfo_(), statuses: ATT_ST };
}
function ttSaveCfg_(ctx, d) {
  d = d || {}; const me = ctx.user;
  const cfg = { periods: Math.max(1, Math.min(14, Number(d.periods) || 8)), minutes: Math.max(10, Math.min(240, Number(d.minutes) || 50)), start: hm_(d.start) !== null ? str_(d.start, 5) : '08:30',
    breakAfter: Math.max(0, Math.min(13, Number(d.breakAfter) || 0)), breakMin: Math.max(0, Math.min(180, Number(d.breakMin) || 0)), days: [5, 6, 7].indexOf(Number(d.days)) >= 0 ? Number(d.days) : 5,
    lateMin: Math.max(0, Math.min(120, d.lateMin === undefined ? 15 : Number(d.lateMin) || 0)) };
  return lock_(() => { delete MEM_.Timetables; const r = rows_('Timetables').find(x => x.id === me.id);
    if (r) updateRow_('Timetables', r, { cfg: cfg, updatedAt: now_() }); else insert_('Timetables', { id: me.id, ownerId: me.id, cfg: cfg, updatedAt: now_() });
    log_(me.id, 'tt_cfg', JSON.stringify(cfg)); return cfg; });
}
function ttSaveSlot_(ctx, d) {
  d = d || {}; const me = ctx.user, c = find_('Courses', d.courseId);
  if (!c) throw err_('กรุณาเลือกรายวิชา');
  if (!isAdmin_(me) && !teaches_(me, c)) throw err_('เลือกได้เฉพาะรายวิชาที่คุณสอน', 'FORBIDDEN');
  const cfg = ttCfgOf_(me.id), day = Number(d.day), period = Number(d.period), span = Math.max(1, Math.min(6, Number(d.span) || 1));
  if (!(day >= 1 && day <= 7)) throw err_('วันไม่ถูกต้อง');
  if (!(period >= 1 && period + span - 1 <= cfg.periods)) throw err_('คาบเรียนเกินจำนวนคาบที่ตั้งไว้ (' + cfg.periods + ' คาบ)');
  const valid = {}; rows_('Users').forEach(u => { if (u.role === 'student') valid[u.id] = 1; });
  const studs = (Array.isArray(d.students) ? d.students : []).map(String).filter((x, i, a) => valid[x] && a.indexOf(x) === i).slice(0, 200);
  if (!studs.length) throw err_('กรุณาเลือกนักเรียนอย่างน้อย 1 คน');
  return lock_(() => {
    delete MEM_.TtSlots;
    const old = d.id ? find_('TtSlots', d.id) : null;
    if (d.id && !old) throw err_('ไม่พบคาบเรียนนี้');
    if (old && old.ownerId !== me.id && !isAdmin_(me)) throw err_('แก้ไขได้เฉพาะคาบของคุณ', 'FORBIDDEN');
    const owner = old ? old.ownerId : me.id;
    const clash = rows_('TtSlots').find(x => x.ownerId === owner && x.id !== (old && old.id) && Number(x.day) === day && Number(x.period) < period + span && Number(x.period) + (Number(x.span) || 1) > period);
    if (clash) throw err_('ช่วงเวลานี้มีคาบเรียนอื่นอยู่แล้ว (คาบ ' + clash.period + ')');
    const ex = (Array.isArray(d.extras) ? d.extras : []).map(String).filter(id => studs.indexOf(id) >= 0);
    const patch = { day: String(day), period: String(period), span: String(span), courseId: c.id, grade: str_(d.grade, 20), room: str_(d.room, 20), students: studs, extras: ex, note: str_(d.note, 200), updatedAt: now_() };
    const row = old ? updateRow_('TtSlots', old, patch) : insert_('TtSlots', Object.assign({ id: id_(), ownerId: owner, createdAt: now_() }, patch));
    log_(me.id, old ? 'tt_edit' : 'tt_add', row.id);
    const cs = {}, users = {}; rows_('Courses').forEach(k => cs[k.id] = k); rows_('Users').forEach(u => users[u.id] = u);
    return slotOut_(row, me, cs, users);
  });
}
function ttDeleteSlot_(ctx, id) {
  const me = ctx.user;
  return lock_(() => { delete MEM_.TtSlots; const x = find_('TtSlots', id); if (!x) throw err_('ไม่พบคาบเรียนนี้');
    if (x.ownerId !== me.id && !isAdmin_(me)) throw err_('ลบได้เฉพาะคาบของคุณ', 'FORBIDDEN');
    deleteWhere_('TtSlots', r => r.id === x.id); log_(me.id, 'tt_delete', id); return true; });
}
/** นักเรียนในคาบ: เฉพาะชั้น/ห้องที่ตั้งไว้ + นักเรียนห้องอื่นที่ครูเพิ่มเอง (extras) */
function slotStudentIds_(x) {
  const ids = json_(x.students, []), ex = json_(x.extras, []); if (!x.grade) return ids;
  const users = {}; rows_('Users').forEach(u => users[u.id] = u);
  return ids.filter(id => { const u = users[id]; return u && (ex.indexOf(id) >= 0 || (u.grade === x.grade && (!x.room || u.room === x.room))); });
}
function slotCan_(me, x) { if (!x) return false; if (isAdmin_(me) || x.ownerId === me.id) return true; return teaches_(me, find_('Courses', x.courseId)); }
function dateOk_(v) { v = str_(v, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw err_('วันที่ไม่ถูกต้อง'); return v; }
function attStudents_(x) {
  const ids = slotStudentIds_(x), users = {}; rows_('Users').forEach(u => users[u.id] = u);
  return ids.map(id => users[id]).filter(Boolean).map(u => ({ id: u.id, classNo: u.classNo || '', studentCode: u.studentCode, name: userName_(u), grade: u.grade, room: u.room, avatar: u.avatar || '' }))
    .sort((a, b) => String(a.grade + '/' + a.room).localeCompare(String(b.grade + '/' + b.room)) || (Number(a.classNo) || 999) - (Number(b.classNo) || 999));
}
/** เปิดหน้าเช็คชื่อคาบ (slot) ของวันที่กำหนด — done = ครูเช็คชื่อ/บันทึกแล้ว (ครูร่วมจะได้รับแจ้งว่า "มีการเช็คชื่อเรียบร้อยแล้ว") */
function attOpen_(ctx, slotId, date) {
  const me = ctx.user, x = find_('TtSlots', slotId); date = dateOk_(date);
  if (!slotCan_(me, x)) throw err_('ไม่พบคาบเรียนนี้', 'FORBIDDEN');
  const r = rows_('Attendance').find(a => a.slotId === x.id && a.date === date), cs = {}, users = {};
  rows_('Courses').forEach(c => cs[c.id] = c); rows_('Users').forEach(u => users[u.id] = u);
  return { slot: slotOut_(x, me, cs, users), date: date, dowOk: dowOf_(date) === Number(x.day), students: attStudents_(x), records: r ? json_(r.records, {}) : {},
    done: !!(r && r.checkedBy), checkedBy: r && r.checkedBy ? userName_(users[r.checkedBy]) : '', checkedAt: r ? r.checkedAt : '', updatedAt: r ? r.updatedAt : '', statuses: ATT_ST };
}
function attSave_(ctx, slotId, date, records, opt) {
  const me = ctx.user, x = find_('TtSlots', slotId); date = dateOk_(date); opt = opt || {};
  if (!slotCan_(me, x)) throw err_('ไม่พบคาบเรียนนี้', 'FORBIDDEN');
  if (date > now_().slice(0, 10)) throw err_('เช็คชื่อล่วงหน้าไม่ได้');
  const ids = slotStudentIds_(x), recs = {};
  Object.keys(records || {}).forEach(k => { const v = records[k] || {}; if (ids.indexOf(k) < 0 || ATT_ST.indexOf(v.st) < 0) return; recs[k] = { st: v.st, note: str_(v.note, 200), at: str_(v.at, 19), by: v.by === 'self' ? 'self' : 'teacher' }; });
  const miss = ids.filter(k => !recs[k]); if (miss.length && !opt.partial) throw err_('ยังเช็คชื่อไม่ครบ (' + miss.length + ' คน)');
  return lock_(() => {
    delete MEM_.Attendance;
    const r = rows_('Attendance').find(a => a.slotId === x.id && a.date === date);
    if (r && r.checkedBy && !opt.edit) throw err_('มีการเช็คชื่อเรียบร้อยแล้ว (โดย ' + nameOf_(r.checkedBy) + ' เวลา ' + String(r.checkedAt).slice(11, 16) + ' น.)', 'ATT_DONE');
    const prev = r ? json_(r.records, {}) : {}; Object.keys(prev).forEach(k => { if (!recs[k] && ids.indexOf(k) >= 0) recs[k] = prev[k]; });
    const patch = { records: recs, checkedBy: me.id, checkedAt: now_(), updatedAt: now_() };
    if (r) updateRow_('Attendance', r, patch); else insert_('Attendance', Object.assign({ id: id_(), slotId: x.id, date: date, ownerId: x.ownerId, courseId: x.courseId, createdAt: now_() }, patch));
    log_(me.id, r ? 'att_edit' : 'att_save', x.id + ' ' + date);
    const c = find_('Courses', x.courseId) || {}, cnt = attCount_(recs);
    const to = [x.ownerId, c.ownerId].concat(String(c.teachers || '').split(',')).concat(rows_('Users').filter(u => isAdmin_(u) && u.status === 'active').map(u => u.id));
    notifyStaff_(me, (r && r.checkedBy ? 'แก้ไขการเช็คชื่อ: ' : 'เช็คชื่อเสร็จแล้ว: ') + (c.name || 'รายวิชา'), userName_(me) + ' · ' + date + ' คาบ ' + x.period + ' ' + (x.grade || '') + (x.room ? '/' + x.room : '') + ' — ' + ATT_ST.filter(k => cnt[k]).map(k => ATT_TH[k] + ' ' + cnt[k]).join(' · '), 'attendance:' + x.id + ':' + date, to);
    return { ok: true, counts: cnt };
  });
}
function attCount_(recs) { const c = {}; ATT_ST.forEach(k => c[k] = 0); Object.keys(recs || {}).forEach(k => { const st = (recs[k] || {}).st; if (c[st] !== undefined) c[st]++; }); return c; }
/** ประวัติการเช็คชื่อ (ภาคเรียนที่กำลังดู) */
function attHistory_(ctx, d) {
  d = d || {}; const me = ctx.user, vis = {}, cs = {}, users = {};
  ttVisible_(me).forEach(x => vis[x.id] = x); rows_('Courses').forEach(c => cs[c.id] = c); rows_('Users').forEach(u => users[u.id] = u);
  return rows_('Attendance').filter(a => vis[a.slotId] && a.checkedBy && (!d.from || a.date >= d.from) && (!d.to || a.date <= d.to))
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.checkedAt).localeCompare(String(a.checkedAt))).slice(0, 300)
    .map(a => { const x = vis[a.slotId], so = slotOut_(x, me, cs, users); return { id: a.id, slotId: a.slotId, date: a.date, period: so.period, span: so.span, start: so.start, end: so.end, courseName: so.courseName, grade: so.grade, room: so.room,
      counts: attCount_(json_(a.records, {})), total: so.students.length, checkedBy: userName_(users[a.checkedBy]), checkedAt: a.checkedAt }; });
}
/** สรุปสถานะการเช็คชื่อ: วันที่เลือก + ทั้งภาคเรียน */
function attSummary_(ctx, date) {
  const me = ctx.user, vis = {}; ttVisible_(me).forEach(x => vis[x.id] = 1); date = date ? dateOk_(date) : now_().slice(0, 10);
  const rows = rows_('Attendance').filter(a => vis[a.slotId]), day = {}, term = {}; ATT_ST.forEach(k => { day[k] = 0; term[k] = 0; });
  rows.forEach(a => { const c = attCount_(json_(a.records, {})); ATT_ST.forEach(k => { term[k] += c[k]; if (a.date === date) day[k] += c[k]; }); });
  return { date: date, day: day, term: term, sessions: rows.filter(a => a.date === date && a.checkedBy).length, totalSessions: rows.filter(a => a.checkedBy).length };
}
/* ---------- ฝั่งนักเรียน: เช็คชื่อด้วยตนเอง (เฉพาะช่วงเวลาเรียน) + QR ประจำตัว ---------- */
function attSecret_() { let s = props_().getProperty('ATT_SECRET'); if (!s) { s = id_() + id_(); props_().setProperty('ATT_SECRET', s); } return s; }
function attToken_(u) { return 'CPA1.' + u.id + '.' + sha_(attSecret_() + ':' + u.id).replace(/[^\w]/g, '').slice(0, 12); }
function attDecode_(ctx, token) {
  const m = String(token || '').match(/CPA1\.([\w]+)\.([\w]+)/); if (!m) throw err_('QR นี้ไม่ใช่ QR เช็คชื่อของ Classroom +');
  const u = find_('Users', m[1]); if (!u || u.role !== 'student' || attToken_(u) !== m[0]) throw err_('QR ไม่ถูกต้องหรือไม่พบนักเรียนในภาคเรียนนี้');
  return { id: u.id, name: userName_(u), studentCode: u.studentCode, classNo: u.classNo || '', grade: u.grade, room: u.room };
}
function myAttend_(ctx) {
  const u = ctx.user; if (u.role !== 'student') return { slots: [], history: [], token: '', today: todayInfo_() };
  const t = todayInfo_(), cs = {}, users = {}; rows_('Courses').forEach(c => cs[c.id] = c); rows_('Users').forEach(x => users[x.id] = x);
  const mine = rows_('TtSlots').filter(x => slotStudentIds_(x).indexOf(u.id) >= 0), att = rows_('Attendance').filter(a => json_(a.records, {})[u.id] !== undefined || mine.some(x => x.id === a.slotId));
  const st = (sid, date) => { const a = att.find(r => r.slotId === sid && r.date === date); return a ? (json_(a.records, {})[u.id] || null) : null; };
  const week = mine.map(x => { const o = slotOut_(x, u, cs, users), cfg = ttCfgOf_(x.ownerId), pt = periodTime_(cfg, o.period, o.span); delete o.students;
    o.today = o.day === t.dow; o.open = o.today && t.min >= pt.start - 10 && t.min <= pt.end; o.past = o.today && t.min > pt.end; o.rec = o.today ? st(x.id, t.date) : null; return o; })
    .sort((a, b) => a.day - b.day || a.period - b.period);
  const history = att.map(a => { const rec = json_(a.records, {})[u.id]; if (!rec) return null; const x = mine.find(y => y.id === a.slotId); const c = cs[(x || a).courseId] || {};
    return { date: a.date, period: x ? Number(x.period) : '', courseName: c.name || '-', st: rec.st, note: rec.note || '' }; }).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
  const sum = {}; ATT_ST.forEach(k => sum[k] = history.filter(h => h.st === k).length);
  return { slots: week, history: history, summary: sum, token: attToken_(u), today: t };
}
function attCheckIn_(ctx, slotId) {
  const u = ctx.user; if (u.role !== 'student') throw err_('เฉพาะนักเรียน', 'FORBIDDEN');
  if (props_().getProperty('ATT_SELF') !== '1') throw err_('การเช็คชื่อทำโดยครูผู้สอนเท่านั้น (แสดง QR ประจำตัวให้ครูสแกน)', 'FORBIDDEN');
  const x = find_('TtSlots', slotId), t = todayInfo_();
  if (!x || slotStudentIds_(x).indexOf(u.id) < 0) throw err_('คุณไม่ได้อยู่ในคาบเรียนนี้', 'FORBIDDEN');
  const cfg = ttCfgOf_(x.ownerId), pt = periodTime_(cfg, Number(x.period), x.span);
  if (Number(x.day) !== t.dow || t.min < pt.start - 10 || t.min > pt.end) throw err_('เช็คชื่อได้เฉพาะช่วงเวลาเรียนของคาบนี้ (' + fmtHm_(pt.start) + '–' + fmtHm_(pt.end) + ' น.) — เช็คชื่อย้อนหลังไม่ได้');
  throttle_('ci_' + u.id, 10, 5)();
  return lock_(() => {
    delete MEM_.Attendance;
    const r = rows_('Attendance').find(a => a.slotId === x.id && a.date === t.date), recs = r ? json_(r.records, {}) : {};
    if (recs[u.id]) throw err_('คุณเช็คชื่อคาบนี้แล้ว (' + ({ present: 'มาเรียน', late: 'สาย' }[recs[u.id].st] || 'ครูบันทึกแล้ว') + ')');
    const stt = t.min > pt.start + (Number(cfg.lateMin) || 0) ? 'late' : 'present';
    recs[u.id] = { st: stt, note: '', at: now_(), by: 'self' };
    if (r) updateRow_('Attendance', r, { records: recs, updatedAt: now_() });
    else insert_('Attendance', { id: id_(), slotId: x.id, date: t.date, ownerId: x.ownerId, courseId: x.courseId, records: recs, checkedBy: '', checkedAt: '', createdAt: now_(), updatedAt: now_() });
    log_(u.id, 'att_self', x.id);
    return { st: stt, at: now_() };
  });
}

/** รูปที่แชร์สาธารณะไม่ได้ (บัญชีโรงเรียน): ส่งข้อมูลรูปผ่านระบบ — เฉพาะไฟล์ในโฟลเดอร์ของระบบเท่านั้น */
function fileData_(ctx, id) {
  id = str_(id, 80); if (!/^[\w-]{20,}$/.test(id)) throw err_('รหัสไฟล์ไม่ถูกต้อง');
  const ck = 'fd_' + id, c = getBig_(ck); if (c) return c;
  const roots = {}; [mainDriveId_(), coreDriveId_(), driveId_()].concat(Object.keys(tenants_()).map(k => tenants_()[k].driveId)).forEach(x => { if (x) roots[x] = 1; });
  try { Object.keys(dbMap_()).forEach(k => { const d = dbMap_()[k].driveId; if (d) roots[d] = 1; }); } catch (e) {}
  const f = DriveApp.getFileById(id), mime = f.getMimeType();
  if (!/^image\//.test(mime)) throw err_('ไม่ใช่ไฟล์รูปภาพ');
  let ok = false, q = [f.getParents()], depth = 0;
  while (q.length && !ok && depth < 8) { const nq = []; q.forEach(it => { while (it.hasNext()) { const p = it.next(); if (roots[p.getId()]) ok = true; else nq.push(p.getParents()); } }); q = nq; depth++; }
  if (!ok) { try { ok = f.getOwner() && f.getOwner().getEmail() === Session.getEffectiveUser().getEmail(); } catch (e) {} } // ไฟล์ที่ระบบอัปโหลดเอง
  if (!ok) throw err_('ไม่มีสิทธิ์เข้าถึงไฟล์นี้', 'FORBIDDEN');
  if (f.getSize() > 6 * 1024 * 1024) throw err_('ไฟล์รูปใหญ่เกินไป');
  const out = 'data:' + mime + ';base64,' + Utilities.base64Encode(f.getBlob().getBytes());
  putBig_(ck, out, 21600);
  return out;
}

/* ---------- v5.5 แจ้งเตือนครู/ผู้ดูแลระบบร่วมกัน ---------- */
const CFG_TH = { schoolName: 'ชื่อโรงเรียน', logo: 'โลโก้', welcome: 'ข้อความต้อนรับ', allowAdminSignup: 'การสมัครบัญชีครู', requireApproval: 'การอนุมัติบัญชี', sessionHours: 'อายุเซสชัน', rememberDays: 'จดจำการเข้าสู่ระบบ',
  emailNotify: 'อีเมลแจ้งเตือน', lineToken: 'LINE', autoBackup: 'สำรองข้อมูลอัตโนมัติ', webNotify: 'แจ้งเตือนบนเว็บ', siteUrl: 'ลิงก์หน้าเว็บ', assignmentTypes: 'ประเภทงาน', themeColor: 'สีระบบ', studentMenus: 'เมนูนักเรียน', scoreSources: 'ที่มาของคะแนนเก็บ' };
function notifyStaff_(me, title, body, link, ids) {
  try { const to = (ids || rows_('Users').filter(u => staff_(u) && u.status === 'active').map(u => u.id)).filter((x, i, a) => x && x !== me.id && a.indexOf(x) === i);
    if (to.length) notifyUsers_(to, title, str_(body, 300), link || ''); } catch (e) { console.error('notifyStaff', e); }
}
function settingsChanged_(me, what, tab) { notifyStaff_(me, 'มีการเปลี่ยนการตั้งค่าระบบ', userName_(me) + ' แก้ไข: ' + what, 'settings:' + (tab || 'general')); }

/* ---------- v5.6 เมนู "คะแนนนักเรียน" (ครู/ผู้ดูแลระบบ) ---------- */
function myScoreSources_(me) {
  const out = json_(cfg_().scoreSources, []).map(x => Object.assign({ scope: 'system' }, x)), cs = {}; rows_('Courses').forEach(c => cs[c.id] = c);
  rows_('Users').filter(t => staff_(t) && t.prefs && (t.id === me.id || isAdmin_(me))).forEach(t => ((json_(t.prefs, {}) || {}).scoreSources || []).forEach(x => out.push(Object.assign({ scope: t.id === me.id ? 'mine' : 'teacher', by: userName_(t) }, x))));
  return out.filter(x => isAdmin_(me) || x.scope === 'mine' || !(x.courseIds || []).length || x.courseIds.some(c => teaches_(me, cs[c])))
    .map(x => Object.assign({}, x, { courseNames: (x.courseIds || []).map(c => (cs[c] || {}).name).filter(Boolean) }));
}
function scoreBooks_(ctx) { return myScoreSources_(ctx.user).map(x => ({ id: x.id, name: x.name, terms: x.terms || [], courseNames: x.courseNames, grades: x.grades || [], rooms: x.rooms || [], scope: x.scope, by: x.by || '' })); }
function scoreBook_(ctx, id, refresh) {
  const x = myScoreSources_(ctx.user).find(y => y.id === String(id)); if (!x) throw err_('ไม่พบที่มาของคะแนนนี้', 'NOTFOUND');
  const ck = 'sb_' + (props_().getProperty('SCORE_V') || '') + x.id; if (!refresh) { const c = getBig_(ck); if (c) return json_(c, null); }
  const t = sheetTables_(srcUrl_(x.url)), sheets = [];
  t.tables.forEach((tb, i) => { const b = parseBook_(tb); if (b && b.students.length) sheets.push(Object.assign({ name: (t.names || [])[i] || 'แผ่นงาน ' + (i + 1) }, b)); });
  // รหัสนักเรียนจากข้อมูลผู้ใช้งาน (จับคู่ชื่อ-สกุล) เมื่อในชีตไม่มีรหัส
  const byName = {}; rows_('Users').forEach(u => { if (u.role === 'student' && u.fullName) byName[nmKey_(u.fullName)] = u; });
  sheets.forEach(sh => sh.students.forEach(st => { if (st.code) return; const m = byName[nmKey_(st.name)] || byName[nmKey_(st.prefix + st.name)]; if (m) st.code = m.studentCode; }));
  const cs = {}; rows_('Courses').forEach(c => cs[c.id] = c);
  const out = { id: x.id, name: x.name, file: t.name, url: srcUrl_(x.url), courseNames: (x.courseIds || []).map(c => (cs[c] || {}).name).filter(Boolean), terms: x.terms || [], sheets: sheets, at: now_() };
  putBig_(ck, JSON.stringify(out), 900); return out;
}
/** แคชข้อมูลขนาดใหญ่ (แบ่งเป็นชิ้น ≤ 90KB สูงสุด ~2.7MB) */
function putBig_(k, str, sec) { try { const n = Math.ceil(str.length / 90000); if (n > 30) return; const o = { [k + '#n']: String(n) }; for (let i = 0; i < n; i++) o[k + '#' + i] = str.slice(i * 90000, (i + 1) * 90000); cache_().putAll(o, sec || 21600); } catch (e) {} }
function getBig_(k) { try { const c = cache_(), n = Number(c.get(k + '#n') || 0); if (!n) return null; const keys = []; for (let i = 0; i < n; i++) keys.push(k + '#' + i); const g = c.getAll(keys); if (keys.some(x => g[x] == null)) return null; return keys.map(x => g[x]).join(''); } catch (e) { return null; } }
/* ---------- v5.6 เช็คชื่อ: คัดลอกจากคาบก่อน · ส่งออก ---------- */
function attCopyFrom_(ctx, slotId, date) {
  const me = ctx.user, x = find_('TtSlots', slotId); date = dateOk_(date);
  if (!slotCan_(me, x)) throw err_('ไม่พบคาบเรียนนี้', 'FORBIDDEN');
  const mine = slotStudentIds_(x), cs = {}; rows_('Courses').forEach(c => cs[c.id] = c);
  const slots = {}; rows_('TtSlots').forEach(y => slots[y.id] = y);
  return rows_('Attendance').filter(a => a.date === date && a.slotId !== x.id && slots[a.slotId]).map(a => {
    const y = slots[a.slotId], recs = json_(a.records, {}), r = {}; mine.forEach(id => { if (recs[id]) r[id] = { st: recs[id].st, note: recs[id].note || '' }; });
    return { slotId: y.id, period: Number(y.period), courseName: (cs[y.courseId] || {}).name || '-', grade: y.grade, room: y.room, checked: !!a.checkedBy, matched: Object.keys(r).length, records: r };
  }).filter(o => o.matched).sort((a, b) => b.period - a.period);
}
function attExport_(ctx, d) {
  d = d || {}; const me = ctx.user, vis = {}, cs = {}, users = {};
  ttVisible_(me).forEach(x => vis[x.id] = x); rows_('Courses').forEach(c => cs[c.id] = c); rows_('Users').forEach(u => users[u.id] = u);
  const rows = [];
  rows_('Attendance').filter(a => vis[a.slotId] && a.checkedBy && (!d.from || a.date >= d.from) && (!d.to || a.date <= d.to) && (!d.slotId || a.slotId === d.slotId))
    .sort((a, b) => a.date.localeCompare(b.date) || Number(vis[a.slotId].period) - Number(vis[b.slotId].period)).forEach(a => {
      const x = vis[a.slotId], c = cs[x.courseId] || {}, recs = json_(a.records, {});
      Object.keys(recs).forEach(id => { const u = users[id] || {}; rows.push([a.date, DAY_TH_[dowOf_(a.date)], Number(x.period), c.code || '', c.name || '', (u.grade || x.grade || '') + '/' + (u.room || x.room || ''), u.classNo || '', u.studentCode || '', userName_(u), ATT_TH[recs[id].st] || recs[id].st, recs[id].note || '', userName_(users[a.checkedBy])]); });
    });
  rows.sort((a, b) => a[0].localeCompare(b[0]) || a[2] - b[2] || String(a[5]).localeCompare(String(b[5])) || (Number(a[6]) || 999) - (Number(b[6]) || 999));
  return { headers: ['วันที่', 'วัน', 'คาบ', 'รหัสวิชา', 'รายวิชา', 'ชั้น/ห้อง', 'เลขที่', 'รหัสนักเรียน', 'ชื่อ-สกุล', 'สถานะ', 'หมายเหตุ', 'ผู้เช็คชื่อ'], rows: rows };
}
const DAY_TH_ = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
