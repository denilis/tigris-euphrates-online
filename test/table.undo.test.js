// Отмена своего действия, окно подтверждения хода и учет времени (просьбы Дениса 29.10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submit, undo, canUndo, autoConfirm, confirmDue, TableError } from '../game/table.js';
import { stateFromJSON } from '../game/serialize.js';
import { legalMoves, applyMove } from '../game/vendor/engine/engine.js';
import { T0, started, randomStep, makeRng } from './support.js';

const CONFLICT = ['warChoose', 'warSupport', 'revoltSupport'];
const decider = (t) => {
  const s = stateFromJSON(t.game.state);
  return t.seats.find((x) => x.id === t.game.order[s.toMove]);
};
const code = (fn) => {
  try { fn(); } catch (e) { assert.ok(e instanceof TableError, String(e.stack || e)); return e.code; }
  assert.fail('ожидался отказ');
};

/** Начало хода человека: первое действие, решает сам ходящий. */
function humanTurn(seed, options) {
  const t = started(seed, options);
  const r = makeRng(seed + 11), draw = makeRng(seed + 12);
  for (let k = 0; k < 600; k++) {
    const s = stateFromJSON(t.game.state);
    if (s.phase === 'action' && s.actionNo === 1 && s.toMove === s.cur && decider(t).kind === 'human') return t;
    randomStep(t, r, draw);
  }
  throw new Error('не дошли до хода человека');
}

/** Номер хода, после которого want(состояние после, состояние до); пробуем на копии движка. */
function findIndex(t, type, want) {
  const s = stateFromJSON(t.game.state);
  const legal = legalMoves(s);
  for (let i = 0; i < legal.length; i++) {
    if (type && legal[i].type !== type) continue;
    const a = stateFromJSON(t.game.state);
    applyMove(a, legal[i], makeRng(1));
    if (want(a, s)) return i;
  }
  return -1;
}
// после хода снова выбор действия или окно подтверждения того же хода (без войны и решений)
const clean = (t) => findIndex(t, 'tile', (a, b) => ['action', 'confirm'].includes(a.phase) && a.cur === b.cur);
// второе действие без окна подтверждения: ход сразу переходит
const passes = (t) => findIndex(t, 'tile', (a, b) => a.over || (a.cur !== b.cur && !CONFLICT.includes(a.phase)));

test('отмена действия: поле, рука и журнал как до него', () => {
  const t = humanTurn(1);
  const who = decider(t);
  const before = structuredClone(t.game);
  submit(t, who.userId, { version: t.version, index: clean(t) }, { rng: makeRng(2), now: T0 + 5000 });
  assert.ok(canUndo(t));
  const v = t.version;
  undo(t, who.userId, { version: v }, { now: T0 + 6000 });
  assert.equal(t.version, v + 1);
  assert.deepEqual(t.game.state, before.state);
  assert.deepEqual(t.game.log.slice(0, before.log.length), before.log);
  assert.equal(t.game.log.length, before.log.length + 1);
  assert.deepEqual(t.game.log.at(-1), { ev: 'undo', turn: before.state.turn, actor: who.id, action: 1 });
  assert.equal(t.game.logEpoch, before.logEpoch + 1);
  assert.equal(t.game.toMove, who.id);
  assert.equal(canUndo(t), false, 'больше отменять нечего');
});

test('отмена: чужая, устаревшая и пустая отклоняются, стол не меняется', () => {
  const t = humanTurn(2);
  const who = decider(t);
  assert.equal(code(() => undo(t, who.userId, { version: t.version }, { now: T0 })), 'no-undo', 'в начале хода нечего');
  submit(t, who.userId, { version: t.version, index: clean(t) }, { rng: makeRng(2), now: T0 });
  const other = t.seats.find((x) => x.kind === 'human' && x.id !== who.id);
  const snap = JSON.stringify(t);
  assert.equal(code(() => undo(t, other.userId, { version: t.version }, { now: T0 })), 'no-undo');
  assert.equal(code(() => undo(t, who.userId, { version: t.version - 1 }, { now: T0 })), 'stale');
  assert.equal(code(() => undo(t, 'u-stranger', { version: t.version }, { now: T0 })), 'not-seated');
  assert.equal(JSON.stringify(t), snap);
});

test('окно подтверждения: ход ждет, в окне можно отменить, по сроку завершается сам', () => {
  const t = humanTurn(3);
  const who = decider(t);
  const cur = stateFromJSON(t.game.state).cur;
  submit(t, who.userId, { version: t.version, index: clean(t) }, { rng: makeRng(3), now: T0 + 1000 });
  const i2 = clean(t);
  assert.ok(i2 >= 0);
  submit(t, who.userId, { version: t.version, index: i2 }, { rng: makeRng(3), now: T0 + 2000 });
  let s = stateFromJSON(t.game.state);
  assert.equal(s.phase, 'confirm');
  assert.equal(t.game.toMove, who.id);
  assert.equal(t.game.confirmBy, T0 + 22000);
  assert.equal(confirmDue(t, T0 + 21999), false);
  assert.equal(autoConfirm(t, { rng: makeRng(4), now: T0 + 21999 }), false);

  undo(t, who.userId, { version: t.version }, { now: T0 + 3000 });
  s = stateFromJSON(t.game.state);
  assert.equal(s.phase, 'action');
  assert.equal(s.actionNo, 2);
  assert.equal(t.game.confirmBy, null);

  submit(t, who.userId, { version: t.version, index: clean(t) }, { rng: makeRng(3), now: T0 + 4000 });
  assert.equal(t.game.confirmBy, T0 + 24000);
  const hand = s.players[cur].hand.reduce((a, b) => a + b, 0);
  assert.ok(autoConfirm(t, { rng: makeRng(4), now: T0 + 24000 }));
  s = stateFromJSON(t.game.state);
  assert.ok(s.over || s.cur !== cur, 'ход перешел');
  if (!s.over) assert.ok(s.players[cur].hand.reduce((a, b) => a + b, 0) > hand - 1, 'рука добрана после подтверждения');
  assert.equal(canUndo(t), false);
  assert.equal(t.game.confirmBy, null);
});

test('сброс тайлов не отменяется, и после него ход проходит без окна', () => {
  const t = humanTurn(4);
  const who = decider(t);
  const cur = stateFromJSON(t.game.state).cur;
  submit(t, who.userId, { version: t.version, index: clean(t) }, { rng: makeRng(5), now: T0 });
  const legal = legalMoves(stateFromJSON(t.game.state));
  const d = legal.findIndex((m) => m.type === 'discard');
  assert.ok(d >= 0, 'сброс доступен');
  submit(t, who.userId, { version: t.version, index: d }, { rng: makeRng(5), now: T0 });
  const s = stateFromJSON(t.game.state);
  assert.notEqual(s.phase, 'confirm');
  assert.ok(s.over || s.cur !== cur);
  assert.equal(t.game.undo.length, 0);
  assert.equal(canUndo(t), false);
});

test('нападение (война или восстание) не отменяется', () => {
  let found = 0;
  for (let seed = 1; seed <= 40 && found < 3; seed++) {
    const t = humanTurn(seed);
    const i = findIndex(t, null, (a) => CONFLICT.includes(a.phase));
    if (i < 0) continue;
    const who = decider(t);
    submit(t, who.userId, { version: t.version, index: i }, { rng: makeRng(6), now: T0 });
    assert.equal(t.game.undo.length, 0);
    assert.equal(canUndo(t), false);
    assert.equal(code(() => undo(t, who.userId, { version: t.version }, { now: T0 })), 'no-undo');
    found++;
  }
  assert.ok(found >= 1, 'нашлась позиция с нападением');
});

test('без окна подтверждения ход проходит сразу, отмена первого действия работает', () => {
  const t = humanTurn(5, { confirmSeconds: 0 });
  const who = decider(t);
  const cur = stateFromJSON(t.game.state).cur;
  submit(t, who.userId, { version: t.version, index: clean(t) }, { rng: makeRng(7), now: T0 });
  undo(t, who.userId, { version: t.version }, { now: T0 });
  submit(t, who.userId, { version: t.version, index: clean(t) }, { rng: makeRng(7), now: T0 });
  assert.ok(canUndo(t), 'первое действие можно отменить и без окна');
  submit(t, who.userId, { version: t.version, index: passes(t) }, { rng: makeRng(7), now: T0 });
  const s = stateFromJSON(t.game.state);
  assert.ok(s.over || s.cur !== cur);
  assert.equal(t.game.confirmBy, null);
});

test('время: копится по местам, сверх времени хода отдельно, окно подтверждения не считается', () => {
  const t = humanTurn(6, { turnSeconds: 30 });
  const who = decider(t);
  const c = t.game.clock;
  assert.equal(c.at, T0);
  const u0 = c.used[who.id] || 0, o0 = c.over[who.id] || 0;
  submit(t, who.userId, { version: t.version, index: clean(t) }, { rng: makeRng(8), now: T0 + 25000 });
  assert.equal(c.turnUsed, 25000);
  submit(t, who.userId, { version: t.version, index: clean(t) }, { rng: makeRng(8), now: T0 + 40000 });
  assert.equal(stateFromJSON(t.game.state).phase, 'confirm');
  undo(t, who.userId, { version: t.version }, { now: T0 + 45000 }); // 5 с окна не в счет
  submit(t, who.userId, { version: t.version, index: clean(t) }, { rng: makeRng(8), now: T0 + 47000 });
  assert.equal(c.used[who.id], u0 + 42000);
  assert.equal(c.over[who.id], o0 + 12000);
  assert.ok(autoConfirm(t, { rng: makeRng(9), now: T0 + 67000 }));
  assert.equal(c.used[who.id], u0 + 42000, 'окно подтверждения не в счет');
  assert.equal(c.turnUsed, 0, 'у следующего хода свой отсчет');
  assert.equal(c.at, T0 + 67000);
});
