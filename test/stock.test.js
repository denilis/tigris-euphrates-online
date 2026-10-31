// Запас в партии: какие монументы и здания еще можно построить.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stockItems } from '../public/js/stock.js';
import { createTable, sit, setHero, setSeatCount, start } from '../game/table.js';
import { viewFor } from '../game/view.js';
import { makeRng } from '../game/vendor/engine/rng.js';

const opts = { buildings: true, wonder: true };

function game(over = {}) {
  return {
    monuments: [0, 1, 2, 3, 4, 5].map((id) => ({ id, c1: 0, c2: 1, pos: -1 })),
    buildingPos: [-1, -1, -1, -1],
    wonderPos: -1,
    ...over,
  };
}

test('в начале партии все свободно', () => {
  const s = stockItems(game(), opts);
  assert.equal(s.monuments.length, 6);
  assert.ok(s.monuments.every((m) => !m.built));
  assert.equal(s.buildings.length, 4);
  assert.ok(s.buildings.every((b) => !b.built));
  assert.equal(s.wonder.built, false);
});

test('построенное отмечается и подсказка называет клетку', () => {
  const g = game({ buildingPos: [-1, 25, -1, -1], wonderPos: 40 });
  g.monuments[2].pos = 3;
  const s = stockItems(g, opts);
  assert.equal(s.monuments[2].built, true);
  assert.match(s.monuments[2].title, /D1/);
  assert.equal(s.buildings[1].built, true);
  assert.match(s.buildings[1].title, /ферма/);
  assert.match(s.buildings[1].title, /J2/);
  assert.equal(s.wonder.built, true);
  assert.match(s.monuments[0].title, /свободен/);
});

test('здания и чудо видны, только если включены за столом', () => {
  const s = stockItems(game(), { buildings: false, wonder: false });
  assert.equal(s.buildings, null);
  assert.equal(s.wonder, null);
  assert.equal(s.monuments.length, 6);
});

test('настоящий вид стола отдает все нужное', () => {
  const t = createTable({ code: 'STOCK1', host: { userId: 'a', name: 'А' }, now: 0 });
  setSeatCount(t, 'a', 3, 0);
  sit(t, { userId: 'b', name: 'Б' }, 1, 0);
  sit(t, { userId: 'c', name: 'В' }, 2, 0);
  ['pot', 'bull', 'lion'].forEach((h, i) => setHero(t, ['a', 'b', 'c'][i], i, h, 0));
  start(t, 'a', { rng: makeRng(3), now: 0 });
  const v = viewFor(t, 'a');
  const s = stockItems(v.game, v.options);
  assert.equal(s.monuments.length, 6);
  assert.equal(s.buildings.length, 4);
  assert.ok(s.wonder);
  assert.ok(s.monuments.every((m) => m.title && !m.built));
});
