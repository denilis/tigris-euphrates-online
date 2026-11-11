// Сокровища на поле в верхней строке партии (просьба Дениса 06.11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TREASURE_END, treasuresOn, treasureLow } from '../public/js/util.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('порог конца партии по сокровищам тот же, что в движке', () => {
  // порог берется из партии (у большого поля 3), по умолчанию константа движка
  assert.match(src('../game/vendor/engine/engine.js'), /treasuresOnBoard\(s\) <= treasureEndOf\(s\)/);
  assert.match(src('../game/vendor/engine/constants.js'), new RegExp(`export const TREASURE_END = ${TREASURE_END};`));
});

test('сокровища на поле: счет и красное число за одно взятие до конца', () => {
  const tr = Array(176).fill(0);
  tr[5] = tr[40] = tr[90] = 1;
  assert.equal(treasuresOn({ board: { treasure: tr } }), 3);
  assert.equal(treasureLow(4), false);
  assert.equal(treasureLow(3), true, 'еще одно взятие, и партия кончится');
  assert.equal(treasureLow(TREASURE_END), true);
  assert.equal(treasureLow(4, 3), true, 'большое поле: порог 3');
  assert.equal(treasureLow(5, 3), false);
});

test('верхняя строка партии: мешок, ход и сокровища на поле', () => {
  const game = src('../public/js/game.js');
  assert.match(game, /<span id="gTrBox"><span class="trl">сокровищ на поле<\/span><span class="trs">сокровищ<\/span><i class="tri"[^>]*><\/i> <b id="gTr"><\/b><\/span>/);
  assert.match(game, /classList\.toggle\('low', treasureLow\(tr, treasureEnd\(g\)\)\)/);
});
