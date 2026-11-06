// «Назад» и «Закрыть» в заголовке стола (Денис 06.11, схема одобрена): «Назад» ведет на прошлую
// страницу сайта, а если ее нет или это ссылка-приглашение либо этот же стол, в «Мои столы».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backFrom } from '../public/js/online.js';

test('«Назад» из лобби: прошлая страница сайта, иначе «Мои столы»', () => {
  for (const prev of ['#/tables', '#/new', '#/', '', '#/stats', '#/t/XYZ123']) assert.equal(backFrom(prev, 'ABCDEF'), 'back', prev);
  for (const prev of [null, undefined, '#/join/AbC_dE-fGh1234567890xy', '#/t/ABCDEF', '#/t/ABCDEF/replay']) assert.equal(backFrom(prev, 'ABCDEF'), '#/tables', String(prev));
});

test('кнопки в заголовке стола есть в лобби и спрятаны в экскурсии', () => {
  const src = readFileSync(new URL('../public/js/lobby.js', import.meta.url), 'utf8');
  assert.match(src, /id="lBack"[^>]*>Назад</);
  assert.match(src, /id="lClose"[^>]*aria-label="Закрыть"/);
  assert.match(src, /tour \? '' : `<div class="lnav">/);
});

test('«Назад» и «×» на страницах-карточках (06.11): где есть кнопки и куда ведет «Назад»', async () => {
  const { NAV_PAGES, pageBack } = await import('../public/js/online.js');
  for (const h of ['rules', 'learn', 'stats', 'stats/me', 'me', 'tables', 'new', 'admin', 't/ABC123/replay', 't/ABC123/replay/7']) assert.ok(NAV_PAGES.test(h), h);
  for (const h of ['', 't/ABC123', 'learn/3/play', 'learn/tour/i2', 'join/xyz']) assert.ok(!NAV_PAGES.test(h), `${h}: у партии, урока, лобби и стартового экрана своя навигация`);
  assert.equal(pageBack(null, '#/rules'), '#/', 'открыли по ссылке: на стартовый экран');
  assert.equal(pageBack('#/rules', '#/rules'), '#/');
  assert.equal(pageBack('#/join/abc', '#/tables'), '#/');
  assert.equal(pageBack('#/tables', '#/new'), 'back');
});
