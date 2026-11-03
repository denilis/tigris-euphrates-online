// Пауза партии (просьба Дениса 03.11): не успели доиграть, расходимся; продолжаем, когда все
// люди за столом нажали «Я на месте». На паузе ходы, боты, окно отмены и часы стоят.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pause, ready, submit, submitSeat, botDue, confirmDue, canUndo, undo, close } from '../game/table.js';
import { viewFor } from '../game/view.js';
import { stateFromJSON } from '../game/serialize.js';
import { legalMoves } from '../game/vendor/engine/engine.js';
import { clockNow } from '../public/js/clock.js';
import { started, USERS, T0 } from './support.js';

const code = (fn) => {
  try { fn(); } catch (e) { return e.code; }
  return null;
};

/** Человек, который сейчас решает, и его userId. */
function decider(t) {
  const s = stateFromJSON(t.game.state);
  const seat = t.seats.find((x) => x.id === t.game.order[s.toMove]);
  return { s, seat };
}

test('пауза: любой сидящий ставит, ходы, боты и окно отмены стоят', () => {
  const t = started(41);
  const { seat } = decider(t);
  assert.equal(code(() => pause(t, 'чужой', T0 + 1000)), 'not-seated');
  pause(t, USERS.vlad.userId, T0 + 5000);
  assert.deepEqual(t.game.paused, { by: t.seats.find((s) => s.userId === USERS.vlad.userId).id, at: T0 + 5000, ready: [] });
  assert.equal(t.game.clock.at, T0 + 5000, 'время до паузы записано');
  if (seat.kind === 'human') assert.equal(code(() => submit(t, seat.userId, { version: t.version, index: 0 }, { now: T0 + 6000 })), 'paused');
  assert.equal(botDue(t), null, 'бот на паузе не ходит');
  assert.equal(canUndo(t), false);
  assert.equal(code(() => pause(t, USERS.denis.userId, T0 + 7000)), 'paused', 'второй раз не ставится');
});

test('пауза: продолжаем, только когда все люди на месте; ходящий получает полное время', () => {
  const t = started(42);
  t.game.clock.turnUsed = 20000;
  pause(t, USERS.denis.userId, T0 + 1000);
  ready(t, USERS.denis.userId, T0 + 60_000);
  ready(t, USERS.denis.userId, T0 + 61_000);
  assert.deepEqual(t.game.paused.ready.length, 1, 'повторное нажатие не считается дважды');
  ready(t, USERS.andrey.userId, T0 + 62_000);
  assert.ok(t.game.paused, 'Влада еще нет');
  ready(t, USERS.vlad.userId, T0 + 90_000);
  assert.equal(t.game.paused, null);
  assert.equal(t.game.clock.at, T0 + 90_000, 'часы пошли с момента продолжения');
  assert.equal(t.game.clock.turnUsed, 0);
  assert.equal(code(() => ready(t, USERS.vlad.userId, T0 + 91_000)), 'not-paused');
});

test('пауза в окне отмены: окно останавливается и после паузы открывается заново', () => {
  const t = started(43);
  // доводим ход человека до окна подтверждения
  for (let k = 0; k < 400 && t.game.confirmBy == null; k++) {
    const { s, seat } = decider(t);
    const legal = legalMoves(s);
    const i = Math.max(0, legal.findIndex((m) => m.type === 'tile'));
    if (seat.kind === 'bot') submitSeat(t, seat.id, legal[i], { now: T0 + k });
    else submit(t, seat.userId, { version: t.version, index: i }, { now: T0 + k });
  }
  assert.ok(t.game.confirmBy != null, 'дошли до окна отмены');
  const { seat } = decider(t);
  pause(t, seat.userId, T0 + 2000);
  assert.equal(t.game.confirmBy, null);
  assert.equal(confirmDue(t, T0 + 10 ** 9), false);
  assert.equal(code(() => undo(t, seat.userId, { version: t.version }, { now: T0 + 3000 })), 'paused');
  for (const u of Object.values(USERS)) ready(t, u.userId, T0 + 50_000);
  assert.equal(t.game.confirmBy, T0 + 50_000 + 10_000);
});

test('пауза: долгая пауза не делает стол брошенным, закрыть его может только хозяин', () => {
  const t = started(46);
  pause(t, USERS.andrey.userId, T0 + 1000);
  assert.equal(code(() => close(t, USERS.andrey.userId, T0 + 10 * 24 * 3600 * 1000)), 'not-host');
  close(t, USERS.denis.userId, T0 + 10 * 24 * 3600 * 1000);
  assert.equal(t.status, 'closed');
});

test('пауза на экране: часы стоят, таймер хода не уходит в минус', () => {
  const t = started(45);
  pause(t, USERS.denis.userId, T0 + 1000);
  const g = viewFor(t, USERS.denis.userId, { now: T0 + 1000 }).game;
  const k = clockNow(g, T0 + 10 ** 7);
  assert.equal(k.live, false);
  assert.ok(k.left > 0, 'за паузу время хода не тратится');
});

test('пауза в виде стола: кто поставил и кто на месте, решений нет', () => {
  const t = started(44);
  const { seat } = decider(t);
  pause(t, USERS.denis.userId, T0 + 1000);
  ready(t, USERS.andrey.userId, T0 + 2000);
  const v = viewFor(t, seat.kind === 'human' ? seat.userId : USERS.denis.userId, { now: T0 + 3000 });
  assert.equal(v.game.paused.by, t.seats.find((s) => s.userId === USERS.denis.userId).id);
  assert.deepEqual(v.game.paused.ready, [t.seats.find((s) => s.userId === USERS.andrey.userId).id]);
  assert.equal(v.game.legal, null);
  assert.equal(v.game.canUndo, false);
});
