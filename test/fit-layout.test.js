// Раскладка под окно (11.11, ноутбук Андрея 1280x690): сторожа одобренной схемы, без браузера.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8');
const game = readFileSync(new URL('../public/js/game.js', import.meta.url), 'utf8');

test('подписи не мельче 11 px (кроме значка «▶» в круглой кнопке прослушивания)', () => {
  const small = [];
  for (const m of css.matchAll(/([^{}]+)\{[^}]*?font-size:\s*(\d+(?:\.\d+)?)px/g)) {
    if (+m[2] < 11 && !m[1].includes('.sfxplay')) small.push(`${m[1].trim()}: ${m[2]}px`);
  }
  assert.deepEqual(small, []);
});

test('шапка: меню «Вид», «Ещё», «Партия» есть и открывают одно общее окно', () => {
  for (const id of ['gViewBtn', 'gMoreBtn', 'gGameBtn']) {
    assert.match(game, new RegExp(`id="${id}" data-menu="\\w+" aria-haspopup="true" aria-expanded="false" aria-controls="gTopMenu"`), id);
  }
  assert.match(game, /id="gTopMenu"/);
  // в тесноте прячутся слои, ссылки и название сайта, а кнопки меню появляются
  for (const rule of ['.top.c1 #gViewBtn', '.top.c2 #gMoreBtn', '.top.c3 .brand', '.app.tight #gGameBtn']) assert.ok(css.includes(rule), rule);
});

test('нижняя панель в тесноте: пауза и сдаться уходят в шапку, отмена значком с подписью', () => {
  assert.match(game, /class="pair stop"/);
  assert.ok(css.includes('.app.tight .acts .pair.stop{display:none}'));
  assert.match(game, /class="btn undo" data-now="undo" aria-label="Отменить действие"/);
  assert.ok(css.includes('.app.tight .acts .undo .lbl{display:none}'));
  // кнопки одного столбца одной ширины (Денис 11.11)
  assert.ok(css.includes('.app.tight .acts{display:grid;grid-template-columns:auto auto'));
});
