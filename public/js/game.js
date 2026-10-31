// Экран партии: поле, рука, карточки игроков, панель «Сейчас», журнал. Клиент только
// рисует вид от сервера: допустимые ходы приходят списком legal, ход уходит номером в нём.
import { renderBoard, sealIcon, buildingIcon } from './board.js';
import { renderWarDock, warActive } from './war.js';
import { renderEnd } from './end.js';
import { battlesIn, battleCard } from './battle.js';
import { fmt, fmtTotal, clockNow } from './clock.js';
import { pickableLeader, hitCells, squareCells } from './pick.js';
import { trailMarks, ageMarks } from './trail.js';
import { stockItems } from './stock.js';
import {
  HEX, RING, COLNAME, COLGEN, TILE, LEADER, LEADERACC, HERONAME, STYLES, tileImg, catImg, tokenImg, cellName, esc, plural, copy, cells,
  unitePos, toast,
} from './util.js';

// состояние интерфейса между перерисовками (не уходит на сервер)
const ui = { key: null, sel: null, discard: null, confirmPass: false, monSel: null, chosen: new Set(), collapsed: false, flash: null, owners: loadOwners(), trail: [], trailSeen: new Map(), trailCode: null };

// метки владельца на тайлах: включены по умолчанию, выбор помнит браузер
function loadOwners() {
  try { return localStorage.getItem('tigris.owners') !== 'off'; } catch { return true; }
}

function resetFor(view) {
  // новый момент партии: прежний выбор больше не к месту
  const g = view.game;
  const key = `${view.code}:${g.turn}:${g.actionNo}:${g.phase}:${g.toMove}`;
  if (key === ui.key) return;
  Object.assign(ui, { key, sel: null, discard: null, confirmPass: false, monSel: null, chosen: new Set(), collapsed: false });
}

const SKELETON = `<div class="app" id="game">
  <header class="top">
    <a class="brand" href="#/">Тигр и Евфрат</a>
    <button class="code" id="gCode" title="Скопировать ссылку на стол"></button>
    <div class="badges" id="gBadges"></div>
    <div class="meta"><span>мешок <b id="gBag"></b></span><span>ход <b id="gTurn"></b></span></div>
    <nav class="nav"><button class="navbtn" id="gOwners" title="Показать, к чьему лидеру идет каждый тайл"></button><a class="navbtn" href="#/rules">Правила</a><a class="navbtn" href="#/stats">Статистика</a><a class="navbtn" href="#/">Мои столы</a></nav>
  </header>
  <main class="boardwrap"><svg id="board" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Поле"></svg></main>
  <aside class="side">
    <section><h3>Игроки</h3><div class="players" id="gPlayers"></div></section>
    <section><h3>Запас</h3><div class="stock" id="gStock"></div></section>
    <section class="now" id="gNow"></section>
    <section class="log"><h3>Журнал</h3><ol id="gLog"></ol></section>
  </aside>
  <footer class="hand" id="gHand"></footer>
  <div class="modal" id="gDock" hidden></div>
  <div class="battle" id="gBattle" hidden></div>
  <div class="endwrap" id="gEnd" hidden></div>
</div>`;

/** Нарисовать партию в root. act(body) отправляет действие стола, go(hash) переходит. */
export function renderGame(root, view, { act, go }) {
  if (!root.querySelector('#game')) {
    root.innerHTML = SKELETON;
    root.querySelector('#board').addEventListener('click', (e) => {
      const r = e.target.closest('.cell-hit');
      if (r) onCell(+r.dataset.i);
    });
    root.querySelector('#gLog').addEventListener('click', (e) => {
      const bb = e.target.closest('[data-battle]');
      if (bb) {
        ui.battleShow = +bb.dataset.battle;
        draw();
        return;
      }
      const li = e.target.closest('li[data-cell]');
      if (!li || li.dataset.cell === '') return;
      ui.flash = +li.dataset.cell;
      draw();
      setTimeout(() => { ui.flash = null; draw(); }, 1300);
    });
    root.querySelector('#gCode').addEventListener('click', () => copy(location.origin + location.pathname + location.search + '#/t/' + current.code));
    setInterval(updateClocks, 250);
    root.querySelector('#gOwners').addEventListener('click', () => {
      ui.owners = !ui.owners;
      try { localStorage.setItem('tigris.owners', ui.owners ? 'on' : 'off'); } catch { /* без памяти */ }
      draw();
    });
  }
  current = view;
  ctl = { act, go, root };
  resetFor(view);
  draw();
}

let current = null, ctl = null;

function D() {
  const view = current, g = view.game;
  const me = view.me;
  const myP = g.order.indexOf(me);
  const seat = (id) => view.seats.find((s) => s.id === id);
  const name = (id) => (id === me ? 'Вы' : seat(id)?.name || 'Бот');
  const legal = g.legal || [];
  return { view, g, me, myP, seat, name, legal, decides: Boolean(g.legal), heroOf: (p) => seat(g.order[p])?.hero };
}

async function move(index) {
  const { view } = D();
  if (index < 0) return;
  await ctl.act({ action: 'move', version: view.version, index });
}

// --- клики по полю

/** Лидер на клетке i, которого можно взять щелчком по полю: те же условия, что в нижней панели. */
function leaderAt(i) {
  const { g, myP, legal, decides } = D();
  if (!decides || g.phase !== 'action' || ui.discard || ui.confirmPass) return null;
  return pickableLeader(g.players[myP], legal, i);
}

function pickLeader(c) {
  ui.sel = ui.sel?.kind === 'leader' && ui.sel.color === c ? null : { kind: 'leader', color: c };
  draw();
}

function onCell(i) {
  const { g, legal, decides } = D();
  if (!decides || warActive(current)) return;
  const c = leaderAt(i);
  if (c != null) return pickLeader(c);
  let idx = -1;
  if (g.phase === 'action' && ui.sel) {
    const type = { tile: 'tile', leader: 'leader', cat: 'catastrophe' }[ui.sel.kind];
    idx = legal.findIndex((m) => m.type === type && m.pos === i && (type === 'catastrophe' || m.color === ui.sel.color));
  } else if (g.phase === 'build') {
    idx = legal.findIndex((m) => m.type === 'build' && m.pos === i);
  } else if (g.phase === 'treasure') {
    idx = legal.findIndex((m) => m.type === 'treasure' && m.pos === i);
  } else if (g.phase === 'monument' && ui.monSel === 'wonder') {
    idx = legal.findIndex((m) => m.type === 'wonder' && m.center === i);
  } else if (g.phase === 'monument' && ui.monSel != null) {
    idx = legal.findIndex((m) => m.type === 'monument' && m.id === ui.monSel && m.tl === i);
    if (idx < 0) idx = legal.findIndex((m) => m.type === 'monument' && m.id === ui.monSel && squareCells(m.tl).includes(i));
  }
  if (idx >= 0) move(idx);
}

function boardOpts() {
  const { g, me, myP, legal, decides } = D();
  const o = { flash: ui.flash, owners: ui.owners, unite: unitePos(g), trail: ui.trail };
  const k = g.ctx?.war || g.ctx?.revolt;
  if (k && (g.phase === 'warSupport' || g.phase === 'revoltSupport')) {
    o.conflict = { k, kind: g.ctx.war ? 'war' : 'revolt', myExtra: ui.chosen.size, me };
  }
  if (!decides) return o;
  if (g.phase === 'action' && ui.sel) {
    const type = { tile: 'tile', leader: 'leader', cat: 'catastrophe' }[ui.sel.kind];
    o.targets = legal.filter((m) => m.type === type && (type === 'catastrophe' || m.color === ui.sel.color)).map((m) => m.pos);
  } else if (g.phase === 'build') o.targets = legal.filter((m) => m.type === 'build').map((m) => m.pos);
  else if (g.phase === 'treasure') o.targets = legal.filter((m) => m.type === 'treasure').map((m) => m.pos);
  else if (g.phase === 'monument' && ui.monSel === 'wonder') o.crosses = legal.filter((m) => m.type === 'wonder').map((m) => m.center);
  else if (g.phase === 'monument' && ui.monSel != null) o.squares = legal.filter((m) => m.type === 'monument' && m.id === ui.monSel).map((m) => m.tl);
  o.hit = hitCells(o, g.players[myP].leaders.filter((i) => leaderAt(i) != null));
  return o;
}

// --- отрисовка

/** След хода соперника; при открытии стола уже стоящий след показывается без вспышки. */
function updateTrail({ view, g, seat }) {
  const first = ui.trailCode !== view.code;
  ui.trailCode = view.code;
  ui.trail = ageMarks(trailMarks(g.log, view.me), ui.trailSeen, Date.now(), first).map((m) => ({ ...m, hero: seat(m.actor)?.hero }));
}

/** Запас: что еще можно построить. Перерисовывается, только когда что-то построили. */
function drawStock({ view, g }) {
  const el = ctl.root.querySelector('#gStock');
  const s = stockItems(g, view.options);
  const key = JSON.stringify(s);
  if (key === ui.stockKey && el.firstChild) return;
  ui.stockKey = key;
  const item = (x, icon) => `<span class="sit${x.built ? ' built' : ''}" title="${esc(x.title)}">${icon}</span>`;
  const row = (label, items) => `<div class="row"><span class="lbl">${label}</span>${items}</div>`;
  el.innerHTML = row('Монументы', s.monuments.map((m) => item(m, sealIcon(m.c1, m.c2, 28))).join(''))
    + (s.buildings || s.wonder ? row('Здания', [
      ...(s.buildings || []).map((b) => item(b, buildingIcon(b.c))),
      s.wonder ? item(s.wonder, '<span class="wonderico"></span>') : '',
    ].join('')) : '');
}

function draw() {
  const d = D();
  const { view, g, root = ctl.root } = { ...d, root: ctl.root };
  updateTrail(d);
  root.querySelector('#gCode').innerHTML = `стол <b>${esc(view.title || view.code)}</b>`;
  const o = view.options;
  root.querySelector('#gBadges').innerHTML = [
    o.board === 'advanced' ? 'Продвинутое поле' : 'Обычное поле',
    o.englishSupport && 'Английская поддержка', o.buildings && 'Здания', o.wonder && 'Чудо',
    o.openScore ? 'Открытый счет' : 'Закрытый счет',
  ].filter(Boolean).map((b) => `<span class="badge">${b}</span>`).join('');
  root.querySelector('#gBag').textContent = g.bagPct + '%';
  root.querySelector('#gTurn').textContent = g.turn;
  const ob = root.querySelector('#gOwners');
  ob.textContent = ui.owners ? 'Метки: вкл' : 'Метки: выкл';
  ob.setAttribute('aria-pressed', String(ui.owners));
  renderBoard(root.querySelector('#board'), g, d.heroOf, boardOpts());
  drawPlayers(d);
  drawStock(d);
  drawNow(d);
  drawLog(d);
  drawHand(d);
  const dock = root.querySelector('#gDock');
  const active = renderWarDock(dock, view, ui, { move, redraw: draw });
  const app = root.querySelector('#game');
  app.classList.toggle('conflict', active && !ui.collapsed);
  app.classList.toggle('locked', active);
  drawBattle(d);
  renderEnd(root.querySelector('#gEnd'), view, ctl);
}

// --- ход боя: новые бои с прошлого «Понятно» (при входе на стол старые не показываем),
// или бой, выбранный в журнале. Новый бой закрывается сам через 10 с, «Изучаю» оставляет
// его открытым (просьба Дениса 29.10); пока вкладка скрыта, отсчет стоит. Бой из журнала
// открыт, пока не нажать «Понятно».
const BATTLE_MS = 10000;

function stopBattleTimer() {
  clearInterval(ui.battleTimer);
  ui.battleTimer = null;
}

function closeBattle() {
  stopBattleTimer();
  Object.assign(ui, { battleSeen: current.game.log.length, battleShow: null });
  draw();
}

function drawBattle({ view, g }) {
  const box = ctl.root.querySelector('#gBattle');
  if (ui.battleCode !== view.code) Object.assign(ui, { battleCode: view.code, battleSeen: g.log.length, battleShow: null });
  const list = ui.battleShow != null ? battlesIn(g.log, ui.battleShow).slice(0, 1) : battlesIn(g.log, ui.battleSeen).slice(-2);
  const key = list.map((b) => b.i).join(',');
  if (box.dataset.key === key) return; // не перерисовываем: иначе показ боя начнется заново
  box.dataset.key = key;
  stopBattleTimer();
  box.hidden = !list.length;
  const auto = list.length > 0 && ui.battleShow == null;
  const hold = auto ? '<span class="bleft" id="bLeft"></span><button class="btn" id="bHold">Изучаю</button>' : '';
  box.innerHTML = list.length ? `${list.map((b) => battleCard(b, view)).join('')}<div class="bfoot">${hold}<button class="btn primary" id="bOk">Понятно</button></div>` : '';
  box.querySelector('#bOk')?.addEventListener('click', closeBattle);
  if (!auto) return;
  let left = BATTLE_MS, last = Date.now();
  const tick = () => {
    if (!box.isConnected) return stopBattleTimer();
    const now = Date.now();
    if (document.visibilityState === 'visible') left -= now - last;
    last = now;
    if (left <= 0) return closeBattle();
    box.querySelector('#bLeft').textContent = `закроется через ${Math.ceil(left / 1000)} с`;
  };
  tick();
  ui.battleTimer = setInterval(tick, 250);
  box.querySelector('#bHold').addEventListener('click', () => {
    stopBattleTimer();
    box.querySelector('#bLeft').textContent = 'открыто до «Понятно»';
    box.querySelector('#bHold').remove();
  });
}

function drawPlayers({ view, g, me, seat }) {
  const el = ctl.root.querySelector('#gPlayers');
  el.innerHTML = g.players.map((pl, p) => {
    const s = seat(pl.seat) || {};
    const deciding = !g.stopped && pl.seat === g.toMove;
    const active = !g.stopped && pl.seat === g.cur;
    const tag = deciding && !active ? '<span class="tag gold">решает</span>' : active && !g.over ? `<span class="tag gold">${g.actionNo}/2</span>` : '';
    const dots = [0, 1, 2, 3].map((c) => `<i class="dot" title="${LEADER[c]}${pl.leaders[c] >= 0 ? ' на поле' : ' в руке'}" style="border-color:${RING[c]};background:${pl.leaders[c] >= 0 ? HEX[c] : 'transparent'}"></i>`).join('');
    const sc = pl.score
      ? `<span class="sc" title="очки: красный, синий, зеленый, черный">${pl.score.map((v, c) => `<span style="background:${HEX[c]}${c === 3 ? ';outline:1px solid #cfc6b4' : ''}">${v}</span>`).join('')}</span>`
      : '<span class="sc hid" title="закрытый счет: очки соперников не видны">счет скрыт</span>';
    const bot = s.kind === 'bot' ? `<span class="tag" title="${esc(STYLES[s.bot?.style] || '')}, сила ${s.bot?.strength ?? ''}">бот</span>` : '';
    return `<div class="pc${deciding ? ' deciding' : active ? ' active' : ''}">
      <div class="av" style="background-image:url(${tokenImg(s.hero, pl.seat === me ? 0 : 3)})"></div>
      <div class="nm">${esc(s.name || 'Бот')}${pl.seat === me ? ' <small>(вы)</small>' : ''} <small>${HERONAME[s.hero] || ''}</small> ${bot} ${tag}</div>
      <span class="tm">${pl.handCount} в руке</span>
      <div class="row"><span class="dots">${dots}</span><span class="cnt" title="катастрофы"><i class="cat" style="background-image:url(${catImg})"></i>${pl.cats}</span><span class="cnt" title="сокровища"><i class="coin"></i>${pl.treasures}</span>${sc}</div>${
      g.clock ? `<div class="ptime" data-clock="seat" data-seat="${pl.seat}" title="Время за партию; красным то, что сверх времени хода"></div>` : ''}
    </div>`;
  }).join('');
}

function waitingText({ g, name }) {
  const n = name(g.toMove);
  const k = g.ctx?.war || g.ctx?.revolt;
  switch (g.phase) {
    case 'action': return `Ходит ${n}, действие ${g.actionNo} из 2.`;
    case 'warSupport': return `Война за ${COLNAME[k.color]}: ${n} решает, сколько добавить.`;
    case 'revoltSupport': return `Восстание: ${n} решает, сколько храмов добавить.`;
    case 'warChoose': return `${n} выбирает, какая война будет первой.`;
    case 'build': return `${n} решает, строить ли здание.`;
    case 'monument': return `${n} решает, строить ли монумент.`;
    case 'treasure': return `${n} выбирает сокровище.`;
    case 'wonderPoint': return `${n} выбирает цвет очка за чудо.`;
    case 'confirm': return `${n} завершает ход: пока идет окно, действие можно отменить.`;
    default: return '';
  }
}

function drawNow(d) {
  const { view, g, legal, decides, seat } = d;
  const el = ctl.root.querySelector('#gNow');
  const btn = (id, label, cls = '') => `<button class="btn ${cls}" data-act="${id}">${label}</button>`;
  let title = 'Сейчас', body = '', buttons = '';
  if (g.stopped) {
    title = 'Партия завершена';
    body = '<p>Организатор завершил партию досрочно. Итога нет, в статистику она не идет.</p>';
  } else if (g.over) {
    title = 'Партия окончена';
    body = `<p>${g.endReason === 'bag' ? 'В мешке кончились тайлы.' : 'На поле осталось два сокровища.'}</p>`;
  } else if (!decides) {
    const bot = seat(g.toMove)?.kind === 'bot';
    body = `<p>${waitingText(d)}</p>${bot ? '<p class="wait">Бот думает<i></i><i></i><i></i></p>' : ''}`;
  } else if (warActive(view)) {
    title = 'Решаете вы';
    body = '<p>Открыто окно справа, партия ждет вашего решения.</p>';
  } else if (g.phase === 'action') {
    title = 'Ваш ход';
    if (ui.confirmPass) {
      body = `<p>${g.actionNo === 1 ? 'Пас на первом действии заканчивает весь ход.' : 'Пас заканчивает ход.'} Точно пасуете?</p>`;
      buttons = btn('passYes', 'Пас', 'primary') + btn('cancel', 'Отмена');
    } else if (ui.discard) {
      const n = ui.discard.size;
      body = `<p>Нажмите тайлы в руке, которые сбрасываете. Выбрано: ${n}. Вместо них вы сразу доберете столько же.</p>`;
      buttons = (n ? btn('discardYes', `Сбросить ${n}`, 'primary') : '<button class="btn primary" disabled>Выберите тайлы</button>') + btn('cancel', 'Отмена');
    } else if (ui.sel) {
      const n = boardOpts().targets?.length || 0;
      const what = ui.sel.kind === 'tile' ? `тайл «${TILE[ui.sel.color]}»` : ui.sel.kind === 'leader' ? LEADERACC[ui.sel.color] : 'катастрофу';
      body = `<p>Действие ${g.actionNo} из 2. Вы держите ${what}: подсвечено ${cells(n)}${ui.sel.kind === 'tile' && ui.sel.color === 1 ? ' (ферма только на реку)' : ''}. Нажмите клетку.</p>`;
      if (ui.sel.kind === 'leader' && legal.some((m) => m.type === 'withdraw' && m.color === ui.sel.color)) buttons += btn('withdraw', `Вернуть ${LEADERACC[ui.sel.color]} в руку`);
      buttons += btn('cancel', 'Отмена');
    } else {
      body = `<p>Действие ${g.actionNo} из 2. Выберите тайл, лидера (внизу или на поле) или катастрофу.</p>`;
      if (g.canUndo) buttons = btn('undo', 'Отменить действие');
    }
  } else if (g.phase === 'build') {
    title = 'Здание';
    body = `<p>Можно построить здание «${TILE[g.ctx.color]}». Нажмите подсвеченную клетку.</p>`;
    buttons = btn('skip', 'Не строить') + (g.canUndo ? btn('undo', 'Отменить действие') : '');
  } else if (g.phase === 'monument') {
    title = 'Монумент';
    const ids = [...new Set(legal.filter((m) => m.type === 'monument').map((m) => m.id))];
    const opts = ids.map((id) => {
      const mon = g.monuments.find((x) => x.id === id);
      return `<button class="monopt${ui.monSel === id ? ' on' : ''}" data-mon="${id}">${sealIcon(mon.c1, mon.c2, 44)}<span>${COLNAME[mon.c1]} и ${COLNAME[mon.c2]}</span></button>`;
    }).join('');
    const wonder = legal.some((m) => m.type === 'wonder') ? `<button class="monopt${ui.monSel === 'wonder' ? ' on' : ''}" data-mon="wonder"><span class="wonderico"></span><span>чудо</span></button>` : '';
    body = `<p>${ui.monSel == null ? 'Выберите монумент, потом место на поле.' : 'Нажмите подсвеченное место на поле.'}</p><div class="monopts">${opts}${wonder}</div>`;
    buttons = btn('skip', 'Не строить') + (g.canUndo ? btn('undo', 'Отменить действие') : '');
  } else if (g.phase === 'treasure') {
    title = 'Сокровище';
    body = '<p>Возьмите сокровище: нажмите подсвеченное на поле.</p>';
    if (g.canUndo) buttons = btn('undo', 'Отменить действие');
  } else if (g.phase === 'confirm') {
    title = 'Ход сделан';
    body = `<p>Последнее действие еще можно отменить. Ход завершится сам через <b data-clock="confirm"></b>.</p>`;
    buttons = btn('confirm', 'Завершить ход', 'primary') + (g.canUndo ? btn('undo', 'Отменить действие') : '');
  } else if (g.phase === 'wonderPoint') {
    title = 'Очко за чудо';
    body = '<p>Выберите цвет, в который получите очко.</p>';
    buttons = legal.map((m, i) => `<button class="btn colorbtn" data-idx="${i}" style="border-color:${RING[m.color]}"><i style="background:${HEX[m.color]}"></i>${COLNAME[m.color]}</button>`).join('');
  }
  const live = !g.over && !g.stopped;
  const clk = g.clock && live ? '<span class="clk" data-clock="turn" title="Время на ход; сверх него идет в минус"></span>' : '';
  const stop = view.isHost && live ? '<button class="linkbtn stopgame" data-act="stopGame">Завершить партию</button>' : '';
  el.innerHTML = `<h3>${title}${clk}</h3>${body}${buttons ? `<div class="nowbtns">${buttons}</div>` : ''}${stop}`;
  el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => onNow(b.dataset.act)));
  el.querySelectorAll('[data-mon]').forEach((b) => b.addEventListener('click', () => {
    ui.monSel = b.dataset.mon === 'wonder' ? 'wonder' : +b.dataset.mon;
    draw();
  }));
  el.querySelectorAll('[data-idx]').forEach((b) => b.addEventListener('click', () => move(+b.dataset.idx)));
}

function onNow(a) {
  const { legal, view } = D();
  if (a === 'cancel') Object.assign(ui, { sel: null, discard: null, confirmPass: false });
  else if (a === 'passYes') move(legal.findIndex((m) => m.type === 'pass'));
  else if (a === 'skip') move(legal.findIndex((m) => m.type === 'pass'));
  else if (a === 'withdraw') move(legal.findIndex((m) => m.type === 'withdraw' && m.color === ui.sel.color));
  else if (a === 'confirm') move(legal.findIndex((m) => m.type === 'confirm'));
  else if (a === 'undo') ctl.act({ action: 'undo', version: view.version });
  else if (a === 'stopGame') {
    if (confirm('Завершить партию для всех игроков? Итога не будет, в статистику партия не пойдет. Вернуть ее нельзя.')) ctl.act({ action: 'close' });
  } else if (a === 'discardYes') {
    const counts = [0, 0, 0, 0];
    for (const k of ui.discard) counts[handColors(view)[k]]++;
    move(legal.findIndex((m) => m.type === 'discard' && m.counts.every((v, c) => v === counts[c])));
  }
  draw();
}

const handColors = (view) => view.game.hand.flatMap((n, c) => Array(n).fill(c));

function drawHand(d) {
  const { view, g, myP, legal, decides } = d;
  const el = ctl.root.querySelector('#gHand');
  if (myP < 0) {
    el.innerHTML = '<div class="hint">Вы смотрите партию со стороны.</div>';
    return;
  }
  const acting = decides && g.phase === 'action' && !ui.confirmPass;
  const pl = g.players[myP];
  const has = (type, c) => legal.some((m) => m.type === type && (c == null || m.color === c));
  const tiles = handColors(view).map((c, k) => {
    const on = ui.discard ? ui.discard.has(k) : ui.sel?.kind === 'tile' && ui.sel.color === c && handColors(view).indexOf(c) === k;
    const can = acting && (ui.discard || has('tile', c));
    return `<button class="ht${on ? ' sel' : ''}${can ? '' : ' idle'}" data-tile="${k}" data-c="${c}" title="${TILE[c]}" style="background-image:url(${tileImg(c)})"></button>`;
  }).join('');
  const hero = view.seats.find((s) => s.id === view.me)?.hero;
  const leaders = [0, 1, 2, 3].map((c) => {
    const on = pl.leaders[c] >= 0;
    const can = acting && !ui.discard && (has('leader', c) || has('withdraw', c));
    return `<button class="hl${on ? ' onb' : ''}${ui.sel?.kind === 'leader' && ui.sel.color === c ? ' sel' : ''}${can ? '' : ' idle'}" data-leader="${c}" title="${LEADER[c]}${on ? ', на поле' : ''}" style="border-color:${RING[c]};background-image:url(${tokenImg(hero, c)})"></button>`;
  }).join('');
  const cats = [0, 1].map((k) => {
    const can = acting && !ui.discard && k < pl.cats && has('catastrophe');
    return `<button class="ht${k >= pl.cats ? ' used' : ''}${ui.sel?.kind === 'cat' && k === 0 ? ' sel' : ''}${can ? '' : ' idle'}" data-cat="${k}" title="катастрофа" style="background-image:url(${catImg})"></button>`;
  }).join('');
  let hint = '';
  if (!decides) hint = 'Ход другого игрока. Рука видна, но не нажимается.';
  else if (warActive(view)) hint = 'Идет конфликт: решите в окне справа.';
  else if (g.phase === 'action') hint = ui.discard ? 'Сброс: выберите тайлы и подтвердите справа.' : ui.sel ? 'Нажмите подсвеченную клетку на поле. Повторный клик по выбранному снимает выбор.' : `Действие ${g.actionNo} из 2. Выберите тайл, лидера (внизу или на поле) или катастрофу.`;
  else if (g.phase === 'confirm') hint = 'Ход сделан: завершите его или отмените действие справа.';
  else hint = 'Решите в панели справа.';
  el.className = 'hand' + (acting ? '' : ' locked');
  el.innerHTML = `<div class="hint">${hint}</div>
    <div class="hrow">
      <div class="grp"><span>Рука</span><div class="items">${tiles}</div></div>
      <div class="grp"><span>Лидеры</span><div class="items">${leaders}</div></div>
      <div class="grp"><span>Катастрофы</span><div class="items">${cats}</div></div>
      <div class="acts">
        ${acting && has('discard') && !ui.discard ? '<button class="btn" data-hand="discard">Сбросить тайлы</button>' : ''}
        ${acting && has('pass') ? '<button class="btn" data-hand="pass">Пас</button>' : ''}
      </div>
    </div>`;
  el.querySelectorAll('[data-tile]').forEach((b) => b.addEventListener('click', () => {
    if (!acting) return;
    const k = +b.dataset.tile, c = +b.dataset.c;
    if (ui.discard) {
      if (ui.discard.has(k)) ui.discard.delete(k); else ui.discard.add(k);
    } else if (has('tile', c)) {
      ui.sel = ui.sel?.kind === 'tile' && ui.sel.color === c ? null : { kind: 'tile', color: c };
    }
    draw();
  }));
  el.querySelectorAll('[data-leader]').forEach((b) => b.addEventListener('click', () => {
    const c = +b.dataset.leader;
    if (!acting || ui.discard || !(has('leader', c) || has('withdraw', c))) return;
    pickLeader(c);
  }));
  el.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
    if (!acting || ui.discard || !has('catastrophe')) return;
    ui.sel = ui.sel?.kind === 'cat' ? null : { kind: 'cat' };
    draw();
  }));
  el.querySelectorAll('[data-hand]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.hand === 'discard') Object.assign(ui, { discard: new Set(), sel: null });
    else Object.assign(ui, { confirmPass: true, sel: null });
    draw();
  }));
}

// --- время (просьбы Дениса 29.10): у решающего таймер хода, сверх него минус и красный,
// у каждого игрока копится время за партию. Цифры обновляются 4 раза в секунду без перерисовки.

function updateClocks() {
  if (!current?.game || !ctl?.root.querySelector('#game')) return;
  const g = current.game, k = clockNow(g);
  if (!k) return;
  for (const el of ctl.root.querySelectorAll('[data-clock]')) {
    const kind = el.dataset.clock;
    if (kind === 'turn') {
      if (!k.live) continue;
      el.textContent = fmt(k.left);
      el.classList.toggle('low', k.left > 0 && k.left <= 10000);
      el.classList.toggle('neg', k.left <= 0);
    } else if (kind === 'confirm') {
      el.textContent = `${Math.max(0, Math.ceil((k.confirmLeft ?? 0) / 1000))} с`;
    } else if (kind === 'seat') {
      const seat = +el.dataset.seat, over = k.over(seat);
      el.innerHTML = `время ${fmtTotal(k.used(seat))}${over >= 1000 ? `, <b>сверх ${fmtTotal(over)}</b>` : ''}`;
    }
  }
  // красное предупреждение один раз за ход, когда время своего решения вышло
  const mine = g.toMove === current.me && g.phase !== 'confirm';
  const warnKey = `${current.code}:${g.turn}:${g.toMove}:${g.phase === 'action' ? 'act' : g.phase}`;
  if (k.live && mine && k.left <= 0 && ui.warned !== warnKey) {
    ui.warned = warnKey;
    toast('Время хода вышло: таймер ушел в минус');
  }
}

// --- журнал

function drawLog({ g, seat }) {
  // в журнале имена, а не «вы»: так читаются обороты вроде «атакует Бот, защищается Денис»
  const name = (id) => seat(id)?.name || 'Бот';
  const lines = [];
  let key = null, line = null;
  for (let li = 0; li < g.log.length; li++) {
    const e = g.log[li];
    const k = `${e.turn}:${e.actor}:${e.action}`;
    if (k !== key) {
      key = k;
      line = { turn: e.turn, actor: e.actor, parts: [], pts: [], cell: null, unite: false, battles: [] };
      lines.push(line);
    }
    switch (e.ev) {
      case 'tile':
        line.parts.push(`${TILE[e.c]} ${cellName(e.pos)}`);
        if (line.unite) { line.parts.push('объединение'); line.unite = false; }
        line.cell ??= e.pos;
        break;
      case 'unite': line.unite = true; break;
      case 'undo': line.parts.push('отмена действия'); key = null; break;
      case 'leader': line.parts.push(`${LEADER[e.c]} ${e.from >= 0 ? 'переставлен на' : 'на'} ${cellName(e.pos)}`); line.cell ??= e.pos; break;
      case 'withdraw': line.parts.push(`${LEADER[e.c]} в руку`); break;
      case 'catastrophe': line.parts.push(`катастрофа ${cellName(e.pos)}`); line.cell = e.pos; break;
      case 'discard': line.parts.push(`сброс ${e.n}`); break;
      case 'warStart':
        line.parts.push(`война за ${COLNAME[e.color]}: атакует ${name(e.att)}${e.att !== e.actor ? ` (у ходящего нет ${COLGEN[e.color]} лидера)` : ''}, защищается ${name(e.def)}`);
        break;
      case 'war':
        line.battles.push(li);
        line.parts.push(e.attTotal === e.defTotal ? `ничья ${e.attTotal}:${e.defTotal}, побеждает защитник ${name(e.winner)}` : `победа: ${name(e.winner)} ${e.attTotal}:${e.defTotal}`);
        break;
      case 'revolt':
        line.battles.push(li);
        line.parts.push(`восстание, ${e.attTotal === e.defTotal ? `ничья ${e.attTotal}:${e.defTotal}, побеждает защитник ${name(e.winner)}` : `победа: ${name(e.winner)} ${e.attTotal}:${e.defTotal}`}`);
        break;
      case 'monument': line.parts.push('монумент'); line.cell = e.tl; break;
      case 'wonder': line.parts.push('чудо'); line.cell = e.center; break;
      case 'building': line.parts.push(`здание «${TILE[e.c]}»`); line.cell = e.pos; break;
      case 'treasure': line.parts.push(`${name(e.seat)}: сокровище`); break;
      case 'leaderReturned': line.parts.push(`${LEADER[e.c]} (${name(e.seat)}) уходит с поля`); break;
      case 'score': line.pts.push(e.seat === line.actor ? `+${e.n} ${COLNAME[e.c]}` : `${name(e.seat)} +${e.n} ${COLNAME[e.c]}`); break;
      case 'gameOver': line.parts.push('конец партии'); break;
      default: break;
    }
  }
  ctl.root.querySelector('#gLog').innerHTML = lines.reverse().slice(0, 120)
    .filter((l) => l.parts.length || l.pts.length)
    .map((l) => `<li data-cell="${l.cell ?? ''}"><i>${l.turn}</i><span><u>${esc(name(l.actor))}:</u> ${esc([...l.parts, ...l.pts].join(', '))}${
      l.battles.map((i) => ` <button class="lb" data-battle="${i}" title="Показать бой">бой</button>`).join('')}</span></li>`).join('');
}

export { plural };
