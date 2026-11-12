// Доля побед одного бота против трёх других, партии параллельно в нескольких процессах.
//
//   node sim/match.js --games 64 --workers 8 --hero "strength=100,errors=0,counting=exact"
//                     [--field "strength=50,errors=5"] [--board both|standard|advanced] [--variants]
//                     [--hero-weights <json>] [--field-weights <json>] [--seed 1] [--json <файл итога>]
//                     [--log <файл.jsonl>] [--field-code <папка со старыми bot/ и engine/>]
//
// «Герой» сидит на одном месте, остальные — «поле». Место героя идёт по кругу,
// чтобы первый ход не давал перевеса. Честная доля при 4 игроках — 25%.
// --log: каждая партия сразу дописывается в файл; при повторном запуске с тем же
// файлом сыгранные партии не переигрываются (замер переживает перезапуск компьютера).
// --hero-weights: JSON { weights, relocate, discard } поверх стиля героя (sim/tune.js).

import { fork } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { playGame } from './arena.js';
import { BOARDS } from '../engine/boards.js';
import { testLayout } from '../test/helpers.js';

function parseSeat(str) {
  const o = {};
  for (const kv of (str || '').split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    o[k] = isNaN(+v) ? v : +v;
  }
  return o;
}

export function parseArgs(argv) {
  const a = {
    games: 32, workers: 8, players: 4, seed: 1, cfg: {}, board: 'both',
    hero: { strength: 100, errors: 0, counting: 'exact', style: 'universal' },
    field: { strength: 50, errors: 5, style: 'universal' },
    heroWeights: null, fieldWeights: null, fieldCode: null, json: null, log: null, worker: false, list: [], stallMin: 20,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--games') a.games = +argv[++i];
    else if (k === '--workers') a.workers = +argv[++i];
    else if (k === '--players') a.players = +argv[++i];
    else if (k === '--seed') a.seed = +argv[++i];
    else if (k === '--variants') a.cfg = { englishSupport: true, buildings: true, wonder: true };
    else if (k === '--board') a.board = argv[++i];
    else if (k === '--hero') a.hero = { style: 'universal', ...parseSeat(argv[++i]) };
    else if (k === '--field') a.field = { style: 'universal', ...parseSeat(argv[++i]) };
    else if (k === '--hero-weights') a.heroWeights = argv[++i];
    else if (k === '--field-weights') a.fieldWeights = argv[++i];
    else if (k === '--field-code') a.fieldCode = argv[++i];
    else if (k === '--json') a.json = argv[++i];
    else if (k === '--worker') a.worker = true;
    else if (k === '--log') a.log = argv[++i];
    else if (k === '--stall') a.stallMin = +argv[++i];
    else if (k === '--list') a.list = argv[++i].split(',').map(Number);
  }
  return a;
}

const loadWeights = (file) => (file ? JSON.parse(readFileSync(file, 'utf8')) : null);

/** Бот из другой папки (сохраненная старая версия): поле играет им, герой текущим кодом (08.11). */
export async function loadCode(dir) {
  if (!dir) return null;
  const d = resolve(dir);
  const bot = await import(pathToFileURL(join(d, 'bot', 'bot.js')).href);
  const belief = await import(pathToFileURL(join(d, 'bot', 'belief.js')).href);
  return { decide: bot.decide, makeView: belief.makeView };
}

/** Файл весов { weights, relocate, discard } -> настройки бота. */
export function asSettings(w) {
  if (!w) return {};
  const o = {};
  if (w.weights) o.weights = w.weights;
  if (w.relocate !== undefined) o.relocate = w.relocate;
  if (w.discard !== undefined) o.discardCost = w.discard;
  return o;
}

/** Одна партия номер g: герой на месте g % players. */
export function playOne(a, g, heroW = loadWeights(a.heroWeights), fieldW = loadWeights(a.fieldWeights), fieldCode = null) {
  const heroSeat = g % a.players;
  const seats = Array.from({ length: a.players }, (_, p) => (p === heroSeat
    ? { ...a.hero, ...asSettings(heroW) }
    : { ...a.field, ...asSettings(fieldW), ...(fieldCode || {}) }));
  const board = a.board === 'both' ? (Math.floor(g / a.players) % 2 ? 'advanced' : 'standard') : a.board;
  const layout = board === 'test' ? testLayout() : BOARDS[board];
  // одна раздача на пару партий: при смене места героя расклад тот же
  const r = playGame({ seats, seed: a.seed + Math.floor(g / a.players), cfg: a.cfg, layout });
  const place = r.ranking.indexOf(heroSeat);
  return { g, heroSeat, place, win: place === 0, min: r.vectors[heroSeat][0], best: Math.max(...r.vectors.map((v) => v[0])) };
}

/** Партии с номерами todo в workers процессах. Возвращает список итогов партий. */
export function runMatch(a, onGame, todo = Array.from({ length: a.games }, (_, g) => g)) {
  const argv = process.argv.slice(2).filter((x, i, arr) => !['--worker', '--list'].includes(x) && arr[i - 1] !== '--list');
  const n = Math.max(1, Math.min(a.workers, todo.length));
  const jobs = [];
  for (let w = 0; w < n; w++) {
    // по кругу: каждому процессу достаются партии на обоих полях и всех местах
    const list = todo.filter((_, i) => i % n === w);
    if (!list.length) continue;
    jobs.push(new Promise((resolveJob) => {
      const out = [];
      const child = fork(fileURLToPath(import.meta.url), [...argv, '--worker', '--list', list.join(',')], { stdio: ['ignore', 'pipe', 'inherit', 'ipc'] });
      // Сторож: процесс, который stallMin минут не присылает партий, останавливается
      // (одна партия зациклилась на 25+ минут, 25.10.2026), его остальные партии
      // доиграет повторный запуск с тем же --log.
      let last = Date.now();
      const timer = setInterval(() => {
        if (Date.now() - last > a.stallMin * 60000) {
          console.log(`процесс партий ${list.join(',')} молчит ${a.stallMin} мин: останавливаю`);
          child.kill();
        }
      }, 30000);
      child.on('message', (m) => {
        last = Date.now();
        if (m.error) {
          console.log(`партия ${m.g}: ошибка ${m.error}`);
          return;
        }
        out.push(m);
        if (onGame) onGame(m);
      });
      child.on('exit', (code) => {
        clearInterval(timer);
        if (code !== 0) console.log(`процесс партий ${list.join(',')} завершился с кодом ${code}`);
        resolveJob(out);
      });
    }));
  }
  return Promise.all(jobs).then((parts) => parts.flat().sort((x, y) => x.g - y.g));
}

/** Доля побед и 95% интервал (Уилсон). */
export function summary(results) {
  const n = results.length, w = results.filter((r) => r.win).length;
  const p = n ? w / n : 0, z = 1.96;
  const c = (p + z * z / (2 * n)) / (1 + z * z / n);
  const h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n);
  const avgPlace = results.reduce((s, r) => s + r.place + 1, 0) / Math.max(1, n);
  const avgMin = results.reduce((s, r) => s + r.min, 0) / Math.max(1, n);
  return { games: n, wins: w, share: p, lo: Math.max(0, c - h), hi: Math.min(1, c + h), avgPlace, avgMin };
}

if ((process.argv[1] || '').endsWith('match.js')) {
  const a = parseArgs(process.argv);
  if (a.worker) {
    const hw = loadWeights(a.heroWeights), fw = loadWeights(a.fieldWeights), fc = await loadCode(a.fieldCode);
    for (const g of a.list) {
      try {
        process.send(playOne(a, g, hw, fw, fc));
      } catch (e) {
        process.send({ g, error: e.message });
      }
    }
    process.disconnect();
  } else {
    const t0 = Date.now();
    const old = a.log && existsSync(a.log)
      ? readFileSync(a.log, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.g < a.games)
      : [];
    const doneG = new Set(old.map((r) => r.g));
    const todo = Array.from({ length: a.games }, (_, g) => g).filter((g) => !doneG.has(g));
    if (old.length) console.log(`уже сыграно ${old.length} из ${a.games} (файл ${a.log}), доигрываю ${todo.length}`);
    let done = old.length;
    const fresh = await runMatch(a, (r) => {
      done++;
      if (a.log) appendFileSync(a.log, JSON.stringify(r) + '\n');
      console.log(`партия ${done}/${a.games}: герой на месте ${r.heroSeat + 1}, занял ${r.place + 1}-е, мин. ${r.min} (у лучшего ${r.best})`);
    }, todo);
    const results = [...old, ...fresh].sort((x, y) => x.g - y.g);
    const s = summary(results);
    const pct = (x) => (100 * x).toFixed(0) + '%';
    console.log(`\nгерой ${JSON.stringify(a.hero)}${a.heroWeights ? ' + веса ' + a.heroWeights : ''}`);
    console.log(`поле  ${JSON.stringify(a.field)}${a.fieldWeights ? ' + веса ' + a.fieldWeights : ''}${a.fieldCode ? ' + код ' + a.fieldCode : ''}`);
    console.log(`побед ${s.wins} из ${s.games} = ${pct(s.share)} (95%: ${pct(s.lo)}–${pct(s.hi)}), среднее место ${s.avgPlace.toFixed(2)}, ср. минимум ${s.avgMin.toFixed(1)}`);
    console.log(`время: ${Math.round((Date.now() - t0) / 1000)} с`);
    if (a.json) writeFileSync(a.json, JSON.stringify({ args: a, summary: s, results }, null, 1));
  }
}
