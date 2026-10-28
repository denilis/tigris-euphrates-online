// Очерёдность хода (решения Дениса 28.10): по умолчанию первым ходит проигравший прошлой
// партии этой же компании, остальные по кругу за столом; иначе случайно или как расставил хост.
import { compareVectors } from './vendor/engine/engine.js';
import { shuffled } from './random.js';

/** Компания = точный набор кодов людей за столом, боты не в счёт. */
export const companyKey = (userIds) => [...userIds].sort().join('|');

/** Места по итоговым векторам (по возрастанию, как finalVector): равные делят место. */
export function placesFromVectors(vectors) {
  return vectors.map((v) => 1 + vectors.filter((w) => compareVectors(w, v) > 0).length);
}

/**
 * Порядок мест за столом для новой партии.
 * seats — места в порядке, как сидят за столом: [{ id, kind, userId }];
 * mode — 'loser' | 'random' | 'custom'; last — запись истории прошлой партии компании или null.
 * Возвращает { order: [id места, ...], first, reason }.
 */
export function playOrder(seats, mode, { last, rng }) {
  const ids = seats.map((s) => s.id);
  if (mode === 'custom') return { order: ids, first: ids[0], reason: 'custom' };
  if (mode === 'random' || !last) {
    const order = shuffled(ids, rng);
    return { order, first: order[0], reason: mode === 'random' ? 'random' : 'no-history' };
  }
  // Проигравший: с худшего места вверх, пока не найдётся тот, кто сидит за новым столом.
  // Человек узнаётся по коду, бот — любое место бота за новым столом.
  const places = [...new Set(last.seats.map((x) => x.place))].sort((a, b) => b - a);
  for (const place of places) {
    const present = [];
    for (const x of last.seats.filter((y) => y.place === place)) {
      if (x.kind === 'human') present.push(...seats.filter((s) => s.kind === 'human' && s.userId === x.userId));
      else present.push(...seats.filter((s) => s.kind === 'bot'));
    }
    const uniq = [...new Map(present.map((s) => [s.id, s])).values()];
    if (!uniq.length) continue;
    const first = uniq.length === 1 ? uniq[0].id : uniq[Math.floor(rng() * uniq.length)].id;
    const k = ids.indexOf(first);
    return { order: [...ids.slice(k), ...ids.slice(0, k)], first, reason: 'loser' };
  }
  const order = shuffled(ids, rng);
  return { order, first: order[0], reason: 'no-history' };
}
