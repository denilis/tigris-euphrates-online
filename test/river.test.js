// Река линией по речным клеткам (просьба Дениса 04.11, макет specs/2026-11-04-река одобрен):
// вода только в извилистом русле, русло проходит через каждую речную клетку и не выходит на сушу.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BOARDS } from '../game/vendor/engine/boards.js';
import { ROUTES, riverFor, riverLayer, landCells, missedCells } from '../public/js/river.js';
import { renderBoard } from '../public/js/board.js';

const C = 60, G = 24;

test('река: у каждой карты движка есть русло, лишних нет', () => {
  assert.deepEqual(Object.keys(ROUTES).sort(), Object.keys(BOARDS).sort());
});

for (const key of Object.keys(BOARDS)) {
  test(`река ${key}: русло проходит через все речные клетки и не выходит на сушу`, () => {
    const river = BOARDS[key].river;
    assert.deepEqual(missedCells(ROUTES[key], river, C, G), [], 'речные клетки без воды');
    assert.deepEqual(landCells(ROUTES[key], river, C, G), [], 'вода на суше');
    assert.equal(riverFor(river, C, G)?.key, key);
  });
}

test('река: карта узнается по клеткам, порядок клеток не важен', () => {
  const river = [...BOARDS.standard.river].reverse();
  assert.equal(riverFor(river, C, G)?.key, 'standard');
});

test('река: незнакомая карта остается прежней заливкой клеток', () => {
  assert.equal(riverFor([0, 1, 2, 18], C, G), null);
  assert.equal(riverLayer([0, 1, 2, 18], true, C, G), null);
  // клетки продвинутой карты без одной: русло прошло бы по суше
  assert.equal(riverFor(BOARDS.advanced.river.slice(1), C, G), null);
});

test('река: рельеф берет текстуру воды, клетки градиент и рябь', () => {
  const relief = riverLayer(BOARDS.advanced.river, true, C, G);
  const cells = riverLayer(BOARDS.advanced.river, false, C, G);
  assert.match(relief, /fill="url\(#waterP\)"/);
  assert.doesNotMatch(relief, /url\(#water\)"/);
  assert.match(cells, /fill="url\(#water\)"/);
  assert.match(cells, /filter="url\(#ripple\)"/);
  assert.match(relief, /mask="url\(#riverM\)"/, 'речные клетки подсвечены по маске поля');
});

test('река: рисунок одинаковый при каждом вызове, поле не мигает', () => {
  assert.equal(riverLayer(BOARDS.standard.river, true, C, G), riverLayer([...BOARDS.standard.river], true, C, G));
});

// поле целиком: рисуем вид из урока в поддельный svg и смотрим статичный слой
function lessonGame() {
  const find = (o) => {
    if (!o || typeof o !== 'object') return null;
    if (Array.isArray(o.river) && o.board && o.players) return o;
    for (const v of Object.values(o)) { const r = find(v); if (r) return r; }
    return null;
  };
  return find(JSON.parse(readFileSync(new URL('../public/lessons/1.json', import.meta.url), 'utf8')));
}
const fakeSvg = () => {
  const dyn = { innerHTML: '' };
  return { dataset: {}, innerHTML: '', setAttribute() {}, querySelector: () => dyn };
};

test('поле: на настоящей карте вода руслом, без заливки клеток', () => {
  const g = lessonGame();
  for (const look of ['relief', 'cells']) {
    const svg = fakeSvg();
    renderBoard(svg, g, () => 'pot', {}, look);
    assert.match(svg.innerHTML, /class="stream"/, look);
    assert.doesNotMatch(svg.innerHTML, /mask="url\(#bankM\)"/, look);
  }
});

test('поле: незнакомая река рисуется прежней заливкой', () => {
  const g = { ...lessonGame(), river: [0, 1, 2, 18] };
  const svg = fakeSvg();
  renderBoard(svg, g, () => 'pot', {}, 'relief');
  assert.doesNotMatch(svg.innerHTML, /class="stream"/);
  assert.match(svg.innerHTML, /fill="url\(#waterP\)" mask="url\(#riverM\)"/);
});
