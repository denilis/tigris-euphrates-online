// Движок правил «Тигр и Евфрат» (правила BGA, включая варианты:
// продвинутое поле, английская поддержка, здания цивилизации, чудо).
//
// Состояние — обычный объект с типизированными массивами, чтобы быстро
// копировать его при переборе. Игра идёт как автомат: state.phase говорит,
// какое решение ждём, state.toMove — от кого. legalMoves() перечисляет
// варианты, applyMove() применяет выбор и прокручивает автоматические шаги
// до следующего решения.

import {
  N, NB, W, H, RED, BLUE, GREEN, BLACK,
  EMPTY, FACEDOWN, WONDER, CATASTROPHE,
  TOTAL_TILES, HAND_SIZE, CATASTROPHES_PER_PLAYER, DEFAULT_MONUMENTS,
  xOf, yOf,
} from './constants.js';

// ---------------------------------------------------------------------------
// Создание и копирование состояния

/**
 * Пустое состояние без раздачи тайлов.
 * layout: { river: number[] | Uint8Array(N), temples: number[], special?: number[] }
 * cfg: { englishSupport, buildings, wonder }
 */
export function createState({ layout, numPlayers, cfg = {}, monuments = DEFAULT_MONUMENTS }) {
  const river = new Uint8Array(N);
  for (const i of layout.river) river[i] = 1;
  const special = new Uint8Array(N);
  for (const i of layout.special || []) special[i] = 1;

  const s = {
    cfg: {
      englishSupport: !!cfg.englishSupport,
      buildings: !!cfg.buildings,
      wonder: !!cfg.wonder,
    },
    np: numPlayers,
    river,
    special,
    tile: new Int8Array(N).fill(EMPTY),
    leader: new Int8Array(N).fill(-1),
    treasure: new Uint8Array(N),
    building: new Int8Array(N).fill(-1),
    monument: new Int8Array(N).fill(-1),
    players: Array.from({ length: numPlayers }, () => ({
      hand: [0, 0, 0, 0],
      leaders: [-1, -1, -1, -1],
      cats: CATASTROPHES_PER_PLAYER,
      score: [0, 0, 0, 0],
      treasures: 0,
      discarded: [0, 0, 0, 0], // сброшенные тайлы: цвет знает только сам игрок
    })),
    bag: TOTAL_TILES.slice(),
    removed: [0, 0, 0, 0],
    startTemples: layout.temples.length,
    monuments: monuments.map((m) => ({ id: m.id, c1: m.c1, c2: m.c2, pos: -1, color: -1 })),
    wonderPos: -1,
    buildingPos: [-1, -1, -1, -1],
    cur: 0,
    actionNo: 1,
    turn: 1,
    phase: 'action',
    toMove: 0,
    ctx: null,
    over: false,
    endReason: null,
    log: null,
  };
  for (const i of layout.temples) {
    s.tile[i] = RED;
    s.treasure[i] = 1;
    s.bag[RED]--;
  }
  return s;
}

/** Новая партия с раздачей по 6 тайлов. */
export function createGame(opts, rng) {
  const s = createState(opts);
  for (let p = 0; p < s.np; p++) drawTiles(s, p, HAND_SIZE, rng);
  return s;
}

export function cloneState(s) {
  return {
    cfg: s.cfg,
    np: s.np,
    river: s.river,
    special: s.special,
    tile: s.tile.slice(),
    leader: s.leader.slice(),
    treasure: s.treasure.slice(),
    building: s.building.slice(),
    monument: s.monument.slice(),
    players: s.players.map((p) => ({
      hand: p.hand.slice(),
      leaders: p.leaders.slice(),
      cats: p.cats,
      score: p.score.slice(),
      treasures: p.treasures,
      discarded: p.discarded.slice(),
    })),
    bag: s.bag.slice(),
    removed: s.removed.slice(),
    startTemples: s.startTemples,
    monuments: s.monuments.map((m) => ({ id: m.id, c1: m.c1, c2: m.c2, pos: m.pos, color: m.color })),
    wonderPos: s.wonderPos,
    buildingPos: s.buildingPos.slice(),
    cur: s.cur,
    actionNo: s.actionNo,
    turn: s.turn,
    phase: s.phase,
    toMove: s.toMove,
    ctx: s.ctx ? JSON.parse(JSON.stringify(s.ctx)) : null,
    over: s.over,
    endReason: s.endReason,
    log: null,
  };
}

function emit(s, ev) {
  if (s.log) s.log.push(ev);
}

// ---------------------------------------------------------------------------
// Связность: регионы и королевства

export function occupied(s, i) {
  const t = s.tile[i];
  return (t >= 0 && t <= WONDER) || s.leader[i] >= 0;
}

/** Метки связных групп занятых клеток. blocked — клетка, которую считаем пустой. */
export function components(s, blocked = -1) {
  const lab = new Int16Array(N).fill(-1);
  const stack = [];
  let n = 0;
  for (let i = 0; i < N; i++) {
    if (lab[i] !== -1 || i === blocked || !occupied(s, i)) continue;
    lab[i] = n;
    stack.push(i);
    while (stack.length) {
      const c = stack.pop();
      for (const j of NB[c]) {
        if (lab[j] === -1 && j !== blocked && occupied(s, j)) {
          lab[j] = n;
          stack.push(j);
        }
      }
    }
    n++;
  }
  return { lab, n };
}

/** Все лидеры на поле: [{p, c, pos}]. */
export function boardLeaders(s) {
  const out = [];
  for (let p = 0; p < s.np; p++) {
    const ls = s.players[p].leaders;
    for (let c = 0; c < 4; c++) if (ls[c] >= 0) out.push({ p, c, pos: ls[c] });
  }
  return out;
}

function labelsWithLeaders(s, lab) {
  const has = new Set();
  for (const l of boardLeaders(s)) has.add(lab[l.pos]);
  return has;
}

export function hasTemple(s, i) {
  for (const j of NB[i]) if (s.tile[j] === RED) return true;
  return false;
}

export function templeCount(s, i) {
  let n = 0;
  for (const j of NB[i]) if (s.tile[j] === RED) n++;
  return n;
}

function removeLeader(s, p, c) {
  const pos = s.players[p].leaders[c];
  if (pos < 0) return;
  s.leader[pos] = -1;
  s.players[p].leaders[c] = -1;
}

/** Снять лидеров, у которых не осталось соседнего храма. */
function withdrawUnsupported(s) {
  for (const l of boardLeaders(s)) {
    if (!hasTemple(s, l.pos)) {
      removeLeader(s, l.p, l.c);
      emit(s, { ev: 'leaderReturned', p: l.p, c: l.c, pos: l.pos });
    }
  }
}

export function treasuresOnBoard(s) {
  let n = 0;
  for (let i = 0; i < N; i++) n += s.treasure[i];
  return n;
}

// ---------------------------------------------------------------------------
// Мешок

function bagTotal(s) {
  return s.bag[0] + s.bag[1] + s.bag[2] + s.bag[3];
}

/** Добор n тайлов. Если мешок кончился раньше — игра заканчивается. */
function drawTiles(s, p, n, rng) {
  const hand = s.players[p].hand;
  for (let k = 0; k < n; k++) {
    const total = bagTotal(s);
    if (total === 0) {
      endGame(s, 'bag');
      return false;
    }
    let r = Math.floor(rng() * total);
    let c = 0;
    while (r >= s.bag[c]) r -= s.bag[c++];
    s.bag[c]--;
    hand[c]++;
  }
  return true;
}

function handSize(p) {
  return p.hand[0] + p.hand[1] + p.hand[2] + p.hand[3];
}

function endGame(s, reason) {
  if (s.over) return;
  s.over = true;
  s.endReason = reason;
  s.phase = 'over';
  s.ctx = null;
  emit(s, { ev: 'gameOver', reason });
}

// ---------------------------------------------------------------------------
// Проверки размещения

/** Подсчёт королевств вокруг клетки (метки групп с лидерами). */
function adjacentKingdoms(lab, hasLeader, i) {
  const out = [];
  for (const j of NB[i]) {
    const l = lab[j];
    if (l >= 0 && hasLeader.has(l) && !out.includes(l)) out.push(l);
  }
  return out;
}

function isEmptyCell(s, i) {
  return s.tile[i] === EMPTY && s.leader[i] < 0;
}

export function tileTargets(s, color, comps = components(s)) {
  const has = labelsWithLeaders(s, comps.lab);
  const out = [];
  for (let i = 0; i < N; i++) {
    if (!isEmptyCell(s, i)) continue;
    if ((color === BLUE) !== (s.river[i] === 1)) continue;
    if (adjacentKingdoms(comps.lab, has, i).length > 2) continue;
    out.push(i);
  }
  return out;
}

export function leaderTargets(s, p, c) {
  const from = s.players[p].leaders[c];
  if (from >= 0) s.leader[from] = -1;
  const comps = components(s);
  const has = labelsWithLeaders(s, comps.lab);
  if (from >= 0) s.leader[from] = p * 4 + c;
  const out = [];
  for (let i = 0; i < N; i++) {
    if (i === from || s.river[i]) continue;
    if (!(s.tile[i] === EMPTY && (s.leader[i] < 0))) continue;
    if (!hasTemple(s, i)) continue;
    if (adjacentKingdoms(comps.lab, has, i).length > 1) continue;
    out.push(i);
  }
  return out;
}

export function catastropheTargets(s) {
  const out = [];
  for (let i = 0; i < N; i++) {
    if (s.leader[i] >= 0) continue;
    const t = s.tile[i];
    if (t === EMPTY) out.push(i);
    else if (t >= 0 && t <= 3 && !s.treasure[i] && s.building[i] < 0) out.push(i);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Перечисление ходов

export function legalMoves(s) {
  switch (s.phase) {
    case 'action':
      return actionMoves(s);
    case 'warChoose':
      return s.ctx.warColors.map((color) => ({ type: 'warColor', color }));
    case 'warSupport': {
      const w = s.ctx.war;
      return supportOptions(s, w, w.color).map((n) => ({ type: 'support', n }));
    }
    case 'revoltSupport': {
      const r = s.ctx.revolt;
      return supportOptions(s, r, RED).map((n) => ({ type: 'support', n }));
    }
    case 'build':
      return [...s.ctx.buildOptions.map((pos) => ({ type: 'build', pos })), { type: 'pass' }];
    case 'monument':
      return [...s.ctx.monOptions, { type: 'pass' }];
    case 'treasure':
      return s.ctx.treasure.options.map((pos) => ({ type: 'treasure', pos }));
    case 'wonderPoint':
      return [0, 1, 2, 3].map((color) => ({ type: 'wonderPoint', color }));
    default:
      return [];
  }
}

function actionMoves(s) {
  const pl = s.players[s.cur];
  const moves = [];
  const comps = components(s);
  for (let c = 0; c < 4; c++) {
    if (pl.hand[c] <= 0) continue;
    for (const pos of tileTargets(s, c, comps)) moves.push({ type: 'tile', color: c, pos });
  }
  for (let c = 0; c < 4; c++) {
    for (const pos of leaderTargets(s, s.cur, c)) moves.push({ type: 'leader', color: c, pos });
    if (pl.leaders[c] >= 0) moves.push({ type: 'withdraw', color: c });
  }
  if (pl.cats > 0) for (const pos of catastropheTargets(s)) moves.push({ type: 'catastrophe', pos });
  for (const counts of discardOptions(pl.hand)) moves.push({ type: 'discard', counts });
  moves.push({ type: 'pass' });
  return moves;
}

export function discardOptions(hand) {
  const out = [];
  for (let a = 0; a <= hand[0]; a++)
    for (let b = 0; b <= hand[1]; b++)
      for (let c = 0; c <= hand[2]; c++)
        for (let d = 0; d <= hand[3]; d++)
          if (a + b + c + d > 0) out.push([a, b, c, d]);
  return out;
}

/** Допустимое число тайлов поддержки для того, кто сейчас решает. */
function supportOptions(s, conflict, color) {
  const isAtt = conflict.attN === null;
  const p = isAtt ? conflict.att : conflict.def;
  const avail = s.players[p].hand[color];
  const out = [0];
  if (!s.cfg.englishSupport) {
    for (let n = 1; n <= avail; n++) out.push(n);
    return out;
  }
  // Английский вариант: атакующий выкладывает, только если превысит силу
  // защитника на поле; защитник — только ровно до ничьей.
  if (isAtt) {
    const need = Math.max(1, conflict.defBoard - conflict.attBoard + 1);
    for (let n = need; n <= avail; n++) out.push(n);
  } else {
    const need = conflict.attBoard + conflict.attN - conflict.defBoard;
    if (need >= 1 && need <= avail) out.push(need);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Применение хода

export function applyMove(s, m, rng) {
  if (s.over) throw new Error('game is over');
  switch (s.phase) {
    case 'action':
      applyAction(s, m, rng);
      break;
    case 'warChoose':
      startWar(s, m.color);
      break;
    case 'warSupport':
      setSupport(s.ctx.war, m.n);
      break;
    case 'revoltSupport':
      setSupport(s.ctx.revolt, m.n);
      break;
    case 'build':
      if (m.type === 'build') placeBuilding(s, m.pos, s.ctx.color);
      s.ctx.buildDone = true;
      break;
    case 'monument':
      if (m.type === 'monument') buildMonument(s, m.id, m.tl);
      else if (m.type === 'wonder') buildWonder(s, m.center);
      s.ctx.monDone = true;
      break;
    case 'treasure':
      takeTreasure(s, s.ctx.treasure.player, m.pos);
      s.ctx.treasure = null;
      break;
    case 'wonderPoint':
      s.players[s.cur].score[m.color]++;
      emit(s, { ev: 'score', p: s.cur, c: m.color, n: 1, why: 'wonder' });
      s.ctx.wonderDone = true;
      break;
    default:
      throw new Error('unexpected phase ' + s.phase);
  }
  if (s.over) return;
  s.phase = 'auto';
  advance(s, rng);
}

function setSupport(conflict, n) {
  if (conflict.attN === null) conflict.attN = n;
  else conflict.defN = n;
}

function applyAction(s, m, rng) {
  const p = s.cur;
  const pl = s.players[p];
  switch (m.type) {
    case 'tile': {
      const comps = components(s);
      const has = labelsWithLeaders(s, comps.lab);
      const kingdoms = adjacentKingdoms(comps.lab, has, m.pos);
      s.tile[m.pos] = m.color;
      pl.hand[m.color]--;
      const unite = kingdoms.length === 2;
      if (unite) {
        emit(s, { ev: 'unite', p, c: m.color, pos: m.pos });
      } else if (kingdoms.length === 1) {
        scoreTilePlacement(s, comps, kingdoms[0], m.pos, m.color);
      }
      s.ctx = { kind: 'tile', pos: m.pos, color: m.color, unite, queue: ['wars', 'build', 'monument', 'treasure', 'endAction'] };
      emit(s, { ev: 'tile', p, c: m.color, pos: m.pos });
      break;
    }
    case 'leader': {
      const from = pl.leaders[m.color];
      if (from >= 0) s.leader[from] = -1;
      s.leader[m.pos] = p * 4 + m.color;
      pl.leaders[m.color] = m.pos;
      emit(s, { ev: 'leader', p, c: m.color, pos: m.pos, from });
      const comps = components(s);
      const L = comps.lab[m.pos];
      let revolt = null;
      for (const l of boardLeaders(s)) {
        if (l.c === m.color && l.p !== p && comps.lab[l.pos] === L) {
          revolt = {
            color: RED,
            leaderColor: m.color,
            att: p, def: l.p, attPos: m.pos, defPos: l.pos,
            attBoard: templeCount(s, m.pos), defBoard: templeCount(s, l.pos),
            attN: null, defN: null,
          };
        }
      }
      s.ctx = { kind: 'leader', revolt, queue: ['revolt', 'treasure', 'endAction'] };
      break;
    }
    case 'withdraw':
      removeLeader(s, p, m.color);
      emit(s, { ev: 'withdraw', p, c: m.color });
      s.ctx = { kind: 'withdraw', queue: ['endAction'] };
      break;
    case 'catastrophe': {
      const t = s.tile[m.pos];
      if (t >= 0 && t <= 3) s.removed[t]++;
      s.tile[m.pos] = CATASTROPHE;
      pl.cats--;
      emit(s, { ev: 'catastrophe', p, pos: m.pos, removed: t });
      withdrawUnsupported(s);
      s.ctx = { kind: 'catastrophe', queue: ['endAction'] };
      break;
    }
    case 'discard': {
      let n = 0;
      for (let c = 0; c < 4; c++) {
        pl.hand[c] -= m.counts[c];
        pl.discarded[c] += m.counts[c];
        s.removed[c] += m.counts[c];
        n += m.counts[c];
      }
      emit(s, { ev: 'discard', p, n });
      s.ctx = { kind: 'discard', queue: ['endAction'] };
      drawTiles(s, p, n, rng);
      break;
    }
    case 'pass':
      s.ctx = { kind: 'pass', pass: true, queue: ['endAction'] };
      break;
    default:
      throw new Error('unknown action ' + m.type);
  }
}

/** Очки за тайл, положенный в одно королевство (без объединения). */
function scoreTilePlacement(s, comps, kingdomLabel, pos, color) {
  let owner = -1;
  let king = -1;
  for (const l of boardLeaders(s)) {
    if (comps.lab[l.pos] !== kingdomLabel) continue;
    if (l.c === color) owner = l.p;
    if (l.c === BLACK) king = l.p;
  }
  if (owner < 0) owner = king;
  if (owner < 0) return;
  let pts = 1;
  if (s.cfg.buildings) {
    const b = s.buildingPos[color];
    if (b >= 0) {
      // здание того же цвета в королевстве (до или после присоединения тайлом)
      const bl = comps.lab[b];
      if (bl >= 0 && NB[pos].some((j) => comps.lab[j] === bl)) pts = 2;
    }
  }
  s.players[owner].score[color] += pts;
  emit(s, { ev: 'score', p: owner, c: color, n: pts, why: 'tile' });
}

// ---------------------------------------------------------------------------
// Автоматическая прокрутка шагов

function advance(s, rng) {
  while (!s.over) {
    const ctx = s.ctx;
    if (!ctx) {
      s.phase = 'action';
      s.toMove = s.cur;
      return;
    }
    const step = ctx.queue[0];
    let done;
    switch (step) {
      case 'wars': done = stepWars(s); break;
      case 'revolt': done = stepRevolt(s); break;
      case 'build': done = stepBuild(s); break;
      case 'monument': done = stepMonument(s); break;
      case 'treasure': done = stepTreasure(s); break;
      case 'endAction': done = endAction(s); break;
      case 'monScore': monumentScoring(s); done = true; break;
      case 'wonder': done = stepWonderPoint(s); break;
      case 'refill': refillAll(s, rng); done = true; break;
      case 'nextTurn': nextTurn(s); return;
      default: throw new Error('unknown step ' + step);
    }
    if (!done) return; // ждём решения
    if (s.ctx === ctx) ctx.queue.shift();
  }
}

// --- Восстание

function stepRevolt(s) {
  const r = s.ctx.revolt;
  if (!r) return true;
  if (r.attN === null) {
    s.phase = 'revoltSupport';
    s.toMove = r.att;
    return false;
  }
  if (r.defN === null) {
    s.phase = 'revoltSupport';
    s.toMove = r.def;
    return false;
  }
  resolveConflict(s, r, RED, 'revolt');
  s.ctx.revolt = null;
  return true;
}

function resolveConflict(s, k, color, kind) {
  const att = s.players[k.att];
  const def = s.players[k.def];
  att.hand[color] -= k.attN;
  def.hand[color] -= k.defN;
  s.removed[color] += k.attN + k.defN;
  const attTotal = k.attBoard + k.attN;
  const defTotal = k.defBoard + k.defN;
  const attWins = attTotal > defTotal;
  const winner = attWins ? k.att : k.def;
  const loser = attWins ? k.def : k.att;
  const loserPos = attWins ? k.defPos : k.attPos;
  const lc = kind === 'revolt' ? k.leaderColor : color;
  // стороны боя целиком (поле и поддержка из руки): по ним сайт показывает ход боя
  emit(s, {
    ev: kind, winner, loser, color: lc, attTotal, defTotal,
    att: k.att, def: k.def, attBoard: k.attBoard, defBoard: k.defBoard, attN: k.attN, defN: k.defN,
  });
  if (kind === 'revolt') {
    removeLeader(s, loser, lc);
    s.players[winner].score[RED] += 1;
    return { winner, loser };
  }
  // Война: убираем сторонников проигравшего на его стороне объединения.
  const u = s.ctx.pos;
  const comps = components(s, u);
  const L = comps.lab[loserPos];
  let removedCount = 0;
  for (let i = 0; i < N; i++) {
    if (comps.lab[i] !== L || s.tile[i] !== color) continue;
    if (s.building[i] >= 0) continue;
    if (color === RED) {
      if (s.treasure[i]) continue;
      let guarded = false;
      for (const j of NB[i]) {
        const lv = s.leader[j];
        if (lv >= 0 && (lv & 3) !== RED) { guarded = true; break; }
      }
      if (guarded) continue;
    }
    s.tile[i] = EMPTY;
    s.removed[color]++;
    removedCount++;
  }
  removeLeader(s, loser, color);
  s.players[winner].score[color] += 1 + removedCount;
  emit(s, { ev: 'score', p: winner, c: color, n: 1 + removedCount, why: 'war' });
  withdrawUnsupported(s);
  return { winner, loser, removedCount };
}

// --- Войны

/** Цвета, в которых в объединённом королевстве два лидера. */
function pendingWarColors(s, u) {
  const comps = components(s);
  const L = comps.lab[u];
  const cnt = [0, 0, 0, 0];
  for (const l of boardLeaders(s)) if (comps.lab[l.pos] === L) cnt[l.c]++;
  const out = [];
  for (let c = 0; c < 4; c++) if (cnt[c] >= 2) out.push(c);
  return out;
}

function stepWars(s) {
  const ctx = s.ctx;
  if (!ctx.unite) return true;
  for (;;) {
    const w = ctx.war;
    if (w) {
      if (w.attN === null) {
        s.phase = 'warSupport';
        s.toMove = w.att;
        return false;
      }
      if (w.defN === null) {
        s.phase = 'warSupport';
        s.toMove = w.def;
        return false;
      }
      resolveConflict(s, w, w.color, 'war');
      ctx.war = null;
    }
    const colors = pendingWarColors(s, ctx.pos);
    if (colors.length === 0) {
      ctx.unite = false;
      return true;
    }
    if (colors.length === 1) {
      startWar(s, colors[0]);
      continue;
    }
    ctx.warColors = colors;
    s.phase = 'warChoose';
    s.toMove = s.cur;
    return false;
  }
}

function startWar(s, color) {
  const ctx = s.ctx;
  const u = ctx.pos;
  const comps = components(s);
  const L = comps.lab[u];
  const inv = boardLeaders(s).filter((l) => l.c === color && comps.lab[l.pos] === L);
  let a = inv.find((l) => l.p === s.cur);
  if (!a) {
    for (let k = 1; k < s.np && !a; k++) a = inv.find((l) => l.p === (s.cur + k) % s.np);
  }
  const d = inv.find((l) => l !== a);
  const sides = components(s, u);
  const strength = (pos) => {
    const lab = sides.lab[pos];
    let n = 0;
    for (let i = 0; i < N; i++) if (sides.lab[i] === lab && s.tile[i] === color) n++;
    return n;
  };
  ctx.warColors = null;
  ctx.war = {
    color,
    att: a.p, def: d.p, attPos: a.pos, defPos: d.pos,
    attBoard: strength(a.pos), defBoard: strength(d.pos),
    attN: null, defN: null,
  };
  emit(s, { ev: 'warStart', color, att: a.p, def: d.p });
}

// --- Здания цивилизации

function lineCells(s, pos, color, dx) {
  // dx = 1 — горизонталь, dx = W — вертикаль
  const out = [pos];
  for (let i = pos - dx; i >= 0 && s.tile[i] === color && (dx !== 1 || yOf(i) === yOf(pos)); i -= dx) out.push(i);
  for (let i = pos + dx; i < N && s.tile[i] === color && (dx !== 1 || yOf(i) === yOf(pos)); i += dx) out.push(i);
  return out;
}

function maxLineLen(s, pos, color) {
  if (s.tile[pos] !== color) return 0;
  return Math.max(lineCells(s, pos, color, 1).length, lineCells(s, pos, color, W).length);
}

export function buildingOptions(s, pos, color) {
  if (s.tile[pos] !== color) return [];
  const lines = [lineCells(s, pos, color, 1), lineCells(s, pos, color, W)].filter((l) => l.length >= 3);
  if (!lines.length) return [];
  const cur = s.buildingPos[color];
  const curLen = cur >= 0 ? maxLineLen(s, cur, color) : 0;
  const out = new Set();
  for (const line of lines) {
    if (cur >= 0 && (line.length <= curLen || line.includes(cur))) continue;
    for (const i of line) out.add(i);
  }
  return [...out].sort((a, b) => a - b);
}

function stepBuild(s) {
  const ctx = s.ctx;
  if (!s.cfg.buildings || ctx.kind !== 'tile' || ctx.buildDone) return true;
  const opts = buildingOptions(s, ctx.pos, ctx.color);
  if (!opts.length) {
    ctx.buildDone = true;
    return true;
  }
  ctx.buildOptions = opts;
  s.phase = 'build';
  s.toMove = s.cur;
  return false;
}

function placeBuilding(s, pos, color) {
  const old = s.buildingPos[color];
  if (old >= 0) s.building[old] = -1;
  s.building[pos] = color;
  s.buildingPos[color] = pos;
  emit(s, { ev: 'building', p: s.cur, c: color, pos, from: old });
}

function dropBuildingAt(s, i) {
  const b = s.building[i];
  if (b >= 0) {
    s.building[i] = -1;
    s.buildingPos[b] = -1;
  }
}

// --- Монументы и чудо

export function monumentOptions(s, pos, color) {
  if (s.tile[pos] !== color) return [];
  const out = [];
  const x = xOf(pos), y = yOf(pos);
  for (let dy = -1; dy <= 0; dy++) {
    for (let dx = -1; dx <= 0; dx++) {
      const tx = x + dx, ty = y + dy;
      if (tx < 0 || ty < 0 || tx > W - 2 || ty > H - 2) continue;
      const tl = ty * W + tx;
      if ([tl, tl + 1, tl + W, tl + W + 1].every((i) => s.tile[i] === color)) {
        for (const m of s.monuments) {
          if (m.pos < 0 && (m.c1 === color || m.c2 === color)) out.push({ type: 'monument', id: m.id, tl });
        }
      }
    }
  }
  if (s.cfg.wonder && s.wonderPos < 0) {
    for (const ctr of [pos, ...NB[pos]]) {
      const cx = xOf(ctr), cy = yOf(ctr);
      if (cx < 1 || cy < 1 || cx > W - 2 || cy > H - 2) continue;
      if ([ctr, ...NB[ctr]].every((i) => s.tile[i] === color)) out.push({ type: 'wonder', center: ctr });
    }
  }
  return out;
}

function stepMonument(s) {
  const ctx = s.ctx;
  if (ctx.kind !== 'tile' || ctx.monDone) return true;
  const opts = monumentOptions(s, ctx.pos, ctx.color);
  if (!opts.length) {
    ctx.monDone = true;
    return true;
  }
  ctx.monOptions = opts;
  s.phase = 'monument';
  s.toMove = s.cur;
  return false;
}

function buildMonument(s, id, tl) {
  const m = s.monuments.find((x) => x.id === id);
  m.color = s.tile[tl];
  for (const i of [tl, tl + 1, tl + W, tl + W + 1]) {
    dropBuildingAt(s, i);
    s.tile[i] = FACEDOWN;
    s.monument[i] = id;
  }
  m.pos = tl;
  emit(s, { ev: 'monument', p: s.cur, id, tl });
  withdrawUnsupported(s);
}

function buildWonder(s, center) {
  const color = s.tile[center];
  for (const i of [center, ...NB[center]]) {
    dropBuildingAt(s, i);
    s.tile[i] = WONDER;
  }
  s.removed[color] += 5;
  s.wonderPos = center;
  emit(s, { ev: 'wonder', p: s.cur, center });
  withdrawUnsupported(s);
}

// --- Сокровища

function stepTreasure(s) {
  const ctx = s.ctx;
  if (ctx.treasure) {
    s.phase = 'treasure';
    s.toMove = ctx.treasure.player;
    return false;
  }
  const comps = components(s);
  for (const l of boardLeaders(s)) {
    if (l.c !== GREEN) continue;
    const L = comps.lab[l.pos];
    const cells = [];
    for (let i = 0; i < N; i++) if (s.treasure[i] && comps.lab[i] === L) cells.push(i);
    if (cells.length < 2) continue;
    const special = cells.filter((i) => s.special[i]);
    ctx.treasure = { player: l.p, options: special.length ? special : cells };
    s.phase = 'treasure';
    s.toMove = l.p;
    return false;
  }
  return true;
}

function takeTreasure(s, p, pos) {
  s.treasure[pos] = 0;
  s.players[p].treasures++;
  emit(s, { ev: 'treasure', p, pos });
}

// --- Конец действия и хода

function endAction(s) {
  const ctx = s.ctx;
  // ctx заменяется целиком, поэтому advance() не сдвигает старую очередь
  if (ctx.pass || s.actionNo >= 2) {
    s.ctx = { kind: 'endTurn', queue: ['monScore', 'wonder', 'refill', 'nextTurn'] };
  } else {
    s.actionNo++;
    s.ctx = null;
  }
  return true;
}

function monumentScoring(s) {
  const built = s.monuments.filter((m) => m.pos >= 0);
  if (!built.length) return;
  const comps = components(s);
  const pl = s.players[s.cur];
  for (let c = 0; c < 4; c++) {
    const pos = pl.leaders[c];
    if (pos < 0) continue;
    let n = 0;
    for (const m of built) if ((m.c1 === c || m.c2 === c) && comps.lab[m.pos] === comps.lab[pos]) n++;
    if (n) {
      pl.score[c] += n;
      emit(s, { ev: 'score', p: s.cur, c, n, why: 'monument' });
    }
  }
}

function stepWonderPoint(s) {
  const ctx = s.ctx;
  if (ctx.wonderDone || s.wonderPos < 0) return true;
  const king = s.players[s.cur].leaders[BLACK];
  if (king < 0) return true;
  const comps = components(s);
  if (comps.lab[king] !== comps.lab[s.wonderPos]) return true;
  s.phase = 'wonderPoint';
  s.toMove = s.cur;
  return false;
}

function refillAll(s, rng) {
  for (let k = 0; k < s.np && !s.over; k++) {
    const p = (s.cur + k) % s.np;
    const need = HAND_SIZE - handSize(s.players[p]);
    if (need > 0) drawTiles(s, p, need, rng);
  }
}

function nextTurn(s) {
  if (treasuresOnBoard(s) <= 2) {
    endGame(s, 'treasures');
    return;
  }
  s.cur = (s.cur + 1) % s.np;
  s.actionNo = 1;
  s.turn++;
  s.ctx = null;
  s.phase = 'action';
  s.toMove = s.cur;
}

// ---------------------------------------------------------------------------
// Итоговый счёт

/** Очки игрока с оптимальной раздачей сокровищ, по возрастанию. */
export function finalVector(pl) {
  const v = pl.score.slice();
  for (let t = 0; t < pl.treasures; t++) {
    let mi = 0;
    for (let c = 1; c < 4; c++) if (v[c] < v[mi]) mi = c;
    v[mi]++;
  }
  return v.sort((a, b) => a - b);
}

export function compareVectors(a, b) {
  for (let k = 0; k < 4; k++) if (a[k] !== b[k]) return a[k] - b[k];
  return 0;
}

/** Места игроков: массив индексов от победителя к последнему. */
export function ranking(s) {
  const vs = s.players.map((pl, p) => ({ p, v: finalVector(pl) }));
  vs.sort((x, y) => compareVectors(y.v, x.v));
  return vs.map((x) => x.p);
}

// ---------------------------------------------------------------------------
// Проверка целостности (для тестов и отладки)

export function validate(s) {
  const errs = [];
  const total = [0, 0, 0, 0];
  for (let i = 0; i < N; i++) {
    const t = s.tile[i];
    if (t >= 0 && t <= 3) total[t]++;
    if (s.leader[i] >= 0 && t !== EMPTY) errs.push(`leader on non-empty cell ${i}`);
    if (s.leader[i] >= 0 && s.river[i]) errs.push(`leader on river ${i}`);
    if (t === BLUE && !s.river[i]) errs.push(`farm on land ${i}`);
    if (t >= 0 && t <= 3 && t !== BLUE && s.river[i]) errs.push(`land tile on river ${i}`);
  }
  for (const m of s.monuments) {
    if (m.pos < 0) continue;
    const cells = [m.pos, m.pos + 1, m.pos + W, m.pos + W + 1];
    for (const i of cells) if (s.tile[i] !== FACEDOWN) errs.push(`monument cell ${i} not facedown`);
  }
  for (const pl of s.players) for (let c = 0; c < 4; c++) total[c] += pl.hand[c];
  for (let c = 0; c < 4; c++) total[c] += s.bag[c] + s.removed[c];
  // Перевёрнутые тайлы под монументами считаем без цвета.
  const facedown = Array.from(s.tile).filter((t) => t === FACEDOWN).length;
  const sumTotal = total.reduce((a, b) => a + b, 0) + facedown;
  const expect = TOTAL_TILES.reduce((a, b) => a + b, 0);
  if (sumTotal !== expect) errs.push(`tile count ${sumTotal} != ${expect}`);
  for (let p = 0; p < s.np; p++) {
    for (let c = 0; c < 4; c++) {
      const pos = s.players[p].leaders[c];
      if (pos >= 0) {
        if (s.leader[pos] !== p * 4 + c) errs.push(`leader map mismatch p${p} c${c}`);
        if (!hasTemple(s, pos)) errs.push(`leader without temple p${p} c${c}`);
      }
      if (s.players[p].hand[c] < 0) errs.push(`negative hand p${p} c${c}`);
    }
  }
  if (s.phase === 'action') {
    const comps = components(s);
    const seen = new Map();
    for (const l of boardLeaders(s)) {
      const key = comps.lab[l.pos] * 4 + l.c;
      if (seen.has(key)) errs.push(`unresolved conflict color ${l.c}`);
      seen.set(key, l.p);
    }
  }
  return errs;
}

export { W, H, N, RED, BLUE, GREEN, BLACK };
