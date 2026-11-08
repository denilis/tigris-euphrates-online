// Нажатия на планшете (08.11): двойное касание не съедает нажатия, ход в пути не уходит дважды.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('страница без увеличения по двойному касанию', () => {
  assert.match(src('../public/css/app.css'), /html\{touch-action:manipulation\}/);
});

test('пока ход на сервере, второй ход не уходит и поле не принимает нажатий', () => {
  const g = src('../public/js/game.js');
  const move = g.slice(g.indexOf('async function move('), g.indexOf('/** Отмена уходит'));
  assert.match(move, /if \(index < 0 \|\| ui\.sending\) return;/);
  assert.match(move, /ui\.sending = true;/);
  assert.match(move, /finally \{\s+ui\.sending = false;/, 'флаг снимается и при ошибке сервера');
  assert.match(move, /ui\.flash = cell;/, 'клетка хода светится сразу');
  const onCell = g.slice(g.indexOf('function onCell('), g.indexOf('function boardOpts('));
  assert.match(onCell, /\|\| ui\.sending\) return;/);
  assert.match(onCell, /move\(idx, i\);/);
});
