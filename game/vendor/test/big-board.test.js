// Большое поле 19x13 (сайт): размер, состав коробки и порог конца берутся из раскладки,
// обычные поля при этом не меняются.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, cloneState, legalMoves, applyMove, validate, ranking, treasuresOnBoard, monumentOptions } from '../engine/engine.js';
import { geom, cellNameOn } from '../engine/constants.js';
import { BOARDS } from '../engine/boards.js';
import { makeRng } from '../engine/rng.js';
import { playGame } from '../sim/arena.js';

const B = BOARDS.big;
const CFG = { englishSupport: true, buildings: true, wonder: true };

test('большое поле: раскладка согласована', () => {
  const n = B.w * B.h;
  assert.equal(n, 247);
  assert.equal(new Set(B.river).size, B.river.length);
  assert.equal(B.temples.length, 20);
  for (const i of [...B.river, ...B.temples]) assert.ok(i >= 0 && i < n);
  for (const t of B.temples) assert.ok(!B.river.includes(t), 'храм на реке');
  const d = (a, b) => Math.abs(a % B.w - b % B.w) + Math.abs(Math.floor(a / B.w) - Math.floor(b / B.w));
  for (const a of B.temples) for (const b of B.temples) if (a < b) assert.ok(d(a, b) >= 5, `храмы ${a} и ${b} ближе 5`);
  const share = B.river.length / n;
  assert.ok(share > 0.22 && share < 0.235, 'доля реки как на полях BGA');
  assert.equal(B.tiles.reduce((a, b) => a + b, 0), 215);
});

test('большое поле: состояние партии и геометрия', () => {
  const s = createGame({ layout: B, numPlayers: 4, cfg: CFG }, makeRng(1));
  assert.equal(s.tile.length, 247);
  assert.deepEqual([s.w, s.h, s.endAt], [19, 13, 3]);
  assert.equal(geom(s).NB[246].length, 2);
  assert.deepEqual(geom(s).NB[20].sort((a, b) => a - b), [1, 19, 21, 39]);
  assert.equal(s.bag.reduce((a, b) => a + b, 0), 215 - 20 - 4 * 6);
  assert.equal(treasuresOnBoard(s), 20);
  assert.equal(cellNameOn(s, 246), 'S13');
  const c = cloneState(s);
  assert.deepEqual([c.w, c.h, c.endAt, c.tiles], [19, 13, 3, s.tiles]);
  assert.deepEqual(validate(s), []);
});

test('обычное поле: состояние без новых полей, геометрия 16x11', () => {
  const s = createGame({ layout: BOARDS.advanced, numPlayers: 3, cfg: CFG }, makeRng(1));
  for (const k of ['w', 'h', 'tiles', 'endAt']) assert.ok(!(k in s) && !(k in cloneState(s)), k);
  assert.equal(s.tile.length, 176);
  assert.equal(geom(s).W, 16);
});

test('большое поле: монумент у правого и нижнего края', () => {
  const s = createGame({ layout: B, numPlayers: 2, cfg: CFG }, makeRng(2));
  const tl = 11 * 19 + 17; // R12: квадрат R12-S13, на поле 16x11 таких клеток нет
  for (const i of [tl, tl + 1, tl + 19, tl + 20]) s.tile[i] = 3;
  assert.ok(monumentOptions(s, tl + 20, 3).some((m) => m.type === 'monument' && m.tl === tl));
});

test('большое поле: 60 случайных партий доигрываются без нарушений', () => {
  const ends = {};
  for (let g = 0; g < 60; g++) {
    const rng = makeRng(500 + g);
    const s = createGame({ layout: B, numPlayers: 2 + (g % 3), cfg: g % 2 ? CFG : {} }, rng);
    let steps = 0;
    while (!s.over) {
      const moves = legalMoves(s);
      assert.ok(moves.length > 0, `нет ходов в фазе ${s.phase}`);
      applyMove(s, moves[Math.floor(rng() * moves.length)], rng);
      if (steps % 25 === 0) { const errs = validate(s); if (errs.length) assert.fail(`партия ${g} шаг ${steps}: ${errs.join('; ')}`); }
      if (++steps > 60000) assert.fail(`партия ${g} не кончилась`);
    }
    assert.deepEqual(validate(s), []);
    assert.equal(ranking(s).length, s.np);
    if (s.endReason === 'treasures') assert.ok(treasuresOnBoard(s) <= 3);
    ends[s.endReason] = (ends[s.endReason] || 0) + 1;
  }
  assert.ok(Object.keys(ends).length >= 1);
});

test('большое поле: партия ботов доигрывается допустимыми ходами', () => {
  const r = playGame({ seats: [{ strength: 30, errors: 0 }, { strength: 30, errors: 0 }, { strength: 0, errors: 0 }], seed: 7, cfg: CFG, layout: B });
  assert.equal(r.ranking.length, 3);
  assert.ok(['bag', 'treasures'].includes(r.endReason), r.endReason);
});

test('бот: близкий конец по сокровищам считается от порога поля', async () => {
  const { turnsLeft } = await import('../bot/evaluate.js');
  const left = (layout, keep) => {
    const s = createGame({ layout, numPlayers: 4, cfg: CFG }, makeRng(3));
    let n = 0;
    for (let i = 0; i < s.treasure.length; i++) if (s.treasure[i] && ++n > keep) s.treasure[i] = 0;
    return turnsLeft(s);
  };
  assert.equal(left(B, 4), 3, 'большое поле: 4 сокровища, одно взятие до конца');
  assert.ok(left(B, 5) > 3);
  assert.equal(left(BOARDS.advanced, 3), 3, 'обычное поле: порог прежний');
  assert.ok(left(BOARDS.advanced, 4) > 3);
  // в начале партии вдвоем потолок ходов не срезает оценку по мешку
  const s2 = createGame({ layout: B, numPlayers: 2, cfg: CFG }, makeRng(3));
  assert.ok(turnsLeft(s2) > 40);
});
