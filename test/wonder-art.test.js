// Чудо картинкой (Денис 04.11): крест на 5 клеток вокруг центральной, файл на месте, квадратный,
// углы сетки 3 на 3 пустые (крест подогнан под трети).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { wonderSVG, WONDER_IMG } from '../public/js/board.js';

test('чудо занимает три клетки в ширину и высоту вокруг центральной, с отступом как у тайлов', () => {
  const s = wonderSVG(120, 180, 60);
  const [, href, x, y, w, h] = s.match(/<image href="([^"]+)" x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/);
  assert.equal(href, WONDER_IMG);
  assert.deepEqual([+x, +y, +w, +h], [63, 123, 174, 174]);
});

test('картинка чуда есть и квадратная', () => {
  const url = new URL(`../public${WONDER_IMG}`, import.meta.url);
  assert.ok(existsSync(url));
  const b = readFileSync(url);
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.toString('ascii', 8, 12), 'WEBP');
  // размер из заголовка VP8X: ширина и высота по 3 байта минус 1
  assert.equal(b.toString('ascii', 12, 16), 'VP8X');
  const w = 1 + b.readUIntLE(24, 3), h = 1 + b.readUIntLE(27, 3);
  assert.equal(w, h);
});
