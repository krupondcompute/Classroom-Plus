
/* =========================================================
 * เข้าสู่ระบบ / ลงทะเบียน / ลืมรหัสนักเรียน
 * ========================================================= */
let AUTH_TAB = 'student';
function pwInput(id, label, attrs = '') {
  return `<div class="mb-3"><label class="form-label" for="${id}">${label}</label><div class="pw"><input class="form-control" type="password" id="${id}" ${attrs}><button type="button" class="eye btn-icon" data-eye="${id}" aria-label="แสดง/ซ่อน"><i class="fa-solid fa-eye"></i></button></div><div class="caps hidden" data-caps="${id}"><i class="fa-solid fa-triangle-exclamation"></i> Caps Lock เปิดอยู่</div><div class="invalid-msg" data-err="${id}"></div></div>`;
}
function bindPw(root) {
  $$('[data-eye]', root).forEach(b => b.onclick = () => { const i = $('#' + b.dataset.eye); i.type = i.type === 'password' ? 'text' : 'password'; b.innerHTML = `<i class="fa-solid fa-eye${i.type === 'text' ? '-slash' : ''}"></i>`; });
  $$('.pw input', root).forEach(i => ['keyup', 'keydown'].forEach(ev => i.addEventListener(ev, e => { const c = $(`[data-caps="${i.id}"]`); c && c.classList.toggle('hidden', !(e.getModifierState && e.getModifierState('CapsLock'))); })));
}
function renderLogin(tab = AUTH_TAB) {
  AUTH_TAB = tab;
  const c = S.config, R = $('#authRight'), stu = tab === 'student';
  R.innerHTML = `<h2>เข้าสู่ระบบ</h2>
  <div class="seg ${stu ? 'right' : ''}" role="tablist"><span class="thumb"></span>
    <button type="button" role="tab" class="${stu ? '' : 'active'}" data-tab="admin" aria-selected="${!stu}">Admin(ครูผู้สอน)</button>
    <button type="button" role="tab" class="${stu ? 'active' : ''}" data-tab="student" aria-selected="${stu}">User(นักเรียน)</button></div>
  <form id="loginForm" novalidate>
    ${stu ? pwInput('lgCode', 'รหัสนักเรียน (5 หลัก)', 'inputmode="numeric" maxlength="5" autocomplete="username" pattern="\\d{5}" required')
      + (c.studentLogin === 'code+birth' ? `<div class="mb-3"><label class="form-label">วันเกิด</label>${dobHtml('lgDob', '')}<div class="invalid-msg" data-err="lgDob"></div></div>` : '')
      : `<div class="mb-3"><label class="form-label" for="lgUser">Username</label><input class="form-control" id="lgUser" autocomplete="username" required><div class="invalid-msg" data-err="lgUser"></div></div>` + pwInput('lgPass', 'Password', 'autocomplete="current-password" required')}
    <div class="form-check mb-3"><input class="form-check-input" type="checkbox" id="lgRemember"><label class="form-check-label" for="lgRemember">จดจำฉัน (30 วัน)</label></div>
    <button class="btn btn-primary w-100 btn-lg" type="submit"><i class="fa-solid fa-right-to-bracket me-2"></i>เข้าสู่ระบบ</button>
  </form>
  <div class="d-flex justify-content-between flex-wrap gap-2 mt-3">
    ${stu ? `<button class="btn btn-link px-0" id="toReg"><i class="fa-solid fa-user-plus"></i> ลงทะเบียน</button><button class="btn btn-link px-0" id="toForgot">ลืมรหัสนักเรียน</button>`
      : (c.allowAdminSignup === 'true' ? `<button class="btn btn-link px-0" id="toRegAdmin"><i class="fa-solid fa-user-plus"></i> สมัครบัญชีครูผู้สอน</button>` : '')}
  </div>`;
  bindPw(R);
  $$('[data-tab]', R).forEach(b => b.onclick = () => renderLogin(b.dataset.tab));
  $('#toReg', R) && ($('#toReg', R).onclick = () => wizard('student'));
  $('#toRegAdmin', R) && ($('#toRegAdmin', R).onclick = () => wizard('admin'));
  $('#toForgot', R) && ($('#toForgot', R).onclick = forgotCode);
  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    const remember = $('#lgRemember').checked, err = (k, m) => { $(`[data-err="${k}"]`).textContent = m; return !m; };
    let payload;
    if (stu) {
      const code = $('#lgCode').value.trim(), dob = $('#lgDob') ? readDob('lgDob') : '';
      const ok = err('lgCode', /^\d{5}$/.test(code) ? '' : 'กรุณากรอกตัวเลข 5 หลัก') & ($('#lgDob') ? err('lgDob', dob && dob !== 'invalid' ? '' : 'กรุณาเลือกวันเกิด') : true);
      if (!ok) return;
      payload = { mode: 'student', studentCode: code, birthDate: dob, remember };
    } else {
      const u = $('#lgUser').value.trim(), p = $('#lgPass').value;
      if (!(err('lgUser', u ? '' : 'กรุณากรอก Username') & err('lgPass', p ? '' : 'กรุณากรอกรหัสผ่าน'))) return;
      payload = { mode: 'admin', username: u, password: p, remember };
    }
    const res = await apiMsg('กำลังเข้าสู่ระบบ...', 'login', payload);
    loginDone(res, remember);
  };
}
function loginDone(res, remember) {
  S.token = res.token; S.user = res.user; S.expiresAt = res.expiresAt;
  store.del('cp_token');
  store.set('cp_token', res.token, remember); store.set('cp_exp', String(res.expiresAt), remember);
  toast('ยินดีต้อนรับ ' + res.user.fullName);
  enterApp();
}
/* Wizard 3 ขั้นตอน (นักเรียน / ครูผู้สอน) */
function wizard(role) {
  const W = { step: 1, d: {} }, R = $('#authRight'), stu = role === 'student';
  const PREFIX = ['เด็กชาย', 'เด็กหญิง', 'นาย', 'นางสาว', 'นาง', 'อื่นๆ'];
  const draw = () => {
    const d = W.d;
    R.innerHTML = `<div class="d-flex align-items-center gap-2 mb-2"><button class="btn btn-soft btn-icon" id="wBack" aria-label="กลับ"><i class="fa-solid fa-arrow-left"></i></button><h2 class="m-0">${stu ? 'ลงทะเบียนนักเรียน' : 'สมัครบัญชีครูผู้สอน'}</h2></div>
    <div class="steps">${['ข้อมูลทั่วไป', 'บัญชี', 'ยืนยันข้อมูล'].map((t, i) => `<div class="${W.step >= i + 1 ? 'on' : ''}"><b>${W.step > i + 1 ? '<i class="fa-solid fa-check"></i>' : i + 1}</b>${t}</div>`).join('')}</div>
    <div class="progress mb-3" role="progressbar" aria-valuenow="${W.step * 33}"><div class="progress-bar" style="width:${Math.round(W.step / 3 * 100)}%"></div></div>
    <form id="wForm" novalidate>${W.step === 1 ? `
      <div class="mb-3"><label class="form-label" for="wPrefix">คำนำหน้าชื่อ</label><select class="form-select" id="wPrefix"><option value="">เลือก</option>${opt(PREFIX, PREFIX.includes(d.prefix) ? d.prefix : d.prefix ? 'อื่นๆ' : '')}</select>
        <input class="form-control mt-2 ${d.prefix && !PREFIX.includes(d.prefix) ? '' : 'hidden'}" id="wPrefixOther" placeholder="ระบุคำนำหน้า" value="${esc(PREFIX.includes(d.prefix) ? '' : d.prefix || '')}"><div class="invalid-msg" data-err="prefix"></div></div>
      <div class="mb-3"><label class="form-label" for="wName">ชื่อ-สกุล</label><input class="form-control" id="wName" value="${esc(d.fullName || '')}" placeholder="เช่น สมชาย ใจดี"><div class="invalid-msg" data-err="fullName"></div></div>
      <div class="mb-3"><label class="form-label">วัน/เดือน/ปีเกิด</label>${dobHtml('wDob', d.birthDate)}<div class="invalid-msg" data-err="birthDate"></div></div>
      ${stu && S.classes.length ? `<div class="row g-2"><div class="col-6 mb-3"><label class="form-label" for="wGrade">ระดับชั้น</label><select class="form-select" id="wGrade"><option value="">เลือก</option>${opt(grades(), d.grade)}</select><div class="invalid-msg" data-err="grade"></div></div>
        <div class="col-6 mb-3"><label class="form-label" for="wRoom">ห้อง</label><select class="form-select" id="wRoom">${opt(rooms(d.grade), d.room)}</select></div></div>` : ''}`
      : W.step === 2 ? (stu ? `
      <div class="mb-3"><label class="form-label" for="wCode">รหัสนักเรียน (ตัวเลข 5 หลัก)</label><input class="form-control" id="wCode" inputmode="numeric" maxlength="5" value="${esc(d.studentCode || '')}"><div class="form-text" id="wCodeMsg"></div><div class="invalid-msg" data-err="studentCode"></div></div>`
      : `<div class="mb-3"><label class="form-label" for="wUser">Username</label><input class="form-control" id="wUser" autocomplete="username" value="${esc(d.username || '')}" placeholder="a-z 0-9 . _ (4–20 ตัว)"><div class="form-text" id="wUserMsg"></div><div class="invalid-msg" data-err="username"></div></div>
      ${pwInput('wPass', 'Password (อย่างน้อย 8 ตัว)', 'autocomplete="new-password"')}<div class="strength mb-1"><i id="wStr"></i></div><div class="small text-muted mb-3" id="wStrTxt"></div>
      ${pwInput('wPass2', 'ยืนยัน Password', 'autocomplete="new-password"')}`)
      : `<div class="summary mb-3">${[['คำนำหน้า', d.prefix], ['ชื่อ-สกุล', d.fullName], ['วันเกิด', thDate(d.birthDate)]].concat(stu ? [['ระดับชั้น/ห้อง', (d.grade || '-') + (d.room ? '/' + d.room : '')], ['รหัสนักเรียน', d.studentCode]] : [['Username', d.username]]).map(r => `<div><span class="text-muted">${r[0]}</span><b>${esc(r[1])}</b></div>`).join('')}</div>
      <div class="form-check mb-2"><input class="form-check-input" type="checkbox" id="wOk"><label class="form-check-label" for="wOk">ข้าพเจ้ายืนยันว่าข้อมูลถูกต้อง และยินยอมให้เก็บและใช้ข้อมูลส่วนบุคคลเพื่อการจัดการเรียนการสอนตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล (PDPA)</label></div><div class="invalid-msg" data-err="consent"></div>`}
      <div class="d-flex gap-2 mt-3">${W.step > 1 ? `<button type="button" class="btn btn-soft flex-fill" id="wPrev"><i class="fa-solid fa-pen"></i> ${W.step === 3 ? 'แก้ไข' : 'ย้อนกลับ'}</button>` : ''}
      <button class="btn btn-primary flex-fill" type="submit">${W.step < 3 ? 'ถัดไป <i class="fa-solid fa-arrow-right"></i>' : '<i class="fa-solid fa-check"></i> ยืนยันสมัครใช้งาน'}</button></div></form>`;
    bindPw(R);
    $('#wBack').onclick = () => renderLogin(stu ? 'student' : 'admin');
    $('#wPrev') && ($('#wPrev').onclick = () => { W.step--; draw(); });
    const E = (k, m) => { const el = $(`[data-err="${k}"]`); if (el) el.textContent = m || ''; return !m; };
    if (W.step === 1) {
      $('#wPrefix').onchange = () => $('#wPrefixOther').classList.toggle('hidden', $('#wPrefix').value !== 'อื่นๆ');
      $('#wGrade') && ($('#wGrade').onchange = () => { $('#wRoom').innerHTML = opt(rooms($('#wGrade').value)); });
    }
    if (W.step === 2 && stu) $('#wCode').addEventListener('input', debounce(async () => {
      const v = $('#wCode').value.trim(), m = $('#wCodeMsg');
      if (!/^\d{5}$/.test(v)) { m.innerHTML = '<span class="text-danger">ต้องเป็นตัวเลข 5 หลัก</span>'; return; }
      m.textContent = 'กำลังตรวจสอบ...';
      const r = await apiQ('checkStudentCode', v).catch(() => null);
      m.innerHTML = r && r.available ? '<span class="text-success"><i class="fa-solid fa-check"></i> ใช้รหัสนี้ได้</span>' : '<span class="text-danger"><i class="fa-solid fa-xmark"></i> รหัสนี้ถูกใช้แล้ว</span>';
    }, 400));
    if (W.step === 2 && !stu) {
      $('#wUser').addEventListener('input', debounce(async () => {
        const v = $('#wUser').value.trim().toLowerCase(), m = $('#wUserMsg');
        if (!/^[a-z0-9._]{4,20}$/.test(v)) { m.innerHTML = '<span class="text-danger">4–20 ตัว a-z 0-9 . _</span>'; return; }
        const r = await apiQ('checkUsername', v).catch(() => null);
        m.innerHTML = r && r.available ? '<span class="text-success"><i class="fa-solid fa-check"></i> ใช้ชื่อนี้ได้</span>' : '<span class="text-danger"><i class="fa-solid fa-xmark"></i> ชื่อนี้ถูกใช้แล้ว</span>';
      }, 400));
      $('#wPass').addEventListener('input', () => {
        const p = $('#wPass').value; let s = 0;
        if (p.length >= 8) s++; if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++; if (/\d/.test(p)) s++; if (/[^\w]/.test(p) || p.length >= 12) s++;
        $('#wStr').style.width = s * 25 + '%'; $('#wStr').style.background = ['#dc2626', '#dc2626', '#f59e0b', '#22c55e', '#16a34a'][s];
        $('#wStrTxt').textContent = 'ความแข็งแรง: ' + ['อ่อนมาก', 'อ่อน', 'พอใช้', 'ดี', 'แข็งแรงมาก'][s];
      });
    }
    $('#wForm').onsubmit = async e => {
      e.preventDefault();
      if (W.step === 1) {
        const pf = $('#wPrefix').value === 'อื่นๆ' ? $('#wPrefixOther').value.trim() : $('#wPrefix').value;
        const name = $('#wName').value.trim().replace(/\s+/g, ' '), dob = readDob('wDob');
        const ok = [E('prefix', pf ? '' : 'กรุณาเลือกคำนำหน้าชื่อ'), E('fullName', name.length >= 3 && name.includes(' ') ? '' : 'กรุณากรอกชื่อและนามสกุล (เว้นวรรคระหว่างชื่อกับสกุล)'),
          E('birthDate', dobValid(dob)), $('#wGrade') ? E('grade', $('#wGrade').value ? '' : 'กรุณาเลือกระดับชั้น') : true].every(Boolean);
        if (!ok) return;
        Object.assign(W.d, { prefix: pf, fullName: name, birthDate: dob, grade: $('#wGrade') ? $('#wGrade').value : '', room: $('#wRoom') ? $('#wRoom').value : '' });
      } else if (W.step === 2) {
        if (stu) {
          const v = $('#wCode').value.trim();
          if (!E('studentCode', /^\d{5}$/.test(v) ? '' : 'รหัสนักเรียนต้องเป็นตัวเลข 5 หลัก')) return;
          const r = await api('checkStudentCode', v);
          if (!E('studentCode', r.available ? '' : 'รหัสนักเรียนนี้ถูกใช้แล้ว')) return;
          W.d.studentCode = v;
        } else {
          const u = $('#wUser').value.trim().toLowerCase(), p = $('#wPass').value, p2 = $('#wPass2').value;
          const ok = [E('username', /^[a-z0-9._]{4,20}$/.test(u) ? '' : 'Username 4–20 ตัว a-z 0-9 . _'), E('wPass', p.length >= 8 ? '' : 'รหัสผ่านอย่างน้อย 8 ตัว'), E('wPass2', p === p2 ? '' : 'ยืนยันรหัสผ่านไม่ตรงกัน')].every(Boolean);
          if (!ok) return;
          const r = await api('checkUsername', u);
          if (!E('username', r.available ? '' : 'Username นี้ถูกใช้แล้ว')) return;
          Object.assign(W.d, { username: u, password: p, confirm: p2 });
        }
      } else {
        if (!E('consent', $('#wOk').checked ? '' : 'กรุณาติ๊กยืนยันก่อนสมัคร')) return;
        if (!await confirmBox({ title: 'ยืนยันสมัครใช้งาน', html: `สร้างบัญชีสำหรับ <b>${esc(W.d.prefix + W.d.fullName)}</b> ?` })) return;
        const res = await apiMsg('กำลังบันทึกข้อมูล...', stu ? 'registerStudent' : 'registerAdmin', Object.assign({ consent: true }, W.d));
        if (res.pending) { await Swal.fire({ icon: 'info', title: 'สมัครเรียบร้อย', text: 'บัญชีของคุณรอการอนุมัติจาก Admin ก่อนใช้งาน' }); return renderLogin('admin'); }
        return loginDone(res, false);
      }
      W.step++; draw();
    };
  };
  draw();
}
function forgotCode() {
  const m = modal('ลืมรหัสนักเรียน', `<p class="text-muted">ยืนยันตัวตนด้วยชื่อ-สกุลและวันเกิดที่ลงทะเบียนไว้ แล้วตั้งรหัสนักเรียนใหม่ (หรือติดต่อครูผู้สอนให้รีเซ็ตให้)</p>
    <div class="mb-3"><label class="form-label" for="fgName">ชื่อ-สกุล (ไม่ต้องใส่คำนำหน้า)</label><input class="form-control" id="fgName"></div>
    <div class="mb-3"><label class="form-label">วันเกิด</label>${dobHtml('fgDob', '')}</div>
    <div class="mb-3"><label class="form-label" for="fgCode">รหัสนักเรียนใหม่ (5 หลัก)</label><input class="form-control" id="fgCode" inputmode="numeric" maxlength="5"></div>`,
    `<button class="btn btn-soft" data-bs-dismiss="modal">ยกเลิก</button><button class="btn btn-primary" id="fgGo">ยืนยัน</button>`, 'modal-md');
  $('#fgGo').onclick = async () => {
    const d = { fullName: $('#fgName').value.trim(), birthDate: readDob('fgDob'), newCode: $('#fgCode').value.trim() };
    if (!d.fullName || !d.birthDate || d.birthDate === 'invalid' || !/^\d{5}$/.test(d.newCode)) return toast('กรุณากรอกข้อมูลให้ครบถ้วน', 'warning');
    if (!await confirmBox({ title: 'ยืนยันการตั้งรหัสใหม่', html: `ตั้งรหัสนักเรียนใหม่เป็น <b>${esc(d.newCode)}</b> ?` })) return;
    await api('forgotCode', d);
    m.hide(); Swal.fire({ icon: 'success', title: 'ตั้งรหัสใหม่เรียบร้อย', text: 'เข้าสู่ระบบด้วยรหัสนักเรียนใหม่ได้ทันที' });
  };
}

/* =========================================================
 * App Shell / Router
 * ========================================================= */
const NAV = {
  student: [['home', 'หน้าหลัก', 'fa-house', 1], ['courses', 'รายวิชา', 'fa-book-open', 1], ['assignments', 'งานของฉัน', 'fa-list-check', 1], ['announcements', 'ประกาศ', 'fa-bullhorn', 1], ['search', 'ค้นหา', 'fa-magnifying-glass'], ['profile', 'โปรไฟล์', 'fa-user', 1]],
  admin: [['dash', 'แดชบอร์ด', 'fa-chart-pie', 1], ['users', 'ผู้ใช้งาน', 'fa-users', 1], ['classes', 'ระดับชั้น/หมวดหมู่', 'fa-layer-group'], ['acourses', 'รายวิชา/บทเรียน', 'fa-book', 1],
    ['aassign', 'งานที่มอบหมาย', 'fa-clipboard-check', 1], ['aann', 'ประกาศ', 'fa-bullhorn'], ['reports', 'รายงาน', 'fa-file-export'], ['settings', 'ตั้งค่าระบบ', 'fa-gear', 1]]
};
const PAGES = {};
const HIDDEN_TITLES = { course: 'รายวิชา', lesson: 'บทเรียน', acourse: 'จัดการรายวิชา', grade: 'ตรวจงาน' };
function enterApp() {
  document.body.className = 'app' + (store.get('cp_side') === '0' ? ' collapsed' : '');
  $('#authView').classList.add('hidden'); $('#appView').classList.remove('hidden');
  const isAdmin = S.user.role === 'admin';
  S.mode = isAdmin ? (store.get('cp_mode') || 'admin') : 'student';
  $('#modeSwitch').classList.toggle('hidden', !isAdmin);
  renderMe(); renderShell();
  go(S.mode === 'admin' ? 'dash' : 'home');
  refreshNotifs();
  S.bg = S.bg || setInterval(() => { if (S.token) { refreshNotifs(); if (S.expiresAt && Date.now() > S.expiresAt) { localLogout(); Swal.fire({ icon: 'info', title: 'หมดเวลาการใช้งาน', text: 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง' }); } } }, 60000);
}
function renderMe() {
  const u = S.user;
  $('#meAvatar').innerHTML = avatarHtml(u); $('#meName').textContent = u.fullName;
  $('#bannerBox').innerHTML = u.role === 'admin' && u.mustChangePassword === 'true'
    ? `<div class="banner"><i class="fa-solid fa-shield-halved"></i><div class="flex-fill">คุณยังใช้รหัสผ่านเริ่มต้นอยู่ กรุณาเปลี่ยน Username/รหัสผ่านเพื่อความปลอดภัย</div><button class="btn btn-sm btn-dark" data-go="settings" data-tab="account">เปลี่ยนเลย</button></div>` : '';
}
function renderShell() {
  const nav = NAV[S.mode];
  $('#sideNav').innerHTML = `<div class="nav-label">${S.mode === 'admin' ? 'โหมด Admin(ครูผู้สอน)' : 'โหมด User(นักเรียน)'}</div>` + nav.map(n => `<button data-go="${n[0]}" aria-label="${n[1]}"><i class="fa-solid ${n[2]}"></i><span>${n[1]}</span></button>`).join('');
  $('#dock').innerHTML = nav.filter(n => n[3]).map(n => `<button data-go="${n[0]}" aria-label="${n[1]}"><i class="fa-solid ${n[2]}"></i><span>${n[1].split('/')[0]}</span></button>`).join('');
  const ms = $('#modeSwitch');
  ms.classList.toggle('student', S.mode === 'student');
  ms.querySelector('.knob').innerHTML = `<i class="fa-solid ${S.mode === 'admin' ? 'fa-chalkboard-user' : 'fa-user-graduate'}"></i>`;
  $('#modeText').textContent = S.mode === 'admin' ? 'โหมด Admin ↔ User' : 'โหมด User ↔ Admin';
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-go]');
  if (b) { e.preventDefault(); go(b.dataset.go, b.dataset.id ? { id: b.dataset.id, tab: b.dataset.tab } : { tab: b.dataset.tab }); }
});
$('#modeSwitch').onclick = () => { S.mode = S.mode === 'admin' ? 'student' : 'admin'; store.set('cp_mode', S.mode); renderShell(); go(S.mode === 'admin' ? 'dash' : 'home'); toast(S.mode === 'admin' ? 'เปลี่ยนเป็นโหมด Admin(ครูผู้สอน)' : 'เปลี่ยนเป็นโหมด User(นักเรียน) — เห็นเฉพาะข้อมูลของคุณ', 'info'); };
$('#sideToggle').onclick = () => {
  if (innerWidth >= 992) { document.body.classList.toggle('collapsed'); store.set('cp_side', document.body.classList.contains('collapsed') ? '0' : '1'); }
  else document.body.classList.toggle('side-open');
  $('#sideToggle i').className = 'fa-solid ' + (innerWidth < 992 && !document.body.classList.contains('side-open') ? 'fa-bars' : 'fa-chevron-left');
};
$('#scrim').onclick = () => { document.body.classList.remove('side-open'); $('#sideToggle i').className = 'fa-solid fa-bars'; };
const fixToggleIcon = () => { $('#sideToggle i').className = 'fa-solid ' + (innerWidth < 992 && !document.body.classList.contains('side-open') ? 'fa-bars' : 'fa-chevron-left'); };
addEventListener('resize', debounce(fixToggleIcon, 150));
$('#logoutBtn').onclick = async () => {
  if (!await confirmBox({ title: 'ออกจากระบบ?', html: 'คุณต้องการออกจากระบบใช่หรือไม่', confirmText: 'ออกจากระบบ' })) return;
  await api('logout').catch(() => {});
  localLogout(); toast('ออกจากระบบแล้ว', 'info');
};
function localLogout() {
  S.token = null; S.user = null; store.del('cp_token'); store.del('cp_exp');
  stopTimers();
  document.body.className = 'auth';
  $('#appView').classList.add('hidden'); $('#authView').classList.remove('hidden');
  bootstrap.Modal.getInstance('#modal')?.hide();
  renderLogin();
}
function stopTimers() { S.timers.forEach(t => clearInterval(t)); S.timers = []; (S.onLeave || []).forEach(f => { try { f(); } catch (e) {} }); S.onLeave = []; Object.values(S.charts || {}).forEach(c => c.destroy()); S.charts = {}; }
function go(page, params = {}) {
  if (!PAGES[page]) page = S.mode === 'admin' ? 'dash' : 'home';
  if (PAGES[page].admin && S.mode !== 'admin') page = 'home';
  stopTimers();
  S.page = page; S.params = params || {};
  $$('[data-go]', $('#appView')).forEach(b => b.classList.toggle('active', b.dataset.go === page || (PAGES[page].parent === b.dataset.go)));
  const nav = NAV.student.concat(NAV.admin).find(n => n[0] === page);
  $('#pageTitle').textContent = nav ? nav[1] : HIDDEN_TITLES[page] || '';
  $('#fab').classList.add('hidden'); $('#fab').onclick = null;
  document.body.classList.remove('side-open'); fixToggleIcon();
  const el = $('#page');
  el.style.animation = 'none'; el.offsetHeight; el.style.animation = '';
  el.innerHTML = skeleton();
  window.scrollTo({ top: 0 });
  Loader.show('กำลังโหลดหน้า...');
  Promise.resolve().then(() => PAGES[page].render(el, S.params))
    .catch(e => { el.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div class="mb-3">${esc(e.message)}</div><button class="btn btn-primary" id="retryBtn"><i class="fa-solid fa-rotate-right"></i> ลองใหม่</button></div>`; $('#retryBtn').onclick = () => go(page, params); })
    .finally(() => Loader.hide());
}
function fab(label, fn) { const f = $('#fab'); f.classList.remove('hidden'); f.setAttribute('aria-label', label); f.title = label; f.onclick = fn; }
function chart(id, cfg) {
  S.charts = S.charts || {};
  const el = document.getElementById(id); if (!el || !window.Chart) return;
  const dark = document.documentElement.dataset.theme === 'dark';
  Chart.defaults.font.family = 'Sarabun'; Chart.defaults.color = dark ? '#cbd5e1' : '#475569';
  S.charts[id] = new Chart(el, cfg);
}

/* ---------------- แจ้งเตือน ---------------- */
async function refreshNotifs() {
  const list = await apiQ('notifications').catch(() => null);
  if (!list) return;
  const unread = list.filter(n => n.read !== 'true');
  $('#bellDot').textContent = unread.length > 9 ? '9+' : unread.length; $('#bellDot').classList.toggle('hidden', !unread.length);
  $('#notifList').innerHTML = list.length ? list.map(n => `<div class="${n.read !== 'true' ? 'unread' : ''}" data-link="${esc(n.link)}" role="button" tabindex="0"><b>${esc(n.title)}</b><div class="small">${esc(n.body)}</div><small class="text-muted">${thDate(n.createdAt, true)}</small></div>`).join('') : '<div class="text-muted text-center py-4">ไม่มีการแจ้งเตือน</div>';
  const newest = unread[0];
  if (newest && S.lastNotif && newest.createdAt > S.lastNotif && S.config.webNotify === 'true' && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification(newest.title, { body: newest.body }); } catch (e) {}
  }
  if (list[0]) S.lastNotif = list[0].createdAt;
}
$('#bellBtn').addEventListener('click', () => { if ('Notification' in window && Notification.permission === 'default' && S.config.webNotify === 'true') { try { Notification.requestPermission(); } catch (e) {} } });
$('#readAll').onclick = async e => { e.stopPropagation(); await apiQ('markRead'); refreshNotifs(); };
$('#notifList').addEventListener('click', e => {
  const d = e.target.closest('[data-link]'); if (!d) return;
  const [k, id] = d.dataset.link.split(':');
  if (k === 'grade' && S.user.role === 'admin') { S.mode = 'admin'; renderShell(); return go('grade', { id }); }
  if (S.mode === 'admin' && k !== 'grade') { S.mode = 'student'; renderShell(); }
  ({ lesson: () => go('lesson', { id }), assignment: () => go('assignments'), announcement: () => go('announcements') }[k] || (() => {}))();
});
