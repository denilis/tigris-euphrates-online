// Бот на сервере: доигрывает партию, видит только своё, укладывается в потолок времени,
// при сбое делает безопасный ход (спецификация A4, A10; план, проблемы 3, 4, 11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botStep, botView } from '../game/bots.js';
import { safeMove } from '../game/safeMove.js';
import { createTable, leave, setSeatKind, setBot, start, botDue } from '../game/table.js';
import { stateFromJSON, stateToJSON } from '../game/serialize.js';
import { legalMoves, applyMove } from '../game/vendor/engine/engine.js';
import { publicRemoved } from '../game/vendor/bot/belief.js';
import { USERS, T0, started, randomStep, makeRng } from './support.js';

const canon = (m) => JSON.stringify(m, Object.keys(m).sort());

/** Стол из n ботов: хост встаёт с места и смотрит. */
function botTable(seed, bot = { strength: 0, errors: 0 }, n = 4) {
  const t = createTable({ code: 'BOTS01', host: USERS.denis, now: T0 });
  leave(t, USERS.denis.userId, T0);
  for (const seat of t.seats) if (seat.kind !== 'bot') setSeatKind(t, USERS.denis.userId, seat.id, 'bot', T0);
  for (const seat of t.seats) setBot(t, USERS.denis.userId, seat.id, bot, T0);
  if (n < 4) t.seats = t.seats.slice(0, n);
  start(t, USERS.denis.userId, { last: null, rng: makeRng(seed), now: T0 });
  return t;
}

test('стол из 4 ботов доигрывает партию', async () => {
  for (const seed of [1, 2]) {
    const t = botTable(seed);
    const draw = makeRng(seed + 10), brain = makeRng(seed + 20);
    let steps = 0;
    while (t.status === 'playing') {
      const r = await botStep(t, { rng: draw, botRng: brain, now: T0, timeCap: 30 });
      assert.ok(r, 'ходит бот');
      assert.equal(r.fallback, false, `запасной ход на шаге ${steps}: ${r.error}`);
      assert.ok(++steps < 3000);
    }
    assert.equal(t.status, 'over');
    assert.equal(t.game.result.seats.length, 4);
  }
});

test('ход человека бот не трогает', async () => {
  const t = started(5);
  while (botDue(t) !== null) await botStep(t, { rng: makeRng(1), botRng: makeRng(2), now: T0, timeCap: 30 });
  const before = JSON.stringify(t);
  assert.equal(await botStep(t, { rng: makeRng(1), botRng: makeRng(2), now: T0 }), null);
  assert.equal(JSON.stringify(t), before);
});

/** Другое скрытое у всех, кроме бота: состав рук, сбросов и мешка при тех же числах. */
function scramble(t, botP, r) {
  const u = structuredClone(t);
  const s = stateFromJSON(u.game.state);
  const pub = publicRemoved(s);
  const reshuffle = (a) => {
    const out = [0, 0, 0, 0];
    for (let k = 0; k < a.reduce((x, y) => x + y, 0); k++) out[Math.floor(r() * 4)]++;
    return out;
  };
  s.players.forEach((pl, p) => {
    if (p === botP) return;
    pl.hand = reshuffle(pl.hand);
    pl.discarded = reshuffle(pl.discarded);
  });
  // ушедшее из игры: публичная часть та же, сбросы по новым цветам
  s.removed = pub.map((v, c) => v + s.players.reduce((a, pl) => a + pl.discarded[c], 0));
  s.bag = reshuffle(s.bag);
  u.game.state = stateToJSON(s);
  return u;
}

test('вид бота: чужие руки, сбросы и мешок не влияют, ушедшее из игры только публичное', () => {
  let checks = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const t = started(seed);
    const r = makeRng(seed), draw = makeRng(seed + 1), mix = makeRng(seed + 2);
    while (t.status === 'playing' && checks < seed * 40) {
      const seatId = botDue(t);
      if (seatId !== null) {
        const p = t.game.order.indexOf(seatId);
        const a = botView(t, seatId, 'none', makeRng(3));
        const b = botView(scramble(t, p, mix), seatId, 'none', makeRng(3));
        assert.equal(JSON.stringify(b), JSON.stringify(a));
        const s = stateFromJSON(t.game.state);
        const own = s.players[p].discarded;
        assert.deepEqual(a.state.removed, publicRemoved(s).map((v, c) => v + own[c]));
        checks++;
      }
      randomStep(t, r, draw);
    }
  }
  assert.ok(checks > 300, `проверок ${checks}`);
});

test('безопасный ход допустим в любой фазе', () => {
  const phases = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const r = makeRng(seed);
    const t = started(seed);
    const s = stateFromJSON(t.game.state);
    for (let k = 0; k < 4000 && !s.over; k++) {
      const legal = legalMoves(s);
      assert.ok(legal.some((m) => canon(m) === canon(safeMove(s))), `фаза ${s.phase}`);
      phases.add(s.phase);
      applyMove(s, legal[Math.floor(r() * legal.length)], r);
    }
  }
  for (const ph of ['action', 'warSupport', 'revoltSupport', 'build', 'monument', 'treasure']) assert.ok(phases.has(ph), `не встретилась фаза ${ph}`);
});

test('потолок времени: бот на силе 100 укладывается', async () => {
  const t = botTable(7, { strength: 100, errors: 0 });
  const r = await botStep(t, { rng: makeRng(1), botRng: makeRng(2), now: T0, timeCap: 300 });
  assert.equal(r.fallback, false);
  // срок мягкий (лучший кандидат досчитывается всегда), но не в разы больше потолка
  assert.ok(r.ms < 1500, `решение заняло ${r.ms} мс`);
});

test('сбой бота: падение или недопустимый ход заменяются безопасным ходом', async () => {
  for (const decide of [
    async () => { throw new Error('сломался'); },
    async () => ({ move: { type: 'tile', color: 1, pos: -1 }, text: '', ms: 1 }),
  ]) {
    const t = botTable(9);
    const s = stateFromJSON(t.game.state);
    const v = t.version;
    const r = await botStep(t, { rng: makeRng(1), botRng: makeRng(2), now: T0, decide });
    assert.equal(r.fallback, true);
    assert.equal(canon(r.move), canon(safeMove(s)));
    assert.equal(t.version, v + 1);
  }
});
