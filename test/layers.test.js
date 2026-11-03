// Слои поля и рисунок следа: ползунки в шапке партии, стрелка переноса лидера, кубик сокровища.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYERS, ALL_ON, cleanLayers } from '../public/js/layers.js';
import { trailSVG, arrowPath, treasureSVG } from '../public/js/board.js';

test('слои: по умолчанию все включены, мусор не ломает выбор', () => {
  assert.deepEqual(LAYERS.map((l) => l.id), ['owners', 'support', 'moves', 'monuments']);
  assert.deepEqual(cleanLayers(null), ALL_ON);
  assert.deepEqual(cleanLayers('мусор'), ALL_ON);
  assert.deepEqual(cleanLayers({ moves: false, support: 'нет', чужое: false }), { ...ALL_ON, moves: false });
});

test('слои: прежняя кнопка «Метки: выкл» переходит в выключенный слой «Тайлы»', () => {
  assert.equal(cleanLayers(null, 'off').owners, false);
  assert.equal(cleanLayers(null, 'on').owners, true);
  assert.equal(cleanLayers({ owners: true }, 'off').owners, true, 'новый выбор важнее старой кнопки');
});

// клетка 60 px, поле с отступом 24: центр клетки i по x = 24 + (i % 16) * 60 + 30
const center = (i) => [24 + (i % 16) * 60 + 30, 24 + Math.floor(i / 16) * 60 + 30];
const end = (d) => d.match(/L([\d.-]+) ([\d.-]+)$/).slice(1).map(Number);

test('стрелка переноса лидера кончается за краем клетки и не заходит на кружки силы', () => {
  // по прямой, по диагонали и под острым углом, соседняя клетка и дальняя
  for (const [from, to] of [[20, 22], [20, 37], [5, 37], [3, 20], [40, 23], [100, 66]]) {
    const [tx, ty] = center(to);
    const [ex, ey] = end(arrowPath(from, to));
    const off = Math.max(Math.abs(ex - tx), Math.abs(ey - ty));
    assert.ok(off >= 30 + 9, `${from} -> ${to}: конец стрелки в ${off.toFixed(1)} px от центра, край клетки в 30`);
  }
});

test('номер действия в следе прячется слоем «Ходы», рамка и стрелка остаются', () => {
  const mark = { ev: 'leader', pos: 20, size: 1, action: 2, c: 0, hero: 'lion', age: 5000, from: 3 };
  assert.match(trailSVG([mark]), /class="trail-no"[^]*>2<\/text>/);
  const off = trailSVG([mark], false);
  assert.doesNotMatch(off, /trail-no/);
  assert.match(off, /class="trail"/);
  assert.match(off, /trail-arrow/);
});

test('сокровище: кубик по центру клетки, у особого золотой ободок', () => {
  const plain = treasureSVG(20, false);
  const [cx, cy] = center(20);
  const top = plain.match(/<rect class="cube-top" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"/).slice(1).map(Number);
  assert.equal(top[0] + top[2] / 2, cx);
  assert.equal(top[1] + top[2] / 2, cy);
  assert.doesNotMatch(plain, /cube-ring/);
  assert.match(treasureSVG(20, true), /cube-ring/);
});
