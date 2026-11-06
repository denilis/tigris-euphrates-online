// Застой (06.11): партии ботов, которые не кончаются. Правило движка cfg.stallTurns включено
// на сайте, стол из одних ботов со слишком длинной партией закрывает предохранитель.
// Разбор причины: specs/2026-11-06-застой-партий-ботов.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { botStep } from '../game/bots.js';
import {
  createTable, leave, setSeatKind, setBot, start, botDue, STALL_TURNS, BOT_TABLE_TURN_LIMIT, stopRunaway,
} from '../game/table.js';
import { stateFromJSON, stateToJSON } from '../game/serialize.js';
import { viewFor } from '../game/view.js';
import { createGame, applyMove, ranking } from '../game/vendor/engine/engine.js';
import { BOARDS } from '../game/vendor/engine/boards.js';
import { makeRng as engineRng } from '../game/vendor/engine/rng.js';
import { endReasonText, stopText } from '../public/js/end.js';
import { RULES } from '../public/js/rules-text.js';
import { USERS, T0, started, makeRng } from './support.js';

const LOOP = JSON.parse(readFileSync(new URL('./fixtures/stall-min-sure-50001.json', import.meta.url), 'utf8'));

/** Повторить записанную петлю с порогом застоя stallTurns (0 = без правила). */
function replayLoop(stallTurns) {
  const rng = engineRng(LOOP.seed);
  const s = createGame({ layout: BOARDS[LOOP.board], numPlayers: LOOP.np, cfg: { ...LOOP.cfg, stallTurns } }, rng);
  let applied = 0;
  for (const m of LOOP.moves) {
    if (s.over) break;
    applyMove(s, m, rng);
    applied++;
  }
  return { s, applied };
}

test('петля min-sure 50001: без правила партия не кончается', () => {
  const { s, applied } = replayLoop(0);
  assert.equal(applied, LOOP.moves.length);
  assert.equal(s.over, false);
  assert.ok(s.turn > 78, `ход ${s.turn}`);
  assert.equal(s.bag.reduce((a, b) => a + b, 0), 0, 'мешок пуст');
});

test('петля min-sure 50001: правило «застой» кончает ее на 77-м ходу', () => {
  const { s, applied } = replayLoop(STALL_TURNS);
  assert.equal(s.over, true);
  assert.equal(s.endReason, 'stall');
  assert.equal(s.turn, 77, '12-й ход подряд без движения');
  assert.equal(applied, 190);
  assert.deepEqual(ranking(s), [0, 1], 'первым настоящий лидер по счету');
});

/** Стол из n ботов: хозяин встает с места и смотрит. */
function botTable(seed, n = 2) {
  const t = createTable({ code: 'STALL1', host: USERS.denis, now: T0 });
  leave(t, USERS.denis.userId, T0);
  for (const seat of t.seats) if (seat.kind !== 'bot') setSeatKind(t, USERS.denis.userId, seat.id, 'bot', T0);
  for (const seat of t.seats) setBot(t, USERS.denis.userId, seat.id, { strength: 0, errors: 0 }, T0);
  t.seats = t.seats.slice(0, n);
  start(t, USERS.denis.userId, { last: null, rng: makeRng(seed), now: T0 });
  return t;
}

const setTurn = (t, turn) => {
  const s = stateFromJSON(t.game.state);
  s.turn = turn;
  t.game.state = stateToJSON(s);
};

test('сайт включает застой в новой партии и пишет его в запись', () => {
  const t = botTable(3);
  assert.equal(stateFromJSON(t.game.state).cfg.stallTurns, STALL_TURNS);
  assert.equal(t.game.rec.cfg.stallTurns, STALL_TURNS, 'просмотр и разбор идут по тем же правилам');
});

test('предохранитель: стол из ботов за пределом ходов закрывается без итога', async () => {
  const t = botTable(4);
  setTurn(t, BOT_TABLE_TURN_LIMIT);
  const r1 = await botStep(t, { rng: makeRng(1), botRng: makeRng(2), now: T0, timeCap: 30 });
  assert.ok(r1.move, 'на пределе бот еще ходит');
  setTurn(t, BOT_TABLE_TURN_LIMIT + 1);
  const version = t.version;
  const r2 = await botStep(t, { rng: makeRng(1), botRng: makeRng(2), now: T0 + 1, timeCap: 30 });
  assert.equal(r2.stopped, 'long');
  assert.equal(t.status, 'closed');
  assert.equal(t.game.result, null);
  assert.equal(t.version, version + 1);
  assert.equal(botDue(t), null, 'больше никто не ходит');
  const v = viewFor(t, USERS.denis.userId, { now: T0 + 1 });
  assert.equal(v.game.stopped, true);
  assert.equal(v.game.stopReason, 'long');
});

test('предохранитель: стол с человеком не трогает', () => {
  const t = started(5);
  setTurn(t, BOT_TABLE_TURN_LIMIT + 50);
  assert.equal(stopRunaway(t, T0), false);
  assert.equal(t.status, 'playing');
});

test('тексты: причина конца, остановка и правила совпадают с порогами', () => {
  assert.ok(endReasonText('stall').startsWith(`${STALL_TURNS} ходов подряд`));
  assert.equal(endReasonText('bag'), 'В мешке кончились тайлы.');
  assert.equal(endReasonText('treasures'), 'На поле осталось два сокровища.');
  assert.ok(stopText({ stopReason: 'long' }).includes(`${BOT_TABLE_TURN_LIMIT} ходов`));
  assert.ok(stopText({}).startsWith('Организатор'));
  const end = RULES.find((r) => r.id === 'end').body.join(' ');
  assert.ok(end.includes(`${STALL_TURNS} ходов подряд`));
});
