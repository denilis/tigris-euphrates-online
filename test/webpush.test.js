// Уведомления (15.11): шифрование по примеру RFC 8291 байт в байт, подпись VAPID проверяется
// открытым ключом, подписка проверяется, ответы службы разбираются.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify, createECDH, createDecipheriv, hkdfSync } from 'node:crypto';
import { encryptPayload, vapidKeys, vapidAuth, cleanSubscription, sendPush, b64u, unb64u } from '../server/webpush.js';

// RFC 8291, раздел 5 и приложение A
const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml'
    + 'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT'
    + 'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

test('шифрование совпадает с примером RFC 8291', () => {
  const body = encryptPayload({ p256dh: RFC.uaPublic, auth: RFC.auth }, unb64u(RFC.plaintext), { asPrivate: unb64u(RFC.asPrivate), salt: unb64u(RFC.salt) });
  assert.equal(b64u(body), RFC.body);
});

test('свое сообщение расшифровывается ключом браузера', () => {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = b64u(Buffer.alloc(16, 7));
  const msg = JSON.stringify({ title: 'Тигр и Евфрат: ваш ход', url: '/#/t/ABCDEF' });
  const body = encryptPayload({ p256dh: b64u(ua.getPublicKey()), auth }, msg);
  const salt = body.subarray(0, 16), idlen = body[20], as = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const shared = ua.computeSecret(as);
  const ikm = Buffer.from(hkdfSync('sha256', shared, unb64u(auth), Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), as]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2);
  assert.equal(plain.subarray(0, -1).toString(), msg);
});

test('подпись VAPID: JWT проверяется открытым ключом, адресат и срок верные', () => {
  const keys = vapidKeys();
  const h = vapidAuth('https://fcm.googleapis.com/fcm/send/abc', { ...keys, subject: 'https://example.test' }, 1_800_000_000_000);
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(h);
  assert.equal(k, keys.publicKey);
  const [head, body, sig] = jwt.split('.');
  const claims = JSON.parse(unb64u(body).toString());
  assert.deepEqual(claims, { aud: 'https://fcm.googleapis.com', exp: 1_800_000_000 + 12 * 3600, sub: 'https://example.test' });
  const pub = unb64u(keys.publicKey);
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' }, unb64u(sig)));
});

test('подписка из браузера проверяется', () => {
  const ok = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: RFC.uaPublic, auth: RFC.auth } };
  assert.deepEqual(cleanSubscription({ ...ok, extra: 1 }), ok);
  assert.equal(cleanSubscription({ ...ok, endpoint: 'http://x.test/push' }), null, 'только https');
  assert.equal(cleanSubscription({ ...ok, keys: { p256dh: 'AAAA', auth: RFC.auth } }), null);
  assert.equal(cleanSubscription(null), null);
});

test('ответ службы: 201 хорошо, 410 подписка забыта, сбой сети не падает', async () => {
  const sub = { endpoint: 'https://push.example.test/x', keys: { p256dh: RFC.uaPublic, auth: RFC.auth } };
  const vapid = { ...vapidKeys(), subject: 'https://example.test' };
  let seen = null;
  const ok = await sendPush(sub, { title: 't' }, vapid, { fetchImpl: async (url, o) => { seen = o; return { status: 201 }; } });
  assert.deepEqual(ok, { ok: true, gone: false, status: 201 });
  assert.equal(seen.headers['Content-Encoding'], 'aes128gcm');
  assert.match(seen.headers.Authorization, /^vapid t=/);
  assert.deepEqual(await sendPush(sub, {}, vapid, { fetchImpl: async () => ({ status: 410 }) }), { ok: false, gone: true, status: 410 });
  assert.deepEqual(await sendPush(sub, {}, vapid, { fetchImpl: async () => { throw new Error('нет сети'); } }), { ok: false, gone: false, status: 0 });
});
