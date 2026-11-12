// Разбор партии сайта: почему бот мало берет очков с монументов (08.11.2026, партии Дениса с ботами).
//
//   node sim/monument-review.js <запись.json> [--decide] [--strength 100] [--counting approx] [--risk 65]
//
// Запись — ответ сайта GET tables/<код>/record: { rec: { seed, board, np, cfg, moves }, order, humans }.
// Партия повторяется тем же генератором, что на сайте (mulberry32 от rec.seed). В начале каждого хода
// для каждого игрока считаются пары «свой лидер цвета c и монумент с цветом c в том же царстве»: каждая
// пара дает очко в конце хода (engine monumentScoring). На ходах бота (места не из humans) перечисляются
// ходы лидером, которые добавили бы такую пару, и что сделал бот; с --decide бот решает заново и
// показывает свои оценки лучших ходов (view.debug step1).

import { readFileSync } from 'node:fs';
import { createGame, applyMove, cloneState, legalMoves, components } from '../engine/engine.js';
import { BOARDS } from '../engine/boards.js';
import { cellName } from '../engine/constants.js';
import { makeView } from '../bot/belief.js';
import { decide, conflictOdds } from '../bot/bot.js';
import { settle } from '../bot/policy.js';

/** Генератор записи партии сайта (game/random.js seededRng, mulberry32). */
export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Пары «лидер и монумент его цвета в одном царстве» у игрока p: очки с монументов в конце его хода. */
export function monumentPairs(s, p) {
  const built = s.monuments.filter((m) => m.pos >= 0);
  if (!built.length) return 0;
  const comps = components(s);
  let n = 0;
  for (let c = 0; c < 4; c++) {
    const pos = s.players[p].leaders[c];
    if (pos < 0) continue;
    for (const m of built) if ((m.c1 === c || m.c2 === c) && comps.lab[m.pos] === comps.lab[pos]) n++;
  }
  return n;
}

const LEAD = ['жрец', 'фермер', 'торговец', 'царь'];
const moveText = (m, s) => {
  if (m.type === 'leader') {
    const from = s.players[s.toMove].leaders[m.color];
    return `${LEAD[m.color]} ${from >= 0 ? cellName(from) + '->' : ''}${cellName(m.pos)}`;
  }
  if (m.type === 'tile') return `тайл ${'кзсч'[m.color]} ${cellName(m.pos)}`;
  if (m.type === 'catastrophe') return `катастрофа ${cellName(m.pos)}`;
  return m.type;
};

/** Ходы лидером игрока p, после которых пар «лидер + монумент» больше; с шансом восстания, если оно начинается. */
export function monumentChances(s, p, view = null) {
  const now = monumentPairs(s, p);
  const out = [];
  for (const m of legalMoves(s)) {
    if (m.type !== 'leader') continue;
    const x = cloneState(s);
    try {
      applyMove(x, m, () => 0.5);
    } catch {
      continue;
    }
    const revolt = x.phase === 'revoltSupport';
    const fixed = cloneState(x);
    try { settle(fixed, () => 0.5); } catch { /* бой не доигрался: смотрим позицию до боя */ }
    const gain = monumentPairs(revolt ? fixed : x, p) - now;
    if (gain <= 0) continue;
    const odds = revolt && view ? conflictOdds(view, s, m) : null;
    out.push({ m, gain, revolt, pWin: odds ? odds.pWin : null });
  }
  return out.sort((a, b) => b.gain - a.gain);
}

export function review(file, { redecide = false, settings = {} } = {}) {
  const { rec, order, humans } = JSON.parse(readFileSync(file, 'utf8'));
  const rng = seededRng(rec.seed);
  const s = createGame({ layout: BOARDS[rec.board], numPlayers: rec.np, cfg: rec.cfg }, rng);
  const bots = new Set(order.map((seat, p) => (humans.includes(seat) ? -1 : p)).filter((p) => p >= 0));
  const pairsByTurn = Array.from({ length: rec.np }, () => []); // пары в начале каждого своего хода
  const lines = [];
  let lastTurn = -1;
  for (const m of rec.moves) {
    if (s.phase === 'action' && s.turn !== lastTurn) {
      lastTurn = s.turn;
      pairsByTurn[s.cur].push(monumentPairs(s, s.cur));
    }
    if (m.type === 'monument') lines.push(`ход ${s.turn}: игрок ${s.toMove}${bots.has(s.toMove) ? ' (бот)' : ''} строит монумент ${m.id} на ${cellName(m.tl)}`);
    if (s.phase === 'action' && bots.has(s.toMove)) {
      // тайлы, которые замыкают квадрат 2x2 под монумент: после них решает сам бот в фазе monument
      const squares = legalMoves(s).filter((t) => t.type === 'tile').filter((t) => {
        const x = cloneState(s);
        try { applyMove(x, t, () => 0.5); } catch { return false; }
        return x.phase === 'monument' && x.toMove === s.toMove;
      });
      if (squares.length) {
        const took = squares.some((t) => JSON.stringify(t) === JSON.stringify(m));
        let line = `ход ${s.turn}.${s.actionNo} бот (игрок ${s.toMove}): можно замкнуть квадрат под монумент: ${squares.slice(0, 4).map((t) => moveText(t, s)).join(', ')}; сыграл ${moveText(m, s)}${took ? ' [ЗАМКНУЛ]' : ''}`;
        if (redecide && !took) {
          // оценки бота: шаг 1 (ход до конца своего хода, 12 лучших), шаг 2 (со вторым действием), ответ соперника
          const dbg = {};
          const v2 = makeView(s, s.toMove, settings.counting || 'approx', Math.random);
          v2.debug = (d) => Object.assign(dbg, d);
          const res = decide(v2, { strength: 100, errors: 0, style: 'universal', timeMs: Infinity, ...settings }, Math.random);
          const sq = new Set(squares.map((t) => JSON.stringify(t)));
          const where = (list, f) => {
            const i = (list || []).findIndex((c) => sq.has(JSON.stringify(c.m)));
            return i < 0 ? 'нет в списке' : `место ${i + 1}, ${(+list[i][f]).toFixed(2)} при лучшем ${(+list[0][f]).toFixed(2)}`;
          };
          line += `\n    бот сейчас: ${moveText(res.move, s)}; квадрат в шаге 1: ${where(dbg.step1, 'v')}; со вторым действием: ${where(dbg.deep, 'v2')}; после ответа соперника: ${where(dbg.replies, 'v3')}`;
        }
        lines.push(line);
      }
    }
    if (s.phase === 'action' && bots.has(s.toMove)) {
      const view = makeView(s, s.toMove, settings.counting || 'approx', Math.random);
      const ch = monumentChances(s, s.toMove, view);
      if (ch.length) {
        const took = ch.find((c) => JSON.stringify(c.m) === JSON.stringify(m));
        let line = `ход ${s.turn}.${s.actionNo} бот (игрок ${s.toMove}): сыграл ${moveText(m, s)}${took ? ' [К МОНУМЕНТУ]' : ''}; было можно: `
          + ch.slice(0, 4).map((c) => `${moveText(c.m, s)} +${c.gain}${c.revolt ? ` восстание ${c.pWin == null ? '?' : Math.round(100 * c.pWin) + '%'}` : ''}`).join(', ');
        if (redecide && !took) {
          let dbg = null;
          const v2 = makeView(s, s.toMove, settings.counting || 'approx', Math.random);
          v2.debug = (d) => { if (d.step1) dbg = d.step1; };
          const res = decide(v2, { strength: 100, errors: 0, style: 'universal', timeMs: Infinity, ...settings }, Math.random);
          const keyOf = (mm) => JSON.stringify(mm);
          const vals = (dbg || []).map((c) => ({ k: keyOf(c.m), v: c.v }));
          const best = vals[0];
          const opp = ch.map((c) => vals.find((x) => x.k === keyOf(c.m))).filter(Boolean)[0];
          line += ` | бот сейчас: ${moveText(res.move, s)} (${best ? best.v.toFixed(2) : '?'}); лучший к монументу ${opp ? opp.v.toFixed(2) : 'не в десятке'}`;
        }
        lines.push(line);
      }
    }
    s.log = [];
    applyMove(s, m, rng);
  }
  const total = pairsByTurn.map((a) => a.reduce((x, y) => x + y, 0));
  return { over: s.over, scores: s.players.map((pl) => pl.score.slice()), bots: [...bots], pairsByTurn, total, lines };
}

if ((process.argv[1] || '').endsWith('monument-review.js')) {
  const file = process.argv[2];
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const settings = { strength: +arg('--strength', 100), counting: arg('--counting', 'approx'), risk: +arg('--risk', 50) };
  const r = review(file, { redecide: process.argv.includes('--decide'), settings });
  console.log(`партия ${r.over ? 'доиграна до конца' : 'НЕ доиграна'}; боты: игроки ${r.bots.join(', ')}`);
  r.scores.forEach((sc, p) => console.log(`игрок ${p}${r.bots.includes(p) ? ' (бот)' : ''}: очки ${sc.join(',')}; пар «лидер+монумент» за свои ходы ${r.total[p]} (по ходам ${r.pairsByTurn[p].join('')})`));
  console.log(r.lines.join('\n'));
}
