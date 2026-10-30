// Зачет сезона: партии с BGA из переноса и партии сайта, где сели все трое (бот не считается).
import { BGA_GAMES } from './season-bga.js';
import { placesFromVectors } from '../game/order.js';
import { tableDay } from '../game/table.js';

// порядок как в переносе: в массивах партии сначала Денис, потом Влад и Андрей
export const SEASON_PLAYERS = ['Денис', 'Влад', 'Андрей'];

const norm = (name) => String(name || '').trim().toLowerCase();

/** Очки зачета по местам: первое 4, деленное первое по 2, второе 2, третье 1 (правило от 23.08.2026). */
export function seasonPoints(places) {
  const shared = places.filter((p) => p === 1).length > 1;
  return places.map((p) => (p === 1 ? (shared ? 2 : 4) : p === 2 ? 2 : 1));
}

/** Партия сайта в формате зачета или null, если за столом не сидели ровно эти трое. */
export function siteGame(e) {
  const humans = e.seats.filter((s) => s.kind === 'human');
  const seats = SEASON_PLAYERS.map((n) => humans.find((s) => norm(s.name) === norm(n)));
  if (humans.length !== 3 || seats.some((s) => !s)) return null;
  const vectors = seats.map((s) => s.vector);
  const place = placesFromVectors(vectors);
  const [d, m, y] = tableDay(e.finishedAt).split('.');
  return { date: `${y}-${m}-${d}`, source: 'site', table: e.title || '', score: vectors.map((v) => v[0]), place, pts: seasonPoints(place) };
}

/** Все партии зачета от старых к новым. history — записи партий сайта в любом порядке. */
export function seasonGames(history) {
  const bga = BGA_GAMES.map(([date, table, score, place, pts]) => ({ date, source: 'bga', table: String(table), score, place, pts }));
  const site = [...history].sort((a, b) => a.finishedAt - b.finishedAt).map(siteGame).filter(Boolean);
  return [...bga, ...site];
}
