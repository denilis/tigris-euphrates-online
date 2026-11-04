// Лобби стола: места, герои, правила, старт (спецификация A1, A7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTable, sit, leave, setHero, setOptions, setSeatCount, setSeatKind, setBot, moveSeat, start, close, TableError,
} from '../game/table.js';
import { USERS, T0, lobby, started, makeRng } from './support.js';

const code = (fn) => {
  try { fn(); } catch (e) { assert.ok(e instanceof TableError, `ожидалась TableError, а не ${e}`); return e.code; }
  assert.fail('ожидался отказ');
};

test('новый стол: хост на первом месте, по умолчанию три человека и бот, продвинутое поле, закрытый счёт', () => {
  const t = createTable({ code: 'ABC123', host: USERS.denis, now: T0 });
  assert.equal(t.status, 'lobby');
  assert.equal(t.hostUserId, USERS.denis.userId);
  assert.deepEqual(t.seats.map((s) => s.kind), ['human', 'human', 'human', 'bot']);
  assert.equal(t.seats[0].userId, USERS.denis.userId);
  assert.equal(t.seats[0].name, 'Денис');
  assert.deepEqual(t.options, {
    board: 'advanced', englishSupport: true, buildings: true, wonder: true, openScore: false, order: 'loser',
    turnSeconds: 30, confirmSeconds: 10, tournament: 'auto', look: 'relief', monument: 'enamel', building: 'chip', tiles: 'plate',
  });
  assert.equal(t.seats[3].bot.style, 'universal');
  assert.ok(t.seats[3].hero, 'боту сразу назначен герой');
  assert.equal(t.version, 0);
});

test('пустой стол: ушел хозяин и никого нет, севший первым становится хозяином', () => {
  const t = createTable({ code: 'EMPTY1', host: USERS.denis, now: T0 });
  leave(t, USERS.denis.userId, T0);
  assert.equal(t.seats.filter((s) => s.userId).length, 0);
  sit(t, USERS.andrey, 1, T0);
  assert.equal(t.hostUserId, USERS.andrey.userId);
  sit(t, USERS.vlad, 2, T0);
  assert.equal(t.hostUserId, USERS.andrey.userId, 'второй севший хозяином не становится');
  leave(t, USERS.andrey.userId, T0);
  assert.equal(t.hostUserId, USERS.vlad.userId, 'ушел хозяин: стол у оставшегося');
});

test('закрыть стол: хозяин всегда, другой сидящий только если стол стоит 2 часа', () => {
  const HOUR = 3600 * 1000;
  const t = started(1);
  const sitter = USERS.andrey.userId;
  assert.equal(code(() => close(t, sitter, T0 + 2 * HOUR - 1)), 'not-host', 'рано');
  assert.equal(code(() => close(t, 'u-stranger', T0 + 5 * HOUR)), 'not-host', 'не сидящий не может никогда');
  assert.equal(t.status, 'playing');
  close(t, sitter, T0 + 2 * HOUR);
  assert.equal(t.status, 'closed');

  const t2 = started(2);
  close(t2, USERS.denis.userId, T0 + 1000);
  assert.equal(t2.status, 'closed', 'хозяин закрывает сразу');

  const t3 = started(3);
  t3.updatedAt = T0 + HOUR; // последний ход час назад
  assert.equal(code(() => close(t3, sitter, T0 + 2 * HOUR + 1)), 'not-host', 'считается от последнего движения стола');
  close(t3, sitter, T0 + 3 * HOUR);
  assert.equal(t3.status, 'closed');

  const lobbyTable = lobby('LOBBY1');
  close(lobbyTable, USERS.vlad.userId, T0 + 2 * HOUR);
  assert.equal(lobbyTable.status, 'closed', 'брошенное лобби тоже закрывается');
});

test('настройки: имена из прототипа (constructor, toString, __proto__) не проходят', () => {
  const t = lobby();
  const host = USERS.denis.userId;
  const own = (key, value) => JSON.parse(`{"${key}": ${JSON.stringify(value)}}`); // как после JSON.parse у запроса
  for (const key of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
    assert.equal(code(() => setOptions(t, host, own(key, 'x'), T0)), 'bad-option', key);
    assert.equal(code(() => setOptions(t, host, own(key, { big: 'x'.repeat(100) }), T0)), 'bad-option', key);
    assert.equal(code(() => setBot(t, host, 3, own(key, 5), T0)), 'bad-option', `бот ${key}`);
  }
  assert.equal(code(() => setOptions(t, host, { board: 'constructor' }, T0)), 'bad-option', 'поле не из списка');
  assert.equal(code(() => setOptions(t, host, { board: '__proto__' }, T0)), 'bad-option');
  assert.equal(code(() => setOptions(t, host, { board: { x: 1 } }, T0)), 'bad-option');
  assert.equal(code(() => setBot(t, host, 3, { style: 'constructor' }, T0)), 'bad-option', 'стиль не из списка');
  assert.equal(code(() => setBot(t, host, 3, { style: 'toString' }, T0)), 'bad-option');
  assert.equal(code(() => setOptions(t, host, { look: 'map' }, T0)), 'bad-option', 'вид поля не из списка');
  assert.equal(code(() => setOptions(t, host, { monument: 'drawn' }, T0)), 'bad-option', 'монумент не из списка');
  assert.equal(code(() => setOptions(t, host, { building: 'drawn' }, T0)), 'bad-option', 'вид зданий не из списка');
  assert.deepEqual(Object.keys(t.options).sort(), ['board', 'building', 'buildings', 'confirmSeconds', 'englishSupport', 'look', 'monument', 'openScore', 'order', 'tiles', 'tournament', 'turnSeconds', 'wonder']);
  assert.deepEqual(Object.keys(t.seats[3].bot).sort(), ['counting', 'errors', 'risk', 'strength', 'style']);
  setOptions(t, host, { board: 'standard', turnSeconds: 45, look: 'cells', monument: 'ziggurat' }, T0);
  assert.equal(t.options.monument, 'ziggurat');
  assert.equal(t.options.board, 'standard');
  assert.equal(t.options.look, 'cells');
});

test('место: один человек не садится на два места, на бота и на занятое место', () => {
  const t = lobby();
  assert.equal(code(() => sit(t, USERS.andrey, 2, T0)), 'already-seated');
  assert.equal(code(() => sit(t, { userId: 'u-x', name: 'Икс' }, 3, T0)), 'seat-is-bot');
  assert.equal(code(() => sit(t, { userId: 'u-x', name: 'Икс' }, 1, T0)), 'seat-taken');
  leave(t, USERS.vlad.userId, T0);
  assert.equal(t.seats[2].userId, null);
  assert.equal(t.seats[2].hero, null, 'ушедший освобождает героя');
  sit(t, { userId: 'u-x', name: 'Икс' }, 2, T0);
  assert.equal(t.seats[2].name, 'Икс');
});

test('герои: двух одинаковых за столом нет, свой герой у себя, бота меняет хост', () => {
  const t = lobby();
  const botHero = t.seats[3].hero;
  assert.notEqual(botHero, 'lion');
  assert.equal(code(() => setHero(t, USERS.andrey.userId, 1, 'lion', T0)), 'hero-taken');
  assert.equal(code(() => setHero(t, USERS.andrey.userId, 2, 'pot', T0)), 'not-your-seat');
  assert.equal(code(() => setHero(t, USERS.andrey.userId, 3, 'pot', T0)), 'not-host');
  assert.equal(code(() => setHero(t, USERS.andrey.userId, 1, 'dragon', T0)), 'bad-hero');
  setHero(t, USERS.andrey.userId, 1, 'bow', T0); // свой же герой повторно: можно
  const free = ['lion', 'bull', 'bow', 'pot'].find((h) => !t.seats.some((s) => s.hero === h));
  if (free) setHero(t, USERS.denis.userId, 3, free, T0);
});

test('правила, число мест, тип места и настройки бота меняет только хост', () => {
  const t = lobby();
  assert.equal(code(() => setOptions(t, USERS.andrey.userId, { openScore: true }, T0)), 'not-host');
  setOptions(t, USERS.denis.userId, { board: 'standard', openScore: true, order: 'random' }, T0);
  assert.equal(t.options.board, 'standard');
  assert.equal(code(() => setOptions(t, USERS.denis.userId, { board: 'moon' }, T0)), 'bad-option');
  assert.equal(code(() => setOptions(t, USERS.denis.userId, { order: 'alphabet' }, T0)), 'bad-option');
  assert.equal(code(() => setSeatCount(t, USERS.denis.userId, 5, T0)), 'bad-seat-count');
  assert.equal(code(() => setSeatCount(t, USERS.denis.userId, 2, T0)), 'seat-occupied');
  setSeatKind(t, USERS.denis.userId, 3, 'human', T0);
  assert.equal(t.seats[3].kind, 'human');
  assert.equal(t.seats[3].hero, null);
  setSeatCount(t, USERS.denis.userId, 3, T0);
  assert.equal(t.seats.length, 3);
  setSeatCount(t, USERS.denis.userId, 4, T0);
  setSeatKind(t, USERS.denis.userId, 3, 'bot', T0);
  setBot(t, USERS.denis.userId, 3, { strength: 100, counting: 'exact', errors: 0 }, T0);
  assert.equal(t.seats[3].bot.strength, 100);
  assert.equal(code(() => setBot(t, USERS.denis.userId, 3, { strength: 150 }, T0)), 'bad-option');
  assert.equal(code(() => setSeatKind(t, USERS.denis.userId, 1, 'bot', T0)), 'seat-occupied');
});

test('ручная очерёдность: хост переставляет места', () => {
  const t = lobby();
  moveSeat(t, USERS.denis.userId, 3, 0, T0);
  assert.deepEqual(t.seats.map((s) => s.id), [3, 0, 1, 2]);
  assert.equal(code(() => moveSeat(t, USERS.vlad.userId, 0, 1, T0)), 'not-host');
});

test('старт: нужны занятые места и герои; начинает только хозяин стола (04.11)', () => {
  // гости без постоянных героев: выбирают сами
  const [a, b, c] = ['Аня', 'Боря', 'Вера'].map((name, i) => ({ userId: `u-${i}`, name }));
  const t = createTable({ code: 'ABC123', host: a, now: T0 });
  assert.equal(code(() => start(t, a.userId, { last: null, rng: makeRng(1), now: T0 })), 'seats-not-ready');
  sit(t, b, 1, T0);
  sit(t, c, 2, T0);
  setHero(t, a.userId, 0, 'lion', T0);
  setHero(t, b.userId, 1, 'bull', T0);
  assert.equal(code(() => start(t, a.userId, { last: null, rng: makeRng(1), now: T0 })), 'seats-not-ready');
  setHero(t, c.userId, 2, 'bow', T0);
  assert.equal(code(() => start(t, c.userId, { last: null, rng: makeRng(1), now: T0 })), 'not-host', 'сидящий, но не хозяин');
  assert.equal(code(() => start(t, 'u-stranger', { last: null, rng: makeRng(1), now: T0 })), 'not-host');
  const v = t.version;
  start(t, a.userId, { last: null, rng: makeRng(1), now: T0 });
  assert.equal(t.status, 'playing');
  assert.ok(t.version > v);
  assert.equal(t.game.order.length, 4);
  assert.deepEqual([...t.game.order].sort(), [0, 1, 2, 3]);
  assert.equal(code(() => sit(t, { userId: 'u-x', name: 'Икс' }, 0, T0)), 'not-lobby');
});

test('закрыть стол может только хост, закрытый стол в историю не идёт', () => {
  const t = lobby();
  start(t, USERS.denis.userId, { last: null, rng: makeRng(2), now: T0 });
  assert.equal(code(() => close(t, USERS.andrey.userId, T0)), 'not-host');
  close(t, USERS.denis.userId, T0);
  assert.equal(t.status, 'closed');
  assert.equal(t.game.result, null);
});
