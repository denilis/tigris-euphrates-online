// Потолок времени бота из настроек (сервер своего стола на Vercel, паспорт карты).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, legalMoves, applyMove } from '../engine/engine.js';
import { makeRng } from '../engine/rng.js';
import { BOARDS } from '../engine/boards.js';
import { makeView } from '../bot/belief.js';
import { decide, params } from '../bot/bot.js';

const CFG = { englishSupport: true, buildings: true, wonder: true };

test('timeMs из настроек заменяет время от силы', () => {
  assert.equal(params({ strength: 100 }).timeMs, 7400);
  assert.equal(params({ strength: 100, timeMs: 300 }).timeMs, 300);
  assert.equal(params({ strength: 0, timeMs: Infinity }).timeMs, Infinity);
});

test('без потолка времени решение повторяется при том же rng', () => {
  const s = createGame({ layout: BOARDS.advanced, numPlayers: 4, cfg: CFG }, makeRng(5));
  // немного продвинуть партию, чтобы на поле было что взвешивать
  const r = makeRng(11);
  for (let k = 0; k < 12 && !s.over; k++) {
    const moves = legalMoves(s).filter((m) => m.type !== 'catastrophe' && m.type !== 'discard');
    applyMove(s, moves[Math.floor(r() * moves.length)], r);
  }
  const settings = { strength: 30, errors: 0, timeMs: Infinity };
  const run = () => decide(makeView(s, s.toMove, 'none', makeRng(7)), settings, makeRng(9)).move;
  assert.deepEqual(run(), run());
});

test('потолок времени соблюдается на сильном боте', () => {
  const s = createGame({ layout: BOARDS.advanced, numPlayers: 4, cfg: CFG }, makeRng(3));
  const res = decide(makeView(s, 0, 'none', makeRng(1)), { strength: 100, errors: 0, timeMs: 300 }, makeRng(2));
  assert.ok(legalMoves(s).some((m) => JSON.stringify(m) === JSON.stringify(res.move)));
  // срок мягкий (лучший кандидат досчитывается всегда), но не в разы больше потолка
  assert.ok(res.ms < 300 * 4, `решение заняло ${res.ms} мс при потолке 300`);
});
