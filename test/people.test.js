// Люди на сайте: свой код, администраторы, кто сейчас на сайте и приглашения в игру.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';
import { redisStore } from '../server/store-redis.js';
import { fakeUpstash } from './fake-upstash.js';
import { normalizeCode } from '../server/auth.js';
import { beatDelay, arrivals, freeSeat, pendingInvites } from '../public/js/online.js';

const ENV = { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' };

function setup(store = memoryStore()) {
  const box = { clock: Date.UTC(2026, 9, 30, 12, 0) };
  const app = createApp({ store, env: ENV, now: () => box.clock, botOptions: { timeCap: 20 } });
  const req = (method, path, { body, token } = {}) => app.call({ method, path, body, token });
  const login = async (code) => (await req('POST', 'activate', { body: { code } })).body;
  return { box, req, login, store };
}

/** Денис и игрок с готовой сессией. */
async function withPlayer(s, name = 'Петя', extra = {}) {
  const denis = await s.login('ADMN-TEST-2345');
  const r = await s.req('POST', 'admin/users', { body: { name, ...extra }, token: denis.token });
  const player = await s.login(r.body.code);
  return { denis, player, id: r.body.user.id };
}

// --- свой код

test('код: от 8 до 20 букв и цифр, регистр и дефисы не важны', () => {
  assert.equal(normalizeCode('petya-2026'), 'PETYA2026');
  assert.equal(normalizeCode('ABCD-EFG'), null, '7 знаков мало');
  assert.equal(normalizeCode('ABCD-EFGH'), 'ABCDEFGH');
  assert.equal(normalizeCode('A'.repeat(20)), 'A'.repeat(20));
  assert.equal(normalizeCode('A'.repeat(21)), null, '21 знак много');
  assert.equal(normalizeCode('ЖЖЖЖЖЖЖЖ'), null, 'только латиница');
});

test('свой код: с ним можно войти, случайный остается по умолчанию', async () => {
  const s = setup();
  const denis = await s.login('ADMN-TEST-2345');
  const r = await s.req('POST', 'admin/users', { body: { name: 'Петя', code: 'petya-2026' }, token: denis.token });
  assert.equal(r.status, 200);
  assert.equal(r.body.code, 'PETYA2026');
  assert.equal((await s.login('Petya 2026')).user.name, 'Петя');
  const auto = await s.req('POST', 'admin/users', { body: { name: 'Вася', code: '  ' }, token: denis.token });
  assert.equal(auto.body.code.length, 14, 'пустое поле: случайный код с дефисами');
});

test('код из мессенджера: вставка всего сообщения с именем не мешает входу', async () => {
  const s = setup();
  const denis = await s.login('ADMN-TEST-2345');
  const { code } = (await s.req('POST', 'admin/users', { body: { name: 'Петя' }, token: denis.token })).body;
  // поле ввода выбрасывает переводы строк, поэтому имя прилипает к коду
  for (const text of [`${code}\nПетя\nКод входа`, `${code}ПетяКод входа`, `Код входа: ${code}`]) {
    assert.equal((await s.login(text)).user?.name, 'Петя', text);
  }
  assert.equal((await s.req('POST', 'activate', { body: { code: 'Петя Код входа' } })).status, 401, 'без кода не войти');
});

test('код из мессенджера: годится и для поля «свой код», длинный свой код не обрезается', async () => {
  const s = setup();
  const denis = await s.login('ADMN-TEST-2345');
  const add = (body) => s.req('POST', 'admin/users', { body, token: denis.token });
  assert.equal((await add({ name: 'Андрей', code: 'ABCD-EFGH-JK23\nАндрей\nКод входа' })).body.code, 'ABCDEFGHJK23');
  assert.equal((await s.login('ABCD-EFGH-JK23')).user.name, 'Андрей');
  assert.equal(normalizeCode('ABCD-EFGH-JKMN-PQRS'), 'ABCDEFGHJKMNPQRS', 'четыре группы не режем до трех');
});

test('свой код: занятый или кривой код отклоняется и никого не создает', async () => {
  const s = setup();
  const { denis } = await withPlayer(s, 'Петя', { code: 'PETYA2026' });
  const add = (body) => s.req('POST', 'admin/users', { body, token: denis.token });
  assert.equal((await add({ name: 'Вор', code: 'petya-2026' })).status, 409, 'чужой код');
  assert.equal((await add({ name: 'Вор', code: 'ADMN-TEST-2345' })).status, 409, 'код главного');
  assert.equal((await add({ name: 'Вор', code: 'abc' })).status, 400);
  const list = (await s.req('GET', 'admin/users', { token: denis.token })).body;
  assert.deepEqual(list.map((u) => u.name).sort(), ['Денис', 'Петя']);
  assert.equal((await s.login('PETYA2026')).user.name, 'Петя', 'вход не перешел к другому');
});

test('имя не повторяется, без учета регистра', async () => {
  const s = setup();
  const { denis } = await withPlayer(s, 'Андрей');
  const r = await s.req('POST', 'admin/users', { body: { name: ' андрей ' }, token: denis.token });
  assert.equal(r.status, 409);
});

test('новый код можно вписать свой, старый перестает работать', async () => {
  const s = setup();
  const { denis, id } = await withPlayer(s, 'Петя', { code: 'PETYA2026' });
  const r = await s.req('POST', `admin/users/${id}/code`, { body: { code: 'PETYA2027' }, token: denis.token });
  assert.equal(r.body.code, 'PETYA2027');
  assert.equal((await s.req('POST', 'activate', { body: { code: 'PETYA2026' } })).status, 401);
  assert.equal((await s.login('PETYA2027')).user.name, 'Петя');
  const taken = await s.req('POST', `admin/users/${id}/code`, { body: { code: 'ADMN-TEST-2345' }, token: denis.token });
  assert.equal(taken.status, 409);
  assert.equal((await s.login('PETYA2027')).user.name, 'Петя', 'отказ не ломает действующий код');
});

// --- администраторы

test('администратор добавляет людей и управляет игроками, но не правами', async () => {
  const s = setup();
  const { denis, player: admin, id: adminId } = await withPlayer(s, 'Андрей', { admin: true });
  assert.equal(admin.user.admin, true);
  assert.equal(admin.user.main, false);
  assert.equal(denis.user.main, true);
  const as = (path, body) => s.req('POST', path, { body, token: admin.token });

  const added = await as('admin/users', { name: 'Вася' });
  assert.equal(added.status, 200);
  const vasya = added.body.user.id;
  assert.equal((await as(`admin/users/${vasya}/code`, {})).status, 200);
  assert.equal((await as(`admin/users/${vasya}/revoke`, {})).status, 200);

  assert.equal((await as('admin/users', { name: 'Коля', admin: true })).status, 403, 'выдать права нельзя');
  assert.equal((await as(`admin/users/${vasya}/admin`, { admin: true })).status, 403);
  const other = await s.req('POST', 'admin/users', { body: { name: 'Влад', admin: true }, token: denis.token });
  assert.equal((await as(`admin/users/${other.body.user.id}/revoke`, {})).status, 403, 'другого администратора не тронуть');
  assert.equal((await as('admin/users/u-admin/revoke', {})).status, 403, 'главного тоже');
  assert.equal((await as(`admin/users/${adminId}/code`, {})).status, 403, 'себя тоже');
});

test('главный ставит и снимает галочку, снятие действует сразу', async () => {
  const s = setup();
  const { denis, player, id } = await withPlayer(s);
  const asMain = (admin) => s.req('POST', `admin/users/${id}/admin`, { body: { admin }, token: denis.token });
  // список кодов открыт всем игрокам (04.11), но не администратор видит только себя и приглашенных им (05.11)
  const seen = async () => (await s.req('GET', 'admin/users', { token: player.token })).body.length;
  assert.equal(await seen(), 1, 'только себя');
  assert.equal((await asMain(true)).status, 200);
  assert.ok(await seen() >= 2, 'администратор видит всех');
  const list = (await s.req('GET', 'admin/users', { token: denis.token })).body;
  assert.equal(list.find((u) => u.id === id).admin, true);
  assert.equal(list.find((u) => u.id === 'u-admin').main, true);
  await asMain(false);
  assert.equal(await seen(), 1, 'снятие действует сразу');
  assert.equal((await s.req('POST', 'admin/users/u-admin/admin', { body: { admin: false }, token: denis.token })).status, 403, 'с себя не снять');
  assert.equal((await s.req('POST', 'admin/users/u-admin/revoke', { body: {}, token: denis.token })).status, 403);
});

// --- кто на сайте

test('пульс: видно других, себя в списке нет, пометка «в партии»', async () => {
  const s = setup();
  const { denis, player } = await withPlayer(s);
  assert.deepEqual((await s.req('POST', 'beat', { body: {}, token: denis.token })).body.online, []);
  const r = await s.req('POST', 'beat', { body: { busy: true }, token: player.token });
  assert.deepEqual(r.body.online.map((p) => [p.name, p.busy]), [['Денис', false]]);
  assert.equal(r.body.me.name, 'Петя');
  const d = await s.req('POST', 'beat', { body: {}, token: denis.token });
  assert.deepEqual(d.body.online.map((p) => [p.name, p.busy]), [['Петя', true]]);
});

test('пульс: без входа нельзя, пропавший через 90 секунд уходит из списка', async () => {
  const s = setup();
  const { denis, player } = await withPlayer(s);
  assert.equal((await s.req('POST', 'beat', { body: {} })).status, 401);
  await s.req('POST', 'beat', { body: {}, token: player.token });
  s.box.clock += 89_000;
  assert.equal((await s.req('POST', 'beat', { body: {}, token: denis.token })).body.online.length, 1);
  s.box.clock += 2_000;
  assert.equal((await s.req('POST', 'beat', { body: {}, token: denis.token })).body.online.length, 0);
});

test('пульс: отозванный код перестает работать, смена статуса пишется сразу', async () => {
  const s = setup();
  const { denis, player, id } = await withPlayer(s);
  await s.req('POST', 'beat', { body: {}, token: player.token });
  await s.req('POST', 'beat', { body: { busy: true }, token: player.token });
  const seen = (await s.req('POST', 'beat', { body: {}, token: denis.token })).body.online;
  assert.equal(seen[0].busy, true);
  await s.req('POST', `admin/users/${id}/revoke`, { body: {}, token: denis.token });
  assert.equal((await s.req('POST', 'beat', { body: {}, token: player.token })).status, 401);
});

test('расход базы: обычный пульс это одна команда, запись раз в минуту', async () => {
  const f = fakeUpstash();
  const s = setup(redisStore({ exec: f.exec, prefix: 'test:' }));
  const { player } = await withPlayer(s);
  await s.req('POST', 'beat', { body: {}, token: player.token });
  s.box.clock += 20_000;
  f.commands.length = 0;
  await s.req('POST', 'beat', { body: {}, token: player.token });
  assert.deepEqual(f.commands, ['MGET'], 'через 20 с только чтение');
  s.box.clock += 40_000;
  f.commands.length = 0;
  await s.req('POST', 'beat', { body: {}, token: player.token });
  assert.ok(f.commands.includes('SET'), 'через минуту отметка обновляется');
  assert.ok(f.commands.length <= 4, `не больше 4 команд, а было ${f.commands}`);
  assert.equal(f.commands.filter((c) => c === 'EVAL').length, 0, 'скрипт обходится дороже: команда за каждый вызов внутри');
});

// --- приглашения

async function lobby(s, who) {
  return (await s.req('POST', 'tables', { token: who.token })).body;
}

for (const [name, make] of [['память', () => memoryStore()], ['Redis', () => redisStore({ exec: fakeUpstash().exec, prefix: 'test:' })]]) {
  test(`приглашение (${name}): держится, пока на него не ответят, ответ убирает его`, async () => {
    const s = setup(make());
    const { denis, player, id } = await withPlayer(s);
    const { code, view } = await lobby(s, denis);
    const r = await s.req('POST', 'invite', { body: { code, to: [id] }, token: denis.token });
    assert.deepEqual(r.body, { sent: 1 });
    const beat = async () => (await s.req('POST', 'beat', { body: {}, token: player.token })).body.inbox;
    const inbox = await beat();
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].kind, 'invite');
    assert.equal(inbox[0].from, 'Денис');
    assert.equal(inbox[0].code, code);
    assert.equal(inbox[0].title, view.title);
    assert.equal((await beat()).length, 1, 'второе устройство и обновление страницы его не теряют');
    const a = await s.req('POST', 'invites/answer', { body: { id: inbox[0].id, accept: true }, token: player.token });
    assert.deepEqual(a.body, { ok: true });
    assert.deepEqual(await beat(), []);
    assert.deepEqual((await s.req('POST', 'beat', { body: {}, token: denis.token })).body.inbox, [], 'согласие без письма в ответ');
  });
}

test('ответ на одно приглашение не трогает другое', async () => {
  const s = setup();
  const { denis, player, id } = await withPlayer(s);
  const one = (await lobby(s, denis)).code, two = (await lobby(s, denis)).code;
  for (const code of [one, two]) await s.req('POST', 'invite', { body: { code, to: [id] }, token: denis.token });
  const inbox = (await s.req('POST', 'beat', { body: {}, token: player.token })).body.inbox;
  assert.notEqual(inbox[0].id, inbox[1].id);
  await s.req('POST', 'invites/answer', { body: { id: inbox[0].id, accept: true }, token: player.token });
  const left = (await s.req('POST', 'beat', { body: {}, token: player.token })).body.inbox;
  assert.deepEqual(left.map((m) => m.code), [two]);
});

test('приглашение: зовет только тот, кто за столом, и только в лобби', async () => {
  const s = setup();
  const { denis, player, id } = await withPlayer(s);
  const { code } = await lobby(s, denis);
  assert.equal((await s.req('POST', 'invite', { body: { code, to: ['u-admin'] }, token: player.token })).status, 403);
  assert.equal((await s.req('POST', 'invite', { body: { code: 'NOPE00', to: [id] }, token: denis.token })).status, 404);
  assert.equal((await s.req('POST', 'invite', { body: { code, to: [] }, token: denis.token })).status, 400);
  assert.equal((await s.req('POST', 'invite', { body: { code, to: 'x' }, token: denis.token })).status, 400);
  const r = await s.req('POST', 'invite', { body: { code, to: ['u-admin', 'нет-такого', id] }, token: denis.token });
  assert.deepEqual(r.body, { sent: 1 }, 'себя и несуществующих не зовем');
});

test('приглашение старше 10 минут не показывается', async () => {
  const s = setup();
  const { denis, player, id } = await withPlayer(s);
  const { code } = await lobby(s, denis);
  await s.req('POST', 'invite', { body: { code, to: [id] }, token: denis.token });
  s.box.clock += 10 * 60_000 + 1;
  assert.deepEqual((await s.req('POST', 'beat', { body: {}, token: player.token })).body.inbox, []);
});

test('отказ доходит до пригласившего, без приглашения отказать нельзя', async () => {
  const s = setup();
  const { denis, player, id } = await withPlayer(s);
  const { code, view } = await lobby(s, denis);
  const fake = await s.req('POST', 'invites/answer', { body: { id: 'нет-такого', accept: false }, token: player.token });
  assert.deepEqual(fake.body, { ok: false });
  assert.deepEqual((await s.req('POST', 'beat', { body: {}, token: denis.token })).body.inbox, [], 'спама нет');

  await s.req('POST', 'invite', { body: { code, to: [id] }, token: denis.token });
  const [m] = (await s.req('POST', 'beat', { body: {}, token: player.token })).body.inbox;
  await s.req('POST', 'invites/answer', { body: { id: m.id, accept: false }, token: player.token });
  const inbox = (await s.req('POST', 'beat', { body: {}, token: denis.token })).body.inbox;
  assert.deepEqual(inbox.map((x) => [x.kind, x.from, x.title]), [['declined', 'Петя', view.title]]);
  assert.ok(inbox[0].id);
  const again = await s.req('POST', 'invites/answer', { body: { id: m.id, accept: false }, token: player.token });
  assert.deepEqual(again.body, { ok: false }, 'второй ответ не шлет второго отказа');
});

test('пульс: старый список на другом экземпляре функции не выбрасывает игрока', async () => {
  const store = memoryStore();
  const a = setup(store), b = setup(store);
  const { denis, player, id } = await withPlayer(a, 'Петя', { code: 'PETYA2026' });
  assert.equal((await b.req('POST', 'beat', { body: {}, token: player.token })).status, 200, 'B запомнил список');
  await a.req('POST', `admin/users/${id}/code`, { body: { code: 'PETYA2027' }, token: denis.token });
  const fresh = await a.login('PETYA2027');
  assert.equal((await b.req('POST', 'beat', { body: {}, token: fresh.token })).status, 200, 'новый вход работает на B');
  assert.equal((await b.req('POST', 'beat', { body: {}, token: player.token })).status, 401, 'старый токен отсекается');
});

test('подбор своего кода ограничен, как подбор при входе', async () => {
  const s = setup();
  const { player: admin, id } = await withPlayer(s, 'Андрей', { admin: true });
  const { body: { user } } = await s.req('POST', 'admin/users', { body: { name: 'Вася' }, token: admin.token });
  const statuses = [];
  for (let k = 0; k < 21; k++) statuses.push((await s.req('POST', `admin/users/${user.id}/code`, { body: { code: `GUESS${1000 + k}` }, token: admin.token })).status);
  assert.equal(statuses[0], 200);
  assert.equal(statuses[20], 429);
  assert.equal(id.length > 0, true);
  const auto = await s.req('POST', 'admin/users', { body: { name: 'Коля' }, token: admin.token });
  assert.equal(auto.status, 200, 'случайные коды лимит не трогает');
});

// --- расчеты клиента

test('темп пульса: 20 с на виду, минута в партии и на скрытой вкладке, потом стоп', () => {
  assert.equal(beatDelay({ hiddenMs: null, busy: false }), 20_000);
  assert.equal(beatDelay({ hiddenMs: null, busy: true }), 60_000);
  assert.equal(beatDelay({ hiddenMs: 1000, busy: false }), 60_000);
  assert.equal(beatDelay({ hiddenMs: 30 * 60_000, busy: false }), null);
});

test('кто зашел: при первом пульсе никого, потом только новые', () => {
  const p = (id, name) => ({ id, name });
  assert.deepEqual(arrivals(null, [p('a', 'А')]), []);
  assert.deepEqual(arrivals([p('a', 'А')], [p('a', 'А'), p('b', 'Б')]).map((x) => x.name), ['Б']);
  assert.deepEqual(arrivals([p('a', 'А')], []), []);
});

test('плашка: приглашения без отвеченных и без ответов на них', () => {
  const inbox = [{ id: 'a', kind: 'invite' }, { id: 'b', kind: 'invite' }, { id: 'c', kind: 'declined' }];
  assert.deepEqual(pendingInvites(inbox, new Set(['b'])).map((m) => m.id), ['a']);
});

test('свободное место: первое незанятое место человека', () => {
  const v = (seats) => ({ seats });
  assert.equal(freeSeat(v([{ id: 0, kind: 'human', taken: true }, { id: 3, kind: 'bot', taken: true }, { id: 1, kind: 'human', taken: false }])), 1);
  assert.equal(freeSeat(v([{ id: 0, kind: 'human', taken: true }])), null);
});
