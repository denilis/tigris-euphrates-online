// Вход по личному коду (решение Дениса 28.10): код выдаёт админ, в базе только отпечаток
// кода с солью, сессия — подписанный токен в браузере. Пароли и почту не храним.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cryptoRng } from '../game/random.js';

// без похожих знаков: нет 0/O, 1/I/L
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 12;
const CODE_MIN = 8, CODE_MAX = 20; // границы для кода, вписанного вручную
// русские буквы, которые на клавиатуре выглядят как латинские в коде
const CYR = { А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', К: 'K', М: 'M', О: 'O', Р: 'P', Т: 'T', Х: 'X', У: 'Y' };

const pick = (alphabet, n, rng) => Array.from({ length: n }, () => alphabet[Math.floor(rng() * alphabet.length)]).join('');

/** Новый код вида ABCD-EFGH-JK23 (31^12, около 8·10^17 вариантов). */
export function newCode(rng = cryptoRng()) {
  const c = pick(CODE_ALPHABET, CODE_LEN, rng);
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}

/** Код стола: 6 знаков из того же алфавита. */
export function newTableCode(rng = cryptoRng()) {
  return pick(CODE_ALPHABET, 6, rng);
}

/** Привести ввод к виду кода; null, если это не код. */
export function normalizeCode(input) {
  // самый длинный честный ввод: код с дефисами и пробелами; мегабайты не разбираем
  if (typeof input !== 'string' || input.length > 64) return null;
  const s = [...input.toUpperCase()].map((ch) => CYR[ch] || ch).join('').replace(/[\s-]/g, '');
  return s.length >= CODE_MIN && s.length <= CODE_MAX && /^[A-Z0-9]+$/.test(s) ? s : null;
}

export function codeHash(code, pepper) {
  return createHmac('sha256', pepper).update(normalizeCode(code) || '').digest('hex');
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (body, secret) => createHmac('sha256', secret).update(body).digest('base64url');

/** epoch — номер сессии пользователя: отзыв и новый код увеличивают его, старые токены гаснут. */
export function signSession(userId, secret, iat = Date.now(), epoch = 0) {
  const body = b64(JSON.stringify({ u: userId, iat, e: epoch }));
  return `${body}.${sign(body, secret)}`;
}

/** { userId, iat, epoch } из токена или null, если токен испорчен или подписан чужим секретом. */
export function readSession(token, secret) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const want = Buffer.from(sign(parts[0], secret));
  const got = Buffer.from(parts[1]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const { u, iat, e } = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return typeof u === 'string' ? { userId: u, iat, epoch: Number.isInteger(e) ? e : 0 } : null;
  } catch {
    return null;
  }
}
