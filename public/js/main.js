// Точка входа: окно активации, мои столы, стол (лобби или партия), коды игроков.
// Адреса: #/ — мои столы, #/t/КОД — стол, #/rules — правила (без входа), #/stats — статистика,
// #/admin — коды (администраторы).
import { api, session, watchTable } from './api.js';
import { renderLobby } from './lobby.js';
import { renderGame } from './game.js';
import { renderStats } from './stats.js';
import { renderRules } from './rules.js';
import { renderProfile } from './profile.js';
import { startPresence, stopPresence, setBusy, takeAccepted, mountOnline } from './presence.js';
import { freeSeat } from './online.js';
import { esc, toast, copy, faceBg } from './util.js';

const app = document.getElementById('app');
const backdrop = document.getElementById('backdrop');
let watcher = null;

/** Ролик-заставка на всех экранах, кроме партии. Не запустился, остается картинка из poster. */
function setBackdrop(on) {
  backdrop.hidden = !on;
  if (!on || matchMedia('(prefers-reduced-motion: reduce)').matches) backdrop.pause();
  else backdrop.play().catch(() => {});
}

const go = (hash) => { location.hash = hash; };

function topbar(active) {
  const u = session.get()?.user;
  return `<header class="bar">
    <a class="brand" href="#/">Тигр и Евфрат</a>
    <nav>
      <a href="#/rules" class="${active === 'rules' ? 'on' : ''}">Правила</a>
      <a href="#/stats" class="${active === 'stats' ? 'on' : ''}">Статистика</a>
      <a href="#/" class="${active === 'home' ? 'on' : ''}">Мои столы</a>
      ${u?.admin ? `<a href="#/admin" class="${active === 'admin' ? 'on' : ''}">Коды игроков</a>` : ''}
      <a class="me" href="#/me" title="Мой профиль">${u?.avatar ? `<i class="face" style="background-image:${faceBg(u)}"></i>` : ''}${esc(u?.name || '')}</a>
      <button class="linkbtn" id="logout">Выйти</button>
    </nav>
  </header>`;
}

// шапка для тех, кто читает правила без входа
const GUEST_BAR = `<header class="bar"><a class="brand" href="#/">Тигр и Евфрат</a><nav><a href="#/">Войти</a></nav></header>`;

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

const STATUS = { lobby: 'собирается', playing: 'идет партия', over: 'партия окончена', closed: 'партия завершена досрочно' };

async function renderHome() {
  app.innerHTML = `<div class="page">${topbar('home')}<main class="pcard">
    <h1>Мои столы</h1>
    <div class="row">
      <button class="btn primary" id="newTable">Новый стол</button>
      <form id="joinForm" class="join"><input id="joinCode" placeholder="Код стола" maxlength="6" autocapitalize="characters" spellcheck="false" aria-label="Код стола"><button class="btn" type="submit">Открыть</button></form>
    </div>
    <section class="online" id="onlineBox"></section>
    <div id="tables" class="tables"><p class="muted">Загружаю...</p></div>
  </main></div>`;
  bindTopbar();
  mountOnline(app.querySelector('#onlineBox'), {
    count: true,
    button: 'Создать стол и пригласить выбранных',
    onSend: async (ids) => {
      const r = await api('POST', 'tables');
      await api('POST', 'invite', { code: r.code, to: ids });
      go(`#/t/${r.code}`);
    },
  });
  app.querySelector('#newTable').addEventListener('click', async () => {
    try {
      const r = await api('POST', 'tables');
      go(`#/t/${r.code}`);
    } catch (e) { toast(e.message); }
  });
  app.querySelector('#joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const c = app.querySelector('#joinCode').value.trim().toUpperCase();
    if (c) go(`#/t/${c}`);
  });
  try {
    const list = await api('GET', 'tables');
    const el = app.querySelector('#tables');
    if (!el) return;
    el.innerHTML = list.length ? list.map((t) => {
      const myTurn = t.status === 'playing' && t.me != null && t.toMove === t.me;
      return `<a class="titem${myTurn ? ' turn' : ''}" href="#/t/${esc(t.code)}">
        <b>${esc(t.title || t.code)}</b>
        <span>${t.seats.map((s) => esc(s.name || (s.kind === 'bot' ? 'Бот' : 'свободно'))).join(', ')}</span>
        <small>${STATUS[t.status] || ''}${myTurn ? ', ваш ход' : ''}${t.next ? ', есть реванш' : ''}</small>
      </a>`;
    }).join('') : '<p class="muted">Пока нет столов. Создайте новый или откройте стол по коду из приглашения.</p>';
  } catch (e) { toast(e.message); }
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
    if (m !== mode) { app.innerHTML = ''; mode = m; }
    setBusy(v.status === 'playing' && v.me != null);
    setBackdrop(m === 'lobby');
    if (m === 'lobby') renderLobby(app, v, { act, go });
    else renderGame(app, v, { act, go });
    if (takeAccepted(code)) sitInvited(v);
  }, (e) => {
    if (e.status === 404) {
      app.innerHTML = `<div class="page">${topbar('')}<main class="pcard"><h1>Стола ${esc(code)} нет</h1><p>Проверьте код в приглашении.</p><a class="btn" href="#/">К моим столам</a></main></div>`;
      bindTopbar();
      watcher?.stop();
    } else if (e.code !== 'network') toast(e.message);
  });
}

// --- коды игроков (администраторы)

async function renderAdmin() {
  app.innerHTML = `<div class="page">${topbar('admin')}<main class="pcard">
    <h1>Коды игроков</h1>
    <p class="muted">Каждому игроку свой код. Код показывается один раз: сразу отправьте его игроку. Отозванный код перестает работать на всех устройствах. Свой код: от 8 до 20 латинских букв и цифр. Такой код легче угадать, чем случайный.</p>
    <form id="newUser" class="join"><input id="newName" placeholder="Имя игрока" maxlength="30" aria-label="Имя игрока"><input id="newPin" placeholder="Код (пусто = случайный)" maxlength="32" autocapitalize="characters" spellcheck="false" autocomplete="off" aria-label="Свой код"><label class="chk" id="newAdminBox" hidden><input type="checkbox" id="newAdmin"> администратор</label><button class="btn primary" type="submit">Выдать код</button></form>
    <div id="newCode"></div>
    <div id="users" class="tables"></div>
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
    app.querySelector('#users').innerHTML = users.map((u) => {
      const flag = u.main ? '' : iAmMain ? `<label class="chk"><input type="checkbox" data-admin="${esc(u.id)}" ${u.admin ? 'checked' : ''}> администратор</label>` : u.admin ? '<span class="muted">администратор</span>' : '';
      const may = !u.main && (iAmMain || !u.admin);
      return `<div class="titem static">
        <b>${esc(u.name)}</b><span>${u.main ? 'главный' : u.revoked ? 'код отозван' : 'код действует'}</span>${flag}
        ${may ? `<span class="acts"><button class="btn sm" data-new="${esc(u.id)}" data-name="${esc(u.name)}">Новый код</button>${u.revoked ? '' : `<button class="btn sm" data-revoke="${esc(u.id)}">Отозвать</button>`}</span>` : ''}
      </div>`;
    }).join('');
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

function route() {
  watcher?.stop();
  watcher = null;
  setBackdrop(true);
  const s = session.get();
  const h = location.hash.replace(/^#\/?/, '');
  if (!s?.token) {
    stopPresence();
    if (h === 'rules') return renderRules(app, GUEST_BAR, bindTopbar);
    return renderActivate();
  }
  startPresence();
  setBusy(false);
  if (h === 'rules') return renderRules(app, topbar('rules'), bindTopbar);
  const m = h.match(/^t\/([A-Za-z0-9]{6})$/);
  if (m) return openTable(m[1].toUpperCase());
  if (h === 'admin') return renderAdmin();
  if (h === 'stats') return renderStats(app, topbar('stats'), bindTopbar);
  if (h === 'me') return renderProfile(app, topbar(''), bindTopbar);
  return renderHome();
}

window.addEventListener('hashchange', route);
window.addEventListener('tigris:logout', () => route());
route();
