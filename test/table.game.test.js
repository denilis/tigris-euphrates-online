// Ход партии через стол: только ходы из списка допустимых, версия, конец, реванш (A2, A6, A10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submit, submitSeat, botDue, rematch, historyEntry, start, TableError } from '../game/table.js';
import { stateFromJSON, stateToJSON } from '../game/serialize.js';
import { legalMoves, applyMove } from '../game/vendor/engine/engine.js';
import { USERS, T0, started, playOut, makeRng } from './support.js';

const code = (fn) => {
  try { fn(); } catch (e) { assert.ok(e instanceof TableError, `ожидалась TableError, а не ${e.stack || e}`); return e.code; }
  assert.fail('ожидался отказ');
};

/** Стол, где сейчас решает человек (а не бот). */
function humanToMove(seed) {
  const t = started(seed);
  const r = makeRng(99), draw = makeRng(98);
  for (let k = 0; k < 50; k++) {
    if (botDue(t) === null) return t;
    const s = stateFromJSON(t.game.state);
    const legal = legalMoves(s);
    submitSeat(t, botDue(t), legal[Math.floor(r() * legal.length)], { rng: draw, now: T0 });
  }
  throw new Error('бот ходит без конца');
}

test('подмена хода отклоняется, стол не меняется', () => {
  const t = humanToMove(3);
  const s = stateFromJSON(t.game.state);
  const decider = t.seats.find((x) => x.id === t.game.order[s.toMove]);
  const other = t.seats.find((x) => x.kind === 'human' && x.id !== decider.id);
  const before = JSON.stringify(t);
  const n = legalMoves(s).length;
  assert.equal(code(() => submit(t, decider.userId, { version: t.version - 1, index: 0 }, { now: T0 })), 'stale');
  assert.equal(code(() => submit(t, other.userId, { version: t.version, index: 0 }, { now: T0 })), 'not-your-move');
  assert.equal(code(() => submit(t, 'u-stranger', { version: t.version, index: 0 }, { now: T0 })), 'not-seated');
  for (const index of [-1, n, 1.5, '0', null, undefined, NaN]) {
    assert.equal(code(() => submit(t, decider.userId, { version: t.version, index }, { now: T0 })), 'bad-move', `индекс ${index}`);
  }
  assert.equal(code(() => submitSeat(t, decider.id, { type: 'tile', color: 0, pos: -5 }, { now: T0 })), 'bad-move');
  assert.equal(JSON.stringify(t), before);
});

test('честный ход принимается и двигает версию', () => {
  const t = humanToMove(4);
  const s = stateFromJSON(t.game.state);
  const decider = t.seats.find((x) => x.id === t.game.order[s.toMove]);
  const v = t.version;
  submit(t, decider.userId, { version: v, index: 0 }, { rng: makeRng(5), now: T0 + 1000 });
  assert.equal(t.version, v + 1);
  assert.equal(t.updatedAt, T0 + 1000);
});

test('200 партий через стол доходят до конца без нарушений правил', () => {
  let totalSteps = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const options = { board: seed % 3 === 0 ? 'standard' : 'advanced', openScore: seed % 2 === 0 };
    const t = started(seed, options);
    let lastVersion = t.version;
    totalSteps += playOut(t, seed, (tt) => {
      assert.ok(tt.version >= lastVersion);
      lastVersion = tt.version;
    });
    assert.equal(t.status, 'over');
    const res = t.game.result;
    assert.equal(res.seats.length, 4);
    assert.ok(res.seats.every((x) => x.place >= 1 && x.place <= 4));
    assert.ok(res.seats.some((x) => x.place === 1));
    assert.ok(t.game.log.length > 0);
    assert.ok(['bag', 'treasures'].includes(res.endReason));
  }
  assert.ok(totalSteps > 200 * 50);
});

test('состояние в JSON и обратно не меняет партию', () => {
  const t = started(7);
  const r = makeRng(70);
  let s = stateFromJSON(t.game.state);
  for (let k = 0; k < 400 && !s.over; k++) {
    const json = stateToJSON(s);
    const back = stateFromJSON(json);
    assert.deepEqual(stateToJSON(back), json);
    const legal = legalMoves(s);
    const m = legal[Math.floor(r() * legal.length)];
    applyMove(s, m, makeRng(k + 1));
    applyMove(back, m, makeRng(k + 1));
    assert.deepEqual(stateToJSON(back), stateToJSON(s), `шаг ${k}`);
    s = back;
  }
});

test('итог и история: места с ничьими, векторы очков, компания', () => {
  const t = started(11);
  playOut(t, 11);
  const h = historyEntry(t);
  assert.equal(h.company, ['u-andrey', 'u-denis', 'u-vlad'].join('|'));
  assert.equal(h.seats.length, 4);
  for (const x of h.seats) {
    assert.equal(x.vector.length, 4);
    assert.ok(x.place >= 1 && x.place <= 4);
  }
  const bot = h.seats.find((x) => x.kind === 'bot');
  assert.equal(bot.userId, null);
  assert.ok(h.id && h.finishedAt === T0);
});

test('реванш: тот же состав и герои в лобби, начинает позвавший, первым ходит последнее место', () => {
  const t = started(12);
  playOut(t, 12);
  const h = historyEntry(t);
  const worst = Math.max(...h.seats.map((x) => x.place));
  const losers = h.seats.filter((x) => x.place === worst).map((x) => x.seatId);
  const { created, code: next } = rematch(t, USERS.vlad.userId, { code: 'NEXT01', rng: makeRng(1), now: T0 + 5 });
  assert.equal(next, 'NEXT01');
  assert.equal(t.next, 'NEXT01');
  // с 04.11 реванш собирается в лобби: начинают, когда все снова за столом
  assert.equal(created.status, 'lobby');
  assert.equal(created.hostUserId, USERS.vlad.userId, 'хозяин реванша тот, кто позвал');
  assert.deepEqual(created.seats.map((x) => [x.id, x.kind, x.userId, x.hero]), t.seats.map((x) => [x.id, x.kind, x.userId, x.hero]));
  assert.deepEqual(created.options, { ...t.options, order: 'loser' });
  assert.equal(code(() => start(created, USERS.denis.userId, { last: h, rng: makeRng(1), now: T0 + 6 })), 'not-host');
  start(created, USERS.vlad.userId, { last: h, rng: makeRng(1), now: T0 + 6 });
  assert.ok(losers.includes(created.game.order[0]), 'первым ходит проигравший');
  // остальные по кругу за столом, начиная с проигравшего
  const ids = created.seats.map((x) => x.id);
  const k = ids.indexOf(created.game.order[0]);
  assert.deepEqual(created.game.order, [...ids.slice(k), ...ids.slice(0, k)]);
  const again = rematch(t, USERS.denis.userId, { code: 'OTHER1', rng: makeRng(2), now: T0 + 6 });
  assert.equal(again.code, 'NEXT01');
  assert.equal(again.created, null);
});

test('реванш доступен только после конца партии и только сидящим', () => {
  const t = started(13);
  assert.equal(code(() => rematch(t, USERS.denis.userId, { code: 'X', rng: makeRng(1), now: T0 })), 'not-over');
  playOut(t, 13);
  assert.equal(code(() => rematch(t, 'u-stranger', { code: 'X', rng: makeRng(1), now: T0 })), 'not-seated');
});
