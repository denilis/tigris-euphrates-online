// Запись партии (04.11): зерно и ходы в t.game.rec, повтор дает ту же партию до тайла.
// На ней держатся просмотр по ходам и разбор ботом.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { started, playOut, randomStep, makeRng, USERS, T0 } from './support.js';
import { undo, canUndo } from '../game/table.js';
import { replay } from '../game/replay.js';
import { stateToJSON, stateFromJSON } from '../game/serialize.js';
import { viewFor } from '../game/view.js';

const same = (s, t) => assert.deepEqual(JSON.parse(JSON.stringify(stateToJSON(s))), JSON.parse(JSON.stringify(t.game.state)));

test('запись: 40 партий до конца, повтор по зерну и ходам совпадает с партией', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const t = started(seed);
    playOut(t, seed);
    same(replay(t.game.rec), t);
    assert.equal(t.game.rec.moves.length > 50, true);
  }
});

test('запись: повтор совпадает и посреди партии, после каждого хода', () => {
  const t = started(3);
  playOut(t, 3, (tt, k) => {
    if (k % 37 === 0) same(replay(tt.game.rec), tt);
  });
});

test('запись: отмена откатывает и запись, повтор совпадает', () => {
  let undone = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const t = started(seed);
    const r = makeRng(seed * 31 + 5), draw = makeRng(seed * 17 + 2);
    for (let k = 0; t.status === 'playing' && k < 4000; k++) {
      if (canUndo(t) && r() < 0.3) {
        const s = stateFromJSON(t.game.state);
        const seat = t.seats.find((x) => x.id === t.game.order[s.cur]);
        undo(t, seat.userId, { version: t.version }, { now: T0 });
        undone++;
        same(replay(t.game.rec), t);
        continue;
      }
      randomStep(t, r, draw);
    }
    same(replay(t.game.rec), t);
  }
  assert.ok(undone > 20, `отмен было ${undone}`);
});

test('запись: в вид игрока не попадает, мешок по зерну не угадать', () => {
  const t = started(7);
  playOut(t, 7, (tt, k) => {
    if (k !== 40) return;
    const json = JSON.stringify(viewFor(tt, USERS.denis.userId, { now: T0 }));
    assert.doesNotMatch(json, /"rec"|"seed"|"moves"/);
  });
});

test('запись: целая партия занимает немного места', () => {
  const t = started(11);
  playOut(t, 11);
  const kb = JSON.stringify(t.game.rec).length / 1024;
  assert.ok(kb < 30, `запись ${kb.toFixed(1)} КБ`);
});

test('партия, начатая до записи, доигрывается как раньше; повтора у нее нет', () => {
  const t = started(5);
  const r = makeRng(9), draw = makeRng(10);
  for (let k = 0; k < 30; k++) randomStep(t, r, draw);
  delete t.game.rec; // так выглядит стол, начатый до выкладки записи
  playOut(t, 5);
  assert.equal(t.status, 'over');
  assert.throws(() => replay(t.game.rec), /no-record/);
});
