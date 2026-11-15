// «Что бы сделал бот?» (15.11, дорожная карта п.11): ход словами и метки на поле. Без браузера,
// проверяет test/hint.test.js.
import { TILE, LEADER, COLNAME, cellName } from './util.js';

/** Ход словами: «храм на E2», «царь на B3», «сбросить 3 тайла». */
export function hintText(m) {
  if (!m) return '';
  const n = (m.counts || []).reduce((a, b) => a + b, 0);
  switch (m.type) {
    case 'tile': return `${TILE[m.color]} на ${cellName(m.pos)}`;
    case 'leader': return `${LEADER[m.color]} на ${cellName(m.pos)}`;
    case 'withdraw': return `${LEADER[m.color]} в руку`;
    case 'catastrophe': return `катастрофа на ${cellName(m.pos)}`;
    case 'discard': return `сбросить ${n} ${n % 10 === 1 && n % 100 !== 11 ? 'тайл' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'тайла' : 'тайлов'}`;
    case 'pass': return 'пас';
    case 'support': return m.n ? `добавить ${m.n}` : 'не добавлять';
    case 'warChoose': return `сначала война за ${COLNAME[m.color]} цвет`;
    case 'build': return `здание на ${cellName(m.pos)}`;
    case 'monument': return `монумент на ${cellName(m.tl)}`;
    case 'wonder': return `чудо с центром ${cellName(m.center)}`;
    case 'treasure': return `сокровище с ${cellName(m.pos)}`;
    case 'wonderPoint': return `очко за чудо: ${COLNAME[m.color]}`;
    default: return m.type;
  }
}

/** Клетки для рамок на поле: номер хода в подсказке (1, 2), ходы без клетки пропускаются. */
export function hintMarks(moves) {
  const out = [];
  moves.forEach((m, k) => {
    const pos = m.pos ?? m.tl ?? m.center;
    if (pos != null) out.push({ pos, n: k + 1 });
  });
  return out;
}
