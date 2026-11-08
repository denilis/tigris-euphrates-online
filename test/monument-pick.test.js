// Выбор монумента в «Запасе» (08.11, схема одобрена Денисом): без второй панели в «Сейчас», яркие
// монументы нажимаются, тусклые нет, плашка «Поставить» или двойное нажатие, монумент встает на
// уже собранный квадрат без нажатия на поле; при двух квадратах место выбирают на поле.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const game = src('../public/js/game.js');
const part = (from, to) => game.slice(game.indexOf(from), game.indexOf(to, game.indexOf(from)));

test('в «Сейчас» нет второй панели монументов, только подсказка и кнопки', () => {
  const now = part("} else if (g.phase === 'monument') {\n    title = 'Монумент';".replace(/\n/g, game.includes('\r\n') ? '\r\n' : '\n'), "} else if (g.phase === 'treasure')");
  assert.doesNotMatch(game, /monopt|data-mon="/);
  assert.match(now, /нажмите \$\{what\} в «Запасе»/);
  assert.match(now, /btn\('skip', 'Не строить'\)/);
  assert.doesNotMatch(src('../public/css/app.css'), /\.monopt/);
});

test('в «Запасе» нажимаются только монументы и чудо, которые можно поставить', () => {
  const stock = part('function drawStock(', '/** Куда может встать выбранное');
  assert.match(stock, /monNow\?\.has\(m\.id\) \? m\.id : null/, 'кнопка только у ярких');
  assert.match(stock, /wonderNow \? 'wonder' : null/);
  assert.match(stock, /data-pick="\$\{pick\}"/);
  assert.match(stock, /' sel' : ''/, 'выбранный в рамке');
  assert.match(stock, /':' \+ sel;/, 'выбор меняет «Запас», хотя запас тот же');
  assert.match(game, /root\.querySelector\('#gStock'\)\.addEventListener\('click'/);
});

test('плашка «Поставить», двойное нажатие и место без нажатия на поле', () => {
  const pick = part('function pickMon(', '/** Поставить выбранное');
  assert.match(pick, /at - \(ui\.monTapAt \|\| 0\) < MON_DOUBLE_MS/);
  assert.match(pick, /again && monChoices\(legal, id\)\.length === 1\) return placeMon\(\)/);
  const place = part('function placeMon(', '/** Плашка над рукой');
  assert.match(place, /if \(opts\.length !== 1\) return;/, 'при двух квадратах ставят нажатием на поле');
  assert.match(place, /move\(legal\.indexOf\(opts\[0\]\)/);
  const bar = part('function drawMonBar(', '/** Начало выбора монумента');
  assert.match(bar, /data-mb="place">Поставить<\/button>/);
  assert.match(bar, /нажмите одно из подсвеченных мест на поле/);
  assert.match(game, /id="gMonBar"/);
});

test('квадрат подсвечен сразу, выбранный монумент виден на нем полупрозрачно', () => {
  const opts = part("else if (g.phase === 'monument' && ui.monSel != null) {", '  o.hit = hitCells(o, g.players');
  assert.match(opts, /o\.preview = \{ c1: mon\.c1, c2: mon\.c2, tl: o\.squares\[0\] \}/);
  assert.match(opts, /o\.hit = hitCells\(\{ \.\.\.o, squares: \[\] \}, \[\]\)/, 'без выбора квадрат не нажимается');
  assert.match(src('../public/js/board.js'), /<g class="mon-preview">/);
});

test('«Запас» раскрыт и прокручен на экран, в уроке тоже виден', () => {
  const panels = src('../public/js/panels.js');
  assert.match(panels, /export function holdStockOpen\(open\)/);
  assert.match(panels, /!\(id === 'stock' && stockOpen\)/);
  assert.match(part('function showStock(', '\nfunction draw()'.replace(/\n/g, game.includes('\r\n') ? '\r\n' : '\n')), /scrollIntoView/);
  assert.match(src('../public/css/app.css'), /\.app\.lesson\.monpick \[data-block="stock"\]\{display:block\}/);
  assert.match(src('../lessons/6-monument.js'), /В «Запасе» нажмите монумент зеленого и черного цветов, потом «Поставить»/);
});
