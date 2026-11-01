// След хода: что отметить на поле после хода соперника. Чистые функции над журналом стола.
import { squareCells } from './pick.js';

export const TRAIL_FRESH_MS = 3000; // столько рамка пульсирует
export const TRAIL_LAND_MS = 450; // столько тайл или лидер садится на клетку

// в каком поле записи журнала лежит клетка действия
const CELL = { tile: 'pos', leader: 'pos', catastrophe: 'pos', building: 'pos', wonder: 'center', monument: 'tl' };

/**
 * Отметки последнего хода другого игрока: [{ key, ev, pos, size, action, actor, c, from? }].
 * Свой ход следа не дает, поэтому след гаснет с первым действием следующего игрока.
 */
export function trailMarks(log, me) {
  const last = log[log.length - 1];
  if (!last || last.actor === me) return [];
  let i = log.length;
  while (i > 0 && log[i - 1].turn === last.turn && log[i - 1].actor === last.actor) i--;
  const byCell = new Map(); // на клетке остается последнее действие: лидер проиграл восстание, на его место лег тайл
  for (const e of log.slice(i)) {
    const field = CELL[e.ev];
    if (!field) continue;
    const monument = e.ev === 'monument';
    if (!monument && byCell.get(e[field])?.action === e.action) continue; // тайл и здание одним действием
    const m = { key: `${e.turn}:${e.actor}:${e.action}:${e[field]}`, ev: e.ev, pos: e[field], size: monument ? 2 : 1, action: e.action, actor: e.actor, c: e.c };
    if (e.ev === 'leader' && e.from >= 0) m.from = e.from;
    // монумент закрывает тайлы под собой
    for (const c of monument ? squareCells(m.pos) : [m.pos]) byCell.delete(c);
    byCell.set(m.pos, m);
  }
  return [...byCell.values()];
}

/** Отметки на занятых клетках: лидер проиграл конфликт или тайл снят войной, и рамке не на что указывать. */
export function liveMarks(marks, board) {
  return marks.filter((m) => m.size > 1 || board.tile[m.pos] >= 0 || board.leader[m.pos] >= 0);
}

/** Сколько мс отметка на поле. seen помнит первое появление; first: стол только открыли, вспышка не нужна. */
export function ageMarks(marks, seen, now, first) {
  const keys = new Set(marks.map((m) => m.key));
  for (const k of seen.keys()) if (!keys.has(k)) seen.delete(k);
  return marks.map((m) => {
    if (!seen.has(m.key)) seen.set(m.key, first ? now - TRAIL_FRESH_MS : now);
    return { ...m, age: now - seen.get(m.key) };
  });
}
