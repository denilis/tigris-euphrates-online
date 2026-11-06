// Рисунки правил (просьба Дениса 06.11): земля как на поле с рельефом, монумент как на сайте.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { figureHTML } from '../public/js/rules-art.js';

test('правила: обе карты с рельефом и руслом реки, у каждой своя маска реки', () => {
  const s = figureHTML('boards', 'карты');
  assert.equal((s.match(/class="stream"/g) || []).length, 2, 'река руслом, как в партии');
  assert.match(s, /\/img\/terrain\/sand\.webp/);
  assert.match(s, /\/img\/terrain\/water\.webp/);
  assert.doesNotMatch(s, /#3a7aa3/, 'клетки реки больше не заливаются синим');
  assert.match(s, /id="riverM-standard"/);
  assert.match(s, /id="riverM-advanced"/);
  assert.doesNotMatch(s, /url\(#(riverM|waterP|sandP|bankBlur|deep)\)/, 'ссылки только на свои id: два рисунка на одной странице');
});

test('правила: речная клетка малого участка водой по клетке, монумент картинкой как на сайте', () => {
  assert.match(figureHTML('leader', 'лидер'), /mask="url\(#riverM-leader\)"/);
  const mon = figureHTML('monument', 'монумент');
  const m = mon.match(/href="(\/img\/monuments\/enamel\/[a-z-]+\.webp)"/);
  assert.ok(m, 'монумент картинкой enamel');
  assert.equal(m[1], '/img/monuments/enamel/green-black.webp');
  assert.ok(existsSync(new URL(`../public${m[1]}`, import.meta.url)), 'файл картинки на месте');
});
