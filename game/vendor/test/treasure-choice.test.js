// Какое сокровище брать (Денис 08.11, партия с ботами): бот снял сокровище с K1, единственного храма
// рядом со своим царем, хотя было ничье F3. Сокровище не дает поставить на храм катастрофу
// (engine catastropheTargets), поэтому, снимая его, игрок открывает храм. Раньше выбор был по оценке
// позиции, где оба варианта равны, и брался первый по номеру клетки.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, createState, legalMoves } from '../engine/engine.js';
import { RED, BLUE, GREEN, BLACK, cellName } from '../engine/constants.js';
import { BOARDS } from '../engine/boards.js';
import { makeView } from '../bot/belief.js';
import { decide } from '../bot/bot.js';
import { autoMove, treasureExposure } from '../bot/policy.js';
import { bare, put, lead, setHand, at } from './helpers.js';

const rng = () => 0;

/** Храмы с сокровищами B2 (рядом торговец игрока 0, других храмов у него нет) и E2 (ничей); тайл D2 их соединяет. */
function twoTreasures(extra = []) {
  const s = bare(2, { englishSupport: true });
  put(s, 'B2', RED, { treasure: true });
  put(s, 'E2', RED, { treasure: true });
  lead(s, 0, GREEN, 'C2');
  for (const [p, c, cell] of extra) lead(s, p, c, cell);
  setHand(s, 0, [1, 1, 1, 3]);
  setHand(s, 1, [1, 1, 1, 3]);
  applyMove(s, { type: 'tile', color: BLACK, pos: at('D2') }, rng);
  assert.equal(s.phase, 'treasure');
  assert.equal(s.toMove, 0);
  return s;
}

test('сокровище с храма, единственного у своего лидера, стоит дорого; с ничьего ничего', () => {
  const s = twoTreasures();
  assert.ok(treasureExposure(s, at('B2'), 0) > 1);
  assert.equal(treasureExposure(s, at('E2'), 0), 0);
});

test('прикидка берет сокровище с ничьего храма, а не со своего', () => {
  assert.deepEqual(autoMove(twoTreasures()), { type: 'treasure', pos: at('E2') });
});

test('бот берет сокровище с ничьего храма', () => {
  const s = twoTreasures();
  const res = decide(makeView(s, 0, 'exact', rng), { strength: 100, errors: 0, timeMs: Infinity }, rng);
  assert.deepEqual(res.move, { type: 'treasure', pos: at('E2') });
});

test('особые храмы: обычная и продвинутая карта как на BGA, большое поле по одному у каждого угла', () => {
  for (const [name, b] of Object.entries(BOARDS)) {
    for (const i of b.special) assert.ok(b.temples.includes(i), `${name}: ${i} не стартовый храм`);
    if (name !== 'big') continue; // своя карта сайта: ближайший стартовый храм к каждому углу
    const w = b.w || 16, h = b.h || 11;
    const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
    const near = corners.map(([cx, cy]) => b.temples.reduce((best, i) => {
      const d = (i % w - cx) ** 2 + (Math.floor(i / w) - cy) ** 2;
      return d < best.d ? { i, d } : best;
    }, { i: -1, d: Infinity }).i);
    assert.deepEqual([...b.special].sort((x, y) => x - y), near.sort((x, y) => x - y), name);
  }
  assert.deepEqual(BOARDS.standard.special.map(cellName).sort(), ['B2', 'B8', 'O9', 'P2']);
  // выгрузка BGA 11.11: valid_treasures в 581 выборе сокровища (57 партий на продвинутой карте)
  assert.deepEqual(BOARDS.advanced.special.map(cellName).sort(), ['A8', 'B3', 'E10', 'O11', 'P6']);
});

test('храм у лидера соперника открывать выгодно', () => {
  const s = twoTreasures([[1, RED, 'F2']]);
  assert.ok(treasureExposure(s, at('E2'), 0) < 0, 'жрец соперника на F2 держится только за E2');
  assert.deepEqual(autoMove(s), { type: 'treasure', pos: at('E2') });
});

test('продвинутая карта: из E10 и H8 торговец обязан взять E10 (партия Дениса 11.11, как на BGA)', () => {
  const s = createState({ layout: BOARDS.advanced, numPlayers: 2, cfg: { englishSupport: true } });
  // царство от H8 вниз к E10: суша черным, река синим; последний тайл G8 соединяет оба храма
  const path = ['E9', 'E8', 'F8'];
  for (const c of path) put(s, c, s.river[at(c)] ? BLUE : BLACK);
  lead(s, 0, GREEN, 'D10');
  setHand(s, 0, [0, 1, 1, 4]);
  setHand(s, 1, [1, 1, 1, 3]);
  assert.ok(s.treasure[at('E10')] && s.treasure[at('H8')]);
  applyMove(s, { type: 'tile', color: s.river[at('G8')] ? BLUE : BLACK, pos: at('G8') }, rng);
  assert.equal(s.phase, 'treasure');
  assert.deepEqual(legalMoves(s).map((m) => cellName(m.pos)), ['E10']);
});
