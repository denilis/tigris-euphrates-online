// Общие помощники тестов стола (не тест: node --test запускает файл, тестов в нём нет).
import { makeRng } from '../game/vendor/engine/rng.js';
import { createTable, sit, start, submit, submitSeat, botDue, seatOfUser } from '../game/table.js';
import { stateFromJSON } from '../game/serialize.js';
import { legalMoves } from '../game/vendor/engine/engine.js';

export const USERS = {
  denis: { userId: 'u-denis', name: 'Денис' },
  andrey: { userId: 'u-andrey', name: 'Андрей' },
  vlad: { userId: 'u-vlad', name: 'Влад' },
};
export const T0 = 1_800_000_000_000;

/** Стол «Денис, Андрей, Влад и бот», ещё в лобби. Герои свои: кувшин, лук и лев, у бота бык. */
export function lobby(code = 'TEST01', options) {
  const t = createTable({ code, host: USERS.denis, now: T0 });
  if (options) Object.assign(t.options, options);
  sit(t, USERS.andrey, 1, T0);
  sit(t, USERS.vlad, 2, T0);
  return t;
}

/** Начатая партия с детерминированным добором. */
export function started(seed = 1, options) {
  const t = lobby('TEST01', options);
  start(t, USERS.denis.userId, { last: null, rng: makeRng(seed), now: T0 });
  return t;
}

/** Случайный легальный ход за того, кто решает (человек через submit, бот через submitSeat). */
export function randomStep(t, r, drawRng) {
  const s = stateFromJSON(t.game.state);
  const legal = legalMoves(s);
  const index = Math.floor(r() * legal.length);
  const seatId = t.game.order[s.toMove];
  const seat = t.seats.find((x) => x.id === seatId);
  if (seat.kind === 'bot') {
    assertTrue(botDue(t) === seatId, 'botDue должен назвать место бота');
    submitSeat(t, seatId, legal[index], { rng: drawRng, now: T0 });
  } else {
    submit(t, seat.userId, { version: t.version, index }, { rng: drawRng, now: T0 });
  }
}

/** Доиграть партию случайными ходами; onStep(t) вызывается перед каждым ходом. */
export function playOut(t, seed, onStep) {
  const r = makeRng(seed * 7919 + 1), draw = makeRng(seed * 104729 + 3);
  let steps = 0;
  while (t.status === 'playing') {
    if (onStep) onStep(t, steps);
    randomStep(t, r, draw);
    if (++steps > 6000) throw new Error('партия не закончилась');
  }
  return steps;
}

export { seatOfUser, makeRng };

function assertTrue(v, msg) {
  if (!v) throw new Error(msg);
}
