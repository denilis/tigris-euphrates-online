// Показ ходов соперников (08.11, Денис: с тремя ботами не уследить, куда пошли; бота не замедлять,
// а замедлить показ хода и растворение тайлов).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sinceMine, trailMarks, markLabel, markLine, TRAIL_FRESH_MS, TRAIL_LAND_MS } from '../public/js/trail.js';
import { trailSVG } from '../public/js/board.js';
import { RUIN_S, TROPHY_PHASES } from '../public/js/ruin.js';

const e = (ev, actor, action, turn, rest = {}) => ({ ev, turn, actor, action, ...rest });
// я на месте 0, три бота 1..3; ход 4 был мой, затем ходы 5, 6, 7 ботов
const LOG = [
  e('tile', 0, 1, 4, { pos: 1, c: 0 }), e('tile', 0, 2, 4, { pos: 2, c: 0 }),
  e('tile', 1, 1, 5, { pos: 10, c: 0 }), e('score', 1, 1, 5, { seat: 1, c: 0, n: 1 }), e('leader', 1, 2, 5, { pos: 11, c: 3, from: -1 }),
  e('tile', 2, 1, 6, { pos: 20, c: 1 }), e('building', 2, 1, 6, { pos: 20, c: 1 }), e('catastrophe', 2, 2, 6, { pos: 21 }),
  e('tile', 3, 1, 7, { pos: 30, c: 2 }), e('leader', 3, 2, 7, { pos: 31, c: 0, from: 5 }),
];

test('все ходы соперников с моего действия, номера по порядку', () => {
  const m = sinceMine(LOG, 0, 4);
  assert.deepEqual(m.map((x) => [x.pos, x.n, x.actor]), [[10, 1, 1], [11, 2, 1], [20, 3, 2], [21, 4, 2], [30, 5, 3], [31, 6, 3]]);
  assert.equal(m.find((x) => x.pos === 31).from, 5, 'перестановка со стрелкой откуда');
  // прежний след (просмотр, зритель): только последний ход, номер действия в ходе
  assert.deepEqual(trailMarks(LOG, 0).map((x) => [x.pos, x.n]), [[30, 1], [31, 2]]);
});

test('след гаснет с моим первым действием и копится заново', () => {
  const mine = [...LOG, e('tile', 0, 1, 8, { pos: 40, c: 0 })];
  assert.deepEqual(sinceMine(mine, 0, 4), []);
  const next = [...mine, e('tile', 0, 2, 8, { pos: 41, c: 0 }), e('tile', 1, 1, 9, { pos: 50, c: 3 })];
  assert.deepEqual(sinceMine(next, 0, 4).map((x) => [x.pos, x.n]), [[50, 1]]);
});

test('после моего паса (в журнал не пишется) окно не длиннее круга', () => {
  const after = [...LOG, e('tile', 1, 1, 9, { pos: 60, c: 0 }), e('tile', 2, 1, 10, { pos: 61, c: 0 }), e('tile', 3, 1, 11, { pos: 62, c: 0 })];
  // ход 8 мой, пас: записей нет; видны только ходы 9-11, а не 5-7
  assert.deepEqual(sinceMine(after, 0, 4).map((x) => x.pos), [60, 61, 62]);
  assert.deepEqual(sinceMine(after, 0, 2).map((x) => x.pos), [62], 'вдвоем: один чужой ход');
});

test('подпись хода и строка списка', () => {
  assert.equal(markLabel({ ev: 'tile', c: 0 }, 'bow'), 'Лук: храм');
  assert.equal(markLabel({ ev: 'leader', c: 3 }, 'bull'), 'Бык: царь');
  assert.equal(markLabel({ ev: 'catastrophe' }, 'lion'), 'Лев: катастрофа');
  assert.equal(markLabel({ ev: 'monument' }, null), 'Соперник: монумент');
  assert.equal(markLine({ label: 'Лук: храм', pos: 6 }), 'Лук: храм на G1');
});

test('на поле номер по порядку и подпись над свежим ходом', () => {
  const marks = sinceMine(LOG, 0, 4).map((m) => ({ ...m, age: 100, label: markLabel(m, 'bow') }));
  const svg = trailSVG(marks, true);
  assert.match(svg, /<text y="5" text-anchor="middle">6<\/text>/);
  assert.equal((svg.match(/class="trail-cap"/g) || []).length, 6);
  assert.match(svg, />Лук: храм<\/text>/);
  const old = trailSVG(marks.map((m) => ({ ...m, age: TRAIL_FRESH_MS })), true);
  assert.doesNotMatch(old, /trail-cap/, 'старый ход без подписи');
  assert.doesNotMatch(trailSVG(marks, false), /trail-cap/, 'ползунок «Ходы» выключен');
});

test('ход показывается медленнее, бот не думает 2-4 с, растворение дольше', () => {
  assert.ok(TRAIL_LAND_MS >= 1500 && TRAIL_FRESH_MS >= 4500);
  const css = readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.arrive\{[^}]*animation:arrive 1\.5s/);
  assert.match(css, /\.trail\.fresh\{animation:trailPulse 1\.5s ease-in-out 3\}/);
  const api = readFileSync(new URL('../api/index.js', import.meta.url), 'utf8');
  assert.match(api, /\{ min: 1500, max: 1800 \}/);
  // трофей идет втрое медленнее (game.js TROPHY_SLOW = 3): растворение около 1,9 с, монета долетает
  assert.ok(TROPHY_PHASES.LIFT * 3 >= 1.8, 'растворение видно');
  assert.ok(TROPHY_PHASES.LIFT < TROPHY_PHASES.COIN && TROPHY_PHASES.COIN < TROPHY_PHASES.LAND && TROPHY_PHASES.LAND < RUIN_S.trophy);
});

test('за столом на поле только ход предыдущего игрока (Денис 08.11 вечером)', () => {
  const src = readFileSync(new URL('../public/js/game.js', import.meta.url), 'utf8');
  assert.match(src, /const marks = trailMarks\(g\.log, view\.me\);/);
  assert.doesNotMatch(src, /sinceMine\(/, 'все ходы с моего действия больше не показываются');
  assert.match(src, /<b>Прошлый ход<\/b>/);
  // в мой ход: ход игрока передо мной (бот 3), без ходов ботов 1 и 2
  assert.deepEqual(trailMarks(LOG, 0).map((x) => x.actor), [3, 3]);
});
