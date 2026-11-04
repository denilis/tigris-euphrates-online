// Проверка уроков ботом (просьба Дениса 04.11: «урок учит глупым вещам»). Для каждого хода
// ученика бот оценивает все разумные ходы в той же позиции, как в разборе партии, и печатает,
// насколько ход урока хуже лучшего и какие ходы лучше.
//   node tools/check-lessons.mjs [номер урока]
import { LESSONS } from '../lessons/index.js';
import { buildLesson, ME } from '../lessons/kit.js';
import { applyMove, cloneState } from '../public/vendor/engine/engine.js';
import { makeView, determinize } from '../public/vendor/bot/belief.js';
import { candidateActions } from '../public/vendor/bot/bot.js';
import { evaluate } from '../public/vendor/bot/evaluate.js';
import { settle } from '../public/vendor/bot/policy.js';
import { seededRng, moveText } from '../public/js/analysis-core.js';

const only = Number(process.argv[2]) || null;
const SHOW = process.argv.includes('--board');
const LET = 'rbgk';

/** Поле словами: ~ река, . суша, r/b/g/k тайл ($ сокровище), Rr мой лидер, Xr лидер соперника, ## катастрофа. */
function board(s) {
  const W = 16, H = 11, cols = 'ABCDEFGHIJKLMNOP';
  let out = '     ' + [...cols].map((c) => c.padEnd(3)).join('') + '\n';
  for (let y = 0; y < H; y++) {
    let row = String(y + 1).padStart(3) + '  ';
    for (let x = 0; x < W; x++) {
      const i = y * W + x, t = s.tile[i], l = s.leader[i];
      let c = s.river[i] ? '~  ' : '.  ';
      if (t >= 0 && t <= 3) c = LET[t] + (s.treasure[i] ? '$ ' : '  ');
      else if (t === 6) c = '## ';
      else if (t === 4) c = 'M  ';
      if (l >= 0) c = ((l >> 2) === 0 ? 'R' : 'X') + LET[l & 3] + ' ';
      row += c;
    }
    out += row + '\n';
  }
  const hand = (p) => s.players[p].hand.map((n, c) => LET[c].repeat(n)).join('');
  out += `рука ученика ${hand(0)}, счет ${s.players[0].score.join('/')}; соперник ${hand(1)}, счет ${s.players[1].score.join('/')}`;
  return out;
}
const DETS = 12;
const canon = (m) => JSON.stringify(m, Object.keys(m).sort());

function values(s, p) {
  const rng = seededRng({ rng: 12345 });
  const view = makeView(s, p, 'exact', rng);
  const ds = Array.from({ length: DETS }, () => determinize(view, rng));
  return (m) => {
    let sum = 0, n = 0;
    for (const d of ds) {
      const x = cloneState(d);
      try { applyMove(x, m, rng); settle(x, rng); sum += evaluate(x, p); n++; } catch { /* ход невозможен в этом раскладе */ }
    }
    return n ? sum / n : -Infinity;
  };
}

for (const def of LESSONS) {
  if (only && def.id !== only) continue;
  console.log(`\n=== Урок ${def.id}. ${def.title}`);
  buildLesson(def, {
    onMove(s, seat, move, k) {
      if (seat !== ME) return;
      const step = def.steps[k];
      if (SHOW) console.log(board(s));
      const val = values(s, ME);
      const cands = candidateActions(s);
      if (!cands.some((m) => canon(m) === canon(move))) cands.push(move);
      const scored = cands.map((m) => ({ m, v: val(m) })).filter((x) => Number.isFinite(x.v)).sort((a, b) => b.v - a.v);
      // бот ценит выставленных лидеров самих по себе, поэтому сравниваем с ходами того же вида:
      // тайл с тайлами, лидера с лидерами. Так видно, верный ли тайл и верное ли место
      const same = scored.filter((x) => x.m.type === move.type);
      const mine = same.find((x) => canon(x.m) === canon(move));
      const rank = same.indexOf(mine) + 1;
      const loss = same[0].v - mine.v;
      const flag = loss >= 1 ? '  <<< СЛАБЫЙ ХОД' : loss >= 0.4 ? '  < неточно' : '';
      console.log(`шаг ${k + 1} «${step.title}»: ${moveText(move)}; среди ходов того же вида ${rank} из ${same.length}, потеря ${loss.toFixed(2)}${flag}`);
      for (const x of same.slice(0, 4)) console.log(`    ${x.v.toFixed(2)}  ${moveText(x.m)}${canon(x.m) === canon(move) ? '  (урок)' : ''}`);
      if (rank > 4) console.log(`    ${mine.v.toFixed(2)}  ${moveText(mine.m)}  (урок)`);
    },
  });
}
