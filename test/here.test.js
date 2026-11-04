// Лобби (просьба Дениса 04.11): видно, кто из приглашенных открыл стол; начинает только хозяин
// стола и только когда все люди на месте; реванш собирается в лобби.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';
import { redisStore } from '../server/store-redis.js';
import { fakeUpstash } from './fake-upstash.js';

const ENV = { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' };

function setup(store) {
  const clock = { t: 1_800_000_000_000 };
  const app = createApp({ store, env: ENV, now: () => clock.t, botOptions: { timeCap: 20 } });
  const req = (method, path, { body, token, query } = {}) => app.call({ method, path, body, token, query });
  return { req, clock, store };
}

async function three(s) {
  const denis = (await s.req('POST', 'activate', { body: { code: 'ADMN-TEST-2345' } })).body;
  const mk = async (name) => {
    const r = await s.req('POST', 'admin/users', { body: { name }, token: denis.token });
    return (await s.req('POST', 'activate', { body: { code: r.body.code } })).body;
  };
  return { denis, andrey: await mk('Андрей'), vlad: await mk('Влад') };
}

async function lobbyOf(s, P) {
  const { code } = (await s.req('POST', 'tables', { token: P.denis.token })).body;
  const post = (who, body) => s.req('POST', `tables/${code}`, { body, token: who.token });
  await post(P.denis, { action: 'seatCount', n: 3 });
  await post(P.andrey, { action: 'sit', seat: 1 });
  await post(P.vlad, { action: 'sit', seat: 2 });
  const poll = (who, here = true) => s.req('GET', `tables/${code}/poll`, { token: who.token, query: here ? { here: '1' } : {} });
  return { code, post, poll };
}

for (const [name, make] of [['память', () => memoryStore()], ['Upstash', () => redisStore({ exec: fakeUpstash().exec, prefix: 'h:' })]]) {
  test(`${name}: опрос лобби отмечает «на месте» и говорит, кто за столом`, async () => {
    const s = setup(make());
    const P = await three(s);
    const L = await lobbyOf(s, P);
    assert.deepEqual((await L.poll(P.denis)).body.here, [0], 'хозяин сидит на месте 0');
    assert.deepEqual((await L.poll(P.andrey)).body.here, [0, 1]);
    assert.deepEqual((await L.poll(P.vlad)).body.here, [0, 1, 2]);
    assert.equal((await L.poll(P.andrey, false)).body.here, undefined, 'без here=1 опрос как раньше');
    s.clock.t += 21_000;
    assert.deepEqual((await L.poll(P.vlad)).body.here, [2], 'Денис и Андрей ушли: отметки старше 20 с');
  });

  test(`${name}: начинает только хозяин и только когда все люди на месте`, async () => {
    const s = setup(make());
    const P = await three(s);
    const L = await lobbyOf(s, P);
    await L.post(P.denis, { action: 'hero', seat: 0, hero: 'lion' });
    await L.post(P.andrey, { action: 'hero', seat: 1, hero: 'bull' });
    await L.post(P.vlad, { action: 'hero', seat: 2, hero: 'bow' });
    await L.poll(P.andrey);
    const early = await L.post(P.denis, { action: 'start' });
    assert.equal(early.status, 409);
    assert.match(early.body.message, /Ждем за столом: Влад/);
    assert.equal((await L.post(P.andrey, { action: 'start' })).status, 403, 'сидящий, но не хозяин');
    await L.poll(P.vlad);
    const ok = await L.post(P.denis, { action: 'start' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.status, 'playing');
    assert.equal((await L.poll(P.vlad)).body.here, undefined, 'партия идет: в опросе лобби больше нет');
  });
}

test('отметка пишется не чаще раза в 8 с, а читается при каждом опросе', async () => {
  const base = memoryStore();
  let writes = 0;
  const store = { ...base, async touchHere(...a) { writes++; return base.touchHere(...a); } };
  const s = setup(store);
  const P = await three(s);
  const L = await lobbyOf(s, P);
  for (let i = 0; i < 5; i++) {
    await L.poll(P.andrey);
    s.clock.t += 1500;
  }
  assert.equal(writes, 1, 'пять опросов за 6 с: одна запись');
  s.clock.t += 3000;
  await L.poll(P.andrey);
  assert.equal(writes, 2);
});

test('реванш собирается в лобби: хозяин тот, кто позвал, начинают, когда все на месте', async () => {
  const s = setup(memoryStore());
  const P = await three(s);
  const L = await lobbyOf(s, P);
  await L.post(P.denis, { action: 'hero', seat: 0, hero: 'lion' });
  await L.post(P.andrey, { action: 'hero', seat: 1, hero: 'bull' });
  await L.post(P.vlad, { action: 'hero', seat: 2, hero: 'bow' });
  await L.poll(P.andrey);
  await L.poll(P.vlad);
  assert.equal((await L.post(P.denis, { action: 'start' })).status, 200);
  // доиграть быстро нельзя: закончим партию напрямую в хранилище
  const cur = await s.store.getTable(L.code);
  cur.doc.status = 'over';
  cur.doc.game.historySaved = true;
  cur.doc.game.result = { finishedAt: s.clock.t, endReason: 'treasures', seats: cur.doc.seats.map((x, i) => ({ seatId: x.id, place: i + 1, vector: [1, 1, 1, 1], score: [1, 1, 1, 1], treasures: 0 })) };
  cur.doc.version += 1;
  assert.ok(await s.store.putTable(cur.doc, cur.version, ''));
  const r = await L.post(P.vlad, { action: 'rematch' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const next = (await s.req('GET', `tables/${r.body.next}`, { token: P.vlad.token })).body;
  assert.equal(next.status, 'lobby');
  assert.equal(next.isHost, true, 'хозяин реванша Влад');
  assert.equal(next.options.order, 'loser');
  const post2 = (who, body) => s.req('POST', `tables/${r.body.next}`, { body, token: who.token });
  assert.equal((await post2(P.vlad, { action: 'start' })).status, 409, 'Денис и Андрей еще не зашли');
  for (const who of [P.denis, P.andrey]) await s.req('GET', `tables/${r.body.next}/poll`, { token: who.token, query: { here: '1' } });
  assert.equal((await post2(P.vlad, { action: 'start' })).status, 200);
});
