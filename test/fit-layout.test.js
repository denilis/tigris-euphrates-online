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
  for (const rule of ['.top.c1 #gViewBtn', '.top.c2 #gMoreBtn', '.top.c3 .brand']) assert.ok(css.includes(rule), rule);
});

test('«Пауза» и «Сдаться» на любом экране только в «Партия ▾» шапки (Денис 12.11)', () => {
  // внизу их больше нет ни в тесноте, ни на широком экране, ни у зрителя
  assert.doesNotMatch(game, /data-pause|data-stop|class="pair stop"/);
  // кнопка меню видна всегда, когда есть что нажать, а не только в тесноте
  assert.ok(css.includes('#gGameBtn:not(.none){display:inline-block}'));
  assert.ok(!css.includes('.app.tight #gGameBtn'));
  assert.match(game, /classList\.toggle\('none', !\(canPause \|\| label\)\)/);
  // в меню те же действия и те же вопросы перед ними
  assert.match(game, /data-tm="pause">Пауза<\/button>/);
  assert.match(game, /data-tm="stop">\$\{s\.label\}<\/button>/);
  // подсказки не отправляют искать паузу внизу
  const texts = ['rules-text.js', 'tours-data.js'].map((f) => readFileSync(new URL(`../public/js/${f}`, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(texts, /рядом с «Пауза»|«Пас» и «Пауза»|закончить начатую партию кнопкой внизу/);
});

test('нижняя панель в тесноте: отмена значком с подписью', () => {
  assert.match(game, /class="btn undo" data-now="undo" aria-label="Отменить действие"/);
  assert.ok(css.includes('.app.tight .acts .undo .lbl{display:none}'));
  // кнопки одного столбца одной ширины (Денис 11.11)
  assert.ok(css.includes('.app.tight .acts{display:grid;grid-template-columns:auto auto'));
});
