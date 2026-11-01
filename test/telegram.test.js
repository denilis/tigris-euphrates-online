// Сообщения в чат Telegram: тексты, отправка и правила, когда они уходят.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';
import { telegram, invited, SITE } from '../server/telegram.js';

const ENV = { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' };
const TOKEN = '123456789:SECRET-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const LIVE = { VERCEL_ENV: 'production', TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '-100500' };
const MINUTE = 60 * 1000, HOUR = 60 * MINUTE;

/** Подставной Telegram: запоминает сообщения. fail: отвечать отказом. */
function fakeChat() {
  const tg = {
    on: true, fail: false, sent: [],
    say: async (m) => {
      if (tg.fail) return false;
      tg.sent.push(m);
      return true;
    },
  };
  return tg;
}

function setup(store = memoryStore()) {
  const tg = fakeChat();
  const app = createApp({ store, env: ENV, now: () => Date.now(), botOptions: { timeCap: 20 }, tg });
  const req = (method, path, { body, token } = {}) => app.call({ method, path, body, token });
  const login = async (code) => (await req('POST', 'activate', { body: { code } })).body;
  return { app, tg, req, login, store };
}

/** Денис и Андрей с готовыми сессиями. */
async function pair(s) {
  const denis = await s.login('ADMN-TEST-2345');
  const r = await s.req('POST', 'admin/users', { body: { name: 'Андрей' }, token: denis.token });
  return { denis, andrey: await s.login(r.body.code) };
}

const clock = (t) => t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 1, 12, 0) });

// --- отправка

test('отправка: простой текст с кнопкой-ссылкой в нужный чат', async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const ok = await telegram(LIVE, { fetchFn }).say({ text: 'Привет <b>', button: 'Открыть', url: SITE });
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].body.chat_id, '-100500');
  assert.equal(calls[0].body.text, 'Привет <b>');
  assert.equal(calls[0].body.parse_mode, undefined, 'имена игроков не разбираются как разметка');
  assert.deepEqual(calls[0].body.reply_markup, { inline_keyboard: [[{ text: 'Открыть', url: SITE }]] });
});

test('отправка: лишний текст вокруг токена не портит адрес', async () => {
  const pasted = [
    ` ${TOKEN}
`,
    `bot${TOKEN}`,
    `Use this token to access the HTTP API: ${TOKEN} Keep your token secure`,
    `https://api.telegram.org/bot${TOKEN}/getMe`,
  ];
  for (const value of pasted) {
    const calls = [];
    const fetchFn = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    const tg = telegram({ ...LIVE, TELEGRAM_BOT_TOKEN: value, TELEGRAM_CHAT_ID: ' -100500 ' }, { fetchFn });
    assert.equal(tg.on, true, value);
    await tg.say({ text: 'x', button: 'y', url: SITE });
    assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`, value);
    assert.equal(calls[0].body.chat_id, '-100500');
  }
});

test('отправка: значение не похоже на токен, чат считается не подключенным', async () => {
  const fetchFn = async () => assert.fail('в сеть ходить нельзя');
  for (const value of ['123:SECRET', TOKEN.slice(0, 20), 'SECRET-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'токен']) {
    assert.equal(telegram({ ...LIVE, TELEGRAM_BOT_TOKEN: value }, { fetchFn }).on, false, value);
  }
});

test('отправка: только на основном сайте и только при полной настройке', async () => {
  const fetchFn = async () => assert.fail('в сеть ходить нельзя');
  const off = [
    {},
    { ...LIVE, VERCEL_ENV: 'preview' },
    { ...LIVE, VERCEL_ENV: undefined },
    { ...LIVE, TELEGRAM_BOT_TOKEN: '' },
    { ...LIVE, TELEGRAM_CHAT_ID: '' },
  ];
  for (const env of off) {
    const tg = telegram(env, { fetchFn });
    assert.equal(tg.on, false);
    assert.equal(await tg.say({ text: 'x', button: 'y', url: SITE }), false);
  }
  assert.equal(telegram(LIVE, { fetchFn }).on, true);
});

test('отправка: сбой Telegram не бросает ошибку, а токен не попадает в журнал', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...a) => logged.push(a.map(String).join(' ')));
  const replies = [
    async () => ({ ok: false, status: 403, json: async () => ({ ok: false, description: 'Forbidden: bot was kicked' }) }),
    async () => ({ ok: false, status: 502, json: async () => { throw new Error('не JSON'); } }),
    async (url) => { throw new Error(`fetch failed ${url}`); },
  ];
  for (const fetchFn of replies) {
    assert.equal(await telegram(LIVE, { fetchFn }).say({ text: 'x', button: 'y', url: SITE }), false);
  }
  assert.equal(logged.length, replies.length);
  assert.ok(!logged.join('\n').includes('SECRET'), logged.join('\n'));
  assert.match(logged[0], /403/);
});

test('отправка: завис Telegram, ждем не дольше срока', async () => {
  const fetchFn = (url, init) => new Promise((_, no) => init.signal.addEventListener('abort', () => no(new Error('abort'))));
  const errors = console.error;
  console.error = () => {};
  try {
    assert.equal(await telegram(LIVE, { fetchFn, waitMs: 10 }).say({ text: 'x', button: 'y', url: SITE }), false);
  } finally {
    console.error = errors;
  }
});

// --- тексты

test('тексты: приглашение ведет на стол', () => {
  const m = invited('Денис', { code: 'ABC234', title: '01.11.2026.3' }, 2);
  assert.equal(m.text, 'Денис зовёт на партию\nСтол 01.11.2026.3, свободно мест: 2');
  assert.equal(m.button, 'Сесть за стол');
  assert.equal(m.url, `${SITE}#/t/ABC234`);
  assert.match(invited('Денис', { code: 'ABC234' }, 1).text, /Стол ABC234,/, 'без названия показываем код');
});

// --- в чат идут только приглашения

test('чат: появление на сайте не сообщается, пульс не тратит счетчик', async (t) => {
  clock(t);
  const store = memoryStore();
  const s = setup(store);
  const { denis, andrey } = await pair(s);
  let hits = 0;
  const hit = store.hit;
  store.hit = async (...args) => { hits++; return hit(...args); };
  const beat = (who) => s.req('POST', 'beat', { body: { busy: false }, token: who.token });

  assert.equal((await beat(denis)).status, 200);
  assert.equal((await beat(andrey)).status, 200);
  t.mock.timers.tick(4 * HOUR);
  assert.equal((await beat(denis)).status, 200);
  assert.equal(s.tg.sent.length, 0);
  assert.equal(hits, 0);
});

// --- позвать в чат

test('позвать в чат: за столом можно, посторонним нельзя', async () => {
  const s = setup();
  const { denis, andrey } = await pair(s);
  const { code } = (await s.req('POST', 'tables', { token: denis.token })).body;
  const call = (who, c = code) => s.req('POST', 'invite/chat', { body: { code: c }, token: who?.token });

  assert.equal((await call(null)).status, 401);
  assert.equal((await call(andrey)).status, 403, 'не сидит за столом');
  assert.equal((await call(denis, 'NOSUCH')).status, 404);
  assert.equal(s.tg.sent.length, 0);

  assert.equal((await call(denis)).status, 200);
  assert.equal(s.tg.sent.length, 1);
  assert.match(s.tg.sent[0].text, /^Денис зовёт на партию\n/);
  assert.match(s.tg.sent[0].text, /свободно мест: 2$/, 'мест для людей два, четвертое у бота');
  assert.equal(s.tg.sent[0].url, `${SITE}#/t/${code}`);
});

test('позвать в чат: повтор через 3 минуты', async (t) => {
  clock(t);
  const s = setup();
  const { denis } = await pair(s);
  const { code } = (await s.req('POST', 'tables', { token: denis.token })).body;
  const call = () => s.req('POST', 'invite/chat', { body: { code }, token: denis.token });

  assert.equal((await call()).status, 200);
  const again = await call();
  assert.equal(again.status, 429);
  assert.match(again.body.message, /Уже позвали/);
  assert.equal(s.tg.sent.length, 1);

  t.mock.timers.tick(3 * MINUTE + 1000);
  assert.equal((await call()).status, 200);
  assert.equal(s.tg.sent.length, 2);
});

test('позвать в чат: новые столы не обходят лимит игрока', async (t) => {
  clock(t);
  const s = setup();
  const { denis } = await pair(s);
  const call = async () => {
    const { code } = (await s.req('POST', 'tables', { token: denis.token })).body;
    return s.req('POST', 'invite/chat', { body: { code }, token: denis.token });
  };
  for (let k = 0; k < 3; k++) assert.equal((await call()).status, 200);
  assert.equal((await call()).status, 429);
  assert.equal(s.tg.sent.length, 3);

  t.mock.timers.tick(3 * MINUTE + 1000);
  assert.equal((await call()).status, 200);
});

test('позвать в чат: не ушло, сразу можно повторить', async () => {
  const s = setup();
  const { denis } = await pair(s);
  const { code } = (await s.req('POST', 'tables', { token: denis.token })).body;
  const call = () => s.req('POST', 'invite/chat', { body: { code }, token: denis.token });

  s.tg.fail = true;
  const r = await call();
  assert.equal(r.status, 502);
  assert.match(r.body.message, /Не удалось/);

  s.tg.fail = false;
  assert.equal((await call()).status, 200);
  assert.equal(s.tg.sent.length, 1);
});

test('позвать в чат: чат не подключен', async () => {
  const s = setup();
  const { denis } = await pair(s);
  const { code } = (await s.req('POST', 'tables', { token: denis.token })).body;
  s.tg.on = false;
  const r = await s.req('POST', 'invite/chat', { body: { code }, token: denis.token });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'no-chat');
});

test('позвать в чат: мест нет или партия уже идет', async () => {
  const s = setup();
  const { denis } = await pair(s);
  const { code } = (await s.req('POST', 'tables', { token: denis.token })).body;
  const post = (body) => s.req('POST', `tables/${code}`, { body, token: denis.token });
  const call = () => s.req('POST', 'invite/chat', { body: { code }, token: denis.token });

  await post({ action: 'seatKind', seat: 1, kind: 'bot' });
  await post({ action: 'seatKind', seat: 2, kind: 'bot' });
  assert.equal((await call()).status, 409, 'все места заняты');

  await post({ action: 'hero', seat: 0, hero: 'lion' });
  assert.equal((await post({ action: 'start' })).status, 200);
  assert.equal((await call()).body.error, 'not-lobby');
  assert.equal(s.tg.sent.filter((m) => /зовёт/.test(m.text)).length, 0);
});

async function ready(s, denis, andrey) {
  const { code } = (await s.req('POST', 'tables', { token: denis.token })).body;
  const post = (who, body) => s.req('POST', `tables/${code}`, { body, token: who.token });
  await post(denis, { action: 'hero', seat: 0, hero: 'lion' });
  if (andrey) {
    await post(andrey, { action: 'sit', seat: 1 });
    await post(andrey, { action: 'hero', seat: 1, hero: 'bull' });
    await post(denis, { action: 'seatKind', seat: 2, kind: 'bot' });
  } else {
    await post(denis, { action: 'seatKind', seat: 1, kind: 'bot' });
    await post(denis, { action: 'seatKind', seat: 2, kind: 'bot' });
  }
  return { code, start: () => post(denis, { action: 'start' }) };
}

test('позвать в чат: стол заполнен людьми, сообщение называет их', async () => {
  const s = setup();
  const { denis, andrey } = await pair(s);
  const { code } = (await s.req('POST', 'tables', { token: denis.token })).body;
  const post = (who, body) => s.req('POST', `tables/${code}`, { body, token: who.token });
  await post(denis, { action: 'seatCount', n: 2 });
  await post(andrey, { action: 'sit', seat: 1 });
  const r = await s.req('POST', 'invite/chat', { body: { code }, token: denis.token });
  assert.equal(r.status, 200);
  assert.match(s.tg.sent.at(-1).text, /^Денис зовёт за стол: Андрей/);
  assert.equal(s.tg.sent.at(-1).url, `${SITE}#/t/${code}`);
});

test('чат: начало партии не сообщается, ни с людьми, ни с ботами', async () => {
  const s = setup();
  const { denis, andrey } = await pair(s);
  assert.equal((await (await ready(s, denis, andrey)).start()).status, 200);
  assert.equal((await (await ready(s, denis)).start()).status, 200);
  assert.equal(s.tg.sent.length, 0);
});

/** Закончить партию без игры: реванш смотрит только на итог. */
async function finish(store, code) {
  const cur = await store.getTable(code);
  cur.doc.status = 'over';
  cur.doc.game.historySaved = true;
  cur.doc.game.result = { finishedAt: Date.now(), seats: cur.doc.seats.map((x, i) => ({ seatId: x.id, place: i + 1, vector: [] })) };
  cur.doc.version += 1;
  assert.equal(await store.putTable(cur.doc, cur.version, ''), true);
}

test('чат: реванш не сообщается, новый стол попадает в списки игроков', async () => {
  const s = setup();
  const { denis, andrey } = await pair(s);
  const { code, start } = await ready(s, denis, andrey);
  await start();
  await finish(s.store, code);
  const r = await s.req('POST', `tables/${code}`, { body: { action: 'rematch' }, token: andrey.token });
  assert.equal(r.status, 200);
  assert.ok(r.body.next, 'реванш создан');
  assert.equal(s.tg.sent.length, 0);
  const mine = (await s.req('GET', 'tables', { token: denis.token })).body;
  assert.ok(mine.some((x) => x.code === r.body.next), 'стол реванша у соперника');
});

test('ping показывает, подключен ли чат', async () => {
  const s = setup();
  assert.equal((await s.req('GET', 'ping')).body.chat, true);
  s.tg.on = false;
  assert.equal((await s.req('GET', 'ping')).body.chat, false);
});
