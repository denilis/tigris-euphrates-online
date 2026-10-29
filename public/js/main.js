// Точка входа: окно активации, мои столы, стол (лобби или партия), коды игроков.
// Адреса: #/ — мои столы, #/t/КОД — стол, #/admin — коды (только Денис).
import { api, session, watchTable } from './api.js';
import { renderLobby } from './lobby.js';
import { renderGame } from './game.js';
import { esc, toast, copy } from './util.js';

const app = document.getElementById('app');
let watcher = null;

const go = (hash) => { location.hash = hash; };

function topbar(active) {
  const u = session.get()?.user;
  return `<header class="bar">
    <a class="brand" href="#/">Тигр и Евфрат</a>
    <nav>
      <a href="#/" class="${active === 'home' ? 'on' : ''}">Мои столы</a>
      ${u?.admin ? `<a href="#/admin" class="${active === 'admin' ? 'on' : ''}">Коды игроков</a>` : ''}
      <span class="me">${esc(u?.name || '')}</span>
      <button class="linkbtn" id="logout">Выйти</button>
    </nav>
  </header>`;
}

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
      <p>Стол для своей компании. Введите личный код, его выдает Денис. Код нужен один раз на устройстве.</p>
      <input id="actCode" placeholder="XXXX-XXXX-XXXX" autocapitalize="characters" spellcheck="false" aria-label="Личный код">
      <button class="btn primary" type="submit">Войти</button>
      <p class="err" id="actErr" role="alert"></p>
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

const STATUS = { lobby: 'собирается', playing: 'идет партия', over: 'партия окончена', closed: 'закрыт' };

async function renderHome() {
  app.innerHTML = `<div class="page">${topbar('home')}<main class="pcard">
    <h1>Мои столы</h1>
    <div class="row">
      <button class="btn primary" id="newTable">Новый стол</button>
      <form id="joinForm" class="join"><input id="joinCode" placeholder="Код стола" maxlength="6" autocapitalize="characters" spellcheck="false" aria-label="Код стола"><button class="btn" type="submit">Открыть</button></form>
    </div>
    <div id="tables" class="tables"><p class="muted">Загружаю...</p></div>
  </main></div>`;
  bindTopbar();
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
        <b>${esc(t.code)}</b>
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
  let mode = null;
  watcher = watchTable(code, (v) => {
    const m = v.status === 'lobby' ? 'lobby' : 'game';
    if (m !== mode) { app.innerHTML = ''; mode = m; }
    if (m === 'lobby') renderLobby(app, v, { act, go });
    else renderGame(app, v, { act, go });
  }, (e) => {
    if (e.status === 404) {
      app.innerHTML = `<div class="page">${topbar('')}<main class="pcard"><h1>Стола ${esc(code)} нет</h1><p>Проверьте код в приглашении.</p><a class="btn" href="#/">К моим столам</a></main></div>`;
      bindTopbar();
      watcher?.stop();
    } else if (e.code !== 'network') toast(e.message);
  });
}

// --- коды игроков (Денис)

async function renderAdmin() {
  app.innerHTML = `<div class="page">${topbar('admin')}<main class="pcard">
    <h1>Коды игроков</h1>
    <p class="muted">Каждому игроку свой код. Код показывается один раз: сразу отправьте его игроку. Отозванный код перестает работать на всех устройствах.</p>
    <form id="newUser" class="join"><input id="newName" placeholder="Имя игрока" maxlength="30" aria-label="Имя игрока"><button class="btn primary" type="submit">Выдать код</button></form>
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
    app.querySelector('#users').innerHTML = users.map((u) => `<div class="titem static">
      <b>${esc(u.name)}</b><span>${u.admin ? 'админ' : u.revoked ? 'код отозван' : 'код действует'}</span>
      ${u.admin ? '' : `<span class="acts"><button class="btn sm" data-new="${esc(u.id)}" data-name="${esc(u.name)}">Новый код</button>${u.revoked ? '' : `<button class="btn sm" data-revoke="${esc(u.id)}">Отозвать</button>`}</span>`}
    </div>`).join('');
    app.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Отозвать код? Игрок выйдет на всех устройствах.')) return;
      await api('POST', `admin/users/${b.dataset.revoke}/revoke`).catch((e) => toast(e.message));
      load();
    }));
    app.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const r = await api('POST', `admin/users/${b.dataset.new}/code`);
        showCode(b.dataset.name, r.code);
        load();
      } catch (e) { toast(e.message); }
    }));
  };
  app.querySelector('#newUser').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = app.querySelector('#newName').value.trim();
    if (!name) return;
    try {
      const r = await api('POST', 'admin/users', { name });
      showCode(r.user.name, r.code);
      app.querySelector('#newName').value = '';
      load();
    } catch (ex) { toast(ex.message); }
  });
  load().catch((e) => toast(e.message));
}

// --- маршрутизация

function route() {
  watcher?.stop();
  watcher = null;
  const s = session.get();
  if (!s?.token) return renderActivate();
  const h = location.hash.replace(/^#\/?/, '');
  const m = h.match(/^t\/([A-Za-z0-9]{6})$/);
  if (m) return openTable(m[1].toUpperCase());
  if (h === 'admin') return renderAdmin();
  return renderHome();
}

window.addEventListener('hashchange', route);
window.addEventListener('tigris:logout', () => route());
route();
