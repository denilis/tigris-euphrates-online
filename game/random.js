// Случайность для добора тайлов на сервере. Функции Vercel не хранят память между
// вызовами, поэтому генератор с состоянием не годится: берём криптостойкий источник,
// хранить и повторять нечего.
export function cryptoRng() {
  const buf = new Uint32Array(1);
  return () => {
    globalThis.crypto.getRandomValues(buf);
    return buf[0] / 4294967296;
  };
}

/**
 * Генератор для записи партии (04.11, просмотр по ходам и разбор ботом): состояние — одно число
 * holder.rng, оно хранится в столе и переживает вызовы функций Vercel. Зерно берется из
 * криптостойкого источника, поэтому добор по-прежнему не угадать, а повторить партию по записи
 * можно. Алгоритм mulberry32.
 */
export function seededRng(holder) {
  return () => {
    const a = (holder.rng = (holder.rng + 0x6d2b79f5) >>> 0);
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Новое зерно из любого генератора: целое от 0 до 2^32 - 1. */
export const newSeed = (rng) => Math.floor(rng() * 4294967296) >>> 0;

/** Перемешанная копия массива. */
export function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
