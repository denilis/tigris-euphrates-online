// События движка → публичный журнал стола. Игроки в журнале названы местами за столом
// (индекс движка переводится через order), всё в событиях движка видно всем за столом.
const SEAT_KEYS = new Set(['att', 'def', 'winner', 'loser']);

/**
 * events — s.log после одного хода; order — индекс движка → место;
 * meta — { turn, cur, action } на момент хода (кто ходил и каким действием).
 */
export function journalEntries(events, order, meta) {
  const actor = order[meta.cur];
  const out = [];
  for (const ev of events) {
    const e = { ev: ev.ev, turn: meta.turn, actor, action: meta.action };
    for (const [k, v] of Object.entries(ev)) {
      if (k === 'ev') continue;
      if (k === 'p') e.seat = order[v];
      else if (SEAT_KEYS.has(k)) e[k] = order[v];
      else e[k] = v;
    }
    out.push(e);
    // за восстание движок начисляет +1 красный без события очка: дописываем запись сами
    if (ev.ev === 'revolt') out.push({ ev: 'score', turn: meta.turn, actor, action: meta.action, seat: order[ev.winner], c: 0, n: 1, why: 'revolt' });
  }
  return out;
}
