// Движок и бот сайта живут в game/vendor (с 12.11.2026, решение Дениса: tigris-bot закрыт, работаем
// только с сайтом). После правки game/vendor/engine или game/vendor/bot запустить:
//
//   node tools/bot-sync.mjs
//
// Что делает: (1) копирует engine/ и bot/ в public/vendor, чтобы разбор партии считал браузер
// (test/analysis.test.js сверяет копию); (2) пишет game/vendor/version.js с меткой версии: sha256
// текстов engine/ и bot/ без учета CRLF и LF. Метку показывает /api/ping (engine), по ней после
// выкладки видно, какой бот на проде; test/vendor.test.js падает, если метку забыли обновить.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'game', 'vendor');
export const CODE_DIRS = ['engine', 'bot'];

const jsFiles = (dir) => readdirSync(path.join(vendor, dir)).filter((f) => f.endsWith('.js')).sort();

/** Метка версии: sha256 по файлам engine/ и bot/ (имя и текст, переводы строк приведены к LF). */
export function codeHash() {
  const h = createHash('sha256');
  for (const dir of CODE_DIRS) {
    for (const f of jsFiles(dir)) {
      h.update(`${dir}/${f}\n`);
      h.update(readFileSync(path.join(vendor, dir, f), 'utf8').replace(/\r\n/g, '\n'));
    }
  }
  return h.digest('hex');
}

function main() {
  for (const dir of CODE_DIRS) {
    const dst = path.join(root, 'public', 'vendor', dir);
    rmSync(dst, { recursive: true, force: true });
    mkdirSync(dst, { recursive: true });
    const files = jsFiles(dir);
    for (const f of files) copyFileSync(path.join(vendor, dir, f), path.join(dst, f));
    console.log(`public/vendor/${dir}: ${files.length} файлов`);
  }
  const hash = codeHash();
  writeFileSync(path.join(vendor, 'version.js'),
    `// Пишет tools/bot-sync.mjs: метка версии движка и бота (sha256 текстов game/vendor/engine и bot)\n` +
    `export const ENGINE = ${JSON.stringify({ hash, stampedAt: new Date().toISOString() })};\n`);
  console.log(`game/vendor/version.js: ${hash.slice(0, 7)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
