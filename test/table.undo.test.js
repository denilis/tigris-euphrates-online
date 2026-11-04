// Отмена своего действия, окно подтверждения хода и учет времени (просьбы Дениса 29.10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submit, undo, canUndo, autoConfirm, confirmDue, TableError } from '../game/table.js';
import { stateFromJSON } from '../game/serialize.js';
import { viewFor } from '../game/view.js';
import { legalMoves, applyMove } from '../game/vendor/engine/engine.js';
import { warWaiting } from '../public/js/war.js';
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
  assert.equal(t.game.confirmBy, T0 + 12000);
  assert.equal(confirmDue(t, T0 + 11999), false);
  assert.equal(autoConfirm(t, { rng: makeRng(4), now: T0 + 11999 }), false);

  undo(t, who.userId, { version: t.version }, { now: T0 + 3000 });
  s = stateFromJSON(t.game.state);
  assert.equal(s.phase, 'action');
  assert.equal(s.actionNo, 2);
  assert.equal(t.game.confirmBy, null);

  submit(t, who.userId, { version: t.version, index: clean(t) }, { rng: makeRng(3), now: T0 + 4000 });
  assert.equal(t.game.confirmBy, T0 + 14000);
  const hand = s.players[cur].hand.reduce((a, b) => a + b, 0);
  assert.ok(autoConfirm(t, { rng: makeRng(4), now: T0 + 14000 }));
  s = stateFromJSON(t.game.state);
  assert.ok(s.over || s.cur !== cur, 'ход перешел');
  if (!s.over) assert.ok(s.players[cur].hand.reduce((a, b) => a + b, 0) > hand - 1, 'рука добрана после подтверждения');
  assert.equal(canUndo(t), false);
  assert.equal(t.game.confirmBy, null);
});

test('отмена не работает после срока окна подтверждения, до срока работает', () => {
  const t = humanTurn(3);
  const who = decider(t);
  submit(t, who.userId, { version: t.version, index: clean(t) }, { rng: makeRng(3), now: T0 + 1000 });
  submit(t, who.userId, { version: t.version, index: clean(t) }, { rng: makeRng(3), now: T0 + 2000 });
  assert.equal(t.game.confirmBy, T0 + 12000);
  const snap = JSON.stringify(t);
  assert.equal(code(() => undo(t, who.userId, { version: t.version }, { now: T0 + 12000 })), 'no-undo', 'срок вышел: ход завершится');
  assert.equal(code(() => undo(t, who.userId, { version: t.version }, { now: T0 + 3_600_000 })), 'no-undo', 'через час тем более');
  assert.equal(JSON.stringify(t), snap, 'отказ ничего не меняет');
  undo(t, who.userId, { version: t.version }, { now: T0 + 11999 });
  assert.equal(stateFromJSON(t.game.state).phase, 'action');
});

test('вид: «Отменить» пропадает, как только срок окна вышел', () => {
  const t = humanTurn(3);
  const who = decider(t);
  submit(t, who.userId, { version: t.version, index: clean(t) }, { rng: makeRng(3), now: T0 + 1000 });
  submit(t, who.userId, { version: t.version, index: clean(t) }, { rng: makeRng(3), now: T0 + 2000 });
  assert.equal(viewFor(t, who.userId, { now: T0 + 11999 }).game.canUndo, true);
  assert.equal(viewFor(t, who.userId, { now: T0 + 12000 }).game.canUndo, false, 'срок вышел: сервер откажет');
});

test('после решения не ходящего места (сокровище, война) откат невозможен: чужой выбор уже виден', () => {
  let offTurn = 0, treasure = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const t = started(seed);
    const r = makeRng(seed + 21), draw = makeRng(seed + 22);
    for (let k = 0; k < 1500 && t.status === 'playing'; k++) {
      const s = stateFromJSON(t.game.state);
      const other = s.toMove !== s.cur;
      const phase = s.phase;
      if (phase === 'treasure' && other) assert.equal(canUndo(t), false, 'сокровище выбирает другой, отменить нельзя');
      randomStep(t, r, draw);
      if (!other) continue;
      offTurn++;
      if (phase === 'treasure') treasure++;
      assert.equal(t.game.undo.length, 0, `seed ${seed}, шаг ${k}, фаза ${phase}: снимки отката остались`);
      assert.equal(canUndo(t), false);
    }
  }
  assert.ok(offTurn > 20, `решений не ходящего места было мало: ${offTurn}`);
  assert.ok(treasure > 0, 'среди них есть выбор сокровища');
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

/**
 * Нападения человека в разгаре партии: { t, who, before }, нападение уже сделано.
 * Ищем не с начала партии: в первых ходах на поле обычно только лидер бота.
 */
function* attacks() {
  for (let seed = 1; seed <= 60; seed++) {
    const t = started(seed);
    const r = makeRng(seed + 11), draw = makeRng(seed + 12);
    for (let k = 0; k < 900 && t.status === 'playing'; k++) {
      const s = stateFromJSON(t.game.state);
      if (s.phase === 'action' && s.actionNo === 1 && s.toMove === s.cur && decider(t).kind === 'human') {
        const i = findIndex(t, null, (a) => CONFLICT.includes(a.phase));
        if (i >= 0) {
          const who = decider(t);
          const before = structuredClone(t.game);
          submit(t, who.userId, { version: t.version, index: i }, { rng: makeRng(6), now: T0 + k });
          yield { t, who, before };
          break;
        }
      }
      randomStep(t, r, draw);
    }
  }
}

/** Довести бой до ответа соперника-человека; false, если у него ответа нет и бой решается сразу. */
function toWaiting({ t, who }, now = T0 + 2000) {
  const other = (id) => id !== who.id && t.seats.find((x) => x.id === id).kind === 'human';
  if (decider(t).id !== who.id) return other(decider(t).id);
  const i = findIndex(t, null, (a) => CONFLICT.includes(a.phase) && other(t.game.order[a.toMove]));
  if (i < 0) return false;
  submit(t, who.userId, { version: t.version, index: i }, { rng: makeRng(7), now });
  return true;
}

function waitingFight(skip = 0) {
  let left = skip;
  for (const a of attacks()) {
    if (toWaiting(a) && left-- === 0) return a;
  }
  return assert.fail('не нашлось ожидания ответа соперника');
}

const answer = (t, now = T0 + 3000) => {
  const who = decider(t);
  submit(t, who.userId, { version: t.version, index: 0 }, { rng: makeRng(8), now });
};

// Решение Дениса 04.11: если игрок напал, нападение уже не отменить (раньше было можно до ответа соперника)
test('нападение не отменяется: как только начался бой, снимков нет', () => {
  let found = 0;
  for (const { t, who } of attacks()) {
    assert.equal(t.game.undo.length, 0, 'снимки убраны');
    assert.equal(canUndo(t), false);
    assert.equal(code(() => undo(t, who.userId, { version: t.version }, { now: T0 + 500 })), 'no-undo');
    assert.equal(viewFor(t, who.userId, { now: T0 + 500 }).game.canUndo, false);
    if (++found === 4) break;
  }
  assert.equal(found, 4);
});

test('после своей поддержки нападение тоже не отменить', () => {
  for (const skip of [0, 1]) {
    const { t, who } = waitingFight(skip);
    assert.equal(viewFor(t, who.userId, { now: T0 + 1000 }).game.canUndo, false);
    assert.equal(code(() => undo(t, who.userId, { version: t.version }, { now: T0 + 2000 })), 'no-undo');
  }
});

test('соперник ответил: нападение больше не отменить', () => {
  const { t, who } = waitingFight();
  answer(t);
  assert.equal(t.game.undo.length, 0, 'снимки убраны');
  assert.equal(canUndo(t), false);
  assert.equal(code(() => undo(t, who.userId, { version: t.version }, { now: T0 + 3000 })), 'no-undo');
  assert.equal(viewFor(t, who.userId, { now: T0 + 3000 }).game.canUndo, false);
});

test('устаревшая отмена отклоняется: соперник ответил раньше', () => {
  const { t, who } = waitingFight();
  const seen = t.version;
  answer(t);
  assert.equal(code(() => undo(t, who.userId, { version: seen }, { now: T0 + 3000 })), 'stale');
});

test('воюют другие: панели боя у ходящего нет, отмены тоже (бой начался, 04.11)', () => {
  let found = 0;
  for (let seed = 1; seed <= 60 && !found; seed++) {
    const t = started(seed);
    const r = makeRng(seed + 11), draw = makeRng(seed + 12);
    for (let k = 0; k < 900 && t.status === 'playing' && !found; k++) {
      const s = stateFromJSON(t.game.state);
      if (s.phase === 'action' && s.toMove === s.cur && decider(t).kind === 'human') {
        const who = decider(t);
        const i = findIndex(t, null, (a) => {
          const fight = a.phase === 'warSupport' ? a.ctx.war : a.phase === 'revoltSupport' ? a.ctx.revolt : null;
          return fight && fight.att !== s.cur && fight.def !== s.cur;
        });
        if (i >= 0) {
          const before = structuredClone(t.game);
          submit(t, who.userId, { version: t.version, index: i }, { rng: makeRng(6), now: T0 + k });
          const v = viewFor(t, who.userId, { now: T0 + k });
          assert.equal(v.game.legal, null, 'решает не он');
          assert.equal(v.game.canUndo, false, 'бой начался: отмены нет');
          assert.equal(warWaiting(v), false);
          assert.notDeepEqual(t.game.state, before.state);
          found++;
          break;
        }
      }
      randomStep(t, r, draw);
    }
  }
  assert.equal(found, 1, 'не нашлось боя без ходящего');
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
  assert.equal(canUndo(t), false, 'ход перешел, отменять нечего');
  assert.equal(t.game.undo.length, 0);
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
  assert.ok(autoConfirm(t, { rng: makeRng(9), now: T0 + 57000 }));
  assert.equal(c.used[who.id], u0 + 42000, 'окно подтверждения не в счет');
  assert.equal(c.turnUsed, 0, 'у следующего хода свой отсчет');
  assert.equal(c.at, T0 + 57000);
});
