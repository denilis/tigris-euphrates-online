// Раздел «Правила»: текст и поиск по нему.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES } from '../public/js/rules-text.js';
import { searchRules, stem, markParts, blockText } from '../public/js/rules-search.js';

const titles = (query) => searchRules(RULES, query).map((s) => s.title);

test('полные правила: все разделы на месте, у каждого есть текст', () => {
  assert.deepEqual(RULES.map((s) => s.title), [
    'Главное правило', 'Что в игре', 'Поле', 'Подготовка', 'Регионы и царства', 'Ход', 'Лидеры',
    'Тайлы и очки', 'Катастрофа', 'Обмен тайлов', 'Восстание', 'Война', 'Монумент', 'Сокровища',
    'Конец хода', 'Конец партии', 'Вариант: английская поддержка', 'Вариант: продвинутое поле',
    'Вариант: здания', 'Вариант: чудо', 'Вариант: открытый счет', 'Частые вопросы', 'Наш сайт',
    'Откуда эти правила',
  ]);
  for (const s of RULES) {
    assert.ok(s.id && s.body.length, s.title);
    assert.equal(new Set(RULES.map((x) => x.id)).size, RULES.length);
  }
});

test('поиск видит списки, подзаголовки и подписи к схемам', () => {
  assert.equal(blockText({ list: ['один', 'два'] }), 'один два');
  assert.equal(blockText({ h: 'заголовок' }), 'заголовок');
  assert.equal(blockText({ fig: 'war', cap: 'подпись' }), 'подпись');
  assert.ok(titles('сокровищами').includes('Поле'), 'слово только в подписи к схеме');
  assert.ok(titles('153').includes('Что в игре'), 'число из списка');
});

test('текст без следов машинной верстки', () => {
  const text = RULES.flatMap((s) => [s.title, ...s.body.map(blockText)]).join('\n');
  for (const [name, ch] of [['длинное тире', '—'], ['многоточие', '…'], ['неразрывный пробел', ' '], ['средняя точка', '·']]) {
    assert.ok(!text.includes(ch), name);
  }
  assert.ok(!/ {2}/.test(text), 'двойной пробел');
});

test('основа слова отбрасывает окончание, короткие слова не калечит', () => {
  assert.equal(stem('война'), 'войн');
  assert.equal(stem('Катастрофа'), 'катастро');
  assert.equal(stem('храм'), 'храм');
  assert.equal(stem('лидер'), 'лидер');
  assert.equal(stem('бот'), 'бот');
  assert.equal(stem('ёлка'), 'елк');
});

test('поиск находит другие формы слова', () => {
  assert.ok(titles('война').includes('Война'));
  assert.ok(titles('войны').includes('Война'));
  assert.ok(titles('катастрофу').includes('Катастрофа'));
  assert.ok(titles('сокровищ').includes('Сокровища'));
  assert.ok(titles('МОНУМЕНТ').includes('Монумент'));
});

test('несколько слов: раздел должен содержать все', () => {
  assert.ok(titles('ферма река').includes('Поле'));
  assert.deepEqual(titles('катастрофа абракадабра'), []);
});

test('пустой запрос показывает все, знаки препинания не мешают', () => {
  assert.equal(titles('').length, RULES.length);
  assert.equal(titles('   ').length, RULES.length);
  assert.equal(titles('?!').length, RULES.length);
  assert.ok(titles('война?').includes('Война'));
  assert.deepEqual(titles('(((абракадабра'), [], 'скобки в запросе не ломают поиск');
});

test('подсветка: слово целиком, с любым окончанием и регистром', () => {
  assert.deepEqual(markParts('Война и войны.', 'война'), [
    { text: 'Война', hit: true }, { text: ' и ', hit: false }, { text: 'войны', hit: true }, { text: '.', hit: false },
  ]);
  assert.deepEqual(markParts('Тайл', ''), [{ text: 'Тайл', hit: false }]);
  assert.deepEqual(markParts('a<b', '(('), [{ text: 'a<b', hit: false }]);
});
