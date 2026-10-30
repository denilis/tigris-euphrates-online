// Выкладка на Vercel: всё, что функция достаёт импортами, должно пройти через .vercelignore.
// Однажды `server/` не попал в список разрешённых, и каждый запрос к API падал при первом импорте.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

/** Верхние папки и файлы, которые .vercelignore разрешает после общего запрета `/*`. */
function allowedTop() {
  const lines = read('.vercelignore').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  assert.equal(lines[0], '/*', 'первым идёт общий запрет, дальше только разрешения');
  const allowed = new Set();
  for (const l of lines.slice(1)) {
    assert.ok(l.startsWith('!'), `после общего запрета ожидалось разрешение, а не «${l}»`);
    allowed.add(l.slice(1).replace(/\/$/, ''));
  }
  return allowed;
}

/** Все файлы, достижимые относительными импортами от точки входа функции. */
function reachable(entry) {
  const seen = new Set();
  const stack = [entry];
  const re = /(?:from\s*|import\s*\(?\s*)['"](\.{1,2}\/[^'"]+)['"]/g;
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(path.join(root, file), 'utf8');
    for (const m of src.matchAll(re)) {
      stack.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1])));
    }
  }
  return [...seen];
}

test('все файлы, которые тянет api/index.js, проходят .vercelignore', () => {
  const allowed = allowedTop();
  const files = reachable('api/index.js');
  assert.ok(files.length > 20, `нашлось слишком мало файлов: ${files.length}`);
  assert.ok(files.includes('server/routes.js') && files.includes('game/table.js'), 'обход нашёл основные модули');
  const dropped = files.filter((f) => !allowed.has(f.split('/')[0]));
  assert.deepEqual(dropped, [], 'эти файлы не попадут на Vercel');
});

test('клиент и настройки выкладки разрешены', () => {
  const allowed = allowedTop();
  for (const name of ['api', 'game', 'server', 'public', 'vercel.json', 'package.json']) assert.ok(allowed.has(name), name);
});
