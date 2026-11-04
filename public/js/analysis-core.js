// Разбор партии ботом (этап 5 пакета 04.11, схема одобрена Денисом). Работает в фоне браузера
// (analysis-worker.js) и в тестах. По записи партии движок проходит ее заново; на каждом действии
// человека бот оценивает все разумные ходы так же, как оценивает свои на первом шаге поиска:
// позиция глазами игрока (чужие руки и мешок неизвестны, перебираются несколько раскладов),
// ход, бои доигрываются, оценка позиции. Потеря хода — насколько сыгранный ход оценен ниже
// лучшего. Ход с потерей меньше 0,5 считается точным.
import { createGame, applyMove, cloneState } from '../vendor/engine/engine.js';
import { BOARDS } from '../vendor/engine/boards.js';
import { makeView, determinize } from '../vendor/bot/belief.js';
import { candidateActions } from '../vendor/bot/bot.js';
import { evaluate } from '../vendor/bot/evaluate.js';
import { settle } from '../vendor/bot/policy.js';
import { COLNAME, LEADER, cellName } from './util.js';

export const ANALYSIS_VERSION = 1;
export const DETS = 6; // раскладов чужих рук и мешка на одно решение
export const LOSS_CAP = 20; // в конце партии оценка меряет место (сотни): потерю показываем не больше этого
export const EXACT = 0.5; // потеря меньше этого: ход точный
export const MISTAKES = 5; // сколько ошибок показывать у игрока

/** Генератор записи партии, как game/random.js seededRng (mulberry32): тест сверяет их. */
export function seededRng(holder) {
  return () => {
    const a = (holder.rng = (holder.rng + 0x6d2b79f5) >>> 0);
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const canon = (m) => JSON.stringify(m, Object.keys(m).sort());

/** Ход словами: «красный тайл на G5», «черный лидер с C3 на H6», «катастрофа на D4». */
export function moveText(m) {
  if (!m) return '';
  if (m.type === 'tile') return `${COLNAME[m.color]} тайл на ${cellName(m.pos)}`;
  if (m.type === 'leader') return m.from >= 0 ? `${LEADER[m.color]} с ${cellName(m.from)} на ${cellName(m.pos)}` : `${LEADER[m.color]} на ${cellName(m.pos)}`;
  if (m.type === 'catastrophe') return `катастрофа на ${cellName(m.pos)}`;
  if (m.type === 'withdraw') return `${LEADER[m.color]} уходит с поля`;
  if (m.type === 'discard') {
    const n = (m.counts || []).reduce((a, b) => a + b, 0);
    return `сброс ${n} ${n === 1 ? 'тайла' : 'тайлов'}`;
  }
  if (m.type === 'pass') return 'пас';
  return m.type;
}

/** Ценность хода m для игрока p: среднее по раскладам после хода и доигранных боев. */
function valueOf(dets, m, p, rng) {
  let sum = 0, n = 0;
  for (const d of dets) {
    const x = cloneState(d);
    try {
      applyMove(x, m, rng);
      settle(x, rng);
      sum += evaluate(x, p);
      n++;
    } catch {
      // в этом раскладе ход невозможен: пропускаем расклад
    }
  }
  return n ? sum / n : -Infinity;
}

/** Одно решение: лучший ход по оценке бота и потеря сыгранного. */
export function judge(s, p, played, seed, dets = DETS) {
  const rng = seededRng({ rng: seed >>> 0 });
  const view = makeView(s, p, 'exact', rng);
  const ds = Array.from({ length: dets }, () => determinize(view, rng));
  const cands = candidateActions(s);
  const key = canon(played);
  if (!cands.some((m) => canon(m) === key)) cands.push(played);
  let best = null, vBest = -Infinity, vPlayed = -Infinity;
  for (const m of cands) {
    const v = valueOf(ds, m, p, rng);
    if (canon(m) === key) vPlayed = v;
    if (v > vBest) { vBest = v; best = m; }
  }
  const loss = Number.isFinite(vPlayed) && Number.isFinite(vBest) ? Math.min(LOSS_CAP, Math.max(0, vBest - vPlayed)) : 0;
  return { best, loss: Math.round(loss * 10) / 10, candidates: cands.length };
}

/**
 * Разбор записанной партии. rec — t.game.rec, order — места по игрокам движка, humans — места
 * людей. onProgress(done, total) — для полосы прогресса. Возвращает
 * { v, players: { [место]: { actions, exact, accuracy, mistakes: [{ k, turn, action, played, best, loss }] } } };
 * k — номер кадра просмотра (действие партии, с 1), там виден сыгранный ход.
 */
export function analyzeRecord(rec, order, humans, { dets = DETS, onProgress = null } = {}) {
  const rng = seededRng({ rng: rec.seed });
  const s = createGame({ layout: BOARDS[rec.board], numPlayers: rec.np, cfg: rec.cfg }, rng);
  const want = new Set(humans);
  const total = rec.moves.length;
  const out = Object.fromEntries(humans.map((id) => [id, { actions: 0, exact: 0, all: [] }]));
  let k = 0;
  rec.moves.forEach((m, i) => {
    if (s.phase === 'action') {
      k++;
      const seat = order[s.toMove];
      if (want.has(seat) && s.toMove === s.cur) {
        const r = judge(s, s.toMove, m, rec.seed ^ (i * 2654435761), dets);
        const o = out[seat];
        o.actions++;
        if (r.loss < EXACT) o.exact++;
        else o.all.push({ k, turn: s.turn, action: s.actionNo, played: moveText(m), best: moveText(r.best), bestMove: r.best, loss: r.loss });
      }
    }
    s.log = [];
    applyMove(s, m, rng);
    onProgress?.(i + 1, total);
  });
  const players = {};
  for (const [id, o] of Object.entries(out)) {
    players[id] = {
      actions: o.actions, exact: o.exact,
      accuracy: o.actions ? Math.round((100 * o.exact) / o.actions) : null,
      mistakes: o.all.sort((a, b) => b.loss - a.loss).slice(0, MISTAKES),
    };
  }
  return { v: ANALYSIS_VERSION, players };
}
