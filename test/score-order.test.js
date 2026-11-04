// Цветные очки слева направо, как на BGA (просьба Дениса 04.11): красный, черный, зеленый, синий.
// Тот же порядок в карточке игрока, итоге партии, окне боя и в статистике итога.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCORE_ORDER, COLNAME } from '../public/js/util.js';
import { STAT_ROWS } from '../public/js/matchstats.js';

test('очки по цветам: порядок как на BGA', () => {
  assert.deepEqual(SCORE_ORDER.map((c) => COLNAME[c]), ['красный', 'черный', 'зеленый', 'синий']);
  assert.deepEqual(STAT_ROWS.slice(0, 4).map(([label]) => label.split(' ')[0]), ['Красные', 'Черные', 'Зеленые', 'Синие']);
});

test('очки по цветам: карточка, итог и окно боя идут по SCORE_ORDER, а не по номеру цвета', () => {
  for (const f of ['game.js', 'end.js', 'war.js']) {
    const src = readFileSync(new URL(`../public/js/${f}`, import.meta.url), 'utf8');
    assert.match(src, /SCORE_ORDER\.map\(/, f);
    assert.doesNotMatch(src, /\.score\.map\(\(v, c\)/, `${f}: очки в порядке номеров цвета`);
  }
});
