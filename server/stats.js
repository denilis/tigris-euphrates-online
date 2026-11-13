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

/**
 * Места участников турнира за столом в порядке турнира или null, если состав другой. Сезон сверяется
 * по именам. who — справочник людей (server/people.js): с ним участник и место узнаются еще и по
 * учетной записи, и игрок, сменивший имя, остается в турнире (13.11). Сверка по имени на месте при
 * этом остается: у старых партий номер игрока на месте мог быть другим. Без who все как раньше.
 */
function seatsOf(tour, e, who) {
  const humans = e.seats.filter((s) => s.kind === 'human');
  if (humans.length !== tour.players.length) return null;
  const seats = tour.players.map((p) => {
    const id = p.id || who?.idOf(p.name) || null;
    return humans.find((s) => (id && (who ? who.owner(s) : s.userId) === id) || (!p.id && norm(s.name) === norm(p.name)));
  });
  // каждому участнику свое место: один человек не может закрыть собой двух участников
  return seats.some((s) => !s) || new Set(seats).size !== seats.length ? null : seats;
}

/** Турнир партии: выбранный организатором, иначе первый подходящий по составу; null, если партия вне турниров. */
export function tourOf(e, tours, who = null) {
  const pick = e.tour ?? 'auto';
  if (pick === 'none') return null;
  // турнир считает партии с момента создания: старые партии этого состава в него не попадают
  const fit = tours.filter((t) => !(e.finishedAt < t.createdAt) && seatsOf(t, e, who));
  return fit.find((t) => t.id === pick) || fit[0] || null;
}

/**
 * Партия сайта в формате статистики турнира или null, если за столом другой состав.
 * Места считаются среди всех за столом: бот в состав турнира не входит, но играет как еще один
 * участник: человек, которого бот обогнал, опускается на место ниже (решение Дениса и Влада 04.11.2026).
 */
function tourGame(tour, e, who = null) {
  const seats = seatsOf(tour, e, who);
  if (!seats) return null;
  const vectors = seats.map((s) => s.vector);
  const all = placesFromVectors(e.seats.map((s) => s.vector));
  const allPts = seasonPoints(all); // деленное с ботом первое место тоже деленное
  const pick = (arr) => seats.map((s) => arr[e.seats.indexOf(s)]);
  const [d, m, y] = tableDay(e.finishedAt).split('.');
  return { date: `${y}-${m}-${d}`, source: 'site', table: e.title || '', code: e.code || null, score: vectors.map((v) => v[0]), place: pick(all), pts: pick(allPts), details: seats.map((s) => s.d ?? null) };
}

export const siteGame = (e, who = null) => tourGame(SEASON, e, who);

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
 * place, win, score, seats: [{ name, kind, place, score, self, d }], d }; d: подробности игрока или null.
 * У мест подробности каждого: по ним вкладка сравнивает игрока с соперниками (Денис 04.11), self
 * отмечает его собственное место. who — справочник людей: с ним партии BGA и старые партии без номера
 * игрока находятся и после смены имени, а соперники подписаны нынешними именами (один человек — одна
 * строка в сравнении с соперниками). Без who сверка по имени, как раньше.
 */
export function playerGames(player, history, tours, who = null) {
  const out = [];
  // чье имя: по справочнику, а если такого имени в нем нет, по совпадению с именем игрока
  const mine = (name) => (who?.idOf(name) ? who.idOf(name) === player.id : norm(name) === norm(player.name));
  const label = (s) => (who ? who.label(s) : s.name);
  const bi = SEASON_PLAYERS.findIndex(mine);
  if (bi >= 0) {
    for (const [date, table, score, place] of BGA_GAMES) {
      out.push({
        date, at: Date.parse(date), source: 'bga', kind: 'bga', group: `${SEASON.name} (BGA)`, table: String(table), code: null,
        place: place[bi], win: cleanWin(place, place[bi]), score: score[bi],
        seats: SEASON_PLAYERS.map((name, i) => ({ name: label({ kind: 'human', name }), kind: 'human', place: place[i], score: score[i], self: i === bi, d: BGA_DETAILS[table]?.[i] ?? null })),
        d: BGA_DETAILS[table]?.[bi] ?? null,
      });
    }
  }
  for (const e of history) {
    const humans = e.seats.filter((s) => s.kind === 'human');
    const me = humans.find((s) => (s.userId ? s.userId === player.id : mine(s.name)));
    if (!me) continue;
    const kind = humans.length === 1 ? 'bots' : 'people';
    const t = kind === 'people' ? tourOf(e, tours, who) : null;
    const group = t ? (t.builtin ? `${t.name} (сайт)` : t.name) : kind === 'bots' ? 'С ботами' : 'С людьми вне турниров';
    const places = e.seats.map((s) => s.place);
    out.push({
      date: isoDay(e.finishedAt), at: e.finishedAt, source: 'site', kind, group, table: e.title || '', code: e.code || null,
      place: me.place, win: cleanWin(places, me.place), score: me.vector?.[0] ?? 0,
      seats: e.seats.map((s) => ({ name: label(s), kind: s.kind, place: s.place, score: s.vector?.[0] ?? 0, self: s === me, d: s.d ?? null })),
      d: me.d ?? null,
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Все партии турнира от старых к новым. tours — все турниры, history — партии сайта в любом порядке. */
export function tourGames(tour, tours, history, who = null) {
  const bga = tour.builtin ? BGA_GAMES.map(([date, table, score, place, pts]) => ({ date, source: 'bga', table: String(table), score, place, pts, details: BGA_DETAILS[table] ?? null })) : [];
  const site = [...history].sort((a, b) => a.finishedAt - b.finishedAt).filter((e) => tourOf(e, tours, who)?.id === tour.id).map((e) => tourGame(tour, e, who));
  return [...bga, ...site];
}

export const seasonGames = (history, who = null) => tourGames(SEASON, [SEASON], history, who);

/** Имена участников турнира: нынешние, если человек известен справочнику, иначе как записаны в турнире. */
export const tourNames = (t, who = null) => t.players.map((p) => who?.nameOfId(p.id || who.idOf(p.name)) || p.name);

/**
 * Турнир для браузера: имена участников и, если есть справочник, их номера (ids, null у неизвестного):
 * по номерам лобби сверяет состав стола с турниром, когда имя на месте уже другое.
 */
export const publicTour = (t, who = null) => ({
  id: t.id, name: t.name, players: tourNames(t, who),
  ...(who ? { ids: t.players.map((p) => p.id || who.idOf(p.name) || null) } : {}),
});
