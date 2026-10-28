// Копия движка и бота в game/vendor/ совпадает с манифестом синхронизации.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const vendor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'game', 'vendor');
const manifest = JSON.parse(readFileSync(path.join(vendor, 'MANIFEST.json'), 'utf8'));
// тот же хэш, что в tools/sync-engine.js: CRLF и LF не различаются
const hash = (buf) => createHash('sha256').update(buf.toString('utf8').replace(/\r\n/g, '\n')).digest('hex');

function listFiles(dir, base = '') {
  const out = [];
  for (const e of readdirSync(path.join(dir, base), { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(dir, rel));
    else out.push(rel);
  }
  return out;
}

test('файлы копии совпадают с манифестом', () => {
  for (const [rel, h] of Object.entries(manifest.files)) {
    assert.equal(hash(readFileSync(path.join(vendor, rel))), h, `${rel} изменён после синхронизации`);
  }
});

test('в копии нет файлов вне манифеста', () => {
  const own = new Set(['MANIFEST.json', 'README.md', 'version.js']); // пишет сам sync-engine
  const extra = listFiles(vendor).filter((f) => !own.has(f) && !(f in manifest.files));
  assert.deepEqual(extra, []);
});

test('копия снята с закоммиченного источника', () => {
  assert.equal(manifest.dirty, false);
  assert.match(manifest.commit, /^[0-9a-f]{40}$/);
});
