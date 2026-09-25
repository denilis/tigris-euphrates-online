/* Tigris & Euphrates — client: lobby, online play (Socket.io) and games on one device. */
(function () {
'use strict';
const TE = window.TE;
const COLORS = TE.COLORS;

// ─── CONSTANTS ─────────────────────────────────────────────────────────────────

const TILE_IMG = { red: 'temple', blue: 'farm', green: 'market', black: 'settlement' };
const TILE_LABEL = { red: 'Храм', blue: 'Ферма', green: 'Рынок', black: 'Поселение' };
const TILE_GEN_PL = { red: 'храмов', blue: 'ферм', green: 'рынков', black: 'поселений' };
const LEADER = { red: 'Жрец', blue: 'Земледелец', green: 'Торговец', black: 'Царь' };
const LEADER_PL = { red: 'жрецов', blue: 'земледельцев', green: 'торговцев', black: 'царей' };
const SPHERE = { red: 'Храмы', blue: 'Фермы', green: 'Рынки', black: 'Поселения' };
const DYN = {
  lion: { name: 'Лев', acc: '#f0b429' },
  bow: { name: 'Лучник', acc: '#c084fc' },
  pot: { name: 'Кувшин', acc: '#fb923c' },
  bull: { name: 'Бык', acc: '#e2e8f0' }
};
const IMG = {
  tile: c => `assets/game/tiles/${TILE_IMG[c]}.jpg`,
  cat: 'assets/game/tiles/catastrophe.jpg',
  unif: 'assets/game/tiles/unification.jpg',
  token: (d, c) => `assets/game/tokens/${d}_${c}.jpg`,
  avatar: d => `assets/game/tokens/${d}_black.jpg`,
  mon: id => `assets/game/monuments/${TE.MONUMENTS[id].colors.join('_')}.png`
};
// Painted grid inside the 2000x1116 board picture.
const BOARD_IMG = { w: 2000, h: 1116, x0: 114, y0: 58, x1: 1884, y1: 1048 };
const LOCAL_KEY = 'te-local-v3';
const SESSION_KEY = 'te-session';
const HISTORY_KEY = 'te-history';

// ─── SAFE HTML ─────────────────────────────────────────────────────────────────
// Every interpolated value is escaped unless it is itself produced by html``.

class Html { constructor(s) { this.s = s; } }
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(v) {
  if (v instanceof Html) return v.s;
  if (Array.isArray(v)) return v.map(esc).join('');
  if (v === null || v === undefined || v === false) return '';
  return String(v).replace(/[&<>"']/g, c => ESC[c]);
}
function html(strings, ...vals) {
  let s = strings[0];
  for (let i = 0; i < vals.length; i++) s += esc(vals[i]) + strings[i + 1];
  return new Html(s);
}
function setHtml(el, h) { el.innerHTML = esc(h); }

// ─── SMALL HELPERS ─────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const plural = TE.plural;
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } }
};

let toastTimer = null;
function toast(msg, kind) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'show' + (kind === 'info' ? ' info' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 2600);
}

let confirmResolve = null;
function ask(text) {
  $('confirm-t').textContent = text;
  $('confirm').hidden = false;
  return new Promise(resolve => { confirmResolve = resolve; });
}
function answer(yes) {
  $('confirm').hidden = true;
  if (confirmResolve) confirmResolve(yes);
  confirmResolve = null;
}

const avatar = (d, size) => html`<img class="tok" src="${IMG.avatar(d)}" alt="${DYN[d].name}" style="width:${size}px;height:${size}px">`;
const sq = c => html`<span class="sq sq-${c}"></span>`;

// ─── UI STATE ──────────────────────────────────────────────────────────────────

const ui = {
  screen: 'lobby',
  mode: null,          // 'online' | 'local'
  view: null,          // TE.getView() for the player at this screen
  room: null,          // online room summary
  sel: null,           // { kind: 'tile', color, index } | { kind: 'leader', color } | { kind: 'cat' }
  swap: null,          // hand indices chosen for replacing, or null
  catCell: null,       // square picked for a catastrophe, awaiting confirmation
  commit: 0,           // tiles to commit in the current conflict
  monAt: null,         // chosen monument square
  decisionKey: '',
  resultsFor: null,    // game id whose results were shown
  hoverCells: [],
  turnKey: '',
  turnStart: Date.now(),
  skew: 0,
  skipAfterMs: 45000,
  nOnline: 4,
  nLocal: 3
};

function clearSelection() {
  ui.sel = null;
  ui.swap = null;
  ui.catCell = null;
}

// ─── LOCAL GAMES (one device) ──────────────────────────────────────────────────

const Local = {
  state: null,
  training: false,
  viewer: 0,
  locked: false,

  start(names, training) {
    this.state = TE.createGame({ names });
    this.training = training;
    this.viewer = TE.awaiting(this.state);
    this.locked = !training;
    this.save();
    enterGame('local');
    this.refresh();
  },

  resume() {
    const saved = store.get(LOCAL_KEY);
    if (!saved || !saved.state || saved.state.v !== TE.VERSION) {
      toast('Сохранённой партии нет');
      return;
    }
    this.state = saved.state;
    this.training = !!saved.training;
    this.viewer = Number.isInteger(saved.viewer) ? saved.viewer : TE.awaiting(this.state) || 0;
    this.locked = !this.training && this.state.phase === 'play';
    enterGame('local');
    this.refresh();
  },

  save() {
    store.set(LOCAL_KEY, { state: this.state, training: this.training, viewer: this.viewer });
  },

  // Whose hand must be on screen: the defender picks support tiles in secret; all else is the active player.
  owner(s) {
    if (s.phase !== 'play') return null;
    if (s.pending && s.pending.type === 'conflict') return s.pending.player;
    return s.current;
  },

  refresh() {
    const owner = this.owner(this.state);
    if (owner !== null && owner !== this.viewer) {
      this.viewer = owner;
      if (!this.training) this.locked = true;
      this.save();
    }
    ui.view = TE.getView(this.state, this.viewer);
    renderLock();
    renderGame();
  },

  unlock() {
    this.locked = false;
    ui.view = TE.getView(this.state, this.viewer);
    renderLock();
    renderGame();
  },

  send(action) {
    const actor = TE.awaiting(this.state);
    const res = TE.applyAction(this.state, actor, action);
    if (!res.ok) {
      if (res.internal) console.error(res.internal);
      toast(res.error);
      renderGame();
      return;
    }
    this.state = res.state;
    this.save();
    this.refresh();
  },

  canAct() { return !this.locked; }
};

function renderLock() {
  const box = $('lock');
  if (ui.mode !== 'local' || !Local.locked || Local.state.phase !== 'play') { box.hidden = true; return; }
  const s = Local.state, p = s.players[Local.viewer], pd = s.pending;
  let title = `Ход: ${p.name}`;
  let sub = 'Передайте устройство. Остальные — не подглядывайте в тайлы.';
  if (pd && pd.type === 'conflict') {
    const role = pd.step === 'attacker' ? 'атака' : 'защита';
    title = `${p.name}: ${pd.kind === 'revolt' ? 'восстание' : 'война'} (${role})`;
    sub = 'Передайте устройство — нужно решить, сколько тайлов добавить в конфликт.';
  }
  $('lock-t').textContent = title;
  $('lock-s').textContent = sub;
  const btn = $('lock-btn');
  btn.textContent = `Я ${p.name} — показать`;
  btn.style.background = `linear-gradient(135deg,#3a2a08,${DYN[p.dynasty].acc})`;
  box.hidden = false;
}

// ─── ONLINE GAMES ──────────────────────────────────────────────────────────────

const Online = {
  socket: null,
  session: store.get(SESSION_KEY),

  ensure() {
    if (this.socket) return this.socket;
    if (typeof window.io !== 'function') {
      showErr('Нет связи с сервером игры. Онлайн-режим работает, когда страница открыта с игрового сервера.');
      return null;
    }
    const s = window.io({ transports: ['websocket', 'polling'] });
    s.on('connect', () => {
      $('netbar').hidden = true;
      if (this.session && !this.session.left) this.rejoin();
    });
    s.on('disconnect', reason => {
      // The client reconnects by itself except when the server closed the connection on purpose.
      if (reason === 'io server disconnect') { if (this.socket === s) this.socket = null; return; }
      if (ui.mode === 'online' && ui.screen === 'game') $('netbar').hidden = false;
    });
    s.on('state', st => this.onState(st));
    s.on('kicked', ({ msg }) => {
      this.session = Object.assign({}, this.session, { left: true });
      store.set(SESSION_KEY, this.session);
      backToLobby();
      showErr(msg || 'Подключение закрыто');
    });
    this.socket = s;
    return s;
  },

  emit(event, payload) {
    const s = this.ensure();
    if (!s) return Promise.resolve({ ok: false, error: 'Нет связи с сервером' });
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve({ ok: false, error: 'Сервер не ответил, попробуйте ещё раз' }), 8000);
      s.emit(event, payload, res => { clearTimeout(timer); resolve(res || { ok: false, error: 'Пустой ответ сервера' }); });
    });
  },

  keep(res) {
    this.session = { code: res.code, token: res.token };
    store.set(SESSION_KEY, this.session);
  },

  forget() {
    this.session = null;
    store.del(SESSION_KEY);
    refreshResume();
  },

  async create(name, maxPlayers) {
    const res = await this.emit('room:create', { name, maxPlayers });
    if (!res.ok) return showErr(res.error);
    this.keep(res);
  },

  async join(code, name) {
    const res = await this.emit('room:join', { code, name });
    if (!res.ok) return showErr(res.error);
    this.keep(res);
  },

  async rejoin() {
    if (!this.session) return;
    const code = this.session.code;
    const res = await this.emit('room:rejoin', { code, token: this.session.token });
    if (res.ok) return;
    this.forget();
    if (ui.mode === 'online' && ui.screen === 'game') backToLobby();
    showErr(`Партия ${code} больше недоступна — возможно, сервер перезапускался.`);
  },

  resume() {
    if (!this.session) return;
    this.session = { code: this.session.code, token: this.session.token };
    store.set(SESSION_KEY, this.session);
    if (this.socket && this.socket.connected) this.rejoin();
    else this.ensure();
  },

  onState(st) {
    if (ui.mode === 'local' && ui.screen === 'game') return; // a local game is on screen
    ui.mode = 'online';
    ui.room = st.room;
    ui.skew = st.now - Date.now();
    ui.skipAfterMs = st.skipAfterMs;
    if (st.view) {
      ui.view = st.view;
      if (ui.screen !== 'game') enterGame('online');
      renderGame();
    } else {
      ui.view = null;
      if (ui.screen === 'game') backToLobby();
      renderWaiting(st.room);
    }
  },

  send(action) {
    this.emit('game:action', action).then(res => { if (!res.ok) { toast(res.error); renderGame(); } });
  },

  canAct() {
    const v = ui.view;
    return !!v && v.phase === 'play' && TE.awaiting(v) === v.you;
  },

  async leaveRoom() {
    await this.emit('room:leave', {});
    this.forget();
    ui.room = null;
    $('panel-waiting').classList.remove('show');
    $('panel-online').classList.remove('in-room');
    showSub(null);
  },

  async leaveGame() {
    const over = ui.view && ui.view.phase === 'over';
    await this.emit('room:leave', {});
    if (over) this.forget();
    else {
      this.session = Object.assign({}, this.session, { left: true });
      store.set(SESSION_KEY, this.session);
    }
    backToLobby();
  },

  // Drops a lobby seat before a game on this device starts (a running online game stays resumable).
  detach() {
    if (!this.session || this.session.left || !this.socket) return;
    if (ui.room && !ui.room.started) {
      this.emit('room:leave', {});
      this.forget();
      ui.room = null;
      $('panel-waiting').classList.remove('show');
      $('panel-online').classList.remove('in-room');
    }
  },

  async simple(event, payload) {
    const res = await this.emit(event, payload || {});
    if (!res.ok) toast(res.error);
  }
};

const ctl = () => (ui.mode === 'local' ? Local : Online);

function send(action) {
  clearSelection();
  ctl().send(action);
}

// Main actions (tile, leader…) are possible: it is this screen's player's turn and nothing is pending.
function canPlayMain(v) {
  return !!v && v.phase === 'play' && !v.pending && ctl().canAct() && v.current === v.you;
}
function canDecide(v) {
  return !!v && v.phase === 'play' && !!v.pending && ctl().canAct();
}

// ─── LOBBY ─────────────────────────────────────────────────────────────────────

function showErr(msg) { $('err-msg').textContent = msg || ''; }

function switchMode(m) {
  $('tab-online').classList.toggle('active', m === 'online');
  $('tab-local').classList.toggle('active', m === 'local');
  $('panel-online').classList.toggle('show', m === 'online');
  $('panel-local').classList.toggle('show', m === 'local');
  showErr('');
}

function showSub(sub) {
  $('sub-create').classList.toggle('show', sub === 'create');
  $('sub-join').classList.toggle('show', sub === 'join');
  showErr('');
  const focus = sub === 'create' ? $('name-create') : sub === 'join' ? $('name-join') : null;
  if (focus) setTimeout(() => focus.focus(), 50);
}

function setCount(group, n) {
  document.querySelectorAll(`#${group} .np-btn`).forEach(b => b.classList.toggle('active', Number(b.dataset.n) === n));
}

function renderNameInputs() {
  const box = $('name-inputs');
  const prev = Array.from(box.querySelectorAll('input')).map(i => i.value);
  setHtml(box, TE.DYNASTIES.slice(0, ui.nLocal).map((d, i) => html`
    <div class="name-row" style="border-color:${DYN[d].acc}44">
     ${avatar(d, 22)}
     <input id="pn-${i}" type="text" placeholder="Игрок ${i + 1}" maxlength="20" value="${prev[i] || ''}">
    </div>`));
}

function localNames() {
  return Array.from({ length: ui.nLocal }, (_, i) => {
    const el = $(`pn-${i}`);
    const name = el ? el.value.replace(/\s+/g, ' ').trim().slice(0, 20) : '';
    return name || `Игрок ${i + 1}`;
  });
}

function rememberName(name) { store.set('te-name', name); }

function renderWaiting(room) {
  $('lobby').hidden = false;
  switchMode('online');
  $('sub-create').classList.remove('show');
  $('sub-join').classList.remove('show');
  $('panel-waiting').classList.add('show');
  $('panel-online').classList.add('in-room');
  $('room-code').textContent = room.code;
  setHtml($('waiting-players'), room.seats.map((s, i) => html`
    <div class="wp-row ${i === room.you ? 'me' : ''}">
     ${avatar(s.dynasty, 28)}
     <span class="wp-name" style="color:${DYN[s.dynasty].acc}">${s.name}</span>
     ${i === room.host ? html`<span class="wp-tag">создатель</span>` : ''}
     ${i === room.you ? html`<span class="wp-tag">вы</span>` : ''}
    </div>`));
  const mine = room.seats[room.you] ? room.seats[room.you].dynasty : null;
  setHtml($('dyn-pick'), TE.DYNASTIES.map(d => {
    const taken = room.seats.some((s, i) => i !== room.you && s.dynasty === d);
    return html`<button class="dyn-opt ${d === mine ? 'mine' : ''}" data-act="dyn" data-dyn="${d}" ${taken ? html`disabled` : ''} title="${DYN[d].name}">
      ${avatar(d, 40)}<span>${DYN[d].name}</span></button>`;
  }));
  const need = room.maxPlayers - room.seats.length;
  const isHost = room.you === room.host;
  $('waiting-hint').textContent = need > 0
    ? `Ожидаем ещё ${need} ${plural(need, 'игрока', 'игроков', 'игроков')}…` + (isHost ? ' Начать можно и сейчас, если игроков уже двое.' : '')
    : 'Все места заняты.';
  if (!isHost) $('waiting-hint').textContent += ' Игру начнёт создатель комнаты.';
  const start = $('start-btn');
  start.hidden = !isHost;
  start.disabled = room.seats.length < TE.MIN_PLAYERS;
  start.textContent = `▶ Начать игру (${room.seats.length})`;
}

function refreshResume() {
  const box = $('resume-box');
  const sess = Online.session;
  if (sess && sess.left) {
    setHtml(box, html`<span>Вы участвуете в онлайн-партии <b>${sess.code}</b></span>
      <span><button class="pbtn" data-act="resume-online">Вернуться</button>
      <button class="pbtn ghost" data-act="forget-online">Забыть</button></span>`);
    box.hidden = false;
  } else box.hidden = true;
  const saved = store.get(LOCAL_KEY);
  $('local-continue').hidden = !(saved && saved.state && saved.state.v === TE.VERSION && saved.state.phase === 'play');
}

function enterGame(mode) {
  ui.mode = mode;
  ui.screen = 'game';
  ui.resultsFor = null;
  clearSelection();
  $('lobby').hidden = true;
  $('game').hidden = false;
  $('results').hidden = true;
  layoutBoard();
}

function backToLobby() {
  ui.screen = 'lobby';
  ui.view = null;
  clearSelection();
  $('game').hidden = true;
  $('lock').hidden = true;
  $('results').hidden = true;
  $('decision').hidden = true;
  $('netbar').hidden = true;
  $('lobby').hidden = false;
  $('panel-waiting').classList.remove('show');
  $('panel-online').classList.remove('in-room');
  refreshResume();
}

// ─── BOARD GEOMETRY ────────────────────────────────────────────────────────────

function layoutBoard() {
  if ($('game').hidden) return;
  const root = document.documentElement.style;
  const hs = window.innerWidth <= 900 ? 42 : Math.max(46, Math.min(78, Math.round(window.innerHeight * 0.075)));
  root.setProperty('--hs', hs + 'px');
  const area = $('board-area');
  const narrow = window.innerWidth <= 900;
  const kx = 16 * BOARD_IMG.w / (BOARD_IMG.x1 - BOARD_IMG.x0);
  const ky = 11 * BOARD_IMG.h / (BOARD_IMG.y1 - BOARD_IMG.y0);
  const aw = (narrow ? window.innerWidth : area.clientWidth) - 16;
  const ah = area.clientHeight - 16;
  // Phones: keep squares tappable and let the board scroll sideways instead of shrinking further.
  const cs = narrow ? Math.max(28, Math.floor(aw / kx)) : Math.max(18, Math.floor(Math.min(aw / kx, ah / ky)));
  const sx = cs * 16 / (BOARD_IMG.x1 - BOARD_IMG.x0), sy = cs * 11 / (BOARD_IMG.y1 - BOARD_IMG.y0);
  root.setProperty('--cs', cs + 'px');
  root.setProperty('--bw', Math.round(BOARD_IMG.w * sx) + 'px');
  root.setProperty('--bh', Math.round(BOARD_IMG.h * sy) + 'px');
  root.setProperty('--bl', Math.round(BOARD_IMG.x0 * sx) + 'px');
  root.setProperty('--bt', Math.round(BOARD_IMG.y0 * sy) + 'px');
}

// ─── GAME RENDER ───────────────────────────────────────────────────────────────

function renderGame() {
  const v = ui.view;
  if (!v || ui.screen !== 'game') return;
  const key = `${v.phase}:${v.turn}`;
  if (key !== ui.turnKey) { ui.turnKey = key; ui.turnStart = Date.now(); }
  syncDecisionState(v);
  renderHeader(v);
  renderBoard(v);
  renderSide(v);
  renderPrompt(v);
  renderHand(v);
  renderDecision(v);
  renderResults(v);
  updateTimer();
  layoutBoard(); // the hand and prompt heights may have changed
}

// Resets per-decision inputs (committed tiles, monument square) whenever a new decision starts.
function syncDecisionState(v) {
  const pd = v.phase === 'play' ? v.pending : null;
  const key = pd ? [pd.type, pd.player, pd.step, pd.kind, pd.color, pd.need].join(':') : '';
  if (key !== ui.decisionKey) {
    ui.decisionKey = key;
    ui.commit = 0;
    ui.monAt = pd && pd.type === 'monument' ? pd.options[0].at : null;
  }
  if (pd || !canPlayMain(v)) clearSelection();
  if (ui.sel && ui.sel.kind === 'tile' && v.hand[ui.sel.index] !== ui.sel.color) ui.sel = null;
}

function pendingText(v) {
  const pd = v.pending;
  if (!pd) return null;
  const who = v.players[pd.player].name;
  if (pd.type === 'conflict') {
    const what = pd.kind === 'revolt' ? 'Восстание' : 'Война';
    return `${what} ${LEADER_PL[pd.color]}: решает ${who}`;
  }
  if (pd.type === 'warChoice') return `${who} выбирает, какую войну начать`;
  if (pd.type === 'monument') return `${who} решает, строить ли монумент`;
  return `${who} забирает сокровища`;
}

function renderHeader(v) {
  const cur = v.players[v.current];
  let status;
  if (v.phase === 'over') status = 'игра окончена';
  else if (v.pending) status = pendingText(v);
  else status = `${v.actionsLeft} ${plural(v.actionsLeft, 'действие', 'действия', 'действий')}`;
  setHtml($('cur-badge'), html`${avatar(cur.dynasty, 30)}
    <span class="nm" style="color:${DYN[cur.dynasty].acc}">${cur.name}</span>
    <span class="st">· ${status}</span>`);
  $('cur-badge').style.borderColor = DYN[cur.dynasty].acc + '66';
  $('turn-no').textContent = v.turn;
  $('treasures-left').textContent = v.treasuresLeft;
}

function boardTargets(v) {
  const empty = { set: new Set(), danger: false };
  if (v.phase !== 'play') return empty;
  const pd = v.pending;
  if (pd) {
    if (!canDecide(v)) return empty;
    if (pd.type === 'treasure') return { set: new Set(pd.cells), danger: false, pick: true };
    if (pd.type === 'monument') return { set: new Set(pd.options.flatMap(o => o.cells)), danger: false, pick: pd.options.length > 1 };
    return empty;
  }
  if (!canPlayMain(v) || !ui.sel) return empty;
  if (ui.sel.kind === 'tile') return { set: new Set(TE.tileTargets(v.board, ui.sel.color)), danger: false };
  if (ui.sel.kind === 'leader') return { set: new Set(TE.leaderTargets(v, v.you, ui.sel.color)), danger: false };
  return { set: new Set(TE.catastropheTargets(v.board)), danger: true };
}

function cellTitle(v, cell) {
  if (!cell) return '';
  if (cell.k === 'leader') return `${LEADER[cell.c]} — ${v.players[cell.p].name}`;
  if (cell.k === 'cat') return 'Катастрофа';
  if (cell.down) return 'Монумент' + (cell.tr ? ' · сокровище' : '');
  return TILE_LABEL[cell.c] + (cell.tr ? ' · сокровище' : '');
}

function renderBoard(v) {
  const targets = boardTargets(v);
  const marks = new Map();
  const mark = (i, cls) => marks.set(i, (marks.get(i) || '') + ' ' + cls);
  const pd = v.phase === 'play' ? v.pending : null;
  if (pd && pd.type === 'conflict') {
    pd.attacker.support.forEach(i => mark(i, 'sup-a'));
    pd.defender.support.forEach(i => mark(i, 'sup-d'));
    mark(pd.attacker.cell, 'fighter');
    mark(pd.defender.cell, 'fighter');
  }
  if (pd && pd.type === 'monument' && canDecide(v)) {
    const opt = pd.options.find(o => o.at === ui.monAt);
    if (opt) opt.cells.forEach(i => mark(i, 'kh'));
  }
  if (ui.catCell !== null) mark(ui.catCell, 'picked');

  const cells = [];
  for (let i = 0; i < TE.SIZE; i++) {
    const cell = v.board[i];
    let cls = 'cell';
    if (TE.RIVER[i]) cls += ' river';
    if (targets.set.has(i)) cls += targets.danger ? ' target danger' : targets.pick ? ' target pick' : ' target';
    if (marks.has(i)) cls += marks.get(i);
    let inner = '';
    if (cell) {
      if (cell.k === 'leader') {
        const dyn = v.players[cell.p].dynasty;
        inner = html`<img class="ldr" src="${IMG.token(dyn, cell.c)}" alt="" style="--acc:${DYN[dyn].acc}">`;
      } else if (cell.k === 'cat') {
        inner = html`<img class="t cat" src="${IMG.cat}" alt="">`;
      } else {
        inner = html`${cell.down ? html`<div class="down"></div>` : html`<img class="t" src="${IMG.tile(cell.c)}" alt="">`}${cell.tr ? html`<span class="tr"></span>` : ''}${i === v.unification ? html`<img class="unif" src="${IMG.unif}" alt="">` : ''}`;
      }
    }
    cells.push(html`<div class="${cls}" data-cell="${i}" title="${cellTitle(v, cell)}">${inner}</div>`);
  }
  setHtml($('grid'), cells);
  ui.hoverCells = [];

  setHtml($('board-marks'), v.monuments.filter(m => m.at !== null).map(m => {
    const c = m.at % TE.COLS, r = (m.at - c) / TE.COLS;
    return html`<div class="mon" style="left:calc(var(--cs) * ${c});top:calc(var(--cs) * ${r})"><img src="${IMG.mon(m.id)}" alt="Монумент"></div>`;
  }));
}

function highlightKingdom(i) {
  ui.hoverCells.forEach(c => { const el = $('grid').children[c]; if (el) el.classList.remove('kh'); });
  ui.hoverCells = [];
  const v = ui.view;
  if (!v || i === null || !v.board[i] || v.board[i].k === 'cat') return;
  if (v.pending && v.pending.type === 'monument') return;
  const g = TE.groupAt(v.board, i);
  if (g.cells.length < 2) return;
  g.cells.forEach(c => { const el = $('grid').children[c]; if (el) el.classList.add('kh'); });
  ui.hoverCells = g.cells;
}

function renderSide(v) {
  const room = ui.mode === 'online' ? ui.room : null;
  setHtml($('players'), v.players.map((p, i) => {
    const d = DYN[p.dynasty];
    const isCur = v.phase === 'play' && i === v.current;
    const online = room && room.seats[i] ? room.seats[i].online : null;
    return html`<div class="pl ${isCur ? 'cur' : ''}" style="--acc:${d.acc}">
      <div class="pl-top">
        ${avatar(p.dynasty, 26)}
        <span class="pl-name">${p.name}</span>
        ${i === v.you ? html`<span class="pl-you">${ui.mode === 'local' ? 'на экране' : 'вы'}</span>` : ''}
        ${online === null ? '' : html`<span class="dot ${online ? '' : 'off'}" title="${online ? 'в сети' : 'не в сети'}"></span>`}
      </div>
      <div class="pl-meta">
        <span class="grp" title="Лидеры на поле">${COLORS.map(c => html`<span class="ldot ${c} ${p.leaders[c] !== null ? 'on' : ''}" title="${LEADER[c]}: ${p.leaders[c] !== null ? 'на поле' : 'в запасе'}"></span>`)}</span>
        <span class="grp" title="Катастрофы">${Array.from({ length: p.catastrophes }, () => html`<img class="mini-cat" src="${IMG.cat}" alt="">`)}${p.catastrophes ? '' : '—'}</span>
        <span class="grp" title="Тайлов в руке">✋ ${p.handCount}</span>
      </div>
      ${p.vp ? html`<div class="vp">${COLORS.map(c => html`<span class="grp" title="${SPHERE[c]}">${sq(c)}${p.vp[c]}</span>`)}
        <span class="grp" title="Сокровища (любой цвет)"><span class="gem"></span>${p.treasures}</span></div>`
        : html`<div class="vp-hidden">очки скрыты</div>`}
    </div>`;
  }));

  setHtml($('monuments'), v.monuments.map(m => html`
    <div class="mon-card ${m.at !== null ? 'built' : ''}" title="Монумент: ${m.colors.map(c => SPHERE[c].toLowerCase()).join(' + ')}${m.at !== null ? ' (построен)' : ''}">
     <img src="${IMG.mon(m.id)}" alt="">
    </div>`));

  setHtml($('log'), v.log.slice().reverse().map(e => {
    const acc = e.p !== undefined && v.players[e.p] ? DYN[v.players[e.p].dynasty].acc : 'transparent';
    return html`<div class="le ${e.k || ''}" style="border-left:2px solid ${acc};padding-left:6px">${e.m}</div>`;
  }));
}

function offlineAwaited(v) {
  if (ui.mode !== 'online' || !ui.room || v.phase !== 'play') return null;
  const who = TE.awaiting(v);
  const seat = ui.room.seats[who];
  if (!seat || seat.online) return null;
  const left = Math.max(0, Math.ceil((seat.offlineSince + ui.skipAfterMs - (Date.now() + ui.skew)) / 1000));
  return { name: seat.name, left };
}

function renderPrompt(v) {
  const box = $('prompt');
  let msg = '', buttons = [];
  if (v.phase === 'over') {
    msg = html`<b>Игра окончена.</b> ${v.result.winners.length > 1 ? 'Победу делят' : 'Победитель'}: ${v.result.winners.map(w => v.players[w].name).join(', ')}`;
    buttons.push(html`<button class="pbtn" data-act="show-results">Итоги</button>`);
  } else if (v.pending) {
    const pd = v.pending;
    if (canDecide(v)) {
      const prefix = ui.mode === 'local' ? `${v.players[pd.player].name}: ` : '';
      if (pd.type === 'conflict') msg = html`${prefix}<b>${pd.kind === 'revolt' ? 'восстание' : 'война'}</b> — решите на панели, сколько тайлов добавить из руки.`;
      else if (pd.type === 'warChoice') msg = html`${prefix}объединённое царство охвачено несколькими войнами — выберите, какую разрешить первой.`;
      else if (pd.type === 'monument') msg = html`${prefix}сложился квадрат 2×2 — можно возвести монумент.`;
      else msg = html`${prefix}ваш торговец забирает сокровища: кликните по <b>${pd.need} ${plural(pd.need, 'сокровищу', 'сокровищам', 'сокровищам')}</b> на поле (одно останется).`;
    } else {
      msg = html`Ждём: ${pendingText(v)}`;
    }
  } else if (canPlayMain(v)) {
    const n = v.actionsLeft;
    if (ui.swap) {
      msg = html`Выберите тайлы для сброса (они уйдут из игры, взамен вы доберёте столько же): <b>${ui.swap.length}</b>`;
      buttons.push(html`<button class="pbtn" data-act="swap-confirm" ${ui.swap.length ? '' : html`disabled`}>Сбросить и добрать</button>`);
      buttons.push(html`<button class="pbtn ghost" data-act="cancel">Отмена</button>`);
    } else if (ui.catCell !== null) {
      const cell = v.board[ui.catCell];
      msg = html`Обрушить катастрофу на отмеченную клетку${cell ? html` и уничтожить <b>${TILE_LABEL[cell.c].toLowerCase()}</b>` : ''}? Это необратимо.`;
      buttons.push(html`<button class="pbtn danger" data-act="cat-yes">Обрушить</button>`);
      buttons.push(html`<button class="pbtn ghost" data-act="cancel">Отмена</button>`);
    } else if (ui.sel) {
      if (ui.sel.kind === 'tile') msg = html`<b>${TILE_LABEL[ui.sel.color]}</b>: выберите подсвеченную клетку${ui.sel.color === 'blue' ? ' на реке' : ''}.`;
      else if (ui.sel.kind === 'cat') msg = html`<b>Катастрофа</b>: выберите клетку — пустую или с тайлом без сокровища.`;
      else {
        const onBoard = v.players[v.you].leaders[ui.sel.color] !== null;
        msg = html`<b>${LEADER[ui.sel.color]}</b>: ${onBoard ? 'переместите на подсвеченную клетку или уберите с поля' : 'поставьте на клетку рядом с храмом'}.`;
        if (onBoard) buttons.push(html`<button class="pbtn" data-act="withdraw">Убрать с поля</button>`);
      }
      buttons.push(html`<button class="pbtn ghost" data-act="cancel">Отмена</button>`);
    } else {
      msg = html`<b>Ваш ход</b> — ${n} ${plural(n, 'действие', 'действия', 'действий')}: тайл, лидер, катастрофа или обмен тайлов.`;
    }
  } else {
    const cur = v.players[v.current];
    msg = ui.mode === 'local' ? html`Ход: <b>${cur.name}</b>` : html`Ходит <b>${cur.name}</b>…`;
  }
  const off = offlineAwaited(v);
  if (off) {
    msg = html`${msg} <span class="muted">${off.name} не в сети${off.left > 0 ? `: пропустить можно через ${off.left} с` : ''}.</span>`;
    if (off.left === 0) buttons.push(html`<button class="pbtn danger" data-act="skip">Пропустить за ${off.name}</button>`);
  }
  setHtml(box, html`<div class="msg">${msg}</div>${buttons}`);
}

function renderHand(v) {
  const box = $('hand');
  if (v.you < 0 || !v.players[v.you]) { setHtml(box, html`<span class="hand-empty">Наблюдение</span>`); return; }
  const me = v.players[v.you];
  const active = canPlayMain(v);
  box.classList.toggle('passive', !active);
  const tiles = v.hand.map((c, i) => {
    let cls = 'card';
    if (ui.swap) cls += ui.swap.includes(i) ? ' swap' : ' dim';
    else if (ui.sel && ui.sel.kind === 'tile' && ui.sel.index === i) cls += ' sel';
    return html`<button class="${cls}" data-act="hand-tile" data-i="${i}" title="${TILE_LABEL[c]}"><img src="${IMG.tile(c)}" alt=""><span class="lbl">${TILE_LABEL[c]}</span></button>`;
  });
  const leaders = COLORS.map(c => {
    const onBoard = me.leaders[c] !== null;
    const sel = ui.sel && ui.sel.kind === 'leader' && ui.sel.color === c;
    return html`<button class="ldr-card ${onBoard ? 'onboard' : ''} ${sel ? 'sel' : ''}" data-act="hand-leader" data-color="${c}" title="${LEADER[c]}${onBoard ? ' (на поле — можно переместить или убрать)' : ''}">
      <img class="tok" src="${IMG.token(me.dynasty, c)}" alt=""><span class="lbl ${onBoard ? 'onb' : ''}">${onBoard ? 'на поле' : LEADER[c]}</span></button>`;
  });
  const cats = Array.from({ length: me.catastrophes }, () => html`<button class="cat-card ${ui.sel && ui.sel.kind === 'cat' ? 'sel' : ''}" data-act="hand-cat" title="Катастрофа"><img src="${IMG.cat}" alt="Катастрофа"></button>`);
  setHtml(box, html`
    <span class="hsec">Тайлы</span>
    <div class="hgroup">${tiles.length ? tiles : html`<span class="hand-empty">рука пуста</span>`}</div>
    <div class="hdiv"></div>
    <span class="hsec">Лидеры</span>
    <div class="hgroup">${leaders}</div>
    ${cats.length ? html`<div class="hdiv"></div><span class="hsec">Катастр.</span><div class="hgroup">${cats}</div>` : ''}
    <div class="hand-actions">
      <button class="endbtn alt" data-act="swap-toggle" ${active && v.hand.length ? '' : html`disabled`}>${ui.swap ? 'Отмена обмена' : 'Обмен тайлов'}</button>
      <button class="endbtn" data-act="end-turn" ${active ? '' : html`disabled`}>Завершить ход</button>
    </div>`);
}

function sideCard(v, side, role, waiting) {
  const p = v.players[side.player];
  const committed = side.committed === null ? (waiting ? 'решает…' : 'ждёт') : side.committed;
  const total = side.base + (side.committed || 0);
  return html`<div class="side-card ${role === 'атакует' ? 'att' : 'def'}">
    <div class="side-head">${html`<img class="tok" src="${IMG.token(p.dynasty, v.pending.color)}" alt="" style="width:30px;height:30px">`}
      <div style="min-width:0"><div class="side-name" style="color:${DYN[p.dynasty].acc}">${p.name}</div><div class="side-role">${role}</div></div></div>
    <div class="side-line"><span>На поле</span><span>${side.base}</span></div>
    <div class="side-line"><span>Из руки</span><span>${committed}</span></div>
    <div class="side-total"><span>Сила</span><span>${side.committed === null ? `${side.base}+?` : total}</span></div>
  </div>`;
}

function renderDecision(v) {
  const box = $('decision');
  const pd = v.phase === 'play' ? v.pending : null;
  if (!pd || pd.type === 'treasure') { box.hidden = true; return; }
  const mine = canDecide(v);
  const whoName = v.players[pd.player].name;
  let body;
  if (pd.type === 'conflict') {
    const revolt = pd.kind === 'revolt';
    const supportWord = revolt ? 'храмов' : TILE_GEN_PL[pd.color];
    let actions;
    if (mine) {
      const have = v.hand.filter(c => c === pd.support).length;
      ui.commit = Math.min(ui.commit, have);
      actions = html`<div class="dec-actions">
        <span>Добавить ${supportWord} из руки:</span>
        <div class="stepper">
          <button data-act="commit-dec" ${ui.commit > 0 ? '' : html`disabled`} aria-label="Меньше">−</button>
          <output>${ui.commit}</output>
          <button data-act="commit-inc" ${ui.commit < have ? '' : html`disabled`} aria-label="Больше">+</button>
        </div>
        <span class="muted">из ${have}</span>
        <button class="btn-gold" data-act="commit">${ui.commit ? 'Добавить' : 'Не добавлять'}</button>
      </div>`;
    } else {
      actions = html`<div class="dec-hint">Ждём решения: ${whoName}</div>`;
    }
    body = html`<div class="dec-title">${revolt ? 'Восстание' : 'Война'} · ${LEADER_PL[pd.color]}</div>
      <div class="duel">
        ${sideCard(v, pd.attacker, 'атакует', pd.step === 'attacker')}
        <div class="vs">против</div>
        ${sideCard(v, pd.defender, 'защищается', pd.step === 'defender')}
      </div>
      ${actions}
      <div class="dec-hint">${revolt
        ? 'Сила — храмы рядом с лидером. Первым добавляет атакующий. Ничья — победа защитника. Победитель получает 1 красное очко.'
        : `Сила — ${supportWord} в своей части царства. Проигравший теряет лидера и эти тайлы, победитель получает за них очки.`}</div>`;
  } else if (pd.type === 'warChoice') {
    body = html`<div class="dec-title">Несколько войн</div>
      ${mine ? html`<div class="choice-row">${pd.colors.map(c => html`<button class="choice" data-act="war" data-color="${c}">${sq(c)}<span>Война ${LEADER_PL[c]}</span></button>`)}</div>
        <div class="dec-hint">После первой войны царство может распасться — тогда следующая не начнётся.</div>`
        : html`<div class="dec-hint">${whoName} выбирает, какую войну разрешить первой</div>`}`;
  } else {
    const opt = pd.options.find(o => o.at === ui.monAt) || pd.options[0];
    body = html`<div class="dec-title">Монумент</div>
      ${mine ? html`<div class="choice-row">${opt.monuments.map(id => html`<button class="choice" data-act="monument" data-id="${id}">
          <img src="${IMG.mon(id)}" alt=""><span>${TE.MONUMENTS[id].colors.map(c => SPHERE[c].toLowerCase()).join(' + ')}</span></button>`)}</div>
        <div class="dec-actions"><button class="pbtn ghost" data-act="monument-no">Не строить</button></div>
        <div class="dec-hint">Четыре тайла перевернутся. В конце своего хода вы получаете очко за каждого своего лидера цвета монумента в том же царстве.${pd.options.length > 1 ? ' Квадратов несколько — кликните по подсвеченной клетке, чтобы выбрать другой.' : ''}</div>`
        : html`<div class="dec-hint">${whoName} решает, возводить ли монумент</div>`}`;
  }
  setHtml(box, body);
  // Keep the panel away from the squares it is about.
  const focus = pd.type === 'conflict' ? pd.defender.cell : pd.type === 'warChoice' ? v.unification : (pd.options[0] || {}).at;
  box.classList.toggle('low', Number.isInteger(focus) && focus < TE.COLS * 5);
  box.hidden = false;
}

// ─── RESULTS ───────────────────────────────────────────────────────────────────

function recordHistory(v) {
  let hist = store.get(HISTORY_KEY);
  if (!Array.isArray(hist)) hist = [];
  if (!hist.some(g => g && g.id === v.id)) {
    hist.unshift({
      id: v.id,
      date: new Date().toLocaleDateString('ru-RU'),
      players: v.result.ranking.map(r => ({ name: r.name, place: r.place, score: r.score }))
    });
    hist = hist.slice(0, 50);
    store.set(HISTORY_KEY, hist);
  }
  return hist;
}

function renderResults(v) {
  if (v.phase !== 'over' || !v.result) { $('results').hidden = true; return; }
  if (ui.resultsFor === v.id) return;
  ui.resultsFor = v.id;
  const hist = recordHistory(v);
  const medals = ['🥇', '🥈', '🥉', '4'];
  const rows = v.result.ranking.map(r => {
    const d = DYN[r.dynasty];
    const min = Math.min(...COLORS.map(c => r.final[c]));
    return html`<tr class="${r.place === 1 ? 'win' : ''}">
      <td class="num" style="font-size:20px">${medals[r.place - 1] || r.place}</td>
      <td><span class="rplayer">${avatar(r.dynasty, 26)}<span style="color:${d.acc};font-weight:600">${r.name}</span></span></td>
      ${COLORS.map(c => {
        const bonus = r.final[c] - r.vp[c];
        return html`<td class="num ${r.final[c] === min ? 'weak' : ''}" title="${SPHERE[c]}: ${r.vp[c]} очк.${bonus ? ` + ${bonus} сокр.` : ''}">${r.final[c]}</td>`;
      })}
      <td class="num">${r.treasures}</td>
      <td class="num" style="color:var(--gold);font-size:18px">${r.score}</td>
    </tr>`;
  });
  const reason = v.endReason === 'bag' ? 'В мешке закончились тайлы.' : 'На поле осталось не больше двух сокровищ.';
  let extra = '';
  const names = new Set(v.result.ranking.map(r => r.name));
  const same = hist.filter(g => g && Array.isArray(g.players) && g.players.length === names.size && g.players.every(p => names.has(p.name)));
  if (same.length > 1) {
    const pts = [3, 2, 1, 0];
    const totals = {};
    names.forEach(n => { totals[n] = { name: n, games: 0, wins: 0, pts: 0 }; });
    same.forEach(g => g.players.forEach(p => {
      const t = totals[p.name];
      t.games++;
      if (p.place === 1) t.wins++;
      t.pts += pts[p.place - 1] || 0;
    }));
    const table = Object.values(totals).sort((a, b) => b.pts - a.pts || b.wins - a.wins);
    extra = html`<div class="ht">Турнирная таблица этих игроков (${same.length} ${plural(same.length, 'партия', 'партии', 'партий')})</div>
      <table class="rtable"><thead><tr><th>#</th><th>Игрок</th><th>Партий</th><th>Побед</th><th>Очков (3/2/1)</th></tr></thead>
      <tbody>${table.map((t, i) => html`<tr><td class="num">${i + 1}</td><td>${t.name}</td><td class="num">${t.games}</td><td class="num">${t.wins}</td><td class="num" style="color:var(--gold)">${t.pts}</td></tr>`)}</tbody></table>`;
  }
  setHtml($('res-content'), html`<div class="res-reason">${reason} Считается самая слабая сфера — сокровища добавлены к слабейшим.</div>
    <table class="rtable"><thead><tr><th></th><th>Игрок</th>${COLORS.map(c => html`<th title="${SPHERE[c]}">${sq(c)}</th>`)}<th title="Сокровища"><span class="gem"></span></th><th>Итог</th></tr></thead>
    <tbody>${rows}</tbody></table>${extra}`);
  setHtml($('res-actions'), ui.mode === 'online'
    ? html`<button class="btn-gold" data-act="rematch">Реванш</button><button class="btn-create btn-small" data-act="hide-results">Смотреть поле</button><button class="btn-create btn-small" data-act="to-lobby">В меню</button>`
    : html`<button class="btn-gold" data-act="new-local">Новая партия</button><button class="btn-create btn-small" data-act="hide-results">Смотреть поле</button><button class="btn-create btn-small" data-act="to-lobby">В меню</button>`);
  $('results').hidden = false;
  if (ui.mode === 'local') store.del(LOCAL_KEY);
}

// ─── TIMER ─────────────────────────────────────────────────────────────────────

function updateTimer() {
  const box = $('timer-box');
  const v = ui.view;
  if (!v || v.phase !== 'play') { box.textContent = '—'; box.className = ''; return; }
  const sec = Math.floor((Date.now() - ui.turnStart) / 1000);
  box.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  box.className = sec >= 240 ? 'w3' : sec >= 180 ? 'w2' : sec >= 120 ? 'w1' : '';
}

setInterval(() => {
  if (ui.screen !== 'game' || !ui.view) return;
  updateTimer();
  if (offlineAwaited(ui.view)) renderPrompt(ui.view);
}, 1000);

// ─── INPUT ─────────────────────────────────────────────────────────────────────

function onCellClick(i) {
  const v = ui.view;
  if (!v || v.phase !== 'play') return;
  const pd = v.pending;
  if (pd) {
    if (!canDecide(v)) return;
    if (pd.type === 'treasure') {
      if (pd.cells.includes(i)) send({ type: 'treasure', cell: i });
      else toast('Выберите подсвеченное сокровище');
    } else if (pd.type === 'monument') {
      const opt = pd.options.find(o => o.cells.includes(i));
      if (opt) { ui.monAt = opt.at; renderGame(); }
    }
    return;
  }
  if (!canPlayMain(v)) return;
  const cell = v.board[i];
  if (!ui.sel) {
    if (cell && cell.k === 'leader' && cell.p === v.you) { ui.sel = { kind: 'leader', color: cell.c }; renderGame(); }
    return;
  }
  if (ui.sel.kind === 'tile') {
    const err = TE.tileError(v.board, ui.sel.color, i);
    if (err) return toast(err);
    send({ type: 'tile', color: ui.sel.color, cell: i });
  } else if (ui.sel.kind === 'leader') {
    const board = v.board.slice();
    const from = v.players[v.you].leaders[ui.sel.color];
    if (from === i) return toast('Лидер уже стоит здесь');
    if (from !== null) board[from] = null;
    const err = TE.leaderError(board, i);
    if (err) return toast(err);
    send({ type: 'leader', color: ui.sel.color, cell: i });
  } else {
    const err = TE.catastropheError(v.board, i);
    if (err) return toast(err);
    ui.catCell = i;
    renderGame();
  }
}

function onHandTile(i) {
  const v = ui.view;
  if (!canPlayMain(v)) return;
  if (ui.swap) {
    ui.swap = ui.swap.includes(i) ? ui.swap.filter(x => x !== i) : ui.swap.concat(i);
  } else {
    const color = v.hand[i];
    ui.catCell = null;
    ui.sel = ui.sel && ui.sel.kind === 'tile' && ui.sel.index === i ? null : { kind: 'tile', color, index: i };
  }
  renderGame();
}

function onHandLeader(color) {
  if (!canPlayMain(ui.view) || ui.swap) return;
  ui.catCell = null;
  ui.sel = ui.sel && ui.sel.kind === 'leader' && ui.sel.color === color ? null : { kind: 'leader', color };
  renderGame();
}

async function onEndTurn() {
  const v = ui.view;
  if (!canPlayMain(v)) return;
  if (v.actionsLeft === 2 && !(await ask('Завершить ход, не сделав ни одного действия?'))) return;
  send({ type: 'end' });
}

async function onMenu() {
  if (ui.mode === 'local') {
    const over = Local.state && Local.state.phase === 'over';
    if (over || await ask('Выйти в меню? Партия сохранится — её можно будет продолжить.')) backToLobby();
    return;
  }
  const over = ui.view && ui.view.phase === 'over';
  if (over || await ask('Выйти в меню? Вы сможете вернуться в эту партию.')) Online.leaveGame();
}

const ACTIONS = {
  mode: t => switchMode(t.dataset.mode),
  sub: t => showSub(t.dataset.sub),
  'np-online': t => { ui.nOnline = Number(t.dataset.n); setCount('np-online', ui.nOnline); },
  'np-local': t => { ui.nLocal = Number(t.dataset.n); setCount('np-local', ui.nLocal); renderNameInputs(); },
  create: () => {
    const name = $('name-create').value.trim();
    rememberName(name);
    showErr('');
    Online.create(name, ui.nOnline);
  },
  join: () => {
    const name = $('name-join').value.trim();
    const code = $('code-join').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) return showErr('Код комнаты — 6 символов');
    rememberName(name);
    showErr('');
    Online.join(code, name);
  },
  'copy-link': () => {
    if (!ui.room) return;
    const url = `${location.origin}${location.pathname}?room=${ui.room.code}`;
    const done = () => toast('Ссылка скопирована', 'info');
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('Скопируйте ссылку:', url));
    else prompt('Скопируйте ссылку:', url);
  },
  dyn: t => Online.simple('room:dynasty', { dynasty: t.dataset.dyn }),
  start: () => Online.simple('room:start'),
  'leave-room': () => Online.leaveRoom(),
  'resume-online': () => Online.resume(),
  'forget-online': () => { Online.emit('room:leave', {}); Online.forget(); },
  'local-start': () => { Online.detach(); Local.start(localNames(), $('training').checked); },
  'local-continue': () => { Online.detach(); Local.resume(); },
  rules: () => { $('rules').hidden = false; },
  'close-rules': () => { $('rules').hidden = true; },
  menu: () => onMenu(),
  unlock: () => Local.unlock(),
  'hand-tile': t => onHandTile(Number(t.dataset.i)),
  'hand-leader': t => onHandLeader(t.dataset.color),
  'hand-cat': () => {
    if (!canPlayMain(ui.view) || ui.swap) return;
    ui.sel = ui.sel && ui.sel.kind === 'cat' ? null : { kind: 'cat' };
    ui.catCell = null;
    renderGame();
  },
  'swap-toggle': () => {
    if (!canPlayMain(ui.view)) return;
    ui.sel = null; ui.catCell = null;
    ui.swap = ui.swap ? null : [];
    renderGame();
  },
  'swap-confirm': () => {
    const v = ui.view;
    if (!ui.swap || !ui.swap.length) return;
    send({ type: 'swap', tiles: ui.swap.map(i => v.hand[i]) });
  },
  cancel: () => { clearSelection(); renderGame(); },
  withdraw: () => { if (ui.sel && ui.sel.kind === 'leader') send({ type: 'withdraw', color: ui.sel.color }); },
  'cat-yes': () => { if (ui.catCell !== null) send({ type: 'catastrophe', cell: ui.catCell }); },
  'end-turn': () => onEndTurn(),
  'commit-dec': () => { ui.commit = Math.max(0, ui.commit - 1); renderDecision(ui.view); },
  'commit-inc': () => { ui.commit++; renderDecision(ui.view); },
  commit: () => send({ type: 'commit', count: ui.commit }),
  war: t => send({ type: 'war', color: t.dataset.color }),
  monument: t => send({ type: 'monument', at: ui.monAt, monument: Number(t.dataset.id) }),
  'monument-no': () => send({ type: 'monument', decline: true }),
  skip: () => Online.simple('game:skip'),
  rematch: () => Online.simple('game:rematch'),
  'new-local': () => { backToLobby(); switchMode('local'); },
  'to-lobby': () => { if (ui.mode === 'online') Online.leaveGame(); else backToLobby(); },
  'show-results': () => { $('results').hidden = false; },
  'hide-results': () => { $('results').hidden = true; },
  'confirm-yes': () => answer(true),
  'confirm-no': () => answer(false)
};

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t || t.disabled) return;
  const fn = ACTIONS[t.dataset.act];
  if (fn) fn(t, e);
});

$('grid').addEventListener('click', e => {
  const c = e.target.closest('.cell');
  if (c) onCellClick(Number(c.dataset.cell));
});
$('grid').addEventListener('mousemove', e => {
  const c = e.target.closest('.cell');
  const i = c ? Number(c.dataset.cell) : null;
  if (ui.hoverAt === i) return;
  ui.hoverAt = i;
  highlightKingdom(i);
});
$('grid').addEventListener('mouseleave', () => { ui.hoverAt = null; highlightKingdom(null); });

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!$('confirm').hidden) return answer(false);
    if (!$('rules').hidden) { $('rules').hidden = true; return; }
    if (ui.sel || ui.swap || ui.catCell !== null) { clearSelection(); renderGame(); }
  }
  if (e.key === 'Enter' && !$('confirm').hidden) answer(true);
  if (e.key === 'Enter' && e.target && e.target.id === 'code-join') ACTIONS.join();
  if (e.key === 'Enter' && e.target && e.target.id === 'name-create') ACTIONS.create();
});

window.addEventListener('resize', () => { layoutBoard(); });

// ─── INIT ──────────────────────────────────────────────────────────────────────

(function init() {
  const name = store.get('te-name');
  if (typeof name === 'string') { $('name-create').value = name; $('name-join').value = name; }
  renderNameInputs();
  refreshResume();
  const params = new URLSearchParams(location.search);
  const code = (params.get('room') || '').toUpperCase();
  if (/^[A-Z0-9]{6}$/.test(code)) {
    switchMode('online');
    showSub('join');
    $('code-join').value = code;
  }
  if (Online.session && !Online.session.left) Online.ensure(); // reconnects to a running game after a reload
})();
})();
