// node tools/build-preview.js <out.html> — สร้างหน้าตัวอย่างที่รัน Code.gs จริงในเบราว์เซอร์ (ข้อมูลอยู่ในเครื่องผู้ชมเท่านั้น)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
const shim = fs.readFileSync(path.join(__dirname, 'gas-shim.js'), 'utf8');
const code = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
const bridge = `<script>${shim}
window.__rpc = (function(){ ${code}\n return rpc; })();
window.google = { script: { get run() {
  const h = {};
  const p = new Proxy({}, { get: (t, k) => k === 'withSuccessHandler' ? f => (h.ok = f, p) : k === 'withFailureHandler' ? f => (h.fail = f, p)
    : (...a) => setTimeout(() => { try { const r = window.__rpc(...a); h.ok && h.ok(r); } catch (e) { h.fail && h.fail(e); } }, 120) });
  return p; } } };
</script>
<script>addEventListener('DOMContentLoaded',()=>document.querySelector('.auth-card').insertAdjacentHTML('afterend','<div style="background:#fef3c7;color:#78350f;border-radius:12px;padding:6px 10px;margin:12px auto 0;max-width:640px;font-size:13px;text-align:center">โหมดตัวอย่าง: ระบบทำงานจริงแต่ข้อมูลเก็บในเบราว์เซอร์นี้เท่านั้น · Admin เริ่มต้น admin / admin123 · <a href=\\"#\\" onclick=\\"__resetShim();localStorage.clear();location.reload();return false\\">รีเซ็ตข้อมูล</a></div>'))</script>
`;
let out = html.replace("<script>\n'use strict';", bridge + "<script>\n'use strict';");
if (out === html) throw new Error('inject point not found');
// --inline <node_modules dir>: ฝังไลบรารีทั้งหมดในไฟล์ (สำหรับเผยแพร่ที่ไม่อนุญาต CDN / ทดสอบออฟไลน์)
const iv = process.argv.indexOf('--inline');
if (iv > 0) {
  const nm = process.argv[iv + 1];
  const MAP = {
    'bootstrap@5.3.3/dist/css/bootstrap.min.css': 'bootstrap/dist/css/bootstrap.min.css',
    'font-awesome/6.5.2/css/all.min.css': '@fortawesome/fontawesome-free/css/all.min.css',
    'flatpickr@4.6.13/dist/flatpickr.min.css': 'flatpickr/dist/flatpickr.min.css',
    'sweetalert2@11.12.4/dist/sweetalert2.min.css': 'sweetalert2/dist/sweetalert2.min.css',
    'bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js': 'bootstrap/dist/js/bootstrap.bundle.min.js',
    'chart.js@4.4.1/dist/chart.umd.min.js': 'chart.js/dist/chart.umd.js',
    'sweetalert2@11.12.4/dist/sweetalert2.all.min.js': 'sweetalert2/dist/sweetalert2.all.min.js',
    'xlsx@0.18.5/dist/xlsx.full.min.js': 'xlsx/dist/xlsx.full.min.js',
    'flatpickr@4.6.13/dist/flatpickr.min.js': 'flatpickr/dist/flatpickr.min.js',
    'flatpickr@4.6.13/dist/l10n/th.js': 'flatpickr/dist/l10n/th.js'
  };
  const local = u => { const k = Object.keys(MAP).find(k => u.endsWith(k)); if (!k) return null; let t = fs.readFileSync(path.join(nm, MAP[k]), 'utf8');
    if (k.includes('font-awesome')) t = t.replace(/url\(\.\.\/webfonts\/([\w-]+)\.woff2\) format\("woff2"\),url\(\.\.\/webfonts\/[\w-]+\.ttf\) format\("truetype"\)/g, (m, f) => 'url(data:font/woff2;base64,' + fs.readFileSync(path.join(nm, '@fortawesome/fontawesome-free/webfonts', f + '.woff2')).toString('base64') + ') format("woff2")');
    return t; };
  out = out.replace(/<link href="([^"]+)" rel="stylesheet">/g, (m, u) => { const t = local(u); return t === null ? m : '<style>' + t + '</style>'; })
           .replace(/<script src="([^"]+)"><\/script>/g, (m, u) => { const t = local(u); return t === null ? m : '<script>' + t.replace(/<\/script/gi, '<\\/script') + '</script>'; });
}
fs.writeFileSync(process.argv[2] || path.join(root, 'preview.html'), out);
console.log('preview written', out.length);
