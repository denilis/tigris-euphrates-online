// Короткий код главного администратора: цифры вместо длинного кода, остальные игроки без изменений.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';
import { normalizeCode } from '../server/auth.js';

const BASE = { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' };
const ENV = { ...BASE, ADMIN_PIN: '7531' };
const DAY = 24 * 3600 * 1000;

function setup(env = ENV) {
  const app = createApp({ store: memoryStore(), env, botOptions: { timeCap: 20 } });
  let ip = 0;
  // каждый вход с нового адреса: так виден общий лимит, а не лимит одного адреса
  const enter = (code) => app.call({ method: 'POST', path: 'activate', body: { code }, ip: `10.0.0.${++ip}` });
  return { app, enter };
}

test('короткий код: вход главного администратора, длинный остается запасным', async () => {
  const { enter } = setup();
  const r = await enter('7531');
  assert.equal(r.status, 200);
  assert.equal(r.body.user.name, 'Денис');
  assert.equal(r.body.user.main, true);
  assert.equal((await enter(' 7531 ')).status, 200, 'пробелы по краям не мешают');
  assert.equal((await enter('ADMN-TEST-2345')).body.user.main, true);
});

test('короткий код: другие знаки той же длины не подходят', async () => {
  const { enter } = setup();
  for (const code of ['0000', '7530', '1357', 'abcd', '----', '    ', '']) {
    const r = await enter(code);
    assert.equal(r.status, 401, JSON.stringify(code));
    assert.equal(r.body.error, 'bad-code');
  }
});

test('короткий код: первый вход заводит главного администратора', async () => {
  const { app, enter } = setup();
  const { body } = await enter('7531');
  assert.equal((await app.call({ method: 'GET', path: 'me', token: body.token })).body.name, 'Денис');
});

test('короткий код: общий лимит попыток со всех адресов, длинный код при этом работает', async () => {
  const { enter } = setup();
  for (let k = 0; k < 30; k++) assert.equal((await enter('0000')).status, 401, `попытка ${k + 1}`);
  const blocked = await enter('7531');
  assert.equal(blocked.status, 429, 'подбор останавливается, даже если адреса разные');
  assert.equal(blocked.body.error, 'too-many');
  assert.equal((await enter('ADMN-TEST-2345')).status, 200);
});

test('короткий код: через сутки попытки снова доступны', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 1, 12, 0) });
  const { enter } = setup();
  for (let k = 0; k < 31; k++) await enter('0000');
  assert.equal((await enter('7531')).status, 429);
  t.mock.timers.tick(DAY - 60 * 1000);
  assert.equal((await enter('7531')).status, 429, 'за минуту до конца суток еще закрыто');
  t.mock.timers.tick(2 * 60 * 1000);
  assert.equal((await enter('7531')).status, 200);
});

test('короткий код: непохожий ввод не тратит общий лимит', async () => {
  const { enter } = setup();
  for (let k = 0; k < 31; k++) assert.equal((await enter('abcd')).status, 401);
  assert.equal((await enter('7531')).status, 200);
});

test('короткий код: ввод не строкой не ломает вход и не тратит лимит', async () => {
  const { enter } = setup();
  for (const code of [{ toString: 1 }, [['7531']], ['7531'], 7531, true, null, undefined]) {
    const r = await enter(code);
    assert.equal(r.status, 401, JSON.stringify(code));
    assert.equal(r.body.error, 'bad-code');
  }
  assert.equal((await enter('7531')).status, 200);
});

test('ADMIN_PIN: только от 4 до 7 цифр, иначе вход коротким кодом выключен', async () => {
  for (const pin of ['7', '753', 'abcd', '12 34', '12345678', 'ABCD2345']) {
    const { enter } = setup({ ...BASE, ADMIN_PIN: pin });
    assert.equal((await enter(pin)).status, 401, pin);
    assert.equal((await enter('ADMN-TEST-2345')).status, 200, 'длинный код работает');
  }
  for (const pin of ['1234', '1234567']) {
    assert.equal((await setup({ ...BASE, ADMIN_PIN: pin }).enter(pin)).status, 200, pin);
  }
});

test('ADMIN_PIN из 8 знаков не отдает игроку права главного администратора', async () => {
  const { app, enter } = setup({ ...BASE, ADMIN_PIN: '12345678' });
  const denis = (await enter('ADMN-TEST-2345')).body;
  const r = await app.call({ method: 'POST', path: 'admin/users', body: { name: 'Вася', code: '12345678' }, token: denis.token });
  assert.equal(r.status, 200);
  const vasya = await enter('12345678');
  assert.equal(vasya.body.user.name, 'Вася');
  assert.equal(vasya.body.user.main, false);
});

test('без ADMIN_PIN короткие коды не работают', async () => {
  const { enter } = setup(BASE);
  for (const code of ['7531', '0000', '']) assert.equal((await enter(code)).status, 401, code);
  assert.equal((await enter('ADMN-TEST-2345')).status, 200);
});

test('короткий код не задевает игроков: их коды прежние, короче 8 знаков нельзя', async () => {
  const { app, enter } = setup();
  const denis = (await enter('7531')).body;
  const add = (body) => app.call({ method: 'POST', path: 'admin/users', body, token: denis.token });
  assert.equal(normalizeCode('7531'), null);
  assert.equal((await add({ name: 'Петя', code: '7531' })).status, 400);
  const r = await add({ name: 'Вася' });
  assert.equal(r.status, 200);
  assert.equal((await enter(r.body.code)).body.user.name, 'Вася');
});
