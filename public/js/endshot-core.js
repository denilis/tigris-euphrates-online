// Картинка итога партии (этап 4 пакета 04.11): чистые функции без DOM, их проверяют тесты.
import { CHAT_PEOPLE } from './online.js';
import { fitTours, tourChoice } from './season.js';

const inChat = (name) => CHAT_PEOPLE.includes(String(name).trim().toLowerCase());

/** Кнопка «Отправить в чат ДВАК»: партия окончена, смотрит свой человек, за столом только свои. */
export function canSendPhoto(view, myName) {
  if (view.status !== 'over' || !view.game?.result || view.me == null) return false;
  return inChat(myName) && view.seats.filter((s) => s.kind === 'human' && s.taken).every((s) => inChat(s.name));
}

/** Строки мест для картинки: [{ place, name, final, score, treasures, seatId }] от первого места. */
export function pictureRows(view) {
  const seat = (id) => view.seats.find((s) => s.id === id);
  return [...view.game.result.seats].sort((a, b) => a.place - b.place).map((r) => ({
    place: r.place, seatId: r.seatId, name: seat(r.seatId)?.name || 'Бот', final: r.vector[0], score: r.score, treasures: r.treasures,
  }));
}

/** Очки зачета по местам среди всех за столом: 4, 2, 1, 0; деленное первое по 2 (как server/stats.js). */
export function placePoints(places) {
  const shared = places.filter((p) => p === 1).length > 1;
  return places.map((p) => (p === 1 ? (shared ? 2 : 4) : p === 2 ? 2 : p === 3 ? 1 : 0));
}

/**
 * Строка турнира для картинки или null: турнир, куда пошла партия (как в лобби: по составу людей
 * и выбору организатора), и очки зачета его участников.
 */
export function tourLine(tours, view) {
  const tour = tourChoice(fitTours(tours, view.seats), view.options.tournament ?? 'auto');
  if (!tour) return null;
  const rows = pictureRows(view);
  const pts = placePoints(rows.map((r) => r.place));
  const norm = (n) => String(n).trim().toLowerCase();
  const parts = rows.flatMap((r, i) => (tour.players.some((p) => norm(p) === norm(r.name)) ? [`${r.name} +${pts[i]}`] : []));
  return `${tour.name}: ${parts.join(', ')}`;
}

/** Элементы поля, которые без стилей страницы рисуются неверно или не нужны на картинке. */
export const PICTURE_DROP = '.cell-hit, .target, .lessoncell, .flash, .trail, .trail-back, .trail-arrow, .trail-from, .trail-no, .land, .fx-gone, .fx-crack, .fx-flash, .fx-cube, .pulse, title';

/** Имя файла картинки: «итог-04.11.2026.2.jpg». */
export const pictureName = (view) => `итог-${String(view.title || view.code).replace(/[^\p{L}\p{N}.-]+/gu, '-')}.jpg`;
