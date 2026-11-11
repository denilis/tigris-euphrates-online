// Быстрые решения внутри симуляций: поддержка в конфликтах, монументы,
// здания, сокровища. В достроенной позиции руки известны, поэтому каждая
// сторона играет «разумно»: выкладывает поддержку, только если она решает исход.

import { legalMoves, applyMove, components, cloneState, templeCount } from '../engine/engine.js';
import { geom, RED } from '../engine/constants.js';

export function autoMove(s) {
  const moves = legalMoves(s);
  switch (s.phase) {
    case 'revoltSupport':
      return supportMove(s, s.ctx.revolt, 0, moves);
    case 'warSupport':
      return supportMove(s, s.ctx.war, s.ctx.war.color, moves);
    case 'warChoose':
      return bestWarOrder(s, moves);
    case 'build': {
      const own = moves.find((m) => m.type === 'build' && m.pos === s.ctx.pos);
      return own || moves[0];
    }
    case 'monument':
      return bestMonument(s, moves);
    case 'treasure':
      return bestTreasure(s, moves);
    case 'wonderPoint': {
      const v = s.players[s.cur].score;
      let lo = 0;
      for (let c = 1; c < 4; c++) if (v[c] < v[lo]) lo = c;
      return moves[lo];
    }
    default:
      return moves[0];
  }
}

function supportMove(s, k, color, moves) {
  const options = moves.map((m) => m.n);
  const isAtt = k.attN === null;
  const attHas = s.players[k.att].hand[color];
  const defHas = s.players[k.def].hand[color];
  let want = 0;
  if (isAtt) {
    // Атакующий не видит руку защитника: как сильные игроки, он идёт ва-банк,
    // если всеми своими тайлами перекрывает защитника на поле, иначе не тратит
    // ничего. Защитник ответит, уже видя ставку.
    if (k.attBoard + attHas > k.defBoard) want = attHas;
  } else {
    const need = k.attBoard + k.attN - k.defBoard;
    if (need > 0 && need <= defHas) want = need;
  }
  return pick(moves, options, want);
}

/** Порядок войн: сначала та, где у ходящего лучший перевес на поле. */
function bestWarOrder(s, moves) {
  let best = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    const x = cloneState(s);
    applyMove(x, m, () => 0.5);
    if (x.phase !== 'warSupport') continue;
    const k = x.ctx.war;
    const att = x.players[k.att].hand[k.color];
    const margin = k.attBoard + att - k.defBoard;
    const score = k.att === s.cur ? margin : k.def === s.cur ? -margin : 0;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}

function pick(moves, options, want) {
  if (options.includes(want)) return moves[options.indexOf(want)];
  // английский вариант: ближайшее допустимое не меньше нужного, иначе 0
  const up = options.filter((n) => n >= want).sort((a, b) => a - b)[0];
  if (want > 0 && up !== undefined) return moves[options.indexOf(up)];
  return moves[options.indexOf(0)];
}

// Монумент в прикидке (08.11.2026, разбор партии сайта CBKZZE): пары «лидер + монумент его цвета в том
// же царстве» каждого игрока; свои в плюс, чужие в минус. Раньше считались только свои и монумент
// строился всегда, поэтому квадрат в царстве с чужим лидером этого цвета казался подарком сопернику, и
// бот оставлял квадрат открытым, а соперник замыкал его под свои цвета. Монумент без своей выгоды хуже паса.
const MON_BASE = 0.25;

function bestMonument(s, moves) {
  const comps = components(s);
  const pl = s.players[s.cur];
  let best = moves.find((m) => m.type === 'pass');
  let bestScore = 0;
  for (const m of moves) {
    if (m.type === 'pass') continue;
    let sc = 0.5;
    if (m.type === 'monument') {
      const mon = s.monuments.find((x) => x.id === m.id);
      const lab = comps.lab[m.tl];
      sc = MON_BASE;
      for (let q = 0; q < s.np; q++) {
        for (const c of [mon.c1, mon.c2]) {
          const at = s.players[q].leaders[c];
          if (at >= 0 && comps.lab[at] === lab) sc += q === s.cur ? 1 : -1;
        }
      }
    } else if (m.type === 'wonder') {
      sc += pl.leaders[3] >= 0 && comps.lab[pl.leaders[3]] === comps.lab[m.center] ? 1.5 : 0.7;
    }
    if (sc > bestScore) { bestScore = sc; best = m; }
  }
  return best;
}

/**
 * Сокровище на храме не дает поставить туда катастрофу (engine catastropheTargets), поэтому, снимая его,
 * игрок открывает храм (Денис 08.11: бот снял сокровище с K1, единственного храма у своего царя, хотя
 * было ничье F3). Сколько теряет игрок p, открыв храм pos: свой лидер рядом, у которого это
 * единственный храм, 2 (катастрофа на храм снимет лидера), свой с другими храмами 0,5 (в восстании
 * слабее); чужие лидеры наоборот и вдвое легче. Здание на клетке защищает храм и без сокровища.
 */
export function treasureExposure(s, pos, p) {
  const { NB } = geom(s);
  if (s.tile[pos] !== RED || (s.building && s.building[pos] >= 0)) return 0;
  let v = 0;
  for (const j of NB[pos]) {
    const l = s.leader[j];
    if (l < 0) continue;
    const w = templeCount(s, j) === 1 ? 2 : 0.5;
    v += Math.floor(l / 4) === p ? w : -w / 2;
  }
  return v;
}

/** Сокровище с того храма, который меньше всего прикрывает своих лидеров (при равенстве первое). */
function bestTreasure(s, moves) {
  let best = moves[0], low = Infinity;
  for (const m of moves) {
    const v = treasureExposure(s, m.pos, s.toMove);
    if (v < low) { low = v; best = m; }
  }
  return best;
}

/** Прокрутить все решения, кроме обычных ходов, автоматической политикой. */
export function settle(s, rng) {
  let guard = 0;
  while (!s.over && s.phase !== 'action') {
    applyMove(s, autoMove(s), rng);
    if (++guard > 200) throw new Error('settle loop');
  }
}

