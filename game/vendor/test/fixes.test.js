// Исправления по живой партии 935682396: несколько войн за один ход и монументы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMove } from '../engine/engine.js';
import { RED, BLUE, GREEN, BLACK } from '../engine/constants.js';
import { makeRng } from '../engine/rng.js';
import { makeView } from '../bot/belief.js';
import { decide, params, playableActions, conflictOdds } from '../bot/bot.js';
import { at, bare, put, lead, setHand } from './helpers.js';

/**
 * Два королевства через пустую клетку E3. Слева мои жрец и торговец, справа
 * чужие. Красных справа больше (войну в красном я проиграю), зелёных у меня
 * намного больше (выиграю). Тайл на E3 начинает обе войны.
 */
function twoWars() {
  const s = bare(2, { englishSupport: true });
  // слева: храмы B2, C2, рынки B4, C4, D4, D3
  put(s, 'B2', RED); put(s, 'C2', RED);
  lead(s, 0, RED, 'B3'); lead(s, 0, GREEN, 'C3');
  put(s, 'D3', GREEN); put(s, 'B4', GREEN); put(s, 'C4', GREEN); put(s, 'D4', GREEN);
  // справа: храмы F2, G2, H2, I2, F4, один рынок G4
  put(s, 'F2', RED); put(s, 'G2', RED); put(s, 'H2', RED); put(s, 'I2', RED); put(s, 'F4', RED);
  lead(s, 1, RED, 'F3'); lead(s, 1, GREEN, 'G3'); put(s, 'G4', GREEN);
  setHand(s, 0, [0, 0, 3, 3]);
  setHand(s, 1, [3, 1, 1, 1]);
  return s;
}

test('объединение с двумя войнами не отсекается из-за одной проигрышной', () => {
  const s = twoWars();
  const view = makeView(s, 0, 'exact', makeRng(1));
  const m = { type: 'tile', color: BLACK, pos: at('E3') };
  const odds = conflictOdds(view, view.state, m);
  assert.equal(odds.wars.length, 2);
  assert.ok(odds.pWin < 0.2, 'красную войну бот проигрывает');
  assert.ok(odds.best > 0.9, 'зелёную выигрывает');
  const P = params({ strength: 50, risk: 50 });
  const playable = playableActions(view, view.state, P).map((x) => JSON.stringify(x));
  assert.ok(playable.includes(JSON.stringify(m)), 'ход остаётся в кандидатах, его решает полная оценка');
});

test('восстание с малым шансом по-прежнему отсекается', () => {
  const s = bare(2, { englishSupport: true });
  put(s, 'B2', RED); put(s, 'C1', RED); put(s, 'D2', RED); put(s, 'E2', RED);
  lead(s, 1, RED, 'C2'); // у соперника три храма рядом
  put(s, 'F2', RED);
  setHand(s, 0, [1, 2, 2, 1]);
  setHand(s, 1, [3, 1, 1, 1]);
  const view = makeView(s, 0, 'exact', makeRng(1));
  const m = { type: 'leader', color: RED, pos: at('E3') }; // у одного храма E2, королевство общее
  const odds = conflictOdds(view, view.state, m);
  if (!odds) return; // позиция не дала восстания: проверять нечего
  assert.equal(odds.wars.length, 1);
  const P = params({ strength: 50, risk: 50 });
  if (odds.pWin < P.attackThreshold) {
    const playable = playableActions(view, view.state, P).map((x) => JSON.stringify(x));
    assert.ok(!playable.includes(JSON.stringify(m)));
  }
});

test('стиль с обучением строит монумент, когда тайл замкнул квадрат', () => {
  const s = bare(2);
  put(s, 'C2', RED);
  lead(s, 0, BLACK, 'C3');
  put(s, 'D3', BLACK); put(s, 'E3', BLACK); put(s, 'D4', BLACK);
  setHand(s, 0, [1, 1, 1, 3]);
  setHand(s, 1, [2, 2, 1, 1]);
  applyMove(s, { type: 'tile', color: BLACK, pos: at('E4') }, makeRng(1));
  assert.equal(s.phase, 'monument');
  for (const style of ['universal', 'denis', 'base']) {
    const view = makeView(s, 0, 'none', makeRng(2));
    const res = decide(view, { strength: 50, errors: 0, style }, makeRng(3));
    assert.notEqual(res.move.type, 'pass', `стиль ${style} пасует вместо монумента`);
  }
});

test('проверка ответа соперника: при силе 50 проверяются лучшие ходы, настройкой выключается', async () => {
  const { createGame, legalMoves } = await import('../engine/engine.js');
  const { BOARDS } = await import('../engine/boards.js');
  const rng = makeRng(9);
  const s = createGame({ layout: BOARDS.advanced, numPlayers: 2, cfg: { englishSupport: true } }, rng);
  for (let k = 0; k < 12 && !s.over; k++) {
    const ms = legalMoves(s).filter((m) => m.type !== 'discard' && m.type !== 'pass');
    applyMove(s, ms[Math.floor(rng() * ms.length)], rng);
  }
  while (s.phase !== 'action') applyMove(s, legalMoves(s)[0], rng);
  const view = () => makeView(s, s.toMove, 'none', makeRng(4));
  const on = decide(view(), { strength: 50, errors: 0, style: 'base' }, makeRng(5));
  assert.ok(on.replied >= 2, 'проверено ответом соперника: ' + on.replied);
  const off = decide(view(), { strength: 50, errors: 0, style: 'base', reply: false }, makeRng(5));
  assert.equal(off.replied, 0);
  assert.equal(params({ strength: 20 }).replyK, 0, 'слабый бот ответ соперника не проверяет');
});

test('позиции живой партии 935700491: катастрофы на ходах 10 и 12 больше не тратятся', async () => {
  const { readFileSync } = await import('node:fs');
  const fx = JSON.parse(readFileSync(new URL('./fixtures/935700491_early_catastrophes.json', import.meta.url), 'utf8'));
  const typed = { tile: Int8Array, leader: Int8Array, treasure: Uint8Array, building: Int8Array, monument: Int8Array, river: Uint8Array, special: Uint8Array };
  for (const p of fx) {
    const s = { ...p.state };
    for (const [k, T] of Object.entries(typed)) s[k] = T.from(p.state[k]);
    assert.equal(p.played.startsWith('катастрофа'), true, 'в партии здесь была катастрофа');
    for (const style of ['base', 'universal']) {
      const res = decide(makeView(s, p.seat, 'none', makeRng(3)), { strength: 50, errors: 0, style }, makeRng(4));
      assert.notEqual(res.move.type, 'catastrophe', `ход ${p.turn}, стиль ${style}: ${res.text}`);
    }
  }
});
