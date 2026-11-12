// Поиск по дереву ходов с неполной информацией (ISMCTS, max^n).
//
// Каждый проход дерева берёт новую достройку скрытого (чужие руки и мешок по
// представлениям бота) и спускается по дереву действий: свои два действия,
// затем действия соперников, всего до P.mctsH действий. Узел — последовательность
// ходов; ход, невозможный в этой достройке (у соперника нет такого тайла),
// пропускается, а частота доступности хода идёт в формулу выбора (UCB с
// «доступностью», как в ISMCTS).
//
// Новый узел раскрывается сразу целиком: все кандидаты ходящего оцениваются на
// один ход вперёд (это порядок перебора), а лучший из них даёт оценку узла —
// так лист дерева видит ещё один жадный ход. Каждый игрок в дереве выбирает
// лучшее для себя по своей оценке позиции (вектор наград, max^n).
//
// Ширина узла растёт с числом проходов: сначала лучшие по одному ходу,
// остальные подключаются постепенно (progressive widening).

import { legalMoves, applyMove, cloneState } from '../engine/engine.js';
import { determinize } from './belief.js';
import { positionRecord, recordValue, recordOpts } from './evaluate.js';
import { settle } from './policy.js';

const keyOf = (m) => `${m.type}:${m.pos ?? ''}:${m.color ?? ''}:${m.counts ? m.counts.join('') : ''}`;

/**
 * Перебор. cands — кандидаты корня (уже отобранные правилами), moveCost(s, m) —
 * цена своего хода, playable(s) — свои кандидаты в глубине дерева,
 * oppCands(s) — кандидаты соперников.
 * Возвращает кандидатов корня по числу проходов: [{ m, n, v, second }].
 */
export function* mctsSearch(view, P, rng, { cands, oppCands, moveCost, playable, pause, overBudget }) {
  const me = view.me;
  const W = P.weights;
  const H = P.mctsH;
  const C = P.mctsC;
  const np = view.state.np;

  /** Раскрыть узел: кандидаты ходящего p по оценке на один ход вперёд. */
  function expand(node, s, p, list) {
    const out = [];
    let best = null;
    for (const m of list) {
      const x = cloneState(s);
      try {
        applyMove(x, m, rng);
        settle(x, rng);
      } catch (e) {
        continue;
      }
      const rec = positionRecord(x, recordOpts(P.weights));
      const cost = p === me ? moveCost(s, m) : 0;
      const prior = recordValue(rec, p, W) - cost;
      const e = { m, key: keyOf(m), prior, cost, n: 0, w: 0, avail: 0, node: null };
      out.push(e);
      if (!best || prior > best.e.prior) best = { e, rec };
    }
    out.sort((a, b) => b.prior - a.prior);
    node.list = out;
    node.byKey = new Map(out.map((e) => [e.key, e]));
    if (!best) return null;
    const vals = new Array(np);
    for (let q = 0; q < np; q++) vals[q] = recordValue(best.rec, q, W);
    return { vals, cost: best.e.cost };
  }

  const leafVals = (s) => {
    const rec = positionRecord(s, recordOpts(P.weights));
    const vals = new Array(np);
    for (let q = 0; q < np; q++) vals[q] = recordValue(rec, q, W);
    return vals;
  };

  const widen = (node, root) => (root ? 4 + Math.floor(2 * Math.sqrt(node.n)) : 1 + Math.floor(P.mctsW * Math.sqrt(node.n)));

  const root = { n: 0, list: null };
  // корень раскрывается по первой достройке
  expand(root, determinize(view, rng), me, cands);
  if (!root.list.length) return [];

  let iters = 0;
  while (iters < P.mctsIters && !(iters > 0 && overBudget())) {
    iters++;
    const s = determinize(view, rng);
    let node = root;
    let depth = 0;
    let myCost = 0;
    const path = []; // [{ e, p }]
    const nodes = [root];
    let vals = null;
    for (;;) {
      if (s.over || depth >= H) {
        vals = leafVals(s);
        break;
      }
      const p = s.cur;
      if (!node.list) {
        const r = expand(node, s, p, p === me ? playable(s) : oppCands(s));
        if (!r) { vals = leafVals(s); break; }
        vals = r.vals;
        if (p === me) myCost += r.cost;
        break;
      }
      // ходы узла, возможные в этой достройке
      const legal = new Set(legalMoves(s).map(keyOf));
      const allowed = Math.min(node.list.length, widen(node, node === root));
      let pick = null;
      let unvisited = null;
      let any = false;
      for (let i = 0; i < node.list.length && (i < allowed || !any); i++) {
        const e = node.list[i];
        if (!legal.has(e.key)) continue;
        any = true;
        e.avail++;
        if (e.n === 0) { if (!unvisited) unvisited = e; continue; }
        const u = e.w / e.n + C * Math.sqrt(Math.log(e.avail) / e.n);
        if (!pick || u > pick.u) pick = { e, u };
      }
      const e = unvisited || (pick && pick.e);
      if (!e) {
        // в этой достройке у ходящего нет ни одного хода из узла: жадный ход вне дерева
        const tmp = { list: null };
        const r = expand(tmp, s, p, p === me ? playable(s) : oppCands(s));
        vals = r ? r.vals : leafVals(s);
        if (r && p === me) myCost += r.cost;
        break;
      }
      applyMove(s, e.m, rng);
      settle(s, rng);
      if (p === me) myCost += e.cost;
      path.push({ e, p });
      if (!e.node) e.node = { n: 0, list: null };
      node = e.node;
      nodes.push(node);
      depth++;
    }
    for (const x of nodes) x.n++;
    for (const { e, p } of path) {
      e.n++;
      e.w += vals[p] - (p === me ? myCost : 0);
    }
    yield* pause();
  }

  const ranked = root.list
    .filter((e) => e.n > 0)
    .sort((a, b) => b.n - a.n || b.w / b.n - a.w / a.n)
    .map((e) => {
      let second = null;
      if (e.node && e.node.list) {
        const mine = e.node.list.filter((k) => k.n > 0).sort((a, b) => b.n - a.n);
        // второе действие — только если в этом узле хожу я (первое действие хода)
        if (mine.length && view.state.actionNo === 1 && e.m.type !== 'pass') second = mine[0].m;
      }
      return { m: e.m, n: e.n, v: e.w / e.n, second, prior: e.prior };
    });
  ranked.iters = iters;
  return ranked;
}
