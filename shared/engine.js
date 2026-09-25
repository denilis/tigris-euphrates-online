/*
 * Tigris & Euphrates — rules engine.
 *
 * Shared by the server (authoritative online games) and the browser (games on one device).
 * Rules follow the official Fantasy Flight Games rulebook (standard board, base game).
 *
 * The engine is pure data in / data out: applyAction() never mutates the state it gets,
 * so an invalid or malformed action can neither corrupt a game nor crash the host.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TE = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// ─── BOARD ─────────────────────────────────────────────────────────────────────

const COLS = 16, ROWS = 11, SIZE = COLS * ROWS;
const cellIndex = (c, r) => r * COLS + c;

// Squares the painted rivers of assets/board/field.png flow through (column, row).
const RIVER_COORDS = [
  [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2],
  [3, 3], [9, 3], [10, 3], [11, 3], [12, 3],
  [1, 4], [2, 4], [3, 4], [12, 4], [13, 4], [14, 4], [15, 4],
  [1, 5], [15, 5],
  [0, 6], [1, 6],
  [0, 7], [1, 7], [2, 7], [12, 7], [13, 7], [14, 7], [15, 7],
  [0, 8], [1, 8], [2, 8], [3, 8], [11, 8], [12, 8],
  [3, 9], [11, 9],
  [3, 10], [7, 10], [8, 10], [9, 10], [10, 10], [11, 10]
];
// Shedu squares: each starts with a temple carrying a treasure.
const TEMPLE_COORDS = [[5, 0], [10, 1], [1, 2], [14, 3], [7, 4], [2, 6], [10, 8], [0, 9], [14, 9], [5, 10]];

const RIVER = new Array(SIZE).fill(false);
RIVER_COORDS.forEach(([c, r]) => { RIVER[cellIndex(c, r)] = true; });
const START_TEMPLES = TEMPLE_COORDS.map(([c, r]) => cellIndex(c, r));

const NEIGHBORS = [];
for (let i = 0; i < SIZE; i++) {
  const c = i % COLS, r = (i - c) / COLS, n = [];
  if (r > 0) n.push(i - COLS);
  if (c < COLS - 1) n.push(i + 1);
  if (r < ROWS - 1) n.push(i + COLS);
  if (c > 0) n.push(i - 1);
  NEIGHBORS.push(n);
}

// ─── GAME CONSTANTS ────────────────────────────────────────────────────────────

const VERSION = 2;
// red = temples / priest, blue = farms / farmer, green = markets / trader, black = settlements / king
const COLORS = ['red', 'blue', 'green', 'black'];
const DYNASTIES = ['lion', 'bow', 'pot', 'bull'];
const MONUMENTS = [
  { id: 0, colors: ['green', 'black'] },
  { id: 1, colors: ['green', 'blue'] },
  { id: 2, colors: ['blue', 'red'] },
  { id: 3, colors: ['red', 'green'] },
  { id: 4, colors: ['red', 'black'] },
  { id: 5, colors: ['blue', 'black'] }
];
// 153 civilization tiles minus the 10 starting temples.
const BAG = { red: 47, blue: 36, green: 30, black: 30 };
const HAND_SIZE = 6;
const ACTIONS_PER_TURN = 2;
const CATASTROPHES = 2;
const MIN_PLAYERS = 2, MAX_PLAYERS = 4;
const END_TREASURES = 2;
const LOG_KEEP = 300, LOG_VIEW = 120;

// ─── RUSSIAN WORDING ───────────────────────────────────────────────────────────

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
const TILE_WORDS = { // accusative: 1 / 2-4 / 5+
  red: ['храм', 'храма', 'храмов'],
  blue: ['ферму', 'фермы', 'ферм'],
  green: ['рынок', 'рынка', 'рынков'],
  black: ['поселение', 'поселения', 'поселений']
};
const TILE_DESTROYED = {
  red: 'уничтожен храм', blue: 'уничтожена ферма', green: 'уничтожен рынок', black: 'уничтожено поселение'
};
const COLOR_ADJ = { red: 'красный', blue: 'синий', green: 'зелёный', black: 'чёрный' };
const LEADER_NOM = { red: 'жрец', blue: 'земледелец', green: 'торговец', black: 'царь' };
const LEADER_ACC = { red: 'жреца', blue: 'земледельца', green: 'торговца', black: 'царя' };
const LEADER_GEN_PL = { red: 'жрецов', blue: 'земледельцев', green: 'торговцев', black: 'царей' };
const VP_ADJ = { // 1 / 2+
  red: ['красное', 'красных'], blue: ['синее', 'синих'],
  green: ['зелёное', 'зелёных'], black: ['чёрное', 'чёрных']
};
const tilesText = (color, n) => `${n} ${plural(n, ...TILE_WORDS[color])}`;
const vpText = (color, n) =>
  `${n} ${n % 10 === 1 && n % 100 !== 11 ? VP_ADJ[color][0] : VP_ADJ[color][1]} ${plural(n, 'очко', 'очка', 'очков')}`;

// ─── ERRORS, RNG, UTILITIES ────────────────────────────────────────────────────

class RuleError extends Error {
  constructor(message) { super(message); this.name = 'RuleError'; }
}
function fail(message) { throw new RuleError(message); }

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

const clone = x => JSON.parse(JSON.stringify(x));
const colorOrder = (a, b) => COLORS.indexOf(a) - COLORS.indexOf(b);

function checkCell(x) {
  if (!Number.isInteger(x) || x < 0 || x >= SIZE) fail('Некорректная клетка');
  return x;
}
function checkColor(c) {
  if (!COLORS.includes(c)) fail('Некорректный цвет');
  return c;
}
function removeFromHand(hand, color, count) {
  for (let k = 0; k < count; k++) hand.splice(hand.indexOf(color), 1);
}
const countInHand = (hand, color) => hand.reduce((n, c) => n + (c === color ? 1 : 0), 0);

// ─── BOARD QUERIES ─────────────────────────────────────────────────────────────

const linkable = cell => !!cell && cell.k !== 'cat';
const isTemple = cell => !!cell && cell.k === 'tile' && cell.c === 'red' && !cell.down;
const isLeader = cell => !!cell && cell.k === 'leader';

// Squares linked to `start` (tiles and leaders with common edges), skipping `blocked`.
function groupAt(board, start, blocked) {
  const cells = [], leaders = [], set = new Set();
  if (start === blocked || !linkable(board[start])) return { cells, leaders, set };
  set.add(start);
  const stack = [start];
  while (stack.length) {
    const i = stack.pop();
    cells.push(i);
    if (isLeader(board[i])) leaders.push(i);
    for (const n of NEIGHBORS[i]) {
      if (n !== blocked && !set.has(n) && linkable(board[n])) { set.add(n); stack.push(n); }
    }
  }
  return { cells, leaders, set };
}

function allGroups(board, blocked) {
  const seen = new Set(), groups = [];
  for (let i = 0; i < SIZE; i++) {
    if (i === blocked || seen.has(i) || !linkable(board[i])) continue;
    const g = groupAt(board, i, blocked);
    g.cells.forEach(c => seen.add(c));
    groups.push(g);
  }
  return groups;
}

// Distinct kingdoms (groups holding at least one leader) sharing an edge with square i.
function adjacentKingdoms(board, i) {
  const found = [];
  for (const n of NEIGHBORS[i]) {
    if (!linkable(board[n]) || found.some(g => g.set.has(n))) continue;
    const g = groupAt(board, n, i);
    if (g.leaders.length) found.push(g);
  }
  return found;
}

const templesAround = (board, i) => NEIGHBORS[i].filter(n => isTemple(board[n]));

function treasuresOnBoard(board) {
  let n = 0;
  for (const cell of board) if (cell && cell.tr) n++;
  return n;
}

// Face-up tiles of `color` linked to the leader, not counting squares behind `blocked`.
function supportCells(board, leaderCell, color, blocked) {
  return groupAt(board, leaderCell, blocked).cells.filter(c => {
    const cell = board[c];
    return cell.k === 'tile' && cell.c === color && !cell.down;
  });
}

// ─── PLACEMENT CHECKS (also used by the UI to highlight legal squares) ──────────

function tileError(board, color, i) {
  if (board[i]) return 'Клетка занята';
  if (color === 'blue' && !RIVER[i]) return 'Фермы кладут только на реку';
  if (color !== 'blue' && RIVER[i]) return 'На реку можно класть только фермы';
  if (adjacentKingdoms(board, i).length > 2) return 'Тайл не может объединить больше двух царств';
  return null;
}

// `board` must already have the moving leader lifted off.
function leaderError(board, i) {
  if (board[i]) return 'Клетка занята';
  if (RIVER[i]) return 'Лидера нельзя ставить на реку';
  if (!templesAround(board, i).length) return 'Лидер должен стоять рядом с храмом';
  if (adjacentKingdoms(board, i).length > 1) return 'Лидер не может объединять царства';
  return null;
}

function catastropheError(board, i) {
  const cell = board[i];
  if (!cell) return null;
  if (cell.k === 'leader') return 'Катастрофу нельзя класть на лидера';
  if (cell.k === 'cat') return 'Здесь уже катастрофа';
  if (cell.down) return 'Катастрофу нельзя класть на монумент';
  if (cell.tr) return 'Катастрофу нельзя класть на тайл с сокровищем';
  return null;
}

function tileTargets(board, color) {
  const out = [];
  for (let i = 0; i < SIZE; i++) if (!tileError(board, color, i)) out.push(i);
  return out;
}

function leaderTargets(state, player, color) {
  const board = state.board.slice();
  const from = state.players[player].leaders[color];
  if (from !== null) board[from] = null;
  const out = [];
  for (let i = 0; i < SIZE; i++) if (i !== from && !leaderError(board, i)) out.push(i);
  return out;
}

function catastropheTargets(board) {
  const out = [];
  for (let i = 0; i < SIZE; i++) if (!catastropheError(board, i)) out.push(i);
  return out;
}

// ─── STATE HELPERS ─────────────────────────────────────────────────────────────

function log(s, player, text, kind) {
  s.logSeq = (s.logSeq || 0) + 1;
  const entry = { n: s.logSeq, t: s.turn, m: text };
  if (player !== null && player !== undefined) entry.p = player;
  if (kind) entry.k = kind;
  s.log.push(entry);
  if (s.log.length > LOG_KEEP) s.log.splice(0, s.log.length - LOG_KEEP);
}

const nameOf = (s, p) => s.players[p].name;

function liftLeader(s, cell) {
  const l = s.board[cell];
  s.players[l.p].leaders[l.c] = null;
  s.board[cell] = null;
}

// Leaders must stay next to a face-up temple at all times.
function withdrawUnsupported(s) {
  s.players.forEach((pl, p) => {
    COLORS.forEach(color => {
      const at = pl.leaders[color];
      if (at !== null && !templesAround(s.board, at).length) {
        liftLeader(s, at);
        log(s, p, `${pl.name}: ${LEADER_NOM[color]} покидает поле — рядом не осталось храмов`);
      }
    });
  });
}

// Returns false when the bag ran out while drawing (the game must end).
function draw(s, p, count) {
  const hand = s.players[p].hand;
  for (let k = 0; k < count; k++) {
    if (!s.bag.length) return false;
    hand.push(s.bag.pop());
  }
  return true;
}

// ─── SETUP ─────────────────────────────────────────────────────────────────────

function createGame(opts) {
  opts = opts || {};
  const names = opts.names;
  if (!Array.isArray(names) || names.length < MIN_PLAYERS || names.length > MAX_PLAYERS) {
    throw new RuleError(`Нужно от ${MIN_PLAYERS} до ${MAX_PLAYERS} игроков`);
  }
  const rng = opts.rng || Math.random;
  const dynasties = opts.dynasties || DYNASTIES.slice(0, names.length);
  if (dynasties.length !== names.length || new Set(dynasties).size !== names.length ||
      dynasties.some(d => !DYNASTIES.includes(d))) {
    throw new RuleError('Некорректные династии');
  }

  const bag = [];
  COLORS.forEach(c => { for (let k = 0; k < BAG[c]; k++) bag.push(c); });
  shuffle(bag, rng);

  const board = new Array(SIZE).fill(null);
  START_TEMPLES.forEach(i => { board[i] = { k: 'tile', c: 'red', tr: true }; });

  const players = names.map((name, i) => ({
    name: String(name),
    dynasty: dynasties[i],
    leaders: { red: null, blue: null, green: null, black: null },
    catastrophes: CATASTROPHES,
    hand: bag.splice(bag.length - HAND_SIZE, HAND_SIZE),
    vp: { red: 0, blue: 0, green: 0, black: 0 },
    treasures: 0
  }));

  const first = Number.isInteger(opts.firstPlayer) && opts.firstPlayer >= 0 && opts.firstPlayer < names.length
    ? opts.firstPlayer
    : Math.floor(rng() * names.length);

  const s = {
    v: VERSION,
    id: typeof opts.id === 'string' ? opts.id : Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    board,
    bag,
    players,
    monuments: MONUMENTS.map(m => ({ id: m.id, colors: m.colors.slice(), at: null })),
    current: first,
    actionsLeft: ACTIONS_PER_TURN,
    turn: 1,
    phase: 'play',
    pending: null,
    ctx: null,
    unification: null,
    log: [],
    logSeq: 0,
    result: null,
    endReason: null,
    seq: 0
  };
  log(s, first, `Игра началась. Первым ходит ${players[first].name}`, 'turn');
  return s;
}

// ─── ACTION DISPATCH ───────────────────────────────────────────────────────────

function applyAction(state, player, action) {
  const s = clone(state);
  try {
    dispatch(s, player, action);
    s.seq++;
    return { ok: true, state: s };
  } catch (e) {
    if (e instanceof RuleError) return { ok: false, error: e.message };
    return { ok: false, error: 'Внутренняя ошибка движка', internal: e };
  }
}

function dispatch(s, p, a) {
  if (!a || typeof a !== 'object' || typeof a.type !== 'string') fail('Некорректное действие');
  if (!Number.isInteger(p) || p < 0 || p >= s.players.length) fail('Некорректный игрок');
  if (s.phase !== 'play') fail('Игра окончена');

  switch (a.type) {
    case 'tile': return mainAction(s, p, () => doTile(s, p, a));
    case 'leader': return mainAction(s, p, () => doLeader(s, p, a));
    case 'withdraw': return mainAction(s, p, () => doWithdraw(s, p, a));
    case 'catastrophe': return mainAction(s, p, () => doCatastrophe(s, p, a));
    case 'swap': return mainAction(s, p, () => doSwap(s, p, a));
    case 'end':
      requireTurn(s, p);
      log(s, p, s.actionsLeft > 0 ? `${nameOf(s, p)} завершает ход досрочно` : `${nameOf(s, p)} завершает ход`);
      endTurn(s);
      return;
    case 'commit': return doCommit(s, p, a);
    case 'war': return doWarChoice(s, p, a);
    case 'monument': return doMonument(s, p, a);
    case 'treasure': return doTreasure(s, p, a);
    default: fail('Неизвестное действие');
  }
}

function requireTurn(s, p) {
  if (p !== s.current) fail('Сейчас не ваш ход');
  if (s.pending) fail('Сначала нужно принять текущее решение');
}

function mainAction(s, p, run) {
  requireTurn(s, p);
  if (s.actionsLeft <= 0) fail('Действия закончились — завершите ход');
  run();
  advance(s);
}

function requirePending(s, p, type) {
  if (!s.pending || s.pending.type !== type) fail('Сейчас это действие недоступно');
  if (s.pending.player !== p) fail('Сейчас решение принимает другой игрок');
}

// Runs the rest of the current action until it needs a decision or is complete.
function advance(s) {
  let guard = 0;
  while (s.ctx && !s.pending && s.phase === 'play') {
    if (++guard > 500) throw new Error('advance(): no progress');
    const stage = s.ctx.stage;
    if (stage === 'wars') stepWars(s);
    else if (stage === 'monument') stepMonument(s);
    else if (stage === 'treasure') stepTreasure(s);
    else if (stage === 'done') {
      s.ctx = null;
      if (s.actionsLeft <= 0) endTurn(s);
    } else throw new Error(`advance(): unknown stage ${stage}`);
  }
}

// ─── ACTION: PLACE A TILE ──────────────────────────────────────────────────────

function doTile(s, p, a) {
  const color = checkColor(a.color);
  const i = checkCell(a.cell);
  const pl = s.players[p];
  if (!pl.hand.includes(color)) fail('У вас нет такого тайла');
  const err = tileError(s.board, color, i);
  if (err) fail(err);

  const kingdoms = adjacentKingdoms(s.board, i);
  removeFromHand(pl.hand, color, 1);
  s.actionsLeft--;
  s.board[i] = { k: 'tile', c: color };
  log(s, p, `${pl.name} кладёт ${TILE_WORDS[color][0]}`, null);

  if (kingdoms.length === 2) {
    s.unification = i;
    log(s, p, `${pl.name} объединяет два царства — за этот тайл очков нет`);
    s.ctx = { type: 'tile', cell: i, stage: 'wars', wars: 0 };
    return;
  }
  if (kingdoms.length === 1) scoreTile(s, i, color);
  s.ctx = { type: 'tile', cell: i, stage: 'monument' };
}

function scoreTile(s, i, color) {
  const g = groupAt(s.board, i);
  const owner = g.leaders.find(c => s.board[c].c === color);
  const king = g.leaders.find(c => s.board[c].c === 'black');
  const scorer = owner !== undefined ? owner : king;
  if (scorer === undefined) return;
  const q = s.board[scorer].p;
  s.players[q].vp[color] += 1;
  const via = owner !== undefined ? LEADER_NOM[color] : 'царь';
  log(s, q, `${nameOf(s, q)} (${via}) получает ${vpText(color, 1)}`, 'vp');
}

// ─── WARS ──────────────────────────────────────────────────────────────────────

function warColors(s) {
  const g = groupAt(s.board, s.unification);
  const count = {};
  g.leaders.forEach(c => { const col = s.board[c].c; count[col] = (count[col] || 0) + 1; });
  return COLORS.filter(c => count[c] >= 2);
}

function stepWars(s) {
  const colors = warColors(s);
  if (!colors.length) {
    if (!s.ctx.wars) log(s, s.current, 'Одноцветных лидеров нет — царства объединились мирно');
    s.unification = null;
    s.ctx.stage = 'monument';
    return;
  }
  if (colors.length === 1) startWar(s, colors[0]);
  else s.pending = { type: 'warChoice', player: s.current, colors };
}

function doWarChoice(s, p, a) {
  requirePending(s, p, 'warChoice');
  if (!s.pending.colors.includes(a.color)) fail('Выберите одну из войн');
  s.pending = null;
  startWar(s, a.color);
  advance(s);
}

function startWar(s, color) {
  const u = s.unification;
  const n = s.players.length;
  const [c1, c2] = groupAt(s.board, u).leaders.filter(c => s.board[c].c === color);
  const p1 = s.board[c1].p, p2 = s.board[c2].p;
  // The active player attacks if involved; otherwise the first involved player clockwise from him.
  let attCell = null;
  for (let k = 0; k < n && attCell === null; k++) {
    const q = (s.current + k) % n;
    if (q === p1) attCell = c1;
    else if (q === p2) attCell = c2;
  }
  const defCell = attCell === c1 ? c2 : c1;
  const side = cell => {
    const support = supportCells(s.board, cell, color, u);
    return { player: s.board[cell].p, cell, base: support.length, support, committed: null };
  };
  const attacker = side(attCell), defender = side(defCell);
  s.ctx.wars++;
  s.pending = {
    type: 'conflict', kind: 'war', color, support: color,
    attacker, defender, step: 'attacker', player: attacker.player
  };
  log(s, attacker.player,
    `Война ${LEADER_GEN_PL[color]}: ${nameOf(s, attacker.player)} (${attacker.base}) атакует ${nameOf(s, defender.player)} (${defender.base})`,
    'conflict');
}

// ─── ACTION: POSITION A LEADER ──────────────────────────────────────────────────

function doLeader(s, p, a) {
  const color = checkColor(a.color);
  const i = checkCell(a.cell);
  const pl = s.players[p];
  const from = pl.leaders[color];
  if (from === i) fail('Лидер уже стоит на этой клетке');
  if (from !== null) s.board[from] = null; // lifted first; restored by applyAction on failure
  const err = leaderError(s.board, i);
  if (err) fail(err);

  s.board[i] = { k: 'leader', c: color, p };
  pl.leaders[color] = i;
  s.actionsLeft--;
  log(s, p, `${pl.name} ${from === null ? 'ставит' : 'перемещает'} ${LEADER_ACC[color]}`);
  s.ctx = { type: 'leader', cell: i, stage: 'treasure' };

  const rival = groupAt(s.board, i).leaders.find(c => c !== i && s.board[c].c === color);
  if (rival === undefined) return;
  const side = cell => {
    const support = templesAround(s.board, cell);
    return { player: s.board[cell].p, cell, base: support.length, support, committed: null };
  };
  const attacker = side(i), defender = side(rival);
  s.pending = {
    type: 'conflict', kind: 'revolt', color, support: 'red',
    attacker, defender, step: 'attacker', player: p
  };
  log(s, p,
    `Восстание: ${LEADER_NOM[color]} ${pl.name} (${attacker.base}) против ${nameOf(s, defender.player)} (${defender.base})`,
    'conflict');
}

function doWithdraw(s, p, a) {
  const color = checkColor(a.color);
  const pl = s.players[p];
  const at = pl.leaders[color];
  if (at === null) fail('Этого лидера нет на поле');
  liftLeader(s, at);
  s.actionsLeft--;
  log(s, p, `${pl.name} убирает ${LEADER_ACC[color]} с поля`);
  s.ctx = { type: 'withdraw', stage: 'treasure' };
}

// ─── CONFLICT RESOLUTION ───────────────────────────────────────────────────────

function doCommit(s, p, a) {
  requirePending(s, p, 'conflict');
  const pd = s.pending;
  const n = a.count;
  if (!Number.isInteger(n) || n < 0) fail('Некорректное количество тайлов');
  const pl = s.players[p];
  const have = countInHand(pl.hand, pd.support);
  if (n > have) fail(`У вас только ${tilesText(pd.support, have)}`);
  removeFromHand(pl.hand, pd.support, n);

  const side = pd.step === 'attacker' ? pd.attacker : pd.defender;
  side.committed = n;
  log(s, p, n
    ? `${pl.name} добавляет ${tilesText(pd.support, n)} (сила ${side.base + n})`
    : `${pl.name} не добавляет подкрепления (сила ${side.base})`);

  if (pd.step === 'attacker') {
    pd.step = 'defender';
    pd.player = pd.defender.player;
  } else {
    resolveConflict(s);
  }
  advance(s);
}

function resolveConflict(s) {
  const pd = s.pending;
  const A = pd.attacker, D = pd.defender;
  const at = A.base + A.committed, dt = D.base + D.committed;
  const attackerWins = at > dt; // the defender wins ties
  const W = attackerWins ? A : D, L = attackerWins ? D : A;
  const winner = s.players[W.player], loser = s.players[L.player];
  const score = attackerWins ? `${at}:${dt}` : `${dt}:${at}`;

  if (pd.kind === 'revolt') {
    liftLeader(s, L.cell);
    winner.vp.red += 1;
    log(s, W.player,
      `${winner.name} побеждает в восстании (${score}) и получает ${vpText('red', 1)}; ${LEADER_NOM[pd.color]} ${loser.name} уходит`,
      'result');
  } else {
    const color = pd.color;
    const supporters = supportCells(s.board, L.cell, color, s.unification);
    liftLeader(s, L.cell);
    let removed = 0;
    for (const c of supporters) {
      const cell = s.board[c];
      // Temples bearing a treasure or next to another leader survive a lost war of priests.
      if (color === 'red' && (cell.tr || NEIGHBORS[c].some(nb => isLeader(s.board[nb])))) continue;
      s.board[c] = null;
      removed++;
    }
    winner.vp[color] += 1 + removed;
    log(s, W.player,
      `${winner.name} побеждает в войне (${score}): ${loser.name} теряет ${LEADER_ACC[color]}` +
      (removed ? ` и ${tilesText(color, removed)}` : '') + ` · +${vpText(color, 1 + removed)}`,
      'result');
    withdrawUnsupported(s);
  }
  s.pending = null;
}

// ─── ACTION: CATASTROPHE ───────────────────────────────────────────────────────

function doCatastrophe(s, p, a) {
  const i = checkCell(a.cell);
  const pl = s.players[p];
  if (pl.catastrophes <= 0) fail('Катастрофы закончились');
  const err = catastropheError(s.board, i);
  if (err) fail(err);
  const destroyed = s.board[i];
  s.board[i] = { k: 'cat', p };
  pl.catastrophes--;
  s.actionsLeft--;
  log(s, p, destroyed
    ? `${pl.name} обрушивает катастрофу — ${TILE_DESTROYED[destroyed.c]}`
    : `${pl.name} обрушивает катастрофу`);
  withdrawUnsupported(s);
  s.ctx = { type: 'catastrophe', stage: 'treasure' };
}

// ─── ACTION: REPLACE TILES ─────────────────────────────────────────────────────

function doSwap(s, p, a) {
  const pl = s.players[p];
  const tiles = a.tiles;
  if (!Array.isArray(tiles) || tiles.length < 1 || tiles.length > HAND_SIZE) fail('Выберите от 1 до 6 тайлов');
  tiles.forEach(checkColor);
  COLORS.forEach(c => {
    if (countInHand(tiles, c) > countInHand(pl.hand, c)) fail('В руке нет таких тайлов');
  });
  tiles.forEach(c => removeFromHand(pl.hand, c, 1));
  s.actionsLeft--;
  log(s, p, `${pl.name} сбрасывает и добирает ${tiles.length} ${plural(tiles.length, 'тайл', 'тайла', 'тайлов')}`);
  if (!draw(s, p, tiles.length)) { finish(s, 'bag'); return; }
  s.ctx = { type: 'swap', stage: 'done' };
}

// ─── MONUMENTS ─────────────────────────────────────────────────────────────────

function monumentOptions(s, i) {
  const c = i % COLS, r = (i - c) / COLS;
  const options = [];
  for (const [dc, dr] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
    const c0 = c + dc, r0 = r + dr;
    if (c0 < 0 || r0 < 0 || c0 + 1 >= COLS || r0 + 1 >= ROWS) continue;
    const at = cellIndex(c0, r0);
    const square = [at, at + 1, at + COLS, at + COLS + 1];
    const color = s.board[i].c;
    if (!square.every(q => { const cell = s.board[q]; return cell && cell.k === 'tile' && !cell.down && cell.c === color; })) continue;
    const monuments = s.monuments.filter(m => m.at === null && m.colors.includes(color)).map(m => m.id);
    if (monuments.length) options.push({ at, color, cells: square, monuments });
  }
  return options;
}

function stepMonument(s) {
  s.ctx.stage = 'treasure';
  if (s.ctx.type !== 'tile') return;
  const cell = s.board[s.ctx.cell];
  if (!cell || cell.k !== 'tile' || cell.down) return;
  const options = monumentOptions(s, s.ctx.cell);
  if (options.length) s.pending = { type: 'monument', player: s.current, options };
}

function doMonument(s, p, a) {
  requirePending(s, p, 'monument');
  const pd = s.pending;
  if (a.decline) {
    s.pending = null;
    log(s, p, `${nameOf(s, p)} не строит монумент`);
    advance(s);
    return;
  }
  const opt = pd.options.find(o => o.at === a.at);
  if (!opt) fail('Выберите квадрат для монумента');
  if (!opt.monuments.includes(a.monument)) fail('Этот монумент здесь построить нельзя');
  const m = s.monuments[a.monument];
  opt.cells.forEach(q => { s.board[q].down = true; s.board[q].mon = m.id; });
  m.at = opt.at;
  s.pending = null;
  log(s, p, `${nameOf(s, p)} возводит монумент (${m.colors.map(c => COLOR_ADJ[c]).join(' + ')})`, 'vp');
  withdrawUnsupported(s);
  advance(s);
}

// ─── TREASURES ─────────────────────────────────────────────────────────────────

function stepTreasure(s) {
  for (const g of allGroups(s.board)) {
    if (!g.leaders.length) continue;
    const cells = g.cells.filter(c => s.board[c].tr);
    if (cells.length < 2) continue;
    const trader = g.leaders.find(c => s.board[c].c === 'green');
    if (trader === undefined) continue;
    cells.sort((x, y) => x - y);
    s.pending = { type: 'treasure', player: s.board[trader].p, cells, need: cells.length - 1 };
    return;
  }
  s.ctx.stage = 'done';
}

function doTreasure(s, p, a) {
  requirePending(s, p, 'treasure');
  const pd = s.pending;
  const i = checkCell(a.cell);
  if (!pd.cells.includes(i) || !s.board[i] || !s.board[i].tr) fail('Выберите сокровище в этом царстве');
  s.board[i].tr = false;
  s.players[p].treasures++;
  pd.cells = pd.cells.filter(c => c !== i);
  pd.need--;
  log(s, p, `${nameOf(s, p)} (торговец) забирает сокровище`, 'vp');
  if (pd.need <= 0) s.pending = null;
  advance(s);
}

// ─── END OF TURN, END OF GAME ──────────────────────────────────────────────────

function endTurn(s) {
  const p = s.current, pl = s.players[p], n = s.players.length;
  s.ctx = null;

  for (const m of s.monuments) {
    if (m.at === null) continue;
    const g = groupAt(s.board, m.at);
    for (const color of m.colors) {
      const at = pl.leaders[color];
      if (at !== null && g.set.has(at)) {
        pl.vp[color] += 1;
        log(s, p, `${pl.name} получает ${vpText(color, 1)} за монумент`, 'vp');
      }
    }
  }

  for (let k = 0; k < n; k++) {
    const q = (p + k) % n;
    const need = HAND_SIZE - s.players[q].hand.length;
    if (need > 0 && !draw(s, q, need)) { finish(s, 'bag'); return; }
  }

  if (treasuresOnBoard(s.board) <= END_TREASURES) { finish(s, 'treasures'); return; }

  s.current = (p + 1) % n;
  s.actionsLeft = ACTIONS_PER_TURN;
  s.turn++;
  log(s, s.current, `Ход ${s.turn}: ${nameOf(s, s.current)}`, 'turn');
}

// Treasures are wild: each goes to the currently weakest sphere (maximises the sorted vector).
function computeResult(players) {
  const rows = players.map((pl, i) => {
    const final = Object.assign({}, pl.vp);
    for (let t = 0; t < pl.treasures; t++) {
      let min = COLORS[0];
      COLORS.forEach(c => { if (final[c] < final[min]) min = c; });
      final[min]++;
    }
    const sorted = COLORS.map(c => final[c]).sort((a, b) => a - b);
    return {
      player: i, name: pl.name, dynasty: pl.dynasty,
      vp: Object.assign({}, pl.vp), treasures: pl.treasures, final, sorted, score: sorted[0]
    };
  });
  const cmp = (a, b) => {
    for (let k = 0; k < COLORS.length; k++) if (a.sorted[k] !== b.sorted[k]) return b.sorted[k] - a.sorted[k];
    return 0;
  };
  const ranking = rows.slice().sort((a, b) => cmp(a, b) || a.player - b.player);
  ranking.forEach((r, k) => { r.place = k > 0 && cmp(ranking[k - 1], r) === 0 ? ranking[k - 1].place : k + 1; });
  return { ranking, winners: ranking.filter(r => r.place === 1).map(r => r.player) };
}

function finish(s, reason) {
  s.phase = 'over';
  s.pending = null;
  s.ctx = null;
  s.unification = null;
  s.endReason = reason;
  s.result = computeResult(s.players);
  const left = treasuresOnBoard(s.board);
  log(s, null, reason === 'bag'
    ? 'Игра окончена: в мешке закончились тайлы'
    : `Игра окончена: на поле ${left === 1 ? 'осталось 1 сокровище' : `осталось ${left} сокровища`}`, 'turn');
  const winners = s.result.winners.map(w => s.players[w].name);
  log(s, null, winners.length > 1 ? `Победу делят: ${winners.join(', ')}` : `Победитель: ${winners[0]}`, 'result');
}

// ─── VIEWS AND HELPERS FOR HOSTS ───────────────────────────────────────────────

// What one player may see: own hand and score, everybody's public pieces.
function getView(s, viewer) {
  const over = s.phase === 'over';
  const me = Number.isInteger(viewer) && viewer >= 0 && viewer < s.players.length ? viewer : -1;
  return clone({
    v: s.v,
    id: s.id,
    seq: s.seq,
    you: me,
    board: s.board,
    monuments: s.monuments,
    current: s.current,
    actionsLeft: s.actionsLeft,
    turn: s.turn,
    phase: s.phase,
    pending: s.pending,
    unification: s.unification,
    treasuresLeft: treasuresOnBoard(s.board),
    players: s.players.map((pl, i) => {
      const o = {
        name: pl.name, dynasty: pl.dynasty, leaders: pl.leaders,
        catastrophes: pl.catastrophes, handCount: pl.hand.length
      };
      if (over || i === me) { o.vp = pl.vp; o.treasures = pl.treasures; }
      return o;
    }),
    hand: me >= 0 ? s.players[me].hand.slice().sort(colorOrder) : [],
    log: s.log.slice(-LOG_VIEW),
    result: s.result,
    endReason: s.endReason
  });
}

// Player whose input the game is waiting for (null when the game is over).
function awaiting(s) {
  if (s.phase !== 'play') return null;
  return s.pending ? s.pending.player : s.current;
}

// Safe choice used when a player has to be skipped (e.g. left an online game).
function defaultAction(s) {
  const pd = s.pending;
  if (!pd) return { type: 'end' };
  if (pd.type === 'conflict') return { type: 'commit', count: 0 };
  if (pd.type === 'warChoice') return { type: 'war', color: pd.colors[0] };
  if (pd.type === 'monument') return { type: 'monument', decline: true };
  return { type: 'treasure', cell: pd.cells[0] };
}

return {
  VERSION, COLS, ROWS, SIZE, COLORS, DYNASTIES, MONUMENTS, BAG, HAND_SIZE, ACTIONS_PER_TURN,
  CATASTROPHES, MIN_PLAYERS, MAX_PLAYERS, RIVER, START_TEMPLES, NEIGHBORS,
  LEADER_NOM, LEADER_ACC, TILE_WORDS,
  RuleError, mulberry32, cellIndex, plural, vpText, tilesText,
  createGame, applyAction, getView, awaiting, defaultAction, computeResult,
  groupAt, allGroups, adjacentKingdoms, templesAround, supportCells, treasuresOnBoard,
  tileError, leaderError, catastropheError, tileTargets, leaderTargets, catastropheTargets,
  monumentOptions
};
}));
