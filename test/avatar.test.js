// Фото игрока: принимаем только маленькие картинки, чужое не меняется, показ без входа по ссылке.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAvatar } from '../server/avatar.js';
import { squareCrop, fullCrop, cropLimits, clampCrop, panCrop, zoomCrop, sliderOf, cropAtSlider, cropRect, CROP_ZOOM_MAX } from '../public/js/avatar-core.js';
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

// --- кадрирование и фото от администратора (13.11)

test('кадр: самый широкий берет всю короткую сторону по центру, как раньше', () => {
  assert.deepEqual(fullCrop(400, 300), { cx: 200, cy: 150, s: 300 });
  assert.deepEqual(cropRect(fullCrop(400, 300)), squareCrop(400, 300));
  assert.deepEqual(cropRect(fullCrop(300, 400)), squareCrop(300, 400));
  assert.deepEqual(cropRect(fullCrop(1493, 2000)), { sx: 0, sy: 253.5, s: 1493 }, 'портрет 3:4: вся ширина, то есть бюст');
});

test('кадр: пределы масштаба, у крошечной картинки масштаба нет', () => {
  assert.equal(CROP_ZOOM_MAX, 5);
  assert.deepEqual(cropLimits(1500, 2000), { max: 1500, min: 300 });
  assert.deepEqual(cropLimits(100, 300), { max: 100, min: 48 }, 'ближе 48 точек не подходим');
  assert.deepEqual(cropLimits(40, 60), { max: 40, min: 40 });
});

test('кадр не выходит за края фото и за пределы масштаба', () => {
  assert.deepEqual(clampCrop({ cx: -50, cy: 5000, s: 300 }, 400, 300), { cx: 150, cy: 150, s: 300 });
  assert.deepEqual(clampCrop({ cx: 390, cy: 10, s: 100 }, 400, 300), { cx: 350, cy: 50, s: 100 });
  assert.equal(clampCrop({ cx: 200, cy: 150, s: 9999 }, 400, 300).s, 300, 'шире фото кадр не бывает');
  assert.equal(clampCrop({ cx: 200, cy: 150, s: 1 }, 400, 300).s, 60, 'ближе предела тоже');
  for (const c of [clampCrop({ cx: 0, cy: 0, s: 80 }, 400, 300), clampCrop({ cx: 400, cy: 300, s: 80 }, 400, 300)]) {
    const r = cropRect(c);
    assert.ok(r.sx >= 0 && r.sy >= 0 && r.sx + r.s <= 400 && r.sy + r.s <= 300, JSON.stringify(r));
  }
});

test('сдвиг: фото тянут вправо, кадр едет по картинке влево и останавливается у края', () => {
  const c = { cx: 200, cy: 150, s: 200 };
  assert.deepEqual(panCrop(c, 24, 0, 240, 400, 300), { cx: 180, cy: 150, s: 200 }, '24 точки экрана при кадре 200 в окне 240');
  assert.deepEqual(panCrop(c, 0, -12, 240, 400, 300), { cx: 200, cy: 160, s: 200 });
  assert.deepEqual(panCrop(c, 5000, 5000, 240, 400, 300), { cx: 100, cy: 100, s: 200 });
  assert.deepEqual(panCrop(fullCrop(400, 300), 0, 50, 240, 400, 300), fullCrop(400, 300), 'по короткой стороне широкому кадру ехать некуда');
});

test('масштаб вокруг точки: то, что под курсором, остается на месте', () => {
  const view = 200, c = fullCrop(1000, 1000);
  const under = (k, px) => k.cx + px * (k.s / view); // точка картинки под курсором
  const z = zoomCrop(c, 2, 50, -30, view, 1000, 1000);
  assert.deepEqual(z, { cx: 625, cy: 425, s: 500 });
  assert.equal(under(z, 50), under(c, 50));
  assert.deepEqual(zoomCrop(c, 2, 0, 0, view, 1000, 1000), { cx: 500, cy: 500, s: 500 }, 'по центру: центр на месте');
  assert.equal(zoomCrop(c, 1000, 0, 0, view, 1000, 1000).s, 200, 'ближе предела не подойти');
  assert.deepEqual(zoomCrop(z, 0.001, 50, -30, view, 1000, 1000), c, 'отъехали до упора: снова весь кадр');
  // у края картинки отъезд не выводит кадр за край
  const edge = zoomCrop({ cx: 100, cy: 100, s: 200 }, 0.5, 0, 0, view, 1000, 1000);
  assert.deepEqual(edge, { cx: 200, cy: 200, s: 400 });
});

test('ползунок: 0 весь кадр, 1 самый близкий, шкала ровная', () => {
  const c = fullCrop(1000, 1500);
  assert.equal(sliderOf(c, 1000, 1500), 0);
  assert.equal(cropAtSlider(c, 1, 1000, 1500).s, 200);
  assert.ok(Math.abs(cropAtSlider(c, 0.5, 1000, 1500).s - Math.sqrt(1000 * 200)) < 1e-6, 'середина ползунка: среднее геометрическое');
  for (const t of [0, 0.3, 0.77, 1]) assert.ok(Math.abs(sliderOf(cropAtSlider(c, t, 1000, 1500), 1000, 1500) - t) < 1e-9, String(t));
  assert.equal(cropAtSlider(c, 7, 1000, 1500).s, 200, 'за шкалой: крайнее положение');
  assert.equal(cropAtSlider(c, 'мусор', 1000, 1500).s, 1000);
  assert.deepEqual(cropAtSlider({ cx: 900, cy: 100, s: 200 }, 0, 1000, 1500), { cx: 500, cy: 500, s: 1000 }, 'при отъезде кадр возвращается внутрь фото');
  assert.equal(sliderOf(fullCrop(40, 60), 40, 60), 0, 'у крошечной картинки ползунок стоит, деления на ноль нет');
  assert.deepEqual(cropAtSlider(fullCrop(40, 60), 1, 40, 60), fullCrop(40, 60));
});

test('администратор ставит фото игроку; игрок потом меняет и убирает его сам', async () => {
  const s = setup();
  const P = await two(s);
  const id = P.petya.user.id;
  const set = (who, image = JPEG, to = id) => s.req('POST', `admin/users/${to}/avatar`, { body: { image }, token: who?.token });
  const r = await set(P.denis);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const token = r.body.user.avatar;
  assert.match(token, /^[0-9a-f]{32}$/);
  assert.equal(r.body.user.id, id);
  assert.equal((await s.req('GET', 'me', { token: P.petya.token })).body.avatar, token, 'игрок видит фото у себя');
  assert.equal((await s.req('GET', `avatar/${token}`)).status, 200);
  assert.equal((await s.req('GET', 'me', { token: P.denis.token })).body.avatar, null, 'у администратора ничего не поменялось');
  const row = (await s.req('GET', 'admin/users', { token: P.denis.token })).body.find((x) => x.id === id);
  assert.equal(row.avatar, token, 'фото видно в списке игроков');
  const second = (await set(P.denis, WEBP)).body.user.avatar;
  assert.notEqual(second, token);
  assert.equal((await s.req('GET', `avatar/${token}`)).status, 404, 'прежнее фото стерто');
  assert.equal((await set(P.denis, 'мусор')).status, 400);
  assert.equal((await set(P.denis, JPEG, 'u-nobody')).status, 404);
  assert.equal((await s.req('GET', 'me', { token: P.petya.token })).body.avatar, second, 'отказы фото не тронули');
  // игрок сам заменяет и убирает
  const own = (await s.req('POST', 'me/avatar', { body: { image: JPEG }, token: P.petya.token })).body.user.avatar;
  assert.notEqual(own, second);
  assert.equal((await s.req('POST', 'me/avatar', { body: { image: null }, token: P.petya.token })).body.user.avatar, null);
  // и администратор может убрать
  await set(P.denis);
  assert.equal((await set(P.denis, null)).body.user.avatar, null);
});

test('фото другому игроку ставит только администратор: главному никто, администратору только главный', async () => {
  const s = setup();
  const P = await two(s);
  const set = (who, to) => s.req('POST', `admin/users/${to}/avatar`, { body: { image: JPEG }, token: who?.token });
  const made = (await s.req('POST', 'admin/users', { body: { name: 'Вася' }, token: P.petya.token })).body;
  const vasya = (await s.req('POST', 'activate', { body: { code: made.code } })).body;
  assert.equal((await set(null, vasya.user.id)).status, 401, 'без входа нельзя');
  const no = await set(P.petya, vasya.user.id);
  assert.equal(no.status, 403, 'пригласивший игрок без прав администратора фото не ставит');
  assert.equal(no.body.error, 'not-admin');
  assert.equal((await set(vasya, P.petya.user.id)).status, 403);
  assert.equal((await set(P.petya, P.denis.user.id)).status, 403);
  // Петя стал администратором: игрокам может, главному и другим администраторам нет
  assert.equal((await s.req('POST', `admin/users/${P.petya.user.id}/admin`, { body: { admin: true }, token: P.denis.token })).status, 200);
  assert.equal((await set(P.petya, vasya.user.id)).status, 200);
  const main = await set(P.petya, P.denis.user.id);
  assert.equal(main.status, 403);
  assert.equal(main.body.error, 'not-main');
  assert.equal((await s.req('POST', `admin/users/${vasya.user.id}/admin`, { body: { admin: true }, token: P.denis.token })).status, 200);
  assert.equal((await set(P.petya, vasya.user.id)).status, 403, 'администратору фото ставит только главный');
  assert.equal((await set(P.denis, vasya.user.id)).status, 200);
  assert.equal((await s.req('GET', 'me', { token: P.denis.token })).body.avatar, null, 'главному никто ничего не поставил');
});

test('фото от администратора не отменяет отзыв кода, случившийся одновременно', async () => {
  const store = memoryStore();
  const s = setup(store);
  const P = await two(s);
  const id = P.petya.user.id;
  const cas = store.casUser;
  store.casUser = async (before, after) => {
    store.casUser = cas;
    await s.req('POST', `admin/users/${id}/revoke`, { body: {}, token: P.denis.token });
    return cas(before, after);
  };
  assert.equal((await s.req('POST', `admin/users/${id}/avatar`, { body: { image: JPEG }, token: P.denis.token })).status, 409);
  const u = await store.getUser(id);
  assert.equal(u.revoked, true);
  assert.equal(u.avatar ?? null, null);
});

// --- ревью 13.11

test('ревью 13.11: сломанные числа в кадре дают самый широкий кадр, а не пустую картинку', () => {
  for (const bad of [{ cx: NaN, cy: 10, s: 100 }, { cx: 10, cy: 10, s: Infinity }, { cx: 10, cy: undefined, s: 100 }, null]) {
    assert.deepEqual(clampCrop(bad, 400, 300), fullCrop(400, 300), JSON.stringify(bad));
  }
  assert.deepEqual(zoomCrop(fullCrop(400, 300), NaN, 0, 0, 240, 400, 300), fullCrop(400, 300));
  assert.deepEqual(panCrop(fullCrop(400, 300), 5, 5, 0, 400, 300), fullCrop(400, 300), 'окно нулевой ширины');
});

test('ревью 13.11: отозванному фото не ставят, главный себе через список тоже, частота ограничена', async () => {
  const s = setup();
  const P = await two(s);
  const set = (who, to, image = JPEG) => s.req('POST', `admin/users/${to}/avatar`, { body: { image }, token: who.token });
  const self = await set(P.denis, P.denis.user.id);
  assert.equal(self.status, 403, 'свое фото главный ставит в профиле, а не через список');
  assert.equal(self.body.error, 'not-main');
  const made = (await s.req('POST', 'admin/users', { body: { name: 'Вася' }, token: P.denis.token })).body;
  await s.req('POST', `admin/users/${made.user.id}/revoke`, { body: {}, token: P.denis.token });
  const gone = await set(P.denis, made.user.id);
  assert.equal(gone.status, 409);
  assert.equal(gone.body.error, 'revoked');
  assert.match(gone.body.message, /новый код/);
  // 20 загрузок за 10 минут на того, кто ставит, кому бы он ни ставил; отказы выше в счет не шли
  for (let i = 0; i < 20; i++) assert.equal((await set(P.denis, P.petya.user.id, i % 2 ? JPEG : WEBP)).status, 200, String(i));
  const over = await set(P.denis, P.petya.user.id);
  assert.equal(over.status, 429);
  assert.equal((await s.req('POST', 'me/avatar', { body: { image: JPEG }, token: P.petya.token })).status, 200, 'у самого игрока свой счетчик');
});

test('ревью 13.11: при отказе загруженный файл не остается лежать', async () => {
  const store = memoryStore();
  const s = setup(store);
  const P = await two(s);
  const id = P.petya.user.id;
  const tokens = [];
  const put = store.setAvatar;
  store.setAvatar = async (t, pic) => { tokens.push(t); return put(t, pic); };
  // отзыв кода посреди загрузки
  const cas = store.casUser;
  store.casUser = async (before, after) => {
    store.casUser = cas;
    await s.req('POST', `admin/users/${id}/revoke`, { body: {}, token: P.denis.token });
    return cas(before, after);
  };
  assert.equal((await s.req('POST', 'me/avatar', { body: { image: JPEG }, token: P.petya.token })).status, 409);
  assert.equal(tokens.length, 1);
  assert.equal((await s.req('GET', `avatar/${tokens[0]}`)).status, 404, 'файл стерт');
  // база отказала посреди записи
  const s2 = setup(store);
  const made = (await s2.req('POST', 'admin/users', { body: { name: 'Вася' }, token: P.denis.token })).body;
  const vasya = (await s2.req('POST', 'activate', { body: { code: made.code } })).body;
  store.casUser = async () => { store.casUser = cas; throw new Error('база недоступна'); };
  const err = console.error;
  console.error = () => {}; // сервер пишет сбой в журнал: в выводе тестов он не нужен
  const r = await s2.req('POST', 'me/avatar', { body: { image: JPEG }, token: vasya.token });
  console.error = err;
  assert.equal(r.status, 500);
  assert.equal(tokens.length, 2);
  assert.equal((await s2.req('GET', `avatar/${tokens[1]}`)).status, 404, 'и этот файл стерт');
  assert.equal((await store.getUser(vasya.user.id)).avatar ?? null, null);
});

test('ревью 13.11: сбой при стирании старого файла не отменяет смену фото', async () => {
  const store = memoryStore();
  const s = setup(store);
  const P = await two(s);
  const first = (await s.req('POST', 'me/avatar', { body: { image: JPEG }, token: P.petya.token })).body.user.avatar;
  const del = store.delAvatar;
  store.delAvatar = async () => { store.delAvatar = del; throw new Error('файл не стерся'); };
  const err = console.error;
  console.error = () => {};
  const r = await s.req('POST', 'me/avatar', { body: { image: WEBP }, token: P.petya.token });
  console.error = err;
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.notEqual(r.body.user.avatar, first);
  assert.equal((await s.req('GET', 'me', { token: P.petya.token })).body.avatar, r.body.user.avatar);
});
