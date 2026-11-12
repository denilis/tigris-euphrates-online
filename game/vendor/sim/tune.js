// Подбор весов оценки на победы в самоигре (SPSA).
//
//   node sim/tune.js --iters 80 --games 16 --workers 8 --seat "strength=30,errors=0" --variants --board both
//                    --out <файл весов .json> [--from <файл весов для продолжения>] [--seed 1000]
//
// Каждая итерация: случайное направление d (±1 по каждому весу), две версии
// весов th+ = th + c*d*шаг и th- = th - c*d*шаг играют партии вчетвером, по
// двое за столом через одного. Каждая раздача играется дважды, со сменой мест
// версий. Разница результатов (+1 за победу, +0,25 за второе место) — оценка
// наклона вдоль d; веса сдвигаются в сторону лучшей версии.
// Обучение по ходам людей (sim/train.js) учит «как играют», а это — «что выигрывает».

import { fork } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { playGame } from './arena.js';
import { BOARDS } from '../engine/boards.js';
import { makeRng } from '../engine/rng.js';
import { styleParams } from '../bot/styles.js';

// Подбираемые веса и их шаг (примерно «заметное изменение» для каждого).
export const TUNED = {
  'lowest.1': 0.08, 'lowest.2': 0.06, 'lowest.3': 0.05,
  prodRate: 0.05, monRate: 0.12, kingRate: 0.03, wonderRate: 0.1, traderTreasure: 0.08,
  onBoard: 0.12, offBoard: 0.1, support: 0.04, temple: 0.08, catastrophe: 0.25,
  handTile: 0.03, handRed: 0.05, exposed: 0.12, revoltHole: 0.1,
  monPrep: 0.08, handSupport: 0.03, cohesion: 0.08, attack: 0.08,
  bTilePoint: 0.12, bWar: 0.12, bMonument: 0.12, bLeaderNew: 0.1, bRevolt: 0.1, bPass: 0.1,
  oppMax: 0.12, oppMean: 0.12,
  relocate: 0.12, discard: 0.1,
};
const KEYS = Object.keys(TUNED);
const PLACE_VALUE = [1, 0.25, 0, 0];

/** Файл весов { weights, relocate, discard } -> плоский вектор по KEYS. */
export function toVector(w) {
  return KEYS.map((k) => {
    if (k === 'relocate' || k === 'discard') return w[k];
    const [name, i] = k.split('.');
    return i === undefined ? w.weights[name] : w.weights[name][+i];
  });
}

export function fromVector(v, base) {
  const w = { weights: JSON.parse(JSON.stringify(base.weights)), relocate: base.relocate, discard: base.discard };
  KEYS.forEach((k, j) => {
    if (k === 'relocate' || k === 'discard') { w[k] = Math.max(0, v[j]); return; }
    const [name, i] = k.split('.');
    if (i === undefined) w.weights[name] = v[j];
    else w.weights[name][+i] = Math.max(0, v[j]);
  });
  return w;
}

const asSettings = (w) => ({ weights: w.weights, relocate: w.relocate, discardCost: w.discard });

function parseSeat(str) {
  const o = {};
  for (const kv of (str || '').split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    o[k] = isNaN(+v) ? v : +v;
  }
  return o;
}

function parseArgs(argv) {
  const a = { iters: 80, games: 16, workers: 8, seed: 1000, cfg: {}, board: 'both', seat: { strength: 30, errors: 0, style: 'universal' }, out: null, from: null, worker: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--iters') a.iters = +argv[++i];
    else if (k === '--games') a.games = +argv[++i];
    else if (k === '--workers') a.workers = +argv[++i];
    else if (k === '--seed') a.seed = +argv[++i];
    else if (k === '--variants') a.cfg = { englishSupport: true, buildings: true, wonder: true };
    else if (k === '--board') a.board = argv[++i];
    else if (k === '--seat') a.seat = { style: 'universal', ...parseSeat(argv[++i]) };
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--from') a.from = argv[++i];
    else if (k === '--worker') a.worker = true;
  }
  return a;
}

/** Партия: версии A и B через одного; swap меняет их местами. Итог для A минус итог для B. */
function playPair(job) {
  const { seat, cfg, board, seed, wa, wb, swap } = job;
  const label = [0, 1, 2, 3].map((p) => ((p % 2 === 0) !== swap ? 'A' : 'B'));
  const seats = label.map((l) => ({ ...seat, ...asSettings(l === 'A' ? wa : wb) }));
  const r = playGame({ seats, seed, cfg, layout: BOARDS[board] });
  let diff = 0;
  r.ranking.forEach((p, place) => { diff += (label[p] === 'A' ? 1 : -1) * PLACE_VALUE[place]; });
  return { diff, winner: label[r.ranking[0]] };
}

/** Пул процессов: run(jobs) -> результаты в том же порядке. */
function makePool(n) {
  const workers = [];
  for (let i = 0; i < n; i++) workers.push(fork(fileURLToPath(import.meta.url), ['--worker'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }));
  return {
    run(jobs) {
      return new Promise((resolveAll, reject) => {
        const out = new Array(jobs.length);
        let next = 0, done = 0;
        const feed = (w) => {
          if (next >= jobs.length) return;
          const id = next++;
          w.once('message', (m) => {
            out[id] = m;
            if (++done === jobs.length) resolveAll(out);
            else feed(w);
          });
          w.send({ id, job: jobs[id] });
        };
        for (const w of workers) {
          w.removeAllListeners('exit');
          w.on('exit', (code) => { if (done < jobs.length) reject(new Error('процесс партий упал: код ' + code)); });
          feed(w);
        }
      });
    },
    close() { for (const w of workers) w.kill(); },
  };
}

if (process.argv.includes('--worker')) {
  process.on('message', ({ job }) => process.send(playPair(job)));
} else if ((process.argv[1] || '').endsWith('tune.js')) {
  const a = parseArgs(process.argv);
  if (!a.out) throw new Error('нужен --out <файл весов>');
  const base = styleParams({ style: a.seat.style });
  const start = a.from && existsSync(a.from) ? JSON.parse(readFileSync(a.from, 'utf8')) : { ...base, iter: 0 };
  let th = toVector(start);
  const scale = KEYS.map((k) => TUNED[k]);
  const rng = makeRng(a.seed * 7919 + (start.iter || 0));
  const pool = makePool(a.workers);
  // SPSA: шаг a_k и размах c_k медленно убывают
  const A = 10, alpha = 0.602, gammaC = 0.101, aGain = 6.0, cGain = 1.0;
  const t0 = Date.now();
  let winsPlus = 0, gamesAll = 0;
  for (let k = start.iter || 0; k < a.iters; k++) {
    const ak = aGain / Math.pow(k + 1 + A, alpha) * Math.pow(A + 1, alpha) / 4;
    const ck = cGain / Math.pow(k + 1, gammaC);
    const d = KEYS.map(() => (rng() < 0.5 ? -1 : 1));
    const plus = fromVector(th.map((x, j) => x + ck * d[j] * scale[j]), base);
    const minus = fromVector(th.map((x, j) => x - ck * d[j] * scale[j]), base);
    const jobs = [];
    for (let g = 0; g < a.games; g++) {
      const deal = Math.floor(g / 2);
      jobs.push({
        seat: a.seat, cfg: a.cfg,
        board: a.board === 'both' ? (deal % 2 ? 'advanced' : 'standard') : a.board,
        seed: a.seed + k * 1000 + deal, wa: plus, wb: minus, swap: g % 2 === 1,
      });
    }
    const res = await pool.run(jobs);
    const y = res.reduce((s, r) => s + r.diff, 0) / res.length; // >0: th+ лучше
    winsPlus += res.filter((r) => r.winner === 'A').length;
    gamesAll += res.length;
    // шаг в единицах «заметного изменения», не больше 0,5 за итерацию
    th = th.map((x, j) => x + Math.max(-0.5, Math.min(0.5, ak * y / (2 * ck) * d[j])) * scale[j]);
    const cur = fromVector(th, base);
    writeFileSync(a.out, JSON.stringify({ ...cur, iter: k + 1, seat: a.seat }, null, 1));
    const moved = KEYS.map((key, j) => [key, (th[j] - toVector(base)[j]) / scale[j]])
      .filter(([, z]) => Math.abs(z) >= 1).sort((p, q) => Math.abs(q[1]) - Math.abs(p[1])).slice(0, 6)
      .map(([key, z]) => `${key} ${z > 0 ? '+' : ''}${z.toFixed(1)}`).join(', ');
    console.log(`итерация ${k + 1}/${a.iters}: перевес th+ ${y >= 0 ? '+' : ''}${y.toFixed(2)}, ${Math.round((Date.now() - t0) / 1000)} с; сдвиги (в шагах): ${moved || 'нет'}`);
  }
  pool.close();
  console.log(`готово: ${a.out}`);
}
