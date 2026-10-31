// Настройки экрана партии: логика панели и сохранение за игроком.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCKS, cleanLayout, clampSide, moveBlock, dropIndex, toggled, stopLabel } from '../public/js/layout-core.js';
import { cleanPrefs } from '../server/prefs.js';
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';
import { redisStore } from '../server/store-redis.js';
import { fakeUpstash } from './fake-upstash.js';

const ENV = { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' };

test('настройки по умолчанию и защита от мусора', () => {
  const base = { side: 0, left: false, order: BLOCKS, shut: [] };
  for (const bad of [null, undefined, 5, 'x', []]) assert.deepEqual(cleanLayout(bad), base);
  assert.deepEqual(cleanLayout({ side: 9999, left: 'да', order: ['log'], shut: ['чужое', 'log'] }), { ...base, shut: ['log'] });
  assert.equal(cleanLayout({ side: 300.5 }).side, 0);
  const good = { side: 400, left: true, order: ['log', 'now', 'stock', 'players'], shut: ['stock'] };
  assert.deepEqual(cleanLayout(good), good);
});

test('ширина панели в границах, карте остается место', () => {
  assert.equal(clampSide(100), 250);
  assert.equal(clampSide(900), 520);
  assert.equal(clampSide(333.4), 333);
  assert.equal(clampSide(520, 900), 400, 'узкое окно');
  assert.equal(clampSide(520, 600), 250, 'меньше минимума не бывает');
});

test('перестановка блоков', () => {
  assert.deepEqual(moveBlock(BLOCKS, 'log', 0), ['log', 'players', 'stock', 'now']);
  assert.deepEqual(moveBlock(BLOCKS, 'players', 3), ['stock', 'now', 'log', 'players']);
  assert.deepEqual(moveBlock(BLOCKS, 'stock', 1), BLOCKS, 'на том же месте');
  assert.equal(dropIndex([100, 200, 300], 50), 0);
  assert.equal(dropIndex([100, 200, 300], 250), 2);
  assert.equal(dropIndex([100, 200, 300], 999), 3);
});

test('свернуть и развернуть блок', () => {
  assert.deepEqual(toggled([], 'log'), ['log']);
  assert.deepEqual(toggled(['log', 'now'], 'log'), ['now']);
});

test('кнопка организатора: с ботами сдаться, с людьми завершить партию', () => {
  const me = { id: 0, kind: 'human' }, bot = { id: 1, kind: 'bot' }, other = { id: 2, kind: 'human' };
  assert.equal(stopLabel([me, bot], 0), 'Сдаться');
  assert.equal(stopLabel([me, bot, other], 0), 'Завершить партию');
  assert.equal(stopLabel([bot, other], null), 'Завершить партию', 'организатор смотрит со стороны');
});

test('сервер принимает только форму настроек', () => {
  assert.deepEqual(cleanPrefs({ side: 400, left: true, order: ['log', 'now', 'stock', 'players'], shut: ['log'], лишнее: 'x'.repeat(5000) }),
    { side: 400, left: true, order: ['log', 'now', 'stock', 'players'], shut: ['log'] });
  assert.deepEqual(cleanPrefs('мусор'), { side: 0, left: false, order: BLOCKS, shut: [] });
  assert.deepEqual(cleanPrefs({ side: 1e9, order: ['log', 'log', 'log', 'log'] }).order, BLOCKS);
});

for (const [name, make] of [['память', memoryStore], ['Redis', () => redisStore({ exec: fakeUpstash().exec, prefix: 't:' })]]) {
  test(`настройки живут за игроком: ${name}`, async () => {
    const app = createApp({ store: make(), env: ENV, now: () => 1_800_000_000_000 });
    const req = (method, path, body, token) => app.call({ method, path, body, token });
    const denis = (await req('POST', 'activate', { code: 'ADMN-TEST-2345' })).body;
    const made = (await req('POST', 'admin/users', { name: 'Андрей' }, denis.token)).body;
    const andrey = (await req('POST', 'activate', { code: made.code })).body;

    assert.equal((await req('GET', 'prefs')).status, 401, 'без входа нельзя');
    assert.deepEqual((await req('GET', 'prefs', undefined, denis.token)).body, {}, 'пока пусто');
    const mine = { side: 410, left: true, order: ['now', 'log', 'players', 'stock'], shut: ['stock'] };
    assert.equal((await req('POST', 'prefs', mine, denis.token)).status, 200);
    assert.deepEqual((await req('GET', 'prefs', undefined, denis.token)).body, mine);
    assert.deepEqual((await req('GET', 'prefs', undefined, andrey.token)).body, {}, 'у Андрея свои настройки');
  });
}
