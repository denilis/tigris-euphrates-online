// Турниры и их статистика. Первый турнир, сезон Дениса, Влада и Андрея, встроен: это партии с BGA
// из переноса и партии сайта с этими тремя. Партия попадает в турнир по составу людей (бот для
// состава не нужен) или по выбору организатора в лобби. Место бот занимает: см. tourGame.
import { BGA_GAMES } from './season-bga.js';
import { BGA_DETAILS } from './season-bga-details.js';
import { placesFromVectors } from '../game/order.js';
import { tableDay } from '../game/table.js';

// порядок как в переносе: в массивах партии сначала Денис, потом Влад и Андрей
export const SEASON_PLAYERS = ['Денис', 'Влад', 'Андрей'];
export const SEASON = { id: 'season', name: 'Сезон: Денис, Влад, Андрей', players: SEASON_PLAYERS.map((name) => ({ name })), builtin: true, createdAt: 0 };

const norm = (name) => String(name || '').trim().toLowerCase();

/** Очки зачета по местам: первое 4, деленное первое по 2, второе 2, третье 1, четвертое 0 (правило от 23.08.2026). */
export function seasonPoints(places) {
  const shared = places.filter((p) => p === 1).length > 1;
  return places.map((p) => (p === 1 ? (shared ? 2 : 4) : p === 2 ? 2 : p === 3 ? 1 : 0));
}

/** Места участников турнира за столом в порядке турнира или null, если состав другой. Сезон сверяется по именам. */
function seatsOf(tour, e) {
  const humans = e.seats.filter((s) => s.kind === 'human');
  if (humans.length !== tour.players.length) return null;
  const seats = tour.players.map((p) => humans.find((s) => (p.id ? s.userId === p.id : norm(s.name) === norm(p.name))));
  return seats.some((s) => !s) ? null : seats;
}

/** Турнир партии: выбранный организатором, иначе первый подходящий по составу; null, если партия вне турниров. */
export function tourOf(e, tours) {
  const pick = e.tour ?? 'auto';
  if (pick === 'none') return null;
  // турнир считает партии с момента создания: старые партии этого состава в него не попадают
  const fit = tours.filter((t) => !(e.finishedAt < t.createdAt) && seatsOf(t, e));
  return fit.find((t) => t.id === pick) || fit[0] || null;
}

/**
 * Партия сайта в формате статистики турнира или null, если за столом другой состав.
 * Места считаются среди всех за столом: бот в состав турнира не входит, но играет как еще один
 * участник: человек, которого бот обогнал, опускается на место ниже (решение Дениса и Влада 04.11.2026).
 */
function tourGame(tour, e) {
  const seats = seatsOf(tour, e);
  if (!seats) return null;
  const vectors = seats.map((s) => s.vector);
  const all = placesFromVectors(e.seats.map((s) => s.vector));
  const allPts = seasonPoints(all); // деленное с ботом первое место тоже деленное
  const pick = (arr) => seats.map((s) => arr[e.seats.indexOf(s)]);
  const [d, m, y] = tableDay(e.finishedAt).split('.');
  return { date: `${y}-${m}-${d}`, source: 'site', table: e.title || '', code: e.code || null, score: vectors.map((v) => v[0]), place: pick(all), pts: pick(allPts), details: seats.map((s) => s.d ?? null) };
}

export const siteGame = (e) => tourGame(SEASON, e);

const isoDay = (at) => {
  const [d, m, y] = tableDay(at).split('.');
  return `${y}-${m}-${d}`;
};
/** Победа: первое место, ни с кем не деленное. */
const cleanWin = (places, place) => place === 1 && places.filter((p) => p === 1).length === 1;

/**
 * Все партии игрока для личной статистики (просьба Дениса 04.11): партии сайта, где он сидел
 * человеком (с ботами и с людьми, в турнирах и вне), и партии BGA сезона (по имени). От старых
 * к новым. Партия: { date, at, source, kind: 'bga' | 'people' | 'bots', group, table, code,
 * place, win, score, seats: [{ name, kind, place, score }], d }; d: подробности игрока или null.
 */
export function playerGames(player, history, tours) {
  const out = [];
  const bi = SEASON_PLAYERS.findIndex((n) => norm(n) === norm(player.name));
  if (bi >= 0) {
    for (const [date, table, score, place] of BGA_GAMES) {
      out.push({
        date, at: Date.parse(date), source: 'bga', kind: 'bga', group: `${SEASON.name} (BGA)`, table: String(table), code: null,
        place: place[bi], win: cleanWin(place, place[bi]), score: score[bi],
        seats: SEASON_PLAYERS.map((name, i) => ({ name, kind: 'human', place: place[i], score: score[i] })),
        d: BGA_DETAILS[table]?.[bi] ?? null,
      });
    }
  }
  for (const e of history) {
    const humans = e.seats.filter((s) => s.kind === 'human');
    const me = humans.find((s) => (s.userId ? s.userId === player.id : norm(s.name) === norm(player.name)));
    if (!me) continue;
    const kind = humans.length === 1 ? 'bots' : 'people';
    const t = kind === 'people' ? tourOf(e, tours) : null;
    const group = t ? (t.builtin ? `${t.name} (сайт)` : t.name) : kind === 'bots' ? 'С ботами' : 'С людьми вне турниров';
    const places = e.seats.map((s) => s.place);
    out.push({
      date: isoDay(e.finishedAt), at: e.finishedAt, source: 'site', kind, group, table: e.title || '', code: e.code || null,
      place: me.place, win: cleanWin(places, me.place), score: me.vector?.[0] ?? 0,
      seats: e.seats.map((s) => ({ name: s.name, kind: s.kind, place: s.place, score: s.vector?.[0] ?? 0 })),
      d: me.d ?? null,
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Все партии турнира от старых к новым. tours — все турниры, history — партии сайта в любом порядке. */
export function tourGames(tour, tours, history) {
  const bga = tour.builtin ? BGA_GAMES.map(([date, table, score, place, pts]) => ({ date, source: 'bga', table: String(table), score, place, pts, details: BGA_DETAILS[table] ?? null })) : [];
  const site = [...history].sort((a, b) => a.finishedAt - b.finishedAt).filter((e) => tourOf(e, tours)?.id === tour.id).map((e) => tourGame(tour, e));
  return [...bga, ...site];
}

export const seasonGames = (history) => tourGames(SEASON, [SEASON], history);

/** Турнир для браузера: имена участников, без внутренних номеров. */
export const publicTour = (t) => ({ id: t.id, name: t.name, players: t.players.map((p) => p.name) });
