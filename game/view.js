// Вид стола для одного игрока. Только белый список полей: своя рука и сбросы, у соперников
// число тайлов в руке, мешок процентом, чужой счёт только при открытом счёте или в конце.
// Список ходов и исход войны — только тому, кто решает.
import { legalMoves } from './vendor/engine/engine.js';
import { TOTAL_TILES } from './vendor/engine/constants.js';
import { stateFromJSON } from './serialize.js';
import { conflictPreview } from './preview.js';
import { canUndo, timing } from './table.js';

const sum = (a) => a.reduce((x, y) => x + y, 0);
const TILES = sum(TOTAL_TILES);

function publicConflict(k, order) {
  if (!k) return null;
  return {
    color: k.color, leaderColor: k.leaderColor ?? null,
    att: order[k.att], def: order[k.def], attPos: k.attPos, defPos: k.defPos,
    attBoard: k.attBoard, defBoard: k.defBoard, attN: k.attN,
  };
}

function publicCtx(c, order) {
  if (!c) return null;
  return {
    kind: c.kind,
    pos: c.pos ?? null,
    color: c.color ?? null,
    unite: Boolean(c.unite),
    war: publicConflict(c.war, order),
    revolt: publicConflict(c.revolt, order),
    warColors: c.warColors || null,
    treasure: c.treasure ? { seat: order[c.treasure.player], options: c.treasure.options } : null,
  };
}

function seatPreview(pv, order) {
  if (!pv) return null;
  const seat = (p) => order[p];
  if (pv.kind === 'warChoose') {
    return { kind: pv.kind, options: pv.options.map((o) => ({ ...o, att: seat(o.att), def: seat(o.def) })) };
  }
  return {
    ...pv,
    options: pv.options.map((o) => ({
      ...o, winner: seat(o.winner), loser: seat(o.loser),
      leadersReturned: o.leadersReturned.map((x) => ({ seat: seat(x.p), c: x.c })),
    })),
  };
}

/**
 * Время за столом: сколько набрал каждый, сколько сверх времени хода, когда началось текущее
 * решение и когда ход завершится сам. now — часы сервера, клиент сверяет по ним свои.
 */
function clockView(t, now) {
  const c = t.game.clock;
  if (!c) return null;
  const { turnMs, confirmMs } = timing(t);
  return { now, at: c.at, turnUsed: c.turnUsed, used: { ...c.used }, over: { ...c.over }, turnMs, confirmMs, confirmBy: t.game.confirmBy ?? null };
}

/** userId — код смотрящего; logFrom — с какой записи журнала отдавать (клиент докачивает хвост). */
export function viewFor(table, userId, { logFrom = 0, now = null } = {}) {
  const mine = table.seats.find((x) => x.kind === 'human' && x.userId === userId) || null;
  const v = {
    code: table.code,
    title: table.title || null,
    version: table.version,
    status: table.status,
    options: { ...table.options },
    next: table.next || null,
    isHost: userId === table.hostUserId,
    me: mine ? mine.id : null,
    seats: table.seats.map((x) => ({
      id: x.id, kind: x.kind, name: x.name, hero: x.hero, taken: x.kind === 'bot' || Boolean(x.userId),
      ...(x.kind === 'bot' ? { bot: { ...x.bot } } : {}),
    })),
    game: null,
  };
  if (!table.game) return v;

  const g = table.game;
  const s = stateFromJSON(g.state);
  const order = g.order;
  const myP = mine ? order.indexOf(mine.id) : -1;
  const playing = table.status === 'playing' && !s.over;
  const decides = playing && myP >= 0 && s.toMove === myP;
  const showAll = table.options.openScore || s.over;
  const legal = decides ? legalMoves(s) : null;
  const cells = (arr) => Array.from(arr).flatMap((x, i) => (x ? [i] : []));

  v.game = {
    order,
    river: cells(s.river),
    special: cells(s.special),
    board: {
      tile: Array.from(s.tile),
      leader: Array.from(s.leader), // p * 4 + цвет, p — индекс движка (место: order[p])
      treasure: Array.from(s.treasure),
      building: Array.from(s.building),
      monument: Array.from(s.monument),
    },
    monuments: s.monuments.map((m) => ({ ...m })),
    wonderPos: s.wonderPos,
    buildingPos: [...s.buildingPos],
    turn: s.turn,
    cur: order[s.cur],
    actionNo: s.actionNo,
    phase: s.phase,
    toMove: s.over ? null : order[s.toMove],
    over: s.over,
    endReason: s.endReason,
    players: s.players.map((pl, p) => ({
      seat: order[p],
      leaders: [...pl.leaders],
      cats: pl.cats,
      treasures: pl.treasures,
      handCount: sum(pl.hand),
      score: p === myP || showAll ? [...pl.score] : null,
    })),
    hand: myP >= 0 ? [...s.players[myP].hand] : null,
    discarded: myP >= 0 ? [...s.players[myP].discarded] : null,
    bagPct: Math.round((100 * sum(s.bag)) / (TILES - s.startTemples)),
    ctx: publicCtx(s.ctx, order),
    legal,
    preview: decides ? seatPreview(conflictPreview(s, legal), order) : null,
    log: g.log.slice(logFrom),
    logTotal: g.log.length,
    logEpoch: g.logEpoch || 0,
    // после срока окна ход завершится сам и сервер откажет в отмене, поэтому кнопку не показываем
    canUndo: decides && myP === s.cur && canUndo(table) && !(g.confirmBy != null && now != null && now >= g.confirmBy),
    clock: clockView(table, now),
    stopped: table.status === 'closed', // организатор завершил партию досрочно: итога нет
    result: g.result || null,
  };
  return v;
}
