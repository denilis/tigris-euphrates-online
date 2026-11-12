// Герой бота с характером (Денис 12.11): бот Андрей берет лук, бот Влад льва, бот Денис кувшин,
// если самого человека за столом нет. Героя другого человека бот не отбирает.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTable, sit, leave, unseat, setHero, setBot, setSeatKind } from '../game/table.js';

const DENIS = { userId: 'u1', name: 'Денис' }, ANDREY = { userId: 'u2', name: 'Андрей' }, VLAD = { userId: 'u3', name: 'Влад' };
const PETYA = { userId: 'u4', name: 'Петя' };

const table = (host = DENIS) => createTable({ code: 'ABC234', host, now: 1 });
const distinct = (t) => {
  const given = t.seats.map((s) => s.hero).filter(Boolean);
  assert.equal(new Set(given).size, given.length, `герои повторяются: ${given}`);
};

test('бот Андрей, Влад и Денис без живого человека берут его героя', () => {
  for (const [style, hero] of [['andrey', 'bow'], ['vlad', 'lion'], ['denis', 'pot']]) {
    const t = table(PETYA);
    setBot(t, 'u4', 3, { style }, 2);
    assert.equal(t.seats[3].hero, hero, style);
    distinct(t);
  }
});

test('герой забирается у другого бота: тот получает прежнего героя первого', () => {
  const t = table(PETYA); // бот на месте 3 взял кувшин
  setSeatKind(t, 'u4', 1, 'bot', 2);
  const before = t.seats[1].hero;
  setBot(t, 'u4', 1, { style: 'denis' }, 3);
  assert.equal(t.seats[1].hero, 'pot');
  assert.equal(t.seats[3].hero, before);
  distinct(t);
});

test('живой Андрей за столом: лук у него, бот Андрей берет другого героя', () => {
  const t = table();
  sit(t, ANDREY, 1, 2);
  setBot(t, 'u1', 3, { style: 'andrey' }, 3);
  assert.equal(t.seats[1].hero, 'bow');
  assert.notEqual(t.seats[3].hero, 'bow');
  assert.ok(t.seats[3].hero);
  distinct(t);
});

test('живой Андрей сел позже: лук переходит к нему, ушел: лук возвращается к боту', () => {
  const t = table();
  setBot(t, 'u1', 3, { style: 'andrey' }, 2);
  assert.equal(t.seats[3].hero, 'bow');
  sit(t, ANDREY, 1, 3);
  assert.equal(t.seats[1].hero, 'bow');
  assert.notEqual(t.seats[3].hero, 'bow');
  distinct(t);
  leave(t, 'u2', 4);
  assert.equal(t.seats[3].hero, 'bow');
  distinct(t);
});

test('хозяин убрал живого Влада: лев возвращается к боту Владу', () => {
  const t = table();
  sit(t, VLAD, 1, 2);
  setBot(t, 'u1', 3, { style: 'vlad' }, 3);
  assert.notEqual(t.seats[3].hero, 'lion');
  unseat(t, 'u1', 1, 4);
  assert.equal(t.seats[3].hero, 'lion');
  distinct(t);
});

test('героя другого человека бот не отбирает', () => {
  const t = table(PETYA);
  setHero(t, 'u4', 0, 'lion', 2);
  setBot(t, 'u4', 3, { style: 'vlad' }, 3);
  assert.equal(t.seats[0].hero, 'lion');
  assert.notEqual(t.seats[3].hero, 'lion');
  distinct(t);
});

test('два бота Андрея: лук у первого, второй остается со своим героем', () => {
  const t = table(PETYA);
  setSeatKind(t, 'u4', 1, 'bot', 2);
  setBot(t, 'u4', 1, { style: 'andrey' }, 3);
  setBot(t, 'u4', 3, { style: 'andrey' }, 4);
  assert.equal(t.seats[1].hero, 'bow');
  assert.notEqual(t.seats[3].hero, 'bow');
  distinct(t);
});

test('сила и риск бота героя не трогают', () => {
  const t = table(PETYA);
  setBot(t, 'u4', 3, { style: 'andrey' }, 2);
  setHero(t, 'u4', 3, 'bull', 3); // хозяин сменил герою бота вручную
  setBot(t, 'u4', 3, { strength: 70 }, 4);
  assert.equal(t.seats[3].hero, 'bull');
});
