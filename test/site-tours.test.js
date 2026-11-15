// Экскурсии по сайту (Денис 05.11): шаги, тексты без длинного тире и многоточия, учебный стол
// собран настоящим столом и совпадает с файлом, кадр урока для экрана партии существует.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { TOURS, tourById, TOUR_GAME_FRAME } from '../public/js/tours-data.js';
import { tourLobby } from '../lessons/tour.js';
import { ANALYSIS_SHOWN } from '../public/js/util.js';

test('четыре экскурсии, у каждого шага заголовок и текст, адреса i1-i4', () => {
  assert.deepEqual(TOURS.map((t) => t.id), ['i1', 'i2', 'i3', 'i4']);
  for (const t of TOURS) {
    assert.ok(['lobby', 'game', 'map'].includes(t.screen), t.id);
    assert.ok(t.title && t.goal && t.minutes > 0 && t.steps.length >= 5, t.id);
    for (const s of t.steps) {
      assert.ok(s.title && s.say, `${t.id}: ${s.title}`);
      // строка или список строк: подсвечивается первый видимый (15.11)
      if (s.sel) {
        const list = [].concat(s.sel);
        assert.ok(list.length && list.every((x) => typeof x === 'string' && x), `${t.id}: ${s.title}`);
      }
    }
  }
  assert.equal(tourById('i3').screen, 'map');
  assert.equal(tourById('нет'), null);
});

test('экскурсии под интерфейс 15.11: нет старых кнопок, шапка в тесноте, разбор скрыт', () => {
  const text = JSON.stringify(TOURS);
  // «Метки» стали слоем «Тайлы», слоя «Монументы» нет (06.11); «Подробнее о ботах» стало «Досье бота»
  assert.doesNotMatch(text, /«Метки»|«Монументы»: чей|Подробнее о ботах|Обычное или продвинутое поле/);
  assert.match(text, /Большое поле/);
  // слои и «Поле» на узком экране в «Вид ▾»: шаг подсвечивает меню, если кнопок не видно
  const step = (id, title) => tourById(id).steps.find((s) => s.title === title);
  assert.deepEqual(step('i2', 'Слои поля').sel, ['#gViewBtn', '#gLayers']);
  assert.deepEqual(step('i2', 'Вид поля').sel, ['#gLook', '#gViewBtn']);
  for (const sel of ['#gGameBtn', '#gHand .acts', '#gSideSet', '[data-fs]']) {
    assert.ok(tourById('i2').steps.some((s) => s.sel === sel), sel);
  }
  assert.ok(tourById('i4').steps.some((s) => s.sel === '[data-botinfo]'), 'досье бота');
  // разбор партии ботом скрыт (util.js ANALYSIS_SHOWN): ни шага, ни карточки на карте
  const tourSrc = readFileSync('public/js/tour.js', 'utf8');
  assert.equal(ANALYSIS_SHOWN, false);
  assert.ok(!tourById('i3').steps.some((s) => s.sel === '#mapAnalysis'));
  assert.match(tourSrc, /\.filter\(\(\[id\]\) => ANALYSIS_SHOWN \|\| id !== 'mapAnalysis'\)/);
  // у каждого шага карты есть карточка
  for (const s of tourById('i3').steps) {
    const id = /^#(map\w+)$/.exec(s.sel)?.[1];
    if (id) assert.match(tourSrc, new RegExp(`\\['${id}', `), id);
  }
});

test('экскурсия по лобби не просит турниры: у гостя 401 зацикливал перерисовку (15.11)', () => {
  const lobby = readFileSync('public/js/lobby.js', 'utf8');
  assert.match(lobby, /if \(!tour && session\.get\(\)\?\.token\) mountTour\(/);
  assert.equal((lobby.match(/mountTour\(root/g) || []).length, 1, 'другого вызова нет');
});

test('справка «Наш сайт» и урок 3 без старых кнопок', () => {
  const rules = readFileSync('public/js/rules-text.js', 'utf8');
  assert.doesNotMatch(rules, /Кнопка «Метки»|есть десять секунд/);
  assert.doesNotMatch(readFileSync('lessons/3-points.js', 'utf8'), /Кнопка «Метки»/);
});

test('тексты экскурсий без длинного тире, многоточия и неразрывных пробелов', () => {
  assert.doesNotMatch(JSON.stringify(TOURS), /[—…  ]/);
  assert.doesNotMatch(readFileSync('public/js/tour.js', 'utf8'), /[—…  ]/);
});

test('учебный стол: лобби, хозяин Ученик, свободное место и бот; файл собран из кода', () => {
  const v = tourLobby();
  assert.equal(v.status, 'lobby');
  assert.equal(v.isHost, true);
  assert.deepEqual(v.seats.map((s) => s.kind), ['human', 'human', 'human', 'bot']);
  assert.equal(v.seats[2].userId ?? null, null, 'третье место свободно: шаг «Свободное место»');
  assert.equal(readFileSync('public/lessons/tour-lobby.json', 'utf8'), JSON.stringify(v), 'запустите node tools/build-lessons.js');
});

test('кадр урока для экскурсии по партии: ход ученика, на поле есть тайлы и журнал', () => {
  const l = JSON.parse(readFileSync(`public/lessons/${TOUR_GAME_FRAME.lesson}.json`, 'utf8'));
  const s = l.steps[TOUR_GAME_FRAME.step];
  assert.ok(s, 'шаг есть');
  assert.equal(s.by, 'me');
  assert.ok(s.game.log.length > 0);
});

test('у каждой экскурсии свой значок в стиле обложек уроков (06.11)', () => {
  for (const t of TOURS) assert.ok(existsSync(new URL(`../public/img/tours/${t.id}.webp`, import.meta.url)), t.id);
  assert.match(readFileSync(new URL('../public/js/lesson.js', import.meta.url), 'utf8'), /src="\/img\/tours\/\$\{t\.id\}\.webp"/);
});
