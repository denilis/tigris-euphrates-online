// Сценарий обучения из Markdown в PDF с картинками (источник для NotebookLM).
//   node tools/tutorial/build_pdf.mjs <файл.md> <папка jpg> <файл.pdf>
// Понимает только то, что есть в сценарии: заголовки #, ##, абзацы и картинки ![подпись](путь).
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { connect } from '../../../tigris-bot/tools/cdp.js';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DBG = 9445;
const [mdPath, jpgDir, pdfPath] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const body = readFileSync(mdPath, 'utf8').split(/\r?\n\r?\n/).map((raw) => {
  const b = raw.trim();
  if (b.startsWith('## ')) return `<h2>${esc(b.slice(3))}</h2>`;
  if (b.startsWith('# ')) return `<h1>${esc(b.slice(2))}</h1>`;
  const m = b.match(/^!\[(.*)\]\((.+)\)$/);
  if (m) {
    const file = path.join(jpgDir, path.basename(m[2]).replace(/\.png$/, '.jpg'));
    return `<figure><img src="${pathToFileURL(file).href}" alt="${esc(m[1])}"><figcaption>${esc(m[1])}</figcaption></figure>`;
  }
  return b ? `<p>${esc(b)}</p>` : '';
}).join('\n');

const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Тигр и Евфрат: сценарий обучения</title><style>
  @page { size: A4; margin: 16mm 16mm 14mm; }
  body { font: 12pt/1.5 Georgia, 'Times New Roman', serif; color: #221a10; }
  h1 { font-size: 22pt; margin: 0 0 8pt; }
  h2 { font-size: 15pt; margin: 18pt 0 6pt; break-after: avoid; color: #7a4f12; }
  p { margin: 0 0 8pt; }
  figure { margin: 8pt 0 8pt; break-inside: avoid; }
  img { width: 100%; display: block; border-radius: 4px; }
  figcaption { font: 9pt/1.3 Arial, sans-serif; color: #6b5d48; margin-top: 3pt; }
</style></head><body>${body}</body></html>`;

const work = mkdtempSync(path.join(os.tmpdir(), 'tigris-pdf-'));
const htmlFile = path.join(work, 'script.html');
writeFileSync(htmlFile, html);
const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${path.join(work, 'profile')}`, '--no-first-run', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
let br = null;
for (let k = 0; k < 40 && !br; k++) {
  await sleep(250);
  try { br = await connect(DBG); } catch { /* ещё не поднялся */ }
}
if (!br) throw new Error('Chrome не ответил');
try {
  const { targetId } = await br.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await br.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => br.send(m, p, sessionId);
  await send('Page.enable');
  await send('Page.navigate', { url: pathToFileURL(htmlFile).href });
  for (let k = 0; k < 200; k++) {
    const r = await send('Runtime.evaluate', { expression: `document.readyState === 'complete' && [...document.images].every((i) => i.complete && i.naturalWidth > 0)`, returnByValue: true });
    if (r.result.value) break;
    if (k === 199) throw new Error('картинки не загрузились');
    await sleep(100);
  }
  const { data } = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  writeFileSync(pdfPath, Buffer.from(data, 'base64'));
  console.log('PDF готов');
} finally {
  try { await br.send('Browser.close'); } catch { /* уже закрыт */ }
  proc.kill();
  await sleep(500);
  rmSync(work, { recursive: true, force: true, maxRetries: 3 });
}
