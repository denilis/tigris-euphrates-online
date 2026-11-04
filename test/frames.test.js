// Просмотр партии по ходам (этап 3 пакета 04.11): кадры из записи партии сходятся с настоящей
// партией, клиент собирает те же поля, в кадрах нет рук и мешка, адрес отдает только законченное.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { started, playOut, randomStep, makeRng, USERS, T0 } from './support.js';
import { undo, canUndo } from '../game/table.js';
import { replayFrames, frameAt, FIELDS } from '../game/frames.js';
import { stateFromJSON } from '../game/serialize.js';
import { viewFor } from '../game/view.js';
import { framesBoards, timelineMarks } from '../public/js/replay-core.js';
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';

const ENV = { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' };

/** Партия до конца со случайными отменами хода. */
function playWithUndos(seed) {
  const t = started(seed);
  const r = makeRng(seed * 13 + 1), draw = makeRng(seed * 29 + 7);
  let undone = 0;
  for (let k = 0; t.status === 'playing' && k < 6000; k++) {
    if (canUndo(t) && r() < 0.25) {
      const s = stateFromJSON(t.game.state);
      undo(t, t.seats.find((x) => x.id === t.game.order[s.cur]).userId, { version: t.version }, { now: T0 });
      undone++;
      continue;
    }
    randomStep(t, r, draw);
  }
  return { t, undone };
}

test('кадры: последний кадр равен итоговому полю, журнал кадров равен журналу стола без отмен', () => {
  let undone = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const { t, undone: u } = playWithUndos(seed);
    undone += u;
    const data = replayFrames(t);
    const s = stateFromJSON(t.game.state);
    const last = frameAt(data, data.frames.length);
    for (const f of FIELDS) assert.deepEqual(last.board[f], Array.from(s[f]), `партия ${seed}: ${f}`);
    assert.deepEqual(last.mons, s.monuments.map((m) => m.pos));
    assert.equal(last.wonder, s.wonderPos);
    assert.deepEqual(last.scores, s.players.map((pl) => [...pl.score, pl.treasures]));
    assert.deepEqual(data.frames.flatMap((f) => f.entries), t.game.log.filter((e) => e.ev !== 'undo'), `партия ${seed}: журнал`);
    for (const f of data.frames) {
      assert.ok(f.action === 1 || f.action === 2);
      assert.ok(f.entries.every((e) => e.turn === f.turn && e.actor === f.actor), `партия ${seed}: записи кадра от одного действия`);
    }
  }
  assert.ok(undone > 15, `отмен было ${undone}`);
});

test('кадры: клиент собирает те же поля, что сервер, на каждом кадре', () => {
  const t = started(7);
  playOut(t, 7);
  const data = JSON.parse(JSON.stringify(replayFrames(t))); // как придет по сети
  const boards = framesBoards(data);
  assert.equal(boards.length, data.frames.length + 1);
  for (let k = 0; k <= data.frames.length; k += 1) assert.deepEqual(boards[k], frameAt(data, k), `кадр ${k}`);
});

test('кадры: в записи просмотра нет рук, мешка и зерна', () => {
  const t = started(8);
  playOut(t, 8);
  const json = JSON.stringify(replayFrames(t));
  assert.doesNotMatch(json, /"(hand|bag|seed|moves|discarded|rng)":/); // ключи, а не слова: "reason":"bag" допустимо
});

test('шкала: отметки боев и монументов на своих кадрах', () => {
  const frames = [{ entries: [{ ev: 'tile' }] }, { entries: [{ ev: 'war' }] }, { entries: [{ ev: 'monument' }, { ev: 'revolt' }] }];
  assert.deepEqual(timelineMarks(frames), [{ k: 2, kind: 'war' }, { k: 3, kind: 'war' }, { k: 3, kind: 'mon' }]);
});

test('вид стола: просмотр есть только у законченной партии с записью', () => {
  const t = started(9);
  assert.equal(viewFor(t, USERS.denis.userId).game.replay, false, 'партия идет');
  playOut(t, 9);
  assert.equal(viewFor(t, USERS.denis.userId).game.replay, true);
  delete t.game.rec;
  assert.equal(viewFor(t, USERS.denis.userId).game.replay, false, 'партия начата до записи');
});

test('API: просмотр после входа, 409 для идущей партии, 404 без записи, 200 с кадрами', async () => {
  const store = memoryStore();
  const app = createApp({ store, env: ENV, now: () => T0, botOptions: { timeCap: 20 } });
  const playing = { ...started(10), code: 'PLAY01' };
  const over = { ...started(11), code: 'OVER01' };
  playOut(over, 11);
  const old = { ...started(12), code: 'OLDG01' };
  playOut(old, 12);
  delete old.game.rec;
  for (const t of [playing, over, old]) assert.ok(await store.putTable(t, null));
  assert.equal((await app.call({ method: 'GET', path: 'tables/OVER01/replay' })).status, 401);
  const { token } = (await app.call({ method: 'POST', path: 'activate', body: { code: 'ADMN-TEST-2345' } })).body;
  const get = (code) => app.call({ method: 'GET', path: `tables/${code}/replay`, token });
  assert.equal((await get('PLAY01')).status, 409);
  assert.equal((await get('OLDG01')).status, 404);
  const r = await get('OVER01');
  assert.equal(r.status, 200);
  assert.equal(r.body.code, 'OVER01');
  assert.ok(r.body.frames.length > 50);
  assert.equal(r.body.monDefs.length, 6);
  assert.deepEqual(r.body.order, over.game.order);
  assert.ok(Array.isArray(r.body.river) && r.body.river.length > 20);
  assert.doesNotMatch(JSON.stringify(r.body), /"(hand|bag|seed|moves|discarded|rng)":/);
});
