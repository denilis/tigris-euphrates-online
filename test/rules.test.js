// Раздел «Правила»: текст и поиск по нему.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES } from '../public/js/rules-text.js';
import { searchRules, stem, markParts } from '../public/js/rules-search.js';

const titles = (query) => searchRules(RULES, query).map((s) => s.title);

test('разделы как в одобренной схеме, у каждого есть текст', () => {
  assert.deepEqual(RULES.map((s) => s.title), [
    'Главное правило', 'Поле и тайлы', 'Царства', 'Ход и очки', 'Лидеры', 'Восстание', 'Война',
    'Монумент', 'Сокровища', 'Катастрофа', 'Конец партии', 'Здания и чудо', 'Наш сайт',
  ]);
  for (const s of RULES) {
    assert.ok(s.id && s.body.length, s.title);
    assert.equal(new Set(RULES.map((x) => x.id)).size, RULES.length);
  }
});

test('текст без следов машинной верстки', () => {
  const text = RULES.flatMap((s) => [s.title, ...s.body]).join('\n');
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
  assert.deepEqual(titles('ферма река').slice(0, 1), ['Поле и тайлы']);
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
