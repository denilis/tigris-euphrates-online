// API целиком на хранилище в памяти: вход по коду, админка, столы, гонка ходов, партия
// с ботом до конца, история и «проигравший первым», неразличимость скрытого (A0-A7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';
import { redisStore } from '../server/store-redis.js';
import { fakeUpstash } from './fake-upstash.js';
import { stateFromJSON, stateToJSON } from '../game/serialize.js';
import { makeRng } from '../game/vendor/engine/rng.js';
import { botDue } from '../game/table.js';
import { legalMoves, applyMove } from '../game/vendor/engine/engine.js';

const ENV = { SESSION_SECRET: 'test-secret', CODE_PEPPER: 'test-pepper', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' };

function setup(store = memoryStore()) {
  let clock = 1_800_000_000_000;
  const app = createApp({ store, env: ENV, now: () => clock++, botOptions: { timeCap: 20 } });
  const req = async (method, path, { body, token, query } = {}) => app.call({ method, path, body, token, query });
  return { app, store, req };
}

/** Денис (админ), Андрей и Влад с кодами и сессиями. */
async function people(req) {
  const denis = (await req('POST', 'activate', { body: { code: 'admn test 2345' } })).body;
  const mk = async (name) => {
    const r = await req('POST', 'admin/users', { body: { name }, token: denis.token });
    const a = await req('POST', 'activate', { body: { code: r.body.code.toLowerCase() } });
    return { ...a.body, code: r.body.code };
  };
  return { denis, andrey: await mk('Андрей'), vlad: await mk('Влад') };
}

/** Стол Дениса, Андрея, Влада и бота, партия начата. */
async function startedTable(req, P) {
  const { body: { code } } = await req('POST', 'tables', { token: P.denis.token });
  const post = (who, body) => req('POST', `tables/${code}`, { body, token: who.token });
  await post(P.andrey, { action: 'sit', seat: 1 });
  await post(P.vlad, { action: 'sit', seat: 2 });
  await post(P.denis, { action: 'hero', seat: 0, hero: 'lion' });
  await post(P.andrey, { action: 'hero', seat: 1, hero: 'bull' });
  await post(P.vlad, { action: 'hero', seat: 2, hero: 'bow' });
  const s = await post(P.vlad, { action: 'start' });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return code;
}

/** Доиграть: боты через bot-tick, люди случайным допустимым ходом. */
async function playToEnd(req, P, code, seed) {
  const r = makeRng(seed);
  const who = { 0: P.denis, 1: P.andrey, 2: P.vlad };
  for (let k = 0; k < 4000; k++) {
    const poll = (await req('GET', `tables/${code}/poll`, { token: P.denis.token })).body;
    if (poll.botDue) {
      const t = await req('POST', `tables/${code}/bot-tick`, { token: P.andrey.token });
      assert.equal(t.status, 200);
      continue;
    }
    const v = (await req('GET', `tables/${code}`, { token: P.denis.token })).body;
    if (v.status === 'over') return v;
    const p = who[v.game.toMove];
    const mine = (await req('GET', `tables/${code}`, { token: p.token })).body;
    const m = await req('POST', `tables/${code}`, { body: { action: 'move', version: mine.version, index: Math.floor(r() * mine.game.legal.length) }, token: p.token });
    assert.equal(m.status, 200, JSON.stringify(m.body));
  }
  throw new Error('партия не закончилась');
}

test('без кода ничего нельзя; админ входит своим кодом', async () => {
  const { req } = setup();
  for (const [m, p] of [['GET', 'me'], ['GET', 'tables'], ['POST', 'tables'], ['GET', 'tables/ABCDEF'], ['GET', 'tables/ABCDEF/poll'], ['GET', 'admin/users']]) {
    assert.equal((await req(m, p)).status, 401, `${m} ${p}`);
    assert.equal((await req(m, p, { token: 'garbage.token' })).status, 401);
  }
  assert.equal((await req('POST', 'activate', { body: { code: 'ZZZZ-ZZZZ-ZZZZ' } })).status, 401);
  assert.equal((await req('POST', 'activate', { body: { code: 'короткий' } })).status, 401);
  const a = await req('POST', 'activate', { body: { code: 'ADMN-TEST-2345' } });
  assert.equal(a.status, 200);
  assert.deepEqual(a.body.user, { id: 'u-admin', name: 'Денис', admin: true });
  assert.equal((await req('GET', 'me', { token: a.body.token })).body.admin, true);
  assert.equal((await req('GET', 'ping')).body.ok, true);
});

test('админ выдаёт и отзывает коды; не админ не может', async () => {
  const { req } = setup();
  const P = await people(req);
  assert.equal(P.andrey.user.name, 'Андрей');
  assert.equal((await req('POST', 'admin/users', { body: { name: 'Икс' }, token: P.andrey.token })).status, 403);
  const list = (await req('GET', 'admin/users', { token: P.denis.token })).body;
  assert.deepEqual(list.map((u) => u.name).sort(), ['Андрей', 'Влад', 'Денис']);
  assert.ok(!JSON.stringify(list).includes('codeHash'));
  assert.equal((await req('POST', `admin/users/${P.andrey.user.id}/revoke`, { token: P.denis.token })).status, 200);
  assert.equal((await req('GET', 'me', { token: P.andrey.token })).status, 401, 'отзыв гасит сессию');
  assert.equal((await req('POST', 'activate', { body: { code: P.andrey.code } })).status, 401, 'старый код не работает');
  const nc = (await req('POST', `admin/users/${P.andrey.user.id}/code`, { token: P.denis.token })).body.code;
  const again = await req('POST', 'activate', { body: { code: nc } });
  assert.equal(again.status, 200);
  assert.equal(again.body.user.id, P.andrey.user.id, 'тот же игрок с новым кодом');
});

test('стол: лобби, ход только из списка, устаревшая версия и гонка двух ходов', async () => {
  const { req } = setup();
  const P = await people(req);
  const code = await startedTable(req, P);
  const seated = (await req('POST', `tables/${code}`, { body: { action: 'sit', seat: 1 }, token: P.vlad.token }));
  assert.equal(seated.status, 409, 'на чужое место не сесть');
  // ходит бот, если он первый
  let v = (await req('GET', `tables/${code}`, { token: P.denis.token })).body;
  while (v.game.toMove === 3) {
    await req('POST', `tables/${code}/bot-tick`, { token: P.denis.token });
    v = (await req('GET', `tables/${code}`, { token: P.denis.token })).body;
  }
  const who = { 0: P.denis, 1: P.andrey, 2: P.vlad }[v.game.toMove];
  const other = [P.denis, P.andrey, P.vlad].find((x) => x !== who);
  const mine = (await req('GET', `tables/${code}`, { token: who.token })).body;
  assert.ok(mine.game.legal.length > 0);
  assert.equal((await req('GET', `tables/${code}`, { token: other.token })).body.game.legal, null);
  const post = (p, body) => req('POST', `tables/${code}`, { body, token: p.token });
  assert.equal((await post(who, { action: 'move', version: mine.version, index: 99999 })).status, 400);
  assert.equal((await post(who, { action: 'move', version: mine.version - 1, index: 0 })).status, 409);
  assert.equal((await post(other, { action: 'move', version: mine.version, index: 0 })).status, 409);
  assert.equal((await post(who, { action: 'nonsense' })).status, 400);
  // два одинаковых хода одновременно: проходит один
  const [a, b] = await Promise.all([
    post(who, { action: 'move', version: mine.version, index: 0 }),
    post(who, { action: 'move', version: mine.version, index: 0 }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const poll = (await req('GET', `tables/${code}/poll`, { token: P.andrey.token })).body;
  assert.equal(poll.version, mine.version + 1);
});

for (const [name, mk] of [['память', () => memoryStore()], ['Upstash', () => redisStore({ exec: fakeUpstash().exec, prefix: 'production:' })]]) {
  test(`${name}: партия с ботом до конца, история один раз, новая партия компании с проигравшего`, async () => {
    const { req, store } = setup(mk());
    const P = await people(req);
    const code = await startedTable(req, P);
    const end = await playToEnd(req, P, code, 5);
    assert.equal(end.status, 'over');
    const res = end.game.result;
    const company = ['u-admin', P.andrey.user.id, P.vlad.user.id].sort().join('|');
    const last = await store.companyLast(company);
    assert.ok(last, 'история компании записана');
    assert.equal(await store.addHistory(last), false, 'история уже есть');
    // новый стол той же компании: первым ходит последнее место
    const { body: { code: c2 } } = await req('POST', 'tables', { token: P.vlad.token });
    const post = (p, body) => req('POST', `tables/${c2}`, { body, token: p.token });
    await post(P.denis, { action: 'sit', seat: 1 });
    await post(P.andrey, { action: 'sit', seat: 2 });
    await post(P.vlad, { action: 'hero', seat: 0, hero: 'bow' });
    await post(P.denis, { action: 'hero', seat: 1, hero: 'lion' });
    await post(P.andrey, { action: 'hero', seat: 2, hero: 'bull' });
    const v2 = (await post(P.andrey, { action: 'start' })).body;
    const worst = Math.max(...res.seats.map((x) => x.place));
    const losers = res.seats.filter((x) => x.place === worst).map((x) => ({ 0: 'u-admin', 1: P.andrey.user.id, 2: P.vlad.user.id, 3: 'bot' }[x.seatId]));
    const newIds = { 0: P.vlad.user.id, 1: 'u-admin', 2: P.andrey.user.id, 3: 'bot' };
    assert.ok(losers.includes(newIds[v2.game.order[0]]), 'первым ходит проигравший прошлой партии');
  });
}

test('реванш: двое нажали, стол один; он у всех в «моих столах»', async () => {
  const { req } = setup();
  const P = await people(req);
  const code = await startedTable(req, P);
  await playToEnd(req, P, code, 8);
  const a = (await req('POST', `tables/${code}`, { body: { action: 'rematch' }, token: P.andrey.token })).body;
  const b = (await req('POST', `tables/${code}`, { body: { action: 'rematch' }, token: P.vlad.token })).body;
  assert.ok(a.next);
  assert.equal(b.next, a.next);
  for (const p of [P.denis, P.andrey, P.vlad]) {
    const mine = (await req('GET', 'tables', { token: p.token })).body;
    assert.ok(mine.some((x) => x.code === a.next && x.status === 'playing'));
  }
});

test('бот: замок не даёт думать дважды; без бота bot-tick ничего не делает', async () => {
  const { req, store } = setup();
  const P = await people(req);
  const code = await startedTable(req, P);
  assert.equal(await store.lock(code, 'someone', 30000), true);
  const r = (await req('POST', `tables/${code}/bot-tick`, { token: P.denis.token })).body;
  assert.deepEqual([r.moved, r.locked], [0, true]);
  await store.unlock(code, 'someone');
  const r2 = (await req('POST', `tables/${code}/bot-tick`, { token: P.denis.token })).body;
  assert.equal(r2.locked, false);
  assert.equal(r2.botDue, false, 'после тика решает человек');
  assert.equal((await req('POST', `tables/${code}/bot-tick`, { token: P.denis.token })).body.moved, 0);
});

// часы сервера в виде стола меняются от запроса к запросу, остальное должно совпасть
const noNow = (v) => {
  if (v?.game?.clock) v.game.clock.now = null;
  return v;
};

test('новый экземпляр сервера на той же базе продолжает партию (A5)', async () => {
  const store = memoryStore();
  const s1 = setup(store);
  const P = await people(s1.req);
  const code = await startedTable(s1.req, P);
  const before = (await s1.req('GET', `tables/${code}`, { token: P.andrey.token })).body;
  const s2 = setup(store);
  const after = (await s2.req('GET', `tables/${code}`, { token: P.andrey.token })).body;
  assert.deepEqual(noNow(after), noNow(before));
});

test('скрытое не влияет на ответы сервера игроку: вид, мои столы, опрос', async () => {
  const { req, store } = setup();
  const P = await people(req);
  const code = await startedTable(req, P);
  const r = makeRng(3);
  // несколько ходов, чтобы появились сбросы и разные руки
  for (let k = 0; k < 40; k++) {
    const poll = (await req('GET', `tables/${code}/poll`, { token: P.denis.token })).body;
    if (poll.botDue) { await req('POST', `tables/${code}/bot-tick`, { token: P.denis.token }); continue; }
    const v = (await req('GET', `tables/${code}`, { token: P.denis.token })).body;
    const p = { 0: P.denis, 1: P.andrey, 2: P.vlad }[v.game.toMove];
    const mine = (await req('GET', `tables/${code}`, { token: p.token })).body;
    await req('POST', `tables/${code}`, { body: { action: 'move', version: mine.version, index: Math.floor(r() * mine.game.legal.length) }, token: p.token });
  }
  const answers = async (p) => JSON.stringify([
    noNow((await req('GET', `tables/${code}`, { token: p.token })).body),
    (await req('GET', 'tables', { token: p.token })).body,
    (await req('GET', `tables/${code}/poll`, { token: p.token })).body,
  ]);
  for (const viewer of [P.denis, P.andrey, P.vlad]) {
    const before = await answers(viewer);
    const { doc, version } = await store.getTable(code);
    const myP = doc.game.order.indexOf(doc.seats.find((x) => x.userId === viewer.user.id).id);
    const s = stateFromJSON(doc.game.state);
    s.players.forEach((pl, p) => {
      if (p === myP) return;
      const n = pl.hand.reduce((a, b) => a + b, 0);
      pl.hand = [0, 0, 0, 0];
      for (let k = 0; k < n; k++) pl.hand[Math.floor(r() * 4)]++;
      pl.score = pl.score.map((x) => x + 3);
    });
    const bag = s.bag.reduce((a, b) => a + b, 0);
    s.bag = [bag, 0, 0, 0];
    const changed = { ...doc, game: { ...doc.game, state: stateToJSON(s) } };
    const meta = botDue(doc) !== null ? 'bot' : '';
    assert.equal(await store.putTable(changed, version, meta), true);
    assert.equal(await answers(viewer), before, `смотрит ${viewer.user.name}`);
    assert.equal(await store.putTable(doc, version, meta), true);
  }
});

test('отмена и окно подтверждения через API: срок вышел, опрос зовет тик, тик завершает ход', async () => {
  const store = memoryStore();
  let at = 1_800_000_000_000;
  const app = createApp({ store, env: ENV, now: () => at, botOptions: { timeCap: 20 } });
  const req = async (method, path, { body, token, query } = {}) => app.call({ method, path, body, token, query });
  const P = await people(req);
  const code = await startedTable(req, P);
  const who = { 0: P.denis, 1: P.andrey, 2: P.vlad };
  // до хода человека: ботов прокручиваем тиком
  for (let k = 0; k < 20 && (await req('GET', `tables/${code}/poll`, { token: P.denis.token })).body.botDue; k++) {
    await req('POST', `tables/${code}/bot-tick`, { token: P.denis.token });
  }
  // ход, после которого тот же игрок снова выбирает действие или подтверждает ход
  const cleanMove = async () => {
    const { doc } = await store.getTable(code);
    const s = stateFromJSON(doc.game.state);
    const legal = legalMoves(s);
    for (let i = 0; i < legal.length; i++) {
      if (legal[i].type !== 'tile') continue;
      const a = stateFromJSON(doc.game.state);
      applyMove(a, legal[i], makeRng(1));
      if (['action', 'confirm'].includes(a.phase) && a.cur === s.cur) return i;
    }
    return -1;
  };
  let v = (await req('GET', `tables/${code}`, { token: P.denis.token })).body;
  const p = who[v.game.toMove];
  const move = async () => {
    const mine = (await req('GET', `tables/${code}`, { token: p.token })).body;
    const r = await req('POST', `tables/${code}`, { body: { action: 'move', version: mine.version, index: await cleanMove() }, token: p.token });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  };
  await move();
  at += 1000;
  v = await move();
  assert.equal(v.game.phase, 'confirm');
  assert.equal(v.game.canUndo, true);
  assert.equal(v.game.clock.confirmBy, at + 20000);
  assert.equal(v.game.clock.now, at);

  const u = await req('POST', `tables/${code}`, { body: { action: 'undo', version: v.version }, token: p.token });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.equal(u.body.game.phase, 'action');
  assert.equal(u.body.game.actionNo, 2);
  assert.equal(u.body.game.logEpoch, 1);
  assert.equal(u.body.game.log.at(-1).ev, 'undo');

  v = await move();
  assert.equal(v.game.phase, 'confirm');
  at += 19999;
  assert.equal((await req('GET', `tables/${code}/poll`, { token: P.andrey.token })).body.botDue, false, 'окно еще идет');
  at += 2;
  assert.equal((await req('GET', `tables/${code}/poll`, { token: P.andrey.token })).body.botDue, true, 'окно вышло');
  const tick = (await req('POST', `tables/${code}/bot-tick`, { token: P.andrey.token })).body;
  assert.ok(tick.moved >= 1);
  const after = (await req('GET', `tables/${code}`, { token: P.denis.token })).body;
  assert.ok(after.status === 'over' || after.game.cur !== v.game.cur, 'ход перешел');
});
