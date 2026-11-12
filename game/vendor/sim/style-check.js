// Различаются ли боты характером (Денис 11.11): где встают в дебюте, подставляют ли лидеров в
// чужие царства, как часто воюют, насколько крепкие у них царства. Четыре стиля за одним столом,
// места по кругу, поле продвинутое с вариантами, как на сайте.
//
//   node sim/style-check.js --games 12 [--seed 1] [--styles andrey,vlad,denis,universal]
//                           [--code <папка со старыми bot/ и engine/>] [--time 500] [--json <файл>]
//
// --code: играть старой версией бота (сравнение «до/после»), признаки меряются текущим кодом.
// Метрики на игрока за партию:
//   start   — наименьшее расстояние (по прямым) от своих лидеров до чужих после 2 своих ходов
//   shared  — доля партий, где после 2 своих ходов свой лидер уже в одном царстве с чужим
//   guestIn — сколько раз за партию поставил лидера в царство, где есть чужие лидеры (без восстания)
//   revolts, wars — начатые восстания и войны (как атакующий)
//   guest, host — среднее за свои ходы: свои лидеры в чужих царствах и чужие в своих
//   temples — среднее храмов у своего лидера; thin — лидеров на одном открытом храме; fragile —
//   сколько тайлов одна катастрофа отрежет от лидера (худшая клетка), в среднем на лидера
//   lost — своих лидеров снято с поля (катастрофа, восстание, война)
// По раундам (Денис 11.11, стиль Андрея «строитель, потом каток»; цели из профиля BGA
// data/analysis/partners_all.json: у Андрея 3 атаки в раундах 1-6 за 57 партий, первая на 11,4,
// 69% атак с 13-го раунда, 81% войн выиграно, 1,46 монумента, 1,98 здания, 0,6 перестановки):
//   atk — свои атаки (войны и восстания, начатые самим); early6 — из них в раундах 1-6;
//   init6 — из early6 только в свой ход (в войне от чужого тайла атакующим по правилам бывает и не он);
//   first — раунд первой своей атаки (среднее по партиям, где она была); late13 — доля атак с 13-го раунда;
//   atkWin — доля выигранных своих атак; mons, blds — построено монументов и зданий; reloc — перестановок

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { components, templeCount } from '../engine/engine.js';
import { geom } from '../engine/constants.js';
import { BOARDS } from '../engine/boards.js';
import { positionRecord, X_GUEST, X_HOST, X_THIN, X_FRAGILE } from '../bot/evaluate.js';
import { playGame } from './arena.js';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const GAMES = +arg('games', 12);
const SEED = +arg('seed', 1);
const STYLES = arg('styles', 'andrey,vlad,denis,universal').split(',');
const TIME = +arg('time', 500);
const CODE = arg('code', null);
// --over '{"andrey":{"weights":{...},"peaceRounds":8,"lateWar":1.5,"risk":50}}': настройки места поверх
// стиля, чтобы сравнивать варианты характера без правки bot/styles.js
const OVER = JSON.parse(arg('over', '{}'));

let decide, makeView;
if (CODE) {
  ({ decide } = await import(pathToFileURL(path.resolve(CODE, 'bot/bot.js')).href));
  ({ makeView } = await import(pathToFileURL(path.resolve(CODE, 'bot/belief.js')).href));
}

const blank = () => ({ games: 0, wins: 0, place: 0, start: 0, shared: 0, guestIn: 0, revolts: 0, wars: 0,
  guest: 0, host: 0, temples: 0, thin: 0, fragile: 0, lost: 0, samples: 0, leaders: 0,
  atk: 0, early6: 0, init6: 0, late13: 0, atkWon: 0, firstSum: 0, firstN: 0, mons: 0, blds: 0, reloc: 0 });
const per = Object.fromEntries(STYLES.map((k) => [k, blank()]));

function minDistance(s, p) {
  const { W } = geom(s);
  let best = Infinity;
  for (const a of s.players[p].leaders) {
    if (a < 0) continue;
    for (let o = 0; o < s.np; o++) {
      if (o === p) continue;
      for (const b of s.players[o].leaders) {
        if (b < 0) continue;
        best = Math.min(best, Math.abs((a % W) - (b % W)) + Math.abs(Math.floor(a / W) - Math.floor(b / W)));
      }
    }
  }
  return best;
}

function sharesKingdom(s, p) {
  const comps = components(s);
  const mine = new Set(s.players[p].leaders.filter((x) => x >= 0).map((x) => comps.lab[x]));
  for (let o = 0; o < s.np; o++) if (o !== p) for (const b of s.players[o].leaders) if (b >= 0 && mine.has(comps.lab[b])) return true;
  return false;
}

const t0 = Date.now();
for (let g = 0; g < GAMES; g++) {
  const shift = g % STYLES.length;
  const order = STYLES.map((_, i) => STYLES[(i + shift) % STYLES.length]);
  const seats = order.map((style) => ({ style, strength: 50, errors: 5, counting: 'none', timeMs: TIME, ...(CODE ? { decide, makeView } : {}), ...(OVER[style] || {}) }));
  const ownTurns = order.map(() => 0);
  const sampled = order.map(() => false);
  const firstAt = order.map(() => 0); // раунд первой своей атаки
  let lastTurn = 0, warAtt = -1;
  const r = playGame({
    seats,
    seed: SEED + g,
    cfg: { englishSupport: true, buildings: true, wonder: true },
    layout: BOARDS.advanced,
    onDecision(s, p, res) {
      const st = per[order[p]];
      if (s.phase === 'action' && s.actionNo === 1 && s.turn !== lastTurn) {
        lastTurn = s.turn;
        ownTurns[p]++;
        if (ownTurns[p] === 3 && !sampled[p]) {
          sampled[p] = true;
          const d = minDistance(s, p);
          st.start += Number.isFinite(d) ? d : 16;
          st.shared += sharesKingdom(s, p) ? 1 : 0;
        }
        const rec = positionRecord(s, { shape: true }).players[p];
        st.guest += rec[X_GUEST];
        st.host += rec[X_HOST];
        st.thin += rec[X_THIN];
        st.fragile += rec[X_FRAGILE];
        st.samples++;
        for (const at of s.players[p].leaders) if (at >= 0) { st.temples += templeCount(s, at); st.leaders++; }
      }
      if (s.phase === 'action' && res.move.type === 'leader') {
        const { NB } = geom(s);
        const comps = components(s);
        const labs = new Set(NB[res.move.pos].map((j) => comps.lab[j]).filter((l) => l >= 0));
        let others = false, sameColor = false;
        for (let o = 0; o < s.np; o++) {
          if (o === p) continue;
          s.players[o].leaders.forEach((b, c) => {
            if (b >= 0 && labs.has(comps.lab[b])) { others = true; if (c === res.move.color) sameColor = true; }
          });
        }
        if (others && !sameColor) st.guestIn++;
      }
    },
    onEvent(ev, s, turn, cur) {
      const round = Math.ceil(turn / s.np);
      const own = (p) => {
        const st = per[order[p]];
        st.atk++;
        if (round <= 6) st.early6++;
        if (round <= 6 && p === cur) st.init6++;
        if (round >= 13) st.late13++;
        if (!firstAt[p]) firstAt[p] = round;
      };
      if (ev.ev === 'revolt') {
        per[order[cur]].revolts++;
        own(cur);
        if (ev.winner === cur) per[order[cur]].atkWon++;
      }
      if (ev.ev === 'warStart') {
        per[order[ev.att]].wars++;
        own(ev.att);
        warAtt = ev.att;
      }
      if (ev.ev === 'war' && warAtt >= 0) {
        if (ev.winner === warAtt) per[order[warAtt]].atkWon++;
        warAtt = -1;
      }
      if (ev.ev === 'monument') per[order[ev.p]].mons++;
      if (ev.ev === 'building') per[order[ev.p]].blds++;
      if (ev.ev === 'leader' && ev.from >= 0) per[order[ev.p]].reloc++;
      if (ev.ev === 'leaderReturned') per[order[ev.p]].lost++;
      if ((ev.ev === 'revolt' || ev.ev === 'war') && ev.loser >= 0) per[order[ev.loser]].lost++;
    },
  });
  firstAt.forEach((r, p) => {
    if (!r) return;
    per[order[p]].firstSum += r;
    per[order[p]].firstN++;
  });
  r.ranking.forEach((p, place) => {
    const st = per[order[p]];
    st.games++;
    st.place += place + 1;
    if (place === 0) st.wins++;
  });
  console.log(`партия ${g + 1}/${GAMES}: победил ${order[r.ranking[0]]}, ходов ${r.turns}, ${Math.round((Date.now() - t0) / 1000)} с`);
}

const rows = {};
for (const [k, st] of Object.entries(per)) {
  const n = Math.max(1, st.games), m = Math.max(1, st.samples), l = Math.max(1, st.leaders);
  rows[k] = {
    games: st.games, wins: st.wins, place: +(st.place / n).toFixed(2),
    start: +(st.start / n).toFixed(1), shared: +(st.shared / n).toFixed(2), guestIn: +(st.guestIn / n).toFixed(1),
    revolts: +(st.revolts / n).toFixed(1), wars: +(st.wars / n).toFixed(1),
    guest: +(st.guest / m).toFixed(2), host: +(st.host / m).toFixed(2),
    temples: +(st.temples / l).toFixed(2), thin: +(st.thin / m).toFixed(2), fragile: +(st.fragile / m).toFixed(2),
    lost: +(st.lost / n).toFixed(1),
    atk: +(st.atk / n).toFixed(1), early6: +(st.early6 / n).toFixed(2), init6: +(st.init6 / n).toFixed(2), first: st.firstN ? +(st.firstSum / st.firstN).toFixed(1) : null,
    late13: st.atk ? +(st.late13 / st.atk).toFixed(2) : null, atkWin: st.atk ? +(st.atkWon / st.atk).toFixed(2) : null,
    mons: +(st.mons / n).toFixed(2), blds: +(st.blds / n).toFixed(2), reloc: +(st.reloc / n).toFixed(2),
  };
}
console.table(rows);
const out = arg('json', null);
if (out) writeFileSync(out, JSON.stringify({ games: GAMES, seed: SEED, code: CODE, rows }, null, 1));
