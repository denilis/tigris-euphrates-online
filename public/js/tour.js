// Экскурсия по сайту (просьба Дениса 05.11, схема одобрена): настоящий экран (учебный стол, кадр
// урока, карта статистики), затемнение с окном вокруг элемента шага и карточка с объяснением.
// Нажимать можно: учебный стол меняет настройки у себя, ходы и приглашения никуда не уходят.
// Шаги и тексты в tours-data.js. Пройденные экскурсии помнит localStorage tigris.tours.
import { renderLobby } from './lobby.js';
import { renderGame } from './game.js';
import { stepView } from './lesson-core.js';
import { tourById, TOUR_GAME_FRAME } from './tours-data.js';
import { esc, toast } from './util.js';

const DONE_KEY = 'tigris.tours';
const QUIET = 'В экскурсии это только показ: на сервер ничего не уходит.';
const QUIET_GAME = 'В экскурсии ходы не делаются. Сыграть можно в уроках «Как играть».';

export function toursDone() {
  try { return new Set(JSON.parse(localStorage.getItem(DONE_KEY) || '[]')); } catch { return new Set(); }
}
function markDone(id) {
  const s = toursDone();
  s.add(id);
  try { localStorage.setItem(DONE_KEY, JSON.stringify([...s])); } catch { /* без памяти */ }
}

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url);
  return r.json();
}

// карта статистики: где что лежит; ссылки только тем, кто вошел
const MAP = [
  ['mapEnd', 'Итог партии', 'Открывается сам в конце партии.', 'Места, очки по цветам и сокровища, статистика партии, «Картинка итога» для чата, кнопка «Еще партию».', null],
  ['mapReplay', 'Просмотр по ходам', 'Итог партии, кнопка «Просмотр по ходам». Или «Мои столы», кнопка «Просмотр».', 'Кадры партии с паузой и скоростью, метки боев и монументов, рост очков, бои и монументы на каждый момент.', null],
  ['mapAnalysis', 'Разбор партии ботом', 'Итог партии, кнопка «Разобрать партию».', 'Точность каждого человека, до пяти главных ошибок с лучшим ходом, переход на этот момент партии.', null],
  ['mapTours', 'Турниры', 'Меню «Статистика», вкладка «Турниры».', 'Таблица и пьедестал турнира, графики очков и мест, бои, откуда очки, рекорды и награды, все партии.', '#/stats'],
  ['mapMe', 'Личная статистика', 'Меню «Статистика», вкладка «Личная».', 'Ваши партии с людьми, с ботами и на BGA: победы и места, откуда очки, вы и соперники, динамика по месяцам, рекорды.', '#/stats/me'],
  ['mapTables', 'Мои столы', 'Меню «Мои столы».', 'Все ваши столы: идущие, ждущие игроков и законченные. У законченных «Просмотр».', '#/tables'],
];

function mapHTML(bar, loggedIn) {
  return `<div class="page">${bar}<main class="pcard tourmap">
    <h1>Где статистика</h1>
    <p class="muted">Карта разделов со статистикой и разбором партий. Экскурсия пройдет по ней по порядку.</p>
    <div class="tmap">${MAP.map(([id, t, where, what, href]) => `<section class="tmcard" id="${id}">
      <h3>${t}</h3><p class="tmwhere"><b>Где:</b> ${where}</p><p>${what}</p>
      ${href && loggedIn ? `<a class="btn sm" href="${href}">Открыть</a>` : ''}
    </section>`).join('')}</div>
  </main></div>`;
}

/** Экскурсия id на экране app. bar и bindTop: верхнее меню сайта, как у уроков. */
export async function openTour(app, id, { go, bar, bindTop, loggedIn = false }) {
  const tour = tourById(id);
  if (!tour) return go('#/learn');
  const hash = location.hash;
  app.innerHTML = '<div class="page"><main class="pcard"><p class="muted">Загружаем экскурсию</p></main></div>';
  let layer = null;
  try {
    if (tour.screen === 'lobby') {
      const view = await getJSON('/lessons/tour-lobby.json');
      if (location.hash !== hash) return;
      // учебный стол: вид и настройки бота меняются у себя, остальное только показ
      const act = async (b) => {
        if (b.action === 'options') Object.assign(view.options, b.options);
        else if (b.action === 'bot') {
          const s = view.seats.find((x) => x.id === b.seat);
          if (s?.bot) Object.assign(s.bot, b.settings);
        } else return toast(QUIET);
        draw();
      };
      const draw = () => {
        renderLobby(app, view, { act, bar, bindBar: bindTop, tour: true }); // в экскурсии ссылку новичку не создаем
        layer?.place();
      };
      draw();
    } else if (tour.screen === 'game') {
      const lesson = await getJSON(`/lessons/${TOUR_GAME_FRAME.lesson}.json`);
      if (location.hash !== hash) return;
      app.innerHTML = '';
      renderGame(app, stepView(lesson, TOUR_GAME_FRAME.step), { act: () => toast(QUIET_GAME), go, tour: true });
    } else {
      app.innerHTML = mapHTML(bar, loggedIn);
      bindTop();
    }
  } catch {
    if (location.hash === hash) app.innerHTML = '<div class="page"><main class="pcard"><h1>Экскурсия не загрузилась</h1><p>Проверьте связь и обновите страницу.</p><a class="btn" href="#/learn">К обучению</a></main></div>';
    return;
  }
  layer = mountLayer(tour, () => { markDone(tour.id); go('#/learn'); });
}

/** Затемнение и карточка шага. finish: последний шаг пройден. */
function mountLayer(tour, finish) {
  document.getElementById('tourLayer')?._close();
  const el = document.createElement('div');
  el.id = 'tourLayer';
  el.className = 'tlayer';
  // затемнение четырьмя полосами вокруг окна: огромная тень у кольца рисуется не везде
  el.innerHTML = '<div class="tdim"></div><div class="tdim"></div><div class="tdim"></div><div class="tdim"></div><div class="tspot" hidden></div><div class="tcard" role="dialog" aria-label="Экскурсия"></div>';
  const dims = [...el.querySelectorAll('.tdim')], spot = el.querySelector('.tspot'), card = el.querySelector('.tcard');
  const box = (d, x, y, w, h) => Object.assign(d.style, { left: `${x}px`, top: `${y}px`, width: `${Math.max(0, w)}px`, height: `${Math.max(0, h)}px` });
  const last = tour.steps.length - 1;
  let k = 0;

  const target = () => {
    const sel = tour.steps[k].sel;
    const t = sel ? document.querySelector(sel) : null;
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return r.width || r.height ? t : null;
  };
  const place = () => {
    if (!el.isConnected) return;
    const t = target();
    card.classList.remove('up', 'mid');
    const W = innerWidth, H = innerHeight;
    if (!t) {
      spot.hidden = true;
      box(dims[0], 0, 0, W, H);
      for (const d of dims.slice(1)) box(d, 0, 0, 0, 0);
      card.classList.add('mid');
      return;
    }
    const r = t.getBoundingClientRect(), pad = 6;
    const x1 = Math.max(0, r.left - pad), y1 = Math.max(0, r.top - pad), x2 = Math.min(W, r.right + pad), y2 = Math.min(H, r.bottom + pad);
    box(dims[0], 0, 0, W, y1);
    box(dims[1], 0, y2, W, H - y2);
    box(dims[2], 0, y1, x1, y2 - y1);
    box(dims[3], x2, y1, W - x2, y2 - y1);
    spot.hidden = false;
    box(spot, x1, y1, x2 - x1, y2 - y1);
    // карточка там, где не закрывает подсвеченное
    if (r.top + r.height / 2 > innerHeight * 0.55) card.classList.add('up');
  };
  const show = () => {
    const s = tour.steps[k];
    card.innerHTML = `<div class="tchead"><span>${esc(tour.title)}</span><span>Шаг ${k + 1} из ${last + 1}</span></div>
      <h3>${esc(s.title)}</h3><p>${esc(s.say)}</p>${s.try ? `<p class="ttry"><b>Попробуйте:</b> ${esc(s.try)}</p>` : ''}
      <div class="tbtns"><button class="linkbtn" data-tend type="button">Закончить</button><span></span>
        <button class="btn" data-tback type="button" ${k ? '' : 'disabled'}>Назад</button>
        <button class="btn primary" data-tnext type="button">${k === last ? 'Готово' : 'Дальше'}</button></div>`;
    target()?.scrollIntoView({ block: 'center', inline: 'nearest' });
    place();
    requestAnimationFrame(place);
  };
  const next = () => (k === last ? finish() : (k++, show()));
  const back = () => { if (k) { k--; show(); } };
  card.addEventListener('click', (e) => {
    if (e.target.closest('[data-tnext]')) next();
    else if (e.target.closest('[data-tback]')) back();
    else if (e.target.closest('[data-tend]')) location.hash = '#/learn';
  });
  const key = (e) => {
    if (e.target.closest?.('input,select,textarea') || document.getElementById('botGuide')) return;
    if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') back();
    else if (e.key === 'Escape') location.hash = '#/learn';
  };
  let frame = 0;
  const later = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
  const close = () => {
    removeEventListener('hashchange', close);
    removeEventListener('resize', later);
    removeEventListener('scroll', later, true);
    removeEventListener('keydown', key);
    el.remove();
  };
  el._close = close;
  addEventListener('hashchange', close);
  addEventListener('resize', later);
  addEventListener('scroll', later, true);
  addEventListener('keydown', key);
  document.body.append(el);
  show();
  return { place: later };
}
