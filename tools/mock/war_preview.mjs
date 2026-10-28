// Точный исход каждого варианта поддержки для позиции войны из position.json:
// восстанавливаем состояние движка, применяем ход поддержки, смотрим события и очки.
// В игре то же самое будет считать сервер для того, кто решает.
//   node war_preview.mjs <путь к tigris-bot> position.json
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [botDir, posFile] = process.argv.slice(2);
const imp = (p) => import(pathToFileURL(path.join(botDir, p)).href);
const E = await imp('engine/engine.js');
const { makeRng } = await imp('engine/rng.js');

const r = JSON.parse(readFileSync(posFile, 'utf8'));
const w = r.war;

function restore() {
  const s = E.createState({ layout: r.layout, numPlayers: 4, cfg: { englishSupport: true, buildings: true, wonder: true } });
  s.tile = Int8Array.from(w.tile);
  s.leader = Int8Array.from(w.leader);
  s.treasure = Uint8Array.from(w.treasure);
  s.building = Int8Array.from(w.building);
  s.monument = Int8Array.from(w.monument);
  s.players = w.players.map((p) => ({ ...p, hand: [...p.hand], leaders: [...p.leaders], score: [...p.score], discarded: [...p.discarded] }));
  s.bag = [...w.bag];
  s.monuments = w.monuments.map((m) => ({ ...m }));
  s.wonderPos = w.wonderPos;
  s.buildingPos = [...w.buildingPos];
  Object.assign(s, { cur: w.cur, actionNo: w.actionNo, turn: w.turn, phase: w.phase, toMove: w.toMove, ctx: JSON.parse(JSON.stringify(w.ctx)) });
  E.validate(s);
  return s;
}

const base = restore();
const options = E.legalMoves(base).map((m) => m.n);
const preview = {};
for (const n of options) {
  const s = restore();
  s.log = [];
  const before = s.players.map((p) => [...p.score]);
  E.applyMove(s, { type: 'support', n }, makeRng(1));
  const warEv = s.log.find((e) => e.ev === 'war');
  // очки за саму войну (дальше по очереди может идти здание или монумент, их не считаем)
  const warScore = s.log.filter((e) => e.ev === 'score' && e.why === 'war').map((e) => ({ p: e.p, c: e.c, n: e.n }));
  const lostLeaders = s.log.filter((e) => e.ev === 'leaderReturned').map((e) => ({ p: e.p, c: e.c }));
  const removed = w.tile.reduce((a, t, i) => a + (t >= 0 && t <= 3 && s.tile[i] !== t ? 1 : 0), 0);
  preview[n] = { winner: warEv?.winner ?? null, loser: warEv?.loser ?? null, warScore, lostLeaders, removedTiles: removed, before };
}
r.warPreview = preview;
writeFileSync(posFile, JSON.stringify(r));
console.log(JSON.stringify(preview, null, 1).slice(0, 1500));
