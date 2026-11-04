// Точка входа: окно активации, мои столы, стол (лобби или партия), коды игроков.
// Адреса: #/ мои столы, #/t/КОД стол, #/rules правила (без входа), #/learn обучение (без входа),
// #/stats статистика, #/admin коды (администраторы), #/t/КОД/replay просмотр партии по ходам.
import { api, session, watchTable } from './api.js';
import { renderLobby, closePicker } from './lobby.js';
import { renderGame } from './game.js';
import { renderStats } from './stats.js';
import { renderReplay } from './replay.js';
import { welcomeHTML, welcomeHidden, setWelcomeHidden } from './welcome.js';
import { renderRules } from './rules.js';
import { renderLearn, openLesson } from './lesson.js';
import { renderProfile } from './profile.js';
import { startPresence, stopPresence, setBusy, takeAccepted, mountOnline } from './presence.js';
import { freeSeat, deleteQuestion, canDelete } from './online.js';
import { esc, toast, copy, faceBg } from './util.js';

const app = document.getElementById('app');
const backdrop = document.getElementById('backdrop');
let watcher = null;

const bgToggle = document.getElementById('bgToggle');
const STILL_KEY = 'tigris.backdrop.still'; // выбор на этом устройстве: неподвижная картинка вместо ролика
const BACK_SPEED = 0.8, BACK_VIDEO = '/media/zastavka.mp4';

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

/** Ролик-заставка на всех экранах, кроме партии. Не запустился, остается картинка из poster. */
function setBackdrop(on) {
  backdropOn = on;
  backdrop.hidden = !on || still;
  bgToggle.hidden = !on;
  bgToggle.textContent = still ? 'Включить видео' : 'Остановить видео';
  document.body.classList.toggle('stillbg', on && still);
  if (!on || still) return backdrop.pause();
  if (!backdrop.src) backdrop.src = BACK_VIDEO; // ролик качаем, только когда он нужен
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
      <a href="#/" class="${active === 'home' ? 'on' : ''}">Мои столы</a>
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
      <p>Стол для своей компании. Введите личный код, его выдает администратор. Код нужен один раз на устройстве, вход запоминается на 90 дней.</p>
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

/** Удалить стол, где партия не начиналась, и обновить список на экране. */
let removing = false;
async function removeTable(t, done) {
  if (removing || !confirm(deleteQuestion(t, session.get()?.user?.name))) return;
  removing = true; // повторное нажатие не должно спрашивать и удалять второй раз
  try {
    await api('POST', `admin/tables/${t.code}/delete`);
    toast('Стол удален');
  } catch (e) { toast(e.message); }
  removing = false;
  done();
}

const seatName = (s) => s.name || (s.kind === 'bot' ? 'Бот' : 'свободно');

const STATUS = { lobby: 'собирается', playing: 'идет партия', over: 'партия окончена', closed: 'партия завершена досрочно' };

/**
 * «Начать игру» (просьба Дениса 04.11: отдельной кнопкой, а «Мои столы» только список): стол с людьми,
 * которые сейчас на сайте, стол с ботами или стол по коду из приглашения.
 */
function renderNew() {
  app.innerHTML = `<div class="page">${topbar('new')}<main class="pcard newgame">
    <h1>Начать игру</h1>
    <section class="ngbox"><h2>С людьми</h2>
      <p class="muted">Отметьте, кого позвать: стол создастся, они получат приглашение. Партию начнете вы, когда все будут за столом.</p>
      <section class="online" id="onlineBox"></section>
      <p class="ngempty"><button class="btn" id="newEmpty">Пустой стол</button> <span class="muted small">позвать позже ссылкой или из лобби</span></p>
    </section>
    <div class="ngrow">
      <section class="ngbox"><h2>С ботами</h2>
        <p class="muted">Вы и три бота. Число мест, силу ботов и правила можно поменять в лобби.</p>
        <button class="btn primary" id="newBots">Стол с ботами</button>
      </section>
      <section class="ngbox"><h2>По коду</h2>
        <p class="muted">Код стола из приглашения или ссылки.</p>
        <form id="joinForm" class="join"><input id="joinCode" placeholder="Код стола" maxlength="6" autocapitalize="characters" spellcheck="false" aria-label="Код стола"><button class="btn" type="submit">Открыть</button></form>
      </section>
    </div>
  </main></div>`;
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
  app.querySelector('#newBots').addEventListener('click', (e) => make(e.currentTarget, async (code) => {
    for (const seat of [1, 2]) await api('POST', `tables/${code}`, { action: 'seatKind', seat, kind: 'bot' });
  }));
  app.querySelector('#joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const c = app.querySelector('#joinCode').value.trim().toUpperCase();
    if (c) open(c);
  });
}

async function renderHome() {
  app.innerHTML = `<div class="page">${topbar('home')}<main class="pcard">
    ${welcomeHidden() ? '' : welcomeHTML(session.get()?.user)}
    <div class="homehead"><h1>Мои столы</h1><a class="btn primary" href="#/new">Начать игру</a></div>
    <div id="tables" class="tables"><p class="muted">Загружаю...</p></div>
    ${welcomeHidden() ? '<p class="small"><button class="linkbtn" id="welcomeShow">О сайте</button></p>' : ''}
  </main></div>`;
  bindTopbar();
  app.querySelector('#welcomeHide')?.addEventListener('click', () => { setWelcomeHidden(true); renderHome(); });
  app.querySelector('#welcomeShow')?.addEventListener('click', () => { setWelcomeHidden(false); renderHome(); });
  const load = async () => {
    try {
      const list = await api('GET', 'tables');
      const el = app.querySelector('#tables');
      if (!el) return;
      el.innerHTML = list.length ? list.map((t, i) => {
        const myTurn = t.status === 'playing' && t.me != null && t.toMove === t.me;
        const del = canDelete(t, session.get()?.user);
        return `<a class="titem${myTurn ? ' turn' : ''}${del ? ' del' : ''}" href="#/t/${esc(t.code)}">
          <b>${esc(t.title || t.code)}</b>
          <span>${t.seats.map((s) => esc(seatName(s))).join(', ')}</span>
          <small>${t.paused ? 'на паузе' : STATUS[t.status] || ''}${myTurn && !t.paused ? ', ваш ход' : ''}${t.next ? ', есть реванш' : ''}</small>
          ${t.replay ? `<button class="btn sm" data-replay="${esc(t.code)}" type="button">Просмотр</button>` : ''}
          ${del ? `<button class="btn sm" data-del="${i}" type="button">Удалить</button>` : ''}
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
    } catch (e) { toast(e.message); }
  };
  await load();
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
      app.innerHTML = `<div class="page">${topbar('')}<main class="pcard"><h1>Стола ${esc(code)} нет</h1><p>Возможно, его удалили. Проверьте код в приглашении.</p><a class="btn" href="#/">К моим столам</a></main></div>`;
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
      : 'Пригласите нового игрока: впишите его имя, и он получит свой код для входа. Код показывается один раз: сразу отправьте его игроку. Ниже те, кого вы пригласили.'} Свой код: от 8 до 20 латинских букв и цифр. Такой код легче угадать, чем случайный.</p>
    <form id="newUser" class="join"><input id="newName" placeholder="Имя нового игрока" maxlength="30" aria-label="Имя нового игрока"><input id="newPin" placeholder="Код (пусто = случайный)" maxlength="32" autocapitalize="characters" spellcheck="false" autocomplete="off" aria-label="Свой код"><label class="chk" id="newAdminBox" hidden><input type="checkbox" id="newAdmin"> администратор</label><button class="btn primary" type="submit">Выдать код</button></form>
    <div id="newCode"></div>
    <div id="users" class="tables"></div>
    ${admin ? `<h2>Открытые столы всех игроков</h2>
    <p class="muted">Здесь столы, где партия не начиналась, из последних 20 столов каждого игрока. Идущие и сыгранные партии удалить нельзя.</p>
    <div id="openTables" class="tables"></div>` : ''}
  </main></div>`;
  bindTopbar();
  const showCode = (name, code) => {
    app.querySelector('#newCode').innerHTML = `<div class="codebox"><span>Код для ${esc(name)}:</span><code>${esc(code)}</code><button class="btn sm" id="cpCode">Скопировать</button></div>`;
    app.querySelector('#cpCode').addEventListener('click', () => copy(code));
  };
  const load = async () => {
    const users = await api('GET', 'admin/users');
    const iAmMain = users.find((u) => u.id === session.get()?.user?.id)?.main;
    app.querySelector('#newAdminBox').hidden = !iAmMain;
    app.querySelector('#users').innerHTML = users.length ? users.map((u) => {
      const flag = u.main ? '' : iAmMain ? `<label class="chk"><input type="checkbox" data-admin="${esc(u.id)}" ${u.admin ? 'checked' : ''}> администратор</label>` : u.admin ? '<span class="muted">администратор</span>' : '';
      const may = !u.main && (iAmMain || !u.admin);
      const by = admin && u.invitedBy ? `<span class="muted">пригласил: ${esc(u.invitedBy)}</span>` : '';
      return `<div class="titem static">
        <b>${esc(u.name)}</b><span>${u.main ? 'главный' : u.revoked ? 'код отозван' : 'код действует'}</span>${flag}${by}
        ${may ? `<span class="acts"><button class="btn sm" data-new="${esc(u.id)}" data-name="${esc(u.name)}">Новый код</button>${u.revoked || !admin ? '' : `<button class="btn sm" data-revoke="${esc(u.id)}">Отозвать</button>`}</span>` : ''}
      </div>`;
    }).join('') : `<p class="muted">${admin ? 'Игроков пока нет.' : 'Вы пока никого не пригласили.'}</p>`;
    app.querySelectorAll('[data-admin]').forEach((b) => b.addEventListener('change', async () => {
      await api('POST', `admin/users/${b.dataset.admin}/admin`, { admin: b.checked }).catch((e) => toast(e.message));
      load();
    }));
    app.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Отозвать код? Игрок выйдет на всех устройствах.')) return;
      await api('POST', `admin/users/${b.dataset.revoke}/revoke`).catch((e) => toast(e.message));
      load();
    }));
    app.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', async () => {
      const code = prompt(`Новый код для ${b.dataset.name}. Оставьте пустым, и код будет случайным. Старый перестанет работать.`, '');
      if (code === null) return;
      try {
        const r = await api('POST', `admin/users/${b.dataset.new}/code`, { code });
        showCode(b.dataset.name, r.code);
        load();
      } catch (e) { toast(e.message); }
    }));
  };
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
  };
  const reloadTables = () => loadTables().catch((e) => toast(e.message));
  if (admin) reloadTables();
  app.querySelector('#newUser').addEventListener('submit', async (e) => {
    e.preventDefault();
    const $ = (id) => app.querySelector(id);
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

const LEARN = /^learn(?:\/([1-8])\/(watch|play))?$/;

function showLearn(m, bar) {
  if (m[1]) return openLesson(app, +m[1], m[2], { go });
  return renderLearn(app, bar, bindTopbar);
}

function route() {
  watcher?.stop();
  watcher = null;
  closePicker();
  const s = session.get();
  const h = location.hash.replace(/^#\/?/, '');
  setBackdrop(!LEARN.exec(h)?.[1]); // в уроке поле, ролик на телефоне качался бы впустую
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
  if (h === 'admin') return renderAdmin();
  if (h === 'stats') return renderStats(app, topbar('stats'), bindTopbar);
  if (h === 'me') return renderProfile(app, topbar(''), bindTopbar);
  return renderHome();
}

window.addEventListener('hashchange', route);
window.addEventListener('tigris:logout', () => route());
route();
