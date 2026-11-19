
/* =========================================================
 * หน้าสำหรับ Admin(ครูผู้สอน)
 * ========================================================= */
async function lists(force) {
  if (force || !S.cache.at || Date.now() - S.cache.at > 30000) {
    const [courses, categories, users] = await Promise.all([apiQ('list', 'Courses'), apiQ('list', 'Categories'), apiQ('listUsers')]);
    Object.assign(S.cache, { courses, categories, users, admins: users.filter(u => u.role === 'admin'), at: Date.now() });
  }
  return S.cache;
}
const ownerName = id => (S.cache.users || []).find(u => u.id === id)?.fullName || '-';
const ownerFilter = () => `<select class="form-select w-auto" data-f="owner" aria-label="เจ้าของข้อมูล"><option value="">เจ้าของข้อมูล: ทุกคน</option>${opt((S.cache.admins || []).map(a => [a.id, a.fullName]))}</select>`;
const byOwner = (it, root) => { const v = $('[data-f="owner"]', root)?.value; return !v || it.ownerId === v; };
const gradeOpts = () => [['', 'ทุกระดับชั้น']].concat(grades());
const roomOpts = () => [['', 'ทุกห้อง']].concat(rooms());
const FIELDS = {
  Courses: () => [{ k: 'code', label: 'รหัสวิชา', col: 'col-md-4' }, { k: 'name', label: 'ชื่อวิชา', req: true, col: 'col-md-8' },
    { k: 'category', label: 'หมวดหมู่', type: 'select', opts: () => [['', '- ไม่ระบุ -']].concat(S.cache.categories.map(c => c.name)), col: 'col-md-4' },
    { k: 'grade', label: 'ระดับชั้น', type: 'select', opts: gradeOpts, col: 'col-md-4' }, { k: 'room', label: 'ห้องเรียน', type: 'select', opts: roomOpts, col: 'col-md-4' },
    { k: 'teacher', label: 'ครูผู้สอน', col: 'col-md-8', def: S.user.prefix + S.user.fullName }, { k: 'order', label: 'ลำดับ', type: 'number', col: 'col-md-4' },
    { k: 'description', label: 'คำอธิบายรายวิชา', type: 'textarea' }, { k: 'cover', label: 'รูปปก', type: 'image' }],
  Lessons: () => [{ k: 'courseId', label: 'รายวิชา', type: 'select', req: true, opts: () => S.cache.courses.map(c => [c.id, c.name]) },
    { k: 'unit', label: 'หน่วยการเรียน', col: 'col-md-8', help: 'เช่น หน่วยที่ 1 แนวคิดเชิงคำนวณ (บทเรียนในหน่วยเดียวกันจะถูกจัดกลุ่ม)' }, { k: 'order', label: 'ลำดับบทเรียน', type: 'number', col: 'col-md-4' },
    { k: 'title', label: 'ชื่อบทเรียน (หัวข้อย่อย)', req: true }, { k: 'description', label: 'คำอธิบาย / เนื้อหา', type: 'textarea', rows: 6 },
    { k: 'cover', label: 'รูปปก', type: 'image' }, { k: 'videoUrl', label: 'วิดีโอ', type: 'video', help: 'รองรับ YouTube, Vimeo, Google Drive หรืออัปโหลดไฟล์วิดีโอ (ไม่เกิน 20 MB)' },
    { k: 'videoDuration', label: 'ความยาววิดีโอ', col: 'col-md-6', attrs: 'placeholder="เช่น 12:30"' }, { k: 'duration', label: 'ระยะเวลาเรียน (นาที)', type: 'number', col: 'col-md-6' },
    { k: 'attachments', label: 'เอกสารประกอบ / ไฟล์ดาวน์โหลด (PDF, Word, PowerPoint, รูป, ZIP)', type: 'files' }, { k: 'links', label: 'ลิงก์ภายนอก (เว็บไซต์ / Google Drive / YouTube)', type: 'links' },
    { k: 'publishAt', label: 'วันที่เผยแพร่ (เว้นว่าง = ทันที)', type: 'datetime', col: 'col-md-6' }, { k: 'closeAt', label: 'วันที่ปิดการเข้าถึง (เว้นว่าง = ไม่ปิด)', type: 'datetime', col: 'col-md-6', valid: (v, o) => v && o.publishAt && v <= o.publishAt ? 'ต้องหลังวันเผยแพร่' : '' }],
  Assignments: () => [{ k: 'courseId', label: 'รายวิชา', type: 'select', req: true, opts: () => S.cache.courses.map(c => [c.id, c.name]) },
    { k: 'type', label: 'ประเภท', type: 'select', opts: ['การบ้าน', 'ใบงาน', 'แบบฝึกหัด'], col: 'col-md-4' }, { k: 'title', label: 'ชื่องาน', req: true, col: 'col-md-8' },
    { k: 'description', label: 'รายละเอียด / คำสั่ง', type: 'textarea', rows: 5 }, { k: 'attachments', label: 'ไฟล์แนบ', type: 'files' },
    { k: 'dueAt', label: 'วันและเวลาส่ง', type: 'datetime', req: true, col: 'col-md-6' }, { k: 'maxScore', label: 'คะแนนเต็ม', type: 'number', req: true, def: 10, col: 'col-md-6', valid: v => +v > 0 ? '' : 'ต้องมากกว่า 0' }],
  Announcements: () => [{ k: 'type', label: 'ประเภท', type: 'select', opts: ['ข่าวสาร', 'แจ้งกำหนดส่ง', 'แจ้งเปลี่ยนแปลง', 'แจ้งสอบ'], col: 'col-md-4' }, { k: 'title', label: 'หัวข้อ', req: true, col: 'col-md-8' },
    { k: 'body', label: 'รายละเอียด', type: 'textarea', rows: 5 }, { k: 'image', label: 'รูปภาพ', type: 'image', w: 900, h: 600 }, { k: 'attachments', label: 'ไฟล์แนบ', type: 'files' },
    { k: 'courseId', label: 'เฉพาะรายวิชา', type: 'select', opts: () => [['', 'ทุกรายวิชา']].concat(S.cache.courses.map(c => [c.id, c.name])), col: 'col-md-4' },
    { k: 'grade', label: 'ระดับชั้น', type: 'select', opts: gradeOpts, col: 'col-md-4' }, { k: 'room', label: 'ห้อง', type: 'select', opts: roomOpts, col: 'col-md-4' },
    { k: 'pinned', label: 'ปักหมุดประกาศ', type: 'check' }],
  Classes: () => [{ k: 'grade', label: 'ระดับชั้น', req: true, col: 'col-md-5', attrs: 'placeholder="เช่น ม.1"' }, { k: 'room', label: 'ห้อง', col: 'col-md-4', attrs: 'placeholder="เช่น 1"' }, { k: 'order', label: 'ลำดับ', type: 'number', col: 'col-md-3' }],
  Categories: () => [{ k: 'name', label: 'ชื่อหมวดหมู่', req: true }]
};
const LABEL = { Courses: 'รายวิชา', Lessons: 'บทเรียน', Assignments: 'งาน', Announcements: 'ประกาศ', Classes: 'ระดับชั้น/ห้อง', Categories: 'หมวดหมู่' };
const nameOf = (e, r) => r.name || r.title || (r.grade ? r.grade + (r.room ? '/' + r.room : '') : '');
async function crudForm(entity, row = {}, after) {
  await lists();
  const F = FIELDS[entity](), isNew = !row.id;
  const m = modal((isNew ? 'เพิ่ม' : 'แก้ไข') + LABEL[entity], formHtml(F, row), `<button class="btn btn-soft" data-bs-dismiss="modal">ยกเลิก</button><button class="btn btn-primary" id="crudSave"><i class="fa-solid fa-floppy-disk"></i> บันทึก</button>`);
  bindForm(m.body, F);
  $('#crudSave').onclick = async () => {
    const d = validate(m.body, F);
    if (!d) return toast('กรุณาตรวจสอบข้อมูลที่ไม่ถูกต้อง', 'warning');
    if (!await confirmBox({ title: (isNew ? 'ยืนยันการเพิ่ม' : 'ยืนยันการแก้ไข') + LABEL[entity], html: `<b>${esc(nameOf(entity, d))}</b>` + (isNew && ['Lessons', 'Assignments', 'Announcements'].includes(entity) ? '<br><small class="text-muted">ระบบจะแจ้งเตือนนักเรียนที่เกี่ยวข้อง</small>' : '') })) return;
    if (row.id) d.id = row.id;
    const r = await apiMsg('กำลังบันทึก...', 'save', entity, d);
    m.hide(); toast((isNew ? 'เพิ่ม' : 'บันทึก') + LABEL[entity] + 'แล้ว'); S.cache.at = 0; after && after(r);
  };
}
async function crudDelete(entity, row, warn, after) {
  if (!await confirmBox({ title: 'ยืนยันการลบ' + LABEL[entity], html: `ลบ <b>${esc(nameOf(entity, row))}</b> ?${warn ? `<br><span class="text-danger small">${warn}</span>` : ''}<br><small>การลบไม่สามารถย้อนกลับได้</small>`, danger: true, confirmText: 'ลบ' })) return;
  await apiMsg('กำลังลบ...', 'remove', entity, row.id);
  toast('ลบ' + LABEL[entity] + 'แล้ว'); S.cache.at = 0; after && after();
}
const actBtns = (id, extra = '') => `<div class="d-flex gap-1 justify-content-end">${extra}<button class="btn btn-sm btn-icon btn-soft" data-edit="${esc(id)}" aria-label="แก้ไข"><i class="fa-solid fa-pen"></i></button><button class="btn btn-sm btn-icon btn-soft text-danger" data-del="${esc(id)}" aria-label="ลบ"><i class="fa-solid fa-trash"></i></button></div>`;
function bindActs(root, items, entity, warn, reload) {
  root.onclick = e => {
    const ed = e.target.closest('[data-edit]'), de = e.target.closest('[data-del]');
    if (ed) crudForm(entity, items.find(x => x.id === ed.dataset.edit), reload);
    if (de) crudDelete(entity, items.find(x => x.id === de.dataset.del), warn, reload);
  };
}

/* ---------------- Dashboard ---------------- */
PAGES.dash = { admin: true, async render(el) {
  const draw = async (quiet) => {
    const d = await apiQ('adminDashboard'), c = d.cards;
    const html = `<div class="page-head"><h3>แดชบอร์ดครูผู้สอน</h3><span class="chip ok"><i class="fa-solid fa-circle fa-2xs"></i> อัปเดตอัตโนมัติทุก 60 วินาที</span></div>
    ${c.pendingUsers ? `<div class="banner mx-0 mb-3"><i class="fa-solid fa-user-clock"></i><div class="flex-fill">มีผู้สมัครรออนุมัติ ${c.pendingUsers} คน</div><button class="btn btn-sm btn-dark" data-go="users">ตรวจสอบ</button></div>` : ''}
    <div class="grid g4 mb-3">${statCard('fa-book', c.courses, 'รายวิชา')}${statCard('fa-book-open-reader', c.lessons, 'จำนวนบทเรียน', 'background:#ede9fe;color:#7c3aed')}${statCard('fa-user-graduate', c.students, 'จำนวนผู้เรียน', 'background:#dcfce7;color:#15803d')}${statCard('fa-clipboard-question', c.ungraded, 'งานที่ยังไม่ตรวจ', 'background:#fee2e2;color:#b91c1c')}</div>
    <div class="grid g2"><div class="card-x"><h5 class="fw-bold">สถิติการเข้าเรียน (14 วัน)</h5><canvas id="chLogin" height="200"></canvas></div>
    <div class="card-x"><h5 class="fw-bold">กราฟการส่งงาน (14 วัน)</h5><canvas id="chSub" height="200"></canvas></div>
    <div class="card-x"><h5 class="fw-bold">สถานะงานที่ส่ง</h5><div style="max-width:280px;margin:auto"><canvas id="chStat"></canvas></div></div>
    <div class="card-x"><h5 class="fw-bold">กิจกรรมล่าสุด</h5>${d.recent.map(r => `<div class="d-flex gap-2 py-1 border-bottom small"><span class="chip">${esc(r.action)}</span><span class="flex-fill">${esc(r.user)}</span><span class="text-muted">${thDate(r.at, true)}</span></div>`).join('') || empty('fa-clock', 'ยังไม่มีกิจกรรม')}</div></div>`;
    stopCharts(); el.innerHTML = html;
    const labels = d.days.map(x => thDate(x).replace(/ \d{4}$/, ''));
    chart('chLogin', { type: 'line', data: { labels, datasets: [{ label: 'เข้าสู่ระบบ', data: d.logins, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,.15)', fill: true, tension: .35 }, { label: 'เปิดบทเรียน', data: d.views, borderColor: '#38bdf8', tension: .35 }] }, options: { scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } });
    chart('chSub', { type: 'bar', data: { labels, datasets: [{ label: 'งานที่ส่ง', data: d.submissions, backgroundColor: '#3b82f6', borderRadius: 8 }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } });
    chart('chStat', { type: 'doughnut', data: { labels: ['ตรงเวลา', 'ส่งช้า', 'ตรวจแล้ว'], datasets: [{ data: [d.status.ontime, d.status.late, d.status.graded], backgroundColor: ['#22c55e', '#f59e0b', '#2563eb'] }] } });
  };
  await draw();
  S.timers.push(setInterval(() => S.page === 'dash' && draw(true).catch(() => {}), 60000));
} };
function stopCharts() { Object.values(S.charts || {}).forEach(c => c.destroy()); S.charts = {}; }

/* ---------------- ผู้ใช้งาน ---------------- */
PAGES.users = { admin: true, async render(el) {
  const users = await apiQ('listUsers'); S.cache.users = users; S.cache.admins = users.filter(u => u.role === 'admin');
  el.innerHTML = `<div class="page-head"><h3>จัดการผู้ใช้งาน</h3><button class="btn btn-soft" id="impBtn"><i class="fa-solid fa-file-import"></i> นำเข้า Excel/CSV</button><button class="btn btn-soft" id="expBtn"><i class="fa-solid fa-file-excel"></i> ส่งออก</button><input type="file" id="impFile" accept=".xlsx,.xls,.csv" class="hidden"></div><div id="ul"></div>`;
  const ST = { active: ['ใช้งาน', 'ok'], pending: ['รออนุมัติ', 'warn'], disabled: ['ระงับ', 'danger'] };
  listView($('#ul'), { items: users, size: 15,
    headers: ['ผู้ใช้', 'สิทธิ์', 'รหัส / Username', 'ชั้น/ห้อง', 'สถานะ', ''],
    filters: `<select class="form-select w-auto" data-f="role" aria-label="สิทธิ์"><option value="">ทุกสิทธิ์</option><option value="admin">Admin</option><option value="student">นักเรียน</option></select><select class="form-select w-auto" data-f="grade" aria-label="ระดับชั้น"><option value="">ทุกชั้น</option>${opt(grades())}</select><select class="form-select w-auto" data-f="status" aria-label="สถานะ"><option value="">ทุกสถานะ</option><option value="active">ใช้งาน</option><option value="pending">รออนุมัติ</option><option value="disabled">ระงับ</option></select>`,
    onFilter: (u, r) => ['role', 'grade', 'status'].every(k => { const v = $(`[data-f="${k}"]`, r).value; return !v || u[k] === v; }),
    search: u => u.fullName + u.studentCode + u.username + u.email,
    row: u => [`<div class="d-flex gap-2 align-items-center">${avatarHtml(u, 36)}<div><b>${esc(u.prefix + u.fullName)}</b>${u.id === S.user.id ? ' <span class="chip info">คุณ</span>' : ''}<div class="small text-muted">${esc(u.email || '')}</div></div></div>`,
      u.role === 'admin' ? '<span class="chip info">Admin</span>' : '<span class="chip">นักเรียน</span>', esc(u.role === 'admin' ? u.username : u.studentCode),
      esc((u.grade || '-') + (u.room ? '/' + u.room : '')), `<span class="chip ${ST[u.status]?.[1]}">${ST[u.status]?.[0] || esc(u.status)}</span>`,
      actBtns(u.id, (u.status === 'pending' ? `<button class="btn btn-sm btn-success" data-approve="${esc(u.id)}">อนุมัติ</button>` : '') + `<button class="btn btn-sm btn-icon btn-soft" data-role="${esc(u.id)}" aria-label="เปลี่ยนสิทธิ์" title="${u.role === 'admin' ? 'ถอดสิทธิ์ Admin' : 'ตั้งเป็น Admin'}"><i class="fa-solid fa-user-shield"></i></button>`)] });
  fab('เพิ่มผู้ใช้', () => userForm({}));
  el.onclick = async e => {
    const t = k => e.target.closest(`[data-${k}]`)?.dataset[k], find = id => users.find(u => u.id === id);
    if (t('edit')) userForm(find(t('edit')));
    if (t('del')) { const u = find(t('del')); if (await confirmBox({ title: 'ยืนยันการลบผู้ใช้', html: `ลบ <b>${esc(u.prefix + u.fullName)}</b> ?<br><span class="text-danger small">งานที่ส่ง ความคืบหน้า และการแจ้งเตือนของผู้ใช้นี้จะถูกลบด้วย</span>`, danger: true, confirmText: 'ลบ' })) { await api('deleteUser', u.id); toast('ลบผู้ใช้แล้ว'); go('users'); } }
    if (t('approve')) { const u = find(t('approve')); if (await confirmBox({ title: 'อนุมัติผู้ใช้', html: `อนุมัติ <b>${esc(u.fullName)}</b> ให้ใช้งานระบบ?` })) { await api('saveUser', { id: u.id, status: 'active' }); toast('อนุมัติแล้ว'); go('users'); } }
    if (t('role')) roleForm(find(t('role')));
  };
  $('#expBtn').onclick = () => exportXlsx('ผู้ใช้งาน', ['สิทธิ์', 'รหัสนักเรียน', 'Username', 'คำนำหน้า', 'ชื่อ-สกุล', 'วันเกิด', 'ชั้น', 'ห้อง', 'อีเมล', 'สถานะ'], users.map(u => [u.role, u.studentCode, u.username, u.prefix, u.fullName, u.birthDate, u.grade, u.room, u.email, u.status]));
  $('#impBtn').onclick = async () => {
    await Swal.fire({ title: 'นำเข้านักเรียน', icon: 'info', html: 'ไฟล์ Excel/CSV แถวแรกเป็นหัวคอลัมน์:<br><code>รหัสนักเรียน, คำนำหน้า, ชื่อ-สกุล, วันเกิด (YYYY-MM-DD), ชั้น, ห้อง, อีเมล</code>', confirmText: 'เลือกไฟล์' });
    $('#impFile').click();
  };
  $('#impFile').onchange = async () => {
    const f = $('#impFile').files[0]; if (!f) return;
    const wb = XLSX.read(await f.arrayBuffer(), { cellDates: false, raw: false }), ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }).slice(1).filter(r => r.join('').trim());
    const list = rows.map(r => ({ studentCode: String(r[0]).trim(), prefix: r[1], fullName: r[2], birthDate: normDate(r[3]), grade: r[4], room: String(r[5]), email: r[6] }));
    if (!list.length) return toast('ไม่พบข้อมูลในไฟล์', 'warning');
    if (!await confirmBox({ title: 'ยืนยันนำเข้า', html: `เพิ่มนักเรียน <b>${list.length}</b> คน จากไฟล์ ${esc(f.name)}` })) return;
    const r = await apiMsg('กำลังนำเข้า...', 'importStudents', list);
    await Swal.fire({ icon: 'success', title: `เพิ่มแล้ว ${r.added} คน`, html: r.skipped.length ? `<div class="text-start small">ข้าม ${r.skipped.length} รายการ:<br>${r.skipped.slice(0, 20).map(esc).join('<br>')}</div>` : '' });
    $('#impFile').value = ''; go('users');
  };
} };
const normDate = v => { v = String(v || '').trim(); let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${+m[1] > 2400 ? m[1] - 543 : m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${+m[3] > 2400 ? m[3] - 543 : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };
function userForm(u) {
  const isNew = !u.id, role = u.role || 'student';
  const base = [{ k: 'prefix', label: 'คำนำหน้า', col: 'col-md-4', req: true }, { k: 'fullName', label: 'ชื่อ-สกุล', req: true, col: 'col-md-8' }, { k: 'birthDate', label: 'วันเกิด', type: 'date', col: 'col-md-6' }, { k: 'email', label: 'อีเมล', type: 'email', col: 'col-md-6' },
    { k: 'status', label: 'สถานะ', type: 'select', opts: [['active', 'ใช้งาน'], ['pending', 'รออนุมัติ'], ['disabled', 'ระงับการใช้งาน']], def: 'active' }];
  const draw = r => {
    const F = (isNew ? [{ k: 'role', label: 'สิทธิ์', type: 'select', opts: [['student', 'นักเรียน'], ['admin', 'Admin(ครูผู้สอน)']] }] : []).concat(base, r === 'student'
      ? [{ k: 'studentCode', label: 'รหัสนักเรียน (5 หลัก) — แก้ไขเพื่อรีเซ็ตรหัสให้นักเรียน', req: true, attrs: 'inputmode="numeric" maxlength="5"', valid: v => /^\d{5}$/.test(v) ? '' : 'ต้องเป็นตัวเลข 5 หลัก' },
         { k: 'grade', label: 'ระดับชั้น', type: 'select', opts: [['', '-']].concat(grades()), col: 'col-md-6' }, { k: 'room', label: 'ห้อง', type: 'select', opts: [['', '-']].concat(rooms()), col: 'col-md-6' }]
      : [{ k: 'username', label: 'Username', req: true, valid: v => /^[a-z0-9._]{4,20}$/.test(v) ? '' : '4–20 ตัว a-z 0-9 . _' },
         { k: 'password', label: isNew ? 'รหัสผ่าน (อย่างน้อย 8 ตัว)' : 'ตั้งรหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)', type: 'password', req: isNew, valid: v => v && v.length < 8 ? 'อย่างน้อย 8 ตัว' : '' }]);
    const m = modal(isNew ? 'เพิ่มผู้ใช้' : 'แก้ไขผู้ใช้', formHtml(F, Object.assign({ role: r }, u)), `<button class="btn btn-soft" data-bs-dismiss="modal">ยกเลิก</button><button class="btn btn-primary" id="uSave">บันทึก</button>`);
    bindForm(m.body, F);
    if (isNew) $('[name=role]', m.body).onchange = e => { u = Object.assign({}, u, readForm(m.body, F)); draw(e.target.value); };
    $('#uSave').onclick = async () => {
      const d = validate(m.body, F); if (!d) return;
      if (!await confirmBox({ title: isNew ? 'ยืนยันการเพิ่มผู้ใช้' : 'ยืนยันการแก้ไขผู้ใช้', html: `<b>${esc(d.prefix + d.fullName)}</b>` })) return;
      if (!isNew) d.id = u.id; else d.role = r;
      await api('saveUser', d); m.hide(); toast('บันทึกผู้ใช้แล้ว'); go('users');
    };
  };
  draw(role);
}
async function roleForm(u) {
  if (u.role === 'admin') {
    const r = await Swal.fire({ title: 'ถอดสิทธิ์ Admin', html: `เปลี่ยน <b>${esc(u.fullName)}</b> เป็นนักเรียน<br>กำหนดรหัสนักเรียน 5 หลัก:`, input: 'text', inputValue: u.studentCode || '', inputAttributes: { inputmode: 'numeric', maxlength: 5 }, icon: 'warning',
      showCancelButton: true, confirmButtonText: 'ยืนยัน', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#dc2626', inputValidator: v => /^\d{5}$/.test(v) ? null : 'ต้องเป็นตัวเลข 5 หลัก' });
    if (!r.isConfirmed) return;
    await api('setRole', u.id, 'student', { studentCode: r.value });
  } else {
    const r = await Swal.fire({ title: 'ตั้งเป็น Admin(ครูผู้สอน)', html: `<div class="text-start">กำหนด Username และรหัสผ่านให้ <b>${esc(u.fullName)}</b><input id="sw1" class="form-control mt-2" placeholder="Username"><input id="sw2" type="password" class="form-control mt-2" placeholder="รหัสผ่าน (อย่างน้อย 8 ตัว)"></div>`,
      showCancelButton: true, confirmButtonText: 'ยืนยัน', cancelButtonText: 'ยกเลิก', preConfirm: () => { const a = $('#sw1').value.trim().toLowerCase(), b = $('#sw2').value; if (!/^[a-z0-9._]{4,20}$/.test(a)) return Swal.showValidationMessage('Username 4–20 ตัว a-z 0-9 . _'); if (b.length < 8) return Swal.showValidationMessage('รหัสผ่านอย่างน้อย 8 ตัว'); return { username: a, password: b }; } });
    if (!r.isConfirmed) return;
    await api('setRole', u.id, 'admin', r.value);
  }
  toast('เปลี่ยนสิทธิ์แล้ว'); go('users');
}

/* ---------------- ระดับชั้น / หมวดหมู่ ---------------- */
PAGES.classes = { admin: true, async render(el) {
  const [cls, cats] = await Promise.all([apiQ('list', 'Classes'), apiQ('list', 'Categories')]);
  S.classes = cls;
  el.innerHTML = `<div class="page-head"><h3>ระดับชั้น / ห้องเรียน / หมวดหมู่</h3></div><div class="grid g2">
    <div class="card-x"><div class="d-flex mb-2"><h5 class="fw-bold flex-fill">ระดับชั้นและห้อง</h5><button class="btn btn-primary btn-sm" id="addC"><i class="fa-solid fa-plus"></i> เพิ่ม</button></div><div id="tc">${tableHtml(['ระดับชั้น', 'ห้อง', 'นักเรียน', ''], cls.map(c => [esc(c.grade), esc(c.room || '-'), '', actBtns(c.id)]))}</div><small class="text-muted">ใช้กำหนดให้นักเรียนเลือกตอนลงทะเบียน และกำหนดว่ารายวิชา/ประกาศแสดงกับชั้นใด</small></div>
    <div class="card-x"><div class="d-flex mb-2"><h5 class="fw-bold flex-fill">หมวดหมู่รายวิชา</h5><button class="btn btn-primary btn-sm" id="addK"><i class="fa-solid fa-plus"></i> เพิ่ม</button></div><div id="tk">${tableHtml(['ชื่อหมวดหมู่', ''], cats.map(c => [esc(c.name), actBtns(c.id)]))}</div></div></div>`;
  const users = (await lists()).users;
  $$('#tc tbody tr').forEach((tr, i) => tr.children[2].textContent = users.filter(u => u.role === 'student' && u.grade === cls[i].grade && (!cls[i].room || u.room === cls[i].room)).length + ' คน');
  const re = () => go('classes');
  $('#addC').onclick = () => crudForm('Classes', {}, re); $('#addK').onclick = () => crudForm('Categories', {}, re);
  bindActs($('#tc'), cls, 'Classes', 'นักเรียนในชั้นนี้จะยังอยู่ แต่ต้องแก้ไขชั้นเรียนให้ใหม่', re); bindActs($('#tk'), cats, 'Categories', '', re);
} };

/* ---------------- รายวิชา / บทเรียน ---------------- */
PAGES.acourses = { admin: true, async render(el) {
  const c = await lists(true);
  el.innerHTML = `<div class="page-head"><h3>รายวิชาและบทเรียน</h3></div><div id="cl"></div>`;
  const lessons = await apiQ('list', 'Lessons');
  listView($('#cl'), { items: c.courses, filters: ownerFilter() + `<select class="form-select w-auto" data-f="grade" aria-label="ระดับชั้น"><option value="">ทุกชั้น</option>${opt(grades())}</select>`,
    onFilter: (it, r) => byOwner(it, r) && (!$('[data-f=grade]', r).value || it.grade === $('[data-f=grade]', r).value),
    headers: ['รายวิชา', 'หมวดหมู่', 'ระดับชั้น', 'บทเรียน', 'เจ้าของข้อมูล', ''], search: x => x.name + x.code + x.category + x.teacher,
    row: x => [`<a href="#" data-go="acourse" data-id="${esc(x.id)}"><b>${esc(x.name)}</b></a><div class="small text-muted">${esc(x.code)}</div>`, esc(x.category || '-'), esc((x.grade || 'ทุกชั้น') + (x.room ? '/' + x.room : '')),
      lessons.filter(l => l.courseId === x.id).length, esc(ownerName(x.ownerId)), actBtns(x.id, `<button class="btn btn-sm btn-soft" data-go="acourse" data-id="${esc(x.id)}">บทเรียน</button>`)] });
  bindActs($('#cl'), c.courses, 'Courses', 'บทเรียน งาน งานที่นักเรียนส่ง และความคืบหน้าทั้งหมดในวิชานี้จะถูกลบด้วย', () => go('acourses'));
  fab('เพิ่มรายวิชา', () => crudForm('Courses', {}, r => go('acourse', { id: r.id })));
} };
PAGES.acourse = { admin: true, parent: 'acourses', async render(el, p) {
  const c = await lists(true), course = c.courses.find(x => x.id === p.id);
  if (!course) throw new Error('ไม่พบรายวิชา');
  $('#pageTitle').textContent = course.name;
  const [lessons, asg] = await Promise.all([apiQ('list', 'Lessons'), apiQ('list', 'Assignments')]);
  const ls = lessons.filter(l => l.courseId === course.id), as = asg.filter(a => a.courseId === course.id), n = nowStr();
  const state = l => l.publishAt && l.publishAt > n ? '<span class="chip warn">รอเผยแพร่</span>' : l.closeAt && l.closeAt <= n ? '<span class="chip danger">ปิดแล้ว</span>' : '<span class="chip ok">เผยแพร่</span>';
  el.innerHTML = `<button class="btn btn-soft mb-3" data-go="acourses"><i class="fa-solid fa-arrow-left"></i> รายวิชาทั้งหมด</button>
  <div class="card-x mb-3 d-flex gap-3 align-items-center flex-wrap"><div style="width:160px">${coverHtml(course)}</div><div class="flex-fill"><h4 class="fw-bold mb-1">${esc(course.name)}</h4><div class="text-muted small">${esc(course.code)} · ${esc(course.category || '-')} · ${esc(course.grade || 'ทุกชั้น')}${course.room ? '/' + esc(course.room) : ''} · ${esc(course.teacher)}</div></div><button class="btn btn-soft" id="eC"><i class="fa-solid fa-pen"></i> แก้ไขรายวิชา</button></div>
  <div class="card-x mb-3"><div class="d-flex mb-2 align-items-center"><h5 class="fw-bold flex-fill m-0">บทเรียน (${ls.length})</h5><button class="btn btn-primary btn-sm" id="aL"><i class="fa-solid fa-plus"></i> เพิ่มบทเรียน</button></div>
    <div id="tl">${tableHtml(['ลำดับ', 'หน่วย / บทเรียน', 'สื่อ', 'สถานะ', ''], ls.map((l, i) => [`<div class="d-flex gap-1"><button class="btn btn-sm btn-icon btn-soft" data-up="${i}" aria-label="เลื่อนขึ้น" ${i ? '' : 'disabled'}><i class="fa-solid fa-arrow-up"></i></button><button class="btn btn-sm btn-icon btn-soft" data-down="${i}" aria-label="เลื่อนลง" ${i < ls.length - 1 ? '' : 'disabled'}><i class="fa-solid fa-arrow-down"></i></button></div>`,
      `<div class="small text-muted">${esc(l.unit)}</div><b>${esc(l.title)}</b>`, `${l.videoUrl ? '<i class="fa-solid fa-circle-play text-danger" title="วิดีโอ"></i> ' : ''}${J(l.attachments).length ? `<i class="fa-solid fa-paperclip"></i> ${J(l.attachments).length} ` : ''}${J(l.links).length ? '<i class="fa-solid fa-link"></i>' : ''}`,
      state(l) + (l.publishAt ? `<div class="small text-muted">${thDate(l.publishAt, true)}</div>` : ''), actBtns(l.id)]))}</div></div>
  <div class="card-x"><div class="d-flex mb-2 align-items-center"><h5 class="fw-bold flex-fill m-0">งานที่มอบหมาย (${as.length})</h5><button class="btn btn-primary btn-sm" id="aA"><i class="fa-solid fa-plus"></i> สร้างงาน</button></div>
    ${tableHtml(['งาน', 'กำหนดส่ง', 'คะแนนเต็ม', ''], as.map(a => [`<span class="chip info">${esc(a.type)}</span> <b>${esc(a.title)}</b>`, thDate(a.dueAt, true), esc(a.maxScore), `<button class="btn btn-sm btn-primary" data-go="grade" data-id="${esc(a.id)}">ตรวจงาน</button>`]))}</div>`;
  const re = () => go('acourse', p);
  $('#eC').onclick = () => crudForm('Courses', course, re);
  $('#aL').onclick = () => crudForm('Lessons', { courseId: course.id, order: ls.length + 1, unit: ls.length ? ls[ls.length - 1].unit : '' }, re);
  $('#aA').onclick = () => crudForm('Assignments', { courseId: course.id }, re);
  bindActs($('#tl'), ls, 'Lessons', 'ความคืบหน้าการเรียนของบทเรียนนี้จะถูกลบด้วย', re);
  $('#tl').addEventListener('click', async e => {
    const up = e.target.closest('[data-up]'), dn = e.target.closest('[data-down]');
    if (!up && !dn) return;
    const i = +(up ? up.dataset.up : dn.dataset.down), j = up ? i - 1 : i + 1, arr = ls.slice();
    [arr[i], arr[j]] = [arr[j], arr[i]];
    Loader.show('กำลังจัดลำดับ...');
    try { for (let k = 0; k < arr.length; k++) if (+arr[k].order !== k + 1) await apiQ('save', 'Lessons', { id: arr[k].id, order: k + 1 }); } finally { Loader.hide(); }
    toast('จัดลำดับบทเรียนแล้ว'); re();
  });
} };

/* ---------------- งานที่มอบหมาย / ตรวจงาน ---------------- */
PAGES.aassign = { admin: true, async render(el) {
  const c = await lists(true), asg = await apiQ('list', 'Assignments');
  const cn = id => (c.courses.find(x => x.id === id) || {}).name || '-';
  el.innerHTML = `<div class="page-head"><h3>งานที่มอบหมาย</h3></div><div id="al"></div>`;
  listView($('#al'), { items: asg.sort((a, b) => b.dueAt.localeCompare(a.dueAt)), filters: ownerFilter() + `<select class="form-select w-auto" data-f="course" aria-label="รายวิชา"><option value="">ทุกรายวิชา</option>${opt(c.courses.map(x => [x.id, x.name]))}</select>`,
    onFilter: (it, r) => byOwner(it, r) && (!$('[data-f=course]', r).value || it.courseId === $('[data-f=course]', r).value),
    headers: ['งาน', 'รายวิชา', 'กำหนดส่ง', 'คะแนนเต็ม', 'เจ้าของข้อมูล', ''], search: a => a.title + a.type + cn(a.courseId),
    row: a => [`<span class="chip info">${esc(a.type)}</span><div><b>${esc(a.title)}</b></div>`, esc(cn(a.courseId)), thDate(a.dueAt, true) + (a.dueAt < nowStr() ? ' <span class="chip">ปิดรับ</span>' : ''), esc(a.maxScore), esc(ownerName(a.ownerId)),
      actBtns(a.id, `<button class="btn btn-sm btn-primary" data-go="grade" data-id="${esc(a.id)}"><i class="fa-solid fa-check-double"></i> ตรวจ</button>`)] });
  bindActs($('#al'), asg, 'Assignments', 'งานที่นักเรียนส่งทั้งหมดของงานนี้จะถูกลบด้วย', () => go('aassign'));
  fab('สร้างงาน', () => crudForm('Assignments', {}, () => go('aassign')));
} };
PAGES.grade = { admin: true, parent: 'aassign', async render(el, p) {
  const d = await apiQ('listSubmissions', p.id), a = d.assignment;
  $('#pageTitle').textContent = 'ตรวจงาน: ' + a.title;
  const sent = d.rows.filter(r => r.sub).length, graded = d.rows.filter(r => r.status === 'graded').length;
  el.innerHTML = `<button class="btn btn-soft mb-3" data-go="aassign"><i class="fa-solid fa-arrow-left"></i> งานทั้งหมด</button>
  <div class="card-x mb-3"><h4 class="fw-bold">${esc(a.title)}</h4><div class="text-muted small mb-2">${esc(d.course.name)} · กำหนดส่ง ${thDate(a.dueAt, true)} · คะแนนเต็ม ${esc(a.maxScore)}</div>
  <div class="grid g4">${statCard('fa-users', d.rows.length, 'นักเรียน')}${statCard('fa-paper-plane', sent, 'ส่งแล้ว', 'background:#dcfce7;color:#15803d')}${statCard('fa-hourglass', d.rows.length - sent, 'ยังไม่ส่ง', 'background:#fef3c7;color:#b45309')}${statCard('fa-check-double', graded, 'ตรวจแล้ว')}</div></div>
  <div id="gl"></div>`;
  listView($('#gl'), { items: d.rows, size: 20, headers: ['รหัส', 'ชื่อ-สกุล', 'สถานะ', 'งานที่ส่ง', 'คะแนน / ความคิดเห็น', ''], search: r => r.user.fullName + r.user.studentCode,
    filters: `<select class="form-select w-auto" data-f="st" aria-label="สถานะ"><option value="">ทุกสถานะ</option><option value="sent">ส่งแล้ว (รอตรวจ)</option><option value="graded">ตรวจแล้ว</option><option value="none">ยังไม่ส่ง</option></select>`,
    onFilter: (r, root) => { const v = $('[data-f=st]', root).value; return !v || (v === 'sent' && r.sub && r.status !== 'graded') || (v === 'graded' && r.status === 'graded') || (v === 'none' && !r.sub); },
    row: r => [esc(r.user.studentCode), esc(r.user.fullName), statusChip(r.status) + (r.sub ? `<div class="small text-muted">${thDate(r.sub.submittedAt, true)}</div>` : ''),
      r.sub ? `<button class="btn btn-sm btn-soft" data-view="${esc(r.user.id)}"><i class="fa-solid fa-eye"></i> ดูงาน</button>` : '-',
      r.sub ? `<div class="d-flex gap-1 flex-wrap"><input class="form-control form-control-sm" style="width:80px" type="number" min="0" max="${esc(a.maxScore)}" value="${esc(r.sub.score)}" data-score="${esc(r.sub.id)}" aria-label="คะแนน"><input class="form-control form-control-sm" style="min-width:140px;flex:1" value="${esc(r.sub.feedback)}" data-fb="${esc(r.sub.id)}" placeholder="ความคิดเห็น" aria-label="ความคิดเห็น"></div>` : '',
      r.sub ? `<button class="btn btn-sm btn-primary" data-grade="${esc(r.sub.id)}" data-name="${esc(r.user.fullName)}">บันทึก</button>` : ''] });
  el.onclick = async e => {
    const v = e.target.closest('[data-view]'), g = e.target.closest('[data-grade]');
    if (v) { const r = d.rows.find(x => x.user.id === v.dataset.view), s = r.sub;
      modal(r.user.fullName, `<div class="summary mb-3"><div><span>ส่งเมื่อ</span><b>${thDate(s.submittedAt, true)}</b></div><div><span>สถานะ</span>${statusChip(s.status)}</div></div><p>${linkify(s.text) || '<span class="text-muted">ไม่มีข้อความ</span>'}</p>${filesHtml(J(s.files))}${s.driveLink ? `<a class="file-row" href="${safeUrl(s.driveLink)}" target="_blank" rel="noopener"><i class="fa-brands fa-google-drive"></i> ${esc(s.driveLink)}</a>` : ''}
        ${J(s.history).length ? `<details class="mt-3"><summary>ประวัติการแก้ไข (${J(s.history).length})</summary>${J(s.history).map(h => `<div class="small text-muted">${thDate(h.at, true)} · ไฟล์ ${h.files} รายการ ${h.text ? '· ' + esc(String(h.text).slice(0, 80)) : ''}</div>`).join('')}</details>` : ''}`); }
    if (g) {
      const id = g.dataset.grade, score = $(`[data-score="${id}"]`).value, fb = $(`[data-fb="${id}"]`).value;
      if (score === '' || +score < 0 || +score > +a.maxScore) return toast(`คะแนนต้องอยู่ระหว่าง 0–${a.maxScore}`, 'warning');
      if (!await confirmBox({ title: 'ยืนยันบันทึกคะแนน', html: `<b>${esc(g.dataset.name)}</b> ได้ ${esc(score)}/${esc(a.maxScore)} คะแนน` })) return;
      await api('gradeSubmission', id, score, fb); toast('บันทึกคะแนนแล้ว — แจ้งเตือนนักเรียนแล้ว');
    }
  };
} };

/* ---------------- ประกาศ (Admin) ---------------- */
PAGES.aann = { admin: true, async render(el) {
  await lists(true);
  const list = await apiQ('list', 'Announcements');
  el.innerHTML = `<div class="page-head"><h3>จัดการประกาศ</h3></div><div id="nl"></div>`;
  listView($('#nl'), { items: list.sort((a, b) => (b.pinned === 'true') - (a.pinned === 'true') || b.createdAt.localeCompare(a.createdAt)), filters: ownerFilter(), onFilter: byOwner,
    headers: ['ประกาศ', 'ประเภท', 'กลุ่มเป้าหมาย', 'วันที่', 'เจ้าของข้อมูล', ''], search: a => a.title + a.body + a.type,
    row: a => [`${a.pinned === 'true' ? '<i class="fa-solid fa-thumbtack pin"></i> ' : ''}<b>${esc(a.title)}</b>`, `<span class="chip info">${esc(a.type)}</span>`, esc((a.grade || 'ทุกชั้น') + (a.room ? '/' + a.room : '')), thDate(a.createdAt, true), esc(ownerName(a.ownerId)), actBtns(a.id)] });
  bindActs($('#nl'), list, 'Announcements', '', () => go('aann'));
  fab('โพสต์ประกาศ', () => crudForm('Announcements', {}, () => go('aann')));
} };

/* ---------------- รายงาน ---------------- */
PAGES.reports = { admin: true, async render(el) {
  const c = await lists();
  el.innerHTML = `<div class="page-head"><h3>รายงาน</h3></div><div class="card-x mb-3"><div class="row g-2">
    <div class="col-md-3"><label class="form-label" for="rt">ประเภทรายงาน</label><select class="form-select" id="rt">${opt([['attendance', 'การเข้าเรียน'], ['views', 'การรับชมบทเรียน'], ['submissions', 'การส่งงาน'], ['scores', 'คะแนน'], ['courses', 'สถิติรายวิชา']])}</select></div>
    <div class="col-md-3"><label class="form-label" for="rc">รายวิชา</label><select class="form-select" id="rc"><option value="">ทุกรายวิชา</option>${opt(c.courses.map(x => [x.id, x.name]))}</select></div>
    <div class="col-6 col-md-2"><label class="form-label" for="rg">ระดับชั้น</label><select class="form-select" id="rg"><option value="">ทั้งหมด</option>${opt(grades())}</select></div>
    <div class="col-6 col-md-2"><label class="form-label" for="rr">ห้อง</label><select class="form-select" id="rr"><option value="">ทั้งหมด</option>${opt(rooms())}</select></div>
    <div class="col-md-2 d-flex align-items-end"><button class="btn btn-primary w-100" id="rGo"><i class="fa-solid fa-play"></i> แสดง</button></div></div></div>
    <div class="card-x"><div class="d-flex flex-wrap gap-2 mb-3"><h5 class="fw-bold flex-fill m-0" id="rTitle">-</h5><button class="btn btn-soft" data-x="xlsx"><i class="fa-solid fa-file-excel text-success"></i> Excel</button><button class="btn btn-soft" data-x="csv"><i class="fa-solid fa-file-csv"></i> CSV</button><button class="btn btn-soft" data-x="pdf"><i class="fa-solid fa-file-pdf text-danger"></i> PDF</button></div><div id="rBody"></div></div>`;
  let R = null;
  const run = async () => { R = await api('report', $('#rt').value, { courseId: $('#rc').value, grade: $('#rg').value, room: $('#rr').value }); $('#rTitle').textContent = R.title; $('#rBody').innerHTML = tableHtml(R.headers.map(esc), R.rows.map(r => r.map(esc))); };
  $('#rGo').onclick = run; await run();
  $$('[data-x]').forEach(b => b.onclick = () => {
    if (!R || !R.rows.length) return toast('ไม่มีข้อมูลสำหรับส่งออก', 'warning');
    const name = R.title + ' ' + new Date().toLocaleDateString('th-TH').replace(/\//g, '-');
    if (b.dataset.x === 'xlsx') exportXlsx(name, R.headers, R.rows);
    else if (b.dataset.x === 'csv') { const ws = XLSX.utils.aoa_to_sheet([R.headers].concat(R.rows)); download(new Blob(['﻿' + XLSX.utils.sheet_to_csv(ws)], { type: 'text/csv;charset=utf-8' }), name + '.csv'); }
    else printTable(R.title, R.headers, R.rows);
  });
} };
function exportXlsx(name, headers, rows) { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers].concat(rows)), 'Report'); XLSX.writeFile(wb, name + '.xlsx'); toast('ส่งออกไฟล์ Excel แล้ว'); }
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
function printTable(title, headers, rows) {
  $('#printArea').innerHTML = `<h3>${esc(S.config.schoolName)} — ${esc(title)}</h3><p>พิมพ์เมื่อ ${thDate(new Date(), true)}</p><table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  toast('เลือก "บันทึกเป็น PDF" ในหน้าต่างพิมพ์', 'info'); setTimeout(() => window.print(), 300);
}

/* ---------------- ตั้งค่าระบบ ---------------- */
PAGES.settings = { admin: true, async render(el, p) {
  const s = await apiQ('getSettings'), c = s.config;
  const tabs = [['general', 'ทั่วไป', 'fa-school'], ['system', 'ระบบ/ความปลอดภัย', 'fa-shield-halved'], ['notify', 'การแจ้งเตือน', 'fa-bell'], ['db', 'ฐานข้อมูล', 'fa-database'], ['backup', 'สำรอง/กู้คืน', 'fa-cloud-arrow-up'], ['account', 'บัญชีของฉัน', 'fa-key'], ['audit', 'Audit Log', 'fa-clipboard-list']];
  let tab = p.tab || 'general';
  el.innerHTML = `<div class="page-head"><h3>ตั้งค่าระบบ</h3></div><ul class="nav nav-pills gap-2 mb-3 flex-nowrap overflow-auto pb-1">${tabs.map(t => `<li class="nav-item"><button class="nav-link text-nowrap" data-st="${t[0]}"><i class="fa-solid ${t[2]}"></i> ${t[1]}</button></li>`).join('')}</ul><div class="card-x" id="sBody"></div>`;
  const GF = {
    general: [{ k: 'schoolName', label: 'ชื่อโรงเรียน / ชื่อระบบ', req: true }, { k: 'welcome', label: 'ข้อความต้อนรับหน้าเข้าสู่ระบบ' }, { k: 'logo', label: 'โลโก้ (แนะนำรูปสี่เหลี่ยมจัตุรัส พื้นโปร่งใส)', type: 'image', w: 256, h: 256, png: true, contain: true }],
    system: [{ k: 'studentLogin', label: 'วิธีเข้าสู่ระบบของนักเรียน', type: 'select', opts: [['code+birth', 'รหัสนักเรียน + วันเกิด (แนะนำ ปลอดภัยกว่า)'], ['code', 'รหัสนักเรียน 5 หลักอย่างเดียว (เดาได้ง่าย)']] },
      { k: 'allowAdminSignup', label: 'เปิดให้สมัครบัญชีครูผู้สอนเองได้', type: 'check' }, { k: 'requireApproval', label: 'ต้องให้ Admin อนุมัติก่อนใช้งาน (บัญชีครูที่สมัครเอง)', type: 'check', help: 'แนะนำให้เปิด หากเปิดให้สมัครบัญชีครูเอง เพราะ Admin เข้าถึงข้อมูลทั้งหมดได้' },
      { k: 'sessionHours', label: 'อายุเซสชันปกติ (ชั่วโมง)', type: 'number', col: 'col-md-6' }, { k: 'rememberDays', label: 'อายุเซสชัน "จดจำฉัน" (วัน)', type: 'number', col: 'col-md-6' }],
    notify: [{ k: 'webNotify', label: 'แจ้งเตือนบนเว็บ (Web Notification + กระดิ่ง)', type: 'check' }, { k: 'emailNotify', label: 'ส่งอีเมลแจ้งเตือน (ถึงผู้ใช้ที่กรอกอีเมลไว้, โควตา Gmail ~100 ฉบับ/วัน)', type: 'check' },
      { k: 'lineToken', label: 'LINE Messaging API — Channel access token (เว้นว่าง = ไม่ใช้)', type: 'password', help: 'LINE Notify ปิดบริการแล้วตั้งแต่ 31 มี.ค. 2568 จึงใช้ LINE Official Account + Messaging API แทน (ส่งแบบ broadcast ถึงผู้ติดตาม OA)' }]
  };
  const draw = async () => {
    $$('[data-st]').forEach(b => b.classList.toggle('active', b.dataset.st === tab));
    const B = $('#sBody');
    if (GF[tab]) {
      const F = GF[tab];
      B.innerHTML = `<form id="sf">${formHtml(F, c)}<button class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> บันทึกการตั้งค่า</button></form>`;
      bindForm(B, F);
      $('#sf').onsubmit = async e => {
        e.preventDefault(); const d = validate($('#sf'), F); if (!d) return;
        if (!await confirmBox({ title: 'ยืนยันการแก้ไขการตั้งค่า', html: 'บันทึกการตั้งค่า <b>' + esc(tabs.find(t => t[0] === tab)[1]) + '</b>' })) return;
        await api('saveSettings', { config: d }); Object.assign(c, d); Object.assign(S.config, d); delete S.config.lineToken; applyBrand(); toast('บันทึกการตั้งค่าแล้ว');
      };
    } else if (tab === 'db') {
      B.innerHTML = `<div class="alert alert-warning rounded-4"><i class="fa-solid fa-triangle-exclamation"></i> การเปลี่ยน Google Sheet จะย้ายไปใช้ฐานข้อมูลใหม่ทันที (ข้อมูลเดิมยังอยู่ในชีตเดิม) ระบบจะสร้างชีตและหัวคอลัมน์ให้อัตโนมัติ และถ้าชีตใหม่ยังไม่มี Admin จะสร้างบัญชี admin / admin123 ให้ — ทุกคนต้องเข้าสู่ระบบใหม่</div>
        <div class="mb-3"><label class="form-label" for="dbS">Google Sheet ID หรือ URL</label><div class="input-group"><input class="form-control" id="dbS" value="${esc(s.sheetId)}"><a class="btn btn-soft" target="_blank" rel="noopener" href="${safeUrl(s.sheetUrl)}"><i class="fa-solid fa-up-right-from-square"></i> เปิด</a></div></div>
        <div class="mb-3"><label class="form-label" for="dbD">Google Drive Folder ID หรือ URL (เก็บไฟล์/รูป)</label><div class="input-group"><input class="form-control" id="dbD" value="${esc(s.driveId)}"><a class="btn btn-soft" target="_blank" rel="noopener" href="${safeUrl(s.driveUrl)}"><i class="fa-solid fa-up-right-from-square"></i> เปิด</a></div></div>
        <div class="small text-muted mb-3">URL เว็บแอป: <a href="${safeUrl(s.webAppUrl)}" target="_blank" rel="noopener">${esc(s.webAppUrl)}</a></div><button class="btn btn-primary" id="dbSave"><i class="fa-solid fa-plug"></i> ทดสอบและบันทึก</button>`;
      $('#dbSave').onclick = async () => {
        const d = { sheetId: $('#dbS').value.trim(), driveId: $('#dbD').value.trim() };
        if (!await confirmBox({ title: 'ยืนยันเปลี่ยนแหล่งเก็บข้อมูล', html: 'ระบบจะทดสอบสิทธิ์การเข้าถึงก่อนบันทึก', danger: true })) return;
        const r = await apiMsg('กำลังทดสอบการเชื่อมต่อ...', 'saveSettings', d);
        if (r.reloaded) { await Swal.fire({ icon: 'success', title: 'เปลี่ยนฐานข้อมูลแล้ว', text: 'กรุณาเข้าสู่ระบบใหม่' }); localLogout(); } else toast('บันทึกแล้ว');
      };
    } else if (tab === 'backup') {
      const list = await api('listBackups');
      B.innerHTML = `<div class="d-flex flex-wrap gap-2 mb-3"><button class="btn btn-primary" id="bkNow"><i class="fa-solid fa-cloud-arrow-up"></i> สำรองข้อมูลตอนนี้</button><button class="btn btn-soft" id="bkTrig"><i class="fa-solid fa-clock"></i> ${s.triggers.includes('dailyJob') ? 'ติดตั้งงานอัตโนมัติแล้ว (ติดตั้งใหม่)' : 'เปิดงานอัตโนมัติรายวัน'}</button></div>
        <p class="small text-muted">งานอัตโนมัติรายวัน (06:00 น.): สำรองข้อมูล (ถ้าเปิด) · เตือนงานใกล้ครบกำหนด · ล้างเซสชันหมดอายุ — เก็บไฟล์สำรองล่าสุด 30 ชุดในโฟลเดอร์ Backups</p>
        ${tableHtml(['ไฟล์สำรอง', 'วันที่', ''], list.map(b => [`<a href="${safeUrl(b.url)}" target="_blank" rel="noopener">${esc(b.name)}</a>`, esc(b.at), `<button class="btn btn-sm btn-outline-danger" data-restore="${esc(b.id)}" data-name="${esc(b.name)}"><i class="fa-solid fa-clock-rotate-left"></i> กู้คืน</button>`]))}`;
      $('#bkNow').onclick = async () => { if (!await confirmBox({ title: 'สำรองข้อมูลตอนนี้?', html: 'คัดลอก Google Sheet ทั้งไฟล์ไปที่โฟลเดอร์ Backups' })) return; await apiMsg('กำลังสำรองข้อมูล...', 'backupNow'); toast('สำรองข้อมูลแล้ว'); draw(); };
      $('#bkTrig').onclick = async () => { await api('installTriggers'); s.triggers = ['dailyJob']; toast('ติดตั้งงานอัตโนมัติแล้ว'); draw(); };
      $$('[data-restore]', B).forEach(b => b.onclick = async () => {
        if (!await confirmBox({ title: 'ยืนยันการกู้คืน', html: `แทนที่ข้อมูลปัจจุบันทั้งหมดด้วย <b>${esc(b.dataset.name)}</b><br><span class="text-danger small">ระบบจะสำรองข้อมูลปัจจุบันให้ก่อนอัตโนมัติ</span>`, danger: true, confirmText: 'กู้คืน' })) return;
        await apiMsg('กำลังกู้คืนข้อมูล...', 'restoreBackup', b.dataset.restore); await Swal.fire({ icon: 'success', title: 'กู้คืนเรียบร้อย', text: 'กรุณาเข้าสู่ระบบใหม่' }); localLogout();
      });
    } else if (tab === 'account') {
      const F = [{ k: 'username', label: 'Username', req: true, valid: v => /^[a-z0-9._]{4,20}$/.test(v) ? '' : '4–20 ตัว a-z 0-9 . _' }, { k: 'currentPassword', label: 'รหัสผ่านปัจจุบัน', type: 'password', req: true },
        { k: 'newPassword', label: 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)', type: 'password', valid: v => v && v.length < 8 ? 'อย่างน้อย 8 ตัว' : v === 'admin123' ? 'ห้ามใช้รหัสผ่านเริ่มต้น' : '' },
        { k: 'confirm', label: 'ยืนยันรหัสผ่านใหม่', type: 'password', valid: (v, o) => v !== o.newPassword ? 'ไม่ตรงกัน' : '' }];
      B.innerHTML = `<form id="af" style="max-width:520px">${formHtml(F, { username: S.user.username })}<button class="btn btn-primary"><i class="fa-solid fa-key"></i> บันทึก</button></form>`;
      bindForm(B, F);
      $('#af').onsubmit = async e => { e.preventDefault(); const d = validate($('#af'), F); if (!d) return;
        if (!await confirmBox({ title: 'ยืนยันเปลี่ยนข้อมูลบัญชี', html: 'Username: <b>' + esc(d.username) + '</b>' })) return;
        S.user = await api('changeCredentials', d); renderMe(); toast('บันทึกบัญชีแล้ว'); $('#af').reset(); };
    } else if (tab === 'audit') {
      let page = 1, q = '';
      B.innerHTML = `<input class="form-control mb-3" type="search" placeholder="ค้นหาใน log..." id="aq" aria-label="ค้นหา log"><div id="at"></div><div class="d-flex justify-content-center gap-2 mt-3" id="ap"></div>`;
      const load = async () => { const r = await apiQ('auditLog', { page, q }); $('#at').innerHTML = tableHtml(['เวลา', 'ผู้ใช้', 'กิจกรรม', 'รายละเอียด'], r.rows.map(l => [thDate(l.at, true), esc(l.user), `<span class="chip">${esc(l.action)}</span>`, `<small>${esc(l.detail)}</small>`]));
        $('#ap').innerHTML = `<button class="btn btn-soft" ${page > 1 ? '' : 'disabled'} id="apPrev">ก่อนหน้า</button><span class="align-self-center">หน้า ${r.page}/${r.pages || 1} (${r.total})</span><button class="btn btn-soft" ${page < r.pages ? '' : 'disabled'} id="apNext">ถัดไป</button>`;
        $('#apPrev').onclick = () => { page--; load(); }; $('#apNext').onclick = () => { page++; load(); }; };
      $('#aq').addEventListener('input', debounce(() => { q = $('#aq').value; page = 1; load(); }, 300)); load();
    }
  };
  $$('[data-st]').forEach(b => b.onclick = () => { tab = b.dataset.st; draw(); });
  draw();
} };

/* =========================================================
 * เริ่มต้นระบบ
 * ========================================================= */
(async function init() {
  Loader.show('กำลังเตรียมระบบ...');
  try {
    const b = await apiQ('bootstrap');
    S.config = b.config; S.classes = b.classes; S.maxMB = b.maxUploadMB; applyBrand();
    const token = store.get('cp_token'), exp = +store.get('cp_exp');
    if (token && (!exp || exp > Date.now())) {
      S.token = token; S.expiresAt = exp;
      try { const me = await apiQ('me'); S.user = me.user; S.config = me.config; S.classes = me.classes; enterApp(); return; } catch (e) { store.del('cp_token'); S.token = null; }
    }
    renderLogin();
  } catch (e) {
    applyBrand(); renderLogin();
    Swal.fire({ icon: 'error', title: 'เชื่อมต่อฐานข้อมูลไม่สำเร็จ', html: esc(e.message) + '<br><small>ตรวจสอบว่าบัญชีที่ Deploy มีสิทธิ์แก้ไข Google Sheet และ Drive ที่กำหนดไว้</small>' });
  } finally { Loader.hide(); }
})();
</script>
</body>
</html>
