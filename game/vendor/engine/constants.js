// Базовые константы движка «Тигр и Евфрат».

export const W = 16;
export const H = 11;
export const N = W * H;

// Цвета тайлов и лидеров.
export const RED = 0; // храм / жрец
export const BLUE = 1; // ферма / фермер
export const GREEN = 2; // рынок / торговец
export const BLACK = 3; // поселение / царь
export const COLORS = ['red', 'blue', 'green', 'black'];

// Содержимое клетки в state.tile.
export const EMPTY = -1;
export const FACEDOWN = 4; // перевёрнутый тайл под монументом
export const WONDER = 5; // клетка под чудом
export const CATASTROPHE = 6;

// Полный набор тайлов в коробке (стартовые храмы берутся из красных).
export const TOTAL_TILES = [57, 36, 30, 30];
export const HAND_SIZE = 6;
export const CATASTROPHES_PER_PLAYER = 2;

// Монументы стандартного набора: id совпадают с BGA только условно,
// адаптер BGA передаёт свой список.
export const DEFAULT_MONUMENTS = [
  { id: 0, c1: RED, c2: BLUE },
  { id: 1, c1: RED, c2: GREEN },
  { id: 2, c1: RED, c2: BLACK },
  { id: 3, c1: BLUE, c2: GREEN },
  { id: 4, c1: BLUE, c2: BLACK },
  { id: 5, c1: GREEN, c2: BLACK },
];

export const idx = (x, y) => y * W + x;
export const xOf = (i) => i % W;
export const yOf = (i) => (i / W) | 0;

// Соседи по стороне для каждой клетки.
export const NB = Array.from({ length: N }, (_, i) => {
  const x = xOf(i), y = yOf(i), out = [];
  if (x > 0) out.push(i - 1);
  if (x < W - 1) out.push(i + 1);
  if (y > 0) out.push(i - W);
  if (y < H - 1) out.push(i + W);
  return out;
});

// Координаты в нотации BGA: столбец A..P, ряд 1..11.
export const cellName = (i) => String.fromCharCode(65 + xOf(i)) + (yOf(i) + 1);
