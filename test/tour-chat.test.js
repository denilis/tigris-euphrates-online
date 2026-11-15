// Чат турнира (Денис 15.11: «Чат турнира»): код подключения в «Статистике», команды бота от Telegram,
// приглашения за столы турнира в его группу, отключение. Чат сезона (компании) работает как раньше.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';
import { telegram, hookEvent, hookSecretOf, invited, called, HOOK_TEXT, HOOK_URL, CHAT_CODE } from '../server/telegram.js';

const ENV = { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' };
const SECRET = 'секрет-для-тестов';
const GROUP = -1001234567890;

/** Подставной бот: запоминает сообщения с номером чата; секрет SECRET. */
function fakeBot() {
  const tg = {
    on: true, ready: true, sent: [], hooks: 0,
    say: async (m, to) => { tg.sent.push({ ...m, to }); return true; },
    me: async () => 'tigris_test_bot',
    setHook: async () => { tg.hooks += 1; return true; },
    fromTelegram: (s) => s === SECRET,
  };
  return tg;
}

function setup() {
  const store = memoryStore();
  const tg = fakeBot();
  const app = createApp({ store, env: ENV, now: () => Date.now(), botOptions: { timeCap: 20 }, tg });
  const req = (method, path, { body, token, hook } = {}) => app.call({ method, path, body, token, hook });
  return { tg, req, store };
}

async function people(s, ...names) {
  const out = { denis: (await s.req('POST', 'activate', { body: { code: 'ADMN-TEST-2345' } })).body };
  for (const name of names) {
    const r = await s.req('POST', 'admin/users', { body: { name }, token: out.denis.token });
    out[name] = (await s.req('POST', 'activate', { body: { code: r.body.code } })).body;
  }
  return out;
}

/** Петя заводит «Кубок» с Колей; Вася в турнир не входит. */
async function cup(s) {
  const P = await people(s, 'Петя', 'Коля', 'Вася');
  const r = await s.req('POST', 'tournaments', { body: { name: 'Кубок', players: [P['Петя'].user.id, P['Коля'].user.id] }, token: P['Петя'].token });
  assert.equal(r.status, 200);
  assert.equal(r.body.chat, null);
  return { P, id: r.body.id };
}

const hook = (s, update, secret = SECRET) => s.req('POST', 'tg/hook', { body: update, hook: secret });
const groupMsg = (text, chat = GROUP, type = 'supergroup') => ({ message: { text, chat: { id: chat, type, title: 'Кубок: Петя и Коля' } } });

/** Подключить чат кодом: { code, link, command }. */
async function connect(s, who, id) {
  const r = await s.req('POST', `tournaments/${id}/chat`, { token: who.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await hook(s, groupMsg(`/start@tigris_test_bot ${r.body.code}`))).status, 200);
  return r.body;
}

async function table(s, host, seats = 2) {
  const { code } = (await s.req('POST', 'tables', { token: host.token })).body;
  const post = (who, body) => s.req('POST', `tables/${code}`, { body, token: who.token });
  await post(host, { action: 'seatCount', n: seats });
  return { code, post, view: async (who) => (await s.req('GET', `tables/${code}`, { token: who.token })).body, call: (who) => s.req('POST', 'invite/chat', { body: { code }, token: who.token }) };
}

test('команды бота: ссылка startgroup, /connect, помощь в личке, бот убран, группа сменила номер', () => {
  assert.deepEqual(hookEvent(groupMsg('/start@tigris_test_bot k7q2m9ab')), { kind: 'connect', code: 'K7Q2M9AB', chat: { id: GROUP, type: 'supergroup', title: 'Кубок: Петя и Коля' } });
  assert.equal(hookEvent(groupMsg('/connect K7Q2M9AB')).kind, 'connect');
  assert.equal(hookEvent(groupMsg('/start', 5, 'private')).kind, 'help');
  assert.equal(hookEvent(groupMsg('/start')), null, 'в группе /start без кода молчим');
  assert.equal(hookEvent(groupMsg('привет всем')), null);
  assert.deepEqual(hookEvent({ my_chat_member: { chat: { id: GROUP }, new_chat_member: { status: 'kicked' } } }), { kind: 'left', chat: GROUP });
  assert.equal(hookEvent({ my_chat_member: { chat: { id: GROUP }, new_chat_member: { status: 'member' } } }), null);
  assert.deepEqual(hookEvent({ message: { chat: { id: -5 }, migrate_to_chat_id: GROUP } }), { kind: 'migrate', from: -5, to: GROUP });
  assert.equal(hookEvent(null), null);
  assert.ok(CHAT_CODE.test('K7Q2M9AB') && !CHAT_CODE.test('K7Q2M9A0'), 'без похожих 0 и O');
});

test('тексты: в чате турнира строка называет турнир, в чате сезона как раньше', () => {
  const t = { code: 'HL7A01', title: null };
  assert.match(invited('Петя', t, 2, 'Кубок').text, /^Петя зовёт на партию\nТурнир «Кубок», стол HL7A01, свободно мест: 2$/);
  assert.match(called('Петя', t, ['Коля'], 'Кубок').text, /\nТурнир «Кубок», стол HL7A01$/);
  assert.match(invited('Денис', t, 1).text, /\nСтол HL7A01, свободно мест: 1$/);
});

test('настоящий бот: секрет адреса из токена, адрес команд, сообщение в нужный чат без кнопки', async () => {
  const calls = [];
  const fetchFn = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ ok: true, result: url.endsWith('/getMe') ? { username: 'tigris_test_bot' } : true })); };
  const token = '123456789:SECRET-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const tg = telegram({ VERCEL_ENV: 'production', TELEGRAM_BOT_TOKEN: token }, { fetchFn });
  assert.equal(tg.ready, true);
  assert.equal(tg.on, false, 'без чата компании сезону писать некуда');
  assert.equal(await tg.say({ text: 'x' }), false, 'чат сезона не задан');
  assert.equal(await tg.say({ text: 'привет' }, GROUP), true);
  assert.deepEqual(calls.at(-1).body, { chat_id: GROUP, text: 'привет' });
  assert.equal(await tg.me(), 'tigris_test_bot');
  assert.equal(await tg.me(), 'tigris_test_bot');
  assert.equal(calls.filter((c) => c.url.endsWith('/getMe')).length, 1, 'имя бота спрашиваем один раз');
  assert.equal(await tg.setHook(), true);
  const set = calls.find((c) => c.url.endsWith('/setWebhook')).body;
  assert.equal(set.url, HOOK_URL);
  assert.equal(set.secret_token, hookSecretOf(token));
  assert.match(set.secret_token, /^[0-9a-f]{40}$/);
  assert.equal(tg.fromTelegram(hookSecretOf(token)), true);
  assert.equal(tg.fromTelegram('чужой'), false);
  assert.equal(tg.fromTelegram(null), false);
  assert.equal(telegram({ VERCEL_ENV: 'preview', TELEGRAM_BOT_TOKEN: token }, { fetchFn }).ready, false, 'превью не пишет');
});

test('подключение: код участнику, ссылка и команда, адрес команд сообщаем Telegram при каждом коде', async () => {
  const s = setup();
  const { P, id } = await cup(s);
  const r = await s.req('POST', `tournaments/${id}/chat`, { token: P['Коля'].token });
  assert.equal(r.status, 200);
  assert.match(r.body.code, CHAT_CODE);
  assert.equal(r.body.link, `https://t.me/tigris_test_bot?startgroup=${r.body.code}`);
  assert.equal(r.body.command, `/connect@tigris_test_bot ${r.body.code}`);
  assert.equal(r.body.minutes, 30);
  await s.req('POST', `tournaments/${id}/chat`, { token: P['Петя'].token });
  assert.equal(s.tg.hooks, 2, 'потерянный адрес вернется со следующим кодом');
  assert.equal((await s.req('POST', `tournaments/${id}/chat`, { token: P['Вася'].token })).status, 403, 'не участник');
  assert.equal((await s.req('POST', 'tournaments/season/chat', { token: P.denis.token })).status, 400, 'чат сезона в настройках сайта');
  assert.equal((await s.req('POST', 'tournaments/t-nope/chat', { token: P.denis.token })).status, 404);
  const info = (await s.req('GET', 'tournaments', { token: P['Петя'].token })).body;
  assert.equal(info.chatReady, true);
  assert.equal(info.tours.find((t) => t.id === id).chat, null);
});

test('команды бота: без секрета нельзя, в личке код не тратится, чужой код не подходит, код один раз', async () => {
  const s = setup();
  const { P, id } = await cup(s);
  const { code } = (await s.req('POST', `tournaments/${id}/chat`, { token: P['Петя'].token })).body;
  assert.equal((await hook(s, groupMsg(`/connect ${code}`), 'чужой')).status, 403);
  assert.equal((await hook(s, groupMsg(`/connect ${code}`), null)).status, 403);
  await hook(s, groupMsg(`/start ${code}`, 77, 'private'));
  assert.equal(s.tg.sent.at(-1).text, HOOK_TEXT.private);
  assert.equal(s.tg.sent.at(-1).to, 77);
  await hook(s, groupMsg('/connect ABCDEFGH'));
  assert.equal(s.tg.sent.at(-1).text, HOOK_TEXT.bad);
  await hook(s, groupMsg(`/connect@tigris_test_bot ${code.toLowerCase()}`));
  assert.equal(s.tg.sent.at(-1).text, HOOK_TEXT.done('Кубок'));
  assert.equal(s.tg.sent.at(-1).to, GROUP);
  const info = (await s.req('GET', 'tournaments', { token: P['Коля'].token })).body;
  assert.deepEqual(info.tours.find((t) => t.id === id).chat, { title: 'Кубок: Петя и Коля' });
  await hook(s, groupMsg(`/connect ${code}`, -42));
  assert.equal(s.tg.sent.at(-1).text, HOOK_TEXT.bad, 'код уже потрачен');
  assert.equal((await hook(s, { update_id: 1, message: { text: 'просто текст', chat: { id: GROUP, type: 'group' } } })).status, 200);
});

test('чат турнира: приглашение уходит в группу турнира и называет турнир', async () => {
  const s = setup();
  const { P, id } = await cup(s);
  await connect(s, P['Петя'], id);
  s.tg.sent.length = 0;
  const { view, call, post } = await table(s, P['Петя']);
  const v = await view(P['Петя']);
  assert.equal(v.chat, true);
  assert.equal(v.chatName, 'Кубок: Петя и Коля');
  assert.equal((await call(P['Петя'])).status, 200);
  assert.equal(s.tg.sent.length, 1);
  assert.equal(s.tg.sent[0].to, GROUP);
  assert.match(s.tg.sent[0].text, /^Петя зовёт на партию\nТурнир «Кубок», стол \S+, свободно мест: 1$/);
  // посадить Колю: сообщение тоже в группу турнира
  const r = await post(P['Петя'], { action: 'invitePeople', ids: [P['Коля'].user.id] });
  assert.equal(r.body.chat, true);
  assert.equal(s.tg.sent.at(-1).to, GROUP);
  assert.match(s.tg.sent.at(-1).text, /^Петя зовёт за стол: Коля\nТурнир «Кубок»/);
});

test('чат турнира: за столом не участник или зовет не участник, чата нет; без чата у турнира тоже', async () => {
  const s = setup();
  const { P, id } = await cup(s);
  const plain = await table(s, P['Петя']);
  assert.equal((await plain.view(P['Петя'])).chat, false, 'чат еще не подключен');
  assert.equal((await plain.call(P['Петя'])).status, 403);
  await connect(s, P['Петя'], id);
  s.tg.sent.length = 0;
  const mixed = await table(s, P['Петя'], 3);
  await mixed.post(P['Петя'], { action: 'invitePeople', ids: [P['Вася'].user.id] });
  assert.equal((await mixed.view(P['Петя'])).chat, false, 'за столом Вася');
  assert.equal((await mixed.call(P['Петя'])).status, 403);
  const his = await table(s, P['Вася']);
  assert.equal((await his.view(P['Вася'])).chat, false, 'Вася не в турнире');
  assert.equal(s.tg.sent.length, 0);
});

test('отключение: кнопкой участника, бот убран из группы, группа сменила номер', async () => {
  const s = setup();
  const { P, id } = await cup(s);
  const chatOf = async () => (await s.req('GET', 'tournaments', { token: P['Петя'].token })).body.tours.find((t) => t.id === id).chat;
  await connect(s, P['Петя'], id);
  await hook(s, { message: { chat: { id: GROUP }, migrate_to_chat_id: -100777 } });
  const { call } = await table(s, P['Петя']);
  s.tg.sent.length = 0;
  await call(P['Петя']);
  assert.equal(s.tg.sent[0].to, -100777, 'пишем в новый номер группы');
  await hook(s, { my_chat_member: { chat: { id: -100777 }, new_chat_member: { status: 'left' } } });
  assert.equal(await chatOf(), null);
  await connect(s, P['Петя'], id);
  assert.ok(await chatOf());
  assert.equal((await s.req('POST', `tournaments/${id}/chat/off`, { token: P['Вася'].token })).status, 403);
  assert.equal((await s.req('POST', `tournaments/${id}/chat/off`, { token: P['Коля'].token })).status, 200);
  assert.equal(await chatOf(), null);
  assert.equal(s.tg.sent.at(-1).text, HOOK_TEXT.off('Кубок'));
  assert.equal(s.tg.sent.at(-1).to, GROUP);
  assert.equal((await s.req('POST', `tournaments/${id}/chat/off`, { token: P['Коля'].token })).status, 200, 'повтор не ошибка');
});

test('чат сезона: стол компании по-прежнему в чат из настроек, у сезона нет кнопок подключения', async () => {
  const s = setup();
  const P = await people(s, 'Андрей');
  const { code } = (await s.req('POST', 'tables', { token: P.denis.token })).body;
  await s.req('POST', `tables/${code}`, { body: { action: 'seatCount', n: 3 }, token: P.denis.token });
  const v = (await s.req('GET', `tables/${code}`, { token: P.denis.token })).body;
  assert.equal(v.chat, true);
  assert.equal(v.chatName, 'ДВАК');
  assert.equal((await s.req('POST', 'invite/chat', { body: { code }, token: P.denis.token })).status, 200);
  assert.equal(s.tg.sent.at(-1).to, undefined, 'чат из настроек сайта');
  assert.match(s.tg.sent.at(-1).text, /\nСтол \S+, свободно мест: 2$/);
  const season = (await s.req('GET', 'tournaments', { token: P.denis.token })).body.tours.find((t) => t.id === 'season');
  assert.deepEqual(season.chat, { title: 'ДВАК', fixed: true });
});

test('строка чата в «Статистике»: не подключен, код с шагами, подключен, сезон, не основной сайт', async () => {
  const { chatRowHTML } = await import('../public/js/tour-chat-core.js');
  const t = { id: 't-1', chat: null };
  assert.match(chatRowHTML(t, true), /не подключен.*id="cOn"/s);
  assert.match(chatRowHTML(t, false), /только на основном сайте/);
  assert.doesNotMatch(chatRowHTML(t, false), /cOn/);
  const w = chatRowHTML(t, true, { link: 'https://t.me/b?startgroup=K7Q2M9AB', command: '/connect@b K7Q2M9AB', minutes: 30 });
  assert.match(w, /href="https:\/\/t\.me\/b\?startgroup=K7Q2M9AB"/);
  assert.match(w, /<code>\/connect@b K7Q2M9AB<\/code>/);
  assert.match(w, /Код действует 30 минут/);
  assert.match(chatRowHTML({ id: 't-1', chat: { title: '<b>Кубок</b>' } }, true), /«&lt;b&gt;Кубок&lt;\/b&gt;».*id="cOff"/s);
  assert.match(chatRowHTML({ id: 'season', chat: { title: 'ДВАК', fixed: true } }, true), /ДВАК.*настройках сайта/s);
  assert.equal(chatRowHTML(null, true), '');
  for (const html of [chatRowHTML(t, true), w]) assert.ok(!/[—…   ]/.test(html), 'типографика');
});

test('ревью 15.11: чужой турнир с теми же людьми не уводит их приглашения в свою группу', async () => {
  const s = setup();
  const P = await people(s, 'Петя', 'Коля', 'Вася');
  // Вася заводит «Шпион» с Петей и Колей без их ведома и подключает свою группу -999
  const spy = (await s.req('POST', 'tournaments', { body: { name: 'Шпион', players: [P['Вася'].user.id, P['Петя'].user.id, P['Коля'].user.id] }, token: P['Вася'].token })).body;
  const { code } = (await s.req('POST', `tournaments/${spy.id}/chat`, { token: P['Вася'].token })).body;
  await hook(s, groupMsg(`/connect ${code}`, -999));
  // у Пети и Коли свой «Кубок» без чата
  const cupId = (await s.req('POST', 'tournaments', { body: { name: 'Кубок', players: [P['Петя'].user.id, P['Коля'].user.id] }, token: P['Петя'].token })).body.id;
  s.tg.sent.length = 0;
  const sent = () => s.tg.sent.filter((m) => m.to === -999).length;
  // вне турниров
  const off = await table(s, P['Петя']);
  await off.post(P['Петя'], { action: 'options', options: { tournament: 'none' } });
  assert.equal((await off.post(P['Петя'], { action: 'invitePeople', ids: [P['Коля'].user.id] })).body.chat, null);
  // «авто»: за столом двое, а в «Шпионе» трое; первый по составу «Кубок», у него чата нет
  const auto = await table(s, P['Петя']);
  await auto.post(P['Петя'], { action: 'invitePeople', ids: [P['Коля'].user.id] });
  assert.equal((await auto.view(P['Петя'])).chat, false);
  // выбран «Кубок» без чата: чат «Шпиона» ни при чем
  const picked = await table(s, P['Петя']);
  await picked.post(P['Петя'], { action: 'options', options: { tournament: cupId } });
  assert.equal((await picked.call(P['Петя'])).status, 403);
  assert.equal(sent(), 0);
  // сам Петя выбрал «Шпион» за столом на троих: тогда в его чат можно
  const chosen = await table(s, P['Петя'], 3);
  await chosen.post(P['Петя'], { action: 'options', options: { tournament: spy.id } });
  assert.equal((await chosen.call(P['Петя'])).status, 200);
  assert.equal(sent(), 1);
});

test('ревью 15.11: странный секрет дает отказ, а не сбой; без чата компании сезон не мешает; сбой базы возвращает код', async () => {
  const token = '123456789:SECRET-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const real = telegram({ VERCEL_ENV: 'production', TELEGRAM_BOT_TOKEN: token }, { fetchFn: async () => new Response('{}') });
  assert.equal(real.fromTelegram('é'.repeat(40)), false);
  assert.equal(real.fromTelegram('é'.repeat(20)), false);
  // бот работает, чат компании не задан: стол компании без чата, кнопки нет
  const store = memoryStore();
  const tg = { ...fakeBot(), on: false };
  const app = createApp({ store, env: ENV, now: () => Date.now(), botOptions: { timeCap: 20 }, tg });
  const req = (method, path, { body, token: tk, hook: h } = {}) => app.call({ method, path, body, token: tk, hook: h });
  const denis = (await req('POST', 'activate', { body: { code: 'ADMN-TEST-2345' } })).body;
  const { code } = (await req('POST', 'tables', { token: denis.token })).body;
  await req('POST', `tables/${code}`, { body: { action: 'seatCount', n: 3 }, token: denis.token });
  assert.equal((await req('GET', `tables/${code}`, { token: denis.token })).body.chat, false);
  // база не записала турнир: код возвращается, группа получает просьбу повторить
  const s = setup();
  const { P, id } = await cup(s);
  const r = (await s.req('POST', `tournaments/${id}/chat`, { token: P['Петя'].token })).body;
  const put = s.store.putTour;
  s.store.putTour = async () => { throw new Error('база недоступна'); };
  assert.equal((await hook(s, groupMsg(`/connect ${r.code}`))).status, 200, 'Telegram не повторяет');
  assert.equal(s.tg.sent.at(-1).text, HOOK_TEXT.retry);
  s.store.putTour = put;
  await hook(s, groupMsg(`/connect ${r.code}`));
  assert.equal(s.tg.sent.at(-1).text, HOOK_TEXT.done('Кубок'), 'тот же код сработал со второго раза');
});
