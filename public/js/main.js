// Точка входа: окно активации, мои столы, стол (лобби или партия), коды игроков.
// Адреса: #/ мои столы, #/t/КОД стол, #/rules правила (без входа), #/learn обучение (без входа),
// #/stats статистика, #/admin коды (администраторы), #/t/КОД/replay просмотр партии по ходам.
import { api, session, watchTable } from './api.js';
import { renderLobby, closePicker } from './lobby.js';
import { renderGame } from './game.js';
import { renderStats } from './stats.js';
import { renderPersonal } from './personal-view.js';
import { renderReplay } from './replay.js';
import { welcomeHTML } from './welcome.js';
import { renderRules } from './rules.js';
import { renderLearn, openLesson } from './lesson.js';
import { openTour } from './tour.js';
import { renderProfile } from './profile.js';
import { startPresence, stopPresence, setBusy, takeAccepted, mountOnline } from './presence.js';
import { freeSeat, deleteQuestion } from './online.js';
import { deletionsHTML, bindRestore } from './deletions.js';
import { SCENES, pickScene } from './scene.js';
import { esc, toast, copy, faceBg, botFace } from './util.js';
import { USER_SORTS, defaultDir, pickUsers, inviters, dayText, dateText } from './admin-list.js';
import { openBotGuide } from './bots-info.js';
import { renderJoin } from './join.js';
import { JOIN_ROUTE, joinUrl, linkNote, linkLine } from './join-link.js';

const app = document.getElementById('app');
const backdrop = document.getElementById('backdrop');
let watcher = null;

const bgToggle = document.getElementById('bgToggle');
const STILL_KEY = 'tigris.backdrop.still'; // выбор на этом устройстве: неподвижная картинка вместо ролика
const BACK_SPEED = 0.8;
// летняя и зимняя сцены по очереди (04.11): картинка до запуска ролика и фон без ролика
const SCENE = SCENES[pickScene()];
backdrop.poster = SCENE.img;
document.documentElement.style.setProperty('--backimg', `url(${SCENE.img})`);

/** Сохраненный выбор; без него неподвижная картинка у тех, кто просил систему меньше анимации. */
function loadStill() {
  try {
    const saved = localStorage.getItem(STILL_KEY);
    if (saved !== null) return saved === '1';
  } catch { /* приватный режим: живем без памяти */ }
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let still = loadStill(), backdropOn = true;
backdrop.defaultPlaybackRate = BACK_SPEED; // при загрузке playbackRate сбрасывается к этому значению
backdrop.playbackRate = BACK_SPEED;

/**
 * Ролик-заставка на всех экранах, кроме партии. Не запустился, остается картинка из poster.
 * У зимней сцены ролика нет: неподвижная картинка и без кнопки видео.
 */
function setBackdrop(on) {
  backdropOn = on;
  const moving = !still && Boolean(SCENE.video);
  backdrop.hidden = !on || !moving;
  bgToggle.hidden = !on || !SCENE.video;
  bgToggle.textContent = still ? 'Включить видео' : 'Остановить видео';
  document.body.classList.toggle('stillbg', on && !moving);
  if (!on || !moving) return backdrop.pause();
  if (!backdrop.src) backdrop.src = SCENE.video; // ролик качаем, только когда он нужен
  backdrop.play().catch(() => {});
}

bgToggle.addEventListener('click', () => {
  still = !still;
  try { localStorage.setItem(STILL_KEY, still ? '1' : '0'); } catch { /* приватный режим: живем без памяти */ }
  setBackdrop(backdropOn);
});

const go = (hash) => { location.hash = hash; };

function topbar(active) {
  const u = session.get()?.user;
  return `<header class="bar">
    <a class="brand" href="#/">Тигр и Евфрат</a>
    <nav>
      <a href="#/new" class="newgame${active === 'new' ? ' on' : ''}">Начать игру</a>
      <a href="#/tables" class="${active === 'tables' ? 'on' : ''}">Мои столы</a>
      <a href="#/stats" class="${active === 'stats' ? 'on' : ''}">Статистика</a>
      <a href="#/rules" class="${active === 'rules' ? 'on' : ''}">Правила</a>
      <a href="#/learn" class="${active === 'learn' ? 'on' : ''}">Обучение</a>
      ${u ? `<a href="#/admin" class="${active === 'admin' ? 'on' : ''}">Коды игроков</a>` : ''}
      <a class="me" href="#/me" title="Мой профиль">${u?.avatar ? `<i class="face" style="background-image:${faceBg(u)}"></i>` : ''}${esc(u?.name || '')}</a>
      <button class="linkbtn" id="logout">Выйти</button>
    </nav>
  </header>`;
}

// шапка для тех, кто читает правила без входа
const GUEST_BAR = `<header class="bar"><a class="brand" href="#/">Тигр и Евфрат</a><nav><a href="#/rules">Правила</a><a href="#/learn">Обучение</a><a href="#/">Войти</a></nav></header>`;

function bindTopbar() {
  app.querySelector('#logout')?.addEventListener('click', () => {
    if (!confirm('Выйти на этом устройстве? Потом понадобится код снова.')) return;
    session.clear();
    route();
  });
}

// --- окно активации

function renderActivate() {
  app.innerHTML = `<div class="gate">
    <form class="gcard" id="actForm" autocomplete="off">
      <h1>Тигр и Евфрат</h1>
      <p>Стол для своей компании. Введите личный код: его дает игрок, который вас пригласил, или вы получаете его сами по ссылке-приглашению. Код нужен один раз на устройстве, вход запоминается на 90 дней.</p>
      <input id="actCode" placeholder="XXXX-XXXX-XXXX" autocapitalize="characters" spellcheck="false" aria-label="Личный код">
      <button class="btn primary" type="submit">Войти</button>
      <p class="err" id="actErr" role="alert"></p>
      <a class="glink" href="#/rules">Правила игры</a>
      <a class="glink" href="#/learn">Обучение</a>
    </form>
  </div>`;
  const input = app.querySelector('#actCode');
  input.focus();
  app.querySelector('#actForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = app.querySelector('#actErr');
    err.textContent = '';
    try {
      const r = await api('POST', 'activate', { code: input.value });
      session.set(r);
      route();
    } catch (ex) {
      err.textContent = ex.code === 'bad-code' ? 'Код не подошел. Проверьте и попробуйте еще раз.' : ex.message;
    }
  });
}

// --- мои столы

/** Удалить стол и обновить список на экране. Что можно удалять, решает сервер (флаг del в «Моих столах»). */
let removing = false;
async function removeTable(t, done) {
  if (removing || !confirm(deleteQuestion(t, session.get()?.user?.name))) return;
  removing = true; // повторное нажатие не должно спрашивать и удалять второй раз
  try {
    await api('POST', `tables/${t.code}/delete`);
    toast('Стол удален');
  } catch (e) { toast(e.message); }
  removing = false;
  done();
}

const seatName = (s) => s.name || (s.kind === 'bot' ? 'Бот' : 'свободно');

const STATUS = { lobby: 'собирается', playing: 'идет партия', over: 'партия окончена', closed: 'партия завершена досрочно' };

/**
 * «Начать игру» (просьба Дениса 04.11: отдельной кнопкой, а «Мои столы» только список): стол с людьми,
 * которые сейчас на сайте, стол с ботами или стол по коду из приглашения. Вид «Три ворот» (схема
 * одобрена Денисом 04.11): глиняная табличка, как главная, три арки со сценами (картины Дениса 04.11:
 * нарисованы вытянутыми арками, на сайт взята середина сцены кадром 4:3, рамку рисует CSS).
 */
const GATE_ART = ['people', 'bots', 'code'];
// под текстом «С ботами» лица ботов в стиле игроков (просьба Дениса 04.11)
const GATE_BOTS = [['andrey', 'Бот в стиле Андрея'], ['vlad', 'Бот в стиле Влада'], ['denis', 'Бот в стиле Дениса']];

function renderNew() {
  const art = (k) => `<div class="ngart" aria-hidden="true"><img class="scene ${k}" src="/img/newgame/${GATE_ART.includes(k) ? k : 'people'}.webp" alt=""></div>`;
  app.innerHTML = `<div class="page">${topbar('new')}<div class="lobby"><div class="lcard clay newgame">
    <div class="band top" aria-hidden="true"></div>
    <h1>Начать игру</h1>
    <div class="ngates">
      <section class="ngate">${art('people')}
        <h2>С людьми</h2>
        <p class="muted">Отметьте, кого позвать: стол создастся, они получат приглашение. Партию начнете вы, когда все будут за столом.</p>
        <section class="online" id="onlineBox"></section>
        <div class="ngact"><button class="btn" id="newEmpty">Пустой стол</button><span class="muted small">позвать позже ссылкой или из лобби</span></div>
      </section>
      <section class="ngate">${art('bots')}
        <h2>С ботами</h2>
        <p class="muted">Вы и три бота. Число мест, силу ботов и правила можно поменять в лобби.</p>
        <div class="ngfaces">${GATE_BOTS.map(([s, t]) => `<i class="face" title="${t}" style="background-image:url(${botFace({ kind: 'bot', bot: { style: s } })})"></i>`).join('')}</div>
        <div class="ngact mid"><button class="seal" id="newBots">Стол с ботами</button><button class="linkbtn" id="botGuide" type="button">Какого бота выбрать?</button></div>
      </section>
      <section class="ngate">${art('code')}
        <h2>По коду</h2>
        <p class="muted">Код стола из приглашения или ссылки.</p>
        <form id="joinForm" class="join ngact"><input id="joinCode" placeholder="Код стола" maxlength="6" autocapitalize="characters" spellcheck="false" aria-label="Код стола"><button class="btn" type="submit">Открыть</button></form>
      </section>
    </div>
    <div class="band bot" aria-hidden="true"></div>
  </div></div></div>`;
  bindTopbar();
  const open = (code) => {
    scrollTo(0, 0); // кнопки внизу страницы: без этого лобби открылось бы прокрученным
    go(`#/t/${code}`);
  };
  mountOnline(app.querySelector('#onlineBox'), {
    count: true,
    button: 'Создать стол и пригласить выбранных',
    onSend: async (ids) => {
      const r = await api('POST', 'tables');
      await api('POST', 'invite', { code: r.code, to: ids });
      open(r.code);
    },
  });
  const make = async (b, fill) => {
    b.disabled = true; // двойное нажатие завело бы два стола
    try {
      const r = await api('POST', 'tables');
      if (fill) await fill(r.code);
      open(r.code);
    } catch (e) {
      toast(e.message);
      b.disabled = false;
    }
  };
  app.querySelector('#newEmpty').addEventListener('click', (e) => make(e.currentTarget));
  app.querySelector('#botGuide').addEventListener('click', () => openBotGuide('universal'));
  app.querySelector('#newBots').addEventListener('click', (e) => make(e.currentTarget, async (code) => {
    for (const seat of [1, 2]) await api('POST', `tables/${code}`, { action: 'seatKind', seat, kind: 'bot' });
  }));
  app.querySelector('#joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const c = app.querySelector('#joinCode').value.trim().toUpperCase();
    if (c) open(c);
  });
}

/**
 * Главная (просьба Дениса 04.11, схема из сессии этапов 3-5): глиняная табличка с приветствием и
 * шестью разделами, без списка столов. Если где-то ждут хода игрока, на «Моих столах» метка.
 */
async function renderStart() {
  app.innerHTML = `<div class="page">${topbar('')}<div class="lobby"><div class="lcard clay start">
    <div class="band top" aria-hidden="true"></div>
    ${welcomeHTML(session.get()?.user)}
    <div class="band bot" aria-hidden="true"></div>
  </div></div></div>`;
  bindTopbar();
  let list;
  try { list = await api('GET', 'tables'); } catch { return; } // метка не главное: главная работает и без нее
  const n = list.filter((t) => t.status === 'playing' && !t.paused && t.me != null && t.toMove === t.me).length;
  const card = app.querySelector('.wlink[href="#/tables"] b');
  if (card && n) card.insertAdjacentHTML('beforeend', ` <em class="wturn">ваш ход: ${n}</em>`);
}

/** «Мои столы» (#/tables): все партии игрока. */
async function renderHome() {
  app.innerHTML = `<div class="page">${topbar('tables')}<main class="pcard">
    <div class="homehead"><h1>Мои столы</h1><a class="btn primary" href="#/new">Начать игру</a></div>
    <div id="tables" class="tables"><p class="muted">Загружаю...</p></div>
    <div id="myDel"></div>
  </main></div>`;
  bindTopbar();
  const load = async () => {
    try {
      const list = await api('GET', 'tables');
      const el = app.querySelector('#tables');
      if (!el) return;
      el.innerHTML = list.length ? list.map((t, i) => {
        const myTurn = t.status === 'playing' && t.me != null && t.toMove === t.me;
        const del = Boolean(t.del); // свой стол с ботами всегда, стол с людьми только администратору (04.11)
        return `<a class="titem${myTurn ? ' turn' : ''}${del ? ' del' : ''}" href="#/t/${esc(t.code)}">
          <b>${esc(t.title || t.code)}</b>
          <span>${t.seats.map((s) => esc(seatName(s))).join(', ')}</span>
          <small>${t.paused ? 'на паузе' : STATUS[t.status] || ''}${myTurn && !t.paused ? ', ваш ход' : ''}${t.next ? ', есть реванш' : ''}</small>
          ${t.replay || del ? `<span class="tacts">${t.replay ? `<button class="btn sm" data-replay="${esc(t.code)}" type="button">Просмотр</button>` : ''}${del ? `<button class="btn sm" data-del="${i}" type="button">Удалить</button>` : ''}</span>` : ''}
        </a>`;
      }).join('') : '<p class="muted">Пока нет столов. Новую партию собирают на странице «Начать игру».</p>';
      el.querySelectorAll('[data-replay]').forEach((b) => b.addEventListener('click', (e) => {
        e.preventDefault(); // кнопка внутри ссылки на стол
        go(`#/t/${b.dataset.replay}/replay`);
      }));
      el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', (e) => {
        e.preventDefault(); // кнопка внутри ссылки на стол
        removeTable(list[+b.dataset.del], load);
      }));
      await loadMyDel(load);
    } catch (e) { toast(e.message); }
  };
  await load();
}

/** «Удаленные мной (N)» под «Моими столами» (04.11): свои удаления и кнопка «Вернуть». */
let myDelOpen = false;
async function loadMyDel(reload) {
  const me = session.get()?.user?.id;
  const list = (await api('GET', 'deletions')).filter((e) => e.by === me);
  const box = app.querySelector('#myDel');
  if (!box) return;
  const n = list.filter((e) => e.canRestore).length;
  box.innerHTML = list.length ? `<p class="small"><button class="linkbtn" id="myDelBtn" type="button" aria-expanded="${myDelOpen}">Удаленные мной (${n})</button></p>
    <div class="tables" id="myDelList" ${myDelOpen ? '' : 'hidden'}>${deletionsHTML(list)}</div>` : '';
  box.querySelector('#myDelBtn')?.addEventListener('click', (e) => {
    myDelOpen = !myDelOpen;
    e.currentTarget.setAttribute('aria-expanded', String(myDelOpen));
    box.querySelector('#myDelList').hidden = !myDelOpen;
  });
  bindRestore(box, { api, toast, done: reload });
}

// --- стол

function openTable(code) {
  const act = async (body) => {
    try {
      const v = await api('POST', `tables/${code}`, body);
      watcher?.apply(v);
      return v;
    } catch (e) {
      toast(e.message);
      if (e.status === 409) watcher?.refresh();
      return null;
    }
  };
  // принятое приглашение: сесть на первое свободное место
  const sitInvited = (v) => {
    if (v.me != null) return;
    if (v.status !== 'lobby') return toast('Партия уже началась');
    const seat = freeSeat(v);
    if (seat === null) return toast('За столом нет мест');
    act({ action: 'sit', seat });
  };
  let mode = null;
  watcher = watchTable(code, (v) => {
    const m = v.status === 'lobby' ? 'lobby' : 'game';
    if (m !== mode) { closePicker(); app.innerHTML = ''; mode = m; }
    setBusy(v.status === 'playing' && v.me != null);
    setBackdrop(m === 'lobby');
    if (m === 'lobby') renderLobby(app, v, { act, go, bar: topbar(''), bindBar: bindTopbar });
    else renderGame(app, v, { act, go });
    if (takeAccepted(code)) sitInvited(v);
  }, (e) => {
    if (e.status === 404) {
      closePicker(); // стол могли удалить, пока было открыто окно выбора игроков
      app.innerHTML = `<div class="page">${topbar('')}<main class="pcard"><h1>Стола ${esc(code)} нет</h1><p>Возможно, его удалили. Проверьте код в приглашении.</p><a class="btn" href="#/tables">К моим столам</a></main></div>`;
      bindTopbar();
      watcher?.stop();
    } else if (e.code !== 'network') toast(e.message);
  });
}

// --- коды игроков (администраторы)

async function renderAdmin() {
  // роли (04.11): администратор видит всех и отзывает коды; игрок заводит новых и видит приглашенных им
  const admin = Boolean(session.get()?.user?.admin);
  app.innerHTML = `<div class="page">${topbar('admin')}<main class="pcard">
    <h1>Коды игроков</h1>
    <p class="muted">${admin
      ? 'Каждому игроку свой код. Код показывается один раз: сразу отправьте его игроку. Отозванный код перестает работать на всех устройствах.'
      : 'Пригласите нового игрока: впишите его имя, и он получит свой код для входа. Код показывается один раз: сразу отправьте его игроку. Ниже вы и те, кого вы пригласили.'} Свой код: от 8 до 20 латинских букв и цифр. Такой код легче угадать, чем случайный.</p>
    <form id="newUser" class="join"><input id="newName" placeholder="Имя нового игрока" maxlength="30" aria-label="Имя нового игрока"><input id="newPin" placeholder="Код (пусто = случайный)" maxlength="32" autocapitalize="characters" spellcheck="false" autocomplete="off" aria-label="Свой код"><label class="chk" id="newAdminBox" hidden><input type="checkbox" id="newAdmin"> администратор</label><button class="btn primary" type="submit">Выдать код</button></form>
    <div id="newCode"></div>
    <div class="jlinks"><span class="muted">Или ссылкой: новичок сам впишет имя, получит код и сразу войдет.</span><button class="btn sm" id="newLink" type="button">Создать ссылку-приглашение</button></div>
    <div id="newLinkBox"></div>
    <div id="linkList"></div>
    <h2 id="uHead">Игроки</h2>
    <div class="uctl">
      <input id="uq" type="search" placeholder="Поиск по имени" aria-label="Поиск по имени" autocomplete="off">
      <label>Сортировка <select id="usort">${USER_SORTS.map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
      <label id="ubyBox" hidden>Пригласил <select id="uby"></select></label>
      <label class="chk" id="urevBox" hidden><input type="checkbox" id="urev"> <span>Показывать отозванных (<span id="urevN">0</span>)</span></label>
    </div>
    <div class="ulistw"><table class="ulist"><thead><tr>
      <th><button class="linkbtn" data-usort="name" type="button">Имя</button></th>${admin ? '<th>Пригласил</th>' : ''}
      <th><button class="linkbtn" data-usort="created" type="button">Добавлен</button></th>
      <th><button class="linkbtn" data-usort="games" type="button">Партий</button></th>
      <th><button class="linkbtn" data-usort="last" type="button">Последняя</button></th>
      <th>Код</th><th></th>
    </tr></thead><tbody id="users"></tbody></table></div>
    ${admin ? `<h2>Открытые столы всех игроков</h2>
    <p class="muted">Здесь столы, где партия не начиналась, из последних 20 столов каждого игрока.</p>
    <div id="openTables" class="tables"></div>
    <h2>Журнал удалений</h2>
    <p class="muted">Все удаления и возвраты столов, новые сверху. Удаленный стол хранится 90 дней: за это время его можно вернуть.</p>
    <div id="delLog" class="tables"></div>` : ''}
  </main></div>`;
  bindTopbar();
  const showCode = (name, code) => {
    app.querySelector('#newCode').innerHTML = `<div class="codebox"><span>Код для ${esc(name)}:</span><code>${esc(code)}</code><button class="btn sm" id="cpCode">Скопировать</button></div>`;
    app.querySelector('#cpCode').addEventListener('click', () => copy(code));
  };
  // список (Денис 05.11): поиск, сортировка, отозванные по желанию, у администратора отбор по пригласившему
  const $ = (id) => app.querySelector(id);
  // ссылки-приглашения (Денис 06.11): новая показывается один раз, ниже действующие с отзывом
  const drawLinks = (list) => {
    $('#linkList').innerHTML = list.length ? `<p class="muted small">Ссылки, по которым еще не зарегистрировались (${list.length}):</p>
      <ul class="jlist">${list.map((x) => `<li>${esc(linkLine(x))} <button class="linkbtn" data-unlink="${esc(x.id)}" type="button">Отозвать</button></li>`).join('')}</ul>` : '';
  };
  const loadLinks = () => api('GET', 'joinlinks').then(drawLinks).catch(() => {});
  $('#newLink').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const r = await api('POST', 'joinlinks', {});
      const url = joinUrl(r.token);
      $('#newLinkBox').innerHTML = `<div class="codebox"><span>Ссылка-приглашение:</span><code class="jurl">${esc(url)}</code><button class="btn sm" id="cpLink" type="button">Скопировать</button></div><p class="muted small">${esc(linkNote(r))}</p>`;
      $('#cpLink').addEventListener('click', () => copy(url));
      loadLinks();
    } catch (ex) { toast(ex.message); } finally { b.disabled = false; }
  });
  $('#linkList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-unlink]');
    if (!b) return;
    b.disabled = true;
    try {
      await api('POST', `joinlinks/${b.dataset.unlink}/revoke`, {});
      loadLinks();
    } catch (ex) { toast(ex.message); b.disabled = false; }
  });
  loadLinks();
  const st = { q: '', sort: 'created', dir: defaultDir('created'), revoked: false, by: '' };
  let users = [], iAmMain = false;
  const row = (u) => {
    const flag = u.main ? '' : iAmMain ? `<label class="chk"><input type="checkbox" data-admin="${esc(u.id)}" ${u.admin ? 'checked' : ''}> администратор</label>` : u.admin ? '<span class="muted">администратор</span>' : '';
    const may = !u.self && !u.main && (iAmMain || !u.admin);
    return `<tr class="${u.self ? 'me' : ''}${u.revoked ? ' off' : ''}">
      <td data-l="Имя"><b>${esc(u.name)}</b>${u.self ? ' <span class="muted">(вы)</span>' : ''}</td>${admin ? `<td data-l="Пригласил">${esc(u.invitedBy || '-')}</td>` : ''}
      <td data-l="Добавлен">${dateText(u.createdAt)}</td>
      <td data-l="Партий">${u.games}</td>
      <td data-l="Последняя">${dayText(u.lastGameAt)}</td>
      <td data-l="Код"><span>${u.main ? 'главный' : u.revoked ? 'отозван' : 'действует'}</span>${flag}</td>
      <td class="uacts">${may ? `<div class="ubtns"><button class="btn sm" data-new="${esc(u.id)}" data-name="${esc(u.name)}">Новый код</button>${u.revoked || !admin ? '' : `<button class="btn sm" data-revoke="${esc(u.id)}">Отозвать</button>`}</div>` : ''}</td>
    </tr>`;
  };
  const draw = () => {
    const list = pickUsers(users, st);
    const off = users.filter((u) => u.revoked && !u.self).length;
    $('#uHead').textContent = `${admin ? 'Все игроки' : 'Игроки'} (${users.length})`;
    $('#urevBox').hidden = !off;
    $('#urevN').textContent = off;
    $('#usort').value = st.sort;
    app.querySelectorAll('[data-usort]').forEach((b) => b.classList.toggle('on', b.dataset.usort === st.sort));
    $('#users').innerHTML = list.length ? list.map(row).join('')
      : `<tr><td colspan="${admin ? 7 : 6}" class="muted">${users.length > 1 || st.q ? 'Никого не нашлось.' : admin ? 'Игроков пока нет.' : 'Вы пока никого не пригласили.'}</td></tr>`;
  };
  const load = async () => {
    users = await api('GET', 'admin/users');
    iAmMain = Boolean(users.find((u) => u.self)?.main);
    $('#newAdminBox').hidden = !iAmMain;
    if (admin) {
      const by = inviters(users);
      if (st.by && !by.includes(st.by)) st.by = '';
      $('#ubyBox').hidden = by.length < 2;
      $('#uby').innerHTML = `<option value="">Все</option>${by.map((n) => `<option ${n === st.by ? 'selected' : ''}>${esc(n)}</option>`).join('')}`;
    }
    draw();
  };
  $('#uq').addEventListener('input', (e) => { st.q = e.target.value; draw(); });
  $('#usort').addEventListener('change', (e) => { st.sort = e.target.value; st.dir = defaultDir(st.sort); draw(); });
  $('#uby').addEventListener('change', (e) => { st.by = e.target.value; draw(); });
  $('#urev').addEventListener('change', (e) => { st.revoked = e.target.checked; draw(); });
  app.querySelectorAll('[data-usort]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.usort;
    st.dir = st.sort === k ? -st.dir : defaultDir(k);
    st.sort = k;
    draw();
  }));
  const box = $('#users');
  box.addEventListener('change', async (e) => {
    const b = e.target.closest('[data-admin]');
    if (!b) return;
    await api('POST', `admin/users/${b.dataset.admin}/admin`, { admin: b.checked }).catch((ex) => toast(ex.message));
    load();
  });
  box.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-revoke]');
    if (r) {
      if (!confirm('Отозвать код? Игрок выйдет на всех устройствах.')) return;
      await api('POST', `admin/users/${r.dataset.revoke}/revoke`).catch((ex) => toast(ex.message));
      load();
      return;
    }
    const b = e.target.closest('[data-new]');
    if (!b) return;
    const code = prompt(`Новый код для ${b.dataset.name}. Оставьте пустым, и код будет случайным. Старый перестанет работать.`, '');
    if (code === null) return;
    try {
      const res = await api('POST', `admin/users/${b.dataset.new}/code`, { code });
      showCode(b.dataset.name, res.code);
      load();
    } catch (ex) { toast(ex.message); }
  });
  const loadTables = async () => {
    const list = await api('GET', 'admin/tables');
    const box = app.querySelector('#openTables');
    if (!box) return;
    box.innerHTML = list.length ? list.map((t, i) => `<div class="titem static">
      <a href="#/t/${esc(t.code)}"><b>${esc(t.title || t.code)}</b></a>
      <span>${t.seats.map((s) => esc(seatName(s))).join(', ')}</span>
      <span class="acts"><button class="btn sm" data-del="${i}" type="button">Удалить</button></span>
    </div>`).join('') : '<p class="muted">Открытых столов нет.</p>';
    box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => removeTable(list[+b.dataset.del], reloadTables)));
    const log = app.querySelector('#delLog');
    if (!log) return;
    log.innerHTML = deletionsHTML(await api('GET', 'deletions'));
    bindRestore(log, { api, toast, done: reloadTables });
  };
  // удаление и возврат меняют оба списка: открытые столы и журнал
  const reloadTables = () => loadTables().catch((e) => toast(e.message));
  if (admin) reloadTables();
  app.querySelector('#newUser').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#newName').value.trim();
    if (!name) return;
    try {
      const r = await api('POST', 'admin/users', { name, code: $('#newPin').value, admin: $('#newAdmin').checked });
      showCode(r.user.name, r.code);
      $('#newName').value = '';
      $('#newPin').value = '';
      $('#newAdmin').checked = false;
      load();
    } catch (ex) { toast(ex.message); }
  });
  load().catch((e) => toast(e.message));
}

// --- маршрутизация

// #/learn/tour/i1..i4 экскурсии по сайту (05.11)
const LEARN = /^learn(?:\/([1-8])\/(watch|play)|\/tour\/(i[1-4]))?$/;

function showLearn(m, bar) {
  if (m[1]) return openLesson(app, +m[1], m[2], { go });
  if (m[3]) return openTour(app, m[3], { go, bar, bindTop: bindTopbar, loggedIn: Boolean(session.get()?.token) });
  return renderLearn(app, bar, bindTopbar);
}

function route() {
  watcher?.stop();
  watcher = null;
  closePicker();
  const s = session.get();
  const h = location.hash.replace(/^#\/?/, '');
  const lm = LEARN.exec(h);
  setBackdrop(!(lm?.[1] || lm?.[3] === 'i2')); // в уроке и экскурсии по партии поле, ролик на телефоне качался бы впустую
  const jm = JOIN_ROUTE.exec(h); // ссылка-приглашение (06.11): открывается и без кода
  if (jm) return renderJoin(app, jm[1]);
  if (!s?.token) {
    stopPresence();
    if (h === 'rules') return renderRules(app, GUEST_BAR, bindTopbar);
    if (LEARN.test(h)) return showLearn(h.match(LEARN), GUEST_BAR);
    return renderActivate();
  }
  startPresence();
  setBusy(false);
  if (h === 'rules') return renderRules(app, topbar('rules'), bindTopbar);
  if (LEARN.test(h)) return showLearn(h.match(LEARN), topbar('learn'));
  const rp = h.match(/^t\/([A-Za-z0-9]{6})\/replay(?:\/(\d+))?$/); // просмотр партии по ходам (04.11)
  if (rp) return renderReplay(app, rp[1].toUpperCase(), topbar(''), bindTopbar, +(rp[2] || 0));
  const m = h.match(/^t\/([A-Za-z0-9]{6})$/);
  if (m) return openTable(m[1].toUpperCase());
  if (h === 'new') return renderNew();
  if (h === 'tables') return renderHome();
  if (h === 'admin') return renderAdmin();
  if (h === 'stats') return renderStats(app, topbar('stats'), bindTopbar);
  if (h === 'stats/me') return renderPersonal(app, topbar('stats'), bindTopbar);
  if (h === 'me') return renderProfile(app, topbar(''), bindTopbar);
  return renderStart();
}

window.addEventListener('hashchange', route);
window.addEventListener('tigris:logout', () => route());
route();
