// Схемы правил против настоящего движка: каждый участок выкладывается на поле и разыгрывается.
// Если схема или подпись к ней разойдется с правилами, упадет здесь.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENES, FIGURES, parseScene, cellAt } from '../public/js/rules-scenes.js';
import { RULES } from '../public/js/rules-text.js';
import { createState, applyMove, legalMoves, leaderTargets, tileTargets, components } from '../game/vendor/engine/engine.js';
import { BOARDS } from '../game/vendor/engine/boards.js';
import { makeRng } from '../game/vendor/engine/rng.js';

const W = 16, RED = 0, GREEN = 2, BLACK = 3, FACEDOWN = 4, WONDER = 5, CATASTROPHE = 6;
const at = (name) => { const { x, y } = cellAt(name); return y * W + x; };
const rng = makeRng(1);

/** Участок на поле; skip — клетки, которые схема показывает как будущий ход. */
function load(key, { cfg = {}, skip = [] } = {}) {
  const { cells } = parseScene(SCENES[key]);
  const river = [];
  cells.forEach((row, y) => row.forEach((c, x) => { if (c.river) river.push(y * W + x); }));
  const s = createState({ layout: { river, temples: [] }, numPlayers: 2, cfg });
  const hole = new Set(skip.map(at));
  cells.forEach((row, y) => row.forEach((c, x) => {
    const i = y * W + x;
    if (hole.has(i)) return;
    if (c.tile !== null) {
      s.tile[i] = c.tile;
      s.bag[c.tile]--;
      if (c.treasure) s.treasure[i] = 1;
      if (c.building) { s.building[i] = c.tile; s.buildingPos[c.tile] = i; }
    }
    if (c.leader) {
      s.leader[i] = (c.leader.owner - 1) * 4 + c.leader.c;
      s.players[c.leader.owner - 1].leaders[c.leader.c] = i;
    }
  }));
  for (const p of s.players) p.hand = [2, 2, 2, 2];
  return s;
}

/** Поле совпадает с участком «стало». */
function same(s, key) {
  const { cells } = parseScene(SCENES[key]);
  cells.forEach((row, y) => row.forEach((c, x) => {
    const i = y * W + x, name = String.fromCharCode(65 + x) + (y + 1);
    let want = -1;
    if (c.tile !== null) want = c.tile;
    else if (c.cat) want = CATASTROPHE;
    else if (c.flipped) want = FACEDOWN;
    else if (c.wonder) want = WONDER;
    assert.equal(s.tile[i], want, `тайл ${name}`);
    assert.equal(s.leader[i], c.leader ? (c.leader.owner - 1) * 4 + c.leader.c : -1, `лидер ${name}`);
  }));
}

const marked = (key, mark) => {
  const out = [];
  parseScene(SCENES[key]).cells.forEach((row, y) => row.forEach((c, x) => { if (c.mark === mark) out.push(y * W + x); }));
  return out;
};

test('в тексте правил только существующие схемы, и лишних схем нет', () => {
  const used = RULES.flatMap((s) => s.body).filter((b) => b.fig).map((b) => b.fig);
  assert.deepEqual([...new Set(used)].sort(), Object.keys(FIGURES).sort());
  for (const b of RULES.flatMap((s) => s.body).filter((x) => x.fig)) assert.ok(b.cap, b.fig);
  assert.deepEqual([...new Set(Object.values(FIGURES).flat())].sort(), Object.keys(SCENES).sort());
});

test('карты на схеме это карты игры', () => {
  for (const key of ['standard', 'advanced']) {
    assert.deepEqual(SCENES[key].river, BOARDS[key].river, key);
    assert.deepEqual(SCENES[key].temples, BOARDS[key].temples, key);
  }
  assert.equal(SCENES.standard.temples.length, 10);
  assert.equal(SCENES.advanced.temples.length, 14);
});

test('регион и царство: лидер делает группу царством', () => {
  const s = load('region');
  const { lab } = components(s);
  assert.equal(lab[at('A1')], lab[at('B1')]);
  assert.equal(lab[at('A1')], lab[at('A2')]);
  assert.notEqual(lab[at('A1')], lab[at('D1')]);
  assert.equal(lab[at('D1')], lab[at('E1')], 'лидер связывает соседние тайлы');
  assert.equal(lab[at('E1')], lab[at('F1')]);
});

test('лидер: галочки разрешены, крестики запрещены', () => {
  const s = load('leader');
  const can = leaderTargets(s, 0, RED);
  assert.equal(marked('leader', 'ok').length, 3);
  assert.equal(marked('leader', 'no').length, 3);
  for (const i of marked('leader', 'ok')) assert.ok(can.includes(i), `клетка ${i}`);
  for (const i of marked('leader', 'no')) assert.ok(!can.includes(i), `клетка ${i}`);
});

test('тайл нельзя класть рядом с тремя царствами', () => {
  const s = load('three');
  assert.ok(!tileTargets(s, GREEN).includes(at('C3')));
  assert.ok(tileTargets(s, GREEN).includes(at('C4')), 'клетка рядом свободна');
});

test('очко за тайл: хозяину лидера цвета, иначе хозяину царя', () => {
  const s = load('points', { skip: ['B1', 'C3'] });
  applyMove(s, { type: 'tile', color: RED, pos: at('B1') }, rng);
  assert.equal(s.players[0].score[RED], 1, 'храм рядом со жрецом льва');
  applyMove(s, { type: 'tile', color: GREEN, pos: at('C3') }, rng);
  assert.equal(s.players[1].score[GREEN], 1, 'рынок идет царю быка');
  assert.equal(s.players[0].score[GREEN], 0);
});

test('катастрофа: лидер без храма уходит в руку, рынки остаются', () => {
  const s = load('catBefore');
  applyMove(s, { type: 'catastrophe', pos: at('A1') }, rng);
  same(s, 'catAfter');
  assert.equal(s.players[0].cats, 1);
  assert.equal(s.players[0].leaders[BLACK], -1);
});

test('восстание: сила это соседние храмы, победителю красное очко', () => {
  const s = load('revolt', { skip: ['B1'] });
  applyMove(s, { type: 'leader', color: GREEN, pos: at('B1') }, rng);
  assert.equal(s.phase, 'revoltSupport');
  assert.equal(s.ctx.revolt.attBoard, 2);
  assert.equal(s.ctx.revolt.defBoard, 1);
  applyMove(s, { type: 'support', n: 0 }, rng);
  applyMove(s, { type: 'support', n: 0 }, rng);
  assert.equal(s.players[0].score[RED], 1);
  assert.equal(s.players[1].leaders[GREEN], -1, 'торговец быка в руке');
  assert.equal(s.leader[at('B1')], GREEN, 'торговец льва на месте');
  assert.equal(s.tile[at('E1')], RED, 'тайлы на поле не снимаются');
});

test('война: три против одного, лев получает два черных очка', () => {
  const s = load('warBefore', { skip: ['E1'] });
  applyMove(s, { type: 'tile', color: GREEN, pos: at('E1') }, rng);
  assert.equal(s.phase, 'warSupport');
  assert.equal(s.ctx.war.att, 0);
  assert.equal(s.ctx.war.attBoard, 3);
  assert.equal(s.ctx.war.defBoard, 1);
  applyMove(s, { type: 'support', n: 0 }, rng);
  applyMove(s, { type: 'support', n: 0 }, rng);
  same(s, 'warAfter');
  assert.equal(s.players[0].score[BLACK], 2);
  assert.equal(s.players[0].score[GREEN], 0, 'объединяющий тайл очка не дает');
});

test('монумент: квадрат переворачивается, царь дает черное очко в конце хода', () => {
  const s = load('monBefore', { skip: ['D2'] });
  s.actionNo = 2;
  applyMove(s, { type: 'tile', color: GREEN, pos: at('D2') }, rng);
  assert.equal(s.phase, 'monument');
  const want = s.monuments.find((m) => [m.c1, m.c2].sort().join() === [GREEN, BLACK].sort().join());
  applyMove(s, legalMoves(s).find((m) => m.type === 'monument' && m.id === want.id), rng);
  same(s, 'monAfter');
  assert.equal(want.pos ?? s.monuments.find((m) => m.id === want.id).pos, at('C1'));
  assert.equal(s.players[0].score[BLACK], 1, 'очко за монумент');
  assert.equal(s.players[0].score[GREEN], 1, 'очко за сам тайл');
});

test('сокровище: торговец берет одно из двух', () => {
  const s = load('treasure', { skip: ['C1'] });
  applyMove(s, { type: 'tile', color: BLACK, pos: at('C1') }, rng);
  assert.equal(s.phase, 'treasure');
  assert.equal(s.toMove, 0);
  assert.deepEqual(legalMoves(s).map((m) => m.pos).sort((a, b) => a - b), [at('A1'), at('D1')]);
  applyMove(s, { type: 'treasure', pos: at('A1') }, rng);
  assert.equal(s.players[0].treasures, 1);
  assert.equal(s.treasure[at('D1')], 1, 'одно осталось');
});

test('здание: ряд из трех дает право на здание', () => {
  const s = load('building', { skip: ['E1'], cfg: { buildings: true } });
  applyMove(s, { type: 'tile', color: BLACK, pos: at('E1') }, rng);
  assert.equal(s.phase, 'build');
  const cells = legalMoves(s).filter((m) => m.type === 'build').map((m) => m.pos).sort((a, b) => a - b);
  assert.deepEqual(cells, [at('C1'), at('D1'), at('E1')]);
});

test('чудо: крест из пяти тайлов', () => {
  const s = load('wonderBefore', { skip: ['B2'], cfg: { wonder: true } });
  applyMove(s, { type: 'tile', color: BLACK, pos: at('B2') }, rng);
  assert.equal(s.phase, 'monument');
  applyMove(s, legalMoves(s).find((m) => m.type === 'wonder' && m.center === at('B2')), rng);
  same(s, 'wonderAfter');
  assert.equal(s.wonderPos, at('B2'));
});
