// Здания: плитка на клетку в стиле монументов. С 04.11 картинки Дениса вместо нарисованных силуэтов.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { buildingSVG, buildingImg } from '../public/js/board.js';

test('у каждого цвета своя картинка, и файл есть', () => {
  const hrefs = [0, 1, 2, 3].map((c) => buildingSVG(c, 0, 0, 'b').match(/href="([^"]+)"/)[1]);
  assert.equal(new Set(hrefs).size, 4);
  for (const [c, h] of hrefs.entries()) {
    assert.equal(h, buildingImg(c));
    assert.ok(existsSync(new URL(`../public${h}`, import.meta.url)), h);
  }
});

test('рисуется в своей клетке и не выходит за нее', () => {
  const s = buildingSVG(0, 120, 60, 'b');
  assert.match(s, /<g transform="translate\(120,60\)"/);
  const [, x, y, w, h] = s.match(/<image href="[^"]+" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
  assert.ok(+x >= 0 && +y >= 0 && +x + +w <= 60 && +y + +h <= 60, `${x},${y},${w},${h}`);
});

// вид зданий выбирает хозяин стола (Денис 04.11): новые плитки или прежние значки
test('прежние значки: у каждого цвета свой силуэт в золотой раме с розетками', async () => {
  const paths = [0, 1, 2, 3].map((c) => buildingSVG(c, 0, 0, 'b', 'seal').match(/d="(M[^"]+)"/)[1]);
  assert.equal(new Set(paths).size, 4);
  const s = buildingSVG(2, 0, 0, 'b', 'seal');
  assert.match(s, /url\(#bvg\)/);
  assert.match(s, /url\(#bv2\)/);
  assert.doesNotMatch(s, /<image/);
  assert.match(buildingSVG(2, 0, 0, 'b'), /<image href="\/img\/buildings\/2\.webp"/, 'по умолчанию новые плитки');
  const { DEFAULT_OPTIONS, createTable, setOptions } = await import('../game/table.js');
  assert.equal(DEFAULT_OPTIONS.building, 'tile');
  const t = createTable({ code: 'BLDSTY', host: { userId: 'h', name: 'Хозяин' }, now: 0 });
  setOptions(t, 'h', { building: 'seal' }, 1);
  assert.equal(t.options.building, 'seal');
  assert.throws(() => setOptions(t, 'h', { building: 'gold' }, 2));
});
