// Ход считается кругами (Денис 12.11): круг, когда сходили все, и номер хода в круге.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundOf, turnLabel } from '../public/js/util.js';

test('круг и ход в круге из сквозного номера хода', () => {
  assert.deepEqual(roundOf(1, 4), { round: 1, k: 1, n: 4 });
  assert.deepEqual(roundOf(4, 4), { round: 1, k: 4, n: 4 });
  assert.deepEqual(roundOf(5, 4), { round: 2, k: 1, n: 4 });
  assert.deepEqual(roundOf(3, 2), { round: 2, k: 1, n: 2 }, 'партия Дениса с ботом: «ход 3» это второй круг');
  assert.deepEqual(roundOf(7, 3), { round: 3, k: 1, n: 3 });
});

test('подпись: «круг 2, ход 1 из 2»; без игроков и номера не падает', () => {
  assert.equal(turnLabel(3, 2), 'круг 2, ход 1 из 2');
  assert.equal(turnLabel(8, 4), 'круг 2, ход 4 из 4');
  assert.equal(turnLabel(5, 1), 'круг 5');
  assert.equal(turnLabel(undefined, undefined), 'круг 1');
});
