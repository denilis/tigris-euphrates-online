// Вид монумента из настроек стола (выбор Дениса 03.11): у каждого вида картинки на все 6 пар цветов.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { MON_STYLES, monImg, sealIcon } from '../public/js/board.js';
import { DEFAULT_MONUMENTS } from '../game/vendor/engine/constants.js';

test('монументы: у каждого вида картинка на каждую пару цветов игры', () => {
  for (const style of MON_STYLES) {
    for (const { c1, c2 } of DEFAULT_MONUMENTS) {
      const file = new URL('../public' + monImg(style, c1, c2), import.meta.url);
      assert.ok(existsSync(file), `${style}: нет ${monImg(style, c1, c2)}`);
    }
  }
});

test('монументы: значок в запасе берет картинку вида, без вида остается рисунок', () => {
  assert.match(sealIcon(0, 3, 80, 'ziggurat'), /<img class="monimg" src="\/img\/monuments\/ziggurat\/red-black\.webp" width="80"/);
  assert.match(sealIcon(0, 3, 80), /^<svg/);
});
