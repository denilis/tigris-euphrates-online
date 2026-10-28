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

/** Перемешанная копия массива. */
export function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
