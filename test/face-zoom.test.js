// Крупное фото игрока в партии (Денис 16.11, схема одобрена): нажатие на аватар в карточке игрока
// открывает окно поверх партии. Квадрат со скругленными углами, под ним имя и герой, у бота стиль и сила.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { faceZoomHTML } from '../public/js/face-zoom.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('фото человека крупно, имя и герой', () => {
  const html = faceZoomHTML({ kind: 'human', name: 'Влад <b>', avatar: 'ab12', hero: 'lion' }, { color: 3 });
  assert.match(html, /url\(\/api\/avatar\/ab12\),url\(\/img\/tokens\/lion_black\.png\)/, 'под фото жетон, как в карточке');
  assert.match(html, /Влад &lt;b&gt;/, 'имя экранировано');
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /герой лев/);
  assert.match(html, /data-fzclose/);
  assert.match(html, /aria-label="Закрыть"/);
  assert.doesNotMatch(html, /бот,/);
});

test('у бота портрет стиля, стиль и сила', () => {
  const html = faceZoomHTML({ kind: 'bot', name: 'Бот неистовый', hero: 'pot', bot: { style: 'universal', strength: 50 } }, { color: 3 });
  assert.match(html, /\/img\/bots\/universal\.webp/);
  assert.match(html, /бот, Неистовый, сила 50/);
  assert.match(html, /Бот неистовый/);
});

test('без фото жетон героя, свое место подписано', () => {
  const html = faceZoomHTML({ kind: 'human', name: 'Денис', avatar: null, hero: 'bow' }, { mine: true, color: 0 });
  assert.match(html, /background-image:url\(\/img\/tokens\/bow_red\.png\)/);
  assert.match(html, /\(вы\)/);
});

test('пустое место и неизвестный герой не ломают окно', () => {
  const html = faceZoomHTML({}, {});
  assert.match(html, /Бот|Игрок/);
  assert.doesNotMatch(html, /undefined|null/);
});

test('подключено: аватар в карточке открывает окно, курсор-лупа', () => {
  const src = read('public/js/game.js');
  assert.match(src, /import \{ openFaceZoom \} from '\.\/face-zoom\.js';/);
  assert.match(src, /<div class="av" data-face="\$\{pl\.seat\}"/);
  assert.match(src, /closest\('\[data-face\]'\)/);
  assert.match(read('public/css/app.css'), /\.pc \.av\{[^}]*cursor:zoom-in/);
  assert.match(read('public/css/app.css'), /\.facezoom \.fzpic\{/);
});

test('тексты окна без длинного тире и многоточия', () => {
  assert.doesNotMatch(read('public/js/face-zoom.js'), /[—… ]/);
});
