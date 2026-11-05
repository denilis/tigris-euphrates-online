// Просмотр партии по ходам (этап 3, 04.11): чистые функции без DOM, их проверяют тесты.
import { matchStats } from './matchstats.js';
import { kingdomLeaders } from './util.js';

export const FIELDS = ['tile', 'leader', 'treasure', 'building', 'monument'];
/** Все кадры подряд: [0] начало партии, [k] после действия k. Поле собирается из изменений. */
export function framesBoards(data) {
  const out = [];
  const board = Object.fromEntries(FIELDS.map((f) => [f, [...data.start.board[f]]]));
  const snap = (x) => ({ board: Object.fromEntries(FIELDS.map((f) => [f, [...board[f]]])), mons: x.mons, wonder: x.wonder, bpos: x.bpos, scores: x.scores });
  out.push(snap(data.start));
  for (const f of data.frames) {
    for (const [fi, i, v] of f.diff) board[FIELDS[fi]][i] = v;
    out.push(snap(f));
  }
  return out;
}

/** Отметки на шкале: войны и восстания красным, монументы и чудо золотом. [{ k, kind }] */
export function timelineMarks(frames) {
  const out = [];
  frames.forEach((f, j) => {
    if (f.entries.some((e) => e.ev === 'war' || e.ev === 'revolt')) out.push({ k: j + 1, kind: 'war' });
    if (f.entries.some((e) => e.ev === 'monument' || e.ev === 'wonder')) out.push({ k: j + 1, kind: 'mon' });
  });
  return out;
}


// Аналитика просмотра (просьба Дениса 05.11): рост очков, бои и монументы на момент кадра.

/** Бои и очки за них с начала партии по кадр k включительно: matchStats по записям кадров 1..k. */
export function battlesAt(frames, k, seats) {
  return matchStats(frames.slice(0, k).flatMap((f) => f.entries), seats);
}

/**
 * Монументы под контролем на поле кадра: половина монумента цвета c у игрока движка p, если его
 * лидер цвета c стоит в том же царстве (это очко ему в конце его хода, как считает движок).
 * Возвращает { own: [p][c] сколько половин, list: [{ c1, c2, h1, h2 }] }, h — игрок движка или null.
 */
export function monumentHolds(board, monuments, np) {
  const own = Array.from({ length: np }, () => [0, 0, 0, 0]);
  const { lab, lead } = kingdomLeaders(board);
  const list = [];
  for (const m of monuments) {
    if (!(m.pos >= 0)) continue;
    const a = lab[m.pos] >= 0 ? lead.get(lab[m.pos]) : null;
    const who = (c) => (a && a[c] >= 0 ? a[c] : null);
    const h1 = who(m.c1), h2 = who(m.c2);
    if (h1 != null) own[h1][m.c1]++;
    if (h2 != null) own[h2][m.c2]++;
    list.push({ c1: m.c1, c2: m.c2, h1, h2 });
  }
  return { own, list };
}

/** Чей царь стоит в царстве чуда (ему очко за чудо), иначе null; чуда нет — undefined. */
export function wonderHolder(board, wonderPos) {
  if (!(wonderPos >= 0)) return undefined;
  const { lab, lead } = kingdomLeaders(board);
  const a = lab[wonderPos] >= 0 ? lead.get(lab[wonderPos]) : null;
  return a && a[3] >= 0 ? a[3] : null;
}
