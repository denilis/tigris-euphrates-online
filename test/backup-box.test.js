// Кнопка «Скачать копию» (15.11): имя файла, подпись про прошлую копию, файл как у сервера.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backupName, ageLine, packBackup, sizeText, BACKUP_FORMAT as CLIENT } from '../public/js/backup-core.js';
import { backupFile, BACKUP_FORMAT as SERVER } from '../server/backup.js';

test('размер файла словами', () => {
  assert.equal(sizeText(300), '1 КБ');
  assert.equal(sizeText(512_000), '500 КБ');
  assert.equal(sizeText(4_075_000), '3,9 МБ');
});

test('имя файла латиницей с датой', () => {
  assert.equal(backupName(new Date(2026, 10, 5, 12, 0).getTime()), 'tigris-kopiya-2026-11-05.json');
});

test('подпись: не скачивали, свежая, неделя и больше', () => {
  const now = new Date(2026, 10, 15, 12, 40).getTime();
  assert.deepEqual(ageLine(0, now), { text: 'На этом устройстве копию еще не скачивали.', late: true });
  const fresh = ageLine(now - 2 * 86_400_000, now);
  assert.equal(fresh.late, false);
  assert.match(fresh.text, /^Прошлая копия: 13\.11, 12:40 на этом устройстве\.$/);
  assert.match(ageLine(now - 9 * 86_400_000, now).text, /Прошло 9 дней, пора/);
  assert.match(ageLine(now - 22 * 86_400_000, now).text, /Прошло 22 дня/);
  assert.match(ageLine(now - 21 * 86_400_000, now).text, /Прошло 21 день/);
  assert.equal(ageLine(now - 7 * 86_400_000, now).late, true);
});

test('файл копии в браузере такой же, как у сервера', () => {
  const pages = [{ keys: [{ k: 'user:u1', t: 'string', v: '{}' }, { k: 'users', t: 'set', v: ['u1'] }] }, { keys: [{ k: 'hist:g1', t: 'string', v: '{}' }] }];
  assert.equal(CLIENT, SERVER);
  assert.deepEqual(packBackup(pages, 0, 'x'), backupFile(pages, { at: 0, site: 'x' }));
});

test('блок только у главного администратора, тексты без машинной типографики', () => {
  const main = readFileSync('public/js/main.js', 'utf8');
  assert.match(main, /\$\{session\.get\(\)\?\.user\?\.main \? backupHTML\(\) : ''\}/);
  for (const f of ['backup-box.js', 'backup-core.js']) assert.doesNotMatch(readFileSync(`public/js/${f}`, 'utf8'), /[—… ]/);
});
