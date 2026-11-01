// Удаление столов администратором: только столы, где партия не начиналась. Сыгранное не трогаем.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';
import { redisStore } from '../server/store-redis.js';
import { fakeUpstash } from './fake-upstash.js';
import { deleteQuestion, canDelete } from '../public/js/online.js';

const ENV = { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' };

function setup(store = memoryStore()) {
  const app = createApp({ store, env: ENV, now: () => Date.now(), botOptions: { timeCap: 20 }, tg: { on: false, say: async () => false } });
  const req = (method, path, { body, token } = {}) => app.call({ method, path, body, token });
  return { req, store };
}

async function company(s, ...names) {
  const out = { denis: (await s.req('POST', 'activate', { body: { code: 'ADMN-TEST-2345' } })).body };
  for (const [name, extra] of names.map((n) => (Array.isArray(n) ? n : [n, {}]))) {
    const r = await s.req('POST', 'admin/users', { body: { name, ...extra }, token: out.denis.token });
    out[name] = (await s.req('POST', 'activate', { body: { code: r.body.code } })).body;
  }
  return out;
}

async function table(s, host) {
  const { code } = (await s.req('POST', 'tables', { token: host.token })).body;
  await s.req('POST', `tables/${code}`, { body: { action: 'seatCount', n: 2 }, token: host.token });
  const post = (who, body) => s.req('POST', `tables/${code}`, { body, token: who.token });
  return { code, post, del: (who) => s.req('POST', `admin/tables/${code}/delete`, { token: who?.token }) };
}

const mine = async (s, who) => (await s.req('GET', 'tables', { token: who.token })).body.map((t) => t.code);

for (const [kind, make] of [['память', () => memoryStore()], ['Upstash', () => redisStore({ exec: fakeUpstash().exec, prefix: 'production:' })]]) {
  test(`удаление, ${kind}: стол исчезает у всех и освобождает место в списках`, async () => {
    const s = setup(make());
    const P = await company(s, 'Андрей');
    const { code, post, del } = await table(s, P.denis);
    await post(P['Андрей'], { action: 'sit', seat: 1 });
    const r = await del(P.denis);
    assert.equal(r.status, 200);
    assert.equal((await s.req('GET', `tables/${code}`, { token: P.denis.token })).status, 404);
    assert.equal((await s.req('GET', `tables/${code}/poll`, { token: P['Андрей'].token })).status, 404);
    assert.equal((await post(P['Андрей'], { action: 'leave' })).status, 404);
    assert.deepEqual(await s.store.myTables(P.denis.user.id), []);
    assert.deepEqual(await s.store.myTables(P['Андрей'].user.id), []);
  });
}

test('удаление: только администратор, назначенный тоже может', async () => {
  const s = setup();
  const P = await company(s, 'Андрей', ['Влад', { admin: true }]);
  const { code, del } = await table(s, P.denis);
  assert.equal((await del(null)).status, 401);
  assert.equal((await del(P['Андрей'])).status, 403);
  assert.equal((await s.req('GET', `tables/${code}`, { token: P.denis.token })).status, 200);
  assert.equal((await del(P['Влад'])).status, 200, 'чужой стол удаляет назначенный администратор');
});

test('удаление: хозяин стола без прав администратора удалить не может', async () => {
  const s = setup();
  const P = await company(s, 'Андрей');
  const { del } = await table(s, P['Андрей']);
  assert.equal((await del(P['Андрей'])).status, 403);
});

test('удаление: нет такого стола', async () => {
  const s = setup();
  const P = await company(s);
  assert.equal((await s.req('POST', 'admin/tables/NOSUCH/delete', { token: P.denis.token })).status, 404);
});

async function started(s, P) {
  const t = await table(s, P.denis);
  await t.post(P['Андрей'], { action: 'sit', seat: 1 });
  assert.equal((await t.post(P.denis, { action: 'start' })).status, 200);
  return t;
}

test('удаление: идущую партию нельзя', async () => {
  const s = setup();
  const P = await company(s, 'Андрей');
  const { code, del } = await started(s, P);
  const r = await del(P.denis);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'not-lobby');
  assert.equal((await s.req('GET', `tables/${code}`, { token: P.denis.token })).body.status, 'playing');
});

test('удаление: завершенную досрочно нельзя', async () => {
  const s = setup();
  const P = await company(s, 'Андрей');
  const { code, post, del } = await started(s, P);
  assert.equal((await post(P.denis, { action: 'close' })).status, 200);
  assert.equal((await del(P.denis)).status, 409);
  assert.equal((await s.req('GET', `tables/${code}`, { token: P.denis.token })).body.status, 'closed');
});

test('удаление: законченную партию нельзя', async () => {
  const store = memoryStore();
  const s = setup(store);
  const P = await company(s, 'Андрей');
  const { code, del } = await started(s, P);
  const cur = await store.getTable(code);
  cur.doc.status = 'over';
  cur.doc.game.result = { finishedAt: Date.now(), seats: [] };
  cur.doc.version += 1;
  assert.equal(await store.putTable(cur.doc, cur.version, ''), true);
  assert.equal((await del(P.denis)).status, 409);
  assert.equal((await store.getTable(code)).doc.status, 'over');
});

test('удаление: партию начали в тот же момент, удаление не проходит', async () => {
  const store = memoryStore();
  const s = setup(store);
  const P = await company(s, 'Андрей');
  const { code, post, del } = await table(s, P.denis);
  await post(P['Андрей'], { action: 'sit', seat: 1 });
  const get = store.getTable;
  store.getTable = async (c) => {
    const seen = await get(c);
    store.getTable = get;
    assert.equal((await post(P.denis, { action: 'start' })).status, 200); // запрос старта успел между чтением и записью
    return seen;
  };
  const r = await del(P.denis);
  assert.equal(r.status, 409);
  assert.equal((await store.getTable(code)).doc.status, 'playing');
});

test('удаление: только по своему адресу и только запросом POST', async () => {
  const s = setup();
  const P = await company(s);
  const { code } = await table(s, P.denis);
  const token = P.denis.token;
  for (const [method, path] of [
    ['GET', `admin/tables/${code}/delete`],
    ['PUT', `admin/tables/${code}/delete`],
    ['DELETE', `admin/tables/${code}/delete`],
    ['POST', `admin/tables/${code}/remove`],
    ['POST', `admin/tables/${code}/delete/x`],
    ['POST', `admin/tables/${code}`],
    ['POST', 'admin/tables'],
    ['GET', `admin/tables/${code}`],
  ]) {
    assert.equal((await s.req(method, path, { token })).status, 404, `${method} ${path}`);
  }
  assert.equal((await s.req('GET', `tables/${code}`, { token })).status, 200);
});

test('удаление: сбой после отметки не показывает стол и не оживляет его', async (t) => {
  const store = memoryStore();
  const s = setup(store);
  const P = await company(s, 'Андрей');
  const { code, post, del } = await table(s, P.denis);
  t.mock.method(console, 'error', () => {});
  const late = await store.getTable(code); // запрос, который прочитал стол до удаления
  const remove = store.delTable;
  store.delTable = async () => { throw new Error('нет связи'); };
  assert.equal((await del(P.denis)).status, 500);
  store.delTable = remove;
  late.doc.version += 1;
  assert.equal(await store.putTable(late.doc, late.version, ''), false, 'запоздавшая запись не вернет стол');
  assert.equal((await s.req('GET', `tables/${code}`, { token: P.denis.token })).status, 404);
  assert.equal((await post(P.denis, { action: 'hero', seat: 0, hero: 'lion' })).status, 404);
  assert.deepEqual(await mine(s, P.denis), []);
  assert.equal((await del(P.denis)).status, 404);
});

test('открытые столы: все игроки, только где партия не начиналась', async () => {
  const s = setup();
  const P = await company(s, 'Андрей', 'Влад');
  const a = await table(s, P.denis);
  const b = await table(s, P['Андрей']);
  await b.post(P['Влад'], { action: 'sit', seat: 1 });
  const played = await started(s, P);
  assert.equal((await s.req('GET', 'admin/tables')).status, 401);
  assert.equal((await s.req('GET', 'admin/tables', { token: P['Андрей'].token })).status, 403);
  const r = await s.req('GET', 'admin/tables', { token: P.denis.token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((t) => t.code).sort(), [a.code, b.code].sort());
  assert.ok(!r.body.some((t) => t.code === played.code));
  assert.deepEqual(r.body.find((t) => t.code === b.code).seats.map((x) => x.name), ['Андрей', 'Влад']);
  assert.deepEqual(Object.keys(r.body[0]).sort(), ['code', 'seats', 'title', 'updatedAt']);
});

test('кнопка удаления: у администратора и только пока партия не началась', () => {
  assert.equal(canDelete({ status: 'lobby' }, { admin: true }), true);
  for (const status of ['playing', 'over', 'closed']) assert.equal(canDelete({ status }, { admin: true }), false, status);
  assert.equal(canDelete({ status: 'lobby' }, { admin: false }), false);
  assert.equal(canDelete({ status: 'lobby' }, undefined), false);
});

test('вопрос перед удалением: себя не называем', () => {
  const t = { code: 'ABC234', title: '01.11.2026.8', seats: [{ kind: 'human', name: 'Денис' }, { kind: 'human', name: 'Андрей' }, { kind: 'human', name: 'Влад' }, { kind: 'bot', name: 'Бот' }] };
  assert.equal(deleteQuestion(t, 'Денис'), 'Удалить стол 01.11.2026.8? За столом: Андрей, Влад. Вернуть его будет нельзя.');
  const empty = { code: 'ABC234', title: null, seats: [{ kind: 'human', name: 'Денис' }, { kind: 'human', name: null }] };
  assert.equal(deleteQuestion(empty, 'Денис'), 'Удалить стол ABC234? Вернуть его будет нельзя.');
});
