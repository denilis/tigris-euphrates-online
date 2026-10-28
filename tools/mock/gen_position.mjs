// Генерирует настоящую позицию для макета экрана партии: 4 бота играют
// на продвинутом поле со всеми вариантами, ловим войну после 12-го хода.
//   node gen_position.mjs <путь к tigris-bot> <выход.json> [seed]
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const [botDir, outFile, seedArg] = process.argv.slice(2);
const imp = (p) => import(pathToFileURL(path.join(botDir, p)).href);
const E = await imp('engine/engine.js');
const { makeRng } = await imp('engine/rng.js');
const { BOARDS } = await imp('engine/boards.js');
const { makeView } = await imp('bot/belief.js');
const { decide } = await imp('bot/bot.js');

const A = (x) => Array.from(x);
function ser(s) {
  const comps = E.components(s);
  const out = {
    tile: A(s.tile), leader: A(s.leader), treasure: A(s.treasure), building: A(s.building),
    monument: A(s.monument), lab: A(comps.lab),
    players: s.players.map((p) => ({ ...p, hand: [...p.hand], leaders: [...p.leaders], score: [...p.score] })),
    bag: [...s.bag], monuments: s.monuments, wonderPos: s.wonderPos, buildingPos: [...s.buildingPos],
    cur: s.cur, actionNo: s.actionNo, turn: s.turn, phase: s.phase, toMove: s.toMove,
    ctx: s.ctx ? JSON.parse(JSON.stringify(s.ctx)) : null,
  };
  if (s.phase === 'action') {
    out.tileTargets = [0, 1, 2, 3].map((c) => E.tileTargets(s, c));
    out.leaderTargets = [0, 1, 2, 3].map((c) => E.leaderTargets(s, s.cur, c));
  }
  return out;
}

function tryGame(seed) {
  const rng = makeRng(seed);
  const botRng = makeRng(seed + 7919);
  const s = E.createGame({ layout: BOARDS.advanced, numPlayers: 4, cfg: { englishSupport: true, buildings: true, wonder: true } }, rng);
  s.log = [];
  const events = [];
  const snaps = [];
  const settings = { strength: 0, errors: 0, style: 'base' };
  let guard = 0;
  while (!s.over && guard++ < 3000) {
    if (s.phase === 'action') snaps.push({ at: events.length, st: ser(s) });
    const monOnBoard = s.monuments.some((m) => m.pos >= 0) || s.wonderPos >= 0;
    const w = s.ctx && s.ctx.war;
    if (s.phase === 'warSupport' && s.turn >= 18 && s.turn <= 40 && monOnBoard && w.attN !== null
        && E.legalMoves(s).length >= 2 && Math.abs(w.attBoard + w.attN - w.defBoard) <= 3) {
      const p = s.toMove;
      const turnSnap = [...snaps].reverse().find((x) => x.st.cur === p && x.st.actionNo === 1 && x.st.turn < s.turn);
      if (!turnSnap) return null;
      return { seed, me: p, war: ser(s), turnSnap: turnSnap.st, events, turnEventsAt: turnSnap.at };
    }
    const p = s.toMove;
    const view = makeView(s, p, 'none', botRng);
    const res = decide(view, settings, botRng);
    const turn = s.turn, cur = s.cur, actionNo = s.actionNo;
    E.applyMove(s, res.move, rng);
    for (const ev of s.log) events.push({ ...ev, turn, cur, actionNo });
    s.log.length = 0;
  }
  return null;
}

let seed = Number(seedArg || 1);
for (let k = 0; k < 40; k++, seed++) {
  const t0 = Date.now();
  const r = tryGame(seed);
  console.log(`seed ${seed}: ${r ? 'найдено, ход ' + r.war.turn + ', решает ' + r.me : 'нет'} (${Date.now() - t0} мс)`);
  if (r) {
    r.layout = BOARDS.advanced;
    writeFileSync(outFile, JSON.stringify(r));
    break;
  }
}
