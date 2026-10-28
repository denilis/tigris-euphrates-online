// Дымовая проверка копии движка: случайные партии на обоих полях со всеми вариантами
// правил доходят до конца без единого нарушения validate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, legalMoves, applyMove, validate, ranking } from '../game/vendor/engine/engine.js';
import { makeRng } from '../game/vendor/engine/rng.js';
import { BOARDS } from '../game/vendor/engine/boards.js';

const CFG = { englishSupport: true, buildings: true, wonder: true };

test('20 случайных партий доходят до конца без нарушений', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const layout = seed % 2 ? BOARDS.advanced : BOARDS.standard;
    const np = 2 + (seed % 3);
    const rng = makeRng(seed);
    const s = createGame({ layout, numPlayers: np, cfg: CFG }, rng);
    let steps = 0;
    while (!s.over) {
      const moves = legalMoves(s);
      assert.ok(moves.length > 0, `партия ${seed}: нет ходов в фазе ${s.phase}`);
      applyMove(s, moves[Math.floor(rng() * moves.length)], rng);
      assert.deepEqual(validate(s), [], `партия ${seed}, шаг ${steps}`);
      assert.ok(++steps < 5000, `партия ${seed} не закончилась`);
    }
    assert.equal(ranking(s).length, np);
  }
});
