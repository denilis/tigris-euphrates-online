// Приглашение за стол из списка игроков: хозяин выбирает людей, они сразу садятся на свободные места.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';
import { createTable, sit, leave, seatPeople, unseat, start, TableError } from '../game/table.js';
import { SITE, called } from '../server/telegram.js';
import { pickList } from '../public/js/online.js';

const ENV = { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' };
const MINUTE = 60 * 1000;

const failure = (fn) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof TableError, String(e));
    return e.code;
  }
  return null;
};

function setup(store = memoryStore()) {
  const tg = { on: true, fail: false, sent: [], say: async (m) => { if (tg.fail) return false; tg.sent.push(m); return true; } };
  const app = createApp({ store, env: ENV, now: () => Date.now(), botOptions: { timeCap: 20 }, tg });
  const req = (method, path, { body, token } = {}) => app.call({ method, path, body, token });
  return { tg, req, store };
}

/** Денис и игроки с сессиями; users: имена. */
async function company(s, ...names) {
  const denis = (await s.req('POST', 'activate', { body: { code: 'ADMN-TEST-2345' } })).body;
  const out = { denis };
  for (const name of names) {
    const r = await s.req('POST', 'admin/users', { body: { name }, token: denis.token });
    out[name] = (await s.req('POST', 'activate', { body: { code: r.body.code } })).body;
  }
  return out;
}

async function newTable(s, P) {
  const { code } = (await s.req('POST', 'tables', { token: P.denis.token })).body;
  await s.req('POST', `tables/${code}`, { body: { action: 'seatCount', n: 3 }, token: P.denis.token });
  const post = (who, body) => s.req('POST', `tables/${code}`, { body, token: who.token });
  return { code, post, invite: (...people) => post(P.denis, { action: 'invitePeople', ids: people.map((p) => p.user.id) }) };
}

const inbox = async (s, who) => (await s.req('POST', 'beat', { body: { busy: false }, token: who.token })).body.inbox;

// --- стол

const DENIS = { userId: 'u1', name: 'Денис' }, ANDREY = { userId: 'u2', name: 'Андрей' }, VLAD = { userId: 'u3', name: 'Влад' };
const lobby = () => createTable({ code: 'ABC234', host: DENIS, now: 1 });

test('посадка: выбранные садятся на свободные места со своими героями', () => {
  const t = lobby();
  seatPeople(t, 'u1', [ANDREY, VLAD], 2);
  assert.deepEqual(t.seats.map((s) => s.name).slice(0, 3), ['Денис', 'Андрей', 'Влад']);
  assert.deepEqual(t.seats.map((s) => s.hero).slice(0, 3), ['pot', 'bow', 'lion']);
  assert.equal(t.seats[3].kind, 'bot', 'места ботов не трогаем');
});

test('посадка: только хозяин, только в лобби, мест должно хватать', () => {
  const t = lobby();
  assert.equal(failure(() => seatPeople(t, 'u2', [ANDREY], 2)), 'not-host');
  assert.equal(failure(() => seatPeople(t, 'u1', [], 2)), 'bad-invite');
  assert.equal(failure(() => seatPeople(t, 'u1', [ANDREY, VLAD, { userId: 'u4', name: 'Саша' }], 2)), 'no-seats');
  assert.equal(t.seats[1].userId, null, 'при отказе никто не сел');
  seatPeople(t, 'u1', [ANDREY], 2);
  assert.equal(failure(() => seatPeople(t, 'u1', [ANDREY], 3)), 'already-seated');
  seatPeople(t, 'u1', [VLAD], 3);
  start(t, 'u1', { now: 4 });
  assert.equal(failure(() => seatPeople(t, 'u1', [{ userId: 'u4', name: 'Саша' }], 5)), 'not-lobby');
});

test('убрать: хозяин снимает приглашенного, герой освобождается', () => {
  const t = lobby();
  sit(t, ANDREY, 1, 2);
  assert.equal(failure(() => unseat(t, 'u2', 1, 3)), 'not-host');
  assert.equal(failure(() => unseat(t, 'u1', 0, 3)), 'is-host', 'себя снимают кнопкой «Встать»');
  assert.equal(failure(() => unseat(t, 'u1', 2, 3)), 'seat-empty');
  assert.equal(failure(() => unseat(t, 'u1', 3, 3)), 'seat-empty', 'бота этим не убрать');
  unseat(t, 'u1', 1, 3);
  assert.equal(t.seats[1].userId, null);
  assert.equal(t.seats[1].hero, null);
  sit(t, ANDREY, 1, 4);
  sit(t, VLAD, 2, 4);
  start(t, 'u1', { now: 5 });
  assert.equal(failure(() => unseat(t, 'u1', 2, 6)), 'not-lobby');
});

test('посадка: первым занято то место, на котором открыли выбор', () => {
  const t = lobby();
  seatPeople(t, 'u1', [ANDREY, VLAD], 2, 2);
  assert.equal(t.seats[2].name, 'Андрей');
  assert.equal(t.seats[1].name, 'Влад');
});

test('посадка: сел сам, пока хозяин выбирал, ошибка называет его', () => {
  const t = lobby();
  sit(t, ANDREY, 1, 2);
  assert.throws(() => seatPeople(t, 'u1', [ANDREY], 3), /Андрей уже за столом/);
});

test('хозяин встал: стол не уходит тому, кого позвали, а он еще не пришел', () => {
  const t = lobby();
  seatPeople(t, 'u1', [ANDREY], 2);
  leave(t, 'u1', 3);
  assert.equal(t.hostUserId, 'u1');
  unseat(t, 'u1', 1, 4);
  assert.equal(t.seats[1].userId, null, 'хозяин за столом не сидит, но управляет им');
});

test('хозяин встал: стол уходит тому, кто сел сам', () => {
  const t = lobby();
  seatPeople(t, 'u1', [ANDREY], 2);
  sit(t, VLAD, 2, 3);
  leave(t, 'u1', 4);
  assert.equal(t.hostUserId, 'u3');
});

test('посадка: хозяин, вставший со стола, остается хозяином', () => {
  const t = lobby();
  t.seats[0].userId = null; // встал, за столом никого
  t.seats[0].name = null;
  t.seats[0].hero = null;
  seatPeople(t, 'u1', [ANDREY], 2);
  assert.equal(t.hostUserId, 'u1');
  assert.equal(t.seats[0].name, 'Андрей');
});

// --- список людей

test('список людей: только действующие игроки, с фото, без входа нельзя', async () => {
  const s = setup();
  const P = await company(s, 'Андрей', 'Влад');
  await s.req('POST', `admin/users/${P['Влад'].user.id}/revoke`, { token: P.denis.token });
  const cur = await s.store.getUser(P['Андрей'].user.id);
  await s.store.putUser({ ...cur, avatar: 'a'.repeat(32) });
  assert.equal((await s.req('GET', 'people')).status, 401);
  const r = await s.req('GET', 'people', { token: P['Андрей'].token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((p) => p.name).sort(), ['Андрей', 'Денис']);
  assert.deepEqual(Object.keys(r.body[0]).sort(), ['avatar', 'id', 'name'], 'лишнего о людях не отдаем');
  assert.equal(r.body.find((p) => p.name === 'Андрей').avatar, 'a'.repeat(32));
});

test('список для окна: кто на сайте выше, сидящих нет', () => {
  const view = { seats: [{ name: 'Денис' }, { name: null }] };
  const people = [{ id: '1', name: 'Денис' }, { id: '2', name: 'Яна' }, { id: '3', name: 'Андрей' }, { id: '4', name: 'Влад' }, { id: '5', name: 'Борис' }];
  const online = [{ id: '4', busy: false }, { id: '2', busy: true }];
  assert.deepEqual(pickList(people, view, online).map((p) => [p.name, p.note]), [
    ['Влад', 'на сайте'], ['Яна', 'в партии'], ['Андрей', ''], ['Борис', ''],
  ]);
  assert.equal(pickList(people, view, null).length, 4, 'пока пульса не было, список все равно есть');
  assert.deepEqual(pickList(people, view, null).map((p) => p.name), ['Андрей', 'Борис', 'Влад', 'Яна'], 'внутри группы по алфавиту');
  assert.ok(!pickList(people, view, null, '3').some((p) => p.name === 'Андрей'), 'себя в списке нет');
});

// --- пригласить выбранных

test('пригласить: люди за столом, стол в их списке, приглашение на сайте и одно сообщение в чат', async () => {
  const s = setup();
  const P = await company(s, 'Андрей', 'Влад');
  const { code, invite } = await newTable(s, P);
  const r = await invite(P['Андрей'], P['Влад']);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.chat, true);
  assert.deepEqual(r.body.seats.map((x) => x.name), ['Денис', 'Андрей', 'Влад']);
  assert.equal(r.body.seats[1].avatar, null);
  for (const who of [P['Андрей'], P['Влад']]) {
    assert.deepEqual((await s.req('GET', 'tables', { token: who.token })).body.map((t) => t.code), [code]);
    const [letter] = await inbox(s, who);
    assert.equal(letter.kind, 'invite');
    assert.equal(letter.code, code);
    assert.equal(letter.from, 'Денис');
  }
  const calls = s.tg.sent.filter((m) => /зовёт/.test(m.text));
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /^Денис зовёт за стол: Андрей, Влад\n/);
  assert.equal(calls[0].url, `${SITE}#/t/${code}`);
});

test('пригласить: посторонний и лишние данные отклоняются, никто не садится', async () => {
  const s = setup();
  const P = await company(s, 'Андрей', 'Влад', 'Саша', 'Петя');
  const { post, invite } = await newTable(s, P);
  const ids = (...list) => ({ action: 'invitePeople', ids: list });
  assert.equal((await post(P.denis, ids(P.denis.user.id))).status, 400, 'себя не зовут');
  assert.equal((await post(P['Андрей'], ids(P['Влад'].user.id))).status, 403);
  for (const bad of [[], ['нет такого'], [1], [null], [{}], 'строка', null, undefined]) {
    assert.equal((await post(P.denis, { action: 'invitePeople', ids: bad })).status, 400, JSON.stringify(bad));
  }
  await s.req('POST', `admin/users/${P['Саша'].user.id}/revoke`, { token: P.denis.token });
  assert.equal((await post(P.denis, ids(P['Саша'].user.id))).status, 400, 'отозванный код');
  assert.equal((await post(P.denis, ids('1', '2', '3', '4', '5'))).status, 400, 'больше, чем бывает мест');
  assert.equal((await post(P.denis, ids(P['Андрей'].user.id, P['Влад'].user.id, P['Петя'].user.id))).status, 409, 'мест меньше');
  assert.equal(s.tg.sent.length, 0);
  assert.equal((await invite(P['Андрей'], P['Андрей'])).body.seats.filter((x) => x.name === 'Андрей').length, 1, 'повтор в списке');
});

test('пригласить: чат не ответил, люди за столом, ответ говорит об этом', async () => {
  const s = setup();
  const P = await company(s, 'Андрей');
  const { invite } = await newTable(s, P);
  s.tg.fail = true;
  const r = await invite(P['Андрей']);
  assert.equal(r.status, 200);
  assert.equal(r.body.chat, false);
  assert.equal(r.body.seats[1].name, 'Андрей');
});

test('пригласить: сообщений в чат не больше трех за 3 минуты, посадке это не мешает', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 1, 12, 0) });
  const s = setup();
  const P = await company(s, 'Андрей');
  for (let k = 0; k < 4; k++) {
    const { invite } = await newTable(s, P);
    assert.equal((await invite(P['Андрей'])).status, 200);
  }
  assert.equal(s.tg.sent.length, 3);
  t.mock.timers.tick(3 * MINUTE + 1000);
  const { invite } = await newTable(s, P);
  assert.equal((await invite(P['Андрей'])).body.chat, true);
});

test('пригласить: сбой на втором человеке не дает ошибку сервера, сообщение в чат уходит', async (t) => {
  const store = memoryStore();
  const s = setup(store);
  const P = await company(s, 'Андрей', 'Влад');
  const { code, invite } = await newTable(s, P);
  t.mock.method(console, 'error', () => {});
  const push = store.pushInbox;
  store.pushInbox = async (id, ...rest) => {
    if (id === P['Влад'].user.id) throw new Error('нет связи');
    return push(id, ...rest);
  };
  const r = await invite(P['Андрей'], P['Влад']);
  assert.equal(r.status, 200);
  assert.equal(r.body.chat, true);
  store.pushInbox = push;
  assert.deepEqual((await s.req('GET', 'tables', { token: P['Андрей'].token })).body.map((x) => x.code), [code]);
});

test('пригласить: с места, на котором нажали', async () => {
  const s = setup();
  const P = await company(s, 'Андрей');
  const { post } = await newTable(s, P);
  const r = await post(P.denis, { action: 'invitePeople', ids: [P['Андрей'].user.id], seat: 2 });
  assert.equal(r.body.seats[2].name, 'Андрей');
  assert.equal(r.body.seats[1].taken, false);
});

test('пригласить: проигранная гонка записи никого не зовет', async () => {
  const store = memoryStore();
  const s = setup(store);
  const P = await company(s, 'Андрей');
  const { invite } = await newTable(s, P);
  const put = store.putTable;
  store.putTable = async () => false;
  assert.equal((await invite(P['Андрей'])).status, 409);
  store.putTable = put;
  assert.equal(s.tg.sent.length, 0);
  assert.equal((await inbox(s, P['Андрей'])).length, 0);
});

test('пригласить: сбой базы при подсчете сообщений не отменяет посадку', async (t) => {
  const store = memoryStore();
  const s = setup(store);
  const P = await company(s, 'Андрей');
  const { invite } = await newTable(s, P);
  t.mock.method(console, 'error', () => {});
  store.hit = async () => { throw new Error('нет связи'); };
  const r = await invite(P['Андрей']);
  assert.equal(r.status, 200);
  assert.equal(r.body.chat, false);
});

// --- отказ и уборка

test('отказ: место освобождается, хозяин получает ответ', async () => {
  const s = setup();
  const P = await company(s, 'Андрей');
  const { code, invite } = await newTable(s, P);
  await invite(P['Андрей']);
  const [letter] = await inbox(s, P['Андрей']);
  const r = await s.req('POST', 'invites/answer', { body: { id: letter.id, accept: false }, token: P['Андрей'].token });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  const v = (await s.req('GET', `tables/${code}`, { token: P.denis.token })).body;
  assert.equal(v.seats[1].taken, false);
  assert.ok((await inbox(s, P.denis)).some((m) => m.kind === 'declined' && m.from === 'Андрей'));
});

test('отказ по старому письму не снимает с места, куда позвали заново', async () => {
  const s = setup();
  const P = await company(s, 'Андрей');
  const { code, post, invite } = await newTable(s, P);
  await invite(P['Андрей']);
  await post(P.denis, { action: 'unseat', seat: 1 });
  await invite(P['Андрей']);
  const letters = await inbox(s, P['Андрей']);
  assert.equal(letters.length, 2);
  const seatedAt = await s.store.getTable(code);
  const fresh = seatedAt.doc.seats[1].invited;
  const old = letters.find((m) => m.id !== fresh);
  assert.ok(old && letters.some((m) => m.id === fresh), 'место помнит свое письмо');
  await s.req('POST', 'invites/answer', { body: { id: old.id, accept: false }, token: P['Андрей'].token });
  assert.equal((await s.req('GET', `tables/${code}`, { token: P['Андрей'].token })).body.me, 1);
  await s.req('POST', 'invites/answer', { body: { id: fresh, accept: false }, token: P['Андрей'].token });
  assert.equal((await s.req('GET', `tables/${code}`, { token: P['Андрей'].token })).body.me, null);
});

test('отказ после того, как убрали: ничего не ломает', async () => {
  const s = setup();
  const P = await company(s, 'Андрей');
  const { code, post, invite } = await newTable(s, P);
  await invite(P['Андрей']);
  await post(P.denis, { action: 'unseat', seat: 1 });
  const [letter] = await inbox(s, P['Андрей']);
  const r = await s.req('POST', 'invites/answer', { body: { id: letter.id, accept: false }, token: P['Андрей'].token });
  assert.equal(r.status, 200);
  assert.equal((await s.req('GET', `tables/${code}`, { token: P.denis.token })).status, 200);
});

test('отказ: проигранная запись повторяется, место освобождается, версия растет', async () => {
  const store = memoryStore();
  const s = setup(store);
  const P = await company(s, 'Андрей');
  const { code, invite } = await newTable(s, P);
  await invite(P['Андрей']);
  const [letter] = await inbox(s, P['Андрей']);
  const before = (await store.getTable(code)).version;
  const put = store.putTable;
  let misses = 1;
  store.putTable = async (...a) => (misses-- > 0 ? false : put(...a));
  await s.req('POST', 'invites/answer', { body: { id: letter.id, accept: false }, token: P['Андрей'].token });
  store.putTable = put;
  const after = await store.getTable(code);
  assert.ok(after.version > before);
  assert.equal(after.doc.seats[1].userId, null);
});

test('отказ от обычного приглашения и после начала партии места не меняет', async () => {
  const s = setup();
  const P = await company(s, 'Андрей', 'Влад');
  const { code, post, invite } = await newTable(s, P);
  await post(P['Андрей'], { action: 'sit', seat: 1 });
  await s.req('POST', 'invite', { body: { code, to: [P['Андрей'].user.id] }, token: P.denis.token });
  const [plain] = await inbox(s, P['Андрей']);
  await s.req('POST', 'invites/answer', { body: { id: plain.id, accept: false }, token: P['Андрей'].token });
  assert.equal((await post(P.denis, { action: 'seatKind', seat: 2, kind: 'bot' })).status, 200);
  let v = (await s.req('GET', `tables/${code}`, { token: P.denis.token })).body;
  assert.equal(v.seats[1].taken, true, 'сел сам, письмо старого вида: остается');

  await post(P.denis, { action: 'seatKind', seat: 2, kind: 'human' });
  await invite(P['Влад']);
  const [letter] = await inbox(s, P['Влад']);
  assert.equal((await post(P.denis, { action: 'start' })).status, 200);
  await s.req('POST', 'invites/answer', { body: { id: letter.id, accept: false }, token: P['Влад'].token });
  v = (await s.req('GET', `tables/${code}`, { token: P.denis.token })).body;
  assert.equal(v.status, 'playing');
  assert.equal(v.seats.find((x) => x.name === 'Влад').taken, true);
});

test('принял приглашение: остается за столом', async () => {
  const s = setup();
  const P = await company(s, 'Андрей');
  const { code, invite } = await newTable(s, P);
  await invite(P['Андрей']);
  const [letter] = await inbox(s, P['Андрей']);
  await s.req('POST', 'invites/answer', { body: { id: letter.id, accept: true }, token: P['Андрей'].token });
  assert.equal((await s.req('GET', `tables/${code}`, { token: P['Андрей'].token })).body.me, 1);
});

test('убрать: действие хозяина через запрос', async () => {
  const s = setup();
  const P = await company(s, 'Андрей');
  const { code, post, invite } = await newTable(s, P);
  await invite(P['Андрей']);
  assert.equal((await post(P['Андрей'], { action: 'unseat', seat: 0 })).status, 403);
  const before = (await s.req('GET', `tables/${code}/poll`, { token: P.denis.token })).body.version;
  const r = await post(P.denis, { action: 'unseat', seat: 1 });
  assert.equal(r.status, 200);
  assert.equal(r.body.seats[1].taken, false);
  const after = (await s.req('GET', `tables/${code}/poll`, { token: P.denis.token })).body.version;
  assert.ok(after > before, 'другие увидят уборку по опросу');
});

// --- текст

test('текст приглашения в чат', () => {
  const m = called('Денис', { code: 'ABC234', title: '01.11.2026.6' }, ['Андрей', 'Влад']);
  assert.equal(m.text, 'Денис зовёт за стол: Андрей, Влад\nСтол 01.11.2026.6');
  assert.equal(m.button, 'Открыть стол');
  assert.equal(m.url, `${SITE}#/t/ABC234`);
});
