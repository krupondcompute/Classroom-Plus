<script>
'use strict';
/* =========================================================
 * Classroom PLus — Frontend (SPA)
 * ========================================================= */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => /^(https?:\/\/|data:image\/)/i.test(String(u || '')) ? esc(u) : '#';
const J = (s, d = []) => { try { return typeof s === 'string' ? (s ? JSON.parse(s) : d) : (s ?? d); } catch (e) { return d; } };
const S = { token: null, user: null, config: {}, classes: [], mode: 'student', page: '', params: {}, cache: {}, timers: [], maxMB: 20, expiresAt: 0, lastNotif: '' };
const store = {
  get(k) { try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch (e) { return null; } },
  set(k, v, persist = true) { try { (persist ? localStorage : sessionStorage).setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) {} }
};
const DEFAULT_LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#1e3a8a"/></linearGradient></defs>
<path d="M32 6l26 14H6z" fill="url(#lg)"/><rect x="9" y="22" width="46" height="5" rx="1.5" fill="#1e3a8a"/>
<g fill="#2563eb"><rect x="12" y="29" width="6" height="20" rx="1"/><rect x="23" y="29" width="6" height="20" rx="1"/><rect x="35" y="29" width="6" height="20" rx="1"/><rect x="46" y="29" width="6" height="20" rx="1"/></g>
<rect x="6" y="50" width="52" height="7" rx="2" fill="url(#lg)"/><circle cx="32" cy="15" r="3.2" fill="#fff"/></svg>`;

/* ---------------- Loader (นับ reference, แสดงอย่างน้อย 400ms) ---------------- */
const Loader = {
  n: 0, p: 0, real: false, t: null, at: 0, hideT: null,
  el: () => $('#loader'),
  show(msg) {
    this.n++;
    $('#lMsg').textContent = msg || 'กำลังโหลดข้อมูล...';
    if (this.n === 1) {
      clearTimeout(this.hideT); this.at = Date.now(); this.p = 0; this.real = false; this.render();
      this.el().classList.add('show');
      clearInterval(this.t);
      this.t = setInterval(() => { if (!this.real && this.p < 90) { this.p += (90 - this.p) * 0.07 + 0.3; this.render(); } }, 120);
    }
  },
  set(percent, msg) { this.real = true; this.p = Math.max(0, Math.min(100, percent)); if (msg) $('#lMsg').textContent = msg; this.render(); },
  render() { const v = Math.round(this.p); $('#lPct').textContent = v + '%'; $('#lBar').style.width = v + '%'; },
  hide() {
    this.n = Math.max(0, this.n - 1);
    if (this.n) return;
    this.p = 100; this.render(); clearInterval(this.t);
    const wait = Math.max(0, 400 - (Date.now() - this.at)) + 180;
    this.hideT = setTimeout(() => { if (!this.n) { this.el().classList.remove('show'); this.real = false; } }, wait);
  }
};

/* ---------------- Toast / Confirm ---------------- */
function toast(msg, type = 'success') {
  const icon = { success: 'fa-circle-check text-success', error: 'fa-circle-xmark text-danger', warning: 'fa-triangle-exclamation text-warning', info: 'fa-circle-info text-primary' }[type];
  const d = document.createElement('div');
  d.className = 'toast-x ' + type; d.setAttribute('role', 'status');
  d.innerHTML = `<i class="fa-solid ${icon} fa-lg"></i><div>${esc(msg)}</div>`;
  $('#toasts').appendChild(d);
  setTimeout(() => { d.style.transition = 'opacity .3s'; d.style.opacity = 0; setTimeout(() => d.remove(), 300); }, type === 'error' ? 5000 : 3000);
}
async function confirmBox({ title, html, danger = false, confirmText = 'ยืนยัน', icon }) {
  const r = await Swal.fire({ title, html, icon: icon || (danger ? 'warning' : 'question'), showCancelButton: true, reverseButtons: true, focusCancel: danger,
    confirmButtonText: confirmText, cancelButtonText: 'ยกเลิก', confirmButtonColor: danger ? '#dc2626' : '#2563eb', cancelButtonColor: '#64748b' });
  return r.isConfirmed;
}
window.addEventListener('unhandledrejection', e => { if (e.reason && e.reason.message) { toast(e.reason.message, 'error'); e.preventDefault(); } });

/* ---------------- API: ห่อ google.script.run เป็น Promise ---------------- */
function call(fn, args, o = {}) {
  const run = () => new Promise((res, rej) => {
    if (!(window.google && google.script && google.script.run)) return rej(Object.assign(new Error('ไม่พบการเชื่อมต่อ Google Apps Script'), { code: 'NET' }));
    google.script.run
      .withSuccessHandler(r => r && r.ok ? res(r.data) : rej(Object.assign(new Error(r ? r.error : 'ไม่ได้รับการตอบกลับจากเซิร์ฟเวอร์'), { code: r && r.code })))
      .withFailureHandler(e => rej(Object.assign(new Error(/network|NetworkError|timed? ?out/i.test(String(e && e.message)) ? 'การเชื่อมต่อขัดข้อง กรุณาตรวจสอบอินเทอร์เน็ต' : 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์: ' + (e && e.message || e)), { code: 'NET' })))
      .rpc(fn, S.token, args);
  });
  const attempt = n => run().catch(e => e.code === 'NET' && n > 0 ? new Promise(r => setTimeout(r, 800)).then(() => attempt(n - 1)) : Promise.reject(e));
  if (o.loader !== false) Loader.show(o.msg);
  return attempt(o.retry ?? 1)
    .catch(e => { if (e.code === 'AUTH' && S.token) { localLogout(); toast(e.message, 'warning'); } throw e; })
    .finally(() => { if (o.loader !== false) Loader.hide(); });
}
const api = (fn, ...a) => call(fn, a);
const apiQ = (fn, ...a) => call(fn, a, { loader: false });
const apiMsg = (msg, fn, ...a) => call(fn, a, { msg });

/* ---------------- Utils ---------------- */
const debounce = (f, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
const toDate = s => s ? new Date(String(s).length <= 10 ? s + 'T00:00:00' : String(s).replace(' ', 'T')) : null;
function thDate(s, time = false) {
  const d = s instanceof Date ? s : toDate(s);
  if (!d || isNaN(d)) return '-';
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) + (time ? ' ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.' : '');
}
const nowStr = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.ceil(b / 1024) + ' KB';
const initials = n => esc(String(n || '?').trim().charAt(0));
const avatarHtml = (u, size = 40) => u && u.avatar ? `<img class="avatar" style="width:${size}px;height:${size}px" src="${safeUrl(u.avatar)}" alt="">` : `<span class="avatar" style="width:${size}px;height:${size}px">${initials(u && u.fullName)}</span>`;
const linkify = s => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
const skeleton = (n = 6) => `<div class="grid g3">${'<div class="skel"></div>'.repeat(n)}</div>`;
const empty = (icon, text, btn = '', act = '') => `<div class="empty"><i class="fa-solid ${icon}"></i><div class="mb-3">${esc(text)}</div>${btn ? `<button class="btn btn-primary" data-act="${act}">${esc(btn)}</button>` : ''}</div>`;
const grades = () => [...new Set(S.classes.map(c => c.grade))];
const rooms = g => S.classes.filter(c => !g || c.grade === g).map(c => c.room).filter((v, i, a) => v && a.indexOf(v) === i);
const STATUS = { pending: ['ยังไม่ส่ง', 'warn'], overdue: ['เลยกำหนด', 'danger'], ontime: ['ส่งตรงเวลา', 'ok'], late: ['ส่งช้า', 'warn'], submitted: ['ส่งแล้ว', 'ok'], graded: ['ตรวจแล้ว', 'info'] };
const statusChip = s => `<span class="chip ${STATUS[s] ? STATUS[s][1] : ''}">${STATUS[s] ? STATUS[s][0] : esc(s)}</span>`;
const fileIcon = n => { const e = String(n).split('.').pop().toLowerCase(); return { pdf: 'fa-file-pdf text-danger', doc: 'fa-file-word text-primary', docx: 'fa-file-word text-primary', ppt: 'fa-file-powerpoint text-warning', pptx: 'fa-file-powerpoint text-warning', xls: 'fa-file-excel text-success', xlsx: 'fa-file-excel text-success', zip: 'fa-file-zipper', rar: 'fa-file-zipper', jpg: 'fa-file-image text-info', jpeg: 'fa-file-image text-info', png: 'fa-file-image text-info', mp4: 'fa-file-video', mp3: 'fa-file-audio' }[e] || 'fa-file'; };
const driveId = u => (String(u || '').match(/(?:\/d\/|id=)([\w-]{20,})/) || [])[1] || '';

/* ---------------- Modal ---------------- */
function modal(title, body, foot = '', size = 'modal-lg') {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = body;
  $('#modalFoot').innerHTML = foot;
  $('#modal .modal-dialog').className = `modal-dialog ${size} modal-dialog-centered modal-dialog-scrollable modal-fullscreen-sm-down`;
  const m = bootstrap.Modal.getOrCreateInstance('#modal');
  m.show();
  return { el: $('#modal'), body: $('#modalBody'), foot: $('#modalFoot'), hide: () => m.hide() };
}
$('#modal').addEventListener('hidden.bs.modal', () => { $('#modalBody').innerHTML = ''; });

/* ---------------- ฟอร์มกลาง ---------------- */
function opt(list, v) { return list.map(o => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(val) === String(v ?? '') ? 'selected' : ''}>${esc(lab)}</option>`; }).join(''); }
function fieldHtml(f, v) {
  const id = 'f_' + f.k; v = v ?? f.def ?? '';
  let input;
  switch (f.type) {
    case 'textarea': input = `<textarea class="form-control" id="${id}" name="${f.k}" rows="${f.rows || 4}">${esc(v)}</textarea>`; break;
    case 'select': input = `<select class="form-select" id="${id}" name="${f.k}">${opt(typeof f.opts === 'function' ? f.opts() : f.opts, v)}</select>`; break;
    case 'check': return `<div class="mb-3 ${f.col || ''}"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" role="switch" id="${id}" name="${f.k}" ${String(v) === 'true' ? 'checked' : ''}><label class="form-check-label" for="${id}">${f.label}</label></div>${f.help ? `<div class="form-text">${f.help}</div>` : ''}</div>`;
    case 'image': input = `<div class="d-flex gap-3 align-items-center"><img data-preview="${f.k}" src="${v ? safeUrl(v) : ''}" class="${v ? '' : 'hidden'}" alt="" style="width:96px;height:64px;object-fit:${f.contain ? 'contain' : 'cover'};border-radius:12px;background:var(--surface-2)">
      <input type="file" accept="image/*" class="form-control" id="${id}" data-image="${f.k}" data-w="${f.w || 480}" data-h="${f.h || 270}" data-png="${f.png ? 1 : ''}"><button type="button" class="btn btn-soft btn-icon flex-none" data-clear-img="${f.k}" aria-label="ลบรูป"><i class="fa-solid fa-xmark"></i></button></div><input type="hidden" name="${f.k}" value="${esc(v)}">`; break;
    case 'files': input = `<div class="drop" data-drop="${f.k}" tabindex="0" role="button" aria-label="อัปโหลดไฟล์"><i class="fa-solid fa-cloud-arrow-up fa-xl mb-2 d-block"></i>ลากไฟล์มาวาง หรือแตะเพื่อเลือก<br><small>ไม่เกิน ${S.maxMB} MB ต่อไฟล์ (ไฟล์ใหญ่กว่านี้ให้แนบเป็นลิงก์ Google Drive)</small><input type="file" multiple class="hidden"></div><div data-files="${f.k}"></div><input type="hidden" name="${f.k}" value="${esc(JSON.stringify(J(v)))}">`; break;
    case 'links': input = `<textarea class="form-control" id="${id}" name="${f.k}" rows="3" placeholder="ชื่อลิงก์ | https://...">${esc(J(v).map(l => l.name + ' | ' + l.url).join('\n'))}</textarea><div class="form-text">บรรทัดละ 1 ลิงก์ รูปแบบ: ชื่อ | URL</div>`; break;
    case 'video': input = `<div class="input-group"><input class="form-control" id="${id}" name="${f.k}" value="${esc(v)}" placeholder="ลิงก์ YouTube / Vimeo / Google Drive / ไฟล์ .mp4"><button type="button" class="btn btn-soft" data-upvideo="${f.k}"><i class="fa-solid fa-upload"></i> อัปโหลด</button><input type="file" accept="video/*" class="hidden"></div>`; break;
    case 'datetime': case 'date': input = `<input class="form-control" data-fp="${f.type}" id="${id}" name="${f.k}" value="${esc(v)}" placeholder="แตะเพื่อเลือก${f.type === 'date' ? 'วันที่' : 'วันและเวลา'}">`; break;
    case 'dob': input = dobHtml(id, v) + `<input type="hidden" name="${f.k}" value="${esc(v)}">`; break;
    default: input = `<input class="form-control" type="${f.type || 'text'}" id="${id}" name="${f.k}" value="${esc(v)}" ${f.attrs || ''}>`;
  }
  return `<div class="mb-3 ${f.col || ''}"><label class="form-label" for="${id}">${f.label}${f.req ? ' <span class="text-danger">*</span>' : ''}</label>${input}${f.help ? `<div class="form-text">${f.help}</div>` : ''}<div class="invalid-msg" data-err="${f.k}"></div></div>`;
}
const formHtml = (fields, data = {}) => `<div class="row">${fields.map(f => fieldHtml(Object.assign({ col: 'col-12' }, f), data[f.k])).join('')}</div>`;
function readForm(root, fields) {
  const o = {};
  fields.forEach(f => {
    const el = root.querySelector(`[name="${f.k}"]`);
    if (!el) return;
    if (f.type === 'dob') { el.value = readDob('f_' + f.k); }
    if (f.type === 'check') o[f.k] = el.checked ? 'true' : 'false';
    else if (f.type === 'files') o[f.k] = J(el.value);
    else if (f.type === 'links') o[f.k] = el.value.split('\n').map(l => l.split('|')).filter(p => p.length >= 2).map(p => ({ name: p[0].trim(), url: p.slice(1).join('|').trim() }));
    else o[f.k] = el.value.trim();
  });
  return o;
}
function validate(root, fields, only) {
  const o = readForm(root, fields); let ok = true;
  fields.forEach(f => {
    if (only && f.k !== only) return;
    let m = '';
    if (f.req && !String(Array.isArray(o[f.k]) ? o[f.k].length || '' : o[f.k] ?? '').trim()) m = 'กรุณากรอก' + f.label.replace(/<[^>]+>/g, '');
    else if (f.valid) m = f.valid(o[f.k], o) || '';
    const err = root.querySelector(`[data-err="${f.k}"]`); if (err) err.textContent = m;
    const el = root.querySelector(`[name="${f.k}"]`); if (el && f.type !== 'files') el.classList.toggle('is-invalid', !!m);
    if (m) ok = false;
  });
  return ok ? o : null;
}
function bindForm(root, fields = []) {
  fields.forEach(f => {
    const el = root.querySelector(`[name="${f.k}"]`);
    if (el && !['files', 'image'].includes(f.type)) el.addEventListener(f.type === 'select' || f.type === 'check' ? 'change' : 'input', debounce(() => validate(root, fields, f.k), 250));
  });
  $$('[data-fp]', root).forEach(el => flatpickr(el, Object.assign({ locale: 'th', disableMobile: true, altInput: true, altFormat: 'BE',
    formatDate: (d, fmt, l) => fmt === 'BE' ? thDate(d, el.dataset.fp === 'datetime') : flatpickr.formatDate(d, fmt, l) },
    el.dataset.fp === 'datetime' ? { enableTime: true, time_24hr: true, dateFormat: 'Y-m-d\\TH:i' } : { dateFormat: 'Y-m-d' })));
  $$('[data-image]', root).forEach(inp => inp.addEventListener('change', async () => {
    const f = inp.files[0]; if (!f) return;
    if (!/^image\//.test(f.type)) return toast('กรุณาเลือกไฟล์รูปภาพ', 'error');
    const url = await resizeImage(f, +inp.dataset.w, +inp.dataset.h, !!inp.dataset.png);
    root.querySelector(`[name="${inp.dataset.image}"]`).value = url;
    const pv = root.querySelector(`[data-preview="${inp.dataset.image}"]`); pv.src = url; pv.classList.remove('hidden');
  }));
  $$('[data-clear-img]', root).forEach(b => b.onclick = () => { root.querySelector(`[name="${b.dataset.clearImg}"]`).value = ''; root.querySelector(`[data-preview="${b.dataset.clearImg}"]`).classList.add('hidden'); });
  $$('[data-drop]', root).forEach(z => {
    const key = z.dataset.drop, hidden = root.querySelector(`[name="${key}"]`), list = root.querySelector(`[data-files="${key}"]`), inp = $('input', z);
    const draw = () => { list.innerHTML = filesHtml(J(hidden.value), true); $$('[data-rm]', list).forEach(b => b.onclick = () => { const a = J(hidden.value); a.splice(+b.dataset.rm, 1); hidden.value = JSON.stringify(a); draw(); }); };
    const add = async files => { const up = await uploadFiles(files, z.dataset.kind || ''); hidden.value = JSON.stringify(J(hidden.value).concat(up)); draw(); hidden.dispatchEvent(new Event('change')); };
    z.onclick = () => inp.click(); z.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } };
    inp.onchange = () => { add([...inp.files]); inp.value = ''; };
    ['dragenter', 'dragover'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.remove('over'); }));
    z.addEventListener('drop', e => add([...e.dataTransfer.files]));
    draw();
  });
  $$('[data-upvideo]', root).forEach(b => {
    const inp = b.nextElementSibling;
    b.onclick = () => inp.click();
    inp.onchange = async () => { const up = await uploadFiles([...inp.files]); if (up[0]) root.querySelector(`[name="${b.dataset.upvideo}"]`).value = up[0].url; inp.value = ''; };
  });
}
function filesHtml(files, removable = false) {
  return (files || []).map((f, i) => `<div class="file-row"><i class="fa-solid ${fileIcon(f.name)} fa-lg"></i><a href="${safeUrl(f.url)}" target="_blank" rel="noopener" data-preview-file='${esc(JSON.stringify(f))}'>${esc(f.name)}</a><small class="text-muted">${f.size ? fmtSize(f.size) : ''}</small>
    ${removable ? `<button type="button" class="btn btn-sm btn-icon btn-soft" data-rm="${i}" aria-label="ลบไฟล์ ${esc(f.name)}"><i class="fa-solid fa-trash"></i></button>` : `<a class="btn btn-sm btn-icon btn-soft" href="https://drive.google.com/uc?export=download&id=${esc(f.id || driveId(f.url))}" target="_blank" rel="noopener" aria-label="ดาวน์โหลด"><i class="fa-solid fa-download"></i></a>`}</div>`).join('');
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-preview-file]');
  if (!a || e.target.closest('[data-rm]')) return;
  const f = J(a.dataset.previewFile, {}), id = f.id || driveId(f.url);
  if (!id) return;
  e.preventDefault();
  modal(f.name, `<div class="ratio ratio-4x3"><iframe src="https://drive.google.com/file/d/${esc(id)}/preview" allow="autoplay" title="${esc(f.name)}"></iframe></div>`,
    `<a class="btn btn-soft" target="_blank" rel="noopener" href="${safeUrl(f.url)}"><i class="fa-solid fa-up-right-from-square"></i> เปิดในแท็บใหม่</a><a class="btn btn-primary" target="_blank" rel="noopener" href="https://drive.google.com/uc?export=download&id=${esc(id)}"><i class="fa-solid fa-download"></i> ดาวน์โหลด</a>`, 'modal-xl');
});
const ALLOWED = ['pdf','doc','docx','ppt','pptx','xls','xlsx','csv','txt','jpg','jpeg','png','gif','webp','zip','rar','7z','mp4','mov','webm','mp3','m4a'];
async function uploadFiles(files, kind = '') {
  const out = [];
  for (const file of files) {
    const ext = file.name.toLowerCase().split('.').pop();
    if (!ALLOWED.includes(ext)) { toast(`ไม่รองรับไฟล์ .${ext} (${file.name})`, 'error'); continue; }
    if (file.size > S.maxMB * 1048576) { toast(`${file.name} ใหญ่เกิน ${S.maxMB} MB — อัปโหลดไว้ใน Google Drive แล้วแนบเป็นลิงก์แทน`, 'error'); continue; }
    Loader.show('กำลังอ่านไฟล์ ' + file.name);
    try {
      const data = await new Promise((res, rej) => { const r = new FileReader(); r.onprogress = e => e.lengthComputable && Loader.set(e.loaded / e.total * 40); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
      Loader.set(45, 'กำลังอัปโหลด ' + file.name); Loader.real = false;
      out.push(await apiQ('uploadFile', { name: file.name, mime: file.type, data, kind }));
      toast('อัปโหลด ' + file.name + ' แล้ว');
    } finally { Loader.hide(); }
  }
  return out;
}
function resizeImage(file, w, h, png) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, w / img.width, h / img.height), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      let q = .85, out = png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', q);
      while (out.length > 44000 && q > .3) { q -= .1; out = c.toDataURL(png ? 'image/webp' : 'image/jpeg', q); }
      out.length > 46000 ? rej(new Error('รูปใหญ่เกินไป กรุณาใช้รูปที่เล็กลง')) : res(out);
    };
    img.onerror = () => rej(new Error('อ่านรูปไม่ได้'));
    img.src = url;
  });
}
/* วันเกิด: Dropdown วัน / เดือน / ปี พ.ศ. */
const MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
function dobHtml(id, v) {
  const [y, m, d] = String(v || '').split('-'), cy = new Date().getFullYear();
  const days = Array.from({ length: 31 }, (_, i) => [String(i + 1).padStart(2, '0'), i + 1]);
  const years = Array.from({ length: 96 }, (_, i) => [String(cy - 4 - i), cy - 4 - i + 543]);
  return `<div class="dob" id="${id}"><select class="form-select" aria-label="วัน"><option value="">วัน</option>${opt(days, d)}</select><select class="form-select" aria-label="เดือน"><option value="">เดือน</option>${opt(MONTHS.map((n, i) => [String(i + 1).padStart(2, '0'), n]), m)}</select><select class="form-select" aria-label="ปี พ.ศ."><option value="">ปี พ.ศ.</option>${opt(years, y)}</select></div>`;
}
function readDob(id) {
  const s = $$('#' + id + ' select').map(x => x.value);
  if (s.some(x => !x)) return '';
  const v = `${s[2]}-${s[1]}-${s[0]}`, d = new Date(v + 'T00:00:00');
  return d.getDate() === +s[0] ? v : 'invalid';
}
const dobValid = v => !v ? 'กรุณาเลือกวันเกิดให้ครบ' : v === 'invalid' ? 'วันที่ไม่ถูกต้อง' : (() => { const age = (Date.now() - toDate(v)) / 3.15576e10; return age < 5 || age > 100 ? 'วันเกิดไม่สมเหตุสมผล (อายุ 5–100 ปี)' : ''; })();

/* ---------------- ตาราง + แบ่งหน้า + ค้นหา ---------------- */
function tableHtml(headers, rows) {
  if (!rows.length) return empty('fa-inbox', 'ยังไม่มีข้อมูล');
  return `<div class="table-responsive-md"><table class="table-x"><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td data-label="${esc(String(headers[i]).replace(/<[^>]+>/g, ''))}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
/** list view: ค้นหา debounce 300ms + Pagination */
function listView(root, { items, headers, row, search, filters = '', size = 15, onFilter }) {
  root.innerHTML = `<div class="d-flex flex-wrap gap-2 mb-3"><div class="flex-fill" style="min-width:220px"><input class="form-control" type="search" placeholder="ค้นหา..." aria-label="ค้นหา" data-q></div>${filters}</div><div data-t></div><nav class="d-flex justify-content-center gap-2 mt-3 flex-wrap" data-p></nav>`;
  let page = 1;
  const draw = () => {
    const q = $('[data-q]', root).value.trim().toLowerCase();
    let list = items.filter(it => !q || search(it).toLowerCase().includes(q));
    if (onFilter) list = list.filter(it => onFilter(it, root));
    const pages = Math.max(1, Math.ceil(list.length / size)); page = Math.min(page, pages);
    $('[data-t]', root).innerHTML = tableHtml(headers, list.slice((page - 1) * size, page * size).map(row)) + `<div class="text-muted small mt-2">ทั้งหมด ${list.length} รายการ</div>`;
    $('[data-p]', root).innerHTML = pages > 1 ? Array.from({ length: pages }, (_, i) => `<button class="btn btn-sm ${i + 1 === page ? 'btn-primary' : 'btn-soft'}" data-pg="${i + 1}" style="min-width:44px">${i + 1}</button>`).join('') : '';
    $$('[data-pg]', root).forEach(b => b.onclick = () => { page = +b.dataset.pg; draw(); root.scrollIntoView({ behavior: 'smooth' }); });
  };
  $('[data-q]', root).addEventListener('input', debounce(() => { page = 1; draw(); }, 300));
  $$('select[data-f]', root).forEach(s => s.onchange = () => { page = 1; draw(); });
  draw();
  return draw;
}

/* ---------------- Theme ---------------- */
function applyTheme(t) {
  t = t || store.get('cp_theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = t; document.documentElement.setAttribute('data-bs-theme', t);
}
$('#themeBtn').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; store.set('cp_theme', t); applyTheme(t); };
applyTheme();

/* ---------------- Branding ---------------- */
function applyBrand() {
  const c = S.config, logo = c.logo ? `<img src="${safeUrl(c.logo)}" alt="โลโก้">` : DEFAULT_LOGO;
  $$('[data-logo]').forEach(el => el.innerHTML = logo);
  $$('[data-school]').forEach(el => el.textContent = c.schoolName || 'Classroom PLus');
  $('#welcomeText').textContent = c.welcome || 'ยินดีต้อนรับ สู่ห้องเรียนออนไลน์แห่งอนาคต';
  $('#brand').classList.toggle('custom', !!c.logo || (c.schoolName && c.schoolName !== 'Classroom PLus'));
  document.title = c.schoolName || 'Classroom PLus';
}
