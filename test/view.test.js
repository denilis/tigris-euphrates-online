// Вид стола для игрока: скрытое не утекает ни на байт (A3), журнал по местам.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewFor } from '../game/view.js';
import { stateFromJSON, stateToJSON } from '../game/serialize.js';
import { started, playOut, USERS, makeRng } from './support.js';

/**
 * Копия стола, где у всех, кроме смотрящего, другое скрытое: состав руки (то же число
 * тайлов), сбросы (то же число), состав мешка (то же число), при закрытом счёте очки.
 */
function scramble(t, viewerP, r) {
  const u = structuredClone(t);
  const s = stateFromJSON(u.game.state);
  const shuffle4 = (a) => {
    const total = a.reduce((x, y) => x + y, 0);
    const out = [0, 0, 0, 0];
    for (let k = 0; k < total; k++) out[Math.floor(r() * 4)]++;
    return out;
  };
  s.players.forEach((pl, p) => {
    if (p === viewerP) return;
    pl.hand = shuffle4(pl.hand);
    pl.discarded = shuffle4(pl.discarded);
    if (!t.options.openScore && !s.over) pl.score = pl.score.map((v) => v + Math.floor(r() * 5));
  });
  s.bag = shuffle4(s.bag);
  s.removed = shuffle4(s.removed);
  u.game.state = stateToJSON(s);
  return u;
}

test('скрытое не влияет на ответ игроку: 50 партий, каждый 5-й шаг, каждое место', () => {
  let checks = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const t = started(seed, { openScore: seed % 5 === 0 });
    const r = makeRng(seed + 500);
    playOut(t, seed, (tt, step) => {
      if (step % 5) return;
      const s = stateFromJSON(tt.game.state);
      for (const seat of tt.seats.filter((x) => x.kind === 'human')) {
        const p = tt.game.order.indexOf(seat.id);
        const a = JSON.stringify(viewFor(tt, seat.userId));
        const b = JSON.stringify(viewFor(scramble(tt, p, r), seat.userId));
        assert.equal(b, a, `партия ${seed}, шаг ${step}, смотрит ${seat.name}, фаза ${s.phase}`);
        checks++;
      }
    });
  }
  assert.ok(checks > 5000, `проверок ${checks}`);
});

test('свой вид: своя рука, у соперников только число тайлов, мешок процентом', () => {
  const t = started(21);
  const v = viewFor(t, USERS.andrey.userId);
  const me = v.me;
  const s = stateFromJSON(t.game.state);
  const p = t.game.order.indexOf(me);
  assert.deepEqual(v.game.hand, s.players[p].hand);
  assert.deepEqual(v.game.discarded, s.players[p].discarded);
  for (const pl of v.game.players) {
    assert.equal('hand' in pl, false);
    assert.equal('discarded' in pl, false);
    assert.equal(pl.handCount, 6);
  }
  assert.equal(typeof v.game.bagPct, 'number');
  const raw = JSON.stringify(v);
  for (const key of ['"bag":', '"removed":', '"userId":']) assert.ok(!raw.includes(key), `в виде есть ${key}`);
});

test('закрытый счёт: чужих очков нет, свои есть; открытый: видны все; в конце видны все', () => {
  const closed = started(22);
  const vc = viewFor(closed, USERS.denis.userId);
  for (const pl of vc.game.players) assert.equal(pl.score === null, pl.seat !== vc.me);
  const open = started(22, { openScore: true });
  for (const pl of viewFor(open, USERS.denis.userId).game.players) assert.ok(Array.isArray(pl.score));
  playOut(closed, 22);
  const end = viewFor(closed, USERS.denis.userId);
  for (const pl of end.game.players) assert.ok(Array.isArray(pl.score));
  assert.ok(end.game.result);
});

test('список ходов и исход только у того, кто решает; кто решает, видят все', () => {
  const t = started(23);
  let checked = 0;
  playOut(t, 23, (tt) => {
    const s = stateFromJSON(tt.game.state);
    const decider = tt.game.order[s.toMove];
    for (const seat of tt.seats.filter((x) => x.kind === 'human')) {
      const v = viewFor(tt, seat.userId);
      assert.equal(v.game.toMove, decider);
      if (seat.id === decider) assert.ok(Array.isArray(v.game.legal) && v.game.legal.length > 0);
      else assert.equal(v.game.legal, null);
      if (seat.id !== decider) assert.equal(v.game.preview, null);
      checked++;
    }
  });
  assert.ok(checked > 100);
});

test('журнал: игроки названы местами за столом, восстание даёт запись очка', () => {
  let revolts = 0;
  for (let seed = 30; seed < 45; seed++) {
    const t = started(seed);
    playOut(t, seed);
    const seatIds = new Set(t.seats.map((x) => x.id));
    for (const e of t.game.log) {
      for (const k of ['seat', 'att', 'def', 'winner', 'loser', 'actor']) if (k in e) assert.ok(seatIds.has(e[k]), `${e.ev}.${k}=${e[k]}`);
      assert.equal('p' in e, false);
    }
    for (let i = 0; i < t.game.log.length; i++) {
      const e = t.game.log[i];
      if (e.ev !== 'revolt') continue;
      revolts++;
      const sc = t.game.log[i + 1];
      assert.deepEqual([sc.ev, sc.seat, sc.c, sc.n, sc.why], ['score', e.winner, 0, 1, 'revolt']);
    }
  }
  assert.ok(revolts > 0, 'в случайных партиях должны быть восстания');
});

test('журнал отдаётся с нужного места', () => {
  const t = started(24);
  playOut(t, 24);
  const all = viewFor(t, USERS.vlad.userId).game;
  const tail = viewFor(t, USERS.vlad.userId, { logFrom: all.logTotal - 3 }).game;
  assert.equal(tail.log.length, 3);
  assert.deepEqual(tail.log, all.log.slice(-3));
});
