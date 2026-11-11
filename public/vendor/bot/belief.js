// Что бот знает о партии и как он достраивает скрытое.
//
// view — позиция глазами бота: доска, своя рука, число тайлов у соперников,
// размер мешка и оценка чужого счёта. Чужих рук и состава мешка в view нет.
// determinize() достраивает их случайно, но правдоподобно, в зависимости от
// режима подсчёта тайлов:
//   none   — «не считает»: состав мешка как в начале игры;
//   approx — «на глаз»: учитывает видимое на доске, но с погрешностью;
//   exact  — «точно»: полный учёт вышедших тайлов.

import { cloneState } from '../engine/engine.js';
import { geom, boxOf } from '../engine/constants.js';

const handTotal = (h) => h[0] + h[1] + h[2] + h[3];

/** Сколько тайлов каждого цвета видно на доске (включая перевёрнутые под монументами). */
export function visibleOnBoard(s) {
  const { N } = geom(s);
  const v = [0, 0, 0, 0];
  for (let i = 0; i < N; i++) {
    const t = s.tile[i];
    if (t >= 0 && t <= 3) v[t]++;
  }
  for (const m of s.monuments) if (m.pos >= 0 && m.color >= 0) v[m.color] += 4;
  return v;
}

/** Тайлы, которые все видели уходящими из игры (поддержка, война, катастрофы, чудо). */
export function publicRemoved(s) {
  const r = s.removed.slice();
  for (const pl of s.players) for (let c = 0; c < 4; c++) r[c] -= pl.discarded[c];
  return r;
}

/**
 * View из полной позиции (для игры ботов между собой без подглядывания).
 * В адаптере BGA view собирается прямо из данных страницы.
 */
export function makeView(s, me, counting = 'none', rng = Math.random) {
  const st = cloneState(s);
  const handCounts = s.players.map((pl) => handTotal(pl.hand));
  const bagTotal = handTotal(s.bag);
  for (let q = 0; q < s.np; q++) {
    if (q === me) continue;
    st.players[q].hand = [0, 0, 0, 0];
    st.players[q].discarded = [0, 0, 0, 0];
    st.players[q].score = estimateScore(s, q, me, counting, rng);
    // число сокровищ видно всем
  }
  st.bag = [0, 0, 0, 0];
  // чужие сбросы видны только количеством
  const oppDiscards = s.players.reduce((a, pl, q) => a + (q === me ? 0 : handTotal(pl.discarded)), 0);
  return {
    me,
    counting,
    state: st,
    handCounts,
    bagTotal,
    oppDiscards,
    publicRemoved: publicRemoved(s),
  };
}

function estimateScore(s, q, me, counting, rng) {
  const real = s.players[q].score;
  if (counting === 'exact') return real.slice();
  if (counting === 'approx') return real.map((v) => Math.max(0, Math.round(v * (0.8 + 0.4 * rng()))));
  // не считает: представляет соперника примерно равным себе
  return s.players[me].score.slice();
}

/** Ожидаемый состав неизвестных тайлов (чужие руки + мешок [+ чужие сбросы]). */
export function unknownPool(view, rng = Math.random) {
  const s = view.state;
  const mine = s.players[view.me];
  if (view.counting === 'none') {
    const start = boxOf(s).slice();
    start[0] -= s.startTemples;
    return { weights: start, exact: false };
  }
  const board = visibleOnBoard(s);
  const pool = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    let seen = board[c] + mine.hand[c];
    if (view.counting === 'exact') seen += view.publicRemoved[c] + mine.discarded[c];
    pool[c] = Math.max(0, boxOf(s)[c] - seen);
  }
  if (view.counting === 'approx') {
    // «на глаз»: видит доску, но не помнит ушедшее из игры и ошибается в счёте
    for (let c = 0; c < 4; c++) pool[c] = Math.max(1, pool[c] * (0.85 + 0.3 * rng()));
    return { weights: pool, exact: false };
  }
  return { weights: pool, exact: true };
}

function drawColor(w, rng) {
  const total = w[0] + w[1] + w[2] + w[3];
  if (total <= 0) return Math.floor(rng() * 4);
  let r = rng() * total;
  for (let c = 0; c < 3; c++) {
    if (r < w[c]) return c;
    r -= w[c];
  }
  return 3;
}

/** Полная правдоподобная позиция: чужие руки и мешок достроены случайно. */
export function determinize(view, rng) {
  const s = cloneState(view.state);
  const { weights, exact } = unknownPool(view, rng);
  const w = weights.slice();
  const take = () => {
    const c = drawColor(w, rng);
    // без возврата: точный подсчёт уменьшает остаток, «на глаз» — мягко
    w[c] = Math.max(exact ? 0 : 0.5, w[c] - 1);
    return c;
  };
  for (let q = 0; q < s.np; q++) {
    if (q === view.me) continue;
    const h = [0, 0, 0, 0];
    for (let k = 0; k < view.handCounts[q]; k++) h[take()]++;
    s.players[q].hand = h;
  }
  const bag = [0, 0, 0, 0];
  for (let k = 0; k < view.bagTotal; k++) bag[take()]++;
  s.bag = bag;
  return s;
}

/** Вероятность, что у соперника с handCount тайлами есть хотя бы k тайлов цвета c. */
export function probAtLeast(view, handCount, c, k) {
  if (k <= 0) return 1;
  if (k > handCount) return 0;
  const { weights } = unknownPool(view);
  const total = weights[0] + weights[1] + weights[2] + weights[3];
  const p = total > 0 ? weights[c] / total : 0.25;
  // биномиальное приближение
  let below = 0;
  for (let j = 0; j < k; j++) below += binom(handCount, j) * p ** j * (1 - p) ** (handCount - j);
  return Math.max(0, Math.min(1, 1 - below));
}

function binom(n, k) {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

