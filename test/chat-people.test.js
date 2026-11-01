// Чат Telegram пока один и свой у Дениса, Андрея и Влада: о других игроках в него не пишем.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';
import { CHAT_PEOPLE, inChat } from '../server/telegram.js';
import { CHAT_PEOPLE as CLIENT_PEOPLE, chatAllowed, chatNote } from '../public/js/online.js';

const ENV = { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' };

function setup() {
  const store = memoryStore();
  const tg = { on: true, sent: [], say: async (m) => { tg.sent.push(m); return true; } };
  const app = createApp({ store, env: ENV, now: () => Date.now(), botOptions: { timeCap: 20 }, tg });
  const req = (method, path, { body, token } = {}) => app.call({ method, path, body, token });
  return { tg, req, store };
}

async function company(s, ...names) {
  const out = { denis: (await s.req('POST', 'activate', { body: { code: 'ADMN-TEST-2345' } })).body };
  for (const name of names) {
    const r = await s.req('POST', 'admin/users', { body: { name }, token: out.denis.token });
    out[name] = (await s.req('POST', 'activate', { body: { code: r.body.code } })).body;
  }
  return out;
}

async function table(s, host, seats = 3) {
  const { code } = (await s.req('POST', 'tables', { token: host.token })).body;
  const post = (who, body) => s.req('POST', `tables/${code}`, { body, token: who.token });
  await post(host, { action: 'seatCount', n: seats });
  return { code, post, call: (who) => s.req('POST', 'invite/chat', { body: { code }, token: who.token }) };
}

const says = (s, re) => s.tg.sent.filter((m) => re.test(m.text)).length;

test('чат: в списке трое, регистр и пробелы не важны', () => {
  for (const name of ['Денис', ' андрей ', 'ВЛАД']) assert.equal(inChat(name), true, name);
  for (const name of ['Петя', 'Денис2', '', null, undefined, 'constructor']) assert.equal(inChat(name), false, String(name));
});

test('подсказка после приглашения', () => {
  assert.equal(chatNote(true), 'Игроки за столом, сообщение ушло в чат');
  assert.equal(chatNote(false), 'Игроки за столом, в чат сообщение не ушло');
  assert.equal(chatNote(null), 'Игроки за столом', 'чат здесь ни при чем');
});

test('чат: список на сервере и в браузере один и тот же', () => {
  assert.deepEqual([...CLIENT_PEOPLE].sort(), [...CHAT_PEOPLE].sort());
});

test('позвать в чат: свободные места, зовет свой, можно', async () => {
  const s = setup();
  const P = await company(s, 'Петя');
  const { call } = await table(s, P.denis);
  assert.equal((await call(P.denis)).status, 200);
  assert.equal(says(s, /зовёт на партию/), 1);
});

test('позвать в чат: зовет другой игрок, нельзя', async () => {
  const s = setup();
  const P = await company(s, 'Петя');
  const { call } = await table(s, P['Петя']);
  const r = await call(P['Петя']);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'not-chat');
  assert.equal(s.tg.sent.length, 0);
});

test('позвать в чат: за столом другой игрок, нельзя', async () => {
  const s = setup();
  const P = await company(s, 'Петя');
  const { post, call } = await table(s, P.denis);
  await post(P['Петя'], { action: 'sit', seat: 1 });
  assert.equal((await call(P.denis)).status, 403);
  assert.equal(s.tg.sent.length, 0);
});

test('пригласить: Андрей и Влад, сообщение уходит', async () => {
  const s = setup();
  const P = await company(s, 'Андрей', 'Влад');
  const { post } = await table(s, P.denis);
  const r = await post(P.denis, { action: 'invitePeople', ids: [P['Андрей'].user.id, P['Влад'].user.id] });
  assert.equal(r.body.chat, true);
  assert.equal(says(s, /зовёт за стол: Андрей, Влад/), 1);
});

test('пригласить: среди выбранных другой игрок, люди садятся, в чат не пишем', async () => {
  const s = setup();
  const P = await company(s, 'Андрей', 'Петя');
  const { post } = await table(s, P.denis);
  const r = await post(P.denis, { action: 'invitePeople', ids: [P['Андрей'].user.id, P['Петя'].user.id] });
  assert.equal(r.status, 200);
  assert.equal(r.body.chat, null, 'не сбой, а чат здесь не при чем');
  assert.deepEqual(r.body.seats.map((x) => x.name), ['Денис', 'Андрей', 'Петя']);
  assert.equal(s.tg.sent.length, 0);
});

test('пригласить: хозяин другой игрок, в чат не пишем', async () => {
  const s = setup();
  const P = await company(s, 'Андрей', 'Петя');
  const { post } = await table(s, P['Петя']);
  const r = await post(P['Петя'], { action: 'invitePeople', ids: [P['Андрей'].user.id] });
  assert.equal(r.status, 200);
  assert.equal(r.body.chat, null);
  assert.equal(s.tg.sent.length, 0);
});

test('позвать в чат: чужой хозяин вышел из-за стола, за столом только свои, нельзя', async () => {
  const s = setup();
  const P = await company(s, 'Андрей', 'Петя');
  const { post, call } = await table(s, P['Петя']);
  await post(P['Петя'], { action: 'invitePeople', ids: [P['Андрей'].user.id] });
  await post(P['Петя'], { action: 'leave' });
  const r = await call(P['Петя']);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'not-chat');
  assert.equal(s.tg.sent.length, 0);
});

test('пригласить: чужой хозяин не за столом, зовет своих, в чат не пишем', async () => {
  const s = setup();
  const P = await company(s, 'Андрей', 'Влад', 'Петя');
  const { post } = await table(s, P['Петя']);
  await post(P['Петя'], { action: 'invitePeople', ids: [P['Андрей'].user.id] });
  await post(P['Петя'], { action: 'leave' });
  const r = await post(P['Петя'], { action: 'invitePeople', ids: [P['Влад'].user.id] });
  assert.equal(r.status, 200);
  assert.equal(r.body.chat, null);
  assert.equal(s.tg.sent.length, 0);
});

test('кнопка: видна своим, пока есть кого звать', () => {
  const seat = (id, name, kind = 'human') => ({ id, kind, name, taken: Boolean(name) });
  const view = (me, ...seats) => ({ me, seats });
  assert.equal(chatAllowed(view(0, seat(0, 'Денис'), seat(1, null)), 'Денис'), true, 'свободное место');
  assert.equal(chatAllowed(view(0, seat(0, 'Денис'), seat(1, 'Андрей'), seat(2, 'Влад')), 'Денис'), true, 'стол полон своими');
  assert.equal(chatAllowed(view(0, seat(0, 'Денис'), seat(1, 'Бот', 'bot')), 'Денис'), false, 'только боты');
  assert.equal(chatAllowed(view(0, seat(0, 'Денис'), seat(1, 'Петя')), 'Денис'), false, 'за столом другой игрок');
  assert.equal(chatAllowed(view(0, seat(0, 'Петя'), seat(1, null)), 'Петя'), false, 'зовет другой игрок');
  assert.equal(chatAllowed(view(null, seat(0, null), seat(1, null)), 'Денис'), true, 'хозяин не за столом');
  assert.equal(chatAllowed(view(null, seat(0, 'Андрей'), seat(1, null)), 'Петя'), false, 'чужой хозяин вне стола');
  assert.equal(chatAllowed(view(0, seat(0, 'Денис'), seat(1, 'Андрей'), seat(2, 'Бот', 'bot')), 'Денис'), true, 'свои и бот');
  assert.equal(chatAllowed(view(0, seat(0, ' денис '), seat(1, ' АНДРЕЙ ')), ' денис '), true, 'регистр и пробелы');
});
