// След хода: куда сходил соперник. Денис: тайлы появляются, и не всегда понятно, в какое место он встал.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trailMarks, ageMarks, liveMarks, landing, TRAIL_FRESH_MS, TRAIL_LAND_MS, TRAIL_ARROW_MS } from '../public/js/trail.js';
import { readFileSync } from 'node:fs';
import { pointsText } from '../public/js/util.js';
import { createTable, sit, setHero, setSeatCount, start, submit, undo } from '../game/table.js';
import { viewFor } from '../game/view.js';
import { makeRng } from '../game/vendor/engine/rng.js';
import { trailSVG } from '../public/js/board.js';

const e = (ev, actor, action, rest = {}, turn = 7) => ({ ev, turn, actor, action, ...rest });

test('след: тайл и лидер соперника с номерами действий, у перестановки откуда', () => {
  const log = [
    e('tile', 1, 1, { pos: 10, c: 0 }),
    e('score', 1, 1, { seat: 1, c: 0, n: 1 }),
    e('leader', 1, 2, { pos: 20, c: 3, from: 5 }),
  ];
  const m = trailMarks(log, 0);
  assert.deepEqual(m.map((x) => [x.ev, x.pos, x.action, x.size]), [['tile', 10, 1, 1], ['leader', 20, 2, 1]]);
  assert.equal(m[1].from, 5);
  assert.equal(m[0].from, undefined);
});

test('след: новый лидер без перестановки стрелки не дает', () => {
  assert.equal(trailMarks([e('leader', 1, 1, { pos: 20, c: 3, from: -1 })], 0)[0].from, undefined);
});

test('след: катастрофа, здание, чудо и монумент 2 на 2 отмечаются на своем месте', () => {
  const log = [
    e('catastrophe', 1, 1, { pos: 3 }),
    e('tile', 1, 2, { pos: 40, c: 1 }),
    e('building', 1, 2, { pos: 41, c: 1 }),
    e('monument', 1, 2, { tl: 50, id: 2 }),
    e('wonder', 1, 2, { center: 60 }),
  ];
  assert.deepEqual(trailMarks(log, 0).map((x) => [x.pos, x.size]), [[3, 1], [40, 1], [41, 1], [50, 2], [60, 1]]);
});

test('след: на клетке одна отметка, даже если тайл и здание стоят вместе', () => {
  const log = [e('tile', 1, 1, { pos: 40, c: 1 }), e('building', 1, 1, { pos: 40, c: 1 })];
  assert.equal(trailMarks(log, 0).length, 1);
});

test('след: второе действие на той же клетке заменяет отметку и снова вспыхивает', () => {
  const first = [e('leader', 1, 1, { pos: 19, c: 0, from: -1 })];
  const both = [...first, e('tile', 1, 2, { pos: 19, c: 0 })];
  const seen = new Map();
  ageMarks(trailMarks(first, 0), seen, 1000, false);
  const m = ageMarks(trailMarks(both, 0), seen, 9000, false);
  assert.deepEqual(m.map((x) => [x.ev, x.action, x.age]), [['tile', 2, 0]]);
});

test('след: монумент лег на тайлы этого действия, остается одна рамка 2 на 2', () => {
  for (const pos of [50, 51, 66, 67]) {
    const log = [e('tile', 1, 1, { pos, c: 0 }), e('monument', 1, 1, { tl: 50, id: 2 })];
    assert.deepEqual(trailMarks(log, 0).map((x) => [x.ev, x.pos, x.size]), [['monument', 50, 2]], String(pos));
  }
});

const emptyBoard = () => ({ tile: Array(176).fill(-1), leader: Array(176).fill(-1) });

test('след: лидер проиграл конфликт, на пустой клетке рамки нет', () => {
  const log = [
    e('tile', 1, 1, { pos: 10, c: 0 }),
    e('leader', 1, 2, { pos: 20, c: 2, from: 5 }),
    e('revolt', 1, 2, { winner: 0, loser: 1 }),
  ];
  const board = emptyBoard();
  board.tile[10] = 0;
  assert.deepEqual(liveMarks(trailMarks(log, 0), board).map((x) => x.pos), [10]);
  board.leader[20] = 6;
  assert.deepEqual(liveMarks(trailMarks(log, 0), board).map((x) => x.pos), [10, 20], 'лидер устоял: рамка остается');
});

test('след: тайл снят войной, рамки нет; катастрофа, чудо и монумент остаются', () => {
  const log = [e('tile', 1, 1, { pos: 10, c: 3 }), e('catastrophe', 1, 2, { pos: 3 }), e('monument', 1, 2, { tl: 50, id: 2 }), e('wonder', 1, 2, { center: 60 })];
  const board = emptyBoard();
  board.tile[3] = 6; // катастрофа
  board.tile[50] = 4; // перевернутый тайл под монументом
  board.tile[60] = 5; // клетка под чудом
  assert.deepEqual(liveMarks(trailMarks(log, 0), board).map((x) => x.pos), [3, 50, 60]);
});

test('журнал: очки разных игроков подписаны, за монумент и чудо назван повод', () => {
  const name = (id) => ({ 0: 'Денис', 1: 'Соня' }[id]);
  const revolt = { seat: 0, c: 0, n: 1, why: 'revolt' }, monument = { seat: 1, c: 3, n: 1, why: 'monument' };
  assert.deepEqual(pointsText([revolt, monument], 1, name), ['Денис +1 красный', 'Соня +1 черный за монумент']);
  assert.deepEqual(pointsText([{ seat: 1, c: 3, n: 1, why: 'tile' }], 1, name), ['+1 черный'], 'свое очко ходившего без имени');
  assert.deepEqual(pointsText([{ seat: 0, c: 1, n: 2, why: 'tile' }], 1, name), ['Денис +2 синий']);
  assert.deepEqual(pointsText([{ seat: 1, c: 3, n: 1, why: 'wonder' }], 1, name), ['+1 черный за чудо']);
  assert.deepEqual(pointsText([], 1, name), []);
});

test('свои ходы следа не дают, и он гаснет с первым действием следующего игрока', () => {
  const other = e('tile', 1, 1, { pos: 10, c: 0 }, 7);
  assert.deepEqual(trailMarks([e('tile', 0, 1, { pos: 9, c: 0 }, 6)], 0), [], 'мой ход');
  assert.equal(trailMarks([other], 0).length, 1, 'ход соперника виден');
  assert.deepEqual(trailMarks([other, e('tile', 0, 1, { pos: 11, c: 0 }, 8)], 0), [], 'я сходил: след ушел');
  assert.deepEqual(trailMarks([other, e('tile', 2, 1, { pos: 12, c: 0 }, 8)], 0).map((x) => x.pos), [12], 'только последний игрок');
});

test('след пустой журнал и зритель', () => {
  assert.deepEqual(trailMarks([], 0), []);
  assert.equal(trailMarks([e('tile', 1, 1, { pos: 10, c: 0 })], null).length, 1, 'зрителю виден любой ход');
});

test('возраст отметки: новая свежая, при открытии стола старая, ушедшая забывается', () => {
  const seen = new Map();
  const a = trailMarks([e('tile', 1, 1, { pos: 10, c: 0 })], 0);
  assert.ok(ageMarks(a, seen, 1000, true)[0].age >= TRAIL_FRESH_MS, 'открыли стол: без вспышки');

  const b = trailMarks([e('tile', 1, 1, { pos: 10, c: 0 }), e('tile', 1, 2, { pos: 11, c: 0 })], 0);
  const r = ageMarks(b, seen, 1500, false);
  assert.ok(r[0].age >= TRAIL_FRESH_MS);
  assert.equal(r[1].age, 0, 'новая отметка');
  assert.equal(ageMarks(b, seen, 2100, false)[1].age, 600, 'перерисовка не сбрасывает вспышку');

  ageMarks([], seen, 3000, false);
  assert.equal(seen.size, 0);
});

test('рисунок следа: свежая отметка пульсирует, старая остается тихой рамкой с номером', () => {
  const mark = { ev: 'tile', pos: 0, size: 1, action: 2, c: 0 };
  const fresh = trailSVG([{ ...mark, age: 100 }]);
  assert.match(fresh, /class="trail fresh"/);
  assert.match(fresh, /animation-delay:-100ms/, 'перерисовка продолжает анимацию, а не начинает заново');
  assert.match(fresh, /<text[^>]*>2<\/text>/);
  assert.doesNotMatch(fresh, /class="land"/, 'копии тайла поверх больше нет: появляется сам тайл');
  const old = trailSVG([{ ...mark, age: TRAIL_FRESH_MS + 1 }]);
  assert.doesNotMatch(old, /fresh/);
  assert.match(old, /class="trail"/);
});

test('появление хода соперника (04.11): тайл и лидер, пока отметке меньше TRAIL_LAND_MS', () => {
  const m = landing([
    { ev: 'tile', pos: 3, age: 100 },
    { ev: 'leader', pos: 9, age: TRAIL_LAND_MS - 1 },
    { ev: 'leader', pos: 10, age: TRAIL_LAND_MS },
    { ev: 'catastrophe', pos: 7, age: 0 },
  ]);
  assert.deepEqual([...m], [[3, 100], [9, TRAIL_LAND_MS - 1]]);
  assert.ok(TRAIL_LAND_MS >= 800, 'появление плавное, а не мгновенное');
});

test('рисунок следа: стрелка только у перестановки лидера', () => {
  const leader = { ev: 'leader', pos: 20, size: 1, action: 1, c: 0, hero: 'lion', age: 5000 };
  assert.doesNotMatch(trailSVG([leader]), /trail-arrow/);
  assert.match(trailSVG([{ ...leader, from: 3 }]), /trail-arrow[^>]*marker-end/);
});

test('на настоящем столе: след виден сопернику, отмена действия его убирает', () => {
  const now = 0;
  const users = ['a', 'b', 'c'];
  const t = createTable({ code: 'TRAIL1', host: { userId: 'a', name: 'А' }, now });
  setSeatCount(t, 'a', 3, now);
  sit(t, { userId: 'b', name: 'Б' }, 1, now);
  sit(t, { userId: 'c', name: 'В' }, 2, now);
  ['pot', 'bull', 'lion'].forEach((h, i) => setHero(t, users[i], i, h, now));
  start(t, 'a', { rng: makeRng(3), now });

  const who = users[t.game.toMove];
  const other = users.find((u) => u !== who);
  const v = viewFor(t, who);
  const index = v.game.legal.findIndex((m) => m.type === 'tile');
  const m = v.game.legal[index];
  submit(t, who, { version: t.version, index }, { rng: makeRng(4), now });

  const seen = viewFor(t, other);
  assert.deepEqual(trailMarks(seen.game.log, seen.me).map((x) => x.pos), [m.pos]);
  const mine = viewFor(t, who);
  assert.deepEqual(trailMarks(mine.game.log, mine.me), []);

  undo(t, who, { version: t.version }, { now });
  const after = viewFor(t, other);
  assert.deepEqual(trailMarks(after.game.log, after.me), []);
});

test('стрелка переноса лидера гаснет через 15 с, рамка хода остается (Денис 08.11)', () => {
  assert.equal(TRAIL_ARROW_MS, 15000);
  const mark = (age, extra = {}) => ({ pos: 40, from: 20, size: 1, n: 1, action: 1, age, ...extra });
  const young = trailSVG([mark(1000)]);
  assert.match(young, /class="trail-arrow"/);
  assert.match(young, /<g class="trail-move" style="animation-delay:-1000ms">/, 'гаснет по CSS с поправкой на возраст');
  const old = trailSVG([mark(15000)]);
  assert.doesNotMatch(old, /trail-arrow|trail-from/, 'после 15 с стрелки нет');
  assert.match(old, /class="trail"/, 'рамка хода остается');
  const still = trailSVG([mark(99000, { still: true })]);
  assert.match(still, /class="trail-arrow"/, 'просмотр партии: стрелка стоит');
  assert.doesNotMatch(still, /trail-move/);
  // CSS гасит стрелку за то же время
  const css = readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8');
  assert.match(css, new RegExp(`\.trail-move\{animation:trailMoveGone ${TRAIL_ARROW_MS / 1000}s`));
});
