
/* =========================================================
 * หน้าสำหรับนักเรียน (และ Admin ในโหมด User)
 * ========================================================= */
const coverHtml = (c, icon = 'fa-book-open') => {
  const v = parseVideo(c.videoUrl);
  const src = c.cover || (v && v.type === 'youtube' ? `https://img.youtube.com/vi/${v.id}/hqdefault.jpg` : '');
  return `<div class="cover">${src ? `<img src="${safeUrl(src)}" alt="" loading="lazy">` : `<i class="fa-solid ${icon}"></i>`}</div>`;
};
const statCard = (icon, val, label, color = '') => `<div class="card-x stat"><div class="ic" style="${color}"><i class="fa-solid ${icon}"></i></div><div><b>${val}</b><small>${label}</small></div></div>`;

PAGES.home = { async render(el) {
  const d = await apiQ('studentHome'), s = d.stats, u = S.user;
  el.innerHTML = `
  <div class="card-x mb-3 text-white" style="background:linear-gradient(120deg,#1e3a8a,#2563eb,#0ea5e9);border:0">
    <div class="d-flex align-items-center gap-3">${avatarHtml(u, 56)}<div><div class="opacity-75">สวัสดี</div><h4 class="m-0 fw-bold">${esc(u.prefix + u.fullName)}</h4>
    <small class="opacity-75">${u.role === 'student' ? `รหัส ${esc(u.studentCode)} · ${esc(u.grade || '')}${u.room ? '/' + esc(u.room) : ''}` : 'กำลังดูในโหมดนักเรียน'}</small></div></div></div>
  <div class="grid g4 mb-3">
    ${statCard('fa-chart-line', s.percent + '%', 'ความคืบหน้าการเรียน')}
    ${statCard('fa-book-open-reader', `${s.lessonsDone}/${s.lessonsTotal}`, 'บทเรียนที่เรียนแล้ว')}
    ${statCard('fa-circle-play', s.videosDone, 'วิดีโอที่ดูครบ', 'background:#ede9fe;color:#7c3aed')}
    ${statCard('fa-hourglass-half', s.pending, 'งานค้างส่ง', 'background:#fef3c7;color:#b45309')}
    ${statCard('fa-paper-plane', s.submitted, 'งานที่ส่งแล้ว', 'background:#dcfce7;color:#15803d')}
    ${statCard('fa-star', s.avgScore === null ? '-' : s.avgScore + '%', 'คะแนนเฉลี่ย', 'background:#fee2e2;color:#b91c1c')}
  </div>
  <div class="grid g2">
    <div class="card-x"><h5 class="fw-bold mb-3"><i class="fa-solid fa-book me-2 text-primary"></i>วิชาที่กำลังเรียน</h5>
      ${d.courses.length ? `<canvas id="chCourse" height="${Math.max(120, d.courses.length * 38)}"></canvas>` : empty('fa-book', 'ยังไม่มีรายวิชาสำหรับชั้นเรียนของคุณ')}</div>
    <div class="card-x"><h5 class="fw-bold mb-3"><i class="fa-solid fa-hourglass-half me-2 text-warning"></i>งานค้างส่ง</h5>
      ${d.pending.length ? d.pending.map(a => `<div class="lesson-item" data-go="assignments"><div class="num"><i class="fa-solid fa-file-pen"></i></div><div class="flex-fill"><b>${esc(a.title)}</b><div class="small text-muted">${esc(a.courseName)} · ส่ง ${thDate(a.dueAt, true)}</div></div>${statusChip(a.status)}</div>`).join('') : empty('fa-face-smile', 'ไม่มีงานค้าง เยี่ยมมาก!')}</div>
    <div class="card-x"><h5 class="fw-bold mb-3"><i class="fa-solid fa-star me-2 text-danger"></i>คะแนนล่าสุด</h5>
      ${d.latestScores.length ? d.latestScores.map(a => `<div class="lesson-item" data-go="assignments"><div class="num">${esc(a.sub.score)}</div><div class="flex-fill"><b>${esc(a.title)}</b><div class="small text-muted">เต็ม ${esc(a.maxScore)} · ${esc(a.sub.feedback || 'ไม่มีความคิดเห็น')}</div></div></div>`).join('') : empty('fa-star', 'ยังไม่มีคะแนน')}</div>
    <div class="card-x"><h5 class="fw-bold mb-3"><i class="fa-solid fa-bullhorn me-2 text-primary"></i>ประกาศล่าสุด</h5>
      ${d.announcements.length ? d.announcements.map(a => `<div class="lesson-item" data-go="announcements"><div class="num"><i class="fa-solid ${a.pinned === 'true' ? 'fa-thumbtack' : 'fa-bullhorn'}"></i></div><div class="flex-fill"><b>${esc(a.title)}</b><div class="small text-muted">${esc(a.type)} · ${thDate(a.createdAt)}</div></div></div>`).join('') : empty('fa-bullhorn', 'ยังไม่มีประกาศ')}</div>
  </div>`;
  if (d.courses.length) chart('chCourse', { type: 'bar', data: { labels: d.courses.map(c => c.name), datasets: [{ label: 'ความคืบหน้า %', data: d.courses.map(c => c.percent), backgroundColor: '#3b82f6', borderRadius: 10 }] },
    options: { indexAxis: 'y', scales: { x: { min: 0, max: 100 } }, plugins: { legend: { display: false } }, onClick: (e, els) => els[0] && go('course', { id: d.courses[els[0].index].id }) } });
} };

PAGES.courses = { async render(el) {
  const list = await apiQ('listCourses');
  el.innerHTML = `<div class="page-head"><h3>รายวิชาของฉัน</h3><input class="form-control" style="max-width:320px" type="search" placeholder="ค้นหารายวิชา..." id="cq" aria-label="ค้นหารายวิชา"></div><div id="cl"></div>`;
  const draw = () => {
    const q = $('#cq').value.trim().toLowerCase(), f = list.filter(c => !q || (c.name + c.code + c.category + c.teacher).toLowerCase().includes(q));
    $('#cl').innerHTML = f.length ? `<div class="grid g3">${f.map(c => `<div class="card-x hover" data-go="course" data-id="${esc(c.id)}" role="button" tabindex="0">${coverHtml(c)}
      <div class="d-flex gap-2 mb-1"><span class="chip info">${esc(c.code || 'วิชา')}</span>${c.category ? `<span class="chip">${esc(c.category)}</span>` : ''}</div>
      <h5 class="fw-bold mb-1">${esc(c.name)}</h5><div class="small text-muted mb-2">${esc(c.teacher || '')} · ${c.lessonCount} บทเรียน</div>
      <div class="progress mb-1"><div class="progress-bar" style="width:${c.percent}%"></div></div><small class="text-muted">เรียนแล้ว ${c.doneCount}/${c.lessonCount} (${c.percent}%)</small></div>`).join('')}</div>`
      : empty('fa-book-open', q ? 'ไม่พบรายวิชาที่ค้นหา' : 'ยังไม่มีรายวิชาสำหรับชั้นเรียนของคุณ');
  };
  $('#cq').addEventListener('input', debounce(draw, 300)); draw();
} };
PAGES.course = { parent: 'courses', async render(el, p) {
  const d = await apiQ('getCourse', p.id), c = d.course;
  $('#pageTitle').textContent = c.name;
  const units = {}; d.lessons.forEach(l => (units[l.unit || 'บทเรียน'] = units[l.unit || 'บทเรียน'] || []).push(l));
  let n = 0;
  el.innerHTML = `<button class="btn btn-soft mb-3" data-go="courses"><i class="fa-solid fa-arrow-left"></i> รายวิชาทั้งหมด</button>
  <div class="card-x mb-3"><div class="row g-3 align-items-center"><div class="col-md-4">${coverHtml(c)}</div><div class="col-md-8"><span class="chip info mb-2">${esc(c.code)}</span><h3 class="fw-bold">${esc(c.name)}</h3><p class="text-muted mb-1">${linkify(c.description)}</p><small class="text-muted"><i class="fa-solid fa-chalkboard-user"></i> ${esc(c.teacher || '-')}</small></div></div></div>
  <div class="grid g2"><div class="card-x"><h5 class="fw-bold mb-2">บทเรียน</h5>${d.lessons.length ? Object.keys(units).map(u => `<div class="nav-label px-1">${esc(u)}</div>` + units[u].map(l => { n++; const done = l.progress && l.progress.completed === 'true';
    return `<div class="lesson-item ${done ? 'done' : ''}" data-go="lesson" data-id="${esc(l.id)}" role="button" tabindex="0"><div class="num">${done ? '<i class="fa-solid fa-check"></i>' : n}</div><div class="flex-fill"><b>${esc(l.title)}</b><div class="small text-muted">${l.videoUrl ? '<i class="fa-solid fa-circle-play"></i> วิดีโอ · ' : ''}${l.duration ? esc(l.duration) + ' นาที' : ''}</div></div><i class="fa-solid fa-chevron-right text-muted"></i></div>`; }).join('')).join('') : empty('fa-book', 'ยังไม่มีบทเรียนที่เผยแพร่')}</div>
  <div class="card-x"><h5 class="fw-bold mb-2">งานในรายวิชา</h5>${d.assignments.length ? d.assignments.map(a => `<div class="lesson-item" data-go="assignments"><div class="num"><i class="fa-solid fa-file-pen"></i></div><div class="flex-fill"><b>${esc(a.title)}</b><div class="small text-muted">ส่ง ${thDate(a.dueAt, true)}</div></div>${statusChip(a.status)}</div>`).join('') : empty('fa-clipboard', 'ยังไม่มีงาน')}</div></div>`;
} };

/* ---------------- วิดีโอ ---------------- */
function parseVideo(u) {
  u = String(u || '').trim(); let m;
  if ((m = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/))) return { type: 'youtube', id: m[1] };
  if ((m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/))) return { type: 'vimeo', id: m[1] };
  if ((m = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=)([\w-]{20,})/))) return { type: 'drive', id: m[1] };
  if (/^https?:\/\/.+\.(mp4|webm|ogg|mov)(\?|$)/i.test(u)) return { type: 'file', url: u };
  return null;
}
let YTP = null;
const loadYT = () => YTP || (YTP = new Promise((res, rej) => {
  if (window.YT && YT.Player) return res();
  window.onYouTubeIframeAPIReady = res;
  const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; s.onerror = rej; document.head.appendChild(s);
  setTimeout(() => rej(new Error('yt timeout')), 7000);
}));
function mountVideo(box, url, prog, lessonId) {
  const v = parseVideo(url), pos = Number(prog && prog.videoPos) || 0;
  if (!v) { box.innerHTML = `<a class="btn btn-primary" href="${safeUrl(url)}" target="_blank" rel="noopener"><i class="fa-solid fa-play"></i> เปิดวิดีโอ</a>`; return; }
  let last = pos, done = prog && prog.videoDone === 'true';
  const save = (p, isDone) => { if (isDone && !done) { done = true; apiQ('saveProgress', lessonId, { videoPos: p, videoDone: true }).then(() => toast('บันทึก: ดูวิดีโอครบแล้ว')); } else if (Math.abs(p - last) >= 5) { last = p; apiQ('saveProgress', lessonId, { videoPos: p }).catch(() => {}); } };
  const speedSel = `<select class="form-select form-select-sm w-auto" id="vSpeed" aria-label="ความเร็ว">${[0.5, 0.75, 1, 1.25, 1.5, 2].map(s => `<option value="${s}" ${s === 1 ? 'selected' : ''}>${s}x</option>`).join('')}</select>`;
  const tools = (manual) => `<div class="d-flex flex-wrap gap-2 align-items-center mt-2">${manual ? '' : `<label class="small text-muted" for="vSpeed">ความเร็ว</label>${speedSel}`}
    ${pos > 5 ? `<span class="chip info"><i class="fa-solid fa-clock-rotate-left"></i> เล่นต่อจาก ${Math.floor(pos / 60)}:${String(pos % 60).padStart(2, '0')}</span>` : ''}
    <button class="btn btn-sm btn-soft ms-auto" id="vDone" ${done ? 'disabled' : ''}><i class="fa-solid fa-circle-check"></i> ${done ? 'ดูครบแล้ว' : 'ทำเครื่องหมายว่าดูครบ'}</button></div>`;
  if (v.type === 'youtube') {
    box.innerHTML = `<div class="video"><div id="ytp"></div></div>` + tools(false);
    loadYT().then(() => {
      const pl = new YT.Player('ytp', { videoId: v.id, playerVars: { start: pos, rel: 0, playsinline: 1, modestbranding: 1 }, events: {
        onStateChange: e => { if (e.data === 0) save(Math.floor(pl.getDuration()), true); } } });
      S.timers.push(setInterval(() => { try { if (pl.getPlayerState() === 1) save(Math.floor(pl.getCurrentTime())); } catch (e) {} }, 10000));
      S.onLeave.push(() => { try { save(Math.floor(pl.getCurrentTime())); } catch (e) {} });
      $('#vSpeed').onchange = () => pl.setPlaybackRate(+$('#vSpeed').value);
    }).catch(() => { $('#ytp').outerHTML = `<iframe src="https://www.youtube.com/embed/${v.id}?start=${pos}&rel=0&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="วิดีโอ"></iframe>`; });
  } else if (v.type === 'file') {
    box.innerHTML = `<div class="video"><video controls playsinline preload="metadata" src="${safeUrl(v.url)}"></video></div>` + tools(false);
    const vid = $('video', box);
    vid.addEventListener('loadedmetadata', () => { if (pos && pos < vid.duration - 3) vid.currentTime = pos; });
    vid.addEventListener('timeupdate', () => save(Math.floor(vid.currentTime)));
    vid.addEventListener('ended', () => save(Math.floor(vid.duration), true));
    $('#vSpeed').onchange = () => vid.playbackRate = +$('#vSpeed').value;
  } else {
    const src = v.type === 'vimeo' ? `https://player.vimeo.com/video/${v.id}#t=${pos}s` : `https://drive.google.com/file/d/${v.id}/preview`;
    box.innerHTML = `<div class="video"><iframe src="${src}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen title="วิดีโอ"></iframe></div>` + tools(true);
  }
  $('#vDone').onclick = () => { save(last, true); $('#vDone').disabled = true; $('#vDone').innerHTML = '<i class="fa-solid fa-circle-check"></i> ดูครบแล้ว'; };
}
PAGES.lesson = { parent: 'courses', async render(el, p) {
  const d = await apiQ('getLesson', p.id), l = d.lesson, done = d.progress.completed === 'true';
  $('#pageTitle').textContent = l.title;
  const files = J(l.attachments), links = J(l.links);
  el.innerHTML = `<button class="btn btn-soft mb-3" data-go="course" data-id="${esc(l.courseId)}"><i class="fa-solid fa-arrow-left"></i> ${esc(d.course.name)}</button>
  <div class="row g-3"><div class="col-lg-8">
    ${l.videoUrl ? `<div class="card-x mb-3" id="vBox"></div>` : (l.cover ? `<div class="card-x mb-3">${coverHtml(l)}</div>` : '')}
    <div class="card-x mb-3"><small class="text-primary fw-semibold">${esc(l.unit)}</small><h3 class="fw-bold">${esc(l.title)}</h3>
      <div class="d-flex flex-wrap gap-2 mb-3">${l.duration ? `<span class="chip"><i class="fa-solid fa-clock"></i> ${esc(l.duration)} นาที</span>` : ''}${l.videoDuration ? `<span class="chip"><i class="fa-solid fa-film"></i> ${esc(l.videoDuration)}</span>` : ''}<span class="chip"><i class="fa-solid fa-calendar"></i> ${thDate(l.createdAt)}</span></div>
      <div>${linkify(l.description) || '<span class="text-muted">ไม่มีคำอธิบาย</span>'}</div></div>
  </div><div class="col-lg-4">
    <div class="card-x mb-3"><h6 class="fw-bold">เอกสาร / ไฟล์ดาวน์โหลด</h6>${files.length ? filesHtml(files) : '<div class="text-muted small">ไม่มีไฟล์แนบ</div>'}</div>
    <div class="card-x mb-3"><h6 class="fw-bold">ลิงก์ภายนอก</h6>${links.length ? links.map(x => `<a class="file-row text-decoration-none" href="${safeUrl(x.url)}" target="_blank" rel="noopener"><i class="fa-solid fa-link"></i><span class="flex-fill">${esc(x.name)}</span><i class="fa-solid fa-up-right-from-square small"></i></a>`).join('') : '<div class="text-muted small">ไม่มีลิงก์</div>'}</div>
    <div class="card-x"><button class="btn ${done ? 'btn-success' : 'btn-primary'} w-100 mb-2" id="lDone"><i class="fa-solid fa-circle-check"></i> ${done ? 'เรียนจบแล้ว (แตะเพื่อยกเลิก)' : 'ทำเครื่องหมายว่าเรียนจบ'}</button>
      <div class="d-flex gap-2"><button class="btn btn-soft flex-fill" ${d.prevId ? `data-go="lesson" data-id="${esc(d.prevId)}"` : 'disabled'}><i class="fa-solid fa-chevron-left"></i> ก่อนหน้า</button><button class="btn btn-soft flex-fill" ${d.nextId ? `data-go="lesson" data-id="${esc(d.nextId)}"` : 'disabled'}>ถัดไป <i class="fa-solid fa-chevron-right"></i></button></div></div>
  </div></div>`;
  if (l.videoUrl) mountVideo($('#vBox'), l.videoUrl, d.progress, l.id);
  $('#lDone').onclick = async () => { await api('saveProgress', l.id, { completed: !done }); toast(done ? 'ยกเลิกสถานะเรียนจบ' : 'บันทึกว่าเรียนจบแล้ว'); go('lesson', { id: l.id }); };
} };

/* ---------------- งานของฉัน ---------------- */
PAGES.assignments = { async render(el) {
  const list = await apiQ('listAssignments');
  let tab = 'all';
  el.innerHTML = `<div class="page-head"><h3>งานของฉัน</h3></div><ul class="nav nav-pills gap-2 mb-3 flex-nowrap overflow-auto">${[['all', 'ทั้งหมด'], ['todo', 'ค้างส่ง'], ['sent', 'ส่งแล้ว'], ['graded', 'ตรวจแล้ว']].map(t => `<li class="nav-item"><button class="nav-link ${t[0] === tab ? 'active' : ''}" data-t="${t[0]}">${t[1]} <span class="badge bg-light text-dark">${list.filter(a => flt(t[0], a)).length}</span></button></li>`).join('')}</ul><div id="al"></div>`;
  function flt(t, a) { return t === 'all' || (t === 'todo' && !a.sub) || (t === 'sent' && a.sub && a.status !== 'graded') || (t === 'graded' && a.status === 'graded'); }
  const draw = () => {
    const f = list.filter(a => flt(tab, a));
    $('#al').innerHTML = f.length ? `<div class="grid g2">${f.map(a => { const canEdit = (!a.sub || a.status !== 'graded') && a.dueAt.replace(' ', 'T') > nowStr();
      return `<div class="card-x"><div class="d-flex gap-2 mb-2 flex-wrap"><span class="chip info">${esc(a.type)}</span>${statusChip(a.status)}</div>
      <h5 class="fw-bold mb-1">${esc(a.title)}</h5><div class="small text-muted mb-2">${esc(a.courseName)} · คะแนนเต็ม ${esc(a.maxScore)}</div>
      <div class="small mb-2"><i class="fa-solid fa-calendar-day text-danger"></i> กำหนดส่ง ${thDate(a.dueAt, true)}</div>
      ${a.sub ? `<div class="small text-muted mb-2"><i class="fa-solid fa-paper-plane"></i> ส่งเมื่อ ${thDate(a.sub.submittedAt, true)}${a.sub.updatedAt !== a.sub.submittedAt ? ' · แก้ไขล่าสุด ' + thDate(a.sub.updatedAt, true) : ''}</div>` : ''}
      ${a.status === 'graded' ? `<div class="summary mb-2"><div><span>คะแนน</span><b class="text-primary">${esc(a.sub.score)} / ${esc(a.maxScore)}</b></div><div class="border-0 d-block"><span class="text-muted">ความคิดเห็นจากครู</span><div>${linkify(a.sub.feedback || '-')}</div></div></div>` : ''}
      <div class="d-flex gap-2 flex-wrap"><button class="btn btn-soft" data-view="${esc(a.id)}"><i class="fa-solid fa-eye"></i> รายละเอียด</button>${!a.sub && !canEdit && a.status === 'overdue' ? `<button class="btn btn-warning" data-sub="${esc(a.id)}"><i class="fa-solid fa-upload"></i> ส่งช้า</button>` : canEdit ? `<button class="btn btn-primary" data-sub="${esc(a.id)}"><i class="fa-solid ${a.sub ? 'fa-pen' : 'fa-upload'}"></i> ${a.sub ? 'แก้ไขงาน' : 'ส่งงาน'}</button>` : ''}</div></div>`; }).join('')}</div>`
      : empty('fa-clipboard-check', 'ไม่มีงานในหมวดนี้');
    $$('[data-sub]').forEach(b => b.onclick = () => submitModal(list.find(a => a.id === b.dataset.sub)));
    $$('[data-view]').forEach(b => b.onclick = () => { const a = list.find(x => x.id === b.dataset.view);
      modal(a.title, `<p>${linkify(a.description) || '-'}</p>${filesHtml(J(a.attachments))}${a.sub ? `<hr><h6 class="fw-bold">งานที่ส่ง</h6><p>${linkify(a.sub.text)}</p>${filesHtml(J(a.sub.files))}${a.sub.driveLink ? `<a href="${safeUrl(a.sub.driveLink)}" target="_blank" rel="noopener">${esc(a.sub.driveLink)}</a>` : ''}
        ${J(a.sub.history).length ? `<details class="mt-3"><summary>ประวัติการแก้ไข (${J(a.sub.history).length})</summary>${J(a.sub.history).map(h => `<div class="small text-muted">${thDate(h.at, true)} · ไฟล์ ${h.files} รายการ</div>`).join('')}</details>` : ''}` : ''}`); });
  };
  $$('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; $$('[data-t]').forEach(x => x.classList.toggle('active', x === b)); draw(); });
  draw();
} };
function submitModal(a) {
  const key = 'cp_draft_' + S.user.id + '_' + a.id, draft = J(store.get(key), null);
  const s = a.sub || {}, init = draft || { text: s.text || '', files: J(s.files), driveLink: s.driveLink || '' };
  const F = [{ k: 'text', label: 'ข้อความ / คำตอบ', type: 'textarea', rows: 5 }, { k: 'files', label: 'แนบไฟล์', type: 'files' },
    { k: 'driveLink', label: 'ลิงก์ Google Drive (ไฟล์ใหญ่ให้แนบเป็นลิงก์)', valid: v => v && !/^https:\/\/(drive|docs)\.google\.com\//.test(v) ? 'ต้องเป็นลิงก์ Google Drive/Docs' : '' }];
  const m = modal((a.sub ? 'แก้ไขงาน: ' : 'ส่งงาน: ') + a.title, `<div class="summary mb-3"><div><span>กำหนดส่ง</span><b>${thDate(a.dueAt, true)}</b></div><div><span>คะแนนเต็ม</span><b>${esc(a.maxScore)}</b></div></div>
    <div class="mb-3">${linkify(a.description)}</div>${filesHtml(J(a.attachments))}<hr>${formHtml(F, init)}<div class="small text-muted" id="dSaved"></div>`,
    `<button class="btn btn-soft" data-bs-dismiss="modal">ยกเลิก</button>${a.sub ? '<button class="btn btn-outline-danger" id="unsub"><i class="fa-solid fa-trash"></i> ยกเลิกการส่ง</button>' : ''}<button class="btn btn-primary" id="doSub"><i class="fa-solid fa-paper-plane"></i> ${a.sub ? 'บันทึกการแก้ไข' : 'ส่งงาน'}</button>`);
  $('[data-drop]', m.body).dataset.kind = 'submission';
  bindForm(m.body, F);
  const autosave = debounce(() => { store.set(key, JSON.stringify(readForm(m.body, F))); $('#dSaved').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> บันทึกฉบับร่างอัตโนมัติแล้ว ' + new Date().toLocaleTimeString('th-TH'); }, 800);
  m.body.addEventListener('input', autosave); m.body.addEventListener('change', autosave);
  $('#doSub').onclick = async () => {
    const d = validate(m.body, F); if (!d) return;
    if (!d.text && !d.files.length && !d.driveLink) return toast('กรุณาแนบไฟล์ ลิงก์ หรือพิมพ์ข้อความอย่างน้อย 1 อย่าง', 'warning');
    if (!await confirmBox({ title: a.sub ? 'ยืนยันการแก้ไขงาน' : 'ยืนยันการส่งงาน', html: `<b>${esc(a.title)}</b>${a.dueAt.replace(' ', 'T') < nowStr() ? '<br><span class="text-danger">เลยกำหนดส่งแล้ว ระบบจะบันทึกว่า "ส่งช้า"</span>' : ''}` })) return;
    await apiMsg('กำลังส่งงาน...', 'submitWork', a.id, d);
    store.del(key); m.hide(); toast('ส่งงานเรียบร้อย'); go('assignments');
  };
  $('#unsub') && ($('#unsub').onclick = async () => {
    if (!await confirmBox({ title: 'ยกเลิกการส่งงาน?', html: `งาน <b>${esc(a.title)}</b> จะถูกลบออก (ไฟล์ใน Drive ยังอยู่)`, danger: true, confirmText: 'ยกเลิกการส่ง' })) return;
    await api('deleteSubmission', a.id); m.hide(); toast('ยกเลิกการส่งแล้ว'); go('assignments');
  });
}

/* ---------------- ประกาศ (Infinite Scroll) ---------------- */
PAGES.announcements = { async render(el) {
  const list = await apiQ('listAnnouncements');
  let shown = 0;
  el.innerHTML = `<div class="page-head"><h3>ประกาศ</h3></div><div id="annList" class="d-flex flex-column gap-3"></div><div id="annMore" class="py-3 text-center text-muted"></div>`;
  if (!list.length) { $('#annList').innerHTML = empty('fa-bullhorn', 'ยังไม่มีประกาศ'); return; }
  const more = () => {
    $('#annList').insertAdjacentHTML('beforeend', list.slice(shown, shown + 8).map(annCard).join(''));
    shown += 8; $('#annMore').textContent = shown >= list.length ? 'แสดงครบแล้ว' : 'เลื่อนลงเพื่อโหลดเพิ่ม...';
  };
  more();
  const io = new IntersectionObserver(es => es[0].isIntersecting && shown < list.length && more());
  io.observe($('#annMore')); S.onLeave.push(() => io.disconnect());
} };
const annCard = a => `<div class="card-x"><div class="d-flex gap-2 mb-2 flex-wrap">${a.pinned === 'true' ? '<span class="chip warn"><i class="fa-solid fa-thumbtack"></i> ปักหมุด</span>' : ''}<span class="chip info">${esc(a.type)}</span><small class="text-muted ms-auto">${thDate(a.createdAt, true)}</small></div>
  <h5 class="fw-bold">${esc(a.title)}</h5>${a.image ? `<img src="${safeUrl(a.image)}" alt="" class="w-100 rounded-4 mb-2" style="max-height:360px;object-fit:cover">` : ''}<div>${linkify(a.body)}</div>${filesHtml(J(a.attachments))}</div>`;

/* ---------------- ค้นหา ---------------- */
PAGES.search = { async render(el) {
  const courses = await apiQ('listCourses');
  el.innerHTML = `<div class="page-head"><h3>ค้นหา</h3></div>
  <div class="card-x mb-3"><input class="form-control form-control-lg mb-2" type="search" id="sq" placeholder="ค้นหาบทเรียน วิชา ครูผู้สอน คำสำคัญ หมวดหมู่..." aria-label="คำค้นหา">
  <div class="row g-2"><div class="col-6 col-md-3"><select class="form-select" id="sc" aria-label="รายวิชา"><option value="">ทุกรายวิชา</option>${opt(courses.map(c => [c.id, c.name]))}</select></div>
  <div class="col-6 col-md-3"><select class="form-select" id="sr" aria-label="ห้องเรียน"><option value="">ทุกห้องเรียน</option>${opt(S.classes.map(c => c.grade + '/' + c.room))}</select></div>
  <div class="col-6 col-md-2"><input class="form-control" id="sf" data-fp="date" placeholder="ตั้งแต่วันที่"></div><div class="col-6 col-md-2"><input class="form-control" id="st" data-fp="date" placeholder="ถึงวันที่"></div>
  <div class="col-12 col-md-2"><select class="form-select" id="sx" aria-label="ประเภทไฟล์"><option value="">ทุกประเภทไฟล์</option>${opt(['pdf', 'docx', 'pptx', 'xlsx', 'jpg', 'png', 'zip', 'mp4'])}</select></div></div></div><div id="sres"></div>`;
  bindForm(el);
  const ICON = { course: ['fa-book', 'รายวิชา'], lesson: ['fa-book-open-reader', 'บทเรียน'], assignment: ['fa-file-pen', 'งาน'], announcement: ['fa-bullhorn', 'ประกาศ'] };
  const run = async () => {
    const f = { q: $('#sq').value, courseId: $('#sc').value, room: $('#sr').value, from: $('#sf').value, to: $('#st').value, fileType: $('#sx').value };
    if (!f.q && !f.courseId && !f.room && !f.from && !f.to && !f.fileType) { $('#sres').innerHTML = empty('fa-magnifying-glass', 'พิมพ์คำค้นหาหรือเลือกตัวกรอง'); return; }
    $('#sres').innerHTML = '<div class="skel"></div>';
    const r = await apiQ('search', f);
    $('#sres').innerHTML = r.length ? `<div class="card-x">${r.map(x => `<div class="lesson-item" data-k="${x.kind}" data-id="${esc(x.id)}" role="button" tabindex="0"><div class="num"><i class="fa-solid ${ICON[x.kind][0]}"></i></div><div class="flex-fill"><b>${esc(x.title)}</b><div class="small text-muted">${ICON[x.kind][1]} · ${esc(x.sub)}</div></div><small class="text-muted">${thDate(x.date)}</small></div>`).join('')}</div>` : empty('fa-face-meh', 'ไม่พบผลลัพธ์');
    $$('[data-k]', $('#sres')).forEach(d => d.onclick = () => go({ course: 'course', lesson: 'lesson', assignment: 'assignments', announcement: 'announcements' }[d.dataset.k], { id: d.dataset.id }));
  };
  $('#sq').addEventListener('input', debounce(run, 300)); ['#sc', '#sr', '#sf', '#st', '#sx'].forEach(s => $(s).addEventListener('change', run));
  run();
} };

/* ---------------- โปรไฟล์ ---------------- */
PAGES.profile = { async render(el) {
  const u = S.user, stu = u.role === 'student';
  const F = [{ k: 'avatar', label: 'รูปโปรไฟล์', type: 'image', w: 200, h: 200 }, { k: 'prefix', label: 'คำนำหน้าชื่อ', req: true, col: 'col-md-4' }, { k: 'fullName', label: 'ชื่อ-สกุล', req: true, col: 'col-md-8' },
    { k: 'email', label: 'อีเมล (สำหรับรับการแจ้งเตือน)', type: 'email', valid: v => v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? 'อีเมลไม่ถูกต้อง' : '' }]
    .concat(stu ? [{ k: 'studentCode', label: 'รหัสนักเรียน (ใช้เข้าสู่ระบบ)', req: true, attrs: 'inputmode="numeric" maxlength="5"', valid: v => /^\d{5}$/.test(v) ? '' : 'ต้องเป็นตัวเลข 5 หลัก' }] : []);
  el.innerHTML = `<div class="page-head"><h3>โปรไฟล์ของฉัน</h3></div><div class="row g-3"><div class="col-lg-4"><div class="card-x text-center">${avatarHtml(u, 96)}<h5 class="fw-bold mt-2 mb-0">${esc(u.prefix + u.fullName)}</h5>
    <div class="text-muted">${stu ? 'นักเรียน · รหัส ' + esc(u.studentCode) : 'Admin(ครูผู้สอน) · ' + esc(u.username)}</div><div class="small text-muted mt-2">วันเกิด ${thDate(u.birthDate)}<br>ชั้น ${esc(u.grade || '-')}${u.room ? '/' + esc(u.room) : ''}<br>เข้าระบบล่าสุด ${thDate(u.lastLoginAt, true)}</div>
    ${!stu ? '<button class="btn btn-soft mt-3" data-go="settings" data-tab="account"><i class="fa-solid fa-key"></i> เปลี่ยน Username/รหัสผ่าน</button>' : ''}</div></div>
    <div class="col-lg-8"><div class="card-x"><form id="pf">${formHtml(F, u)}<button class="btn btn-primary" type="submit"><i class="fa-solid fa-floppy-disk"></i> บันทึก</button></form></div></div></div>`;
  bindForm(el, F);
  $('#pf').onsubmit = async e => {
    e.preventDefault();
    const d = validate($('#pf'), F); if (!d) return;
    if (!await confirmBox({ title: 'ยืนยันการแก้ไขโปรไฟล์', html: `บันทึกข้อมูลของ <b>${esc(d.prefix + d.fullName)}</b>${stu && d.studentCode !== u.studentCode ? `<br><span class="text-danger">รหัสนักเรียนจะเปลี่ยนเป็น ${esc(d.studentCode)} — ใช้รหัสใหม่ในการเข้าสู่ระบบครั้งต่อไป</span>` : ''}` })) return;
    S.user = await api('updateProfile', d); renderMe(); toast('บันทึกโปรไฟล์แล้ว'); go('profile');
  };
} };
