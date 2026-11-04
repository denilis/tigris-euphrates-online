// Экран партии: поле, рука, карточки игроков, панель «Сейчас», журнал. Клиент только
// рисует вид от сервера: допустимые ходы приходят списком legal, ход уходит номером в нём.
import { renderBoard, sealIcon, buildingIcon, cellScreen, TREASURE_IMG } from './board.js';
import { boardChanges, ageFx, takerOf, fly, boxOf } from './fx.js';
import { api } from './api.js';
import { renderWarDock, warActive } from './war.js';
import { renderEnd } from './end.js';
import { battlesIn, battleCard, seenAfterUndo } from './battle.js';
import { fmt, fmtTotal, clockNow } from './clock.js';
import { pickableLeader, hitCells, squareCells } from './pick.js';
import { trailMarks, ageMarks, liveMarks } from './trail.js';
import { stockItems } from './stock.js';
import { initPanels, holdNowOpen } from './panels.js';
import { stopLabel } from './layout-core.js';
import { LAYERS, ALL_ON, cleanLayers } from './layers.js';
import { snapOf, soundsFor, titleFor, play, soundOn, setSound, unlockAudio, newEntries, eventSounds } from './signals.js';
import { logLines, lineHTML } from './logview.js';
import {
  HEX, RING, COLNAME, SCORE_ORDER, TILE, LEADER, LEADERACC, HERONAME, STYLES, tileImg, catImg, tokenImg, faceBg, esc, plural, copy, cells,
  unitePos, toast, momentKey,
} from './util.js';

// состояние интерфейса между перерисовками (не уходит на сервер)
const ui = { key: null, sel: null, discard: null, confirmPass: false, monSel: null, chosen: new Set(), collapsed: false, flash: null, layers: loadLayers(), trail: [], trailSeen: new Map(), trailCode: null };

// слои поля: включены по умолчанию, выбор помнит браузер; прежняя кнопка «Метки» хранила свое
function loadLayers() {
  try { return cleanLayers(JSON.parse(localStorage.getItem('tigris.layers')), localStorage.getItem('tigris.owners')); } catch { return { ...ALL_ON }; }
}

function toggleLayer(id) {
  ui.layers = { ...ui.layers, [id]: !ui.layers[id] };
  try { localStorage.setItem('tigris.layers', JSON.stringify(ui.layers)); } catch { /* без памяти */ }
  draw();
}

// в уроке текст говорит о метках на поле, поэтому там видны все слои и ползунков нет
const layersOf = () => (ctl.lesson ? ALL_ON : ui.layers);

// вид монумента из настроек стола (выбор Дениса 03.11); у столов до 03.11 настройки нет, там «Печать»
const monOf = (view) => view.options.monument || 'enamel';

// вид поля: как выбрал хозяин стола, но игрок может сменить его для себя, браузер помнит по столу
const LOOKS = ['relief', 'cells'];
function lookOf(view) {
  if (ui.lookCode !== view.code) {
    ui.lookCode = view.code;
    try { ui.look = localStorage.getItem('tigris.look.' + view.code); } catch { ui.look = null; }
  }
  if (LOOKS.includes(ui.look)) return ui.look;
  return LOOKS.includes(view.options.look) ? view.options.look : 'relief';
}

function resetFor(view) {
  // новый момент партии: прежний выбор больше не к месту
  const key = momentKey(view);
  if (key === ui.key) return;
  Object.assign(ui, { key, sel: null, discard: null, confirmPass: false, monSel: null, chosen: new Set(), collapsed: false });
}

const FOLD = '<button class="fold" aria-label="Свернуть или развернуть блок" title="Свернуть или развернуть"><svg viewBox="0 0 12 12" width="12" height="12"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2"/></svg></button>';

const SKELETON = `<div class="app" id="game">
  <header class="top">
    <a class="brand" href="#/">Тигр и Евфрат</a>
    <button class="code" id="gCode" title="Скопировать ссылку на стол"></button>
    <div class="badges" id="gBadges"></div>
    <div class="layers" id="gLayers" role="group" aria-label="Слои поля, меняются только у вас">${LAYERS.map((l) => `<button class="sw" role="switch" data-layer="${l.id}" title="${l.title}"><i></i>${l.label}</button>`).join('')}<button class="sw" role="switch" id="gSound" title="Тихий щелчок, когда закончился ход, и звон, когда решать вам"><i></i>Звук</button></div>
    <div class="meta"><span id="gBagBox">в мешке <b id="gBag"></b></span><span>ход <b id="gTurn"></b></span></div>
    <nav class="nav"><button class="navbtn" id="gLook" title="Вид поля, меняется только у вас"></button><a class="navbtn" href="#/rules">Правила</a><a class="navbtn" href="#/stats">Статистика</a><a class="navbtn" href="#/tables">Мои столы</a></nav>
  </header>
  <main class="boardwrap"><svg id="board" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Поле"></svg></main>
  <div class="sizer" id="gSizer" role="separator" aria-orientation="vertical" title="Потяните, чтобы изменить ширину панели. Двойной щелчок вернет ширину по умолчанию"></div>
  <aside class="side" id="gSide">
    <section data-block="players"><div class="blockhead" title="Потяните, чтобы переставить блок"><h3>Игроки</h3>${FOLD}</div><div class="bbody"><div class="players" id="gPlayers"></div></div></section>
    <section data-block="stock"><div class="blockhead" title="Потяните, чтобы переставить блок"><h3>Запас</h3>${FOLD}</div><div class="bbody"><div class="stock" id="gStock"></div></div></section>
    <section class="now" data-block="now"><div class="blockhead" title="Потяните, чтобы переставить блок"><h3 id="gNowHead"></h3>${FOLD}</div><div class="bbody" id="gNow"></div></section>
    <section class="log" data-block="log"><div class="blockhead" title="Потяните, чтобы переставить блок"><h3>Журнал</h3>${FOLD}</div><div class="bbody"><ol id="gLog"></ol></div></section>
    <div class="sidefoot"><button class="linkbtn" id="gSideMove"></button><button class="linkbtn" id="gHandMove" title="Рука в свободном поле сбоку: карта станет выше"></button><button class="linkbtn" id="gLayoutReset">Сбросить вид</button></div>
  </aside>
  <footer class="hand" id="gHand"></footer>
  <div id="gLessonSlot"></div>
  <div class="pausebox" id="gPause" hidden></div>
  <div class="nudge" id="gNudge" role="status" hidden><b>Ваш ход!</b><span>Сделайте ход</span><i data-clock="over"></i></div>
  <div class="modal" id="gDock" hidden></div>
  <div class="battle" id="gBattle" hidden></div>
  <div class="endwrap" id="gEnd" hidden></div>
</div>`;

/**
 * Нарисовать партию в root. act(body) отправляет действие стола, go(hash) переходит.
 * lesson: { panel, cells, pick, hint, miss, selected } включает режим урока (lesson.js).
 */
export function renderGame(root, view, { act, go, lesson = null }) {
  if (!root.querySelector('#game')) {
    root.innerHTML = SKELETON;
    initPanels(root);
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
    root.querySelector('#gLayers').addEventListener('click', (e) => {
      const b = e.target.closest('[data-layer]');
      if (b) toggleLayer(b.dataset.layer);
    });
    root.querySelector('#gSound').addEventListener('click', () => {
      setSound(!soundOn());
      draw();
    });
    unlockAudio();
    root.querySelector('#gLook').addEventListener('click', () => {
      ui.look = lookOf(current) === 'relief' ? 'cells' : 'relief';
      try { localStorage.setItem('tigris.look.' + current.code, ui.look); } catch { /* без памяти */ }
      draw();
    });
  }
  current = view;
  ctl = { act, go, root, lesson };
  resetFor(view);
  const entries = newEntries(ui.snap, view); // до signal: он запомнит новый снимок
  signal(view, entries);
  updateFx(view, entries);
  draw();
  flyCubes();
}

/** Звук и вспышка рамки при новом виде стола (в уроке тихо: там ходы по шагам). entries — новое в журнале. */
function signal(view, entries) {
  const snap = snapOf(view), was = ui.snap;
  ui.snap = snap;
  if (ctl.lesson) return;
  const s = soundsFor(was, snap);
  play({ ...s, events: eventSounds(entries, view.me, view.game.result) });
  if (!s.chime) return;
  const app = ctl.root.querySelector('#game');
  app.classList.add('myturn-start'); // три вспышки золотой рамки в начале своего хода
  clearTimeout(ui.flashTurn);
  ui.flashTurn = setTimeout(() => app.classList.remove('myturn-start'), 2600);
}

/**
 * Анимации поля (04.11): что изменилось с прошлого вида этого стола. При первом взгляде на стол,
 * другом столе и в уроке эффектов нет. Взятые сокровища ждут перелета к карточке взявшего.
 */
function updateFx(view, entries) {
  const g = view.game, same = ui.fxCode === view.code && !ctl.lesson;
  const fresh = same ? boardChanges(ui.fxPrev, g) : [];
  ui.fxCode = view.code;
  ui.fxPrev = { board: { tile: [...g.board.tile], treasure: [...g.board.treasure] }, monuments: g.monuments.map((m) => ({ id: m.id, pos: m.pos })) };
  ui.fx = ageFx(same ? ui.fx : [], fresh, Date.now());
  ui.cubes = fresh.filter((f) => f.kind === 'cube').map((f) => ({ pos: f.pos, seat: takerOf(entries, f.pos) }));
}

/** Кубик сокровища улетает со храма к значку сокровищ в карточке того, кто его взял. */
function flyCubes() {
  const list = ui.cubes || [];
  ui.cubes = [];
  for (const c of list) {
    const target = c.seat == null ? null : ctl.root.querySelector(`.pc[data-seat="${c.seat}"] .cube`);
    const from = cellScreen(ctl.root.querySelector('#board'), c.pos);
    if (!from || !target) continue;
    const k = 0.24; // кубик меньше клетки: летит его размер, а не вся клетка
    const box = { x: from.x + from.w * (0.5 - k / 2), y: from.y + from.h * (0.5 - k / 2), w: from.w * k, h: from.h * k };
    setTimeout(() => fly(TREASURE_IMG, box, boxOf(target), { ms: 750, round: 2 }), 320);
  }
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

/** Отмена уходит одним запросом: второй щелчок дал бы ложное «Стол уже изменился». */
async function undoMove() {
  if (ui.undoing) return;
  ui.undoing = true;
  await ctl.act({ action: 'undo', version: current.version });
  ui.undoing = false;
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
  if (idx >= 0) {
    // свой тайл или катастрофа летит из руки в клетку (анимации 04.11)
    if (g.phase === 'action' && (ui.sel?.kind === 'tile' || ui.sel?.kind === 'cat')) {
      fly(ui.sel.kind === 'tile' ? tileImg(ui.sel.color) : catImg, boxOf(ctl.root.querySelector('#gHand .ht.sel')), cellScreen(ctl.root.querySelector('#board'), i));
    }
    move(idx);
  } else ctl.lesson?.miss(g.phase === 'action' ? ui.sel : undefined, i);
}

function boardOpts() {
  const { g, me, myP, legal, decides } = D();
  ui.fx = ageFx(ui.fx || [], [], Date.now());
  const o = { flash: ui.flash, layers: layersOf(), unite: unitePos(g), trail: ui.trail, lesson: ctl.lesson?.cells, monument: monOf(current), fx: ui.fx };
  const k = g.ctx?.war || g.ctx?.revolt;
  if (k && (g.phase === 'warSupport' || g.phase === 'revoltSupport')) {
    o.conflict = { k, kind: g.ctx.war ? 'war' : 'revolt', myExtra: ui.chosen.size, me };
  }
  if (!decides) return o;
  if (g.phase === 'action' && ui.sel) {
    const type = { tile: 'tile', leader: 'leader', cat: 'catastrophe' }[ui.sel.kind];
    o.targets = legal.filter((m) => m.type === type && (type === 'catastrophe' || m.color === ui.sel.color)).map((m) => m.pos);
  } else if (g.phase === 'build') {
    // куда можно поставить здание, ярко мигает (просьба Дениса 04.11)
    o.targets = legal.filter((m) => m.type === 'build').map((m) => m.pos);
    o.blink = 'build';
  } else if (g.phase === 'treasure') {
    // какие сокровища можно взять, ярко мигают (просьба Дениса 04.11)
    o.targets = legal.filter((m) => m.type === 'treasure').map((m) => m.pos);
    o.blink = 'treasure';
  }
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
  ui.trail = ageMarks(liveMarks(trailMarks(g.log, view.me), g.board), ui.trailSeen, Date.now(), first).map((m) => ({ ...m, hero: seat(m.actor)?.hero }));
}

/** Запас: что еще можно построить. Перерисовывается, только когда что-то построили. */
function drawStock({ view, g, legal, decides }) {
  const el = ctl.root.querySelector('#gStock');
  const s = stockItems(g, view.options);
  // что сейчас строится (просьба Дениса 04.11): здание своего цвета мигает, из монументов подсвечены
  // только те, что можно поставить, остальные притушены
  const monNow = decides && g.phase === 'monument' ? new Set(legal.filter((m) => m.type === 'monument').map((m) => m.id)) : null;
  const bldNow = decides && g.phase === 'build' ? g.ctx?.color ?? null : null;
  const key = JSON.stringify(s) + monOf(view) + [...(monNow || [])] + ':' + bldNow + ':' + Boolean(monNow);
  if (key === ui.stockKey && el.firstChild) return;
  ui.stockKey = key;
  // крупно (просьба Дениса 03.11): монументы по три в ряд, чтобы читались цвета
  const item = (x, icon, hot = false, dim = false) => `<span class="sit${x.built ? ' built' : ''}${hot ? ' blink' : ''}${dim ? ' dim' : ''}" title="${esc(x.title)}">${icon}</span>`;
  el.innerHTML = `<div class="slbl">Монументы</div><div class="mons">${s.monuments.map((m) => item(m, sealIcon(m.c1, m.c2, 80, monOf(view)), monNow?.has(m.id), monNow && !m.built && !monNow.has(m.id))).join('')}</div>`
    + (s.buildings || s.wonder ? `<div class="slbl">Здания</div><div class="blds">${[
      ...(s.buildings || []).map((b) => item(b, buildingIcon(b.c, 44), bldNow === b.c)),
      s.wonder ? item(s.wonder, '<span class="wonderico"></span>') : '',
    ].join('')}</div>` : '');
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
  // мешок только процентом (просьба Дениса 04.11): число тайлов не показываем
  root.querySelector('#gBag').textContent = g.bagPct + '%';
  root.querySelector('#gBagBox').title = 'Сколько тайлов осталось в мешке, в процентах от мешка после выкладки стартовых храмов';
  root.querySelector('#gTurn').textContent = g.turn;
  root.querySelectorAll('#gLayers [data-layer]').forEach((b) => b.setAttribute('aria-checked', String(ui.layers[b.dataset.layer])));
  root.querySelector('#gSound').setAttribute('aria-checked', String(soundOn()));
  root.querySelector('#game').classList.toggle('myturn', !ctl.lesson && snapOf(view).mine); // золотая рамка поля, пока решать вам
  const look = lookOf(view);
  root.querySelector('#gLook').textContent = look === 'relief' ? 'Поле: рельеф' : 'Поле: клетки';
  renderBoard(root.querySelector('#board'), g, d.heroOf, boardOpts(), look);
  drawPlayers(d);
  drawStock(d);
  drawNow(d);
  drawLog(d);
  drawHand(d);
  const dock = root.querySelector('#gDock');
  const dockState = renderWarDock(dock, view, ui, { move, redraw: draw, undo: undoMove });
  const app = root.querySelector('#game');
  app.classList.toggle('conflict', Boolean(dockState) && !ui.collapsed);
  app.classList.toggle('locked', dockState === 'decide'); // кто ждет, тому шапка нажимается, журнал виден после «Свернуть»
  app.classList.toggle('waiting', dockState === 'wait' || dockState === 'watch');
  app.classList.toggle('lesson', Boolean(ctl.lesson));
  // в бою окно занимает место панели урока, поэтому текст урока переезжает внутрь окна
  if (ctl.lesson) (dockState && !ui.collapsed ? dock.querySelector('.mcard') : root.querySelector('#gLessonSlot')).prepend(ctl.lesson.panel);
  ctl.lesson?.selected(ui.sel);
  drawBattle(d);
  drawPause(d);
  renderEnd(root.querySelector('#gEnd'), view, ctl);
}

// --- пауза (просьба Дениса 03.11): поле видно, поверх него карточка сбора игроков

const two = (n) => String(n).padStart(2, '0');
const PEOPLE = ['', 'один', 'двое', 'трое', 'четверо'];

function drawPause({ view, g, seat }) {
  const box = ctl.root.querySelector('#gPause');
  const p = g.paused;
  box.hidden = !p || Boolean(ctl.lesson);
  if (box.hidden) return;
  const key = JSON.stringify(p) + ':' + view.me;
  if (box.dataset.key === key) return; // не перерисовываем зря: кнопка под пальцем не должна пропадать
  box.dataset.key = key;
  const humans = view.seats.filter((s) => s.kind === 'human');
  const solo = humans.length === 1, seated = humans.some((s) => s.id === view.me), meReady = p.ready.includes(view.me);
  const at = new Date(p.at);
  const rows = humans.map((s) => {
    const ok = p.ready.includes(s.id);
    const call = !ok && seated && s.id !== view.me ? `<button class="btn sm" data-call="${s.id}">Позвать</button>` : '';
    return `<li class="${ok ? 'ok' : ''}"><span>${ok ? '✓' : '○'}</span><b>${esc(s.name || 'Игрок')}${s.id === view.me ? ' <small>(вы)</small>' : ''}</b>${call}</li>`;
  }).join('');
  box.innerHTML = `<div class="pcard2" role="dialog" aria-label="Партия на паузе">
    <h2>Партия на паузе</h2>
    <p class="msub">Поставил ${esc(seat(p.by)?.name || 'игрок')}, ${two(at.getDate())}.${two(at.getMonth() + 1)} ${two(at.getHours())}:${two(at.getMinutes())}</p>
    ${solo ? '' : `<p class="msub">Сбор игроков:</p><ul class="preadys">${rows}</ul>`}
    ${seated && !meReady ? `<button class="btn primary" id="pReady">${solo ? 'Продолжить' : 'Я на месте'}</button>` : ''}
    <p class="mnote">${solo ? 'Партия стоит, пока вы не нажмете «Продолжить».' : `Продолжим, когда все ${PEOPLE[humans.length]} нажмут «Я на месте». Время на ход после паузы начнется заново.`}</p>
  </div>`;
  box.querySelector('#pReady')?.addEventListener('click', () => ctl.act({ action: 'ready' }));
  box.querySelectorAll('[data-call]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await api('POST', 'invite', { code: view.code, to: [+b.dataset.call] });
      toast(`Позвали: ${seat(+b.dataset.call)?.name || 'игрок'}`);
    } catch (e) { toast(e.message); b.disabled = false; }
  }));
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
  if (ui.battleCode !== view.code) Object.assign(ui, { battleCode: view.code, battleSeen: g.log.length, battleShow: null, battleEpoch: g.logEpoch });
  // в уроке на телефоне карточка закрыла бы текст урока, а итог боя он рассказывает сам
  if (ctl.lesson && matchMedia('(max-width:900px)').matches) ui.battleSeen = g.log.length;
  if (ui.battleEpoch !== g.logEpoch) Object.assign(ui, { battleEpoch: g.logEpoch, battleSeen: seenAfterUndo(g.log, ui.battleSeen) });
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
    // лидеры двумя группами жетонами героя (просьба Дениса 03.11): черный кружок в руке и на поле
    // выглядел одинаково, теперь место видно по группе, а не по оттенку
    const tok = (c) => `<i class="ltok" title="${LEADER[c]}" style="border-color:${RING[c]};background-image:url(${tokenImg(s.hero, c)})"></i>`;
    const group = (label, on) => {
      const cs = [0, 1, 2, 3].filter((c) => (pl.leaders[c] >= 0) === on);
      return `<span class="lgrp"><small>${label}</small>${cs.length ? cs.map(tok).join('') : '<em>нет</em>'}</span>`;
    };
    const tr = pl.treasures ?? '?';
    const sc = pl.score
      ? `<span class="sc" title="очки: ${SCORE_ORDER.map((c) => COLNAME[c]).join(', ')}">${SCORE_ORDER.map((c) => `<span style="background:${HEX[c]}${c === 3 ? ';outline:1px solid #cfc6b4' : ''}">${pl.score[c]}</span>`).join('')}</span>`
      : '<span class="sc hid" title="закрытый счет: очки соперников не видны">счет скрыт</span>';
    const bot = s.kind === 'bot' ? `<span class="tag" title="${esc(STYLES[s.bot?.style] || '')}, сила ${s.bot?.strength ?? ''}">бот</span>` : '';
    return `<div class="pc${deciding ? ' deciding' : active ? ' active' : ''}" data-seat="${pl.seat}">
      <div class="av" style="background-image:${faceBg(s, pl.seat === me ? 0 : 3)}"></div>
      <div class="nm">${esc(s.name || 'Бот')}${pl.seat === me ? ' <small>(вы)</small>' : ''} <small>${HERONAME[s.hero] || ''}</small> ${bot} ${tag}</div>
      <span class="tm">${pl.handCount} в руке</span>
      <div class="leaders">${group('на поле', true)}${group('в руке', false)}</div>
      <div class="row"><span class="cnt" title="катастрофы"><i class="cat" style="background-image:url(${catImg})"></i>${pl.cats}</span><span class="cnt" title="${pl.treasures == null ? 'сокровища соперника скрыты, как и очки' : 'сокровища'}"><i class="cube"></i>${tr}</span>${sc}</div>${
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
  el.closest('section').hidden = Boolean(ctl.lesson && !decides); // на шаге без хода говорит панель урока
  const btn = (id, label, cls = '') => `<button class="btn ${cls}" data-act="${id}">${label}</button>`;
  let title = 'Сейчас', body = '', buttons = '';
  if (g.stopped) {
    title = 'Партия завершена';
    body = '<p>Организатор завершил партию досрочно. Итога нет, в статистику она не идет.</p>';
  } else if (g.over) {
    title = 'Партия окончена';
    body = `<p>${g.endReason === 'bag' ? 'В мешке кончились тайлы.' : 'На поле осталось два сокровища.'}</p>`;
  } else if (g.paused) {
    title = 'Пауза';
    body = '<p>Партия на паузе: ходы, боты и часы стоят.</p>';
  } else if (!decides) {
    const bot = seat(g.toMove)?.kind === 'bot';
    body = `<p>${waitingText(d)}</p>${bot ? '<p class="wait">Бот думает<i></i><i></i><i></i></p>' : ''}`;
    if (g.canUndo) buttons = btn('undo', 'Отменить действие'); // тайл ходящего столкнул других игроков
  } else if (warActive(view)) {
    title = 'Решаете вы';
    body = '<p>Открыто окно конфликта, партия ждет вашего решения.</p>';
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
      // крупнее (просьба Дениса 04.11): по мелкой плитке цвета не различить
      return `<button class="monopt${ui.monSel === id ? ' on' : ''}" data-mon="${id}">${sealIcon(mon.c1, mon.c2, 84, monOf(view))}<span>${COLNAME[mon.c1]} и ${COLNAME[mon.c2]}</span></button>`;
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
  const clk = g.clock && !g.over && !g.stopped ? '<span class="clk" data-clock="turn" title="Время на ход; сверх него идет в минус"></span>' : '';
  ctl.root.querySelector('#gNowHead').innerHTML = title + clk;
  el.innerHTML = `${body}${buttons ? `<div class="nowbtns">${buttons}</div>` : ''}`;
  holdNowOpen(Boolean(decides || g.canUndo));
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
  else if (a === 'undo') undoMove();
  else if (a === 'discardYes') {
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
  // сдаться или завершить партию может только организатор, кнопка видна и в чужой ход
  const label = view.isHost && !g.over && !g.stopped ? stopLabel(view.seats, view.me) : null;
  // пауза (просьба Дениса 03.11): любой человек за столом, если не успели доиграть
  const canPause = !ctl.lesson && view.seats.some((s) => s.id === view.me && s.kind === 'human') && !g.over && !g.stopped && !g.paused;
  const stop = (canPause ? '<button class="btn" data-pause title="Не успели доиграть: партия встанет, вернуться к ней можно позже">Пауза</button>' : '')
    + (label ? `<button class="btn" data-stop>${label}</button>` : '');
  const bindStop = () => {
    el.querySelector('[data-stop]')?.addEventListener('click', () => {
      const q = label === 'Сдаться' ? 'Сдаться? Партия закончится, итога не будет, в статистику она не пойдет.' : 'Завершить партию для всех игроков? Итога не будет, в статистику она не пойдет. Вернуть ее нельзя.';
      if (confirm(q)) ctl.act({ action: 'close' });
    });
    el.querySelector('[data-pause]')?.addEventListener('click', () => {
      if (confirm('Поставить партию на паузу? Ходы и часы встанут. Продолжим, когда все игроки нажмут «Я на месте».')) ctl.act({ action: 'pause' });
    });
  };
  if (myP < 0) {
    el.innerHTML = `<div class="hint">Вы смотрите партию со стороны.</div><div class="hrow"><div class="acts">${stop}</div></div>`;
    bindStop();
    return;
  }
  const acting = decides && g.phase === 'action' && !ui.confirmPass;
  const pl = g.players[myP];
  const has = (type, c) => legal.some((m) => m.type === type && (c == null || m.color === c));
  const pick = ctl.lesson?.pick; // что взять на этом шаге урока
  const mark = (kind, c) => (pick?.kind === kind && (pick.color == null || pick.color === c) ? ' lessonpick' : '');
  const tiles = handColors(view).map((c, k) => {
    const on = ui.discard ? ui.discard.has(k) : ui.sel?.kind === 'tile' && ui.sel.color === c && handColors(view).indexOf(c) === k;
    const can = acting && (ui.discard || has('tile', c));
    return `<button class="ht${on ? ' sel' : ''}${can ? '' : ' idle'}${handColors(view).indexOf(c) === k ? mark('tile', c) : ''}" data-tile="${k}" data-c="${c}" title="${TILE[c]}" style="background-image:url(${tileImg(c)})"></button>`;
  }).join('');
  const hero = view.seats.find((s) => s.id === view.me)?.hero;
  const leaders = [0, 1, 2, 3].map((c) => {
    const on = pl.leaders[c] >= 0;
    const can = acting && !ui.discard && (has('leader', c) || has('withdraw', c));
    return `<button class="hl${on ? ' onb' : ''}${ui.sel?.kind === 'leader' && ui.sel.color === c ? ' sel' : ''}${can ? '' : ' idle'}${mark('leader', c)}" data-leader="${c}" title="${LEADER[c]}${on ? ', на поле' : ''}" style="border-color:${RING[c]};background-image:url(${tokenImg(hero, c)})"></button>`;
  }).join('');
  const cats = [0, 1].map((k) => {
    const can = acting && !ui.discard && k < pl.cats && has('catastrophe');
    return `<button class="ht${k >= pl.cats ? ' used' : ''}${ui.sel?.kind === 'cat' && k === 0 ? ' sel' : ''}${can ? '' : ' idle'}${k === 0 ? mark('cat') : ''}" data-cat="${k}" title="катастрофа" style="background-image:url(${catImg})"></button>`;
  }).join('');
  let hint = '';
  if (g.paused) hint = 'Партия на паузе. Рука видна, но не нажимается.';
  else if (!decides) hint = 'Ход другого игрока. Рука видна, но не нажимается.';
  else if (warActive(view)) hint = 'Идет конфликт: решите в его окне.';
  else if (g.phase === 'action') hint = ui.discard ? 'Сброс: нажмите тайлы в руке, которые сбрасываете, и подтвердите кнопкой рядом.' : ui.sel ? 'Нажмите подсвеченную клетку на поле. Повторный клик по выбранному снимает выбор.' : `Действие ${g.actionNo} из 2. Выберите тайл, лидера (внизу или на поле) или катастрофу.`;
  else if (g.phase === 'confirm') hint = 'Ход сделан: завершите его или отмените действие на панели.';
  else hint = 'Решите на панели.';
  if (ctl.lesson) hint = ctl.lesson.hint;
  el.className = 'hand' + (acting ? '' : ' locked');
  el.innerHTML = `<div class="hint">${hint}</div>
    <div class="hrow">
      <div class="grp"><span>Рука</span><div class="items">${tiles}</div></div>
      <div class="grp"><span>Лидеры</span><div class="items">${leaders}</div></div>
      <div class="grp"><span>Катастрофы</span><div class="items">${cats}</div></div>
      <div class="acts">
        ${stop}
        ${acting && has('discard') && !ui.discard ? '<button class="btn" data-hand="discard">Сбросить тайлы</button>' : ''}
        ${acting && ui.discard ? `<button class="btn primary" data-now="discardYes" ${ui.discard.size ? '' : 'disabled'}>${ui.discard.size ? `Сбросить ${ui.discard.size}` : 'Выберите тайлы'}</button><button class="btn" data-now="cancel">Отмена</button>` : ''}
        ${acting && has('pass') ? '<button class="btn" data-hand="pass">Пас</button>' : ''}
      </div>
    </div>`;
  bindStop();
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
  // сброс подтверждается там же, внизу, где его начали (просьба Дениса 04.11); на панели справа те же кнопки
  el.querySelectorAll('[data-now]').forEach((b) => b.addEventListener('click', () => onNow(b.dataset.now)));
  el.querySelectorAll('[data-hand]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.hand === 'discard') Object.assign(ui, { discard: new Set(), sel: null });
    else Object.assign(ui, { confirmPass: true, sel: null });
    draw();
  }));
}

// --- время (просьбы Дениса 29.10): у решающего таймер хода, сверх него минус и красный,
// у каждого игрока копится время за партию. Цифры обновляются 4 раза в секунду без перерисовки.

function updateClocks() {
  // заголовок вкладки и мигающая надпись (просьба Дениса 03.11): видно и из другой вкладки
  const onGame = Boolean(current?.game && ctl?.root.querySelector('#game'));
  const g = onGame ? current.game : null, k = g ? clockNow(g) : null;
  const mine = onGame && !ctl.lesson && snapOf(current).mine && g.phase !== 'confirm';
  const overdue = mine && Boolean(k?.live) && k.left <= 0;
  // время хода вышло: один раз напомнить звуком (просьба Дениса 04.11: «не слышно, что я должен ходить»)
  if (overdue && !ui.overdueRang && !ctl.lesson) play({ remind: true });
  ui.overdueRang = overdue;
  const title = titleFor(document.title, mine, overdue, Date.now());
  if (title !== document.title) document.title = title;
  if (!onGame) return;
  const nudge = ctl.root.querySelector('#gNudge');
  if (nudge.hidden === overdue) nudge.hidden = !overdue;
  if (overdue) {
    // в свободном поле сбоку от карты; если оно уже надписи, надпись встает полосой в шапку, а не на клетки
    const b = ctl.root.querySelector('.boardwrap').getBoundingClientRect(), app = ctl.root.querySelector('#game');
    // рука сбоку занимает свободное поле: тогда надпись всегда в шапке
    const room = app.classList.contains('handside') ? 0 : app.classList.contains('sideleft') ? innerWidth - b.right : b.left;
    nudge.classList.toggle('slim', room < 220);
  }
  if (!k) return;
  for (const el of ctl.root.querySelectorAll('[data-clock]')) {
    const kind = el.dataset.clock;
    if (kind === 'over') {
      if (overdue) el.textContent = fmt(k.left);
    } else if (kind === 'turn') {
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
  const myDecision = g.toMove === current.me && g.phase !== 'confirm';
  const warnKey = `${current.code}:${g.turn}:${g.toMove}:${g.phase === 'action' ? 'act' : g.phase}`;
  if (k.live && myDecision && k.left <= 0 && ui.warned !== warnKey) {
    ui.warned = warnKey;
    toast('Время хода вышло: таймер ушел в минус');
  }
}

// --- журнал

function drawLog({ g, seat }) {
  // в журнале имена, а не «вы»: так читаются обороты вроде «атакует Бот, защищается Денис»
  const name = (id) => seat(id)?.name || 'Бот';
  ctl.root.querySelector('#gLog').innerHTML = logLines(g.log, name).reverse().slice(0, 120)
    .filter((l) => l.parts.length || l.pts.length || l.wars.length)
    .map((l) => `<li data-cell="${l.cell ?? ''}"><i>${l.turn}</i><div class="lbody">${lineHTML(l, name)}</div></li>`).join('');
}

export { plural };
