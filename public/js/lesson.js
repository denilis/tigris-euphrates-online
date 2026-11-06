// Обучение: список уроков и экран урока. Урок рисует обычный экран партии, кадры заранее собраны
// настоящим движком (lessons/, tools/build-lessons.js), поэтому вход и сервер ему не нужны.
import { renderGame } from './game.js';
import { rulesTabs } from './rules.js';
import { judgeMove, stepView, nextLabel, handHint, loadDone, saveDone, LAST_LESSON } from './lesson-core.js';
import { whyNot } from './lesson-why.js';
import { esc } from './util.js';
import { TOURS } from './tours-data.js';
import { toursDone } from './tour.js';

const WATCH_NOTE = 'Сейчас режим просмотра: ход сделает урок. Нажмите «Дальше». Ходить самому можно в режиме «Играть самому».';
const PAUSE_MS = 350; // второй щелчок двойного нажатия не должен перескочить через шаг
const box = () => localStorage;
const minutes = (n) => `${n} ${n < 5 ? 'минуты' : 'минут'}`;

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url);
  return r.json();
}

/** Страница «Обучение». Открыта без входа, как и правила. */
export async function renderLearn(app, top, bindTop) {
  app.innerHTML = `<div class="page">${top}<main class="pcard rules">
    <h1>Обучение</h1>
    ${rulesTabs('learn')}
    <p class="muted">Короткие уроки на настоящем поле. В режиме «Смотреть» ходит сам урок и объясняет каждый шаг. В режиме «Играть самому» ходите вы, а наставник подсказывает и говорит, почему так, а не иначе. Уроки открыты без входа и в статистику не идут.</p>
    <ol class="lessons" id="lList"><li class="muted">Загружаем уроки</li></ol>
    <h2 class="tourhead">Как пользоваться сайтом</h2>
    <p class="muted">Короткие экскурсии по настоящим экранам: подсвечена кнопка, рядом объяснение, что она делает и что дает ее отключение. Нажимать можно, ничего не сломается.</p>
    <ol class="lessons tours">${toursHTML()}</ol>
  </main></div>`;
  bindTop();
  const el = app.querySelector('#lList');
  let list;
  try {
    list = await getJSON('/lessons/index.json');
  } catch {
    el.innerHTML = '<li class="muted">Не удалось загрузить уроки. Проверьте связь и обновите страницу.</li>';
    return;
  }
  const done = loadDone(box);
  el.innerHTML = list.map((l) => `<li class="litem">
    <img class="lcover" src="/img/lessons/${l.id}.webp" width="64" height="64" alt="">
    <div class="ltext"><b>${l.id}. ${esc(l.title)}</b>${done.has(l.id) ? ' <span class="ldone">пройден</span>' : ''}<span>${esc(l.goal)}</span><small>${minutes(l.minutes)}, ${l.steps} шагов</small></div>
    <div class="lacts"><a class="btn sm" href="#/learn/${l.id}/watch">Смотреть</a><a class="btn sm primary" href="#/learn/${l.id}/play">Играть самому</a></div>
  </li>`).join('');
}

/** Экскурсии по сайту (05.11): список на странице «Обучение»; значки в стиле обложек уроков (06.11). */
function toursHTML() {
  const done = toursDone();
  return TOURS.map((t) => `<li class="litem">
    <img class="lcover" src="/img/tours/${t.id}.webp" width="64" height="64" alt="">
    <div class="ltext"><b>${esc(t.title)}</b>${done.has(t.id) ? ' <span class="ldone">пройдена</span>' : ''}<span>${esc(t.goal)}</span><small>${minutes(t.minutes)}, ${t.steps.length} шагов</small></div>
    <div class="lacts"><a class="btn sm primary" href="#/learn/tour/${t.id}">Пройти</a></div>
  </li>`).join('');
}

/** Экран урока. mode: 'watch' ходит урок, 'play' ходит ученик. */
export async function openLesson(app, id, mode, { go }) {
  const hash = location.hash;
  app.innerHTML = '<div class="page"><main class="pcard"><p class="muted">Загружаем урок</p></main></div>';
  let lesson;
  try {
    lesson = await getJSON(`/lessons/${id}.json`);
  } catch {
    if (location.hash === hash) app.innerHTML = '<div class="page"><main class="pcard"><h1>Урок не загрузился</h1><p>Проверьте связь и обновите страницу.</p><a class="btn" href="#/learn">К списку уроков</a></main></div>';
    return;
  }
  if (location.hash !== hash) return; // пока грузился урок, игрок ушел на другую страницу
  app.innerHTML = '';

  const last = lesson.steps.length - 1;
  const panel = document.createElement('section');
  panel.className = 'lessonbox';
  let k = 0, note = '', calmAt = 0, seenSel = 'null';
  const calm = () => performance.now() >= calmAt;

  const drawPanel = () => {
    const s = lesson.steps[k];
    panel.innerHTML = `<div class="lsnhead"><b>Урок ${lesson.id}. ${esc(lesson.title)}</b><a href="#/learn">Все уроки</a></div>
      <div class="lprog"><span>Шаг ${k + 1} из ${last + 1}</span><i><u style="width:${Math.round(((k + 1) / (last + 1)) * 100)}%"></u></i></div>
      <h3>${esc(s.title)}</h3>
      <p>${esc(s.say)}</p>
      ${s.why ? `<p class="lwhy"><b>Почему так:</b> ${esc(s.why)}</p>` : ''}
      ${s.alt ? `<p class="lalt"><b>Можно иначе:</b> ${esc(s.alt)}</p>` : ''}
      ${note ? `<p class="lnote" role="status">${esc(note)}</p>` : ''}
      <div class="lbtns"><button class="btn" id="lBack"${k ? '' : ' disabled'}>Назад</button><button class="btn primary" id="lNext">${nextLabel(lesson, k, mode)}</button></div>`;
    panel.querySelector('#lBack').addEventListener('click', () => {
      if (!calm()) return;
      k--;
      note = '';
      show();
    });
    panel.querySelector('#lNext').addEventListener('click', () => { if (calm()) next(); });
  };

  const say = (text) => {
    note = text;
    drawPanel();
    panel.scrollIntoView({ block: 'nearest' });
  };

  /** Нажата клетка, куда выбранное поставить нельзя. sel undefined: сейчас решение не про выбор из руки. */
  const miss = (sel, cell) => {
    if (!calm()) return;
    if (mode === 'watch') say(WATCH_NOTE);
    else if (sel === undefined) say('Сделайте то, что написано на панели урока.');
    else say(whyNot(stepView(lesson, k), sel, cell) || 'Сейчас нужен другой ход, он подсвечен.');
  };

  /** Игрок выбрал другое: прежнее объяснение уже не к месту. */
  const selected = (sel) => {
    const key = JSON.stringify(sel);
    if (key === seenSel) return;
    seenSel = key;
    if (note) { note = ''; drawPanel(); }
  };

  /** Игрок сделал ход на настоящем экране партии: сюда он приходит вместо запроса к серверу. */
  const act = async (body) => {
    const step = lesson.steps[k];
    const move = body.action === 'move' ? step.game.legal?.[body.index] : null;
    if (!move || !calm()) return null;
    if (mode === 'watch') { say(WATCH_NOTE); return null; }
    const why = judgeMove(step, move);
    if (why) say(why);
    else next();
    return null;
  };

  function next() {
    if (k < last) {
      k++;
      note = '';
      show();
    } else {
      go(lesson.id < LAST_LESSON ? `#/learn/${lesson.id + 1}/${mode}` : '#/learn');
    }
  }

  function show() {
    const s = lesson.steps[k];
    if (k === last) saveDone(box, lesson.id);
    calmAt = performance.now() + PAUSE_MS;
    drawPanel();
    renderGame(app, stepView(lesson, k), { act, go, lesson: { panel, cells: s.cells || [], pick: s.pick || null, hint: handHint(s, mode), miss, selected } });
  }

  show();
  scrollTo(0, 0);
}
