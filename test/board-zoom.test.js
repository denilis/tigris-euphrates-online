// Увеличение поля (15.11): границы, кнопки с тем же центром, щипок держит точку под пальцами.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clampView, zoomCenter, pinchView, viewBoxOf, ZMIN, ZMAX, ZSTEP } from '../public/js/board-zoom.js';

const base = { w: 1000, h: 700 };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('вид не выходит за края и за пределы масштаба', () => {
  assert.deepEqual(clampView({ z: 0.5, x: -10, y: 50 }, base), { z: ZMIN, x: 0, y: 0 });
  const v = clampView({ z: 9, x: 5000, y: 5000 }, base);
  assert.equal(v.z, ZMAX);
  near(v.x, 1000 - 1000 / ZMAX);
  near(v.y, 700 - 700 / ZMAX);
});

test('кнопки: центр окна тот же, «−» до конца возвращает все поле', () => {
  let v = zoomCenter({ z: 1, x: 0, y: 0 }, base, ZSTEP);
  near(v.x + 1000 / v.z / 2, 500);
  near(v.y + 700 / v.z / 2, 350);
  v = zoomCenter(v, base, v.z * ZSTEP);
  v = zoomCenter(v, base, v.z * ZSTEP);
  assert.equal(v.z, ZMAX, 'три нажатия «+» упираются в предел');
  v = zoomCenter(v, base, 1);
  assert.deepEqual(v, { z: 1, x: 0, y: 0 });
  assert.equal(viewBoxOf({ z: 2, x: 100, y: 50 }, base), '100 50 500 350');
});

test('щипок: точка поля под серединой пальцев остается под ними', () => {
  const v0 = { z: 1, x: 0, y: 0 };
  const p0 = { x: 300, y: 200 }; // середина пальцев в доле 0,3 и 0,2857 поля
  const v = pinchView(v0, p0, base, 2, 0.3, 200 / 700);
  assert.equal(v.z, 2);
  near(v.x + 0.3 * (1000 / 2), 300);
  near(v.y + (200 / 700) * (700 / 2), 200);
  // пальцы сдвинулись без щипка: окно едет следом
  const moved = pinchView(v, { x: 300, y: 200 }, base, 1, 0.5, 0.5);
  near(moved.x + 0.5 * 500, 300);
});

test('подключено к экрану партии, один палец не перехвачен', () => {
  const game = readFileSync('public/js/game.js', 'utf8'), zoom = readFileSync('public/js/board-zoom.js', 'utf8');
  assert.match(game, /root\._zoom = mountZoom\(root\.querySelector\('#board'\), root\.querySelector\('\.boardwrap'\)\)/);
  assert.match(game, /renderBoard\([^\n]*\);\n {2}root\._zoom\?\.\(\);/);
  assert.match(zoom, /if \(e\.touches\.length !== 2 \|\| !readBase\(\)\) return;/, 'одно касание идет дальше без preventDefault');
  assert.match(readFileSync('public/css/app.css', 'utf8'), /@media \(pointer:coarse\),\(max-width:900px\)\{\.zoomctl\{display:flex\}\}/);
});
