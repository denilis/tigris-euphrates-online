// Точный исход вариантов для окна войны: каждый допустимый ход прогоняется на копии
// состояния, из событий берётся только сам конфликт. Что случится дальше (добор,
// здания, конец партии), наружу не отдаётся. Чужие руки не нужны: у защитника ставка
// атакующего уже известна, атакующему показываем исход «если защитник ничего не добавит».
import { applyMove, cloneState } from './vendor/engine/engine.js';

const FIXED = () => 0.5; // добор на копии ни на что из отдаваемого не влияет

/** Исход для решающего в фазах warSupport, revoltSupport, warChoose; иначе null. Индексы игроков — движка. */
export function conflictPreview(s, legal) {
  if (s.phase === 'warChoose') {
    return {
      kind: 'warChoose',
      options: legal.map((m) => {
        const c = cloneState(s);
        applyMove(c, m, FIXED);
        const w = c.ctx.war;
        return { color: m.color, att: w.att, def: w.def, attBoard: w.attBoard, defBoard: w.defBoard };
      }),
    };
  }
  if (s.phase !== 'warSupport' && s.phase !== 'revoltSupport') return null;
  const kind = s.phase === 'warSupport' ? 'war' : 'revolt';
  const k = kind === 'war' ? s.ctx.war : s.ctx.revolt;
  const attackerDecides = k.attN === null;
  const options = legal.map((m) => {
    const c = cloneState(s);
    c.log = [];
    applyMove(c, m, FIXED);
    if (attackerDecides && c.phase === s.phase) applyMove(c, { type: 'support', n: 0 }, FIXED);
    const i = c.log.findIndex((e) => e.ev === kind);
    const e = c.log[i];
    let points = 1; // восстание: победителю +1 красный
    let removedTiles = 0;
    const leadersReturned = [];
    for (let j = i + 1; j < c.log.length; j++) {
      const x = c.log[j];
      if (x.ev === 'score' && x.why === 'war') {
        points = x.n;
        removedTiles = x.n - 1; // 1 за лидера и по одному за снятый тайл
      } else if (x.ev === 'leaderReturned') {
        leadersReturned.push({ p: x.p, c: x.c });
      } else break;
    }
    return { n: m.n, winner: e.winner, loser: e.loser, attTotal: e.attTotal, defTotal: e.defTotal, points, pointsColor: kind === 'war' ? k.color : 0, removedTiles, leadersReturned };
  });
  return { kind, attackerDecides, color: kind === 'war' ? k.color : k.leaderColor, options };
}
