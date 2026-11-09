/* In-memory Google Apps Script shim — ใช้ทดสอบ Code.gs ใน Node และทำหน้าตัวอย่าง (ไม่ใช่ส่วนของระบบจริง) */
(function (G) {
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  function sha256(bytes) {
    const l = bytes.length, n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n); m.set(bytes); m[l] = 0x80;
    const bl = l * 8; for (let i = 0; i < 4; i++) m[n - 1 - i] = (bl >>> (8 * i)) & 255;
    let h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]; const w = new Uint32Array(64);
    const r = (x, y) => (x >>> y) | (x << (32 - y));
    for (let o = 0; o < n; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = (m[o+4*i] << 24) | (m[o+4*i+1] << 16) | (m[o+4*i+2] << 8) | m[o+4*i+3];
      for (let i = 16; i < 64; i++) { const s0 = r(w[i-15],7)^r(w[i-15],18)^(w[i-15]>>>3), s1 = r(w[i-2],17)^r(w[i-2],19)^(w[i-2]>>>10); w[i] = (w[i-16]+s0+w[i-7]+s1)|0; }
      let [a,b,c,d,e,f,g,hh] = h;
      for (let i = 0; i < 64; i++) { const t1 = (hh + (r(e,6)^r(e,11)^r(e,25)) + ((e&f)^(~e&g)) + K[i] + w[i])|0, t2 = ((r(a,2)^r(a,13)^r(a,22)) + ((a&b)^(a&c)^(b&c)))|0; hh=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0; }
      h = [h[0]+a,h[1]+b,h[2]+c,h[3]+d,h[4]+e,h[5]+f,h[6]+g,h[7]+hh].map(x => x|0);
    }
    const out = []; h.forEach(x => out.push((x>>>24)&255,(x>>>16)&255,(x>>>8)&255,x&255)); return out;
  }
  const utf8 = s => Array.from(new TextEncoder().encode(String(s)));
  const b64 = bytes => { let s = ''; bytes.forEach(b => s += String.fromCharCode(b & 255)); return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64'); };
  const KEY = 'gas_shim_db_v4';
  let DB = { sheets: {}, props: {}, files: {} };
  try { const saved = G.localStorage && G.localStorage.getItem(KEY); if (saved) DB = JSON.parse(saved); } catch (e) {}
  const persist = () => { try { G.localStorage && G.localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) {} };
  G.__resetShim = () => { DB = { sheets: {}, props: {}, files: {} }; persist(); };
  G.__shimDB = () => DB;
  function Range(sh, r, c, nr, nc) {
    const data = () => DB.sheets[sh];
    const self = {
      getValues() { const d = data(), out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(((d[r-1+i]||[])[c-1+j]) ?? ''); out.push(row); } return out; },
      setValues(v) { const d = data(); for (let i = 0; i < nr; i++) { d[r-1+i] = d[r-1+i] || []; for (let j = 0; j < nc; j++) { let x = v[i][j]; if (typeof x === 'string' && x[0] === "'") x = x.slice(1); d[r-1+i][c-1+j] = x; } } persist(); return self; },
      setValue(x) { return self.setValues([[x]]); },
      setNumberFormat() { return self; }, setFontWeight() { return self; }, setBackground() { return self; }
    };
    return self;
  }
  function Sheet(name) {
    const d = () => DB.sheets[name];
    const lastRow = () => { const a = d(); let n = a.length; while (n && !(a[n-1]||[]).some(x => x !== '' && x != null)) n--; return n; };
    return {
      getName: () => name, getLastRow: lastRow,
      getLastColumn: () => d().reduce((m, r) => { let n = (r||[]).length; while (n && (r[n-1] === '' || r[n-1] == null)) n--; return Math.max(m, n); }, 0),
      getMaxRows: () => Math.max(1000, d().length), getMaxColumns: () => 26,
      getRange: (r, c, nr = 1, nc = 1) => Range(name, r, c, nr, nc),
      getDataRange() { return Range(name, 1, 1, Math.max(lastRow(), 1), Math.max(this.getLastColumn(), 1)); },
      appendRow(row) { const a = d(), n = lastRow(); a[n] = row.map(x => typeof x === 'string' && x[0] === "'" ? x.slice(1) : x); a.length = n + 1; persist(); },
      deleteRow(r) { d().splice(r - 1, 1); persist(); },
      setFrozenRows() {}, clearContents() { DB.sheets[name] = []; persist(); }
    };
  }
  function Spreadsheet(id) {
    return { getId: () => id, getName: () => 'Classroom PLus DB', getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id,
      getSheetByName: n => DB.sheets[n] ? Sheet(n) : null, insertSheet: n => { DB.sheets[n] = []; persist(); return Sheet(n); } };
  }
  G.SpreadsheetApp = { openById: id => Spreadsheet(id) };
  G.PropertiesService = { getScriptProperties: () => ({ getProperty: k => DB.props[k] ?? null, setProperty: (k, v) => { DB.props[k] = String(v); persist(); }, setProperties: o => { Object.assign(DB.props, o); persist(); } }) };
  const cache = {};
  G.CacheService = { getScriptCache: () => ({ get: k => cache[k] && cache[k].e > Date.now() ? cache[k].v : null, put: (k, v, s) => { if (String(v).length > 100000) throw new Error('cache value too large'); cache[k] = { v: String(v), e: Date.now() + (s || 600) * 1000 }; }, remove: k => { delete cache[k]; },
    getAll: ks => { const o = {}; ks.forEach(k => { if (cache[k] && cache[k].e > Date.now()) o[k] = cache[k].v; }); return o; },
    putAll: (o, s) => Object.keys(o).forEach(k => { cache[k] = { v: String(o[k]), e: Date.now() + (s || 600) * 1000 }; }) }) };
  G.__clearCache = () => Object.keys(cache).forEach(k => delete cache[k]);
  G.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
  const pad = n => String(n).padStart(2, '0');
  G.Utilities = {
    getUuid: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }),
    formatDate(d, tz, fmt) {
      const t = new Date(d.getTime() + 7 * 3600e3); // Asia/Bangkok
      const map = { yyyy: t.getUTCFullYear(), MM: pad(t.getUTCMonth() + 1), dd: pad(t.getUTCDate()), HH: pad(t.getUTCHours()), mm: pad(t.getUTCMinutes()), ss: pad(t.getUTCSeconds()) };
      return fmt.split("'").map((part, i) => i % 2 ? part : part.replace(/yyyy|MM|dd|HH|mm|ss/g, k => map[k])).join('');
    },
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (a, s) => sha256(utf8(s)).map(b => b > 127 ? b - 256 : b),
    base64EncodeWebSafe: bytes => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_'),
    base64Decode: s => Array.from(typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary'), ch => ch.charCodeAt(0)),
    newBlob: (bytes, mime, name) => ({ bytes, mime, name, getContentType: () => mime })
  };
  const file = (id, name, size) => ({ getId: () => id, getName: () => name, getUrl: () => 'https://drive.google.com/file/d/' + id + '/view', getSize: () => size,
    setSharing() {}, setDescription(d) { if (DB.files[id]) { DB.files[id].desc = d; persist(); } }, getDescription: () => (DB.files[id] || {}).desc || '', setTrashed() { delete DB.files[id]; persist(); }, getDateCreated: () => new Date(DB.files[id] ? DB.files[id].at : Date.now()),
    makeCopy(n, folder) { return folder.createFile({ bytes: [], name: n, mime: 'application/vnd.google-apps.spreadsheet' }); } });
  const folder = (path) => ({
    getName: () => path, getId: () => path, getFoldersByName: n => { let done = false; return { hasNext: () => !done, next: () => { done = true; return folder(path + '/' + n); } }; },
    createFolder: n => folder(path + '/' + n),
    createFile(blob) { const id = 'f' + Math.random().toString(36).slice(2, 14) + 'xxxxxxxxxxxxxxxx'; DB.files[id] = { name: blob.name, folder: path, size: blob.bytes.length, at: Date.now() }; persist(); return file(id, blob.name, blob.bytes.length); },
    getFiles() { const ids = Object.keys(DB.files).filter(k => DB.files[k].folder === path); let i = 0; return { hasNext: () => i < ids.length, next: () => { const k = ids[i++]; return file(k, DB.files[k].name, DB.files[k].size); } }; }
  });
  G.DriveApp = { getFolderById: id => folder(id), getFileById: id => DB.files[id] ? file(id, DB.files[id].name, DB.files[id].size) : (id.length > 30 ? file(id, 'sheet', 0) : (() => { throw new Error('not found'); })()), Access: { ANYONE_WITH_LINK: 1 }, Permission: { VIEW: 1 } };
  G.MailApp = { getRemainingDailyQuota: () => 100, sendEmail: (...a) => { (G.__mails = G.__mails || []).push(a); } };
  const sessions = {};
  const resp = (code, body, headers) => ({ getResponseCode: () => code, getContentText: () => body || '', getHeaders: () => headers || {} });
  G.UrlFetchApp = { fetch: (url, o = {}) => {
    (G.__fetches = G.__fetches || []).push([url, o.method]);
    if (/uploadType=resumable/.test(url)) { const sid = 's' + Math.random().toString(36).slice(2); const meta = JSON.parse(o.payload); sessions[sid] = { meta, size: +o.headers['X-Upload-Content-Length'], got: 0, mime: o.headers['X-Upload-Content-Type'] }; return resp(200, '', { Location: 'https://upload.fake/' + sid }); }
    if (url.startsWith('https://upload.fake/')) { const s = sessions[url.split('/').pop()]; s.got += o.payload.length;
      if (s.got < s.size) return resp(308, '', { Range: 'bytes=0-' + (s.got - 1) });
      const id = 'f' + Math.random().toString(36).slice(2, 14) + 'xxxxxxxxxxxxxxxx'; DB.files[id] = { name: s.meta.name, folder: s.meta.parents[0], size: s.size, at: Date.now(), desc: s.meta.description }; persist();
      return resp(200, JSON.stringify({ id, name: s.meta.name, mimeType: s.mime, size: String(s.size) })); }
    const m = url.match(/drive\/v3\/files\/([\w-]+)/); if (m && o.method === 'delete') { delete DB.files[m[1]]; persist(); return resp(204); }
    return resp(200, '{}');
  } };
  const triggers = [];
  G.ScriptApp = { getOAuthToken: () => 'fake-token', getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/DEMO/exec' }), getProjectTriggers: () => triggers, deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
    newTrigger: fn => { const t = { getHandlerFunction: () => fn }; const ch = { timeBased: () => ch, everyDays: () => ch, atHour: () => ch, inTimezone: () => ch, create: () => { triggers.push(t); return t; } }; return ch; } };
  G.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: s => ({ content: s, setMimeType() { return this; }, getContent() { return s; } }) };
  G.HtmlService = { createHtmlOutputFromFile: () => ({ setTitle() { return this; }, addMetaTag() { return this; } }) };
})(typeof window !== 'undefined' ? window : globalThis);
