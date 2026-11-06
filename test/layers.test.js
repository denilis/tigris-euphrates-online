// Слои поля и рисунок следа: ползунки в шапке партии, стрелка переноса лидера, кубик сокровища.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { LAYERS, ALL_ON, cleanLayers } from '../public/js/layers.js';
import { trailSVG, arrowPath, treasureSVG, TREASURE_IMG } from '../public/js/board.js';

test('слои: по умолчанию все включены, мусор не ломает выбор', () => {
  // 06.11: метки монументов под ползунком «Тайлы», на месте «Монументов» «Анимация»
  assert.deepEqual(LAYERS.map((l) => l.id), ['owners', 'support', 'moves', 'anim']);
  assert.deepEqual(LAYERS.map((l) => l.label), ['Тайлы', 'Сила', 'Ходы', 'Анимация']);
  assert.deepEqual(cleanLayers({ monuments: false }), ALL_ON, 'старый выбор «Монументы» больше ничего не прячет');
  assert.equal(ALL_ON.anim, true, 'анимация по умолчанию включена');
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

test('сокровище: кубик картинкой по центру клетки, размер по просьбе Дениса, у особого золотой ободок', () => {
  const plain = treasureSVG(20, false);
  const [cx, cy] = center(20);
  const top = plain.match(/<image class="cube-top" href="([^"]+)" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"/).slice(1);
  const [x, y, w] = top.slice(1).map(Number);
  assert.equal(top[0], TREASURE_IMG);
  assert.ok(existsSync(new URL('../public' + TREASURE_IMG, import.meta.url)), 'картинка кубика на месте');
  assert.equal(w, 14.3, '04.11: было 22, вдвое меньше (11), потом на 30% больше');
  assert.ok(Math.abs(x + w / 2 - cx) < 0.1 && Math.abs(y + w / 2 - cy) < 0.1, 'по центру клетки');
  assert.doesNotMatch(plain, /cube-ring/);
  assert.match(treasureSVG(20, true), /cube-ring/);
});
