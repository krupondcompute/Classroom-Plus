/** Classroom Plus: Google Apps Script backend. Configure SPREADSHEET_ID and DRIVE_FOLDER_ID in Script Properties. */
const CP = Object.freeze({
  sheets: {
    Config: ['key','value','updatedAt'],
    Users: ['id','role','username','studentCode','passwordSalt','passwordHash','displayName','email','classId','status','createdAt','updatedAt','deletedAt'],
    Sessions: ['id','userId','tokenHash','expiresAt','createdAt'],
    Classes: ['id','name','grade','ownerId','createdAt','updatedAt','deletedAt'],
    Courses: ['id','classId','name','description','ownerId','createdAt','updatedAt','deletedAt'],
    Lessons: ['id','courseId','title','content','mediaUrl','ownerId','createdAt','updatedAt','deletedAt'],
    Announcements: ['id','classId','title','body','ownerId','createdAt','updatedAt','deletedAt'],
    Assignments: ['id','courseId','title','description','dueAt','maxPoints','ownerId','createdAt','updatedAt','deletedAt'],
    Submissions: ['id','assignmentId','studentId','text','fileUrl','submittedAt','updatedAt','deletedAt'],
    Grades: ['id','submissionId','studentId','points','feedback','gradedBy','gradedAt'],
    AuditLog: ['id','actorId','action','entityType','entityId','details','createdAt']
  },
  sessionDays: 7,
  maxUploadBytes: 8 * 1024 * 1024,
  props: PropertiesService.getScriptProperties()
});

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate().setTitle('Classroom Plus').addMetaTag('viewport','width=device-width, initial-scale=1');
}
function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

/** Idempotent: creates missing tabs/headers only; never clears existing rows. */
function setup() {
  const id = CP.props.getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('ตั้งค่า SPREADSHEET_ID ใน Script Properties ก่อนเรียก setup()');
  const ss = SpreadsheetApp.openById(id);
  Object.keys(CP.sheets).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const headers = CP.sheets[name];
    if (sh.getLastRow() === 0) sh.getRange(1,1,1,headers.length).setValues([headers]);
    else {
      const existing = sh.getRange(1,1,1,Math.max(sh.getLastColumn(), headers.length)).getValues()[0];
      headers.forEach(h => { if (!existing.includes(h)) { const col = Math.max(sh.getLastColumn(),1)+1; sh.getRange(1,col).setValue(h); } });
    }
    sh.setFrozenRows(1);
  });
  const config = readRows_('Config');
  if (!config.some(r => r.key === 'requireApproval')) appendRows_('Config', [{key:'requireApproval',value:'false',updatedAt:now_()}]);
  return {ok:true, message:'สร้าง/ตรวจโครงสร้างชีตแล้ว โดยไม่ลบข้อมูลเดิม'};
}

/** Run manually from the Apps Script editor after setting BOOTSTRAP_NAME. Returns the one-time password once. */
function bootstrapFirstTeacher() {
  const existing=readRows_('Users');
  if(existing.some(u=>!u.deletedAt&&(u.role==='teacher'||u.role==='admin'))) throw new Error('มีบัญชีครูแล้ว ปิดการ bootstrap แล้ว');
  const name=clean_(CP.props.getProperty('BOOTSTRAP_NAME'),100);
  if(!name) throw new Error('ตั้งค่า BOOTSTRAP_NAME ใน Script Properties ก่อน');
  const username='teacher-'+Utilities.getUuid().slice(0,8), password=token_().slice(0,32), salt=token_();
  appendRows_('Users',[{id:uuid_(),role:'teacher',username,studentCode:'',passwordSalt:salt,passwordHash:hash_(password,salt),displayName:name,email:'',classId:'',status:'active',createdAt:now_(),updatedAt:now_(),deletedAt:''}]);
  audit_('system','bootstrap','User',username,{});
  return {username,password,message:'จดรหัสผ่านนี้ไว้ทันที จากนั้นเปลี่ยนรหัสผ่านในระบบ (เมนูเปลี่ยนรหัสผ่านยังไม่อยู่ใน MVP)'};
}

function api(action, payload) {
  payload = payload || {};
  const allowed = { register, login, logout, me, dashboard, listCourses, saveCourse, listLessons, saveLesson, listAnnouncements, saveAnnouncement, listAssignments, saveAssignment, submitAssignment, listSubmissions, gradeSubmission, listClasses, saveClass };
  if (!Object.prototype.hasOwnProperty.call(allowed, action)) throw new Error('ไม่รองรับคำขอนี้');
  return allowed[action](payload);
}
function register(p) {
  const name = clean_(p.displayName,100), username = String(p.username||'').trim().toLowerCase(), pass = String(p.password||'');
  if (!name || !/^[0-9]{5}$/.test(String(p.studentCode||''))) throw new Error('กรุณากรอกชื่อและรหัสนักเรียน 5 หลัก');
  if (!/^[a-z0-9._-]{4,30}$/.test(username) || pass.length < 10) throw new Error('ชื่อบัญชี 4–30 ตัวอักษร และรหัสผ่านอย่างน้อย 10 ตัว');
  const users = readRows_('Users');
  if (users.some(u => !u.deletedAt && (u.username===username || u.studentCode===String(p.studentCode)))) throw new Error('ข้อมูลบัญชีนี้ไม่สามารถใช้สมัครได้');
  const salt = token_();
  const pending = readConfig_('requireApproval') === 'true';
  const user = {id:uuid_(),role:'student',username,studentCode:String(p.studentCode),passwordSalt:salt,passwordHash:hash_(pass,salt),displayName:name,email:clean_(p.email,160),classId:'',status:pending?'pending':'active',createdAt:now_(),updatedAt:now_(),deletedAt:''};
  appendRows_('Users',[user]); audit_(user.id,'register','User',user.id,{});
  return {ok:true,pending};
}
function login(p) {
  const loginName = String(p.username||'').trim().toLowerCase(), pass = String(p.password||'');
  const users=readRows_('Users');
  const u=users.find(x=>!x.deletedAt && (x.username===loginName || (x.role==='student' && x.studentCode===loginName)));
  if (!u || u.status!=='active' || !constantTime_(hash_(pass,u.passwordSalt),u.passwordHash)) throw new Error('เข้าสู่ระบบไม่ได้ กรุณาตรวจข้อมูลหรือสถานะบัญชี');
  const raw=token_(), id=uuid_(), expires=new Date(Date.now()+CP.sessionDays*86400000).toISOString();
  appendRows_('Sessions',[{id,userId:u.id,tokenHash:hash_(raw,'session-v1'),expiresAt:expires,createdAt:now_()}]);
  return {token:raw,user:safeUser_(u),expiresAt:expires};
}
function logout(p) { const t=String(p.token||''); if(t) { const h=hash_(t,'session-v1'); updateWhere_('Sessions',r=>r.tokenHash===h,{expiresAt:now_()}); } return {ok:true}; }
function me(p) { return {user:safeUser_(auth_(p))}; }
function dashboard(p) {
  const u=auth_(p); const courses=visible_('Courses',u); const assignments=visible_('Assignments',u); const submissions=readRows_('Submissions').filter(s=>!s.deletedAt);
  return {user:safeUser_(u),courses:courses.length,assignments:assignments.length,pendingReview:u.role==='teacher'?submissions.filter(s=>!readRows_('Grades').some(g=>g.submissionId===s.id)).length:0,upcoming:assignments.filter(a=>a.dueAt && a.dueAt>=now_()).slice(0,5)};
}
function listCourses(p){const u=auth_(p);return visible_('Courses',u).map(c=>({...c,className:byId_('Classes',c.classId)?.name||''}));}
function saveCourse(p){const u=teacher_(p);const name=clean_(p.name,120);if(!name)throw new Error('กรุณากรอกชื่อวิชา');const row={id:p.id||uuid_(),classId:String(p.classId||''),name,description:clean_(p.description,1000),ownerId:u.id,updatedAt:now_()};if(p.id){const old=byId_('Courses',p.id);if(!old||old.ownerId!==u.id)throw new Error('ไม่มีสิทธิ์แก้ไขวิชานี้');updateById_('Courses',row.id,row);}else{row.createdAt=now_();row.deletedAt='';appendRows_('Courses',[row]);}audit_(u.id,p.id?'edit':'create','Course',row.id,{});return row;}
function listLessons(p){const u=auth_(p);const ids=visible_('Courses',u).map(c=>c.id);return readRows_('Lessons').filter(r=>!r.deletedAt&&ids.includes(r.courseId));}
function saveLesson(p){const u=teacher_(p);if(!visible_('Courses',u).some(c=>c.id===p.courseId))throw new Error('ไม่มีสิทธิ์ในวิชานี้');const row={id:p.id||uuid_(),courseId:String(p.courseId),title:clean_(p.title,160),content:clean_(p.content,5000),mediaUrl:safeUrl_(p.mediaUrl),ownerId:u.id,updatedAt:now_()};if(!row.title)throw new Error('กรุณากรอกชื่อบทเรียน');if(p.id)updateById_('Lessons',row.id,row);else{row.createdAt=now_();row.deletedAt='';appendRows_('Lessons',[row]);}audit_(u.id,p.id?'edit':'create','Lesson',row.id,{});return row;}
function listAnnouncements(p){const u=auth_(p);return readRows_('Announcements').filter(a=>!a.deletedAt&&(u.role==='teacher'||!a.classId||a.classId===u.classId));}
function saveAnnouncement(p){const u=teacher_(p);const row={id:p.id||uuid_(),classId:String(p.classId||''),title:clean_(p.title,160),body:clean_(p.body,4000),ownerId:u.id,updatedAt:now_()};if(!row.title)throw new Error('กรุณากรอกหัวข้อประกาศ');if(p.id)updateById_('Announcements',row.id,row);else{row.createdAt=now_();row.deletedAt='';appendRows_('Announcements',[row]);}audit_(u.id,p.id?'edit':'create','Announcement',row.id,{});return row;}
function listAssignments(p){const u=auth_(p);const courses=visible_('Courses',u).map(c=>c.id);return readRows_('Assignments').filter(a=>!a.deletedAt&&courses.includes(a.courseId));}
function saveAssignment(p){const u=teacher_(p);if(!visible_('Courses',u).some(c=>c.id===p.courseId))throw new Error('ไม่มีสิทธิ์ในวิชานี้');const points=Number(p.maxPoints||100);if(!Number.isFinite(points)||points<1||points>10000)throw new Error('คะแนนเต็มไม่ถูกต้อง');const row={id:p.id||uuid_(),courseId:String(p.courseId),title:clean_(p.title,160),description:clean_(p.description,3000),dueAt:String(p.dueAt||''),maxPoints:points,ownerId:u.id,updatedAt:now_()};if(!row.title)throw new Error('กรุณากรอกชื่องาน');if(p.id)updateById_('Assignments',row.id,row);else{row.createdAt=now_();row.deletedAt='';appendRows_('Assignments',[row]);}audit_(u.id,p.id?'edit':'create','Assignment',row.id,{});return row;}
function submitAssignment(p){const u=auth_(p);if(u.role!=='student')throw new Error('ส่งงานได้เฉพาะบัญชีนักเรียน');const a=byId_('Assignments',String(p.assignmentId));if(!a||a.deletedAt||!visible_('Courses',u).some(c=>c.id===a.courseId))throw new Error('ไม่พบงานหรือไม่มีสิทธิ์ส่ง');if(a.dueAt&&Date.now()>new Date(a.dueAt).getTime())throw new Error('เลยกำหนดส่งแล้ว');const fileUrl=safeUrl_(p.fileUrl);const text=clean_(p.text,5000);if(!text&&!fileUrl)throw new Error('เพิ่มคำตอบหรือ URL ไฟล์ก่อนส่ง');const rows=readRows_('Submissions');const old=rows.find(s=>s.assignmentId===a.id&&s.studentId===u.id&&!s.deletedAt);const row={id:old?old.id:uuid_(),assignmentId:a.id,studentId:u.id,text,fileUrl,submittedAt:old?old.submittedAt:now_(),updatedAt:now_(),deletedAt:''};if(old)updateById_('Submissions',row.id,row);else appendRows_('Submissions',[row]);return {ok:true};}
function listSubmissions(p){const u=auth_(p);const subs=readRows_('Submissions').filter(s=>!s.deletedAt);const allowed=visible_('Assignments',u).map(a=>a.id);return subs.filter(s=>u.role==='teacher'?allowed.includes(s.assignmentId):s.studentId===u.id).map(s=>({...s,studentName:byId_('Users',s.studentId)?.displayName||'',grade:readRows_('Grades').find(g=>g.submissionId===s.id)||null}));}
function gradeSubmission(p){const u=teacher_(p);const s=byId_('Submissions',String(p.submissionId)), points=Number(p.points);if(!s||s.deletedAt||!listAssignments({token:p.token}).some(a=>a.id===s.assignmentId))throw new Error('ไม่มีสิทธิ์ตรวจงานนี้');const a=byId_('Assignments',s.assignmentId);if(!Number.isFinite(points)||points<0||points>Number(a.maxPoints))throw new Error('คะแนนอยู่นอกช่วงที่กำหนด');const old=readRows_('Grades').find(g=>g.submissionId===s.id);const row={id:old?old.id:uuid_(),submissionId:s.id,studentId:s.studentId,points,feedback:clean_(p.feedback,2000),gradedBy:u.id,gradedAt:now_()};if(old)updateById_('Grades',row.id,row);else appendRows_('Grades',[row]);audit_(u.id,'grade','Submission',s.id,{points});return {ok:true};}
function listClasses(p){const u=auth_(p);return readRows_('Classes').filter(c=>!c.deletedAt&&(u.role==='teacher'||u.id===c.ownerId||u.classId===c.id));}
function saveClass(p){const u=teacher_(p),name=clean_(p.name,100);if(!name)throw new Error('กรุณากรอกชื่อห้อง');const row={id:p.id||uuid_(),name,grade:clean_(p.grade,40),ownerId:u.id,updatedAt:now_()};if(p.id)updateById_('Classes',row.id,row);else{row.createdAt=now_();row.deletedAt='';appendRows_('Classes',[row]);}return row;}

function auth_(p){const t=String(p.token||'');if(!t)throw new Error('กรุณาเข้าสู่ระบบ');const h=hash_(t,'session-v1'),s=readRows_('Sessions').find(x=>x.tokenHash===h&&new Date(x.expiresAt).getTime()>Date.now());if(!s)throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');const u=byId_('Users',s.userId);if(!u||u.deletedAt||u.status!=='active')throw new Error('บัญชีนี้ไม่พร้อมใช้งาน');return u;}
function teacher_(p){const u=auth_(p);if(u.role!=='teacher'&&u.role!=='admin')throw new Error('ต้องใช้สิทธิ์ครู');return u;}
function visible_(sheet,u){return readRows_(sheet).filter(r=>!r.deletedAt&&(u.role==='teacher'||u.role==='admin'||(sheet==='Courses'?classAccess_(r.classId,u):sheet==='Assignments'?classAccess_(byId_('Courses',r.courseId)?.classId,u):r.ownerId===u.id)));}
function classAccess_(classId,u){return !classId||u.classId===classId||u.role==='teacher'||u.role==='admin';}
function safeUser_(u){return {id:u.id,role:u.role,username:u.username,displayName:u.displayName,email:u.email,classId:u.classId,status:u.status};}
function byId_(sheet,id){return readRows_(sheet).find(r=>r.id===id)||null;}
function readRows_(name){const id=CP.props.getProperty('SPREADSHEET_ID');if(!id)throw new Error('ผู้ดูแลยังไม่ได้ตั้งค่า SPREADSHEET_ID');const sh=SpreadsheetApp.openById(id).getSheetByName(name);if(!sh||sh.getLastRow()<2)return [];const v=sh.getDataRange().getValues(),heads=v.shift();return v.filter(row=>row.some(x=>x!==''&&x!==null)).map(row=>Object.fromEntries(heads.map((h,i)=>[h,row[i] instanceof Date?row[i].toISOString():row[i]])));}
function appendRows_(name,rows){if(!rows.length)return;const sh=SpreadsheetApp.openById(CP.props.getProperty('SPREADSHEET_ID')).getSheetByName(name),heads=CP.sheets[name];const values=rows.map(r=>heads.map(h=>r[h]===undefined?'':r[h]));const lock=LockService.getScriptLock();lock.waitLock(10000);try{sh.getRange(sh.getLastRow()+1,1,values.length,heads.length).setValues(values);}finally{lock.releaseLock();}}
function updateById_(name,id,obj){const sh=SpreadsheetApp.openById(CP.props.getProperty('SPREADSHEET_ID')).getSheetByName(name),v=sh.getDataRange().getValues(),heads=v[0],idx=heads.indexOf('id');for(let i=1;i<v.length;i++)if(String(v[i][idx])===String(id)){heads.forEach((h,j)=>{if(Object.prototype.hasOwnProperty.call(obj,h))v[i][j]=obj[h];});sh.getRange(i+1,1,1,heads.length).setValues([v[i]]);return;}throw new Error('ไม่พบรายการที่ต้องการแก้ไข');}
function updateWhere_(name,pred,changes){const rows=readRows_(name);rows.filter(pred).forEach(r=>updateById_(name,r.id,changes));}
function readConfig_(key){const r=readRows_('Config').find(x=>x.key===key);return r?String(r.value):'';}
function audit_(actor,action,type,id,details){appendRows_('AuditLog',[{id:uuid_(),actorId:actor,action,entityType:type,entityId:id,details:JSON.stringify(details||{}),createdAt:now_()}]);}
function hash_(s,salt){let out=String(salt)+':'+String(s);for(let i=0;i<12000;i++)out=Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,out,Utilities.Charset.UTF_8));return out;}
function constantTime_(a,b){if(!b||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
function token_(){return Utilities.getUuid()+Utilities.getUuid()+Utilities.getUuid();}
function uuid_(){return Utilities.getUuid();}
function now_(){return new Date().toISOString();}
function clean_(v,max){return String(v||'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').trim().slice(0,max);}
function safeUrl_(v){const s=String(v||'').trim();if(!s)return '';if(!/^https:\/\//i.test(s))throw new Error('ลิงก์ต้องขึ้นต้นด้วย https://');return s.slice(0,1000);}
