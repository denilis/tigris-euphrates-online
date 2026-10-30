// След хода: куда сходил соперник. Денис: тайлы появляются, и не всегда понятно, в какое место он встал.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trailMarks, ageMarks, TRAIL_FRESH_MS } from '../public/js/trail.js';
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

test('рисунок следа: свежая отметка садится и пульсирует, старая остается тихой рамкой с номером', () => {
  const mark = { ev: 'tile', pos: 0, size: 1, action: 2, c: 0 };
  const fresh = trailSVG([{ ...mark, age: 100 }]);
  assert.match(fresh, /class="land"/);
  assert.match(fresh, /class="trail fresh"/);
  assert.match(fresh, /animation-delay:-100ms/, 'перерисовка продолжает анимацию, а не начинает заново');
  assert.match(fresh, /<text[^>]*>2<\/text>/);
  const mid = trailSVG([{ ...mark, age: 1000 }]);
  assert.doesNotMatch(mid, /class="land"/);
  assert.match(mid, /class="trail fresh"/);
  const old = trailSVG([{ ...mark, age: TRAIL_FRESH_MS + 1 }]);
  assert.doesNotMatch(old, /fresh|class="land"/);
  assert.match(old, /class="trail"/);
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
