// Очерёдность хода: проигравший прошлой партии первым, остальные по кругу (A6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playOrder, companyKey, placesFromVectors } from '../game/order.js';
import { makeRng } from '../game/vendor/engine/rng.js';

// места стола в порядке, как они сидят
const SEATS = [
  { id: 0, kind: 'human', userId: 'u-denis' },
  { id: 1, kind: 'human', userId: 'u-andrey' },
  { id: 2, kind: 'human', userId: 'u-vlad' },
  { id: 3, kind: 'bot', userId: null },
];
const last = (places) => ({
  id: 'g1',
  seats: [
    { seatId: 0, kind: 'human', userId: 'u-denis', place: places[0] },
    { seatId: 1, kind: 'human', userId: 'u-andrey', place: places[1] },
    { seatId: 2, kind: 'human', userId: 'u-vlad', place: places[2] },
    { seatId: 3, kind: 'bot', userId: null, place: places[3] },
  ],
});

test('компания: набор кодов людей без учёта порядка, боты не в счёт', () => {
  assert.equal(companyKey(['u-vlad', 'u-denis', 'u-andrey']), companyKey(['u-andrey', 'u-vlad', 'u-denis']));
  assert.notEqual(companyKey(['u-denis', 'u-andrey']), companyKey(['u-denis', 'u-andrey', 'u-vlad']));
});

test('проигравший первым, остальные по кругу за столом', () => {
  const r = playOrder(SEATS, 'loser', { last: last([1, 4, 2, 3]), rng: makeRng(1) });
  assert.deepEqual(r.order, [1, 2, 3, 0]);
  assert.equal(r.reason, 'loser');
  assert.equal(r.first, 1);
});

test('ничья за последнее место решается случайно среди делящих', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const r = playOrder(SEATS, 'loser', { last: last([1, 3, 3, 2]), rng: makeRng(seed) });
    assert.ok([1, 2].includes(r.order[0]));
    seen.add(r.order[0]);
  }
  assert.equal(seen.size, 2, 'оба делящих должны выпадать');
});

test('бот на последнем месте ходит первым', () => {
  const r = playOrder(SEATS, 'loser', { last: last([2, 1, 3, 4]), rng: makeRng(1) });
  assert.deepEqual(r.order, [3, 0, 1, 2]);
});

test('бот проиграл, а бота за новым столом нет: первым худший из людей', () => {
  const humans = SEATS.slice(0, 3);
  const r = playOrder(humans, 'loser', { last: last([2, 1, 3, 4]), rng: makeRng(1) });
  assert.deepEqual(r.order, [2, 0, 1]);
});

test('без истории компании: случайно', () => {
  const r = playOrder(SEATS, 'loser', { last: null, rng: makeRng(5) });
  assert.equal(r.reason, 'no-history');
  assert.deepEqual([...r.order].sort(), [0, 1, 2, 3]);
});

test('случайно и вручную', () => {
  const orders = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    const r = playOrder(SEATS, 'random', { last: last([1, 2, 3, 4]), rng: makeRng(seed) });
    assert.deepEqual([...r.order].sort(), [0, 1, 2, 3]);
    orders.add(r.order.join());
  }
  assert.ok(orders.size > 5, 'случайный порядок должен меняться');
  const moved = [SEATS[2], SEATS[0], SEATS[3], SEATS[1]];
  assert.deepEqual(playOrder(moved, 'custom', { last: null, rng: makeRng(1) }).order, [2, 0, 3, 1]);
});

test('места по векторам очков: равные векторы делят место', () => {
  assert.deepEqual(placesFromVectors([[3, 4, 5, 6], [2, 4, 5, 6], [3, 4, 5, 6], [1, 1, 1, 9]]), [1, 3, 1, 4]);
});
