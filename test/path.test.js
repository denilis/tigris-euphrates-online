// Страницы пути новичка и приглашения с QR-кодом (Денис 13.11): разметка и тексты без браузера.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { needsSurvey, isNovice, surveyHTML, pathHTML, stepNote, pathLabel, LESSONS } from '../public/js/path-core.js';
import { inviteBoxHTML, QR_FILE } from '../public/js/invite-box.js';
import { renderEnd } from '../public/js/end.js';
import { NEWS } from '../public/js/news.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
// правило Дениса для текста на экране: без длинного тире, многоточия, неразрывных пробелов и средней точки
const CLEAN = /[—…·   ]/;

const novice = (steps, extra = {}) => ({
  state: 'novice', steps, learn: null, table: null,
  list: [['Учу правила', 1], ['Играю иногда', 2], ['Уверенный игрок', 3]].map(([level, bots], i) => ({ n: i + 1, bots, level, status: i < steps ? 'done' : i === steps ? 'now' : 'locked' })),
  ...extra,
});

test('опрос показывается только тому, кто зарегистрировался по ссылке и еще не ответил', () => {
  const ask = { token: 't', user: { name: 'Гоша', path: { state: 'ask' } } };
  assert.equal(needsSurvey(ask), true);
  assert.equal(needsSurvey({ ...ask, pathAnswered: true }), false, 'ответил: пульс со старым состоянием вопрос не вернет');
  assert.equal(needsSurvey({ token: 't', user: { name: 'Гоша', path: { state: 'novice', steps: 0 } } }), false);
  assert.equal(needsSurvey({ token: 't', user: { name: 'Денис' } }), false, 'прежних игроков не спрашиваем');
  assert.equal(needsSurvey({ user: { path: { state: 'ask' } } }), false, 'без входа опроса нет');
  assert.equal(needsSurvey(null), false);
  assert.equal(isNovice({ path: { state: 'ask' } }), true);
  assert.equal(isNovice({ path: { state: 'novice', steps: 2 } }), true);
  assert.equal(isNovice({ name: 'Денис' }), false);
  assert.equal(isNovice(undefined), false);
});

test('опрос: вопрос с именем, два ответа, имя экранировано', () => {
  const html = surveyHTML('Гоша <b>');
  assert.match(html, /Гоша &lt;b&gt;, вы уже играли в «Тигр и Евфрат»\?/);
  assert.match(html, /<button class="btn" type="button" data-played="1">Да, правила знаю<\/button>/);
  assert.match(html, /<button class="btn" type="button" data-played="0">Нет, я новичок<\/button>/);
  assert.match(html, /три партии с ботами/);
  assert.match(surveyHTML(''), /<p class="svq">Вы уже играли/);
  assert.doesNotMatch(html, CLEAN);
});

test('путь: обучение, активный шаг с кнопкой «Играть», остальные закрыты', () => {
  const html = pathHTML(novice(0));
  assert.match(html, /<h2>Путь новичка<\/h2>/);
  assert.match(html, /<b>Обучение<\/b><small>8 уроков с ботом-тренером<\/small>/);
  assert.match(html, /<a class="btn sm" href="#\/learn">Пройти<\/a><button class="btn sm" type="button" data-npskip>Пропустить<\/button>/);
  assert.match(html, /<li class="npi np-now">[\s\S]*?<b>Партия с одним ботом<\/b><small>уровень «Учу правила»<\/small>[\s\S]*?<button class="btn primary" type="button" data-npplay>Играть<\/button>/);
  assert.match(html, /<li class="npi np-locked">[\s\S]*?<b>Партия с двумя ботами<\/b><small>уровень «Играю иногда»<\/small>[\s\S]*?закрыто/);
  assert.match(html, /<b>Партия с тремя ботами<\/b><small>уровень «Уверенный игрок»<\/small>/);
  assert.equal(html.match(/data-npplay/g).length, 1, 'кнопка «Играть» одна');
  assert.equal(html.match(/закрыто/g).length, 2);
  assert.match(html, /После трех партий откроются турниры и приглашения/);
  assert.doesNotMatch(html, CLEAN);
});

test('путь: сыгранные шаги отмечены, идущая партия продолжается той же кнопкой', () => {
  const html = pathHTML(novice(1, { table: 'ABCDEF' }));
  assert.match(html, /<li class="npi np-done">[\s\S]*?<b>Партия с одним ботом<\/b>[\s\S]*?<span class="npmark">сыграно<\/span>/);
  assert.match(html, /<li class="npi np-now">[\s\S]*?уровень «Играю иногда», партия идет[\s\S]*?data-npplay>Продолжить<\/button>/);
  assert.equal(html.match(/закрыто/g).length, 1);
  const last = pathHTML(novice(2));
  assert.equal(last.match(/сыграно/g).length, 2);
  assert.doesNotMatch(last, /закрыто/);
});

test('путь: строка обучения помнит пропуск и считает пройденные уроки', () => {
  assert.equal(LESSONS, 8);
  const some = pathHTML(novice(0), 3);
  assert.match(some, /8 уроков с ботом-тренером, пройдено 3 из 8/);
  assert.match(some, /data-npskip/);
  const skipped = pathHTML(novice(0, { learn: 'skip' }), 3);
  assert.match(skipped, /<span class="npmark off">пропущено<\/span><a class="btn sm" href="#\/learn">Пройти<\/a>/);
  assert.doesNotMatch(skipped, /data-npskip/);
  const all = pathHTML(novice(0, { learn: 'skip' }), 8);
  assert.match(all, /<li class="npi np-done">\s*<span class="npn" aria-hidden="true">У<\/span>[\s\S]*?<span class="npmark">пройдено<\/span>/);
  assert.doesNotMatch(all, /пропущено|data-npskip/);
});

test('тексты про шаг: окно итога и «Коды игроков»', () => {
  assert.equal(stepNote(1), 'Партия 1 из 3 пути новичка сыграна. Дальше партия с двумя ботами.');
  assert.equal(stepNote(2), 'Партия 2 из 3 пути новичка сыграна. Дальше партия с тремя ботами.');
  assert.match(stepNote(3), /Путь новичка пройден: вам открыты турниры и приглашения/);
  assert.equal(pathLabel({ state: 'novice', steps: 2 }), 'новичок: сыграно 2 из 3');
  assert.equal(pathLabel({ state: 'ask' }), 'новичок: еще не ответил на опрос');
  assert.equal(pathLabel(undefined), '');
  for (const s of [stepNote(1), stepNote(3), pathLabel({ state: 'ask' })]) assert.doesNotMatch(s, CLEAN);
});

test('блок приглашения: QR-код, ссылка, две кнопки и подпись; ссылка экранирована', () => {
  const url = 'https://site.app/#/join/AbC_dE-fGh1234567890xy';
  const html = inviteBoxHTML(url, 'На одного человека, действует до 20.11', 'jnew');
  assert.match(html, /^<div class="qrbox jnew">/);
  assert.match(html, /<div class="qrpic"><svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/);
  assert.match(html, /<code class="qrurl">https:\/\/site\.app\/#\/join\/AbC_dE-fGh1234567890xy<\/code>/);
  assert.match(html, /data-qrcopy>Скопировать ссылку<\/button><button class="btn sm" type="button" data-qrsave>Сохранить QR<\/button>/);
  assert.match(html, /<p class="muted small qrnote">На одного человека, действует до 20\.11<\/p>/);
  assert.match(inviteBoxHTML(url, 'x'), /^<div class="qrbox">/);
  assert.match(inviteBoxHTML('https://a.b/?x=<i>', '<b>'), /<code class="qrurl">https:\/\/a\.b\/\?x=&lt;i&gt;<\/code>[\s\S]*&lt;b&gt;/);
  assert.match(QR_FILE, /\.png$/);
});

test('блок приглашения: адрес длиннее, чем помещается в код, остается ссылкой без картинки', () => {
  const long = `https://${'a'.repeat(200)}.example/#/join/AbC_dE-fGh1234567890xy`;
  const html = inviteBoxHTML(long, 'подпись');
  assert.doesNotMatch(html, /qrpic|<svg|data-qrsave/, 'картинки и кнопки «Сохранить QR» нет');
  assert.ok(html.includes(`<code class="qrurl">${long}</code>`), 'ссылка на месте: она показывается один раз');
  assert.match(html, /data-qrcopy>Скопировать ссылку<\/button>/);
});

// окно итога: в node нет окна, подменяем то, чем пользуется end.js
globalThis.addEventListener ??= () => {};
globalThis.scrollTo ??= () => {};
globalThis.document ??= { querySelector: () => null, createElement: () => ({ addEventListener() {}, remove() {} }) };
function fakeBox() {
  const on = {};
  const box = {
    hidden: true, innerHTML: '', dataset: {}, isConnected: true, on,
    classList: { toggle() {}, contains: () => false },
    querySelector(sel) {
      const id = sel.slice(1);
      return this.innerHTML.includes(`id="${id}"`) ? { addEventListener: (t, fn) => { on[id] = fn; } } : null;
    },
    parentElement: { querySelector: () => null, append() {} },
  };
  return box;
}
const seats = [{ id: 0, name: 'Гоша', hero: 'lion' }, { id: 1, name: 'Бот', hero: 'pot', kind: 'bot' }];
const result = { seats: [{ seatId: 0, place: 2, vector: [5], score: [5, 6, 7, 8], treasures: 0 }, { seatId: 1, place: 1, vector: [9], score: [9, 10, 11, 12], treasures: 0 }] };
const over = (step) => ({ code: 'STEP01', me: 0, status: 'over', seats, ...(step ? { step } : {}), game: { result, log: [], order: [0, 1], turn: 3, endReason: 'bag' } });

test('окно итога партии шага: строка про путь и главная кнопка «К пути новичка»', () => {
  const went = [];
  const ctl = { act: async () => null, go: (h) => went.push(h) };
  const box = fakeBox();
  renderEnd(box, over(1), ctl);
  assert.match(box.innerHTML, /<p class="steppath">Партия 1 из 3 пути новичка сыграна\. Дальше партия с двумя ботами\.<\/p>/);
  assert.match(box.innerHTML, /<button class="btn primary" id="ePath">К пути новичка<\/button>/);
  assert.doesNotMatch(box.innerHTML, /eAgain|В реванше тот же состав/, 'реванша у партии шага нет: он не был бы шагом');
  box.on.ePath();
  assert.deepEqual(went, ['#/']);
  const last = fakeBox();
  renderEnd(last, over(3), ctl);
  assert.match(last.innerHTML, /Путь новичка пройден/);
  assert.match(last.innerHTML, /<button class="btn primary" id="ePath">На главную<\/button>/);
  // обычная партия: ничего про путь, «Еще партию» главная
  const plain = fakeBox();
  renderEnd(plain, over(0), ctl);
  assert.doesNotMatch(plain.innerHTML, /steppath|ePath/);
  assert.match(plain.innerHTML, /<button class="btn primary" id="eAgain">Еще партию<\/button>/);
});

test('досрочно завершенная партия шага: сказано, что она не засчитана', () => {
  const box = fakeBox();
  renderEnd(box, { code: 'STEP02', me: 0, status: 'closed', seats, step: 2, game: { stopped: true } }, { act: async () => null, go: () => {} });
  assert.match(box.innerHTML, /Партия пути новичка не засчитана/);
  assert.match(box.innerHTML, /<button class="btn primary" id="ePath">К пути новичка<\/button>/);
  const plain = fakeBox();
  renderEnd(plain, { code: 'PLAIN1', me: 0, status: 'closed', seats, game: { stopped: true } }, { act: async () => null, go: () => {} });
  assert.doesNotMatch(plain.innerHTML, /steppath|ePath/);
});

test('страницы подключены: опрос перед сайтом, блок на главной, QR в «Кодах игроков» и в лобби', () => {
  const main = read('public/js/main.js');
  assert.match(main, /if \(needsSurvey\(s\)\)/, 'опрос стоит перед страницами');
  assert.ok(main.indexOf('if (jm) return renderJoin') < main.indexOf('if (needsSurvey(s))'), 'страница приглашения открывается раньше опроса');
  assert.match(main, /id="nPath"/);
  assert.match(main, /inviteBoxHTML\(url, linkNote\(r\)\)/);
  assert.match(main, /data-open=/);
  const lobby = read('public/js/lobby.js');
  assert.match(lobby, /inviteBoxHTML\(joinUrl\(m\.token\), linkNote\(m\), 'jnew'\)/);
  assert.match(lobby, /isNovice\(session\.get\(\)\?\.user\)/, 'новичку кнопку ссылки не показываем');
  const css = read('public/css/app.css');
  for (const cls of ['.qrbox', '.qrpic', '.npath', '.npi.np-locked', '.gcard.survey', '.steppath', '.pnote']) assert.ok(css.includes(cls), cls);
});

test('новость про QR-код и путь новичка есть, текст чистый', () => {
  const day = NEWS.find((d) => d.date === '2026-11-13');
  assert.ok(day.items.some((s) => s.includes('<b>Приглашение по QR-коду.</b>')));
  assert.ok(day.items.some((s) => s.includes('<b>Путь новичка.</b>')));
  for (const f of ['public/js/path-core.js', 'public/js/path.js', 'public/js/invite-box.js', 'public/js/qr.js', 'server/novice.js']) {
    assert.doesNotMatch(read(f), CLEAN, f);
  }
});
