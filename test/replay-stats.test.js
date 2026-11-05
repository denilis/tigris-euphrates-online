// Аналитика просмотра партии (просьба Дениса 05.11): бои на момент кадра и монументы под контролем
// сходятся с журналом и с очками, которые движок дал за монументы в конце хода.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { started, playOut } from './support.js';
import { replayFrames } from '../game/frames.js';
import { stateFromJSON } from '../game/serialize.js';
import { framesBoards, battlesAt, monumentHolds, wonderHolder } from '../public/js/replay-core.js';
import { matchStats } from '../public/js/matchstats.js';

const W = 16;
const empty = () => ({ tile: new Array(176).fill(-1), leader: new Array(176).fill(-1), treasure: new Array(176).fill(0), building: new Array(176).fill(-1), monument: new Array(176).fill(-1) });

test('бои: в начале нули, к концу как статистика партии, счетчики не убывают', () => {
  for (const seed of [3, 5, 7]) {
    const t = started(seed);
    playOut(t, seed);
    const data = replayFrames(t), order = t.game.order, N = data.frames.length;
    const zero = battlesAt(data.frames, 0, order);
    for (const id of order) assert.ok(Object.values(zero[id]).every((v) => v === 0));
    assert.deepEqual(battlesAt(data.frames, N, order), matchStats(t.game.log.filter((e) => e.ev !== 'undo'), order), `партия ${seed}`);
    let prev = zero;
    for (let k = 1; k <= N; k += 7) {
      const cur = battlesAt(data.frames, k, order);
      for (const id of order) for (const key of Object.keys(cur[id])) assert.ok(cur[id][key] >= prev[id][key], `партия ${seed}, кадр ${k}, ${key}`);
      prev = cur;
    }
  }
});

test('монументы: половина у лидера своего цвета в том же царстве, вне царства ничья', () => {
  const b = empty();
  // монумент красно-синий на клетках 0,1,16,17 (A1..B2), рядом храм и жрец игрока 1
  for (const i of [0, 1, W, W + 1]) { b.tile[i] = 4; b.monument[i] = 0; }
  b.tile[2] = 0;
  b.leader[3] = (1 << 2) | 0; // жрец игрока 1
  // второй монумент зелено-черный в стороне, без лидеров рядом
  for (const i of [100, 101, 116, 117]) { b.tile[i] = 4; b.monument[i] = 5; }
  const mons = [{ c1: 0, c2: 1, pos: 0 }, { c1: 2, c2: 3, pos: 100 }, { c1: 0, c2: 2, pos: -1 }];
  const r = monumentHolds(b, mons, 2);
  assert.deepEqual(r.own, [[0, 0, 0, 0], [1, 0, 0, 0]]);
  assert.deepEqual(r.list, [{ c1: 0, c2: 1, h1: 1, h2: null }, { c1: 2, c2: 3, h1: null, h2: null }]);
  assert.equal(wonderHolder(b, -1), undefined);
});

test('монументы: на каждом конце хода совпадают с очками движка за монументы', () => {
  let checked = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const t = started(seed);
    playOut(t, seed);
    const data = JSON.parse(JSON.stringify(replayFrames(t)));
    const s = stateFromJSON(t.game.state);
    const order = t.game.order, defs = s.monuments.map(({ c1, c2 }) => ({ c1, c2 }));
    const boards = framesBoards(data);
    data.frames.forEach((f, j) => {
      const got = [0, 0, 0, 0];
      for (const e of f.entries) if (e.ev === 'score' && e.why === 'monument' && e.seat === f.actor) got[e.c] += e.n;
      if (f.action !== 2 || f.entries.some((e) => e.ev === 'gameOver')) return;
      const b = boards[j + 1];
      const r = monumentHolds(b.board, defs.map((m, i) => ({ ...m, pos: b.mons[i] })), order.length);
      assert.deepEqual(r.own[order.indexOf(f.actor)], got, `партия ${seed}, кадр ${j + 1}`);
      if (got.some((n) => n)) checked++;
    });
  }
  assert.ok(checked >= 5, `сверено концов хода с очками за монументы: ${checked}`);
});
