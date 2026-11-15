// Уведомления браузера «Ваш ход» (15.11, дорожная карта п.10, схема одобрена Денисом) без
// npm-зависимостей: шифрование содержимого aes128gcm по RFC 8291 и подпись VAPID (RFC 8292,
// ES256) на node:crypto. Шифрование сверено с примером RFC 8291 байт в байт (test/webpush.test.js).
import { createECDH, createCipheriv, createPrivateKey, hkdfSync, randomBytes, sign } from 'node:crypto';

export const b64u = (buf) => Buffer.from(buf).toString('base64url');
export const unb64u = (s) => Buffer.from(String(s), 'base64url');

const RECORD = 4096;

/**
 * Зашифровать payload (строка или Buffer) для подписки { p256dh, auth } (base64url из
 * PushSubscription.toJSON().keys). asPrivate и salt задают только тесты (пример RFC).
 */
export function encryptPayload({ p256dh, auth }, payload, { asPrivate = null, salt = randomBytes(16) } = {}) {
  const ua = unb64u(p256dh), secret = unb64u(auth);
  if (ua.length !== 65 || ua[0] !== 4) throw new Error('ключ подписки не P-256');
  if (secret.length !== 16) throw new Error('секрет подписки не 16 байт');
  const ecdh = createECDH('prime256v1');
  if (asPrivate) ecdh.setPrivateKey(asPrivate);
  else ecdh.generateKeys();
  const as = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(ua);
  const ikm = Buffer.from(hkdfSync('sha256', shared, secret, Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([2])]); // одна запись, последняя: разделитель 0x02
  if (plain.length + 16 > RECORD) throw new Error('уведомление длиннее одной записи');
  const c = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21);
  salt.copy(head, 0);
  head.writeUInt32BE(RECORD, 16);
  head.writeUInt8(as.length, 20);
  return Buffer.concat([head, as, body]);
}

/** Пара ключей VAPID: public 65 байт несжатой точки P-256, private 32 байта, оба base64url. */
export function vapidKeys() {
  const e = createECDH('prime256v1');
  e.generateKeys();
  return { publicKey: b64u(e.getPublicKey()), privateKey: b64u(e.getPrivateKey()) };
}

/** Заголовок Authorization для службы уведомлений endpoint (JWT ES256 на 12 часов). */
export function vapidAuth(endpoint, { publicKey, privateKey, subject }, now = Date.now()) {
  const pub = unb64u(publicKey);
  const key = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${publicKey}`;
}

/** Подписка из браузера годится: https-адрес службы и ключи нужной длины. */
export function cleanSubscription(sub) {
  const endpoint = String(sub?.endpoint || '');
  const p256dh = String(sub?.keys?.p256dh || ''), auth = String(sub?.keys?.auth || '');
  if (!/^https:\/\/[^\s]{8,500}$/.test(endpoint)) return null;
  try {
    if (unb64u(p256dh).length !== 65 || unb64u(auth).length !== 16) return null;
  } catch {
    return null;
  }
  return { endpoint, keys: { p256dh, auth } };
}

/**
 * Отправить уведомление. Ответ { ok, gone }: gone, если служба забыла подписку (404, 410),
 * такую подписку надо удалить. Ошибка сети не роняет ход: { ok: false }.
 */
export async function sendPush(sub, data, vapid, { fetchImpl = fetch, ttl = 3600, now = Date.now() } = {}) {
  try {
    const r = await fetchImpl(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuth(sub.endpoint, vapid, now),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttl),
        Urgency: 'high',
      },
      body: encryptPayload(sub.keys, JSON.stringify(data)),
      signal: AbortSignal.timeout(4000),
    });
    return { ok: r.status >= 200 && r.status < 300, gone: r.status === 404 || r.status === 410, status: r.status };
  } catch {
    return { ok: false, gone: false, status: 0 };
  }
}

/** Настройки VAPID из окружения или null (уведомления выключены). */
export function vapidFromEnv(env) {
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) return null;
  return { publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE, subject: env.VAPID_SUBJECT || 'https://tigris-euphrates-online.vercel.app' };
}
