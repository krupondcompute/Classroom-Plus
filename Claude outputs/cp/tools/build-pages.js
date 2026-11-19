// node tools/build-pages.js — สร้าง docs/index.html สำหรับ GitHub Pages จาก Index.html
// ใส่ URL /exec ของ Apps Script: node tools/build-pages.js https://script.google.com/macros/s/XXXX/exec
// (หรือแก้บรรทัด CP_API_URL ใน docs/index.html บนเว็บ GitHub ได้โดยตรง)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), docs = path.join(root, 'docs');
let api = process.argv[2] || '';
const prev = path.join(docs, 'index.html');
if (!api && fs.existsSync(prev)) api = (fs.readFileSync(prev, 'utf8').match(/window\.CP_API_URL = '([^']*)'/) || [])[1] || '';
const html = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
const cfg = `<script>\n/* ===== ตั้งค่า: วาง URL เว็บแอปของ Apps Script (ลงท้าย /exec) ระหว่างเครื่องหมาย ' ' ===== */\nwindow.CP_API_URL = '${api}';\n</script>\n`;
const out = html.replace('<base target="_top">\n', '').replace("<script>\n'use strict';", cfg + "<script>\n'use strict';");
fs.mkdirSync(docs, { recursive: true });
fs.writeFileSync(prev, out);
fs.writeFileSync(path.join(docs, '.nojekyll'), '');
console.log('docs/index.html written; CP_API_URL =', api || '(ว่าง)');
