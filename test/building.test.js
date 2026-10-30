// Здание «Малая печать» (выбор Дениса 30.10): прежний значок в углу на тайле своего цвета не читался.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildingSVG } from '../public/js/board.js';

test('у каждого цвета свой силуэт', () => {
  const paths = [0, 1, 2, 3].map((c) => buildingSVG(c, 0, 0, 'b').match(/d="(M[^"]+)"/)[1]);
  assert.equal(new Set(paths).size, 4);
});

test('плитка своего цвета в золотой раме с четырьмя розетками', () => {
  const s = buildingSVG(2, 0, 0, 'b');
  assert.match(s, /url\(#bvg\)/, 'золотая рама как у монумента');
  assert.match(s, /url\(#bv2\)/, 'поле цвета здания');
  assert.equal(s.match(/stroke="#94691f" stroke-width="1"/g).length, 4, 'розетки по углам');
});

test('рисуется в своей клетке и не выходит за нее', () => {
  const s = buildingSVG(0, 120, 60, 'b');
  assert.match(s, /<g transform="translate\(120,60\)"/);
  const box = [...s.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)];
  assert.ok(box.length >= 2);
  for (const [, x, y, w, h] of box) assert.ok(+x >= 0 && +y >= 0 && +x + +w <= 60 && +y + +h <= 60, `${x},${y},${w},${h}`);
});
