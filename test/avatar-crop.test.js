// Окно кадрирования фото (Денис 13.11): разметка и подключение. Расчеты кадра и сервер в test/avatar.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cropHTML, SIDE, PREVIEWS } from '../public/js/avatar-crop.js';
import { NEWS } from '../public/js/news.js';
import { userActions } from '../public/js/admin-list.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
// правило Дениса для текста на экране: без длинного тире, многоточия, неразрывных пробелов и средней точки
const CLEAN = /[—…·   ]/;

test('окно: заголовок, фото под кругом, масштаб, три кружка, «Отмена» и «Сохранить фото»', () => {
  const html = cropHTML('Фото профиля');
  assert.match(html, /<h2>Фото профиля<\/h2>/);
  assert.match(html, /<canvas class="cropview" data-cropview tabindex="0" role="img" aria-label="Фото\. Двигайте его/);
  assert.match(html, /data-cropout aria-label="Уменьшить"[^>]*>−<\/button>\s*<input type="range" min="0" max="1000" step="1" value="0" data-cropscale aria-label="Масштаб">\s*<button[^>]*data-cropin aria-label="Увеличить"[^>]*>\+<\/button>/);
  assert.match(html, /Как будет на сайте/);
  assert.deepEqual([...html.matchAll(/data-prev="(\d+)" style="width:(\d+)px;height:(\d+)px"/g)].map((m) => m.slice(1).map(Number)), [[120, 120, 120], [52, 52, 52], [26, 26, 26]]);
  assert.deepEqual(PREVIEWS, [120, 52, 26], 'профиль, лобби, шапка');
  assert.match(html, /<button class="btn" type="button" data-cropcancel>Отмена<\/button><button class="btn primary" type="button" data-cropok>Сохранить фото<\/button>/);
  assert.equal(html.match(/data-cropcancel/g).length, 2, 'закрыть можно крестиком и кнопкой «Отмена»');
  assert.match(html, /data-croperr role="alert"/);
  assert.doesNotMatch(html, CLEAN);
});

test('окно: заголовок с именем игрока экранирован', () => {
  const html = cropHTML('Фото игрока <b>Вася</b> & Ко');
  assert.match(html, /<h2>Фото игрока &lt;b&gt;Вася&lt;\/b&gt; &amp; Ко<\/h2>/);
});

test('на сервер уходит тот же квадрат 160 на 160, что и раньше', () => {
  assert.equal(SIDE, 160);
  const src = read('public/js/avatar-crop.js');
  assert.match(src, /c\.width = c\.height = SIDE;/);
  assert.match(src, /const MAX_CHARS = 28000;/, 'запас до серверных 30000 знаков');
  assert.match(read('server/avatar.js'), /const MAX_CHARS = 30000;/);
});

test('подключено: в профиле у каждого игрока и у администратора в «Кодах игроков»', () => {
  const profile = read('public/js/profile.js');
  assert.match(profile, /import \{ openCrop \} from '\.\/avatar-crop\.js';/);
  assert.match(profile, /await openCrop\(file, \{ title: 'Фото профиля', save: put \}\);/);
  assert.doesNotMatch(profile, /squareCrop|обрежется по центру/, 'прежней обрезки по центру в профиле нет');
  assert.match(profile, /круг покажет, что попадет в кадр/);
  const main = read('public/js/main.js');
  assert.match(main, /data-photo="\$\{esc\(u\.id\)\}"/);
  assert.match(main, /\$\{can\.photo \? `<button class="btn sm" data-photo=/, 'кнопка «Фото» по правам из userActions');
  assert.match(main, /api\('POST', `admin\/users\/\$\{who\.id\}\/avatar`, \{ image \}\)/);
  assert.match(main, /<input type="file" id="uFile" accept="image\/\*" hidden>/);
  const css = read('public/css/app.css');
  for (const cls of ['.picker.crop', '.cropview', '.cropzoom', '.cropprev', '.cropbtns']) assert.ok(css.includes(cls), cls);
  assert.match(css, /\.cropview\{[^}]*touch-action:none/, 'палец двигает фото, а не страницу');
});

test('новость про кадрирование есть, тексты чистые', () => {
  const day = NEWS.find((d) => d.date === '2026-11-13');
  assert.ok(day.items.some((s) => s.includes('<b>Фото в профиле можно кадрировать.</b>')));
  for (const f of ['public/js/avatar-crop.js', 'public/js/avatar-core.js']) assert.doesNotMatch(read(f), CLEAN, f);
});

test('кнопки в строке игрока: кому что можно (те же правила, что на сервере)', () => {
  const player = { id: 'u1', name: 'Вася' }, adminRow = { id: 'u2', name: 'Петя', admin: true }, mainRow = { id: 'u-admin', name: 'Денис', admin: true, main: true };
  const A = { admin: true, main: false }, M = { admin: true, main: true }, P = { admin: false, main: false };
  // администратор: игроку все, другому администратору и главному ничего
  assert.deepEqual(userActions(player, A), { code: true, revoke: true, open: false, photo: true, profile: true });
  assert.deepEqual(userActions(adminRow, A), { code: false, revoke: false, open: false, photo: false, profile: true });
  assert.deepEqual(userActions(mainRow, A), { code: false, revoke: false, open: false, photo: false, profile: true });
  // главный: и администратору тоже; себе через список ничего
  assert.equal(userActions(adminRow, M).photo, true);
  assert.equal(userActions({ ...mainRow, self: true }, M).photo, false);
  assert.equal(userActions({ ...mainRow, self: true }, M).profile, true);
  // игрок без прав: своему приглашенному только «Новый код», чужой профиль не открывает
  assert.deepEqual(userActions(player, P), { code: true, revoke: false, open: false, photo: false, profile: false });
  assert.equal(userActions({ ...player, self: true }, P).profile, true, 'свой профиль открыт каждому');
  // отозванному: только новый код; новичку: еще и «Открыть доступ»
  assert.deepEqual(userActions({ ...player, revoked: true }, A), { code: true, revoke: false, open: false, photo: false, profile: true });
  assert.equal(userActions({ ...player, path: { state: 'novice', steps: 1 } }, A).open, true);
  assert.equal(userActions({ ...player, path: { state: 'ask' }, revoked: true }, A).open, false);
});
