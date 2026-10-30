// Расчеты зачета для страницы статистики: чистые функции без DOM, их проверяют тесты.

/** Место игрока i для подсчета: 0 первое, 1 деленное первое, 2 второе, 3 третье. */
export function slot(g, i) {
  const p = g.place[i];
  if (p === 1) return g.place.filter((x) => x === 1).length > 1 ? 1 : 0;
  return p === 2 ? 2 : 3;
}

/** Сумма очков и счетчики мест каждого игрока. */
export function totals(games) {
  const t = { pts: [0, 0, 0], places: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] };
  for (const g of games) {
    for (let i = 0; i < 3; i++) {
      t.pts[i] += g.pts[i];
      t.places[i][slot(g, i)]++;
    }
  }
  return t;
}

/** Номера игроков по убыванию очков. */
export const ranking = (t) => [0, 1, 2].sort((a, b) => t.pts[b] - t.pts[a]);

/** Накопленные очки: первая точка нули, дальше по точке на партию. */
export function cumulative(games) {
  const out = [[0, 0, 0]];
  for (const g of games) out.push(out[out.length - 1].map((v, i) => v + g.pts[i]));
  return out;
}

/** Партии в границах дат включительно; пустая граница не ограничивает. Даты в виде 2026-10-30. */
export const inRange = (games, from, to) => games.filter((g) => (!from || g.date >= from) && (!to || g.date <= to));
