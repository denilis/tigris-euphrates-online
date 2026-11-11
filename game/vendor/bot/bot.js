// Бот: выбор хода с учётом настроек характера.
//
// Настройки:
//   strength 0..100 — сколько вариантов перебирает и насколько точно оценивает;
//   counting 'none' | 'approx' | 'exact' — как считает вышедшие тайлы;
//   risk 0..100 — 0 осторожный, 100 азартный;
//   errors 0..30 — вероятность человеческой ошибки на решении, %;
//   style — стиль игры (bot/styles.js): веса оценки, подобранные по партиям
//     игрока или группы игроков; 'mix' — смесь стилей по долям mixTop и др.
//
// decide(view, settings, rng) возвращает { move, text, error, ms } сразу.
// decideAsync(...) считает то же самое кусками по ~12 мс и отдаёт управление
// странице между кусками, чтобы перебор не замораживал интерфейс BGA.
// Оба варианта используют один генератор и дают одинаковый результат.

import { legalMoves, applyMove, cloneState, monumentOptions, components } from '../engine/engine.js';
import { geom, RED } from '../engine/constants.js';
import { determinize, probAtLeast } from './belief.js';
import { evaluate, positionRecord, recordValue } from './evaluate.js';
import { settle, treasureExposure } from './policy.js';

// цена открытого храма при выборе сокровища: только порядок выбора, позиции после взятия равны
const TREASURE_EXPOSE = 0.3;
import { styleParams } from './styles.js';
import { describeMove, COLOR_NAME, COLOR_ADJ } from './explain.js';
import { catastropheRule, defenseCatastrophes, CAT_MARGIN, CAT_MARGIN_LAST, CAT_FOLLOW } from './catastrophe.js';
import { mctsSearch } from './ismcts.js';

export const DEFAULT_SETTINGS = { strength: 50, counting: 'none', risk: 50, errors: 5, style: 'base' };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// Длина куска вычислений между паузами в асинхронном режиме.
const SLICE_MS = 12;
// Доля бюджета времени на первый шаг перебора (все кандидаты по отдельности).
const FIRST_STEP_SHARE = 0.5;

export function params(settings) {
  const st = clamp(settings.strength ?? 50, 0, 100) / 100;
  const risk = clamp(settings.risk ?? 50, 0, 100);
  const style = styleParams(settings);
  return {
    // settings.weights — веса поверх стиля (подбор весов в самоигре, sim/tune.js)
    weights: settings.weights ? { ...style.weights, ...settings.weights } : style.weights,
    // Сколько вариантов чужих рук и мешка проигрывать. Двух мало: случайно
    // удачная пара делает шумный ход (сброс, рискованный конфликт) лучшим.
    dets: st < 0.2 ? 1 : st < 0.45 ? 2 : st < 0.7 ? 4 : 6,
    topK: Math.round(2 + 12 * st),
    // Шум оценки делает слабого бота слабее. Раньше (1 - st) * 0.9 давал 0,45
    // при силе 50: больше разницы между разумными ходами, и выбор был почти
    // случайным. Теперь шум мал по сравнению с ценой хода.
    noise: (1 - st) * 0.12,
    // settings.timeMs — потолок времени снаружи (сервер своего стола экономит
    // CPU; Infinity убирает зависимость от часов, решение повторяется при том же rng)
    timeMs: settings.timeMs ?? 400 + 7000 * st,
    // Сколько лучших ходов проверять ответом соперника (его лучший следующий
    // ход по той же оценке). Без этого бот не видит, что оставляет сопернику
    // выгодное объединение царств (партия 935700491, ходы 29 и 31).
    replyK: st < 0.3 || settings.reply === false || settings.reply === 'false' ? 0 : Math.round(2 + 4 * st),
    // Глубина ответа: сколько действий соперников доигрывается после своего
    // хода (1 — первое действие следующего игрока, 2 — его ход целиком,
    // 2 * (игроков - 1) — круг до своего следующего хода).
    replyDepth: clamp(Math.round(settings.depth ?? 1), 1, 6),
    // Поиск по дереву (bot/ismcts.js) вместо перебора в три шага: search: 'mcts'.
    // mctsH — глубина дерева в действиях, mctsC — смелость перебора новых
    // ходов, mctsW — как быстро растёт ширина узла, mctsIters — потолок проходов.
    mcts: settings.search === 'mcts',
    mctsH: clamp(Math.round(settings.mctsH ?? 4), 1, 12),
    mctsC: settings.mctsC ?? 0.5,
    mctsW: settings.mctsW ?? 1,
    mctsIters: settings.mctsIters ?? 1e9,
    rho: (risk - 50) / 100, // вес разброса исходов: азартный любит разброс
    gamma: 2 ** ((50 - risk) / 50), // восприятие шанса: осторожный занижает
    errorRate: clamp(settings.errors ?? 5, 0, 30) / 100,
    // Порог шанса победы, чтобы самому начать конфликт (ТЗ: осторожный от 80%,
    // азартный от 35-40%).
    attackThreshold: 0.8 - 0.45 * (risk / 100),
    // Вторую катастрофу держать в запасе до конца партии (галочка в панели).
    catReserve: settings.catReserve === true || settings.catReserve === 'true',
    // Перестановка лидера, уже стоящего на поле, и снятие лидера тратят
    // действие и ничего не строят: такой ход должен быть заметно лучше.
    // Цену берёт из стиля (у базового 0,6).
    relocate: settings.relocate ?? style.relocate,
    // Доля цены перестановки с целью (к монументу цвета лидера или к опоре,
    // relocationPurpose): такие перестановки делают люди, и цена их не должна душить.
    relocPurpose: settings.relocPurpose ?? 0.25,
    // Сброс: самое слабое действие у сильных игроков (0,3-0,5 за партию).
    discard: settings.discardCost ?? style.discard,
  };
}

function gauss(rng) {
  const u = Math.max(1e-9, rng()), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function aggregate(vals, rho) {
  const n = vals.length;
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  if (n < 2 || !rho) return mean;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return mean + rho * sd;
}

/**
 * Точка возможной паузы: уступает управление, если кусок длится дольше
 * SLICE_MS. Время паузы копится в clock.paused и не идёт в бюджет перебора:
 * на скрытой вкладке браузер будит таймеры раз в секунду и реже, и без этого
 * бот тратил бы бюджет на сон и думал бы слабее.
 */
function* pause(clock) {
  if (now() - clock.last > SLICE_MS) {
    const t = now();
    yield;
    clock.paused += now() - t;
    clock.last = now();
  }
}

/** Сколько миллисекунд бот реально считал (без пауз). */
const busy = (clock) => now() - clock.start - clock.paused;

// ---------------------------------------------------------------------------

export function* decideGen(view, settings = DEFAULT_SETTINGS, rng = Math.random) {
  const t0 = now();
  const P = params(settings);
  const clock = { start: t0, last: t0, paused: 0 };
  const s = view.state;
  let res;
  switch (s.phase) {
    case 'action':
      res = yield* decideAction(view, P, rng, clock);
      break;
    case 'revoltSupport':
    case 'warSupport':
      res = yield* decideSupport(view, P, rng, clock);
      break;
    default:
      res = yield* decideByEval(view, P, rng, clock);
  }
  res.ms = Math.round(now() - t0);
  return res;
}

/** Синхронное решение (симуляции, турниры, тесты). */
export function decide(view, settings = DEFAULT_SETTINGS, rng = Math.random) {
  const gen = decideGen(view, settings, rng);
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}

/**
 * Решение кусками: между кусками управление отдаётся через defer
 * (на странице это setTimeout), поэтому страница не замирает.
 */
export function decideAsync(view, settings = DEFAULT_SETTINGS, rng = Math.random, defer = (f) => setTimeout(f, 0)) {
  return new Promise((resolve, reject) => {
    const gen = decideGen(view, settings, rng);
    const step = () => {
      let r;
      try {
        r = gen.next();
      } catch (e) {
        reject(e);
        return;
      }
      if (r.done) resolve(r.value);
      else defer(step);
    };
    step();
  });
}

// --- Обычный ход: два действия, перебор с отсечением

/** Отобранные кандидаты действия (полный список слишком длинный и почти весь бессмыслен). */
export function candidateActions(s) {
  const { N, NB } = geom(s);
  const all = legalMoves(s);
  const nearOcc = new Uint8Array(N);
  const nearLeader = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const t = s.tile[i];
    const occ = (t >= 0 && t <= 5) || s.leader[i] >= 0;
    if (!occ) continue;
    for (const j of NB[i]) nearOcc[j] = 1;
    if (s.leader[i] >= 0) {
      nearLeader[i] = 1;
      for (const j of NB[i]) { nearLeader[j] = 1; for (const k of NB[j]) nearLeader[k] = 1; }
    }
  }
  const hand = s.players[s.toMove].hand;
  const discards = new Set();
  const out = [];
  for (const m of all) {
    switch (m.type) {
      case 'tile':
        if (nearOcc[m.pos]) out.push(m);
        break;
      case 'catastrophe':
        if (nearLeader[m.pos] && s.tile[m.pos] >= 0) out.push(m);
        break;
      case 'discard': {
        const key = m.counts.join(',');
        const full = m.counts.every((n, c) => n === hand[c]);
        const oneColor = m.counts.filter((n) => n > 0).length === 1 && m.counts.some((n, c) => n === hand[c] && n >= 2);
        const keepRed = m.counts[RED] === 0 && m.counts.every((n, c) => c === RED || n === hand[c]);
        if ((full || oneColor || keepRed) && !discards.has(key)) {
          discards.add(key);
          out.push(m);
        }
        break;
      }
      default:
        out.push(m);
    }
  }
  return out;
}

const fixedRng = () => 0.5;

/**
 * Конфликт, который начнёт ход m (восстание или война, где ходящий атакует),
 * и шанс его выиграть: атакующий выкладывает все свои тайлы нужного цвета,
 * защитник побеждает, если у него хватит тайлов на ничью. Руку защитника бот
 * не видит и берёт вероятность из своих представлений о мешке (belief).
 * Объединение может начать несколько войн: pWin — худшая из них, best —
 * лучшая, wars — все шансы. null, если ход конфликта не начинает или ходящий
 * в нём не атакует.
 */
export function conflictOdds(view, s, m) {
  if (m.type !== 'leader' && m.type !== 'tile') return null;
  const me = s.cur;
  const s1 = cloneState(s);
  try {
    applyMove(s1, m, fixedRng);
  } catch (e) {
    return null;
  }
  const fights = [];
  if (s1.phase === 'revoltSupport') fights.push({ k: s1.ctx.revolt, color: RED, kind: 'revolt', st: s1 });
  else if (s1.phase === 'warSupport') fights.push({ k: s1.ctx.war, color: s1.ctx.war.color, kind: 'war', st: s1 });
  else if (s1.phase === 'warChoose') {
    for (const color of s1.ctx.warColors) {
      const s2 = cloneState(s1);
      applyMove(s2, { type: 'warColor', color }, fixedRng);
      if (s2.phase === 'warSupport') fights.push({ k: s2.ctx.war, color, kind: 'war', st: s2 });
    }
  } else return null;
  let worst = null;
  const wars = [];
  for (const f of fights) {
    if (f.k.att !== me) continue;
    const margin = f.k.attBoard + f.st.players[me].hand[f.color] - f.k.defBoard;
    const pWin = margin <= 0 ? 0 : 1 - probAtLeast(view, view.handCounts[f.k.def], f.color, margin);
    wars.push({ color: f.color, pWin });
    if (!worst || pWin < worst.pWin) worst = { kind: f.kind, color: f.color, pWin };
  }
  if (worst) {
    worst.wars = wars;
    worst.best = Math.max(...wars.map((w) => w.pWin));
  }
  return worst;
}

/**
 * Кандидаты, которые бот готов играть: отобранные candidateActions без
 * конфликтов с шансом ниже порога. Если объединение начинает несколько войн,
 * отсев по лучшей из них: проиграть одну войну из трёх может быть выгодно, и
 * такой ход решает полная оценка исходов, а не худшая война.
 * Если отсеялось всё, остаётся полный список.
 */
export function playableActions(view, s, P, odds, catInfo) {
  const cands = candidateActions(s);
  const ok = [];
  for (const m of cands) {
    // катастрофы — по правилам bot/catastrophe.js; вторым действием атака
    // имеет смысл, только если сама выселяет лидера соперника
    if (m.type === 'catastrophe') {
      const rule = catastropheRule(view, s, m, { reserve: P.catReserve });
      if (!rule.ok) continue;
      if (CAT_FOLLOW && rule.kind === 'offense' && s.actionNo === 2 && rule.evicts.opp === 0) continue;
      if (catInfo) catInfo.set(m, rule);
      ok.push(m);
      continue;
    }
    const c = conflictOdds(view, s, m);
    if (c && odds) odds.set(m, c);
    const p = c ? (c.wars.length > 1 ? c.best : c.pWin) : 1;
    if (p >= P.attackThreshold) ok.push(m);
  }
  // защитные катастрофы на пустые клетки: закрыть объединение или чужой монумент
  if (s.phase === 'action') {
    for (const d of defenseCatastrophes(s, s.cur)) {
      const m = { type: 'catastrophe', pos: d.pos };
      if (catInfo) catInfo.set(m, { ok: true, kind: 'defense', reason: d.reason, evicts: { opp: 0, own: 0 } });
      ok.push(m);
    }
  }
  return ok.length ? ok : cands;
}

// Типы хода для цены и «вкуса» стиля (флаги складываются).
export const F_RELOCATE = 1, F_DISCARD = 2, F_TILE_POINT = 4, F_WAR = 8, F_MONUMENT = 16;
export const F_LEADER_NEW = 32, F_REVOLT = 64, F_CATASTROPHE = 128, F_PASS = 256;
export const F_PURPOSE = 512; // перестановка с целью, см. relocationPurpose
const BIASES = [[F_TILE_POINT, 'bTilePoint'], [F_WAR, 'bWar'], [F_MONUMENT, 'bMonument'], [F_LEADER_NEW, 'bLeaderNew'],
  [F_REVOLT, 'bRevolt'], [F_CATASTROPHE, 'bCatastrophe'], [F_PASS, 'bPass']];
const sum4 = (a) => a[0] + a[1] + a[2] + a[3];

/**
 * Перестановка с целью: лидер уходит в царство, где стоит монумент его цвета
 * (обычно восстанием против чужого лидера), или к опоре — там не меньше 4
 * тайлов его цвета, на 2 больше, чем там, откуда он уходит, и нет лидера этого
 * цвета (с такой опорой выигрываются внешние войны). Топ-20 BGA переставляют
 * лидеров 0,8 раза за партию, Денис 1,1, бот — 0,25; к монументу перестановкой
 * бот почти не ходил (разбор 25.10.2026, sim/relocations.js).
 */
export function relocationPurpose(s, m) {
  const { N, NB } = geom(s);
  if (m.type !== 'leader') return false;
  const from = s.players[s.cur].leaders[m.color];
  if (from < 0) return false;
  const comps = components(s);
  const labs = new Set();
  for (const j of NB[m.pos]) if (comps.lab[j] >= 0 && comps.lab[j] !== comps.lab[from]) labs.add(comps.lab[j]);
  if (!labs.size) return false;
  if (s.monuments.some((x) => x.pos >= 0 && labs.has(comps.lab[x.pos]) && (x.c1 === m.color || x.c2 === m.color))) return true;
  for (let q = 0; q < s.np; q++) {
    const at = s.players[q].leaders[m.color];
    if (q !== s.cur && at >= 0 && labs.has(comps.lab[at])) return false;
  }
  let to = 0, here = 0;
  for (let i = 0; i < N; i++) {
    if (s.tile[i] !== m.color) continue;
    if (labs.has(comps.lab[i])) to++;
    else if (comps.lab[i] === comps.lab[from]) here++;
  }
  return to >= 4 && to >= here + 2;
}

/** Тип хода: перестановка, сброс, тайл с очком, война, монумент, новый лидер, восстание, катастрофа, пас. */
export function moveFlags(s, m) {
  switch (m.type) {
    case 'withdraw': return F_RELOCATE;
    case 'discard': return F_DISCARD;
    case 'catastrophe': return F_CATASTROPHE;
    case 'pass': return F_PASS;
    default: break;
  }
  let f = 0;
  if (m.type === 'leader') f |= s.players[s.cur].leaders[m.color] >= 0 ? F_RELOCATE | (relocationPurpose(s, m) ? F_PURPOSE : 0) : F_LEADER_NEW;
  if (m.type !== 'leader' && m.type !== 'tile') return f;
  const s1 = cloneState(s);
  const before = sum4(s1.players[s.cur].score);
  try {
    applyMove(s1, m, fixedRng);
  } catch (e) {
    return f;
  }
  if (s1.phase === 'revoltSupport') f = (f & ~F_LEADER_NEW) | F_REVOLT;
  if (s1.phase === 'warSupport' || s1.phase === 'warChoose') f |= F_WAR;
  if (m.type === 'tile') {
    if (sum4(s1.players[s.cur].score) > before) f |= F_TILE_POINT;
    if (s1.tile[m.pos] === m.color && monumentOptions(s1, m.pos, m.color).length) f |= F_MONUMENT;
  }
  return f;
}

/** Цена хода по его типу: перестановка и сброс стоят, вкус стиля прибавляет ценность. */
export function flagCost(flags, P) {
  let c = 0;
  if (flags & F_RELOCATE) c += flags & F_PURPOSE ? P.relocate * (P.relocPurpose ?? 1) : P.relocate;
  if (flags & F_DISCARD) c += P.discard;
  const w = P.weights;
  for (const [bit, key] of BIASES) if (flags & bit) c -= w[key] || 0;
  return c;
}

/** Есть ли у стиля вкус к типам ходов (иначе тип хода нужен только для перестановки и сброса). */
function hasBias(P) {
  return BIASES.some(([, key]) => P.weights[key]);
}

/** Цена хода сверх оценки позиции: перестановка и снятие лидера тратят действие. */
function moveCost(s, m, P) {
  if (!hasBias(P)) {
    if (m.type === 'leader' && s.players[s.cur].leaders[m.color] >= 0) return relocationPurpose(s, m) ? P.relocate * P.relocPurpose : P.relocate;
    if (m.type === 'withdraw') return P.relocate;
    if (m.type === 'discard') return P.discard;
    return 0;
  }
  return flagCost(moveFlags(s, m), P);
}

const PASS = { type: 'pass' };

/**
 * Ценность хода на конец своего хода: если после m ещё есть действие, бот
 * пасует. Так все кандидаты сравниваются в одной точке: пас сразу засчитывает
 * монументы и добор, и без этого он выглядел лучше хода, приносящего очко.
 */
function valueAtTurnEnd(det, m, me, rng, P) {
  const s = cloneState(det);
  applyMove(s, m, rng);
  settle(s, rng);
  if (!s.over && s.cur === me && s.phase === 'action') {
    applyMove(s, PASS, rng);
    settle(s, rng);
  }
  return evaluate(s, me, { weights: P.weights });
}

function valueAfter(det, moves, me, rng, P, opts = {}) {
  const s = cloneState(det);
  for (const m of moves) {
    if (s.over) break;
    applyMove(s, m, rng);
    settle(s, rng);
  }
  return evaluate(s, me, { weights: P.weights, ...opts });
}

/** Второе действие после катастрофы — свой конфликт или лидер на поле. */
function followUpAfterCatastrophe(s, c) {
  if (!c.second) return false;
  if (c.second.type === 'leader') return true;
  if (c.second.type !== 'tile') return false;
  const x = cloneState(s);
  try {
    applyMove(x, c.m, fixedRng);
    settle(x, fixedRng);
  } catch (e) {
    return false;
  }
  return x.phase === 'action' && (moveFlags(x, c.second) & (F_WAR | F_REVOLT)) !== 0;
}

/** На сколько c лучше b: по самой глубокой оценке, которая есть у обоих. */
function gainOver(c, b) {
  if (c.v3 !== undefined && b.v3 !== undefined) return c.v3 - b.v3;
  if (c.v2 !== undefined && b.v2 !== undefined) return c.v2 - b.v2;
  return c.v - b.v;
}

/**
 * Ценность хода c (первое действие и выбранное второе) после ответа
 * соперников: свой ход доигрывается (второе действие, иначе пас), затем
 * соперники до P.replyDepth действий подряд выбирают лучшее для себя действие
 * из своих кандидатов (каждый — по своей оценке позиции).
 */
function* valueAfterReply(det, c, me, rng, P, clock) {
  const s1 = cloneState(det);
  applyMove(s1, c.m, rng);
  settle(s1, rng);
  let extra = 0;
  if (!s1.over && s1.cur === me && s1.phase === 'action') {
    const legal = c.second && legalMoves(s1).some((m) => JSON.stringify(m) === JSON.stringify(c.second));
    if (legal) {
      extra = moveCost(s1, c.second, P);
      applyMove(s1, c.second, rng);
      settle(s1, rng);
    }
    if (!s1.over && s1.cur === me && s1.phase === 'action') {
      applyMove(s1, PASS, rng);
      settle(s1, rng);
    }
  }
  let cur = s1;
  let mine = null;
  for (let left = P.replyDepth; left > 0; left--) {
    if (cur.over || cur.cur === me || cur.phase !== 'action') break;
    const opp = cur.cur;
    let best = null;
    for (const m of candidateActions(cur)) {
      const s2 = cloneState(cur);
      applyMove(s2, m, rng);
      settle(s2, rng);
      const rec = positionRecord(s2);
      const vOpp = recordValue(rec, opp, P.weights);
      if (!best || vOpp > best.vOpp) best = { vOpp, s2, mine: recordValue(rec, me, P.weights) };
      yield* pause(clock);
    }
    if (!best) break;
    cur = best.s2;
    mine = best.mine;
  }
  return (mine ?? evaluate(s1, me, { weights: P.weights })) - extra;
}

function* decideAction(view, P, rng, clock) {
  const me = view.me;
  const s = view.state;
  const deadline = busy(clock) + P.timeMs;
  const firstDeadline = busy(clock) + P.timeMs * FIRST_STEP_SHARE;
  const dets = Array.from({ length: P.dets }, () => determinize(view, rng));
  const odds = new Map(); // ход -> шанс победы в конфликте, который он начинает
  const catInfo = new Map(); // катастрофа -> правило (защита или атака, кого выселяет)
  const cands = playableActions(view, s, P, odds, catInfo);

  let scored = [];
  let reduced = 0; // кандидаты, оценённые по одной достройке из-за нехватки времени
  let searched = 0; // сколько лучших кандидатов просмотрено на два действия вперёд
  let replied = 0;
  let iters = 0; // проходы дерева (search: 'mcts')

  // Поиск по дереву: кандидаты корня по числу проходов, со вторым действием.
  if (P.mcts) {
    const ranked = yield* mctsSearch(view, P, rng, {
      cands,
      oppCands: candidateActions,
      moveCost: (st, m) => moveCost(st, m, P),
      playable: (st) => playableActions(view, st, P),
      pause: () => pause(clock),
      overBudget: () => busy(clock) > deadline,
    });
    iters = ranked.iters || 0;
    scored = ranked.map((r) => ({ m: r.m, v: r.v, vals: [r.v], second: r.second, visits: r.n }));
    if (view.debug) view.debug({ mcts: ranked.slice(0, 12), iters });
  }

  // 1. Каждое действие по отдельности. Если кандидатов так много, что первый
  // шаг съедает половину бюджета, остальные оцениваются по одной достройке.
  if (!scored.length) {
    for (const m of cands) {
      const ds = busy(clock) > firstDeadline ? dets.slice(0, 1) : dets;
      if (ds.length < dets.length) reduced++;
      const vals = [];
      for (const d of ds) vals.push(valueAtTurnEnd(d, m, me, rng, P));
      scored.push({ m, vals, v: aggregate(vals, P.rho) - moveCost(s, m, P) + P.noise * gauss(rng) });
      yield* pause(clock);
    }
    scored.sort((a, b) => b.v - a.v);

    // 2. Для лучших — лучшее второе действие
    if (s.actionNo === 1) {
      const top = scored.slice(0, P.topK);
      for (const c of top) {
        if (busy(clock) > deadline && c !== top[0]) break;
        // Второе действие выбирается одно на все достройки, по средней ценности.
        // Если выбирать его в каждой достройке отдельно, бот как будто видит
        // чужие руки и мешок, и ходы «с выбором потом» (сброс) кажутся лучше.
        const ends = []; // достройки, где ход уже закончился: оценка готова
        const byMove = new Map(); // ключ второго действия -> { m, sum, n }
        let live = 0;
        for (const d of dets) {
          const s1 = cloneState(d);
          applyMove(s1, c.m, rng);
          settle(s1, rng);
          if (s1.over || s1.cur !== me || s1.phase !== 'action') {
            ends.push(evaluate(s1, me, { weights: P.weights }));
            continue;
          }
          live++;
          for (const m2 of playableActions(view, s1, P)) {
            const key = JSON.stringify(m2);
            const v = valueAfter(s1, [m2], me, rng, P) - moveCost(s1, m2, P);
            const e = byMove.get(key) || { m: m2, sum: 0, n: 0 };
            e.sum += v;
            e.n++;
            byMove.set(key, e);
            yield* pause(clock);
          }
        }
        let best = null;
        for (const e of byMove.values()) {
          if (e.n < live) continue; // ход возможен не во всех достройках (после сброса рука разная)
          if (!best || e.sum / e.n > best.avg) best = { m: e.m, avg: e.sum / e.n };
        }
        if (!best) for (const e of byMove.values()) if (!best || e.sum / e.n > best.avg) best = { m: e.m, avg: e.sum / e.n };
        if (best) c.second = best.m;
        const vals = ends.slice();
        for (let i = 0; i < live; i++) vals.push(best ? best.avg : -Infinity);
        c.v2 = aggregate(vals, P.rho) - moveCost(s, c.m, P) + P.noise * gauss(rng);
      }
      const deep = top.filter((c) => c.v2 !== undefined).sort((a, b) => b.v2 - a.v2);
      searched = deep.length;
      if (view.debug) view.debug({ step1: scored.slice(0, 12), deep });
      scored = [...deep, ...scored.filter((c) => c.v2 === undefined)];
    }

    // 3. Ответ соперника: лучшие ходы доигрываются до конца своего хода, затем
    // следующий игрок делает лучший для себя ход, и оценивается позиция после
    // него. Порядок лучших ходов меняется по этой оценке, остальные ниже.
    if (P.replyK > 0 && scored.length > 1) {
      const top = scored.slice(0, P.replyK);
      for (const c of top) {
        if (busy(clock) > deadline && c !== top[0]) break;
        const vals = [];
        for (const d of dets) vals.push(yield* valueAfterReply(d, c, me, rng, P, clock));
        c.v3 = aggregate(vals, P.rho) - moveCost(s, c.m, P) + P.noise * gauss(rng);
      }
      const checked = top.filter((c) => c.v3 !== undefined).sort((a, b) => b.v3 - a.v3);
      replied = checked.length;
      if (view.debug) view.debug({ replies: checked });
      if (replied > 1) scored = [...checked, ...scored.filter((c) => c.v3 === undefined)];
    }
  }

  // Катастрофа-атака: выгода в том же ходу (выселяет лидера соперника или
  // вторым действием бот начинает конфликт либо ставит лидера) и ход заметно
  // лучше лучшего хода без катастрофы. Защитные проходят без условий.
  {
    const bestOther = scored.find((c) => c.m.type !== 'catastrophe');
    const kept = scored.filter((c) => {
      if (c.m.type !== 'catastrophe') return true;
      const info = catInfo.get(c.m);
      if (!info || info.kind === 'defense') return true;
      if (CAT_FOLLOW && !(info.evicts.opp > 0 || followUpAfterCatastrophe(s, c))) return false;
      return !bestOther || gainOver(c, bestOther) >= (info.last ? CAT_MARGIN_LAST : CAT_MARGIN);
    });
    if (kept.length) scored = kept;
  }

  // 4. Человеческая ошибка
  let chosen = scored[0];
  let error = null;
  if (scored.length > 1 && rng() < P.errorRate) {
    if (rng() < 0.6) {
      chosen = scored[1 + Math.floor(rng() * Math.min(2, scored.length - 1))];
      error = 'выбрал не лучший ход';
    } else {
      const blind = [];
      for (const c of scored.slice(0, Math.max(3, P.topK))) {
        const vals = [];
        for (const d of dets) vals.push(valueAfter(d, [c.m], me, rng, P, { ignoreThreats: true, oppWeight: 0.3 }));
        blind.push({ c, v: aggregate(vals, 0) });
        yield* pause(clock);
      }
      blind.sort((a, b) => b.v - a.v);
      if (blind[0].c !== chosen) {
        chosen = blind[0].c;
        error = 'не заметил угрозу';
      }
    }
  }
  const cat = chosen.m.type === 'catastrophe' ? catInfo.get(chosen.m) : null;
  const catText = !cat ? ''
    : cat.reason === 'union' ? ', закрываю клетку: через неё соперник объединил бы царства с выигрышной войной'
      : cat.reason === 'monument' ? ', не даю сопернику замкнуть монумент'
        : cat.evicts.opp > 0 ? ', выселяю лидера соперника' : ', готовлю конфликт вторым действием';
  const odd = odds.get(chosen.m);
  const oddText = !odd ? ''
    : odd.wars.length > 1 ? `, шансы в войнах: ${odd.wars.map((w) => `${COLOR_ADJ[w.color]} масти ~${Math.round(w.pWin * 100)}%`).join(', ')}`
      : `, шанс победы ~${Math.round(odd.pWin * 100)}%`;
  const text = explainAction(view, chosen, dets[0], rng) + catText + oddText;
  return {
    move: chosen.m,
    second: chosen.second || null,
    text,
    error,
    value: chosen.v3 ?? chosen.v2 ?? chosen.v,
    candidates: cands.length,
    searched,
    replied,
    reduced,
    iters,
  };
}

function explainAction(view, c, det, rng) {
  const me = view.me;
  const s = cloneState(det);
  const before = s.players[me].score.slice();
  applyMove(s, c.m, rng);
  const parts = [describeMove(c.m, view.state)];
  if (s.phase === 'revoltSupport') parts.push('начинаю восстание');
  if (s.phase === 'warSupport' || s.phase === 'warChoose') parts.push('объединяю королевства, будет война');
  if (s.phase === 'monument') parts.push('можно построить монумент');
  // только гарантированные очки за сам ход, без угадывания исхода конфликтов
  const gain = s.players[me].score.map((v, k) => v - before[k]);
  const g = gain.map((n, k) => (n > 0 ? `+${n} ${COLOR_NAME[k]}` : '')).filter(Boolean);
  if (g.length) parts.push('мне ' + g.join(', '));
  if (c.second) parts.push('дальше: ' + describeMove(c.second, s));
  return parts.join('; ');
}

// --- Поддержка в конфликте: решаем по вероятности

function* decideSupport(view, P, rng, clock) {
  const me = view.me;
  const s = view.state;
  const isRevolt = s.phase === 'revoltSupport';
  const k = isRevolt ? s.ctx.revolt : s.ctx.war;
  const color = isRevolt ? RED : k.color;
  const isAtt = k.attN === null;
  const options = legalMoves(s).map((m) => m.n);
  const dets = Array.from({ length: Math.max(2, P.dets) }, () => determinize(view, rng));

  let error = null;
  let shift = 0;
  if (rng() < P.errorRate) {
    shift = rng() < 0.5 ? -1 : 1;
    error = 'обсчитался в силе на 1';
  }

  let best = null;
  for (const n of options) {
    let ev;
    let pWin;
    if (isAtt) {
      const need = k.attBoard + n - (k.defBoard + shift);
      pWin = need <= 0 ? 0 : 1 - probAtLeast(view, view.handCounts[k.def], color, need);
      const pp = pWin ** P.gamma;
      const vWin = pWin > 0 ? avg(dets.map((d) => forcedOutcome(d, n, true, color, me, rng, P))) : 0;
      const vLose = avg(dets.map((d) => forcedOutcome(d, n, false, color, me, rng, P)));
      ev = pp * vWin + (1 - pp) * vLose;
    } else {
      pWin = k.defBoard + n >= k.attBoard + k.attN + shift ? 1 : 0;
      ev = avg(dets.map((d) => valueAfter(d, [{ type: 'support', n }], me, rng, P)));
    }
    if (!best || ev > best.ev) best = { n, ev, pWin };
    yield* pause(clock);
  }
  const role = isAtt ? 'атакую' : 'защищаюсь';
  const what = isRevolt ? 'восстание' : `война ${COLOR_ADJ[color]} масти`;
  return {
    move: { type: 'support', n: best.n },
    text: `${what}, ${role}: ${describeMove({ type: 'support', n: best.n })}, шанс победы ~${Math.round(best.pWin * 100)}%`,
    error,
    value: best.ev,
  };
}

const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;

function forcedOutcome(det, n, attWins, color, me, rng, P) {
  const s = cloneState(det);
  const conflict = () => (s.phase === 'revoltSupport' ? s.ctx.revolt : s.ctx.war);
  s.players[conflict().att].hand[color] = Math.max(s.players[conflict().att].hand[color], n);
  applyMove(s, { type: 'support', n }, rng);
  const k = conflict();
  const need = k.attBoard + k.attN - k.defBoard;
  let m = 0;
  if (!attWins) {
    m = Math.max(0, need);
    s.players[k.def].hand[color] = Math.max(s.players[k.def].hand[color], m);
  }
  applyMove(s, { type: 'support', n: m }, rng);
  settle(s, rng);
  return evaluate(s, me, { weights: P.weights });
}

// --- Прочие решения: монумент, здание, порядок войн, сокровище, очко чуда

function* decideByEval(view, P, rng, clock) {
  const me = view.me;
  const s = view.state;
  const moves = legalMoves(s);
  const dets = Array.from({ length: P.dets }, () => determinize(view, rng));
  // Монумент: оценка на конец хода (с очками за монумент, которые начисляются
  // в конце хода) и вкус стиля к монументам. Обучение учило готовить монумент
  // в расчёте, что его построят; без этой прибавки бот готовил и пасовал.
  const monument = s.phase === 'monument';
  let best = null;
  for (const m of moves) {
    let bonus = monument && m.type !== 'pass' ? (P.weights.bMonument || 0) : 0;
    // сокровище (Денис 08.11): позиции после взятия равны, а храм без сокровища открыт для катастрофы;
    // берем с того, что меньше прикрывает своих лидеров (bot/policy.js treasureExposure)
    if (m.type === 'treasure') bonus -= TREASURE_EXPOSE * treasureExposure(s, m.pos, me);
    const value = (d) => (monument ? valueAtTurnEnd(d, m, me, rng, P) : valueAfter(d, [m], me, rng, P));
    const v = aggregate(dets.map(value), P.rho) + bonus + P.noise * 0.3 * gauss(rng);
    if (!best || v > best.v) best = { m, v };
    yield* pause(clock);
  }
  let error = null;
  if ((s.phase === 'build' || s.phase === 'monument') && best.m.type !== 'pass' && rng() < P.errorRate) {
    best = { m: { type: 'pass' }, v: best.v };
    error = s.phase === 'build' ? 'забыл про здание' : 'забыл про монумент';
  }
  return { move: best.m, text: describeMove(best.m, s), error, value: best.v };
}
