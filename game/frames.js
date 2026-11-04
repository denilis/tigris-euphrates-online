// Кадры для просмотра партии по ходам (этап 3 пакета 04.11). Кадр — одно действие игрока со
// всем, что из него вышло (бой, монумент, сокровище, конец хода). Сервер проходит запись партии
// движком и отдает только открытое: поле, очки и журнал. Руки и мешок в кадры не попадают.
//
// Ответ: { start, frames }. start — поле до первого хода целиком: { board, mons, wonder, bpos, scores }.
// Кадр: { turn, actor (место), action (1 или 2), entries (журнал действия, как в t.game.log),
// diff [[номер поля, клетка, значение]], mons, wonder, bpos, scores [[к, с, з, ч, сокровища] по игрокам движка] }.
import { replay } from './replay.js';
import { journalEntries } from './journal.js';

export const FIELDS = ['tile', 'leader', 'treasure', 'building', 'monument'];
const boardOf = (s) => Object.fromEntries(FIELDS.map((f) => [f, Array.from(s[f])]));
const extras = (s) => ({
  mons: s.monuments.map((m) => m.pos),
  wonder: s.wonderPos,
  bpos: [...s.buildingPos],
  scores: s.players.map((pl) => [...pl.score, pl.treasures]),
});

/** Кадры записанной партии. t — стол с t.game.rec; null, если записи нет. */
export function replayFrames(t) {
  const g = t.game;
  if (!g?.rec) return null;
  const order = g.order;
  let start = null, last = null, prev = null, cur = null;
  const frames = [];
  // кадр закрывается состоянием после последнего хода своего действия
  const close = () => {
    if (!cur) return;
    cur.diff = [];
    FIELDS.forEach((f, k) => last.board[f].forEach((v, i) => { if (v !== prev[f][i]) cur.diff.push([k, i, v]); }));
    Object.assign(cur, last.extras);
    prev = last.board;
    frames.push(cur);
    cur = null;
  };
  replay(g.rec, (s, move, i, before) => {
    if (before.phase === 'action' || !cur) {
      close();
      cur = { turn: before.turn, actor: order[before.cur], action: before.actionNo, entries: [] };
    }
    cur.entries.push(...journalEntries(s.log, order, { turn: before.turn, cur: before.cur, action: before.actionNo }));
    last = { board: boardOf(s), extras: extras(s) };
  }, (s) => {
    const board = boardOf(s);
    start = { board, ...extras(s) };
    prev = board;
    last = { board, extras: extras(s) };
  });
  close();
  return { start, frames };
}

/** Поле кадра k (0 — начало партии) по стартовому полю и изменениям: { board, mons, wonder, bpos, scores }. */
export function frameAt(data, k) {
  const board = Object.fromEntries(FIELDS.map((f) => [f, [...data.start.board[f]]]));
  let extra = data.start;
  for (let j = 0; j < k; j++) {
    for (const [fi, i, v] of data.frames[j].diff) board[FIELDS[fi]][i] = v;
    extra = data.frames[j];
  }
  return { board, mons: extra.mons, wonder: extra.wonder, bpos: extra.bpos, scores: extra.scores };
}
