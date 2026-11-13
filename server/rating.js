// Рейтинг игроков (просьба Дениса 13.11.2026: в профиле «мой рейтинг»). Система Эло для партий на
// нескольких человек: после партии каждый сравнивается с каждым соперником по занятому месту.
// В расчет идут партии сезона BGA и партии сайта, где людей двое и больше. Боты не в счет: их места
// не сравниваются, и партии с одними ботами рейтинг не меняют (иначе его можно набить на слабых ботах).
// Партии, которые хозяин стола снял с зачета («партия идет в зачет» выключено), тоже не считаются.
// Рейтинг нигде не хранится: считается заново по истории, она небольшая.
import { BGA_GAMES } from './season-bga.js';
import { SEASON_PLAYERS } from './stats.js';
import { nameKey } from './people.js';

export const RATING_START = 1500;
export const RATING_K = 32;

const expected = (a, b) => 1 / (1 + 10 ** ((b - a) / 400));

/**
 * Рейтинги по партиям. games: [{ at, seats: [{ id, place }] }] в любом порядке; партии считаются от
 * старых к новым, при равном времени в порядке списка. Возвращает Map: id -> { rating, games, last },
 * rating дробный, last — изменение за последнюю партию игрока.
 */
export function ratings(games) {
  const out = new Map();
  const get = (id) => {
    let r = out.get(id);
    if (!r) out.set(id, r = { rating: RATING_START, games: 0, last: 0 });
    return r;
  };
  const sorted = games.map((g, i) => ({ g, i })).sort((a, b) => a.g.at - b.g.at || a.i - b.i);
  for (const { g } of sorted) {
    const seats = g.seats.filter((s) => s.id && Number.isFinite(s.place));
    if (new Set(seats.map((s) => s.id)).size < 2 || seats.length !== new Set(seats.map((s) => s.id)).size) continue;
    const before = seats.map((s) => get(s.id).rating);
    const delta = seats.map((s, i) => {
      let sum = 0;
      seats.forEach((o, j) => {
        if (j === i) return;
        const score = s.place < o.place ? 1 : s.place === o.place ? 0.5 : 0;
        sum += score - expected(before[i], before[j]);
      });
      return (RATING_K * sum) / (seats.length - 1);
    });
    seats.forEach((s, i) => {
      const r = get(s.id);
      r.rating += delta[i];
      r.games++;
      r.last = delta[i];
    });
  }
  return out;
}

/**
 * Партии для рейтинга из истории сайта и сезона BGA. who — справочник людей (server/people.js).
 * Человек без учетной записи (имя из сезона, которого нет среди игроков) участвует под ключом
 * «name:имя»: соперникам партия с ним засчитывается, в таблицу мест он не попадает.
 */
export function ratedGames(history, who) {
  // место без номера и без имени никем не считаем: общий ключ склеил бы разных людей в одного
  const id = (seat) => who.owner(seat) || (nameKey(seat.name) ? `name:${nameKey(seat.name)}` : null);
  const games = BGA_GAMES.map(([date, , , place]) => ({
    at: Date.parse(date),
    seats: SEASON_PLAYERS.map((name, i) => ({ id: id({ name }), place: place[i] })),
  }));
  for (const e of history) {
    const humans = e.seats.filter((s) => s.kind === 'human');
    if (humans.length < 2 || e.tour === 'none') continue;
    games.push({ at: e.finishedAt, seats: humans.map((s) => ({ id: id(s), place: s.place })) });
  }
  return games;
}

/**
 * Строка профиля: { value, games, last, rank, of } или null, если у игрока нет партий с людьми.
 * rank — место среди игроков с учетной записью (у кого рейтинг выше, тот выше; равные делят место).
 * listed(id) — кого показывать в таблице мест (отозванных не показываем); сам игрок в ней всегда.
 */
export function ratingOf(userId, table, listed = () => true) {
  const mine = table.get(userId);
  if (!mine || !mine.games) return null;
  const rated = [...table].filter(([id, r]) => r.games > 0 && !String(id).startsWith('name:') && (id === userId || listed(id)));
  const value = Math.round(mine.rating);
  return {
    value, games: mine.games, last: Math.round(mine.last),
    rank: 1 + rated.filter(([, r]) => Math.round(r.rating) > value).length,
    of: rated.length,
  };
}
