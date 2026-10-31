// Фото игрока: принимаем только маленькие картинки, чужое не меняется, показ без входа по ссылке.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAvatar } from '../server/avatar.js';
import { squareCrop } from '../public/js/avatar-core.js';
import { createApp } from '../server/routes.js';
import { makeHandler } from '../api/index.js';
import { memoryStore } from '../server/store-memory.js';
import { redisStore } from '../server/store-redis.js';
import { fakeUpstash } from './fake-upstash.js';

const ENV = { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' };
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const JPEG = `data:image/jpeg;base64,${b64([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])}`;
const WEBP = `data:image/webp;base64,${b64([...Buffer.from('RIFF'), 9, 9, 9, 9, ...Buffer.from('WEBPVP8 ')])}`;

function setup(store = memoryStore()) {
  let clock = 1_800_000_000_000;
  const app = createApp({ store, env: ENV, now: () => clock++ });
  const req = (method, path, { body, token } = {}) => app.call({ method, path, body, token });
  return { req, store };
}

async function two(s) {
  const denis = (await s.req('POST', 'activate', { body: { code: 'ADMN-TEST-2345' } })).body;
  const made = (await s.req('POST', 'admin/users', { body: { name: 'Петя' }, token: denis.token })).body;
  return { denis, petya: (await s.req('POST', 'activate', { body: { code: made.code } })).body };
}

test('квадрат по центру кадра', () => {
  assert.deepEqual(squareCrop(400, 300), { sx: 50, sy: 0, s: 300 });
  assert.deepEqual(squareCrop(300, 400), { sx: 0, sy: 50, s: 300 });
  assert.deepEqual(squareCrop(160, 160), { sx: 0, sy: 0, s: 160 });
});

test('принимаем только настоящие jpeg и webp небольшого размера', () => {
  assert.equal(parseAvatar(JPEG).type, 'image/jpeg');
  assert.equal(parseAvatar(WEBP).type, 'image/webp');
  const bad = [null, 5, '', 'привет', 'data:image/png;base64,AAAA', 'data:image/svg+xml;base64,PHN2Zz4=',
    `data:image/jpeg;base64,${b64([1, 2, 3, 4])}`, 'data:image/webp;base64,AAAA', `data:image/jpeg;base64,${'A'.repeat(31000)}`,
    `${JPEG}<script>`];
  for (const x of bad) assert.equal(parseAvatar(x), null, String(x).slice(0, 40));
});

for (const [name, make] of [['память', memoryStore], ['Redis', () => redisStore({ exec: fakeUpstash().exec, prefix: 't:' })]]) {
  test(`свое фото можно поставить, заменить и убрать: ${name}`, async () => {
    const s = setup(make());
    const P = await two(s);
    const put = (image, who = P.petya) => s.req('POST', 'me/avatar', { body: { image }, token: who.token });
    assert.equal((await s.req('POST', 'me/avatar', { body: { image: JPEG } })).status, 401, 'без входа нельзя');
    assert.equal((await put('мусор')).status, 400);

    const first = await put(JPEG);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const token = first.body.user.avatar;
    assert.match(token, /^[0-9a-f]{32}$/);
    assert.equal((await s.req('GET', 'me', { token: P.petya.token })).body.avatar, token);
    const shown = await s.req('GET', `avatar/${token}`);
    assert.equal(shown.status, 200, 'картинка открывается без входа');
    assert.equal(shown.body.file.type, 'image/jpeg');

    const second = (await put(WEBP)).body.user.avatar;
    assert.notEqual(second, token, 'новая ссылка: браузер не покажет старое фото');
    assert.equal((await s.req('GET', `avatar/${token}`)).status, 404, 'старое фото стерто');

    assert.equal((await put(null)).body.user.avatar, null);
    assert.equal((await s.req('GET', `avatar/${second}`)).status, 404);
    assert.equal((await s.req('GET', 'avatar/../user')).status, 404, 'чужие ключи не читаются');
    assert.equal((await s.req('GET', 'me', { token: P.denis.token })).body.avatar, null, 'у другого игрока ничего не менялось');
  });
}

test('фото видно за столом, в списке на сайте и на пьедестале', async () => {
  const s = setup();
  const P = await two(s);
  const face = (await s.req('POST', 'me/avatar', { body: { image: JPEG }, token: P.denis.token })).body.user.avatar;
  const petya = (await s.req('POST', 'me/avatar', { body: { image: WEBP }, token: P.petya.token })).body.user.avatar;

  const { body: { code } } = await s.req('POST', 'tables', { token: P.denis.token });
  const view = (await s.req('POST', `tables/${code}`, { body: { action: 'sit', seat: 1 }, token: P.petya.token })).body;
  assert.equal(view.seats[0].avatar, face, 'организатор');
  assert.equal(view.seats[1].avatar, petya, 'севший за стол');
  assert.equal(view.seats[2].avatar, null, 'свободное место');
  const left = (await s.req('POST', `tables/${code}`, { body: { action: 'leave' }, token: P.petya.token })).body;
  assert.equal(left.seats[1].avatar, null, 'встал, фото ушло с места');

  await s.req('POST', 'beat', { body: {}, token: P.petya.token });
  const seen = (await s.req('POST', 'beat', { body: {}, token: P.denis.token })).body;
  assert.equal(seen.online.find((p) => p.name === 'Петя').avatar, petya);

  const cup = (await s.req('POST', 'tournaments', { body: { name: 'Кубок', players: [P.petya.user.id, P.denis.user.id] }, token: P.petya.token })).body;
  const stats = (await s.req('GET', 'stats', { body: {}, token: P.denis.token })).body;
  assert.deepEqual(stats.avatars, [face, null, null], 'сезон сверяется по именам');
  const app = await s.req('GET', 'stats', { token: P.denis.token });
  assert.equal(app.status, 200);
  assert.ok(cup.id);
});

test('загрузка не отменяет отзыв кода, случившийся одновременно', async () => {
  const store = memoryStore();
  const s = setup(store);
  const P = await two(s);
  const id = P.petya.user.id;
  const cas = store.casUser;
  store.casUser = async (before, after) => {
    store.casUser = cas;
    await s.req('POST', `admin/users/${id}/revoke`, { body: {}, token: P.denis.token }); // отзыв пришел посреди загрузки
    return cas(before, after);
  };
  assert.equal((await s.req('POST', 'me/avatar', { body: { image: JPEG }, token: P.petya.token })).status, 409);
  const u = await store.getUser(id);
  assert.equal(u.revoked, true, 'отзыв остался в силе');
  assert.equal(u.avatar ?? null, null);
  assert.equal((await s.req('GET', 'me', { token: P.petya.token })).status, 401);
});

test('запись игрока сверяется с тем, что лежит в базе: Redis', async () => {
  const st = redisStore({ exec: fakeUpstash().exec, prefix: 't:' });
  const u = { id: 'u1', name: 'Петя', sv: 0 };
  await st.putUser(u);
  assert.equal(await st.casUser(u, { ...u, avatar: 'a' }), true);
  assert.equal(await st.casUser(u, { ...u, avatar: 'b' }), false, 'запись уже другая');
  assert.equal((await st.getUser('u1')).avatar, 'a');
});

test('новое фото пишется раньше, чем стирается старое', async () => {
  const store = memoryStore();
  const s = setup(store);
  const P = await two(s);
  const first = (await s.req('POST', 'me/avatar', { body: { image: JPEG }, token: P.petya.token })).body.user.avatar;
  const del = store.delAvatar;
  let seen = null;
  store.delAvatar = async (t) => {
    seen = (await store.getUser(P.petya.user.id)).avatar;
    return del(t);
  };
  const second = (await s.req('POST', 'me/avatar', { body: { image: WEBP }, token: P.petya.token })).body.user.avatar;
  assert.equal(seen, second, 'на момент удаления игрок уже указывает на новое фото');
  assert.notEqual(first, second);
});

test('частая смена фото ограничена', async () => {
  const s = setup();
  const P = await two(s);
  const codes = [];
  for (let k = 0; k < 21; k++) codes.push((await s.req('POST', 'me/avatar', { body: { image: JPEG }, token: P.petya.token })).status);
  assert.equal(codes[19], 200);
  assert.equal(codes[20], 429);
});

test('адрес отдает картинку с нужными заголовками', async () => {
  const store = memoryStore();
  const s = setup(store);
  const P = await two(s);
  const token = (await s.req('POST', 'me/avatar', { body: { image: JPEG }, token: P.petya.token })).body.user.avatar;
  const handler = makeHandler(ENV, store);
  const head = {};
  const out = await new Promise((resolve) => {
    handler({ method: 'GET', url: `/api/avatar/${token}`, headers: {}, socket: {} }, {
      setHeader: (k, v) => { head[k.toLowerCase()] = v; }, statusCode: 0, end(b) { resolve({ status: this.statusCode, b }); },
    });
  });
  assert.equal(out.status, 200);
  assert.equal(head['content-type'], 'image/jpeg');
  assert.match(head['cache-control'], /immutable/);
  assert.equal(head['x-content-type-options'], 'nosniff');
  assert.deepEqual([...out.b.subarray(0, 3)], [0xff, 0xd8, 0xff]);
});
