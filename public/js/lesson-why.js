// Почему в уроке нельзя сходить на эту клетку: те же условия, что в движке, словами для новичка.
// Совпадение с движком проверяет test/lessons.test.js на всех клетках всех шагов.
import { nb, kingdomLeaders, FACEDOWN, WONDER, CATASTROPHE } from './util.js';

const RED = 0, BLUE = 1;

const kingdomsAround = (board, i) => {
  const { lab, lead } = kingdomLeaders(board);
  return new Set(nb(i).filter((j) => lab[j] >= 0 && lead.has(lab[j])).map((j) => lab[j])).size;
};

function tileReason(g, color, i) {
  const b = g.board;
  if (b.tile[i] === CATASTROPHE) return 'Здесь лежит катастрофа, клетка закрыта до конца партии.';
  if (b.tile[i] >= 0 || b.leader[i] >= 0) return 'Клетка занята.';
  const river = g.river.includes(i);
  if (color === BLUE && !river) return 'Ферма кладется только на реку.';
  if (color !== BLUE && river) return 'На реку кладется только ферма.';
  if (kingdomsAround(b, i) > 2) return 'Тайл нельзя класть рядом сразу с тремя царствами.';
  return null;
}

function leaderReason(view, color, i) {
  const g = view.game, b = g.board;
  const from = g.players[g.order.indexOf(view.me)].leaders[color];
  if (i === from) return 'Этот лидер уже стоит здесь.';
  if (g.river.includes(i)) return 'Лидер стоит только на суше.';
  if (b.tile[i] === CATASTROPHE) return 'Здесь лежит катастрофа, клетка закрыта до конца партии.';
  if (b.tile[i] >= 0 || b.leader[i] >= 0) return 'Клетка занята.';
  if (!nb(i).some((j) => b.tile[j] === RED)) return 'Лидер ставится только рядом с храмом.';
  const leader = from >= 0 ? b.leader.map((v, j) => (j === from ? -1 : v)) : b.leader; // переставляемый лидер не считается
  if (kingdomsAround({ ...b, leader }, i) > 1) return 'Лидером нельзя соединить два царства.';
  return null;
}

function catastropheReason(b, i) {
  if (b.leader[i] >= 0) return 'Катастрофу нельзя положить на лидера.';
  if (b.tile[i] === FACEDOWN) return 'Катастрофу нельзя положить на монумент.';
  if (b.tile[i] === WONDER) return 'Катастрофу нельзя положить на чудо.';
  if (b.tile[i] === CATASTROPHE) return 'Здесь уже лежит катастрофа.';
  if (b.treasure[i]) return 'Катастрофу нельзя положить на тайл с сокровищем.';
  if (b.building[i] >= 0) return 'Катастрофу нельзя положить на тайл под зданием.';
  return null;
}

/** Почему выбранное sel нельзя поставить на клетку i, null: можно. sel: { kind, color } или null. */
export function whyNot(view, sel, i) {
  if (sel?.kind === 'tile') return tileReason(view.game, sel.color, i);
  if (sel?.kind === 'leader') return leaderReason(view, sel.color, i);
  if (sel?.kind === 'cat') return catastropheReason(view.game.board, i);
  return 'Сначала выберите внизу то, что подсвечено, потом нажмите клетку.';
}
