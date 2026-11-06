// Экскурсии по сайту (Денис 05.11): шаги, тексты без длинного тире и многоточия, учебный стол
// собран настоящим столом и совпадает с файлом, кадр урока для экрана партии существует.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { TOURS, tourById, TOUR_GAME_FRAME } from '../public/js/tours-data.js';
import { tourLobby } from '../lessons/tour.js';

test('четыре экскурсии, у каждого шага заголовок и текст, адреса i1-i4', () => {
  assert.deepEqual(TOURS.map((t) => t.id), ['i1', 'i2', 'i3', 'i4']);
  for (const t of TOURS) {
    assert.ok(['lobby', 'game', 'map'].includes(t.screen), t.id);
    assert.ok(t.title && t.goal && t.minutes > 0 && t.steps.length >= 5, t.id);
    for (const s of t.steps) {
      assert.ok(s.title && s.say, `${t.id}: ${s.title}`);
      if (s.sel) assert.equal(typeof s.sel, 'string');
    }
  }
  assert.equal(tourById('i3').screen, 'map');
  assert.equal(tourById('нет'), null);
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
