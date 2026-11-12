// Партии ботов между собой. Каждый бот видит только то, что видел бы человек.
//
//   node sim/arena.js --games 10 --players 4 --seat "strength=80" --seat "strength=20,style=denis" ...
//                     [--board standard|advanced] — настоящее поле BGA вместо синтетического
//
// Сиденья без --seat играют «жадным» ботом с силой 0 и без ошибок.

import { createGame, legalMoves, applyMove, ranking, finalVector } from '../engine/engine.js';
import { makeRng } from '../engine/rng.js';
import { makeView } from '../bot/belief.js';
import { decide } from '../bot/bot.js';
import { testLayout } from '../test/helpers.js';
import { BOARDS } from '../engine/boards.js';

/**
 * Одна партия. У места может быть своя функция решения (seat.decide,
 * seat.makeView): так новый бот играет против сохранённой старой версии.
 * onEvent(ev, s) получает события движка (лидер, катастрофа, восстание, война...).
 */
export function playGame({ seats, seed = 1, cfg = {}, layout = testLayout(), verbose = false, onDecision, onEvent }) {
  const rng = makeRng(seed);
  const s = createGame({ layout, numPlayers: seats.length, cfg }, rng);
  s.log = onEvent ? [] : null;
  const times = seats.map(() => ({ ms: 0, n: 0, errors: 0 }));
  let guard = 0;
  while (!s.over) {
    const p = s.toMove;
    const settings = seats[p];
    const view = (settings.makeView || makeView)(s, p, settings.counting || 'none', rng);
    const res = (settings.decide || decide)(view, settings, rng);
    const legal = legalMoves(s).map((m) => JSON.stringify(m));
    if (!legal.includes(JSON.stringify(res.move))) {
      throw new Error(`illegal bot move ${JSON.stringify(res.move)} in ${s.phase}`);
    }
    times[p].ms += res.ms;
    times[p].n++;
    if (res.error) times[p].errors++;
    if (verbose) console.log(`T${s.turn} P${p} [${s.phase}] ${res.text}${res.error ? ' (ошибка: ' + res.error + ')' : ''} ${res.ms}ms`);
    if (onDecision) onDecision(s, p, res);
    const turn = s.turn;
    const cur = s.cur;
    applyMove(s, res.move, rng);
    if (onEvent) {
      for (const ev of s.log) onEvent(ev, s, turn, cur);
      s.log.length = 0;
    }
    if (++guard > 5000) throw new Error('game too long');
  }
  return {
    ranking: ranking(s),
    vectors: s.players.map(finalVector),
    turns: s.turn,
    endReason: s.endReason,
    times,
  };
}

function parseArgs(argv) {
  const a = { games: 4, players: 4, seats: [], cfg: {}, verbose: false, seed: 1, layout: undefined };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--games') a.games = +argv[++i];
    else if (k === '--players') a.players = +argv[++i];
    else if (k === '--seed') a.seed = +argv[++i];
    else if (k === '--verbose') a.verbose = true;
    else if (k === '--board') a.layout = BOARDS[argv[++i]];
    else if (k === '--variants') a.cfg = { englishSupport: true, buildings: true, wonder: true };
    else if (k === '--seat') {
      const o = {};
      for (const kv of argv[++i].split(',')) {
        const [key, val] = kv.split('=');
        o[key] = isNaN(+val) ? val : +val;
      }
      a.seats.push(o);
    }
  }
  while (a.seats.length < a.players) a.seats.push({ strength: 0, errors: 0 });
  return a;
}

if (process.argv[1] && process.argv[1].endsWith('arena.js')) {
  const a = parseArgs(process.argv);
  const wins = a.seats.map(() => 0);
  const avgMin = a.seats.map(() => 0);
  const t0 = Date.now();
  for (let g = 0; g < a.games; g++) {
    // сдвигаем места, чтобы порядок хода не давал преимущества
    const shift = g % a.seats.length;
    const seats = a.seats.map((_, i) => a.seats[(i + shift) % a.seats.length]);
    const r = playGame({ seats, seed: a.seed + g, cfg: a.cfg, layout: a.layout, verbose: a.verbose });
    const winner = (r.ranking[0] + shift) % a.seats.length;
    wins[winner]++;
    r.vectors.forEach((v, p) => { avgMin[(p + shift) % a.seats.length] += v[0] / a.games; });
    const ms = r.times.map((t) => Math.round(t.ms / Math.max(1, t.n)));
    console.log(`игра ${g + 1}: победил ${winner + 1}, ходов ${r.turns}, конец: ${r.endReason}, мин. счёт ${r.vectors.map((v) => v[0]).join('/')}, мс/решение ${ms.join('/')}`);
  }
  console.log('\nместо  настройки                      побед  ср. минимум');
  a.seats.forEach((st, i) => console.log(`${i + 1}      ${JSON.stringify(st).padEnd(30)} ${String(wins[i]).padEnd(6)} ${avgMin[i].toFixed(1)}`));
  console.log(`время: ${((Date.now() - t0) / 1000).toFixed(0)} с`);
}
