// QR-код ссылки-приглашения (Денис 13.11). Свой генератор, без сторонних библиотек и запросов наружу:
// ссылка с токеном не покидает браузер. Байтовый режим, уровень коррекции M, версии 1-10 (до 213 байт,
// ссылка занимает около 72). Без браузерных зависимостей; сверка с эталоном в test/qr.test.js.

/** Самый длинный текст в байтах UTF-8. */
export const QR_MAX_BYTES = 213;

// уровень M: [проверочных слов в блоке, [[блоков, слов данных в блоке], ...]]
const BLOCKS = [null,
  [10, [[1, 16]]], [16, [[1, 28]]], [26, [[1, 44]]], [18, [[2, 32]]], [24, [[2, 43]]],
  [16, [[4, 27]]], [18, [[4, 31]]], [22, [[2, 38], [2, 39]]], [22, [[3, 36], [2, 37]]], [26, [[4, 43], [1, 44]]],
];
// центры выравнивающих узоров
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

const dataWords = (v) => BLOCKS[v][1].reduce((n, [k, len]) => n + k * len, 0);
const countBits = (v) => (v < 10 ? 8 : 16);

// поле Галуа GF(256), многочлен x^8 + x^4 + x^3 + x^2 + 1
const EXP = new Uint8Array(510), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = EXP[i + 255] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** Проверочные слова Рида-Соломона: остаток от деления данных на порождающий многочлен степени n. */
function ecWords(data, n) {
  let gen = [1]; // коэффициенты от старшей степени
  for (let i = 0; i < n; i++) {
    const next = new Array(gen.length + 1).fill(0);
    gen.forEach((g, j) => {
      next[j] ^= g;
      next[j + 1] ^= mul(g, EXP[i]);
    });
    gen = next;
  }
  const rem = new Array(n).fill(0);
  for (const d of data) {
    const f = d ^ rem.shift();
    rem.push(0);
    for (let i = 0; i < n; i++) rem[i] ^= mul(gen[i + 1], f);
  }
  return rem;
}

/** Слова данных: режим, длина, байты, завершение и заполнители до емкости версии. */
function dataOf(bytes, version) {
  const bits = [];
  const put = (value, n) => { for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, countBits(version));
  for (const b of bytes) put(b, 8);
  const cap = dataWords(version) * 8;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const words = [];
  for (let i = 0; i < bits.length; i += 8) words.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return words;
}

/** Данные и проверочные слова по блокам, вперемешку по столбцам, как их кладут в код. */
function codewords(bytes, version) {
  const [ecLen, groups] = BLOCKS[version];
  const data = dataOf(bytes, version);
  const blocks = [];
  let at = 0;
  for (const [count, len] of groups) {
    for (let i = 0; i < count; i++) {
      const d = data.slice(at, at + len);
      at += len;
      blocks.push({ d, e: ecWords(d, ecLen) });
    }
  }
  const out = [];
  const longest = Math.max(...blocks.map((b) => b.d.length));
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ecLen; i++) for (const b of blocks) out.push(b.e[i]);
  return out;
}

// условия масок: x столбец, y строка
const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Поле без данных: служебные узоры расставлены, fn помечает занятые ими модули. */
function frame(version) {
  const size = 17 + 4 * version;
  const m = Array.from({ length: size }, () => new Uint8Array(size));
  const fn = Array.from({ length: size }, () => new Uint8Array(size));
  const set = (x, y, dark) => {
    m[y][x] = dark ? 1 : 0;
    fn[y][x] = 1;
  };
  // поисковые узоры с белой каймой
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  // выравнивающие узоры, кроме трех углов с поисковыми
  const pos = ALIGN[version], last = pos.length - 1;
  pos.forEach((cy, i) => pos.forEach((cx, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  // линии синхронизации
  for (let i = 8; i < size - 8; i++) {
    if (!fn[6][i]) set(i, 6, i % 2 === 0);
    if (!fn[i][6]) set(6, i, i % 2 === 0);
  }
  // место под сведения о формате и версии занято, но пусто: их пишет info() после выбора маски
  info((x, y) => set(x, y, 0), size, version, 0);
  return { size, m, fn };
}

/**
 * Сведения о формате (уровень M и номер маски) в двух копиях, всегда темный модуль и, с седьмой
 * версии, сведения о версии. set(x, y, dark): x столбец, y строка.
 */
function info(set, size, version, mask) {
  let rem = mask; // у уровня M старшие биты 00
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((mask << 10) | rem) ^ 0x5412;
  const bit = (i) => (bits >>> i) & 1;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, 1);
  if (version < 7) return;
  let r = version;
  for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
  const vbits = (version << 12) | r;
  for (let i = 0; i < 18; i++) {
    const dark = (vbits >>> i) & 1, a = size - 11 + (i % 3), b = Math.floor(i / 3);
    set(a, b, dark);
    set(b, a, dark);
  }
}

/** Разложить слова по свободным модулям: змейкой парами столбцов справа налево, мимо шестого столбца. */
function place({ size, m, fn }, words) {
  let i = 0;
  const total = words.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const up = ((right + 1) & 2) === 0;
    for (let k = 0; k < size; k++) {
      const y = up ? size - 1 - k : k;
      for (const x of [right, right - 1]) {
        if (fn[y][x]) continue;
        if (i < total) m[y][x] = (words[i >>> 3] >>> (7 - (i & 7))) & 1;
        i++;
      }
    }
  }
}

const FINDER = [1, 0, 1, 1, 1, 0, 1];
const finderAt = (seq, from) => {
  for (let i = from; i + 7 <= seq.length; i++) if (FINDER.every((v, k) => seq[i + k] === v)) return i;
  return -1;
};

/**
 * Штраф узора по четырем правилам стандарта (7.8.3): чем меньше, тем легче код читается. Считается
 * до записи сведений о формате и версии, их место светлое. Третье правило: узор 1:1:3:1:1, у которого
 * с одной из сторон четыре светлых модуля или край кода.
 */
function penalty(m, size) {
  let score = 0, dark = 0;
  const line = (seq) => {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && seq[i] === seq[i - 1]) { run++; continue; }
      if (run >= 5) score += run - 2;
      run = 1;
    }
    for (let at = finderAt(seq, 0); at !== -1;) {
      const end = at + 7;
      const light = (from, to) => { for (let i = Math.max(from, 0); i < Math.min(to, size); i++) if (seq[i]) return false; return true; };
      const hit = at === 0 || at === size - 7 || light(at - 4, at) || light(end, end + 4);
      if (hit) score += 40;
      at = finderAt(seq, hit ? end : at + 4);
    }
  };
  const col = new Uint8Array(size);
  for (let y = 0; y < size; y++) {
    line(m[y]);
    for (let x = 0; x < size; x++) {
      dark += m[y][x];
      if (x + 1 < size && y + 1 < size && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
    }
  }
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) col[y] = m[y][x];
    line(col);
  }
  return score + 10 * Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5);
}

/**
 * Матрица QR-кода: { version, mask, size, modules }, modules[строка][столбец] = 1 у темного модуля.
 * mask: номер маски 0-7 или null, тогда берется маска с наименьшим штрафом.
 */
export function qrMatrix(text, { mask = null } = {}) {
  const bytes = new TextEncoder().encode(String(text));
  if (!bytes.length || bytes.length > QR_MAX_BYTES) throw new RangeError(`QR: текст от 1 до ${QR_MAX_BYTES} байт`);
  if (mask !== null && !(Number.isInteger(mask) && mask >= 0 && mask <= 7)) throw new RangeError('QR: маска от 0 до 7');
  let version = 1;
  while (4 + countBits(version) + bytes.length * 8 > dataWords(version) * 8) version++;
  const base = frame(version);
  place(base, codewords(bytes, version));
  const { size, fn } = base;
  const masked = (k) => {
    const m = base.m.map((row) => row.slice());
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[k](x, y)) m[y][x] ^= 1;
    return m;
  };
  let k = mask, m = mask === null ? null : masked(mask);
  if (mask === null) {
    let best = Infinity;
    for (let i = 0; i < 8; i++) {
      const cand = masked(i), p = penalty(cand, size);
      if (p < best) { best = p; k = i; m = cand; }
    }
  }
  info((x, y, dark) => { m[y][x] = dark ? 1 : 0; }, size, version, k);
  return { version, mask: k, size, modules: m };
}

/** Картинка SVG: черным по белому, поля margin модулей (стандарт просит 4). Темные модули строками. */
export function qrSvg(text, { margin = 4 } = {}) {
  const { size, modules } = qrMatrix(text);
  const side = size + 2 * margin;
  let d = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!modules[y][x]) continue;
      let len = 1;
      while (x + len < size && modules[y][x + len]) len++;
      d += `M${x + margin} ${y + margin}h${len}v1h-${len}z`;
      x += len;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges" role="img" aria-label="QR-код ссылки"><rect width="100%" height="100%" fill="#fff"/><path fill="#000" d="${d}"/></svg>`;
}
