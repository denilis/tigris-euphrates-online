// Оценка позиции для бота.
//
// Сила игрока = очки (с упором на слабейший цвет, ведь побеждает минимум)
// + позиционный задел: лидеры на поле, их опора в королевстве, монументы,
// сокровища. Задел важнее в начале партии и почти ничего не стоит в конце.
// Итог для бота = его сила минус сила самых опасных соперников.
//
// Оценка идёт в два шага: positionRecord() снимает с позиции числа-признаки
// (не зависят от весов), recordValue() складывает их с весами. Так обучение
// на партиях (sim/train.js) один раз считает признаки и потом быстро
// перебирает веса, а бот в игре проходит тот же путь.

import { components, finalVector, templeCount } from '../engine/engine.js';
import { N, NB, W, H, RED, BLUE, GREEN, BLACK, EMPTY, HAND_SIZE } from '../engine/constants.js';

export const DEFAULT_WEIGHTS = {
  lowest: [1.0, 0.45, 0.2, 0.1], // вес отсортированных очков, от слабейшего цвета
  // Будущие очки по цветам (за свой оставшийся ход), идут в прогноз счёта:
  prodRate: 0.15, // лидер на поле приносит очки своего цвета, пока королевство растёт
  monRate: 0.5, // монумент приносит 1 очко за ход каждому подходящему лидеру; скидка на риск
  kingRate: 0.05, // царь собирает очки за цвета, чьих лидеров в королевстве нет
  wonderRate: 0.4, // чудо: очко на выбор, если царь в его королевстве
  traderTreasure: 0.25, // у торговца одно сокровище в королевстве: шанс забрать
  // Сила позиции (не очки):
  onBoard: 0.5, // лидер стоит на поле
  offBoard: 0.3, // лидер в запасе: вернуть его стоит всего одно действие
  support: 0.12, // тайл своего цвета в королевстве (сила в войне), до 8
  temple: 0.25, // соседний храм (сила в восстании), до 3
  catastrophe: 1.0, // катастрофа в запасе в начале партии; к концу дешевеет
  handTile: 0.05, // тайл в руке
  handRed: 0.1, // храм в руке сверх того: защита в восстании
  exposed: 0.5, // лидер рядом с более сильным соперником того же цвета
  revoltHole: 0.35, // пустая клетка у двух храмов рядом с королевством: приглашение к восстанию
  // Признаки из разбора партий (по умолчанию выключены, веса даёт обучение):
  monPrep: 0, // заготовка монумента: 3 тайла цвета из 4 в квадрате, где стоит свой лидер
  handSupport: 0, // тайлы в руке под цвет своих лидеров на поле (до 3 на цвет): запас на войну
  cohesion: 2, // пара своих лидеров в одном королевстве (дебют «царь + торговец»); 2 — турнир 25.10.2026: 39% побед против 42% без признака, дебют как у людей
  attack: 0, // свой лидер рядом с более слабым лидером соперника того же цвета: шанс войны
  // Вкус к типам ходов (прибавка к ценности хода, не к оценке позиции); у
  // каждого стиля свой: кто чаще воюет, кто копит очки, кто строит монументы.
  bTilePoint: 0, // тайл, который сразу приносит очко
  bWar: 0, // тайл, который объединяет королевства и начинает войну
  bMonument: 0, // тайл, после которого можно построить монумент
  bLeaderNew: 0, // лидер из запаса на поле (без восстания)
  bRevolt: 0, // лидер, который начинает восстание
  bCatastrophe: 0, // катастрофа
  bPass: 0, // пас
  oppMax: 0.6, // вес сильнейшего соперника
  oppMean: 0.4, // вес среднего соперника
};

/**
 * Прогноз итогового счёта: очки плюс ожидаемые будущие очки по цветам,
 * сокровища и очки на выбор (дробные) доливаются в слабейшие цвета.
 * Возвращает вектор по возрастанию, как finalVector.
 */
export function projectedVector(score, future, wild) {
  const v = score.map((x, c) => x + future[c]).sort((a, b) => a - b);
  let left = wild;
  for (let k = 0; k < 4 && left > 1e-9; k++) {
    // поднять первые k+1 значений до следующего уровня
    const next = k < 3 ? v[k + 1] : Infinity;
    const need = (next - v[k]) * (k + 1);
    if (need >= left) {
      const add = left / (k + 1);
      for (let j = 0; j <= k; j++) v[j] = v[k] + add;
      left = 0;
    } else {
      for (let j = 0; j <= k; j++) v[j] = next;
      left -= need;
    }
  }
  return v;
}

function kingdomInfo(s, comps) {
  const info = Array.from({ length: comps.n }, () => ({
    tiles: [0, 0, 0, 0], size: 0, treasures: 0, monuments: [], leaders: [], wonder: false,
  }));
  for (let i = 0; i < N; i++) {
    const l = comps.lab[i];
    if (l < 0) continue;
    const k = info[l];
    const t = s.tile[i];
    if (t >= 0 && t <= 3) { k.tiles[t]++; k.size++; }
    if (s.treasure[i]) k.treasures++;
    if (s.monument[i] >= 0 && !k.monuments.includes(s.monument[i])) k.monuments.push(s.monument[i]);
    if (t === 5) k.wonder = true;
  }
  for (let p = 0; p < s.np; p++) {
    for (let c = 0; c < 4; c++) {
      const pos = s.players[p].leaders[c];
      if (pos >= 0) info[comps.lab[pos]].leaders.push({ p, c, pos });
    }
  }
  return info;
}

/** Примерно сколько своих ходов осталось каждому игроку. */
export function turnsLeft(s) {
  const bag = s.bag[0] + s.bag[1] + s.bag[2] + s.bag[3];
  let treasures = 0;
  for (let i = 0; i < N; i++) treasures += s.treasure[i];
  const byBag = bag / (s.np * 2.2);
  return Math.max(0, Math.min(byBag, treasures <= 3 ? 3 : 40));
}

// --- Признаки позиции

// Ячейки записи игрока: общие, затем по 8 на каждый цвет лидера.
const P_SCORE = 0; // 4 ячейки
const P_TREASURES = 4;
const P_CATS = 5;
const P_HAND = 6;
const P_HAND_RED = 7;
const P_MON_PREP = 8;
const P_HAND_SUP = 9;
const P_COHESION = 10;
const P_KING_MISS = 11; // 3 ячейки: нет лидера красного, синего, зелёного в королевстве царя
const P_KING_WONDER = 14;
const P_TRADER_ONE = 15;
const P_LEADERS = 16;
const L_ON = 0, L_SIZE = 1, L_MON = 2, L_SUP = 3, L_TEM = 4, L_EXP = 5, L_HOLE = 6, L_ATT = 7;
const L_STRIDE = 8;
export const PLAYER_SLOTS = P_LEADERS + 4 * L_STRIDE;
const SIZE_CAP = 2.5; // множитель роста царства: 1 на 9 тайлах, 2,5 на 32 и больше

/** Квадраты 2x2 с тремя тайлами одного цвета и пустой четвёртой клеткой, куда этот цвет можно положить. */
function monumentPreps(s, comps) {
  const free = [];
  for (const m of s.monuments) if (m.pos < 0) free.push(m);
  if (!free.length) return [];
  const out = [];
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const tl = y * W + x;
      const cells = [tl, tl + 1, tl + W, tl + W + 1];
      let color = -1, n = 0, hole = -1, bad = false;
      for (const i of cells) {
        const t = s.tile[i];
        if (t === EMPTY && s.leader[i] < 0) {
          if (hole >= 0) { bad = true; break; }
          hole = i;
        } else if (t >= 0 && t <= 3 && (color < 0 || color === t)) {
          color = t;
          n++;
        } else { bad = true; break; }
      }
      if (bad || n !== 3 || hole < 0) continue;
      if ((color === BLUE) !== (s.river[hole] === 1)) continue;
      const pair = [];
      for (const m of free) {
        if (m.c1 === color) pair.push(m.c2);
        else if (m.c2 === color) pair.push(m.c1);
      }
      if (!pair.length) continue;
      const lab = comps.lab[cells.find((i) => i !== hole)];
      out.push({ color, pair, lab });
    }
  }
  return out;
}

/** Пустые клетки суши у двух и более храмов и королевства, к которым они примыкают. */
function revoltHoles(s, comps) {
  const out = [];
  for (let e = 0; e < N; e++) {
    if (s.tile[e] !== -1 || s.leader[e] >= 0 || s.river[e]) continue;
    const temples = templeCount(s, e);
    if (temples < 2) continue;
    const labs = [];
    for (const f of NB[e]) {
      const l = comps.lab[f];
      if (l >= 0 && !labs.includes(l)) labs.push(l);
    }
    // лидер не может объединить два королевства: такая клетка не дыра
    if (labs.length === 1) out.push({ cell: e, temples, labs });
  }
  return out;
}

/** Для каждой группы — группы, до которых одна пустая клетка. */
function nearGroups(s, comps) {
  const near = Array.from({ length: comps.n }, () => new Set());
  for (let e = 0; e < N; e++) {
    if (s.tile[e] !== -1 || s.leader[e] >= 0) continue;
    const ls = [];
    for (const f of NB[e]) {
      const l = comps.lab[f];
      if (l >= 0 && !ls.includes(l)) ls.push(l);
    }
    for (const a of ls) for (const b of ls) if (a !== b) near[a].add(b);
  }
  return near;
}

/**
 * Числа, из которых складывается оценка: на игрока — очки, рука, катастрофы и
 * по каждому лидеру его королевство, опора, угрозы. Не зависят от весов.
 */
export function positionRecord(s) {
  const comps = components(s);
  const info = kingdomInfo(s, comps);
  const near = nearGroups(s, comps);
  const holes = revoltHoles(s, comps);
  const preps = monumentPreps(s, comps);
  const monById = new Map(s.monuments.map((m) => [m.id, m]));
  const rec = { np: s.np, turns: turnsLeft(s), over: s.over, finals: null, players: [] };
  if (s.over) rec.finals = s.players.map((pl) => finalVector(pl));
  for (let q = 0; q < s.np; q++) {
    const pl = s.players[q];
    const r = new Float64Array(PLAYER_SLOTS);
    for (let c = 0; c < 4; c++) r[P_SCORE + c] = pl.score[c];
    r[P_TREASURES] = pl.treasures;
    r[P_CATS] = pl.cats;
    r[P_HAND] = Math.min(pl.hand[0] + pl.hand[1] + pl.hand[2] + pl.hand[3], HAND_SIZE);
    r[P_HAND_RED] = Math.min(pl.hand[RED], 3);
    // Сплочённость: есть ли пара своих лидеров в одном царстве (0 или 1).
    // Топ-20 BGA ставят первых двух лидеров в первый ход в одно царство в 97%
    // партий; бот без этого признака разбрасывал их по карте (вместе 0-13%,
    // разбор 25.10.2026). Счёт всех лидеров вместе (лидеров минус царств)
    // с весом 0,5-1 стоил силы: 29% побед вместо 42%.
    const ownLabs = new Set();
    let ownOn = 0;
    for (let c = 0; c < 4; c++) {
      if (pl.leaders[c] < 0) continue;
      ownOn++;
      ownLabs.add(comps.lab[pl.leaders[c]]);
    }
    r[P_COHESION] = Math.min(1, ownOn - ownLabs.size);
    let prep = 0;
    for (const pr of preps) {
      if (pl.leaders[pr.color] >= 0 && comps.lab[pl.leaders[pr.color]] === pr.lab) prep += 1;
      else if (pr.pair.some((c2) => pl.leaders[c2] >= 0 && comps.lab[pl.leaders[c2]] === pr.lab)) prep += 0.5;
    }
    r[P_MON_PREP] = Math.min(prep, 2);
    for (let c = 0; c < 4; c++) {
      const at = pl.leaders[c];
      if (at < 0) continue;
      const lab = comps.lab[at];
      const k = info[lab];
      const o = P_LEADERS + c * L_STRIDE;
      r[o + L_ON] = 1;
      // Чем больше царство, тем больше тайлов в него ляжет и тем больше очков
      // получит лидер. Раньше рост обрывался на 9 тайлах, и царство из 40
      // тайлов стоило столько же, сколько свой уголок (партия 935700491).
      r[o + L_SIZE] = Math.min(SIZE_CAP, 0.4 + k.size / 15);
      let mons = 0;
      for (const id of k.monuments) {
        const m = monById.get(id);
        if (m && (m.c1 === c || m.c2 === c)) mons++;
      }
      r[o + L_MON] = mons;
      r[o + L_SUP] = Math.min(k.tiles[c], 8);
      const mine = templeCount(s, at);
      r[o + L_TEM] = Math.min(mine, 3);
      // соперник того же цвета через одну пустую клетку: кто сильнее, тот угрожает войной
      let worst = 0, best = 0;
      for (const ol of near[lab]) {
        const other = info[ol].leaders.find((l) => l.c === c && l.p !== q);
        if (!other) continue;
        const diff = info[ol].tiles[c] - k.tiles[c];
        if (diff > worst) worst = diff;
        if (-diff > best) best = -diff;
      }
      r[o + L_EXP] = Math.min(worst, 4) / 2;
      r[o + L_ATT] = Math.min(best, 4) / 2;
      // Угроза восстания: пустая клетка у двух и более храмов рядом с королевством.
      // Ничья за защитником, поэтому угроза = храмы у дыры - храмы у лидера + 1.
      let hole = 0;
      for (const h of holes) {
        if (!h.labs.includes(lab)) continue;
        const tt = h.temples - mine + 1;
        if (tt > hole) hole = tt;
      }
      r[o + L_HOLE] = Math.min(hole, 2);
      r[P_HAND_SUP] += Math.min(pl.hand[c], 3);
      if (c === BLACK) {
        for (let cc = 0; cc < 3; cc++) if (!k.leaders.some((l) => l.c === cc)) r[P_KING_MISS + cc] = 1;
        if (k.wonder) r[P_KING_WONDER] = 1;
      }
      if (c === GREEN && k.treasures === 1) r[P_TRADER_ONE] = 1;
    }
    rec.players.push(r);
  }
  return rec;
}

// --- Сложение признаков с весами

/** Сила игрока q по записи позиции. */
export function strengthOf(rec, q, w, ignoreThreats = false) {
  return strengthAt(rec.players[q], 0, rec.turns, w, ignoreThreats);
}

/**
 * Сила игрока по его признакам r[b .. b + PLAYER_SLOTS). Отдельно от записи,
 * чтобы обучение держало признаки всех позиций в одном плоском массиве.
 */
export function strengthAt(r, b, turns, w, ignoreThreats = false) {
  const future = [0, 0, 0, 0];
  let wild = r[b + P_TREASURES];
  let pos = 0;
  for (let c = 0; c < 4; c++) {
    const o = b + P_LEADERS + c * L_STRIDE;
    if (!r[o + L_ON]) {
      pos += w.offBoard;
      continue;
    }
    // будущие очки этого цвета: королевство растёт, монументы платят каждый ход
    future[c] += w.prodRate * turns * r[o + L_SIZE] + w.monRate * turns * r[o + L_MON];
    if (c === BLACK) {
      for (let cc = 0; cc < 3; cc++) if (r[b + P_KING_MISS + cc]) future[cc] += w.kingRate * turns;
      if (r[b + P_KING_WONDER]) wild += w.wonderRate * turns;
    }
    if (c === GREEN && r[b + P_TRADER_ONE]) wild += w.traderTreasure;
    // сила позиции: опора в конфликтах
    pos += w.onBoard + w.support * r[o + L_SUP] + w.temple * r[o + L_TEM] + w.attack * r[o + L_ATT];
    if (!ignoreThreats) pos -= w.exposed * r[o + L_EXP] + w.revoltHole * r[o + L_HOLE];
  }
  // катастрофа в запасе ценна, пока впереди много ходов
  pos += w.catastrophe * r[b + P_CATS] * (0.25 + 0.75 * Math.min(1, turns / 8));
  pos += w.handTile * r[b + P_HAND] + w.handRed * r[b + P_HAND_RED];
  pos += w.monPrep * r[b + P_MON_PREP] + w.handSupport * r[b + P_HAND_SUP] + w.cohesion * r[b + P_COHESION];

  // прогноз счёта оценивается как подсчёт BGA: решает слабейший цвет
  const v = projectedVector([r[b], r[b + 1], r[b + 2], r[b + 3]], future, wild);
  let score = 0;
  for (let k = 0; k < 4; k++) score += w.lowest[k] * v[k];
  const early = Math.min(1, turns / 12);
  return score + (0.35 + 0.65 * early) * pos;
}

/** Оценка записи позиции глазами игрока p. */
export function recordValue(rec, p, w = DEFAULT_WEIGHTS, opts = {}) {
  const ignore = !!opts.ignoreThreats;
  if (rec.over) {
    // конец игры: важно только место
    const mine = rec.finals[p];
    let best = -Infinity;
    for (let q = 0; q < rec.np; q++) {
      if (q === p) continue;
      const d = cmp(mine, rec.finals[q]);
      if (d > best) best = d;
    }
    return 100 * Math.sign(-best) + strengthOf(rec, p, w, ignore) * 0.01;
  }
  let max = -Infinity, sum = 0, n = 0, mineS = 0;
  for (let q = 0; q < rec.np; q++) {
    const st = strengthOf(rec, q, w, ignore);
    if (q === p) {
      mineS = st;
      continue;
    }
    if (st > max) max = st;
    sum += st;
    n++;
  }
  const oppW = opts.oppWeight ?? 1;
  return mineS - oppW * (w.oppMax * max + w.oppMean * (sum / n));
}

/** Оценка позиции глазами игрока p. opts: { weights, ignoreThreats, oppWeight }. */
export function evaluate(s, p, opts = {}) {
  return recordValue(positionRecord(s), p, opts.weights || DEFAULT_WEIGHTS, opts);
}

// сравнение векторов «у соперника лучше» > 0
function cmp(a, b) {
  for (let k = 0; k < 4; k++) if (a[k] !== b[k]) return b[k] - a[k];
  return 0;
}
