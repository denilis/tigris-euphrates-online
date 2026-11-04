// Здания и вид тайлов (Денис 04.11). Лист плиток в кирпичной рамке, который сначала стоял зданиями,
// стал видом тайлов; здания круглыми фишками поверх тайла, пока фишек нет, рисуются значками.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { buildingSVG, buildingIcon, CHIPS_READY, chipImg, BUILDING_STYLES } from '../public/js/board.js';
import { tileImg, setTileStyle, getTileStyle, TILE_STYLES } from '../public/js/util.js';

const exists = (href) => existsSync(new URL(`../public${href}`, import.meta.url));

test('прежние значки: у каждого цвета свой силуэт в золотой раме с розетками', () => {
  const paths = [0, 1, 2, 3].map((c) => buildingSVG(c, 0, 0, 'b', 'seal').match(/d="(M[^"]+)"/)[1]);
  assert.equal(new Set(paths).size, 4);
  const s = buildingSVG(2, 0, 0, 'b', 'seal');
  assert.match(s, /url\(#bvg\)/);
  assert.match(s, /url\(#bv2\)/);
  assert.doesNotMatch(s, /<image/);
});

test('фишки: пока картинок нет, здание рисуется значком, а не пустым местом', () => {
  assert.deepEqual(BUILDING_STYLES, ['chip', 'seal']);
  if (!CHIPS_READY) {
    assert.equal(buildingSVG(1, 0, 0, 'b', 'chip'), buildingSVG(1, 0, 0, 'b', 'seal'));
    assert.equal(buildingSVG(1, 0, 0, 'b'), buildingSVG(1, 0, 0, 'b', 'seal'), 'по умолчанию фишки');
    assert.equal(buildingSVG(1, 0, 0, 'b', 'tile'), buildingSVG(1, 0, 0, 'b', 'seal'), 'прежнее значение стола tile тоже значком');
  } else {
    for (const c of [0, 1, 2, 3]) assert.ok(exists(chipImg(c)), chipImg(c));
    const [, x, y, w, h] = buildingSVG(0, 0, 0, 'b', 'chip').match(/<image href="[^"]+" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
    assert.ok(+x > 0 && +y > 0 && +x + +w < 60 && +y + +h < 60, 'фишка меньше клетки: тайл виден вокруг');
  }
  assert.match(buildingIcon(0, 26, 'seal'), /^<svg viewBox="0 0 60 60" width="26"/);
});

test('вид тайлов: плитки и прежние картинки, файлы есть, по умолчанию прежние до выбора стола', () => {
  assert.deepEqual(TILE_STYLES, ['plate', 'classic']);
  for (const c of [0, 1, 2, 3]) {
    assert.ok(exists(tileImg(c, 'plate')), tileImg(c, 'plate'));
    assert.ok(exists(tileImg(c, 'classic')), tileImg(c, 'classic'));
  }
  assert.equal(new Set([0, 1, 2, 3].map((c) => tileImg(c, 'plate'))).size, 4);
  const was = getTileStyle();
  setTileStyle('plate');
  assert.equal(tileImg(0), '/img/tiles/plate/temple.webp');
  setTileStyle('что-то');
  assert.equal(getTileStyle(), 'classic', 'незнакомый вид дает прежние картинки');
  assert.equal(tileImg(0), '/img/tiles/temple.jpg');
  setTileStyle(was);
});

test('опции стола: тайлы плитками и здания фишками по умолчанию, хозяин меняет', async () => {
  const { DEFAULT_OPTIONS, createTable, setOptions } = await import('../game/table.js');
  assert.equal(DEFAULT_OPTIONS.tiles, 'plate');
  assert.equal(DEFAULT_OPTIONS.building, 'chip');
  const t = createTable({ code: 'BLDSTY', host: { userId: 'h', name: 'Хозяин' }, now: 0 });
  setOptions(t, 'h', { building: 'seal', tiles: 'classic' }, 1);
  assert.equal(t.options.building, 'seal');
  assert.equal(t.options.tiles, 'classic');
  assert.throws(() => setOptions(t, 'h', { building: 'tile' }, 2), 'плитки больше не вид зданий');
  assert.throws(() => setOptions(t, 'h', { tiles: 'gold' }, 3));
});
