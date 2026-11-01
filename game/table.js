// Стол: лобби, старт, приём хода, конец партии, реванш. Чистые функции над JSON-документом
// стола (без сети и базы): серверный слой читает документ, вызывает функцию и пишет его
// обратно, если версия не изменилась. Каждая успешная правка увеличивает version.
import { createGame, legalMoves, applyMove, validate, finalVector } from './vendor/engine/engine.js';
import { BOARDS } from './vendor/engine/boards.js';
import { STYLE_LABELS } from './vendor/bot/styles.js';
import { stateFromJSON, stateToJSON } from './serialize.js';
import { cryptoRng } from './random.js';
import { playOrder, companyKey, placesFromVectors } from './order.js';
import { journalEntries } from './journal.js';

export class TableError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const fail = (code, message, status) => {
  throw new TableError(code, message, status);
};

export const HEROES = ['lion', 'bull', 'bow', 'pot'];
const BOT_HEROES = ['pot', 'bow', 'bull', 'lion']; // боту достаётся герой с конца, людям остаётся лев
// постоянные герои компании (просьба Дениса 01.11): выбор по умолчанию, в лобби его можно сменить
const OWN_HEROES = new Map([['денис', 'pot'], ['андрей', 'bow'], ['влад', 'lion']]);
// turnSeconds — время на ход, сверх него таймер уходит в минус (ход не отнимается);
// confirmSeconds — окно, в котором сделанный ход еще можно отменить, потом он завершается сам
// (0 — без окна; по умолчанию 10 с). Решения Дениса 29.10.
export const DEFAULT_OPTIONS = {
  board: 'advanced', englishSupport: true, buildings: true, wonder: true, openScore: false, order: 'loser',
  turnSeconds: 30, confirmSeconds: 10, tournament: 'auto',
};
// стиль по умолчанию «Универсальный» (решение Дениса 22.10), остальное как в панели бота
export const DEFAULT_BOT = { style: 'universal', strength: 50, counting: 'none', risk: 50, errors: 5 };

// ключи словарей проверяем через Object.hasOwn: `in` пропускал constructor, toString и __proto__
const OPTION_CHECKS = {
  board: (v) => typeof v === 'string' && Object.hasOwn(BOARDS, v),
  englishSupport: (v) => typeof v === 'boolean',
  buildings: (v) => typeof v === 'boolean',
  wonder: (v) => typeof v === 'boolean',
  openScore: (v) => typeof v === 'boolean',
  order: (v) => ['loser', 'random', 'custom'].includes(v),
  turnSeconds: (v) => Number.isInteger(v) && v >= 10 && v <= 600,
  confirmSeconds: (v) => Number.isInteger(v) && v >= 0 && v <= 60,
  // auto — по составу, none — не в зачет, иначе номер турнира
  tournament: (v) => typeof v === 'string' && /^[a-z0-9-]{1,24}$/.test(v),
};
const intIn = (lo, hi) => (v) => Number.isInteger(v) && v >= lo && v <= hi;
const BOT_CHECKS = {
  style: (v) => typeof v === 'string' && Object.hasOwn(STYLE_LABELS, v) && v !== 'mix',
  strength: intIn(0, 100),
  counting: (v) => ['none', 'approx', 'exact'].includes(v),
  risk: intIn(0, 100),
  errors: intIn(0, 30),
};

function touch(t, now) {
  t.version++;
  t.updatedAt = now;
}

export function seatOfUser(t, userId) {
  return t.seats.find((s) => s.kind === 'human' && s.userId === userId) || null;
}
const seatById = (t, id) => t.seats.find((s) => s.id === id) || fail('no-seat', 'Нет такого места', 404);
const needLobby = (t) => t.status === 'lobby' || fail('not-lobby', 'Партия уже началась', 409);
const needHost = (t, userId) => userId === t.hostUserId || fail('not-host', 'Это может сделать только хозяин стола', 403);
const needSeated = (t, userId) => seatOfUser(t, userId) || fail('not-seated', 'Вы не сидите за этим столом', 403);

function botHero(t) {
  return BOT_HEROES.find((h) => !t.seats.some((s) => s.hero === h)) || null;
}
// бот называется своим стилем (просьба Дениса 30.10), люди с большой буквы, стили с маленькой
const BOT_NAMES = { universal: 'универсальный', base: 'базовый', top: 'топ-мастера', denis: 'Денис', andrey: 'Андрей', vlad: 'Влад' };

/** Имена ботов по стилям; второй бот того же стиля за столом получает номер. */
function nameBots(t) {
  const seen = new Map();
  for (const s of t.seats) {
    if (s.kind !== 'bot') continue;
    const n = (seen.get(s.bot.style) || 0) + 1;
    seen.set(s.bot.style, n);
    s.name = `Бот ${BOT_NAMES[s.bot.style]}${n > 1 ? ` ${n}` : ''}`;
  }
}
const emptyHuman = (id) => ({ id, kind: 'human', userId: null, name: null, avatar: null, hero: null });
function makeBot(t, id) {
  return { id, kind: 'bot', userId: null, name: null, hero: botHero(t), bot: { ...DEFAULT_BOT } };
}

/** Посадить человека с его героем: бот уступает и берет другого, героя другого человека не отбираем. */
function giveOwnHero(t, seat) {
  const hero = OWN_HEROES.get(String(seat.name).trim().toLowerCase());
  const holder = t.seats.find((s) => s.hero === hero);
  if (!hero || holder?.kind === 'human') return;
  seat.hero = hero;
  if (holder) holder.hero = botHero(t);
}

const DAY_FORMAT = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' });

/** День для названия стола по Москве: 30.10.2026. */
export const tableDay = (now) => DAY_FORMAT.format(now);

// --- Лобби

/** Новый стол: хост на первом месте, ещё два места для людей и бот. title показывается вместо кода. */
export function createTable({ code, title = null, host, now }) {
  const t = {
    code, title, version: 0, status: 'lobby', createdAt: now, updatedAt: now,
    hostUserId: host.userId, options: { ...DEFAULT_OPTIONS }, seats: [], game: null, next: null,
  };
  t.seats.push({ id: 0, kind: 'human', userId: host.userId, name: host.name, avatar: host.avatar || null, hero: null }, emptyHuman(1), emptyHuman(2));
  giveOwnHero(t, t.seats[0]);
  t.seats.push(makeBot(t, 3));
  nameBots(t);
  return t;
}

export function sit(t, user, seatId, now) {
  needLobby(t);
  const seat = seatById(t, seatId);
  if (seat.kind === 'bot') fail('seat-is-bot', 'Это место бота', 409);
  if (seatOfUser(t, user.userId)) fail('already-seated', 'Вы уже сидите за этим столом', 409);
  if (seat.userId) fail('seat-taken', 'Место занято', 409);
  // за столом никого не осталось (хозяин ушёл последним): севший первым берёт стол себе
  if (!t.seats.some((s) => s.kind === 'human' && s.userId)) t.hostUserId = user.userId;
  seat.userId = user.userId;
  seat.name = user.name;
  seat.avatar = user.avatar || null;
  giveOwnHero(t, seat);
  touch(t, now);
}

export function leave(t, userId, now) {
  needLobby(t);
  const seat = needSeated(t, userId);
  Object.assign(seat, emptyHuman(seat.id));
  // ушёл хост: стол переходит к следующему сидящему человеку
  if (userId === t.hostUserId) {
    const next = t.seats.find((s) => s.kind === 'human' && s.userId);
    if (next) t.hostUserId = next.userId;
  }
  touch(t, now);
}

export function setHero(t, userId, seatId, hero, now) {
  needLobby(t);
  if (!HEROES.includes(hero)) fail('bad-hero', 'Нет такого героя');
  const seat = seatById(t, seatId);
  if (seat.kind === 'bot') needHost(t, userId);
  else if (seat.userId !== userId) fail('not-your-seat', 'Героя выбирает тот, кто сидит на месте', 403);
  if (t.seats.some((s) => s !== seat && s.hero === hero)) fail('hero-taken', 'Этот герой уже занят', 409);
  seat.hero = hero;
  touch(t, now);
}

export function setOptions(t, userId, patch, now) {
  needLobby(t);
  needHost(t, userId);
  for (const [k, v] of Object.entries(patch)) {
    if (!Object.hasOwn(OPTION_CHECKS, k) || !OPTION_CHECKS[k](v)) fail('bad-option', `Недопустимая настройка ${k}`);
  }
  Object.assign(t.options, patch);
  touch(t, now);
}

export function setSeatCount(t, userId, n, now) {
  needLobby(t);
  needHost(t, userId);
  if (!Number.isInteger(n) || n < 2 || n > 4) fail('bad-seat-count', 'За столом от 2 до 4 мест');
  if (n < t.seats.length) {
    if (t.seats.slice(n).some((s) => s.kind === 'human' && s.userId)) fail('seat-occupied', 'Убрать можно только свободные места', 409);
    t.seats = t.seats.slice(0, n);
  }
  while (t.seats.length < n) {
    let id = 0;
    while (t.seats.some((s) => s.id === id)) id++;
    t.seats.push(emptyHuman(id));
  }
  touch(t, now);
}

export function setSeatKind(t, userId, seatId, kind, now) {
  needLobby(t);
  needHost(t, userId);
  if (kind !== 'human' && kind !== 'bot') fail('bad-option', 'Место бывает «человек» или «бот»');
  const seat = seatById(t, seatId);
  if (seat.kind === kind) return;
  if (seat.kind === 'human' && seat.userId) fail('seat-occupied', 'Место занято человеком', 409);
  const i = t.seats.indexOf(seat);
  t.seats[i] = kind === 'bot' ? makeBot(t, seat.id) : emptyHuman(seat.id);
  nameBots(t);
  touch(t, now);
}

export function setBot(t, userId, seatId, settings, now) {
  needLobby(t);
  needHost(t, userId);
  const seat = seatById(t, seatId);
  if (seat.kind !== 'bot') fail('not-bot', 'Это место не бота');
  for (const [k, v] of Object.entries(settings)) {
    if (!Object.hasOwn(BOT_CHECKS, k) || !BOT_CHECKS[k](v)) fail('bad-option', `Недопустимая настройка бота ${k}`);
  }
  Object.assign(seat.bot, settings);
  nameBots(t);
  touch(t, now);
}

/** Ручная очерёдность: хост переставляет места, порядок сверху вниз = порядок хода. */
export function moveSeat(t, userId, seatId, toIndex, now) {
  needLobby(t);
  needHost(t, userId);
  const seat = seatById(t, seatId);
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= t.seats.length) fail('bad-option', 'Нет такой позиции');
  t.seats.splice(t.seats.indexOf(seat), 1);
  t.seats.splice(toIndex, 0, seat);
  touch(t, now);
}

// --- Партия

/**
 * Начать партию. last — запись истории прошлой партии этой компании (или null),
 * orderMode — переопределить очерёдность (реванш всегда «проигравший первым»).
 */
export function start(t, userId, { last = null, rng = cryptoRng(), now, orderMode } = {}) {
  needLobby(t);
  // начать может любой сидящий человек или хост (хост может посадить одних ботов и смотреть)
  if (userId !== t.hostUserId) needSeated(t, userId);
  const ready = t.seats.length >= 2 && t.seats.length <= 4
    && t.seats.every((s) => s.hero && (s.kind === 'bot' || s.userId));
  if (!ready) fail('seats-not-ready', 'Не все места заняты или не у всех выбран герой', 409);
  const ord = playOrder(t.seats, orderMode || t.options.order, { last, rng });
  const { confirmMs } = timing(t);
  const cfg = { englishSupport: t.options.englishSupport, buildings: t.options.buildings, wonder: t.options.wonder, confirmTurn: confirmMs > 0 };
  const s = createGame({ layout: BOARDS[t.options.board], numPlayers: t.seats.length, cfg }, rng);
  t.game = {
    id: `${t.code}-${now}`,
    order: ord.order,
    orderReason: ord.reason,
    state: stateToJSON(s),
    toMove: ord.order[s.toMove],
    log: [],
    logEpoch: 0, // растет при отмене: журнал укоротился, клиенту перечитать его целиком
    startedAt: now,
    result: null,
    undo: [], // снимки перед действиями ходящего в этом ходу (только для отмены, в вид не идут)
    confirmBy: null, // когда ход завершится сам, если не нажать «Завершить ход»
    clock: { at: now, turnUsed: 0, used: {}, over: {} },
  };
  t.status = 'playing';
  touch(t, now);
}

const canon = (m) => JSON.stringify(m, Object.keys(m).sort());

function needTurn(t, seatId) {
  if (t.status !== 'playing') fail('not-playing', 'Партия не идёт', 409);
  const s = stateFromJSON(t.game.state);
  if (s.toMove !== t.game.order.indexOf(seatId)) fail('not-your-move', 'Сейчас решает другой игрок', 409);
  return s;
}

/** Ход человека: номер хода из списка допустимых и версия стола, которую он видел. */
export function submit(t, userId, { version, index } = {}, { rng = cryptoRng(), now } = {}) {
  if (t.status !== 'playing') fail('not-playing', 'Партия не идёт', 409);
  const seat = needSeated(t, userId);
  if (version !== t.version) fail('stale', 'Стол уже изменился, обновите', 409);
  const s = needTurn(t, seat.id);
  const legal = legalMoves(s);
  if (!Number.isInteger(index) || index < 0 || index >= legal.length) fail('bad-move', 'Такого хода нет');
  return applyLegal(t, s, legal[index], rng, now);
}

/** Ход за место (бот): объект хода должен совпасть с одним из допустимых. */
export function submitSeat(t, seatId, move, { rng = cryptoRng(), now } = {}) {
  const s = needTurn(t, seatId);
  const legal = legalMoves(s);
  const key = move && typeof move === 'object' ? canon(move) : null;
  const i = key ? legal.findIndex((m) => canon(m) === key) : -1;
  if (i < 0) fail('bad-move', 'Такого хода нет');
  return applyLegal(t, s, legal[i], rng, now);
}

/** Время на ход и окно подтверждения в мс (у столов до 29.10 этих настроек нет). */
export function timing(t) {
  return {
    turnMs: 1000 * (t.options.turnSeconds ?? DEFAULT_OPTIONS.turnSeconds),
    confirmMs: 1000 * (t.options.confirmSeconds ?? DEFAULT_OPTIONS.confirmSeconds),
  };
}

const CONFLICT = ['warChoose', 'warSupport', 'revoltSupport'];
const UNDO_PHASES = ['action', 'build', 'monument', 'treasure', 'confirm'];

/**
 * Учет времени (просьба Дениса 29.10): решающему месту записывается время с прошлого хода.
 * Ходящему на весь ход дается turnMs, у остальных (поддержка в чужой войне) каждое решение
 * отдельно; все, что сверх, копится в over. Окно подтверждения не считается.
 */
function spend(t, s, seatId, now) {
  const c = t.game.clock;
  if (!c || !Number.isFinite(now)) return;
  const ms = Math.max(0, now - c.at);
  c.at = now;
  if (s.phase === 'confirm') return;
  const { turnMs } = timing(t);
  const active = seatId === t.game.order[s.cur];
  const before = active ? c.turnUsed : 0;
  if (active) c.turnUsed += ms;
  c.used[seatId] = (c.used[seatId] || 0) + ms;
  c.over[seatId] = (c.over[seatId] || 0) + Math.max(0, before + ms - turnMs) - Math.max(0, before - turnMs);
}

/** Один ход движка с журналом, снимком для отмены и временем; версию двигает вызывающий. */
function step(t, s, move, rng, now) {
  const g = t.game;
  const seatId = g.order[s.toMove];
  const meta = { turn: s.turn, cur: s.cur, action: s.actionNo };
  const before = s.phase;
  spend(t, s, seatId, now);
  // снимок перед действием ходящего человека: к нему вернет «Отменить»
  g.undo ||= [];
  if (before === 'action' && seatById(t, seatId)?.kind === 'human') g.undo.push({ state: g.state, logLen: g.log.length });
  s.log = [];
  applyMove(s, move, rng);
  const errs = validate(s);
  if (errs.length) fail('engine', 'Нарушена целостность партии: ' + errs.join('; '), 500);
  const entries = journalEntries(s.log, g.order, meta);
  g.log.push(...entries);
  g.state = stateToJSON(s);
  g.toMove = s.over ? null : g.order[s.toMove];
  // отменять нельзя после сброса (уже видны новые тайлы) и нападения (война, восстание),
  // после решения другого места (выбор сокровища: ходящий увидел чужой выбор и переиграл бы),
  // а с концом хода снимки больше не нужны
  const attack = CONFLICT.includes(before) || CONFLICT.includes(s.phase) || entries.some((e) => e.ev === 'warStart');
  const otherSeat = seatId !== g.order[meta.cur];
  if (move.type === 'discard' || attack || otherSeat || s.over || s.cur !== meta.cur || move.type === 'confirm') g.undo = [];
  if (g.clock && s.cur !== meta.cur) g.clock.turnUsed = 0;
  g.confirmBy = null;
  return entries;
}

function applyLegal(t, s, move, rng, now) {
  const entries = step(t, s, move, rng, now);
  const g = t.game;
  if (!s.over && s.phase === 'confirm') {
    // отменять нечего (сброс, нападение, бот): ход завершается сразу, без окна
    if (!g.undo.length) entries.push(...step(t, s, { type: 'confirm' }, rng, now));
    else g.confirmBy = (Number.isFinite(now) ? now : 0) + timing(t).confirmMs;
  }
  if (s.over) finish(t, s, now);
  touch(t, now);
  return { entries };
}

/** Можно ли ходящему отменить последнее действие этого хода. */
export function canUndo(t) {
  if (t.status !== 'playing' || !t.game?.undo?.length) return false;
  const s = stateFromJSON(t.game.state);
  return !s.over && s.toMove === s.cur && UNDO_PHASES.includes(s.phase);
}

/** Отменить последнее действие своего хода: поле, рука и журнал как до него. */
export function undo(t, userId, { version } = {}, { now } = {}) {
  if (t.status !== 'playing') fail('not-playing', 'Партия не идёт', 409);
  const seat = needSeated(t, userId);
  if (version !== t.version) fail('stale', 'Стол уже изменился, обновите', 409);
  const g = t.game;
  const s = stateFromJSON(g.state);
  if (g.order[s.cur] !== seat.id || !canUndo(t)) fail('no-undo', 'Отменить нечего', 409);
  // срок окна вышел: ход вот-вот завершится сам, его уже не вернуть
  if (g.confirmBy != null && Number.isFinite(now) && now >= g.confirmBy) fail('no-undo', 'Время на отмену вышло', 409);
  spend(t, s, seat.id, now);
  const snap = g.undo.pop();
  const back = stateFromJSON(snap.state);
  g.state = snap.state;
  g.log.length = snap.logLen;
  g.log.push({ ev: 'undo', turn: back.turn, actor: seat.id, action: back.actionNo });
  g.logEpoch = (g.logEpoch || 0) + 1;
  g.toMove = g.order[back.toMove];
  g.confirmBy = null;
  touch(t, now);
}

/** Окно подтверждения истекло: ход пора завершить за игрока. */
export function confirmDue(t, now) {
  return t.status === 'playing' && t.game?.confirmBy != null && now >= t.game.confirmBy;
}

/** Завершить ход за игрока, если окно подтверждения истекло; иначе false. */
export function autoConfirm(t, { rng = cryptoRng(), now } = {}) {
  if (!confirmDue(t, now)) return false;
  const s = stateFromJSON(t.game.state);
  if (s.phase !== 'confirm') return false;
  applyLegal(t, s, { type: 'confirm' }, rng, now);
  return true;
}

function finish(t, s, now) {
  const vectors = s.players.map(finalVector);
  const places = placesFromVectors(vectors);
  t.game.result = {
    endReason: s.endReason,
    finishedAt: now,
    seats: s.players.map((pl, p) => ({
      seatId: t.game.order[p], place: places[p], vector: vectors[p], score: [...pl.score], treasures: pl.treasures,
    })),
  };
  t.status = 'over';
}

/** Место бота, если сейчас решает бот; иначе null. */
export function botDue(t) {
  if (t.status !== 'playing' || t.game.toMove == null) return null;
  const seat = t.seats.find((s) => s.id === t.game.toMove);
  return seat && seat.kind === 'bot' ? seat.id : null;
}

/** Запись истории законченной партии (для «проигравший первым» и разборов). */
export function historyEntry(t) {
  if (t.status !== 'over' || !t.game.result) fail('not-over', 'Партия не закончена', 409);
  const r = t.game.result;
  return {
    id: t.game.id,
    title: t.title || null,
    finishedAt: r.finishedAt,
    company: companyKey(t.seats.filter((s) => s.kind === 'human').map((s) => s.userId)),
    board: t.options.board,
    tour: t.options.tournament ?? 'auto',
    seats: r.seats.map((x) => {
      const seat = seatById(t, x.seatId);
      return {
        seatId: x.seatId, kind: seat.kind, userId: seat.kind === 'human' ? seat.userId : null,
        name: seat.name, hero: seat.hero, place: x.place, vector: x.vector,
      };
    }),
  };
}

/**
 * «Ещё партию»: тот же состав, герои и правила, первым ходит последнее место.
 * Если реванш уже создан (нажали двое), возвращает его код и created = null.
 */
export function rematch(t, userId, { code, title = null, rng = cryptoRng(), now }) {
  if (t.status !== 'over') fail('not-over', 'Партия ещё не закончена', 409);
  needSeated(t, userId);
  if (t.next) return { code: t.next, created: null };
  const n = {
    code, title, version: 0, status: 'lobby', createdAt: now, updatedAt: now,
    hostUserId: t.hostUserId, options: { ...t.options }, seats: structuredClone(t.seats), game: null, next: null,
  };
  start(n, userId, { last: historyEntry(t), rng, now, orderMode: 'loser' });
  t.next = code;
  touch(t, now);
  return { code, created: n };
}

/** Стол стоит без движения столько, и любой сидящий за ним может его закрыть (хозяин пропал). */
export const ABANDON_MS = 2 * 3600 * 1000;

/** Закрыть стол без итога (игрок пропал, передумали): в историю не идёт. */
export function close(t, userId, now) {
  const abandoned = Number.isFinite(now) && now - t.updatedAt >= ABANDON_MS && Boolean(seatOfUser(t, userId));
  if (!abandoned) needHost(t, userId);
  if (t.status === 'over' || t.status === 'closed') fail('not-playing', 'Стол уже закрыт или партия окончена', 409);
  t.status = 'closed';
  touch(t, now);
}
