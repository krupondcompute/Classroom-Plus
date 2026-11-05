import { readFile, writeFile } from 'node:fs/promises';

const [shell, styles, client] = await Promise.all([
  readFile('Index.html', 'utf8'),
  readFile('Styles.html', 'utf8'),
  readFile('Client.html', 'utf8'),
]);
const app = shell
  .replace('<?!= include(\'Styles\'); ?>', styles)
  .replace('<?!= include(\'Client\'); ?>', client);
if (app.includes('<?!=')) throw new Error('Unresolved Apps Script template include');
await writeFile('site/app.html', app, 'utf8');
console.log('Built site/app.html from the shared Classroom Plus UI.');
