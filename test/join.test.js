// Регистрация по ссылке-приглашению (Денис 06.11): новичок сам вписывает имя, получает код и сразу
// входит; ссылка на одного человека, 7 дней, отзывается; ссылка за стол несет код стола. Все сценарии
// на хранилище в памяти и на поддельном Upstash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';
import { redisStore } from '../server/store-redis.js';
import { fakeUpstash } from './fake-upstash.js';

const ENV = { SESSION_SECRET: 'test-secret', CODE_PEPPER: 'test-pepper', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' };
const DAY = 24 * 3600 * 1000;
const STORES = {
  'память': () => memoryStore(),
  'Upstash': () => redisStore({ exec: fakeUpstash().exec, prefix: 'test:' }),
};

async function setup(store) {
  const clock = { t: 1_800_000_000_000 };
  const app = createApp({ store, env: ENV, now: () => clock.t++, botOptions: { timeCap: 20 } });
  const req = async (method, path, { body, token, query } = {}) => app.call({ method, path, body, token, query, ip: '1.2.3.4' });
  const denis = (await req('POST', 'activate', { body: { code: 'ADMN-TEST-2345' } })).body;
  const mk = async (name) => {
    const r = await req('POST', 'admin/users', { body: { name }, token: denis.token });
    return (await req('POST', 'activate', { body: { code: r.body.code } })).body;
  };
  return { req, clock, denis, andrey: await mk('Андрей'), vlad: await mk('Влад') };
}

for (const [kind, make] of Object.entries(STORES)) {
  test(`${kind}: новичок по ссылке сам вписывает имя, получает код и входит; ссылка одноразовая`, async () => {
    const { req, clock, andrey } = await setup(make());
    const link = await req('POST', 'joinlinks', { body: {}, token: andrey.token });
    assert.equal(link.status, 200, JSON.stringify(link.body));
    assert.match(link.body.token, /^[A-Za-z0-9_-]{22}$/);
    assert.ok(Math.abs(link.body.until - (clock.t + 7 * DAY)) < 1000, 'действует 7 дней');
    assert.equal(link.body.table, null);

    const info = await req('POST', 'join/info', { body: { token: link.body.token } });
    assert.equal(info.status, 200, JSON.stringify(info.body));
    assert.deepEqual(info.body, { by: 'Андрей', table: null });

    const reg = await req('POST', 'join', { body: { token: link.body.token, name: '  Гоша ' } });
    assert.equal(reg.status, 200, JSON.stringify(reg.body));
    assert.equal(reg.body.user.name, 'Гоша');
    assert.equal(reg.body.user.admin, false);
    assert.equal(reg.body.table, null);
    assert.equal((await req('GET', 'me', { token: reg.body.token })).body.name, 'Гоша', 'сразу вошел');
    const again = await req('POST', 'activate', { body: { code: reg.body.code } });
    assert.equal(again.body.user.name, 'Гоша', 'код работает на другом устройстве');

    const mine = (await req('GET', 'admin/users', { token: andrey.token })).body;
    assert.ok(mine.some((u) => u.name === 'Гоша' && u.invitedBy === 'Андрей'), 'новичок в списке пригласившего');

    assert.equal((await req('POST', 'join', { body: { token: link.body.token, name: 'Гоша Два' } })).status, 410, 'второй раз ссылка не действует');
    assert.equal((await req('POST', 'join/info', { body: { token: link.body.token } })).status, 410);
    assert.deepEqual((await req('GET', 'joinlinks', { token: andrey.token })).body, [], 'использованной ссылки в списке нет');
  });

  test(`${kind}: ссылка за стол несет код и название стола, только пока партия не началась`, async () => {
    const { req, denis, andrey, vlad } = await setup(make());
    const { body: { code } } = await req('POST', 'tables', { token: denis.token });
    const link = await req('POST', 'joinlinks', { body: { table: code }, token: andrey.token });
    assert.equal(link.status, 200, JSON.stringify(link.body));
    assert.equal(link.body.table.code, code);
    const info = (await req('POST', 'join/info', { body: { token: link.body.token } })).body;
    assert.equal(info.table.code, code);
    assert.match(info.table.title, /\S/);
    const reg = await req('POST', 'join', { body: { token: link.body.token, name: 'Гоша' } });
    assert.equal(reg.body.table.code, code);
    const listed = (await req('GET', 'joinlinks', { token: andrey.token })).body;
    assert.deepEqual(listed, []);

    assert.equal((await req('POST', 'joinlinks', { body: { table: 'ZZZZZZ' }, token: andrey.token })).status, 404, 'нет такого стола');
    // партия началась: новичку за этот стол уже не сесть
    const post = (who, body) => req('POST', `tables/${code}`, { body, token: who.token });
    await post(andrey, { action: 'sit', seat: 1 });
    await post(vlad, { action: 'sit', seat: 2 });
    for (const p of [andrey, vlad]) await req('GET', `tables/${code}/poll`, { token: p.token, query: { here: '1' } });
    const s = await post(denis, { action: 'start' });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    const late = await req('POST', 'joinlinks', { body: { table: code }, token: andrey.token });
    assert.equal(late.status, 409);
    assert.equal(late.body.error, 'not-lobby');
  });

  test(`${kind}: занятое или пустое имя не сжигает ссылку`, async () => {
    const { req, andrey } = await setup(make());
    const { token } = (await req('POST', 'joinlinks', { body: {}, token: andrey.token })).body;
    const taken = await req('POST', 'join', { body: { token, name: 'андрей' } });
    assert.equal(taken.status, 409);
    assert.equal(taken.body.error, 'name-taken');
    assert.equal((await req('POST', 'join', { body: { token, name: '   ' } })).status, 400);
    assert.equal((await req('POST', 'join', { body: { token, name: 'x'.repeat(31) } })).status, 400);
    assert.equal((await req('POST', 'join', { body: { token, name: 'Гоша' } })).status, 200, 'после отказов ссылка цела');
  });

  test(`${kind}: свою ссылку видит и отзывает только создавший; отозванная не действует`, async () => {
    const { req, andrey, vlad } = await setup(make());
    const link = (await req('POST', 'joinlinks', { body: {}, token: andrey.token })).body;
    const list = (await req('GET', 'joinlinks', { token: andrey.token })).body;
    assert.equal(list.length, 1);
    assert.deepEqual(Object.keys(list[0]).sort(), ['createdAt', 'id', 'table', 'until']);
    assert.ok(!JSON.stringify(list).includes(link.token), 'ссылку целиком второй раз не отдаем');
    assert.deepEqual((await req('GET', 'joinlinks', { token: vlad.token })).body, [], 'чужих ссылок не видно');
    assert.equal((await req('POST', `joinlinks/${list[0].id}/revoke`, { token: vlad.token })).status, 404, 'чужую не отозвать');
    assert.equal((await req('POST', `joinlinks/${list[0].id}/revoke`, { token: andrey.token })).status, 200);
    assert.deepEqual((await req('GET', 'joinlinks', { token: andrey.token })).body, []);
    assert.equal((await req('POST', 'join', { body: { token: link.token, name: 'Гоша' } })).status, 410);
  });

  test(`${kind}: ссылка гаснет через 7 дней и вместе с кодом пригласившего`, async () => {
    const { req, clock, denis, andrey } = await setup(make());
    const old = (await req('POST', 'joinlinks', { body: {}, token: andrey.token })).body;
    clock.t += 7 * DAY + 1000;
    assert.equal((await req('POST', 'join/info', { body: { token: old.token } })).status, 410, 'срок вышел');
    assert.equal((await req('POST', 'join', { body: { token: old.token, name: 'Гоша' } })).status, 410);
    assert.deepEqual((await req('GET', 'joinlinks', { token: andrey.token })).body, [], 'просроченной в списке нет');

    const fresh = (await req('POST', 'joinlinks', { body: {}, token: andrey.token })).body;
    await req('POST', `admin/users/${andrey.user.id}/revoke`, { token: denis.token });
    assert.equal((await req('POST', 'join', { body: { token: fresh.token, name: 'Гоша' } })).status, 410, 'пригласивший больше не играет');
  });

  test(`${kind}: лимиты, мусор вместо ссылки, без входа ссылку не создать`, async () => {
    const { req, denis, vlad } = await setup(make());
    for (let i = 0; i < 10; i++) assert.equal((await req('POST', 'joinlinks', { body: {}, token: vlad.token })).status, 200);
    assert.equal((await req('POST', 'joinlinks', { body: {}, token: vlad.token })).status, 429, 'не больше 10 у игрока');
    for (let i = 0; i < 12; i++) assert.equal((await req('POST', 'joinlinks', { body: {}, token: denis.token })).status, i < 10 ? 200 : 429, 'и у администратора не больше 10 действующих');
    for (const bad of ['', 'abc', 'x'.repeat(500), null, 42]) {
      assert.equal((await req('POST', 'join/info', { body: { token: bad } })).status, 410, String(bad));
      assert.equal((await req('POST', 'join', { body: { token: bad, name: 'Гоша' } })).status, 410, String(bad));
    }
    assert.equal((await req('POST', 'joinlinks', { body: {} })).status, 401);
    assert.equal((await req('GET', 'joinlinks', {})).status, 401);
  });

  test(`${kind}: ревью 06.11: список не теряет ссылки при одновременных записях`, async () => {
    const { req, denis, andrey } = await setup(make());
    // администратор создает 8 ссылок разом: все видны в списке и все отзываются
    const made = await Promise.all(Array.from({ length: 8 }, () => req('POST', 'joinlinks', { body: {}, token: denis.token })));
    assert.ok(made.every((r) => r.status === 200));
    assert.equal((await req('GET', 'joinlinks', { token: denis.token })).body.length, 8);
    // новичок регистрируется по L1, пока пригласивший создает L2 и смотрит список
    const l1 = (await req('POST', 'joinlinks', { body: {}, token: andrey.token })).body;
    const [reg, l2] = await Promise.all([
      req('POST', 'join', { body: { token: l1.token, name: 'Гоша' } }),
      req('POST', 'joinlinks', { body: {}, token: andrey.token }),
      req('GET', 'joinlinks', { token: andrey.token }),
    ]);
    assert.equal(reg.status, 200);
    const list = (await req('GET', 'joinlinks', { token: andrey.token })).body;
    assert.equal(list.length, 1, 'использованная L1 ушла, новая L2 на месте');
    assert.equal((await req('POST', `joinlinks/${list[0].id}/revoke`, { token: andrey.token })).status, 200);
    assert.equal((await req('POST', 'join/info', { body: { token: l2.body.token } })).status, 410, 'отозвана именно L2');
  });

  test(`${kind}: ревью 06.11: ссылки отозванного игрока не оживают с новым кодом`, async () => {
    const { req, denis, andrey } = await setup(make());
    const link = (await req('POST', 'joinlinks', { body: {}, token: andrey.token })).body;
    await req('POST', `admin/users/${andrey.user.id}/revoke`, { token: denis.token });
    assert.equal((await req('POST', `admin/users/${andrey.user.id}/code`, { token: denis.token })).status, 200);
    assert.equal((await req('POST', 'join', { body: { token: link.token, name: 'Гоша' } })).status, 410);
  });

  test(`${kind}: ревью 06.11: имя без невидимых знаков, двойник не проходит; 0 и false не имена`, async () => {
    const { req, denis, andrey } = await setup(make());
    const { token } = (await req('POST', 'joinlinks', { body: {}, token: andrey.token })).body;
    assert.equal((await req('POST', 'join', { body: { token, name: 'Андр​ей' } })).status, 409, 'Андрей с невидимым знаком');
    assert.equal((await req('POST', 'join', { body: { token, name: '​‍' } })).status, 400, 'одни невидимые знаки');
    const ok = await req('POST', 'join', { body: { token, name: '  Гоша \t  Вол­ков ' } });
    assert.equal(ok.body.user.name, 'Гоша Волков', 'пробелы схлопнуты, мягкий перенос убран');
    for (const name of [0, false]) assert.equal((await req('POST', 'admin/users', { body: { name }, token: denis.token })).status, 400, String(name));
  });

  test(`${kind}: ревью 06.11: за удаленный стол ссылку не создать`, async () => {
    const { req, denis } = await setup(make());
    const { body: { code } } = await req('POST', 'tables', { token: denis.token });
    assert.equal((await req('POST', `tables/${code}/delete`, { token: denis.token })).status, 200);
    const r = await req('POST', 'joinlinks', { body: { table: code }, token: denis.token });
    assert.equal(r.status, 404);
    assert.equal(r.body.error, 'no-table');
  });

  test(`${kind}: две регистрации по одной ссылке одновременно: проходит одна`, async () => {
    const { req, andrey } = await setup(make());
    const { token } = (await req('POST', 'joinlinks', { body: {}, token: andrey.token })).body;
    const both = await Promise.all([
      req('POST', 'join', { body: { token, name: 'Гоша' } }),
      req('POST', 'join', { body: { token, name: 'Миша' } }),
    ]);
    assert.deepEqual(both.map((r) => r.status).sort(), [200, 410]);
    const all = (await req('GET', 'admin/users', { token: andrey.token })).body.map((u) => u.name);
    assert.equal(all.filter((n) => n === 'Гоша' || n === 'Миша').length, 1);
  });
}

test('подбор ссылок упирается в лимит попыток с одного адреса', async () => {
  const app = createApp({ store: memoryStore(), env: ENV, now: () => 1_800_000_000_000 });
  let last;
  for (let i = 0; i < 25; i++) last = await app.call({ method: 'POST', path: 'join/info', body: { token: 'A'.repeat(22) }, ip: '9.9.9.9' });
  assert.equal(last.status, 429);
});

test('клиент: адрес ссылки с токеном после #, подписи и сообщения об ошибках', async () => {
  const { JOIN_ROUTE, joinUrl, linkNote, linkLine, joinError } = await import('../public/js/join-link.js');
  const tok = 'AbC_dE-fGh1234567890xy';
  const url = joinUrl(tok, { origin: 'https://site.app', pathname: '/' });
  assert.equal(url, `https://site.app/#/join/${tok}`);
  assert.equal(JOIN_ROUTE.exec(url.split('#/')[1])[1], tok);
  assert.equal(JOIN_ROUTE.exec('join/short'), null);
  const until = new Date(2026, 10, 13, 12).getTime(), createdAt = new Date(2026, 10, 6, 12).getTime();
  assert.match(linkNote({ until, table: null }), /сразу войдет\. Ссылка на одного человека, действует до 13\.11\./);
  assert.match(linkNote({ until, table: { code: 'ABCDEF', title: '06.11.2026.2' } }), /сядет на свободное место за столом 06\.11\.2026\.2/);
  assert.equal(linkLine({ createdAt, until, table: null }), 'создана 06.11, действует до 13.11');
  assert.equal(linkLine({ createdAt, until, table: { title: 'Т' } }), 'создана 06.11, действует до 13.11, за стол Т');
  assert.match(joinError({ code: 'join-gone' }), /Попросите у пригласившего новую/);
  assert.match(joinError({ code: 'name-taken' }), /Такое имя уже есть/);
  for (const s of [linkNote({ until, table: { title: 'Т' } }), joinError({ code: 'join-gone' })]) assert.doesNotMatch(s, /[—…]/);
});
