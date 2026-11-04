// Страница «Начать игру» (просьба Дениса 04.11): стол с ботами собирается теми же запросами,
// что шлет кнопка, и начинается сразу; в приветствии раздел стоит первым.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';
import { SECTIONS } from '../public/js/welcome.js';

const ENV = { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' };

test('«Стол с ботами»: вы и три бота, хозяин начинает без ожидания', async () => {
  const app = createApp({ store: memoryStore(), env: ENV, now: () => 1_800_000_000_000, botOptions: { timeCap: 20 } });
  const req = (method, path, body, token) => app.call({ method, path, body, token });
  const { token } = (await req('POST', 'activate', { code: 'ADMN-TEST-2345' })).body;
  const { code } = (await req('POST', 'tables', undefined, token)).body;
  for (const seat of [1, 2]) assert.equal((await req('POST', `tables/${code}`, { action: 'seatKind', seat, kind: 'bot' }, token)).status, 200);
  const lobby = (await req('GET', `tables/${code}`, undefined, token)).body;
  assert.deepEqual(lobby.seats.map((s) => s.kind), ['human', 'bot', 'bot', 'bot']);
  const r = await req('POST', `tables/${code}`, { action: 'start' }, token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'playing');
});

test('приветствие: «Начать игру» первым разделом, «Мои столы» только список партий', () => {
  assert.deepEqual(SECTIONS.map((s) => s[0]), ['#/new', '#/tables', '#/stats', '#/rules', '#/learn', '#/admin']);
  assert.doesNotMatch(SECTIONS[1][2], /новый стол/);
});

test('меню и главная: «Начать игру» первым пунктом, на главной нет создания стола', () => {
  const main = readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
  const bar = main.slice(main.indexOf('function topbar('), main.indexOf('function bindTopbar('));
  // у логотипа тоже href="#/", поэтому ищем по подписи пункта
  const order = ['Начать игру', 'Мои столы', 'Статистика', 'Правила', 'Обучение'].map((t) => bar.indexOf(`>${t}</a>`));
  assert.ok(order.every((i) => i > 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'порядок пунктов меню');
  const home = main.slice(main.indexOf('async function renderHome('), main.indexOf('function route('));
  assert.doesNotMatch(home, /mountOnline|joinForm|newTable/);
  assert.match(main, /if \(h === 'new'\) return renderNew\(\);/);
});
