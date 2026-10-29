// Расчёты клиента без DOM: склонения, итог по слабейшему цвету и разбиение поля на группы
// (контуры царств и стороны войны должны совпадать с движком).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cells, plural, finalScore, groups } from '../public/js/util.js';
import { createGame, legalMoves, applyMove, components, finalVector } from '../game/vendor/engine/engine.js';
import { BOARDS } from '../game/vendor/engine/boards.js';
import { makeRng } from '../game/vendor/engine/rng.js';

test('склонения: клетки и тайлы', () => {
  assert.deepEqual([1, 2, 5, 11, 12, 21, 22, 25, 111, 123].map(cells),
    ['1 клетка', '2 клетки', '5 клеток', '11 клеток', '12 клеток', '21 клетка', '22 клетки', '25 клеток', '111 клеток', '123 клетки']);
  assert.deepEqual([1, 2, 5].map((n) => plural(n, 0)), ['храм', 'храма', 'храмов']);
  assert.deepEqual([1, 3, 7].map((n) => plural(n, 1)), ['ферма', 'фермы', 'ферм']);
});

test('итог по слабейшему цвету совпадает с движком', () => {
  const r = makeRng(3);
  for (let k = 0; k < 500; k++) {
    const score = [0, 1, 2, 3].map(() => Math.floor(r() * 12));
    const treasures = Math.floor(r() * 5);
    assert.equal(finalScore(score, treasures), finalVector({ score, treasures })[0]);
  }
});

// одинаковое разбиение на группы (номера групп могут отличаться)
const canon = (lab) => {
  const m = new Map();
  return Array.from(lab, (l) => (l < 0 ? -1 : (m.has(l) ? m.get(l) : (m.set(l, m.size), m.size - 1))));
};

test('группы клеток на клиенте совпадают с движком, в том числе без объединяющей клетки', () => {
  let checks = 0;
  for (let seed = 1; seed <= 15; seed++) {
    const r = makeRng(seed);
    const s = createGame({ layout: BOARDS.advanced, numPlayers: 4, cfg: { englishSupport: true, buildings: true, wonder: true } }, r);
    for (let k = 0; k < 400 && !s.over; k++) {
      if (k % 7 === 0) {
        const board = { tile: Array.from(s.tile), leader: Array.from(s.leader) };
        assert.deepEqual(canon(groups(board)), canon(components(s).lab));
        const blocked = Math.floor(r() * 176);
        assert.deepEqual(canon(groups(board, blocked)), canon(components(s, blocked).lab));
        checks++;
      }
      const legal = legalMoves(s);
      applyMove(s, legal[Math.floor(r() * legal.length)], r);
    }
  }
  assert.ok(checks > 300);
});
