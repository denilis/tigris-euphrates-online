// Правила катастроф: когда бот вообще может её бросить.
//
// Катастрофа очков не даёт; пока она в руке, она — угроза, и соперники
// осторожничают. Топ-20 BGA бросают 0,78 катастрофы за партию, первую после
// 64% партии, в 79% партий одна остаётся (разбор 116 партий, 22.10.2026).
// В живых партиях бот сжигал обе к 12-му ходу (935700491). Поэтому:
//
// 1. Защита — всегда, в том числе последней катастрофой: клетка, через которую
//    соперник следующим ходом объединит царства и выиграет войну, или клетка,
//    где он замкнёт квадрат 2x2 под монумент, выгодный ему больше, чем боту.
// 2. Атака — только с середины партии и никогда не выселяя своих лидеров.
//    Вторую катастрофу держать в запасе (до конца партии) — по настройке
//    reserve: в турнире запас стоил силы (13 побед из 32 против 16 из 32 без
//    него), поэтому по умолчанию выключен.
// 3. Атака должна дать выгоду в том же ходу: выселить лидера соперника, или
//    вторым действием начать свой конфликт или поставить лидера. И ход с
//    катастрофой должен быть заметно лучше лучшего хода без неё (это
//    проверяет bot.js после перебора: catastropheWorthIt).

import { applyMove, cloneState, components } from '../engine/engine.js';
import { geom, boxOf, BLUE, EMPTY, HAND_SIZE } from '../engine/constants.js';

export const CAT_MIDGAME = 0.45; // доля партии, раньше которой — только защита
export const CAT_ENDGAME = 0.85; // с этой доли последнюю катастрофу можно и атакой
export const CAT_MARGIN = 0; // атака должна быть лучшим ходом (перевес 0,5 сделал катастрофы почти невозможными и бот проигрывал)
export const CAT_MARGIN_LAST = 0.5; // последняя катастрофа в конце партии — с небольшим перевесом

// Для турниров: TIGRIS_CAT=nomid,nofollow выключает отдельные правила
// (в браузере переменных окружения нет — там всегда все правила).
const OFF = new Set(typeof process !== 'undefined' && process.env && process.env.TIGRIS_CAT ? process.env.TIGRIS_CAT.split(',') : []);
export const CAT_FOLLOW = !OFF.has('nofollow');

/** Доля сыгранной партии по мешку (0 — начало, 1 — мешок пуст). */
export function gameProgress(view) {
  const s = view.state;
  const initial = boxOf(s).reduce((a, b) => a + b, 0) - (s.startTemples || 10) - HAND_SIZE * s.np;
  const bag = view.bagTotal ?? (s.bag[0] + s.bag[1] + s.bag[2] + s.bag[3]);
  return Math.max(0, Math.min(1, 1 - bag / Math.max(1, initial)));
}

/** Сколько лидеров катастрофа на pos снимет с поля: у соперников и у себя. */
export function catastropheEvicts(s, me, pos) {
  const { N } = geom(s);
  const x = cloneState(s);
  const before = x.players.map((pl) => pl.leaders.filter((v) => v >= 0).length);
  try {
    applyMove(x, { type: 'catastrophe', pos }, () => 0.5);
  } catch (e) {
    return { opp: 0, own: 0 };
  }
  let opp = 0, own = 0;
  x.players.forEach((pl, q) => {
    const lost = before[q] - pl.leaders.filter((v) => v >= 0).length;
    if (q === me) own += lost;
    else opp += lost;
  });
  return { opp, own };
}

const tilesOf = (s, comps, lab, c) => {
  let n = 0;
  for (let i = 0; i < s.tile.length; i++) if (comps.lab[i] === lab && s.tile[i] === c) n++;
  return n;
};

/**
 * Защитная катастрофа на пустой клетке pos: 'union' — через неё соперник
 * объединит царства, и в войне он сильнее бота на поле с учётом руки бота;
 * 'monument' — она последняя в квадрате 2x2 одного цвета, а монумент там
 * выгоднее сопернику, чем боту. Иначе null.
 */
export function catastropheDefense(s, me, pos, comps = components(s)) {
  const { NB, W, H } = geom(s);
  if (s.tile[pos] !== EMPTY || s.leader[pos] >= 0) return null;
  // царства вокруг клетки и их лидеры
  const labs = [];
  for (const j of NB[pos]) {
    const l = comps.lab[j];
    if (l >= 0 && !labs.includes(l)) labs.push(l);
  }
  const leadersIn = (lab) => {
    const out = [];
    for (let p = 0; p < s.np; p++) for (let c = 0; c < 4; c++) {
      const at = s.players[p].leaders[c];
      if (at >= 0 && comps.lab[at] === lab) out.push({ p, c });
    }
    return out;
  };
  // 1. объединение: два царства, в одном мой лидер цвета c, в другом чужой того же цвета
  if (labs.length === 2) {
    const [a, b] = labs.map(leadersIn);
    for (const [mine, theirs, lm, lt] of [[a, b, labs[0], labs[1]], [b, a, labs[1], labs[0]]]) {
      for (const L of mine.filter((x) => x.p === me)) {
        const rival = theirs.find((x) => x.c === L.c && x.p !== me);
        if (!rival) continue;
        const myBoard = tilesOf(s, comps, lm, L.c);
        const theirBoard = tilesOf(s, comps, lt, L.c);
        // соперник кладёт тайл объединения и атакует: побеждает, если превысит
        // мои поле и руку хотя бы одним своим тайлом
        if (theirBoard + 1 > myBoard + s.players[me].hand[L.c]) return 'union';
      }
    }
  }
  // 2. монумент: pos — дыра в квадрате 2x2 из трёх тайлов одного цвета
  const free = s.monuments.filter((m) => m.pos < 0);
  if (!free.length) return null;
  const x = pos % W, y = (pos / W) | 0;
  for (let dy = -1; dy <= 0; dy++) {
    for (let dx = -1; dx <= 0; dx++) {
      const tx = x + dx, ty = y + dy;
      if (tx < 0 || ty < 0 || tx > W - 2 || ty > H - 2) continue;
      const tl = ty * W + tx;
      const cells = [tl, tl + 1, tl + W, tl + W + 1].filter((i) => i !== pos);
      const c = s.tile[cells[0]];
      if (c < 0 || c > 3 || !cells.every((i) => s.tile[i] === c)) continue;
      if ((c === BLUE) !== (s.river[pos] === 1)) continue;
      const colors = new Set([c]);
      for (const m of free) {
        if (m.c1 === c) colors.add(m.c2);
        if (m.c2 === c) colors.add(m.c1);
      }
      if (colors.size === 1) continue; // монумента с этим цветом не осталось
      const lab = comps.lab[cells[0]];
      let mineGain = 0, theirGain = 0;
      for (const L of leadersIn(lab)) {
        if (!colors.has(L.c)) continue;
        if (L.p === me) mineGain++;
        else theirGain++;
      }
      if (theirGain > mineGain) return 'monument';
    }
  }
  return null;
}

/**
 * Все защитные катастрофы позиции: пустые клетки, которые закрывают
 * выигрышное для соперника объединение или его монумент. Их нет среди
 * candidateActions (там катастрофы только на тайлы рядом с лидерами).
 */
export function defenseCatastrophes(s, me) {
  const { N, NB } = geom(s);
  if (s.players[me].cats <= 0) return [];
  const comps = components(s);
  const out = [];
  for (let pos = 0; pos < N; pos++) {
    if (s.tile[pos] !== EMPTY || s.leader[pos] >= 0) continue;
    // быстрый отсев: рядом хотя бы одна занятая клетка
    if (!NB[pos].some((j) => comps.lab[j] >= 0)) continue;
    const reason = catastropheDefense(s, me, pos, comps);
    if (reason) out.push({ pos, reason });
  }
  return out;
}

/**
 * Можно ли рассматривать катастрофу m до перебора. Возвращает
 * { ok, kind: 'defense' | 'offense', evicts } — offense ещё проверяется после
 * перебора на выгоду в том же ходу (catastropheWorthIt).
 */
export function catastropheRule(view, s, m, { reserve = false } = {}) {
  const me = s.cur;
  const defense = catastropheDefense(s, me, m.pos);
  if (defense) return { ok: true, kind: 'defense', reason: defense, evicts: { opp: 0, own: 0 } };
  const evicts = catastropheEvicts(s, me, m.pos);
  if (evicts.own > 0) return { ok: false, kind: 'offense', evicts };
  const progress = gameProgress(view);
  if (!OFF.has('nomid') && progress < CAT_MIDGAME) return { ok: false, kind: 'offense', evicts };
  const cats = s.players[me].cats;
  if (reserve && cats < 2 && progress < CAT_ENDGAME) return { ok: false, kind: 'offense', evicts };
  return { ok: true, kind: 'offense', evicts, last: cats < 2 };
}
