// След хода: что отметить на поле после хода соперника. Чистые функции над журналом стола.
import { squareCells } from './pick.js';
import { TILE, LEADER, HERONAME, cellName } from './util.js';

const WHAT = { catastrophe: 'катастрофа', building: 'здание', monument: 'монумент', wonder: 'чудо' };

/** Подпись хода на поле: «Лук: храм» (герой игрока и что он поставил). */
export function markLabel(m, hero) {
  const who = HERONAME[hero] ? HERONAME[hero][0].toUpperCase() + HERONAME[hero].slice(1) : 'Соперник';
  const what = m.ev === 'tile' ? TILE[m.c] : m.ev === 'leader' ? LEADER[m.c] : WHAT[m.ev];
  return `${who}: ${what || 'ход'}`;
}

/** Строка списка «Прошлый ход»: «Лук: храм на G5». */
export const markLine = (m) => `${m.label} на ${cellName(m.pos)}`;

// 08.11 (Денис: с тремя ботами не уследить, куда пошли): рамка пульсирует дольше, тайл садится медленнее
// стрелка переноса лидера гаснет через 15 с после хода (Денис 08.11), рамка хода остается
export const TRAIL_ARROW_MS = 15000;
export const TRAIL_FRESH_MS = 4500; // столько рамка пульсирует и видна подпись «Лук: храм»
// столько тайл или лидер соперника плавно появляется на клетке (04.11: раньше 450 мс садилась
// копия поверх уже нарисованного тайла, и казалось, что тайл возникает сразу; 08.11: 900 -> 1500)
export const TRAIL_LAND_MS = 1500;

// в каком поле записи журнала лежит клетка действия
const CELL = { tile: 'pos', leader: 'pos', catastrophe: 'pos', building: 'pos', wonder: 'center', monument: 'tl' };

/**
 * Отметки по записям журнала: [{ key, ev, pos, size, action, actor, turn, c, n, from? }]. На клетке
 * остается последнее действие (лидер проиграл восстание, на его место лег тайл). n — номер на поле:
 * у seq по порядку действий (1, 2, 3...), иначе номер действия в ходе (1 или 2).
 */
function marksOf(entries, seq) {
  const byCell = new Map();
  const nums = new Map(); // ход:игрок:действие -> номер по порядку
  for (const e of entries) {
    const field = CELL[e.ev];
    if (!field) continue;
    const act = `${e.turn}:${e.actor}:${e.action}`;
    if (!nums.has(act)) nums.set(act, nums.size + 1);
    const monument = e.ev === 'monument';
    const was = byCell.get(e[field]);
    if (!monument && was && `${was.turn}:${was.actor}:${was.action}` === act) continue; // тайл и здание одним действием
    const m = { key: `${act}:${e[field]}`, ev: e.ev, pos: e[field], size: monument ? 2 : 1, action: e.action, actor: e.actor, turn: e.turn, c: e.c, n: seq ? nums.get(act) : e.action };
    if (e.ev === 'leader' && e.from >= 0) m.from = e.from;
    // монумент закрывает тайлы под собой
    for (const c of monument ? squareCells(m.pos) : [m.pos]) byCell.delete(c);
    byCell.set(m.pos, m);
  }
  return [...byCell.values()].sort((a, b) => a.n - b.n);
}

/**
 * Отметки последнего хода другого игрока (просмотр партии и зритель).
 * Свой ход следа не дает, поэтому след гаснет с первым действием следующего игрока.
 */
export function trailMarks(log, me) {
  const last = log[log.length - 1];
  if (!last || last.actor === me) return [];
  let i = log.length;
  while (i > 0 && log[i - 1].turn === last.turn && log[i - 1].actor === last.actor) i--;
  return marksOf(log.slice(i), false);
}

/**
 * Все ходы соперников с моего прошлого действия (08.11 утром, игра против трех ботов; вечером Денис
 * попросил только ход предыдущего игрока, стол берет trailMarks): номера по порядку,
 * след стоит до моего первого действия. Пас в журнал не пишется, поэтому окно не длиннее круга:
 * np - 1 чужих ходов.
 */
export function sinceMine(log, me, np) {
  let i = log.length;
  const turns = new Set();
  while (i > 0) {
    const e = log[i - 1];
    if (e.actor === me) break;
    if (!turns.has(e.turn) && turns.size >= Math.max(1, np - 1)) break;
    turns.add(e.turn);
    i--;
  }
  return marksOf(log.slice(i), true);
}

/** Клетки, где тайл или лидер соперника еще появляется: Map(клетка, возраст отметки в мс). */
export function landing(marks) {
  return new Map(marks.filter((m) => (m.ev === 'tile' || m.ev === 'leader') && m.age < TRAIL_LAND_MS).map((m) => [m.pos, m.age]));
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
