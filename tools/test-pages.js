// node tools/test-pages.js <node_modules> — ทดสอบโหมด GitHub Pages (fetch → doPost) โดยจำลอง /exec
const { chromium } = require('playwright'), fs = require('fs'), vm = require('vm'), path = require('path');
const NM = process.argv[2], API = 'https://script.google.com/macros/s/TESTDEPLOY/exec';
const ctx = { console, Date, JSON, Math, Object, Array, String, Number, Error, Buffer, TextEncoder, setTimeout }; ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'gas-shim.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8') + '\nglobalThis.doPost=doPost;', ctx);
const LIB = { 'bootstrap.min.css': 'bootstrap/dist/css/bootstrap.min.css', 'all.min.css': '@fortawesome/fontawesome-free/css/all.min.css', 'flatpickr.min.css': 'flatpickr/dist/flatpickr.min.css', 'sweetalert2.min.css': 'sweetalert2/dist/sweetalert2.min.css',
  'bootstrap.bundle.min.js': 'bootstrap/dist/js/bootstrap.bundle.min.js', 'chart.umd.min.js': 'chart.js/dist/chart.umd.js', 'sweetalert2.all.min.js': 'sweetalert2/dist/sweetalert2.all.min.js', 'xlsx.full.min.js': 'xlsx/dist/xlsx.full.min.js', 'flatpickr.min.js': 'flatpickr/dist/flatpickr.min.js', 'th.js': 'flatpickr/dist/l10n/th.js' };
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
(async () => {
  const b = await chromium.launch(), p = await b.newPage(), errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(API)) { const out = ctx.doPost({ postData: { contents: r.request().postData() } }); return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: out.getContent() }); }
    const k = Object.keys(LIB).find(k => u.endsWith('/' + k)); if (k) return r.fulfill({ body: fs.readFileSync(path.join(NM, LIB[k])), contentType: k.endsWith('css') ? 'text/css' : 'application/javascript' });
    if (u.startsWith('file:')) return r.continue(); return r.abort();
  });
  const idle = () => p.waitForFunction(() => !document.querySelector('#loader.show'), null, { timeout: 20000 }).then(() => p.waitForTimeout(250));
  const tmp = path.join(require('os').tmpdir(), 'cp-pages-test.html');
  fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8').replace(/window\.CP_API_URL = '[^']*'/, "window.CP_API_URL = ''"));
  await p.goto('file://' + tmp); await idle();
  ok(await p.isVisible('.swal2-input'), 'connect prompt when no API');
  await p.fill('.swal2-input', API); await p.click('.swal2-confirm'); await p.waitForLoadState(); await idle();
  await p.click('[data-tab=admin]'); await p.fill('#lgUser', 'admin'); await p.fill('#lgPass', 'admin123'); await p.click('#loginForm button[type=submit]'); await idle();
  ok(await p.isVisible('#appView'), 'admin login via fetch');
  await p.click('.dock [data-go=users]'); await idle(); ok(await p.isVisible('td >> text=admin'), 'users via fetch');
  await p.click('#modeSwitch'); await idle(); ok(await p.isVisible('#chCourse'), 'student home via fetch');
  ok(!errs.length, 'errors ' + errs.join('|'));
  console.log(`pages tests: ${pass} passed, ${fail} failed`); await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
