// Турниры и их статистика. Первый турнир, сезон Дениса, Влада и Андрея, встроен: это партии с BGA
// из переноса и партии сайта с этими тремя. Партия попадает в турнир по составу людей (бот не
// считается) или по выбору организатора в лобби.
import { BGA_GAMES } from './season-bga.js';
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

/** Партия сайта в формате статистики турнира или null, если за столом другой состав. */
function tourGame(tour, e) {
  const seats = seatsOf(tour, e);
  if (!seats) return null;
  const vectors = seats.map((s) => s.vector);
  const place = placesFromVectors(vectors);
  const [d, m, y] = tableDay(e.finishedAt).split('.');
  return { date: `${y}-${m}-${d}`, source: 'site', table: e.title || '', code: e.code || null, score: vectors.map((v) => v[0]), place, pts: seasonPoints(place) };
}

export const siteGame = (e) => tourGame(SEASON, e);

/** Все партии турнира от старых к новым. tours — все турниры, history — партии сайта в любом порядке. */
export function tourGames(tour, tours, history) {
  const bga = tour.builtin ? BGA_GAMES.map(([date, table, score, place, pts]) => ({ date, source: 'bga', table: String(table), score, place, pts })) : [];
  const site = [...history].sort((a, b) => a.finishedAt - b.finishedAt).filter((e) => tourOf(e, tours)?.id === tour.id).map((e) => tourGame(tour, e));
  return [...bga, ...site];
}

export const seasonGames = (history) => tourGames(SEASON, [SEASON], history);

/** Турнир для браузера: имена участников, без внутренних номеров. */
export const publicTour = (t) => ({ id: t.id, name: t.name, players: t.players.map((p) => p.name) });
