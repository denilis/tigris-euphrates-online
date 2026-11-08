// Полный экран и установка на главный экран (08.11): кнопка в шапках, манифест со значками.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fsCan, fsOn, fsButton, toggleFullscreen } from '../public/js/fullscreen.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('кнопки нет, если браузер не умеет полный экран (iPhone)', () => {
  assert.equal(fsCan(undefined), false);
  assert.equal(fsButton('navbtn', { fullscreenEnabled: false }), '');
  assert.equal(fsButton('navbtn', undefined), '');
});

test('кнопка с обеими подписями, подпись выбирает CSS', () => {
  const html = fsButton('navbtn', { fullscreenEnabled: true });
  assert.match(html, /class="navbtn fsbtn" data-fs/);
  assert.match(html, /<span class="fs-in">Весь экран<\/span>/);
  assert.match(html, /<span class="fs-out">Обычный экран<\/span>/);
  assert.ok(fsCan({ webkitFullscreenEnabled: true }), 'Safari на iPad: префикс webkit');
  const css = src('../public/css/app.css');
  assert.match(css, /:root:fullscreen \.fsbtn \.fs-in\{display:none\}/);
  assert.match(css, /:root:-webkit-full-screen \.fsbtn \.fs-in\{display:none\}/);
});

test('нажатие входит в полный экран и выходит из него', async () => {
  const calls = [];
  const el = { requestFullscreen: (o) => { calls.push(['in', o.navigationUI]); return Promise.resolve(); } };
  const doc = { documentElement: el, fullscreenElement: null, exitFullscreen: () => { calls.push(['out']); return Promise.resolve(); } };
  await toggleFullscreen(doc);
  doc.fullscreenElement = el;
  assert.ok(fsOn(doc));
  await toggleFullscreen(doc);
  assert.deepEqual(calls, [['in', 'hide'], ['out']]);
  // отказ браузера (не по нажатию, запрет) страницу не ломает
  const bad = { documentElement: { requestFullscreen: () => Promise.reject(new Error('no')) } };
  await toggleFullscreen(bad);
  await toggleFullscreen({ documentElement: { webkitRequestFullscreen: () => undefined } });
});

test('кнопка в шапке партии и в шапке страниц, нажатия ловятся один раз', () => {
  assert.match(src('../public/js/game.js'), /Мои столы<\/a>\$\{fsButton\('navbtn'\)\}<\/nav>/);
  const main = src('../public/js/main.js');
  assert.match(main, /\$\{fsButton\('barfs'\)\}/);
  assert.equal(main.match(/bindFullscreen\(\)/g).length, 1);
});

test('манифест: запуск без панелей браузера, значки на месте', () => {
  const html = src('../public/index.html');
  assert.match(html, /<link rel="manifest" href="\/manifest.json">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/img\/app\/apple-touch-icon.png">/);
  const m = JSON.parse(src('../public/manifest.json'));
  assert.equal(m.name, 'Тигр и Евфрат');
  assert.equal(m.display, 'fullscreen');
  assert.equal(m.start_url, '/');
  for (const size of ['192x192', '512x512']) assert.ok(m.icons.some((i) => i.sizes === size), size);
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const i of m.icons) assert.ok(existsSync(new URL(`../public${i.src}`, import.meta.url)), i.src);
  assert.ok(existsSync(new URL('../public/img/app/apple-touch-icon.png', import.meta.url)));
});
