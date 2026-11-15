// Уведомления «Ваш ход» (15.11): подписка устройства, уведомление следующему человеку один раз
// за ход, забытая службой подписка удаляется, проверка и выключение.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';
import { vapidKeys, b64u } from '../server/webpush.js';

const keys = vapidKeys();
const ENV = { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис', VAPID_PUBLIC: keys.publicKey, VAPID_PRIVATE: keys.privateKey };
const device = (n) => {
  const e = createECDH('prime256v1');
  e.generateKeys();
  return { endpoint: `https://push.example.test/dev${n}`, keys: { p256dh: b64u(e.getPublicKey()), auth: b64u(Buffer.alloc(16, n)) } };
};

function setup(env = ENV) {
  const sent = [];
  let status = 201;
  const app = createApp({ store: memoryStore(), env, now: () => 1_800_000_000_000, pushFetch: async (url, o) => { sent.push({ url, o }); return { status }; } });
  const req = (method, path, body, token, query) => app.call({ method, path, body, token, query });
  return { req, sent, setStatus: (s) => { status = s; } };
}

async function people(s) {
  const denis = (await s.req('POST', 'activate', { code: 'ADMN-TEST-2345' })).body;
  const petya = (await s.req('POST', 'activate', { code: (await s.req('POST', 'admin/users', { name: 'Петя' }, denis.token)).body.code })).body;
  return { denis, petya };
}

async function game(s, { denis, petya }) {
  const { code } = (await s.req('POST', 'tables', undefined, denis.token)).body;
  const act = (b, tok = denis.token) => s.req('POST', `tables/${code}`, b, tok);
  await act({ action: 'seatCount', n: 2 });
  await act({ action: 'sit', seat: 1 }, petya.token);
  await act({ action: 'hero', seat: 1, hero: 'bull' }, petya.token);
  await s.req('GET', `tables/${code}/poll`, undefined, petya.token, { here: '1' });
  await act({ action: 'options', options: { order: 'custom' } });
  const r = await act({ action: 'start' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { code, act, view: r.body };
}

/** Сделать ход до конца: два действия первым допустимым тайлом и «Завершить ход». */
async function wholeTurn(act, view, tok) {
  let v = view;
  for (let k = 0; k < 3 && v.game.toMove === v.me; k++) {
    const i = v.game.legal.findIndex((m) => m.type === 'tile' || m.type === 'confirm');
    const r = await act({ action: 'move', version: v.version, index: i }, tok);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    v = r.body;
  }
  return v;
}

test('без ключей уведомления выключены', async () => {
  const s = setup({ ...ENV, VAPID_PUBLIC: '', VAPID_PRIVATE: '' });
  const { denis } = await people(s);
  assert.equal((await s.req('GET', 'push/key')).status, 501);
  assert.equal((await s.req('POST', 'me/push', { subscription: device(1) }, denis.token)).status, 501);
});

test('ход перешел к Пете: уведомление на его устройство один раз', async () => {
  const s = setup();
  const P = await people(s);
  assert.equal((await s.req('GET', 'push/key')).body.key, keys.publicKey);
  assert.equal((await s.req('POST', 'me/push', { subscription: device(1) }, P.petya.token)).body.devices, 1);
  assert.equal((await s.req('POST', 'me/push', { subscription: { endpoint: 'http://x' } }, P.petya.token)).status, 400);
  const g = await game(s, P);
  assert.equal(s.sent.length, 0, 'Денис ходит первым, Пете пока нечего');
  const v = await wholeTurn(g.act, g.view, P.denis.token);
  assert.equal(v.game.toMove, 1);
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].url, 'https://push.example.test/dev1');
  assert.equal(s.sent[0].o.headers['Content-Encoding'], 'aes128gcm');
  await s.req('POST', `tables/${g.code}/bot-tick`, {}, P.denis.token);
  await s.req('GET', `tables/${g.code}`, undefined, P.petya.token);
  assert.equal(s.sent.length, 1, 'повторно за тот же ход не шлем');
});

test('забытая службой подписка удаляется, проверка и выключение', async () => {
  const s = setup();
  const P = await people(s);
  await s.req('POST', 'me/push', { subscription: device(1) }, P.denis.token);
  await s.req('POST', 'me/push', { subscription: device(2) }, P.denis.token);
  const t = await s.req('POST', 'me/push/test', {}, P.denis.token);
  assert.deepEqual(t.body, { sent: 2, gone: 0 });
  s.setStatus(410);
  assert.deepEqual((await s.req('POST', 'me/push/test', {}, P.denis.token)).body, { sent: 0, gone: 2 });
  assert.equal((await s.req('POST', 'me/push/test', {}, P.denis.token)).status, 409, 'устройств не осталось');
  s.setStatus(201);
  await s.req('POST', 'me/push', { subscription: device(3) }, P.denis.token);
  assert.equal((await s.req('POST', 'me/push/off', { endpoint: device(3).endpoint }, P.denis.token)).body.devices, 0);
  assert.equal((await s.req('POST', 'me/push')).status, 401);
});

test('служба уведомлений и блок профиля на месте', async () => {
  const { readFileSync } = await import('node:fs');
  const sw = readFileSync('public/sw.js', 'utf8');
  assert.match(sw, /addEventListener\('push'/);
  assert.match(sw, /addEventListener\('notificationclick'/);
  assert.match(sw, /w\.focused && w\.visibilityState === 'visible'/, 'видимая вкладка уведомление не показывает');
  assert.doesNotMatch(sw, /addEventListener\('fetch'/, 'сайт не кэшируется');
  const profile = readFileSync('public/js/profile.js', 'utf8');
  assert.match(profile, /id="pushBox"/);
  assert.match(profile, /bindPush\(app\)/);
});
