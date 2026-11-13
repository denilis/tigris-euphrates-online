// Сводка для страницы «Мой профиль» (13.11.2026): считается из тех же партий, что личная статистика
// (server/stats.js playerGames), поэтому числа с ней сходятся.

const WEEK_MS = 7 * 24 * 3600 * 1000;
export const RECENT_GAMES = 3;

/**
 * games — партии игрока от старых к новым (playerGames), now — текущее время в мс.
 * Возвращает { games, wins, pct, avgPlace, week, where: { people, bots, bga }, since, recent }.
 * avgPlace — число с одним знаком или null; since — время первой партии или null; recent — последние
 * партии, новые сверху: { date, group, kind, place, of, code, table, seats: [{ name, place, self, bot }] }.
 */
export function profileSummary(games, now) {
  const n = games.length;
  const wins = games.filter((g) => g.win).length;
  const where = { people: 0, bots: 0, bga: 0 };
  for (const g of games) if (g.kind in where) where[g.kind]++;
  return {
    games: n,
    wins,
    pct: n ? Math.round((100 * wins) / n) : null,
    avgPlace: n ? Math.round((10 * games.reduce((a, g) => a + g.place, 0)) / n) / 10 : null,
    week: games.filter((g) => now - g.at <= WEEK_MS).length,
    where,
    since: n ? games[0].at : null,
    recent: games.slice(-RECENT_GAMES).reverse().map((g) => ({
      date: g.date, group: g.group, kind: g.kind, place: g.place, of: g.seats.length, code: g.code, table: g.table,
      seats: g.seats.map((s) => ({ name: s.name, place: s.place, self: Boolean(s.self), bot: s.kind === 'bot' })),
    })),
  };
}
