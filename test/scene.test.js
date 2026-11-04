// Стартовая картинка по очереди (04.11): летняя и зимняя сцены сменяют друг друга при загрузке.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENES, pickScene } from '../public/js/scene.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

test('сцены по очереди: первая зимняя, дальше чередуются', () => {
  const store = memory();
  assert.deepEqual([1, 2, 3, 4].map(() => pickScene(store)), ['winter', 'summer', 'winter', 'summer']);
});

test('без памяти браузера (приватный режим) сцена все равно выбирается', () => {
  const broken = { getItem() { throw new Error('нет'); }, setItem() { throw new Error('нет'); } };
  assert.equal(pickScene(broken), 'winter');
  assert.equal(pickScene(null), 'winter');
});

test('у летней сцены ролик, у зимней только картинка', () => {
  assert.equal(SCENES.summer.video, '/media/zastavka.mp4');
  assert.equal(SCENES.winter.video, null);
  assert.match(SCENES.winter.img, /winter/);
});
