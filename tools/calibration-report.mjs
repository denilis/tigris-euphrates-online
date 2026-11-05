// Итоги калибровочного турнира ботов (Денис 05.11): из tools/calibration/games.jsonl считает шансы
// каждой ступени против каждой один на один и рейтинги ступеней (модель Брэдли-Терри в шкале Эло:
// разница 400 очков дает шансы 10 к 1). Бот по умолчанию («Играю иногда») стоит на 1500.
// Погрешность: 90% интервал по 300 повторным выборкам партий. Пишет public/js/bot-ladder.js
// (его читают карточки ботов) и печатает таблицу.
//   node tools/calibration-report.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { LEVELS } from './calibration-levels.mjs';
import { makeRng } from '../game/vendor/engine/rng.js';

const ANCHOR = 'casual', BASE = 1500, BOOT = 300;

/** Очки партии вдвоем: победа 1, ничья 0,5. */
export function outcomes(games) {
  const out = [];
  for (const g of games) {
    if (g.seats.length !== 2) continue;
    const [a, b] = g.seats.map((id) => LEVELS.findIndex((l) => l.id === id));
    const sa = g.place[0] < g.place[1] ? 1 : g.place[0] > g.place[1] ? 0 : 0.5;
    out.push({ a, b, sa });
  }
  return out;
}

/** Рейтинги Брэдли-Терри (итерации MM), сила с поправкой на ничьи как пол-победы. */
export function fitRatings(res, n = LEVELS.length) {
  const W = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const { a, b, sa } of res) { W[a][b] += sa; W[b][a] += 1 - sa; }
  // половина победы каждому против каждого: без нее ступень без поражений уходит в бесконечность
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) W[i][j] += 0.5;
  let p = new Array(n).fill(1);
  for (let it = 0; it < 2000; it++) {
    const q = p.map((pi, i) => {
      let wins = 0, den = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        wins += W[i][j];
        den += (W[i][j] + W[j][i]) / (pi + p[j]);
      }
      return wins / den;
    });
    const g = Math.exp(q.reduce((s, x) => s + Math.log(x), 0) / n);
    p = q.map((x) => x / g);
  }
  const anchor = LEVELS.findIndex((l) => l.id === ANCHOR);
  return p.map((x) => BASE + 400 * Math.log10(x / p[anchor]));
}

export const winChance = (ra, rb) => 1 / (1 + 10 ** ((rb - ra) / 400));

function main() {
  const games = readFileSync(new URL('./calibration/games.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const res = outcomes(games);
  const n = LEVELS.length;
  const rating = fitRatings(res);
  const rng = makeRng(2026);
  const boots = Array.from({ length: BOOT }, () => fitRatings(res.map(() => res[Math.floor(rng() * res.length)])));
  const band = rating.map((_, i) => {
    const v = boots.map((b) => b[i]).sort((x, y) => x - y);
    return [v[Math.floor(BOOT * 0.05)], v[Math.floor(BOOT * 0.95)]];
  });
  // сыгранные шансы по парам (без модели): доля очков a против b
  const played = Array.from({ length: n }, () => Array.from({ length: n }, () => ({ n: 0, s: 0 })));
  for (const { a, b, sa } of res) {
    played[a][b].n++; played[a][b].s += sa;
    played[b][a].n++; played[b][a].s += 1 - sa;
  }
  const first = res.length ? res.reduce((s, r) => s + r.sa, 0) / res.length : 0;
  const ms = games.flatMap((g) => g.ms.map((m, i) => m / Math.max(1, g.decisions[i])));
  const ladder = {
    games: res.length,
    firstSeat: Math.round(first * 100),
    anchor: ANCHOR,
    levels: LEVELS.map((l, i) => ({ id: l.id, title: l.title, set: l.set, rating: Math.round(rating[i]), lo: Math.round(band[i][0]), hi: Math.round(band[i][1]) })),
    // шанс строки против столбца по рейтингам, проценты
    chance: LEVELS.map((_, i) => LEVELS.map((__, j) => (i === j ? 50 : Math.round(100 * winChance(rating[i], rating[j]))))),
    played: played.map((row) => row.map((c) => (c.n ? { n: c.n, pct: Math.round((100 * c.s) / c.n) } : null))),
  };
  writeFileSync(new URL('../public/js/bot-ladder.js', import.meta.url), `// Итоги калибровочного турнира ботов: собирает tools/calibration-report.mjs, руками не править.
// rating: шкала Эло, бот по умолчанию 1500, lo-hi 90% интервал; chance[i][j]: шанс ступени i против j
// один на один, проценты; played: сколько партий сыграно и доля очков без модели.
export const LADDER = ${JSON.stringify(ladder)};
`);
  console.log(`партий вдвоем: ${res.length}, первый ход выигрывает ${ladder.firstSeat}%, в среднем на решение ${Math.round(ms.reduce((a, b) => a + b, 0) / ms.length)} мс`);
  for (const l of ladder.levels) console.log(`${l.title.padEnd(16)} ${String(l.rating).padStart(5)}  [${l.lo}, ${l.hi}]`);
  console.log('шансы строки против столбца, %:');
  console.log('                 ' + LEVELS.map((l) => l.id.padStart(7)).join(''));
  ladder.chance.forEach((row, i) => console.log(LEVELS[i].id.padEnd(17) + row.map((v, j) => (i === j ? '      -' : `${String(v).padStart(4)}${ladder.played[i][j] ? `/${String(ladder.played[i][j].pct).padStart(2)}` : '   '}`)).join('')));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) main();
