// Повтор записанной партии (04.11): из зерна и списка ходов (t.game.rec) движок заново проходит
// партию и дает состояние перед каждым ходом и после него. Нужно для просмотра по ходам и для
// разбора ботом. У партий, начатых до 04.11, записи нет.
import { createGame, applyMove } from './vendor/engine/engine.js';
import { BOARDS } from './vendor/engine/boards.js';
import { seededRng } from './random.js';

/**
 * Пройти запись. onStep(s, move, i, before) вызывается после каждого хода; s — живое состояние
 * движка (копировать самому, если нужно сохранить), before — { turn, cur, actionNo, phase, toMove }
 * до хода. onStart(s) — один раз до первого хода. Возвращает итоговое состояние.
 */
export function replay(rec, onStep = null, onStart = null) {
  if (!rec || rec.v !== 1) throw new Error('no-record');
  const rng = seededRng({ rng: rec.seed });
  const s = createGame({ layout: BOARDS[rec.board], numPlayers: rec.np, cfg: rec.cfg }, rng);
  onStart?.(s);
  rec.moves.forEach((m, i) => {
    const before = { turn: s.turn, cur: s.cur, actionNo: s.actionNo, phase: s.phase, toMove: s.toMove };
    s.log = [];
    applyMove(s, m, rng);
    onStep?.(s, m, i, before);
  });
  return s;
}
