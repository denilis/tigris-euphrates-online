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

// --- подробности турнира (этап 2 пакета 04.11): бои, цвета, откуда очки, рекорды, награды

export const SOURCES = [['tile', 'тайлы'], ['building', 'здания'], ['war', 'войны'], ['revolt', 'восстания'], ['monument', 'монументы']];

const won = (a) => a[0] + a[2];
const fought = (a) => a[0] + a[1] + a[2] + a[3];

/** Самая длинная серия чистых первых мест подряд у каждого игрока (делёное первое серию рвет). */
export function streaks(games, n) {
  const best = zeros(n), cur = zeros(n);
  for (const g of games) {
    for (let i = 0; i < n; i++) {
      cur[i] = slot(g, i) === 0 ? cur[i] + 1 : 0;
      best[i] = Math.max(best[i], cur[i]);
    }
  }
  return best;
}

/**
 * Подробности за период: games — партии турнира (у партии details по игрокам или null), n — игроков.
 * Считаются только партии, где подробности есть у всех. Возвращает { count, total, players, records, awards }.
 */
export function dashboard(games, n) {
  const withD = games.filter((g) => g.details?.length === n && g.details.every(Boolean));
  const players = Array.from({ length: n }, () => ({
    games: withD.length, war: [0, 0, 0, 0], revolt: [0, 0, 0, 0], mon: 0, cat: 0, tr: 0,
    c: [0, 0, 0, 0], src: Object.fromEntries(SOURCES.map(([k]) => [k, 0])), best: [null, null, null, null], big: null,
  }));
  for (const g of withD) {
    g.details.forEach((d, i) => {
      const p = players[i];
      for (let k = 0; k < 4; k++) {
        p.war[k] += d.war[k];
        p.revolt[k] += d.revolt[k];
        p.c[k] += d.c[k];
        if (!p.best[k] || d.c[k] > p.best[k].v) p.best[k] = { v: d.c[k], g };
      }
      for (const [k] of SOURCES) p.src[k] += d.src[k] || 0;
      p.mon += d.mon;
      p.cat += d.cat;
      p.tr += d.tr;
      if (d.big && (!p.big || d.big > p.big.v)) p.big = { v: d.big, g };
    });
  }
  const top = (val) => {
    let r = null;
    players.forEach((p, i) => { const x = val(p, i); if (x && (!r || x.v > r.v)) r = { ...x, i }; });
    return r;
  };
  // лучший итог считается по всем партиям периода: счет есть и без подробностей
  let bestScore = null;
  for (const g of games) g.score.forEach((v, i) => { if (!bestScore || v > bestScore.v) bestScore = { v, g, i }; });
  const streak = streaks(games, n);
  const records = {
    colors: [0, 1, 2, 3].map((k) => top((p) => p.best[k])),
    score: bestScore,
    battle: top((p) => p.big),
    streak: top((p, i) => (streak[i] ? { v: streak[i] } : null)),
  };
  // key: имя медали public/img/awards/<key>.webp (Денис 06.11)
  const AWARDS = [
    ['war', 'Полководец', 'больше всех побед в войнах', (p) => won(p.war)],
    ['mon', 'Строитель', 'больше всех монументов', (p) => p.mon],
    ['revolt', 'Мятежник', 'больше всех побед в восстаниях', (p) => won(p.revolt)],
    ['cat', 'Разрушитель', 'больше всех катастроф', (p) => p.cat],
    ['tr', 'Казначей', 'больше всех сокровищ', (p) => p.tr],
    ['streak', 'Серия', 'самая длинная серия первых мест подряд', (p, i) => streak[i]],
  ];
  const awards = AWARDS.map(([key, title, text, val]) => {
    const vals = players.map(val);
    const max = Math.max(...vals);
    return { key, title, text, value: max, winners: max > 0 ? vals.flatMap((v, i) => (v === max ? [i] : [])) : [] };
  });
  return { count: withD.length, total: games.length, players, records, awards };
}

/** «31 из 48» и доля побед: для карточек игроков. */
export const winShare = (a) => ({ won: won(a), fought: fought(a), pct: fought(a) ? Math.round((100 * won(a)) / fought(a)) : null });
