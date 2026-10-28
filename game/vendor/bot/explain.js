// Человеческие описания ходов для журнала решений бота.
import { cellName } from '../engine/constants.js';

export const TILE_NAME = ['храм', 'ферму', 'рынок', 'поселение'];
export const LEADER_NAME = ['жреца', 'фермера', 'торговца', 'царя'];
export const COLOR_NAME = ['красное', 'синее', 'зелёное', 'чёрное'];
export const COLOR_ADJ = ['красной', 'синей', 'зелёной', 'чёрной'];

export function describeMove(m, s) {
  switch (m.type) {
    case 'tile':
      return `ставлю ${TILE_NAME[m.color]} на ${cellName(m.pos)}`;
    case 'leader': {
      const from = s ? s.players[s.toMove].leaders[m.color] : -1;
      return from >= 0
        ? `переставляю ${LEADER_NAME[m.color]} с ${cellName(from)} на ${cellName(m.pos)}`
        : `ставлю ${LEADER_NAME[m.color]} на ${cellName(m.pos)}`;
    }
    case 'withdraw':
      return `убираю ${LEADER_NAME[m.color]} с поля`;
    case 'catastrophe':
      return `катастрофа на ${cellName(m.pos)}`;
    case 'discard':
      return `сбрасываю ${m.counts.reduce((a, b) => a + b, 0)} тайл.`;
    case 'pass':
      return 'пас';
    case 'support':
      return m.n ? `поддержка: ${m.n} тайл.` : 'без поддержки';
    case 'warColor':
      return `сначала война ${COLOR_ADJ[m.color]} масти`;
    case 'build':
      return `здание на ${cellName(m.pos)}`;
    case 'monument':
      return `монумент на ${cellName(m.tl)}`;
    case 'wonder':
      return `чудо с центром ${cellName(m.center)}`;
    case 'treasure':
      return `беру сокровище с ${cellName(m.pos)}`;
    case 'wonderPoint':
      return `очко от чуда: ${COLOR_NAME[m.color]}`;
    default:
      return JSON.stringify(m);
  }
}
