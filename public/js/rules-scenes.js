// Схемы к правилам: участки поля словами, без DOM. Тесты выкладывают те же участки в движок,
// поэтому схема не может разойтись с настоящими правилами (test/rules-scenes.test.js).
//
// Клетка: . суша, ~ река, r b g k тайлы (ферма сама на реке), r$ храм с сокровищем,
// k# тайл со зданием, x катастрофа, u тайл объединения, f тайл под монументом, w клетка чуда,
// R1 B1 G1 K1 лидер цвета и его хозяин (1 лев, 2 бык).
// После двоеточия отметка: ok можно, no нельзя, new новый тайл, цифра номер для подписи.

const row = (s) => s.split(' ');

export const SCENES = {
  region: { rows: ['r g . r K1 g', 'k . . g . .'] },
  leader: { rows: ['.:no .:ok . . K1 . K2', '.:ok r .:ok . r .:no r', '. ~:no . . . . .'] },
  points: { rows: ['. r:1 . .', 'r R1 k K2', '. . g:2 r'] },
  three: { rows: ['. . K1 . .', '. . r . .', 'G2 r .:no r B2'] },
  catBefore: { rows: ['r:1 K1 g g'] },
  catAfter: { rows: ['x . g g'] },
  revolt: { rows: ['r G1:new k G2 r', '. r . . .'] },
  warBefore: { rows: ['r K1 k k u:new k K2 r', '. . k . . . . .'] },
  warAfter: { rows: ['r K1 k k g . . r', '. . k . . . . .'] },
  monBefore: { rows: ['r K1 g g', '. . g g:new'] },
  monAfter: { rows: ['r K1 f f', '. . f f'], mon: { at: 'C1', c1: 2, c2: 3 } },
  treasure: { rows: ['r$ G1 k:new r$'] },
  building: { rows: ['r K1 k k k#:new'] },
  wonderBefore: { rows: ['. k .', 'k k:new k', '. k .'] },
  wonderAfter: { rows: ['. w .', 'w w w', '. w .'], wonder: 'B2' },
  standard: {
    size: [16, 11],
    river: [4, 5, 6, 7, 8, 12, 20, 28, 35, 36, 44, 45, 48, 49, 50, 51, 61, 62, 63, 78, 79, 94, 96, 97, 98, 99, 108, 109, 110, 115, 116, 117, 118, 124, 134, 135, 136, 137, 138, 139, 140],
    temples: [10, 17, 31, 37, 77, 104, 113, 142, 149, 170],
  },
  advanced: {
    size: [16, 11],
    river: [2, 3, 15, 18, 19, 31, 34, 35, 47, 50, 60, 61, 62, 63, 66, 76, 82, 92, 98, 99, 108, 109, 115, 116, 117, 125, 133, 134, 135, 141, 150, 151, 152, 153, 154, 155, 156, 157, 166],
    temples: [4, 9, 30, 33, 54, 59, 83, 95, 112, 119, 124, 148, 169, 174],
  },
};

/** Рисунок в тексте правил: один участок или несколько со стрелкой «было, стало». */
export const FIGURES = {
  boards: ['standard', 'advanced'],
  region: ['region'],
  leader: ['leader'],
  points: ['points'],
  three: ['three'],
  cat: ['catBefore', 'catAfter'],
  revolt: ['revolt'],
  war: ['warBefore', 'warAfter'],
  monument: ['monBefore', 'monAfter'],
  treasure: ['treasure'],
  building: ['building'],
  wonder: ['wonderBefore', 'wonderAfter'],
};

const LEADER_COLOR = { R: 0, B: 1, G: 2, K: 3 };
const TILE_COLOR = { r: 0, b: 1, g: 2, k: 3 };

function parseCell(word) {
  const [what, mark = null] = word.split(':');
  const cell = { mark, tile: null, leader: null, treasure: false, building: false, river: false, cat: false, unite: false, flipped: false, wonder: false };
  const ch = what[0];
  if (ch === '~') cell.river = true;
  else if (ch === 'x') cell.cat = true;
  else if (ch === 'u') cell.unite = true;
  else if (ch === 'f') cell.flipped = true;
  else if (ch === 'w') cell.wonder = true;
  else if (ch in LEADER_COLOR) cell.leader = { c: LEADER_COLOR[ch], owner: Number(what[1]) };
  else if (ch in TILE_COLOR) {
    cell.tile = TILE_COLOR[ch];
    cell.river = ch === 'b';
    cell.treasure = what[1] === '$';
    cell.building = what[1] === '#';
  }
  return cell;
}

/** Клетки участка: { w, h, cells[y][x] }. */
export function parseScene(scene) {
  if (scene.size) {
    const [w, h] = scene.size;
    const cells = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => {
      const i = y * w + x;
      return parseCell(scene.river.includes(i) ? '~' : scene.temples.includes(i) ? 'r$' : '.');
    }));
    return { w, h, cells };
  }
  const cells = scene.rows.map((r) => row(r).map(parseCell));
  return { w: cells[0].length, h: cells.length, cells };
}

/** Клетка по имени, как на поле: C1 это столбец C, строка 1. */
export const cellAt = (name) => ({ x: name.charCodeAt(0) - 65, y: Number(name.slice(1)) - 1 });
