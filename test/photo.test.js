// Картинка итога в чат ДВАК (этап 4 пакета 04.11): только jpeg или png, только законченная
// партия, только свои люди, не чаще раза в минуту, только на основном сайте.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhoto, photoCaption } from '../server/photo.js';
import { telegram } from '../server/telegram.js';
import { createApp } from '../server/routes.js';
import { makeHandler, bodyLimit } from '../api/index.js';
import { Readable } from 'node:stream';
import { memoryStore } from '../server/store-memory.js';
import { viewFor } from '../game/view.js';
import { canSendPhoto, pictureRows, placePoints, tourLine, pictureName } from '../public/js/endshot-core.js';
import { started, playOut, USERS, T0 } from './support.js';

const ENV = { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' };
const jpeg = () => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 7)]).toString('base64');
const png = () => 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(400, 1)]).toString('base64');

test('картинка: принимаются только настоящие jpeg и png разумного размера', () => {
  assert.equal(parsePhoto(jpeg()).type, 'image/jpeg');
  assert.equal(parsePhoto(png()).type, 'image/png');
  assert.equal(parsePhoto('data:image/svg+xml;base64,' + Buffer.from('<svg onload=alert(1)>' + ' '.repeat(200)).toString('base64')), null, 'svg');
  assert.equal(parsePhoto('data:image/jpeg;base64,' + Buffer.alloc(400, 7).toString('base64')), null, 'тип jpeg, а внутри не jpeg');
  assert.equal(parsePhoto('data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff]).toString('base64')), null, 'слишком маленькая');
  assert.equal(parsePhoto('data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2_600_000)]).toString('base64')), null, 'больше 2,5 МБ');
  assert.equal(parsePhoto(null), null);
});

test('картинка: подпись с местами по итогу и тем, кто отправил', () => {
  const t = started(51);
  playOut(t, 51);
  const cap = photoCaption({ ...t, title: '04.11.2026.5' }, 'Денис');
  assert.match(cap, /^Итог партии 04\.11\.2026\.5\n1\. /);
  assert.equal(cap.split('\n').length, 1 + t.seats.length + 1);
  assert.match(cap, /Отправил Денис$/);
});

test('Telegram: картинка уходит формой sendPhoto в чат компании, только на основном сайте', async () => {
  const calls = [];
  const fetchFn = async (url, opts) => { calls.push({ url, body: opts.body }); return { ok: true }; };
  const env = { TELEGRAM_BOT_TOKEN: '123456:' + 'a'.repeat(35), TELEGRAM_CHAT_ID: '-100500', VERCEL_ENV: 'production' };
  const bytes = parsePhoto(jpeg()).bytes;
  assert.equal(await telegram(env, { fetchFn }).photo({ bytes, type: 'image/jpeg', caption: 'итог', button: 'Открыть стол', url: 'https://x/#/t/AAAAAA' }), true);
  assert.match(calls[0].url, /\/sendPhoto$/);
  const form = calls[0].body;
  assert.equal(form.get('chat_id'), '-100500');
  assert.equal(form.get('caption'), 'итог');
  assert.equal(form.get('photo').type, 'image/jpeg');
  assert.equal(form.get('photo').size, bytes.length);
  assert.match(form.get('reply_markup'), /Открыть стол/);
  assert.equal(await telegram({ ...env, VERCEL_ENV: 'preview' }, { fetchFn }).photo({ bytes, type: 'image/jpeg', caption: '', button: '', url: '' }), false);
  assert.equal(calls.length, 1, 'превью молчит');
});

test('API: картинка итога в чат: 409 до конца, 403 чужим, 400 не картинка, 200, второй раз 429', async () => {
  const store = memoryStore();
  const sent = [];
  const tg = { on: true, say: async () => true, photo: async (m) => { sent.push(m); return true; } };
  const app = createApp({ store, env: ENV, now: () => T0, botOptions: { timeCap: 20 }, tg });
  const playing = { ...started(52), code: 'PLAY02' };
  const over = { ...started(53), code: 'OVER02', title: '04.11.2026.7' };
  playOut(over, 53);
  const alien = { ...started(54), code: 'ALIEN1' };
  playOut(alien, 54);
  alien.seats = alien.seats.map((s) => (s.name === 'Влад' ? { ...s, name: 'Петя' } : s));
  for (const t of [playing, over, alien]) assert.ok(await store.putTable(t, null));
  const { token } = (await app.call({ method: 'POST', path: 'activate', body: { code: 'ADMN-TEST-2345' } })).body;
  const post = (code, image = jpeg()) => app.call({ method: 'POST', path: `tables/${code}/photo`, body: { image }, token });
  assert.equal((await post('PLAY02')).status, 409);
  assert.equal((await post('ALIEN1')).status, 403, 'за столом чужой человек');
  assert.equal((await post('OVER02', 'data:text/plain;base64,AAAA')).status, 400);
  const ok = await post('OVER02');
  assert.equal(ok.status, 200);
  assert.equal(sent.length, 1);
  assert.match(sent[0].caption, /^Итог партии 04\.11\.2026\.7/);
  assert.match(sent[0].url, /#\/t\/OVER02$/);
  assert.equal((await post('OVER02')).status, 429, 'не чаще раза в минуту');
  const off = createApp({ store, env: ENV, now: () => T0, tg: { on: false, say: async () => false, photo: async () => false } });
  const t2 = (await off.call({ method: 'POST', path: 'activate', body: { code: 'ADMN-TEST-2345' } })).body.token;
  assert.equal((await off.call({ method: 'POST', path: 'tables/OVER02/photo', body: { image: jpeg() }, token: t2 })).status, 503);
});

test('картинка в браузере: кнопка чата только своим, места, очки зачета, строка турнира', () => {
  const t = started(55);
  playOut(t, 55);
  const v = viewFor(t, USERS.denis.userId, { now: T0 });
  assert.equal(canSendPhoto(v, 'Денис'), true);
  assert.equal(canSendPhoto(v, 'Петя'), false, 'смотрит чужой');
  assert.equal(canSendPhoto({ ...v, status: 'playing' }, 'Денис'), false);
  assert.equal(canSendPhoto({ ...v, seats: v.seats.map((s) => (s.name === 'Влад' ? { ...s, name: 'Петя' } : s)) }, 'Денис'), false, 'за столом чужой');
  const rows = pictureRows(v);
  assert.deepEqual(rows.map((r) => r.place), [...rows.map((r) => r.place)].sort((a, b) => a - b));
  assert.equal(rows.length, 4);
  assert.deepEqual(placePoints([1, 2, 3, 4]), [4, 2, 1, 0]);
  assert.deepEqual(placePoints([1, 1, 3, 4]), [2, 2, 1, 0]);
  const tours = [{ id: 'season', name: 'Сезон: Денис, Влад, Андрей', players: ['Денис', 'Влад', 'Андрей'] }];
  const line = tourLine(tours, v);
  assert.match(line, /^Сезон: Денис, Влад, Андрей: /);
  assert.equal((line.match(/\+\d/g) || []).length, 3, 'у бота очков зачета нет');
  assert.equal(tourLine(tours, { ...v, options: { ...v.options, tournament: 'none' } }), null);
  assert.equal(pictureName({ title: '04.11.2026.2', code: 'X' }), 'итог-04.11.2026.2.jpg');
});

// предел тела запроса: картинке итога можно до 3,6 МБ, остальным адресам по-прежнему 32 КБ

test('предел тела: большая картинка проходит только на адрес картинки', async () => {
  assert.equal(bodyLimit('tables/ABC123/photo'), 3600 * 1024);
  assert.equal(bodyLimit('tables/ABC123'), 32 * 1024);
  assert.equal(bodyLimit('me/avatar'), 32 * 1024);
  const h = makeHandler(ENV, memoryStore());
  const call = async (route, body) => {
    const req = Readable.from([Buffer.from(body)]);
    Object.assign(req, { method: 'POST', url: `/api/index?route=${route}`, headers: {} });
    const res = { statusCode: 0, out: '', setHeader() {}, end(s) { this.out = s || ''; } };
    await h(req, res);
    return res.statusCode;
  };
  const big = JSON.stringify({ image: 'data:image/jpeg;base64,' + 'A'.repeat(600 * 1024) });
  assert.equal(await call('tables/ABC123/photo', big), 401, 'дошло до сервера: нужен вход');
  assert.equal(await call('tables/ABC123', big), 413);
});
