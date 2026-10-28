// Исход вариантов в окне войны совпадает с тем, что потом делает движок (A8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conflictPreview } from '../game/preview.js';
import { createGame, legalMoves, applyMove, cloneState } from '../game/vendor/engine/engine.js';
import { BOARDS } from '../game/vendor/engine/boards.js';
import { makeRng } from '../game/vendor/engine/rng.js';

const CFG = { englishSupport: true, buildings: true, wonder: true };

/** Применить вариант на настоящем продолжении партии и снять факт конфликта. */
function actual(s, move) {
  const c = cloneState(s);
  c.log = [];
  const attackerDecides = (c.phase === 'warSupport' ? c.ctx.war : c.ctx.revolt)?.attN === null;
  applyMove(c, move, makeRng(1));
  if (attackerDecides && (c.phase === 'warSupport' || c.phase === 'revoltSupport')) applyMove(c, { type: 'support', n: 0 }, makeRng(2));
  const i = c.log.findIndex((e) => e.ev === 'war' || e.ev === 'revolt');
  const e = c.log[i];
  const sc = e.ev === 'war' ? c.log.slice(i + 1).find((x) => x.ev === 'score' && x.why === 'war') : null;
  return { winner: e.winner, loser: e.loser, attTotal: e.attTotal, defTotal: e.defTotal, points: sc ? sc.n : 1 };
}

test('исход поддержки: атакующий, защитник, восстание; выбор цвета войны', () => {
  const seen = { war: 0, revolt: 0, att: 0, def: 0, choose: 0 };
  for (let seed = 1; seed <= 400 && (seen.choose < 3 || seen.revolt < 20 || seen.war < 20); seed++) {
    const r = makeRng(seed);
    const s = createGame({ layout: seed % 2 ? BOARDS.advanced : BOARDS.standard, numPlayers: 3 + (seed % 2), cfg: CFG }, r);
    for (let step = 0; step < 3000 && !s.over; step++) {
      const legal = legalMoves(s);
      if (s.phase === 'warSupport' || s.phase === 'revoltSupport') {
        const k = s.phase === 'warSupport' ? s.ctx.war : s.ctx.revolt;
        const pv = conflictPreview(s, legal);
        assert.equal(pv.kind, s.phase === 'warSupport' ? 'war' : 'revolt');
        assert.equal(pv.attackerDecides, k.attN === null);
        assert.deepEqual(pv.options.map((o) => o.n), legal.map((m) => m.n));
        for (const o of pv.options) {
          const a = actual(s, { type: 'support', n: o.n });
          assert.deepEqual([o.winner, o.loser, o.attTotal, o.defTotal, o.points], [a.winner, a.loser, a.attTotal, a.defTotal, a.points]);
          if (pv.kind === 'war') assert.equal(o.removedTiles, a.points - 1);
        }
        seen[pv.kind]++;
        seen[k.attN === null ? 'att' : 'def']++;
      } else if (s.phase === 'warChoose') {
        const pv = conflictPreview(s, legal);
        assert.equal(pv.kind, 'warChoose');
        for (const o of pv.options) {
          const c = cloneState(s);
          applyMove(c, { type: 'warColor', color: o.color }, makeRng(1));
          const w = c.ctx.war;
          assert.deepEqual([o.att, o.def, o.attBoard, o.defBoard], [w.att, w.def, w.attBoard, w.defBoard]);
        }
        seen.choose++;
      } else {
        assert.equal(conflictPreview(s, legal), null);
      }
      applyMove(s, legal[Math.floor(r() * legal.length)], r);
    }
  }
  for (const k of ['war', 'revolt', 'att', 'def', 'choose']) assert.ok(seen[k] > 0, `не встретилось: ${k}`);
});

test('исход не меняет переданное состояние', () => {
  const r = makeRng(5);
  const s = createGame({ layout: BOARDS.advanced, numPlayers: 4, cfg: CFG }, r);
  for (let step = 0; step < 3000 && !s.over; step++) {
    const legal = legalMoves(s);
    if (s.phase === 'warSupport') {
      const before = JSON.stringify({ ...s, log: null, tile: [...s.tile], leader: [...s.leader] });
      conflictPreview(s, legal);
      assert.equal(JSON.stringify({ ...s, log: null, tile: [...s.tile], leader: [...s.leader] }), before);
      return;
    }
    applyMove(s, legal[Math.floor(r() * legal.length)], r);
  }
});
