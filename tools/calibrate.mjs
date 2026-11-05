// Калибровочный турнир ботов (Денис 05.11): Универсальный бот на ступенях силы из карточек ботов
// (public/js/bot-steps.js STRENGTH_GUIDE) и самой слабой настройке играет вдвоем каждый с каждым
// на поле и правилах сайта по умолчанию, бот видит позицию так же, как на сервере (game/bots.js
// botView), потолок раздумий 3 с, как на сервере. Каждая пара играет поровну первым и вторым
// с одинаковыми зернами. Итог каждой партии дописывается строкой в tools/calibration/games.jsonl:
// прерванный прогон продолжается с того же места. Рейтинги и шансы: tools/calibration-report.mjs.
//   node tools/calibrate.mjs [партий на пару, по умолчанию 40] [потоков, по умолчанию 10]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { mkdirSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGame, applyMove, legalMoves, ranking, finalVector } from '../game/vendor/engine/engine.js';
import { BOARDS } from '../game/vendor/engine/boards.js';
import { makeView, publicRemoved } from '../game/vendor/bot/belief.js';
import { decide } from '../game/vendor/bot/bot.js';
import { makeRng } from '../game/vendor/engine/rng.js';
import { DEFAULT_TIME_CAP } from '../game/bots.js';
import { DEFAULT_OPTIONS } from '../game/table.js';
import { LEVELS } from './calibration-levels.mjs';

const OUT = new URL('./calibration/games.jsonl', import.meta.url);

/** Одна партия вдвоем: seats — номера ступеней по местам, seed — раздача. */
function playOne({ seats, seed }) {
  const o = DEFAULT_OPTIONS;
  const cfg = { englishSupport: o.englishSupport, buildings: o.buildings, wonder: o.wonder, confirmTurn: false };
  const rng = makeRng(seed);
  const botRng = makeRng(seed * 7919 + 17);
  const s = createGame({ layout: BOARDS[o.board], numPlayers: seats.length, cfg }, rng);
  const n = seats.map(() => 0), ms = seats.map(() => 0);
  let guard = 0;
  while (!s.over) {
    const p = s.toMove;
    const set = { style: 'universal', risk: 50, ...LEVELS[seats[p]].set };
    set.timeMs = Math.min(DEFAULT_TIME_CAP, 400 + 7000 * (set.strength / 100));
    // как game/bots.js botView: чужие руки скрыты, из ушедшего известно публичное и свои сбросы
    const view = makeView(s, p, set.counting, botRng);
    view.state.removed = publicRemoved(s).map((v, c) => v + s.players[p].discarded[c]);
    view.state.cfg = { ...view.state.cfg, confirmTurn: false };
    const res = decide(view, set, botRng);
    if (!legalMoves(s).some((m) => JSON.stringify(m) === JSON.stringify(res.move))) throw new Error(`недопустимый ход ${JSON.stringify(res.move)}`);
    n[p]++;
    ms[p] += res.ms || 0;
    applyMove(s, res.move, rng);
    if (++guard > 5000) throw new Error('партия не кончается');
  }
  const order = ranking(s), vec = s.players.map(finalVector);
  const place = seats.map((_, p) => 1 + order.findIndex((q) => JSON.stringify(vec[q]) === JSON.stringify(vec[p])));
  return { seats: seats.map((i) => LEVELS[i].id), seed, place, score: vec.map((v) => v[0]), turns: s.turn, decisions: n, ms: ms.map(Math.round) };
}

if (!isMainThread) {
  parentPort.on('message', (job) => {
    try { parentPort.postMessage({ ok: true, r: playOne(job) }); } catch (e) { parentPort.postMessage({ ok: false, job, error: String(e?.stack || e) }); }
  });
} else {
  const [perPair = 40, threads = 10] = process.argv.slice(2).map(Number);
  mkdirSync(new URL('./calibration/', import.meta.url), { recursive: true });
  // расписание: каждая пара ступеней, зерна 1..perPair/2, каждое зерно дважды со сменой мест
  const jobs = [];
  for (let a = 0; a < LEVELS.length; a++) {
    for (let b = a + 1; b < LEVELS.length; b++) {
      for (let k = 1; k <= Math.ceil(perPair / 2); k++) {
        const seed = 1000 * (a * 10 + b) + k;
        jobs.push({ seats: [a, b], seed }, { seats: [b, a], seed });
      }
    }
  }
  const key = (seats, seed) => `${seats.join('-')}:${seed}`;
  const done = new Set();
  if (existsSync(OUT)) {
    for (const line of readFileSync(OUT, 'utf8').split('\n').filter(Boolean)) {
      const r = JSON.parse(line);
      done.add(key(r.seats.map((id) => LEVELS.findIndex((l) => l.id === id)), r.seed));
    }
  }
  // чередуем пары, чтобы прерванный прогон уже покрывал все пары понемногу
  const todo = jobs.filter((j) => !done.has(key(j.seats, j.seed))).sort((x, y) => (x.seed % 1000) - (y.seed % 1000));
  console.log(`партий в расписании ${jobs.length}, уже сыграно ${jobs.length - todo.length}, осталось ${todo.length}, потоков ${threads}`);
  let next = 0, finished = 0;
  const t0 = Date.now();
  const self = fileURLToPath(import.meta.url);
  const run = (w) => {
    if (next >= todo.length) return w.terminate();
    w.postMessage(todo[next++]);
  };
  for (let i = 0; i < Math.min(threads, todo.length); i++) {
    const w = new Worker(self);
    w.on('message', (m) => {
      if (m.ok) appendFileSync(OUT, JSON.stringify(m.r) + '\n');
      else console.error('сбой партии', JSON.stringify(m.job), m.error);
      finished++;
      if (finished % 10 === 0 || finished === todo.length) {
        const min = (Date.now() - t0) / 60000;
        console.log(`${finished}/${todo.length} за ${min.toFixed(1)} мин, осталось около ${((todo.length - finished) * min / finished).toFixed(0)} мин`);
      }
      run(w);
    });
    w.on('error', (e) => console.error('поток упал', e));
    run(w);
  }
}
