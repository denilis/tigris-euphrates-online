// Копирует движок и бота из tigris-bot (единственный источник правды) в game/vendor/
// и пишет манифест: коммит источника и sha256 каждого файла. Тест test/vendor.test.js
// сверяет копию с манифестом, поэтому файлы в game/vendor/ руками не правят.
//
//   node tools/sync-engine.js [путь к tigris-bot] [--allow-dirty]
//
// По умолчанию источник ../tigris-bot. Если скопированные файлы в источнике не
// закоммичены, синхронизация отказывает (иначе манифест врал бы о коммите).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const allowDirty = args.includes('--allow-dirty');
const src = path.resolve(root, args.find((a) => !a.startsWith('--')) || '../tigris-bot');
const dst = path.join(root, 'game', 'vendor');

// Что копируем: весь движок и мозг бота, тесты движка с помощниками и фикстурами.
// Адаптер BGA не нужен (safeMove повторён в game/, у адаптера свои зависимости).
const DIRS = ['engine', 'bot'];
const TESTS = ['test/helpers.js', 'test/rules.test.js', 'test/random.test.js', 'test/fixes.test.js', 'test/time.test.js'];
const TEST_DIRS = ['test/fixtures'];

function listFiles(dir) {
  const out = [];
  for (const e of readdirSync(path.join(src, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...listFiles(rel));
    else out.push(rel);
  }
  return out;
}

// Хэш текста без учёта CRLF/LF: на Windows файлы лежат с CRLF, на сборке Vercel из git с LF.
export const textHash = (buf) => createHash('sha256').update(buf.toString('utf8').replace(/\r\n/g, '\n')).digest('hex');

const git = (...a) => execFileSync('git', ['-C', src, ...a], { encoding: 'utf8' }).trim();

if (!existsSync(path.join(src, 'engine', 'engine.js'))) {
  console.error(`Не найден движок в ${src}`);
  process.exit(1);
}
const files = [...DIRS.flatMap(listFiles), ...TESTS, ...TEST_DIRS.flatMap(listFiles)].sort();
const dirty = git('status', '--porcelain', '--', ...DIRS, ...TESTS, ...TEST_DIRS);
if (dirty && !allowDirty) {
  console.error('В источнике есть незакоммиченные изменения:\n' + dirty + '\nЗакоммитьте их в tigris-bot или запустите с --allow-dirty.');
  process.exit(1);
}

rmSync(dst, { recursive: true, force: true });
const hashes = {};
for (const rel of files) {
  const from = path.join(src, rel), to = path.join(dst, rel);
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to);
  hashes[rel] = textHash(readFileSync(to));
}
const manifest = {
  source: 'tigris-bot',
  branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
  commit: git('rev-parse', 'HEAD'),
  dirty: Boolean(dirty),
  syncedAt: new Date().toISOString(),
  files: hashes,
};
writeFileSync(path.join(dst, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
// версия копии для сервера (импорт JS надёжнее чтения JSON при сборке функции Vercel)
writeFileSync(path.join(dst, 'version.js'),
  `// Сгенерировано tools/sync-engine.js\nexport const ENGINE = ${JSON.stringify({ branch: manifest.branch, commit: manifest.commit, syncedAt: manifest.syncedAt })};\n`);
writeFileSync(path.join(dst, 'README.md'),
  '# Копия движка и бота\n\nНе править: источник `tigris-bot`, обновление `node tools/sync-engine.js`.\n' +
  'Тест `test/vendor.test.js` сверяет файлы с `MANIFEST.json`.\n');
console.log(`Скопировано ${files.length} файлов из ${manifest.branch}@${manifest.commit.slice(0, 7)}${manifest.dirty ? ' (с незакоммиченными правками)' : ''}`);
