// Расчеты зачета для страницы статистики: чистые функции без DOM, их проверяют тесты.

/** Место игрока i для подсчета: 0 первое, 1 деленное первое, 2 второе, 3 третье, 4 четвертое. */
export function slot(g, i) {
  const p = g.place[i];
  if (p === 1) return g.place.filter((x) => x === 1).length > 1 ? 1 : 0;
  return p === 2 ? 2 : p === 3 ? 3 : 4;
}

const zeros = (n) => Array(n).fill(0);
const sizeOf = (games) => games[0]?.pts.length ?? 3;

/**
 * Сколько счетчиков мест показывать: первое, ничья, второе и так до худшего места. Бот занимает
 * место за столом, поэтому в турнире втроем бывает и четвертое (решение 04.11.2026).
 */
export function slotCount(games, n) {
  const worst = Math.max(n, ...games.flatMap((g) => g.place));
  return Math.max(n === 4 ? 5 : 4, worst + 1);
}

/** Сумма очков и счетчики мест каждого игрока; n — число участников турнира, k — число счетчиков. */
export function totals(games, n = sizeOf(games), k = slotCount(games, n)) {
  const t = { pts: zeros(n), places: zeros(n).map(() => zeros(k)) };
  for (const g of games) {
    for (let i = 0; i < n; i++) {
      t.pts[i] += g.pts[i];
      t.places[i][slot(g, i)]++;
    }
  }
  return t;
}

/** Номера игроков по убыванию очков. */
export const ranking = (t) => t.pts.map((_, i) => i).sort((a, b) => t.pts[b] - t.pts[a]);

/** Накопленные очки: первая точка нули, дальше по точке на партию. */
export function cumulative(games, n = sizeOf(games)) {
  const out = [zeros(n)];
  for (const g of games) out.push(out[out.length - 1].map((v, i) => v + g.pts[i]));
  return out;
}

const norm = (name) => String(name || '').trim().toLowerCase();

/** Турниры, чей состав совпал с людьми за столом: бот и пустые места не считаются. */
export function fitTours(tours, seats) {
  const names = seats.filter((s) => s.kind === 'human' && s.taken).map((s) => norm(s.name));
  return tours.filter((t) => t.players.length === names.length && t.players.every((p) => names.includes(norm(p))));
}

/** Турнир, в который пойдет партия; null, если организатор снял ее с зачета. */
export const tourChoice = (fit, pick = 'auto') => (pick === 'none' ? null : fit.find((t) => t.id === pick) || fit[0] || null);

/** Партии в границах дат включительно; пустая граница не ограничивает. Даты в виде 2026-10-30. */
export const inRange = (games, from, to) => games.filter((g) => (!from || g.date >= from) && (!to || g.date <= to));
