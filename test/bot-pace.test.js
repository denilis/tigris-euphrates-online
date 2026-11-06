// Бот «думает» (просьба Дениса 06.11): ход решается сразу, а показывается через 2,5-5 с от
// момента, когда очередь дошла до бота. Первое действие не позже 5 с, второе не позже 10 с.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botStep } from '../game/bots.js';
import { createTable, leave, setSeatKind, setBot, start } from '../game/table.js';
import { USERS, T0, makeRng } from './support.js';

const PACE = { min: 2500, max: 5000 };

function botTable(seed) {
  const t = createTable({ code: 'PACE01', host: USERS.denis, now: T0 });
  leave(t, USERS.denis.userId, T0);
  for (const seat of t.seats) if (seat.kind !== 'bot') setSeatKind(t, USERS.denis.userId, seat.id, 'bot', T0);
  for (const seat of t.seats) setBot(t, USERS.denis.userId, seat.id, { strength: 0, errors: 0 }, T0);
  start(t, USERS.denis.userId, { last: null, rng: makeRng(seed), now: T0 });
  return t;
}

test('бот думает: решает сразу, ход показывает через 2,5-5 с, до срока стол не меняется', async () => {
  const t = botTable(3);
  const opts = (now) => ({ rng: makeRng(1), botRng: makeRng(2), now, timeCap: 30, pace: PACE });
  const turnStart = t.updatedAt;
  const seat = t.game.toMove;

  const r1 = await botStep(t, opts(turnStart));
  assert.equal(r1.waiting, true);
  assert.equal(r1.planned, true);
  assert.ok(r1.at >= turnStart + PACE.min && r1.at <= turnStart + PACE.max, 'первое действие не позже 5 с');
  const logLen = t.game.log.length, before = JSON.stringify(t);

  const r2 = await botStep(t, opts(r1.at - 1));
  assert.deepEqual(r2, { seatId: seat, waiting: true, at: r1.at }, 'еще думает');
  assert.equal(JSON.stringify(t), before, 'до срока ничего не меняется');

  const r3 = await botStep(t, opts(r1.at));
  assert.ok(r3.move && !r3.waiting, 'срок вышел: ход сделан');
  assert.ok(t.game.log.length > logLen);
  assert.equal(t.game.botPlan, undefined);
  assert.equal(t.updatedAt, r1.at);

  // второе действие того же хода: снова пауза, от начала хода не дольше 10 с
  assert.equal(t.game.toMove, seat);
  const r4 = await botStep(t, opts(r1.at));
  assert.equal(r4.planned, true);
  assert.ok(r4.at - turnStart <= 2 * PACE.max, 'второе действие не позже 10 с от начала хода');
  assert.ok(r4.at - r1.at >= PACE.min);
});

test('бот думает: партия ботов с паузами идет без запасных ходов', async () => {
  const t = botTable(4);
  const draw = makeRng(5), brain = makeRng(6);
  let now = t.updatedAt, moves = 0;
  for (let k = 0; k < 200 && t.status === 'playing'; k++) {
    const r = await botStep(t, { rng: draw, botRng: brain, now, timeCap: 30, pace: PACE });
    if (r.waiting) { now = r.at; continue; }
    assert.equal(r.fallback, false, r.error);
    moves++;
  }
  assert.ok(moves >= 60, `ходов ${moves}`);
});

test('без паузы бот ходит сразу, как раньше (тесты и BOT_PACE=off)', async () => {
  const t = botTable(5);
  const r = await botStep(t, { rng: makeRng(1), botRng: makeRng(2), now: T0, timeCap: 30 });
  assert.ok(r.move && !r.waiting);
  assert.equal(t.game.botPlan, undefined);
});

test('бот думал дольше паузы: ход сразу, без лишнего ожидания следующего опроса', async () => {
  const t = botTable(6);
  let clockNow = t.updatedAt;
  const slow = async (view, settings, rng, yieldFn) => {
    clockNow += 9000; // «раздумья» дольше любой паузы
    const { decideAsync } = await import('../game/vendor/bot/bot.js');
    return decideAsync(view, { ...settings, timeMs: 20 }, rng, yieldFn);
  };
  const r = await botStep(t, { rng: makeRng(1), botRng: makeRng(2), now: t.updatedAt, timeCap: 30, pace: PACE, decide: slow, clock: () => clockNow });
  assert.ok(r.move && !r.waiting, 'срок уже вышел, пока бот думал');
  assert.equal(t.game.botPlan, undefined);
});
