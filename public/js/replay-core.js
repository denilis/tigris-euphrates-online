// Просмотр партии по ходам (этап 3, 04.11): чистые функции без DOM, их проверяют тесты.

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

