// Сообщения в чат Telegram: тексты, отправка и правила, когда они уходят.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';
import { telegram, arrived, invited, started, SITE } from '../server/telegram.js';

const ENV = { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' };
const LIVE = { VERCEL_ENV: 'production', TELEGRAM_BOT_TOKEN: '123:SECRET', TELEGRAM_CHAT_ID: '-100500' };
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
  assert.equal(calls[0].url, 'https://api.telegram.org/bot123:SECRET/sendMessage');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].body.chat_id, '-100500');
  assert.equal(calls[0].body.text, 'Привет <b>');
  assert.equal(calls[0].body.parse_mode, undefined, 'имена игроков не разбираются как разметка');
  assert.deepEqual(calls[0].body.reply_markup, { inline_keyboard: [[{ text: 'Открыть', url: SITE }]] });
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

test('тексты: игрок на сайте', () => {
  assert.deepEqual(arrived('Денис'), { text: 'Денис сейчас на сайте', button: 'Открыть сайт', url: SITE });
});

test('тексты: приглашение ведет на стол', () => {
  const m = invited('Денис', { code: 'ABC234', title: '01.11.2026.3' }, 2);
  assert.equal(m.text, 'Денис зовёт на партию\nСтол 01.11.2026.3, свободно мест: 2');
  assert.equal(m.button, 'Сесть за стол');
  assert.equal(m.url, `${SITE}#/t/ABC234`);
  assert.match(invited('Денис', { code: 'ABC234' }, 1).text, /Стол ABC234,/, 'без названия показываем код');
});

test('тексты: партия людей и партия с ботами', () => {
  const human = (name) => ({ kind: 'human', name });
  const bot = (name) => ({ kind: 'bot', name });
  const t = { code: 'ABC234', title: '01.11.2026.3' };
  const all = started({ ...t, seats: [human('Денис'), human('Андрей'), human('Влад'), bot('Бот Ур')] });
  assert.equal(all.text, 'Партия началась: Денис, Андрей, Влад, Бот Ур\nСтол 01.11.2026.3');
  assert.equal(all.button, 'Смотреть партию');
  assert.equal(all.url, `${SITE}#/t/ABC234`);
  assert.equal(all.solo, false);
  const solo = started({ ...t, seats: [human('Денис'), bot('Бот Ур'), bot('Бот Киш')] });
  assert.equal(solo.text, 'Денис играет с ботами\nСтол 01.11.2026.3');
  assert.equal(solo.solo, true);
  assert.equal(started({ ...t, seats: [human('Денис'), bot('Бот Ур')] }).text, 'Денис играет с ботом\nСтол 01.11.2026.3');
});

// --- игрок на сайте

test('на сайте: сообщение при появлении, не чаще раза в 3 часа на игрока', async (t) => {
  clock(t);
  const s = setup();
  const { denis, andrey } = await pair(s);
  const beat = (who) => s.req('POST', 'beat', { body: { busy: false }, token: who.token });

  assert.equal((await beat(denis)).status, 200);
  assert.deepEqual(s.tg.sent.map((m) => m.text), ['Денис сейчас на сайте']);

  t.mock.timers.tick(20 * 1000);
  await beat(denis);
  assert.equal(s.tg.sent.length, 1, 'следующий пульс не новое появление');

  await beat(andrey);
  assert.equal(s.tg.sent.at(-1).text, 'Андрей сейчас на сайте', 'у каждого игрока свой счет');

  t.mock.timers.tick(30 * MINUTE);
  await beat(denis);
  assert.equal(s.tg.sent.length, 2, 'короткая отлучка не новое появление');

  t.mock.timers.tick(3 * HOUR);
  await beat(denis);
  assert.equal(s.tg.sent.at(-1).text, 'Денис сейчас на сайте');
  assert.equal(s.tg.sent.length, 3);
});

test('на сайте: разрыв посреди долгой сессии не новое появление', async (t) => {
  clock(t);
  const s = setup();
  const { denis } = await pair(s);
  const beat = () => s.req('POST', 'beat', { body: { busy: false }, token: denis.token });
  await beat();
  for (let k = 0; k < 190; k++) {
    t.mock.timers.tick(MINUTE);
    await beat();
  }
  t.mock.timers.tick(5 * MINUTE); // отошел ненадолго, а окно в 3 часа уже прошло
  await beat();
  assert.equal(s.tg.sent.length, 1);
});

test('на сайте: сбой базы при подсчете не мешает пульсу', async (t) => {
  clock(t);
  const store = memoryStore();
  const s = setup(store);
  const { denis } = await pair(s);
  t.mock.method(console, 'error', () => {});
  store.hit = async () => { throw new Error('нет связи'); };
  assert.equal((await s.req('POST', 'beat', { body: { busy: false }, token: denis.token })).status, 200);
  assert.equal(s.tg.sent.length, 0);
});

test('на сайте: без настроенного Telegram база не тратится', async (t) => {
  clock(t);
  const store = memoryStore();
  const s = setup(store);
  s.tg.on = false;
  const { denis } = await pair(s);
  let hits = 0;
  store.hit = async () => ++hits;
  await s.req('POST', 'beat', { body: { busy: false }, token: denis.token });
  assert.equal(hits, 0);
  assert.equal(s.tg.sent.length, 0);
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

// --- партия началась

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

test('партия началась: сообщение со ссылкой, у партий людей без ограничения', async () => {
  const s = setup();
  const { denis, andrey } = await pair(s);
  for (let k = 1; k <= 2; k++) {
    const { code, start } = await ready(s, denis, andrey);
    assert.equal((await start()).status, 200);
    assert.equal(s.tg.sent.length, k);
    assert.match(s.tg.sent.at(-1).text, /^Партия началась: Денис, Андрей, /);
    assert.equal(s.tg.sent.at(-1).url, `${SITE}#/t/${code}`);
  }
});

test('партия началась: партии с ботами не чаще раза в 3 часа', async (t) => {
  clock(t);
  const s = setup();
  const { denis } = await pair(s);
  assert.equal((await (await ready(s, denis)).start()).status, 200);
  assert.match(s.tg.sent.at(-1).text, /^Денис играет с ботами\n/);

  assert.equal((await (await ready(s, denis)).start()).status, 200);
  assert.equal(s.tg.sent.length, 1);

  t.mock.timers.tick(3 * HOUR + 1000);
  await (await ready(s, denis)).start();
  assert.equal(s.tg.sent.length, 2);
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

test('партия началась: реванш тоже сообщает, со ссылкой на новый стол', async () => {
  const s = setup();
  const { denis, andrey } = await pair(s);
  const { code, start } = await ready(s, denis, andrey);
  await start();
  await finish(s.store, code);
  const r = await s.req('POST', `tables/${code}`, { body: { action: 'rematch' }, token: andrey.token });
  assert.equal(r.status, 200);
  assert.equal(s.tg.sent.length, 2);
  assert.match(s.tg.sent[1].text, /^Партия началась: /);
  assert.equal(s.tg.sent[1].url, `${SITE}#/t/${r.body.next}`);
});

test('партия началась: реванш с ботами под тем же ограничением', async (t) => {
  clock(t);
  const s = setup();
  const { denis } = await pair(s);
  const { code, start } = await ready(s, denis);
  await start();
  await finish(s.store, code);
  assert.equal((await s.req('POST', `tables/${code}`, { body: { action: 'rematch' }, token: denis.token })).status, 200);
  assert.equal(s.tg.sent.length, 1);
});

test('партия началась: проигранная гонка записи ничего не отправляет', async () => {
  const store = memoryStore();
  const s = setup(store);
  const { denis, andrey } = await pair(s);
  const { start } = await ready(s, denis, andrey);
  const put = store.putTable;
  store.putTable = async () => false;
  assert.equal((await start()).status, 409);
  store.putTable = put;
  assert.equal(s.tg.sent.length, 0);
});

test('партия началась: сбой базы при подсчете не мешает партии', async (t) => {
  clock(t);
  const store = memoryStore();
  const s = setup(store);
  const { denis } = await pair(s);
  const { start } = await ready(s, denis);
  t.mock.method(console, 'error', () => {});
  store.hit = async () => { throw new Error('нет связи'); };
  const r = await start();
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'playing');
});

test('ping показывает, подключен ли чат', async () => {
  const s = setup();
  assert.equal((await s.req('GET', 'ping')).body.chat, true);
  s.tg.on = false;
  assert.equal((await s.req('GET', 'ping')).body.chat, false);
});
