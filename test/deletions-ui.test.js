// Журнал удалений на экране (04.11): время, стол, состояние, кто; «Вернуть» только где можно.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stamp, deletionsHTML } from '../public/js/deletions.js';

const at = new Date(2026, 10, 4, 18, 40).getTime();

test('журнал: время записи, прошлый год с годом', () => {
  assert.equal(stamp(at, at), '04.11 18:40');
  assert.equal(stamp(new Date(2025, 0, 2, 9, 5).getTime(), at), '02.01.2025 09:05');
});

test('журнал: удаление и возврат, кнопка «Вернуть» только у того, что можно вернуть', () => {
  const html = deletionsHTML([
    { kind: 'restore', code: 'ABC234', title: '04.11.2026.1', at, byName: 'Андрей', canRestore: false },
    { kind: 'delete', code: 'XYZ567', title: '04.11.2026.2', from: 'over', at, byName: 'Денис', seats: ['Денис', 'Андрей', 'Бот'], canRestore: true },
    { kind: 'delete', code: 'ABC234', title: null, from: 'playing', at, byName: 'Андрей <b>', seats: [], canRestore: false },
  ], { now: at });
  assert.match(html, /Стол <b>04\.11\.2026\.1<\/b> возвращен/);
  assert.match(html, /Стол <b>04\.11\.2026\.2<\/b> удален, партия окончена<small>Денис, Андрей, Бот<\/small>/);
  assert.match(html, /Стол <b>ABC234<\/b> удален, шла партия/);
  assert.equal((html.match(/data-restore=/g) || []).length, 1);
  assert.match(html, /data-restore="XYZ567"/);
  assert.match(html, /Андрей &lt;b&gt;/, 'имя экранировано');
  assert.doesNotMatch(html, /удалил|вернул/, 'глагол без рода');
});

test('журнал: пустой', () => {
  assert.equal(deletionsHTML([]), '<p class="muted">Удалений не было.</p>');
});
