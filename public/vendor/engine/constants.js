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
export const TREASURE_END = 2; // партия кончается, когда на поле осталось столько сокровищ

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

// Геометрия поля заданного размера: { W, H, N, NB }, NB — соседи по стороне для каждой клетки.
// Поле 16x11 (BGA) — размер по умолчанию; большее поле сайта задает размер в раскладке (layout.w, layout.h).
const GEOMS = new Map();
export function geometry(w = W, h = H) {
  const key = w * 100 + h;
  let g = GEOMS.get(key);
  if (!g) {
    const NB = Array.from({ length: w * h }, (_, i) => {
      const x = i % w, y = (i / w) | 0, out = [];
      if (x > 0) out.push(i - 1);
      if (x < w - 1) out.push(i + 1);
      if (y > 0) out.push(i - w);
      if (y < h - 1) out.push(i + w);
      return out;
    });
    GEOMS.set(key, g = { W: w, H: h, N: w * h, NB });
  }
  return g;
}
const G0 = geometry();
/** Геометрия партии: у состояний без размера (все партии до большого поля) — 16x11. */
export const geom = (s) => (s.w ? geometry(s.w, s.h) : G0);
/** Состав коробки тайлов партии и порог конца по сокровищам. */
export const boxOf = (s) => s.tiles || TOTAL_TILES;
export const treasureEndOf = (s) => s.endAt ?? TREASURE_END;
export const NB = G0.NB;

// Координаты в нотации BGA: столбец A..P, ряд 1..11.
export const cellName = (i) => String.fromCharCode(65 + (i % W)) + (((i / W) | 0) + 1);
/** То же для партии s: ширину берет из состояния (большое поле шире 16). */
export const cellNameOn = (s, i) => { const w = (s && s.w) || W; return String.fromCharCode(65 + (i % w)) + (((i / w) | 0) + 1); };
