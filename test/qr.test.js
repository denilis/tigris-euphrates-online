// QR-код ссылки-приглашения (13.11): свой генератор public/js/qr.js сверяется с эталоном библиотеки
// segno (test/fixtures/qr.json, собран tools/qr-fixture.py): версии 1-10, уровень M, все восемь масок.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { qrMatrix, qrSvg, QR_MAX_BYTES } from '../public/js/qr.js';

const FIX = JSON.parse(readFileSync(new URL('./fixtures/qr.json', import.meta.url), 'utf8'));
const rows = (q) => q.modules.map((r) => Array.from(r, (v) => (v ? '1' : '0')).join(''));

test('QR: матрица совпадает с эталоном для каждой версии и маски', () => {
  assert.deepEqual(FIX.cases.map((c) => c.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 4], 'в эталоне все версии');
  let checked = 0;
  for (const c of FIX.cases) {
    for (const [mask, want] of Object.entries(c.masks)) {
      const q = qrMatrix(c.text, { mask: Number(mask) });
      assert.equal(q.version, c.version, `версия для ${c.bytes} байт`);
      assert.equal(q.size, 17 + 4 * c.version);
      assert.deepEqual(rows(q), want, `версия ${c.version}, маска ${mask}`);
      checked++;
    }
  }
  assert.ok(checked >= 39, `сверено матриц: ${checked}`);
});

test('QR: маску выбирает сам, так же, как эталон', () => {
  for (const c of FIX.cases) {
    const q = qrMatrix(c.text);
    assert.equal(q.mask, c.auto, `версия ${c.version}`);
    if (c.masks[c.auto]) assert.deepEqual(rows(q), c.masks[c.auto]);
  }
});

test('QR: ссылка-приглашение помещается с запасом, слишком длинный текст отклоняется', () => {
  const url = `https://tigris-euphrates-online.vercel.app/#/join/${'A'.repeat(22)}`;
  assert.equal(qrMatrix(url).version, 5);
  assert.equal(QR_MAX_BYTES, 213);
  assert.equal(qrMatrix('я'.repeat(106)).version, 10, '212 байт еще помещаются');
  assert.throws(() => qrMatrix('x'.repeat(214)), RangeError);
  assert.throws(() => qrMatrix('я'.repeat(107)), RangeError, 'считаются байты, а не знаки');
  assert.throws(() => qrMatrix(''), RangeError);
  assert.throws(() => qrMatrix('abc', { mask: 8 }), RangeError);
});

test('QR: картинка SVG черным по белому, с полями в 4 модуля и без внешних ссылок', () => {
  const text = 'https://site.app/#/join/AbC_dE-fGh1234567890xy';
  const q = qrMatrix(text);
  const svg = qrSvg(text);
  const side = q.size + 8;
  assert.match(svg, new RegExp(`^<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}"`));
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.match(svg, /<rect width="100%" height="100%" fill="#fff"\/>/);
  assert.match(svg, /<path fill="#000" d="M/);
  assert.doesNotMatch(svg, /href|<script|<image/);
  // рисунок по клеткам: каждая полоска пути закрашивает ровно темные модули, со сдвигом на поля
  const paint = (s, margin) => {
    const grid = Array.from({ length: q.size }, () => new Array(q.size).fill(0));
    const d = /<path fill="#000" d="([^"]*)"/.exec(s)[1];
    assert.equal(d.replace(/M\d+ \d+h\d+v1h-\d+z/g, ''), '', 'в пути только горизонтальные полоски высотой в модуль');
    for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
      const [x, y, len, back] = m.slice(1).map(Number);
      assert.equal(len, back);
      for (let i = 0; i < len; i++) grid[y - margin][x - margin + i] += 1;
    }
    return grid;
  };
  assert.deepEqual(paint(svg, 4), q.modules.map((r) => Array.from(r)), 'картинка повторяет матрицу модуль в модуль');
  const tight = qrSvg(text, { margin: 2 });
  assert.match(tight, new RegExp(`viewBox="0 0 ${q.size + 4} ${q.size + 4}"`));
  assert.deepEqual(paint(tight, 2), q.modules.map((r) => Array.from(r)));
});
