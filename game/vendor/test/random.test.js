// Случайные партии: движок не должен падать и нарушать инварианты.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, legalMoves, applyMove, validate, ranking } from '../engine/engine.js';
import { makeRng } from '../engine/rng.js';
import { testLayout } from './helpers.js';

const WEIGHTS = { tile: 60, leader: 25, withdraw: 2, catastrophe: 3, discard: 4, pass: 1 };

function randomMove(moves, rng) {
  if (moves[0] && !(moves[0].type in WEIGHTS)) return moves[Math.floor(rng() * moves.length)];
  const byType = new Map();
  for (const m of moves) {
    if (!byType.has(m.type)) byType.set(m.type, []);
    byType.get(m.type).push(m);
  }
  let total = 0;
  for (const t of byType.keys()) total += WEIGHTS[t];
  let r = rng() * total;
  for (const [t, list] of byType) {
    r -= WEIGHTS[t];
    if (r <= 0) return list[Math.floor(rng() * list.length)];
  }
  const any = [...byType.values()].pop();
  return any[0];
}

function playRandomGame(seed, numPlayers, cfg) {
  const rng = makeRng(seed);
  const s = createGame({ layout: testLayout(), numPlayers, cfg }, rng);
  s.log = [];
  let steps = 0;
  while (!s.over) {
    const moves = legalMoves(s);
    assert.ok(moves.length > 0, `no moves in phase ${s.phase}`);
    applyMove(s, randomMove(moves, rng), rng);
    const errs = validate(s);
    if (errs.length) assert.fail(`seed ${seed} step ${steps}: ${errs.join('; ')}`);
    if (++steps > 20000) assert.fail(`seed ${seed}: game did not finish`);
  }
  return s;
}

test('200 случайных партий доигрываются без нарушений', () => {
  const stats = {};
  const configs = [
    {},
    { englishSupport: true },
    { buildings: true, wonder: true },
    { englishSupport: true, buildings: true, wonder: true },
  ];
  for (let g = 0; g < 200; g++) {
    const s = playRandomGame(1000 + g, 2 + (g % 3), configs[g % configs.length]);
    for (const e of s.log) stats[e.ev] = (stats[e.ev] || 0) + 1;
    stats['end:' + s.endReason] = (stats['end:' + s.endReason] || 0) + 1;
    assert.equal(ranking(s).length, s.np);
  }
  // в случайных партиях должны встречаться основные механики
  // (крест из пяти тайлов при случайной игре почти не складывается, чудо проверяет отдельный тест)
  for (const ev of ['revolt', 'war', 'monument', 'treasure', 'catastrophe', 'building', 'leaderReturned']) {
    assert.ok(stats[ev] > 0, `не встретилось событие ${ev}`);
  }
  console.log(JSON.stringify(stats));
});
