// Названия (просьбы Дениса 30.10): стол называется датой и номером за день, бот своим стилем.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTable, setBot, setSeatKind, tableDay } from '../game/table.js';
import { STYLE_LABELS } from '../game/vendor/bot/styles.js';
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';

const ENV = { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' };
const table = () => createTable({ code: 'NAMES1', host: { userId: 'a', name: 'А' }, now: 0 });

test('день стола считается по Москве', () => {
  assert.equal(tableDay(Date.UTC(2026, 9, 30, 20, 59)), '30.10.2026');
  assert.equal(tableDay(Date.UTC(2026, 9, 30, 21, 0)), '31.10.2026', 'в Москве уже полночь');
  assert.equal(tableDay(Date.UTC(2026, 0, 5, 12, 0)), '05.01.2026', 'день и месяц с нулем');
});

test('бот по умолчанию называется универсальным', () => {
  assert.equal(table().seats[3].name, 'Бот универсальный');
});

test('имя бота идет за выбранным стилем, другие настройки его не трогают', () => {
  const t = table();
  const names = { universal: 'Бот универсальный', base: 'Бот базовый', top: 'Бот топ-мастера', denis: 'Бот Денис', andrey: 'Бот Андрей', vlad: 'Бот Влад' };
  for (const style of Object.keys(STYLE_LABELS).filter((k) => k !== 'mix')) {
    setBot(t, 'a', 3, { style }, 0);
    assert.equal(t.seats[3].name, names[style], style);
  }
  setBot(t, 'a', 3, { strength: 90 }, 0);
  assert.equal(t.seats[3].name, 'Бот Влад');
});

test('два бота одного стиля различаются номером, а если стиль сменили, номер уходит', () => {
  const t = table();
  setSeatKind(t, 'a', 2, 'bot', 0);
  assert.deepEqual(t.seats.slice(2).map((s) => s.name), ['Бот универсальный', 'Бот универсальный 2']);
  setBot(t, 'a', 2, { style: 'vlad' }, 0);
  assert.deepEqual(t.seats.slice(2).map((s) => s.name), ['Бот Влад', 'Бот универсальный']);
  setBot(t, 'a', 3, { style: 'vlad' }, 0);
  assert.deepEqual(t.seats.slice(2).map((s) => s.name), ['Бот Влад', 'Бот Влад 2']);
  setSeatKind(t, 'a', 2, 'human', 0);
  assert.equal(t.seats[3].name, 'Бот Влад', 'первый такой бот ушел с места');
});

test('название стола: дата и номер за этот день, на следующий день счет заново', async () => {
  let clock = Date.UTC(2026, 9, 30, 12, 0);
  const app = createApp({ store: memoryStore(), env: ENV, now: () => clock, botOptions: { timeCap: 20 } });
  const req = (method, path, { body, token } = {}) => app.call({ method, path, body, token });
  const { token } = (await req('POST', 'activate', { body: { code: 'ADMN-TEST-2345' } })).body;

  const first = (await req('POST', 'tables', { token })).body;
  const second = (await req('POST', 'tables', { token })).body;
  assert.equal(first.view.title, '30.10.2026.1');
  assert.equal(second.view.title, '30.10.2026.2');
  assert.equal((await req('GET', `tables/${first.code}`, { token })).body.title, '30.10.2026.1', 'вид стола');
  const list = (await req('GET', 'tables', { token })).body;
  assert.deepEqual(list.map((t) => t.title).sort(), ['30.10.2026.1', '30.10.2026.2'], 'мои столы');

  clock += 86_400_000;
  assert.equal((await req('POST', 'tables', { token })).body.view.title, '31.10.2026.1');
});

test('отклоненный реванш номер стола не расходует', async () => {
  const app = createApp({ store: memoryStore(), env: ENV, now: () => Date.UTC(2026, 9, 30, 12, 0), botOptions: { timeCap: 20 } });
  const req = (method, path, { body, token } = {}) => app.call({ method, path, body, token });
  const { token } = (await req('POST', 'activate', { body: { code: 'ADMN-TEST-2345' } })).body;
  const { code } = (await req('POST', 'tables', { token })).body;
  assert.equal((await req('POST', `tables/${code}`, { body: { action: 'rematch' }, token })).status, 409, 'партия не закончена');
  assert.equal((await req('POST', 'tables', { token })).body.view.title, '30.10.2026.2');
});
