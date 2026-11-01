// Постоянные герои компании: Денис кувшин, Андрей лук, Влад лев. Это выбор по умолчанию, в лобби его можно сменить.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTable, sit, leave, setHero, setSeatKind, start, HEROES } from '../game/table.js';

const DENIS = { userId: 'u1', name: 'Денис' }, ANDREY = { userId: 'u2', name: 'Андрей' }, VLAD = { userId: 'u3', name: 'Влад' };
const PETYA = { userId: 'u4', name: 'Петя' };

const table = (host = DENIS) => createTable({ code: 'ABC234', host, now: 1 });
const heroes = (t) => t.seats.map((s) => s.hero);
const distinct = (t) => {
  const given = heroes(t).filter(Boolean);
  assert.equal(new Set(given).size, given.length, `герои повторяются: ${given}`);
};

test('свой герой: Денис, Андрей и Влад садятся со своими героями', () => {
  const t = table();
  sit(t, ANDREY, 1, 2);
  sit(t, VLAD, 2, 3);
  assert.deepEqual(heroes(t).slice(0, 3), ['pot', 'bow', 'lion']);
  assert.ok(HEROES.includes(t.seats[3].hero), 'у бота остается герой');
  distinct(t);
});

test('свой герой: кто создал стол, неважно', () => {
  for (const [host, hero] of [[ANDREY, 'bow'], [VLAD, 'lion'], [DENIS, 'pot']]) {
    assert.equal(table(host).seats[0].hero, hero);
  }
});

test('свой герой: бот уступает, у него появляется другой', () => {
  const t = table(PETYA);
  assert.equal(t.seats[3].hero, 'pot', 'бот взял кувшин первым');
  sit(t, DENIS, 1, 2);
  assert.equal(t.seats[1].hero, 'pot');
  assert.ok(t.seats[3].hero && t.seats[3].hero !== 'pot');
  distinct(t);
});

test('свой герой: все места заняты ботами и людьми, герои не повторяются', () => {
  const t = table();
  setSeatKind(t, 'u1', 1, 'bot', 2);
  setSeatKind(t, 'u1', 2, 'bot', 3);
  assert.deepEqual(heroes(t).filter(Boolean).length, 4);
  distinct(t);
});

test('свой герой: занятого другим человеком не отбираем, выбор остается за игроком', () => {
  const t = table(PETYA);
  setHero(t, 'u4', 0, 'bow', 2);
  sit(t, ANDREY, 1, 3);
  assert.equal(t.seats[0].hero, 'bow');
  assert.equal(t.seats[1].hero, null);
  assert.equal(t.seats[1].name, 'Андрей');
});

test('свой герой: остальные игроки выбирают сами', () => {
  const t = table(PETYA);
  assert.equal(t.seats[0].hero, null);
  sit(t, { userId: 'u5', name: 'constructor' }, 1, 2);
  assert.equal(t.seats[1].hero, null, 'служебные слова не ломают посадку');
});

test('свой герой: регистр и пробелы в имени не важны', () => {
  assert.equal(table({ userId: 'u1', name: ' денис ' }).seats[0].hero, 'pot');
});

test('свой герой: в лобби можно выбрать другого', () => {
  const t = table();
  setHero(t, 'u1', 0, 'lion', 2);
  assert.equal(t.seats[0].hero, 'lion');
  sit(t, VLAD, 1, 3);
  assert.equal(t.seats[1].hero, null, 'лев уже у Дениса');
});

test('свой герой: встал и сел снова, герой вернулся', () => {
  const t = table();
  sit(t, ANDREY, 1, 2);
  leave(t, 'u2', 3);
  assert.equal(t.seats[1].hero, null);
  sit(t, ANDREY, 2, 4);
  assert.equal(t.seats[2].hero, 'bow');
});

test('свой герой: партию можно начать сразу, без ручного выбора', () => {
  const t = table();
  sit(t, ANDREY, 1, 2);
  sit(t, VLAD, 2, 3);
  start(t, 'u1', { now: 4 });
  assert.equal(t.status, 'playing');
});
