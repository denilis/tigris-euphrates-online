// Фильтры «Моих столов» (просьба Дениса 06.11): период, турнирные или обычные, сколько игроков,
// с кем, порядок; выбор из браузера проверяется.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FILTER, cleanFilter, filterTables, periodRange, whoNames, PEOPLE_WORD } from '../public/js/tables-filter.js';

const NOW = new Date('2026-11-06T15:00:00').getTime();
const DAY = 86400000;
const human = (name) => ({ kind: 'human', name });
const bot = (name) => ({ kind: 'bot', name, bot: { style: 'universal' } });
const LIST = [
  { code: 'A', updatedAt: NOW - 1000, tour: 'Сезон', seats: [human('Денис'), human('Влад'), human('Андрей')] },
  { code: 'B', updatedAt: NOW - 3 * DAY, tour: null, seats: [human('Денис'), bot('Бот универсальный')] },
  { code: 'C', updatedAt: NOW - 20 * DAY, tour: null, seats: [human('Денис'), human('Ёжик'), bot('Бот'), bot('Бот 2')] },
  { code: 'D', updatedAt: NOW - 90 * DAY, tour: 'Кубок', seats: [human('Денис'), human('Влад')] },
];
const codes = (f) => filterTables(LIST, { ...DEFAULT_FILTER, ...f }, NOW).map((t) => t.code);

test('мои столы: период по дате последнего хода', () => {
  assert.deepEqual(codes({}), ['A', 'B', 'C', 'D'], 'по умолчанию все, сначала новые');
  assert.deepEqual(codes({ period: 'today' }), ['A']);
  assert.deepEqual(codes({ period: 'week' }), ['A', 'B']);
  assert.deepEqual(codes({ period: 'month' }), ['A', 'B', 'C']);
  assert.deepEqual(codes({ period: 'custom', from: '2026-10-01', to: '2026-11-03' }), ['B', 'C']);
  assert.deepEqual(codes({ period: 'custom', to: '2026-11-03' }), ['B', 'C', 'D'], 'только «по»');
  const [a, b] = periodRange({ period: 'week' }, NOW);
  assert.equal(b, Infinity);
  assert.equal(new Date(a).getHours(), 0, 'с начала дня');
});

test('мои столы: турнирные и обычные, сколько игроков, с кем, порядок', () => {
  assert.deepEqual(codes({ kind: 'tour' }), ['A', 'D']);
  assert.deepEqual(codes({ kind: 'casual' }), ['B', 'C']);
  assert.deepEqual(codes({ n: '2' }), ['B', 'D'], 'бот считается игроком за столом');
  assert.deepEqual(codes({ n: '4' }), ['C']);
  assert.deepEqual(codes({ who: 'влад' }), ['A', 'D'], 'без учета регистра');
  assert.deepEqual(codes({ who: 'ежик' }), ['C'], 'ё и е одно и то же');
  assert.deepEqual(codes({ who: 'бот' }), ['B', 'C'], 'можно искать и бота');
  assert.deepEqual(codes({ order: 'old' }), ['D', 'C', 'B', 'A']);
  assert.deepEqual(codes({ kind: 'casual', n: '4', who: 'Ёж' }), ['C'], 'фильтры вместе');
});

test('мои столы: выбор из браузера проверяется, подсказка имен без себя', () => {
  assert.deepEqual(cleanFilter(null), DEFAULT_FILTER);
  assert.deepEqual(cleanFilter({ period: 'year', n: 5, kind: 'tour', from: 'вчера', to: '2026-11-01', who: 7 }), { ...DEFAULT_FILTER, kind: 'tour', to: '2026-11-01' });
  assert.deepEqual(whoNames(LIST, 'Денис'), ['Андрей', 'Влад', 'Ёжик']);
  assert.deepEqual(PEOPLE_WORD, { 2: 'вдвоем', 3: 'втроем', 4: 'вчетвером' });
});
