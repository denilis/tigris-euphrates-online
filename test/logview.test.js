// Журнал по полочкам (просьба Дениса 03.11): действия строкой, бои мини-таблицей, очки плашками.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logLines, lineHTML } from '../public/js/logview.js';

const NAMES = ['Андрей', 'Денис', 'Влад'];
const name = (id) => NAMES[id];
const e = (ev, rest = {}) => ({ ev, turn: 52, actor: 0, action: 1, ...rest });

// как в партии со скриншота Дениса: рынок объединил царства, три войны, сокровище, очки
const LOG = [
  e('unite'),
  e('tile', { c: 2, pos: 136 }),
  e('warStart', { color: 3, att: 0, def: 1 }),
  e('war', { color: 3, att: 0, def: 1, winner: 0, attBoard: 6, attN: 0, attTotal: 6, defBoard: 0, defN: 0, defTotal: 0 }),
  e('score', { seat: 0, c: 3, n: 1, why: 'war' }),
  e('warStart', { color: 2, att: 1, def: 2 }),
  e('war', { color: 2, att: 1, def: 2, winner: 2, attBoard: 4, attN: 2, attTotal: 6, defBoard: 4, defN: 2, defTotal: 6 }),
  e('treasure', { seat: 1 }),
  e('score', { seat: 1, c: 2, n: 4, why: 'war' }),
  e('score', { seat: 0, c: 3, n: 2, why: 'monument' }),
];

test('журнал: одна строка на действие, бои отдельно от простых частей', () => {
  const [l] = logLines(LOG, name);
  assert.equal(l.turn, 52);
  assert.deepEqual(l.parts, ['рынок I9, объединение', 'Денис: сокровище']);
  assert.equal(l.wars.length, 2);
  assert.deepEqual(l.wars.map((w) => [w.color, w.att, w.def, w.winner]), [[3, 0, 1, 0], [2, 1, 2, 2]]);
  assert.equal(l.wars[0].note, '', 'атакует ходящий: пояснения нет');
  assert.match(l.wars[1].note, /нет зеленого лидера/, 'атакует не ходящий: пояснение из warStart');
  assert.deepEqual(l.pts.map((p) => [p.seat, p.n]), [[0, 1], [1, 4], [0, 2]]);
});

test('журнал: мини-таблица боя с полем и рукой, ничья побеждает защитник', () => {
  const html = lineHTML(logLines(LOG, name)[0], name);
  assert.match(html, /Война за черный/);
  assert.match(html, /<td>Андрей<\/td><td>атака<\/td><td>6 \+ 0 = 6<\/td><td>победа<\/td>/);
  assert.match(html, /<td>Влад<\/td><td>защита<\/td><td>4 \+ 2 = 6<\/td><td>ничья, победа<\/td>/);
  assert.equal((html.match(/data-battle=/g) || []).length, 2, 'у каждого боя кнопка разбора');
});

test('журнал: очки сводкой по игрокам цветными плашками, монумент подписан', () => {
  const html = lineHTML(logLines(LOG, name)[0], name);
  const pts = html.slice(html.indexOf('class="lpts"'));
  assert.ok(pts.indexOf('Андрей') < pts.indexOf('Денис'), 'игроки в порядке первого очка');
  assert.match(pts, /background:#1f1f1f[^>]*>\+1</);
  assert.match(pts, /\+2 <small>монумент<\/small>/);
  assert.match(pts, /background:#3d7a46[^>]*>\+4</);
});

test('журнал: простое действие с очком ходящего остается одной строкой', () => {
  const lines = logLines([e('tile', { c: 0, pos: 51, action: 2 }), e('score', { seat: 0, c: 0, n: 1, why: 'tile', action: 2 })], name);
  const html = lineHTML(lines[0], name);
  assert.doesNotMatch(html, /class="lpts"/);
  assert.match(html, /храм D4 <span class="pchip"/);
});

test('журнал: старые бои без сторон показывают только итог', () => {
  const old = logLines([e('war', { color: 1, att: 0, def: 1, winner: 1, attTotal: 2, defTotal: 3 })], name);
  assert.match(lineHTML(old[0], name), /<td>2<\/td>/);
});
