// Таблица в конце партии: подсчет по журналу сходится с очками настоящей партии.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchStats, turnsOf, STAT_ROWS } from '../public/js/matchstats.js';
import { createGame, legalMoves, applyMove } from '../game/vendor/engine/engine.js';
import { BOARDS } from '../game/vendor/engine/boards.js';
import { journalEntries } from '../game/journal.js';
import { makeRng } from '../game/vendor/engine/rng.js';

test('ходы игрока по очереди', () => {
  assert.deepEqual([0, 1, 2].map((i) => turnsOf(i, 3, 7)), [3, 2, 2]);
  assert.deepEqual([0, 1, 2].map((i) => turnsOf(i, 3, 1)), [1, 0, 0]);
  assert.equal(turnsOf(1, 2, 2), 1);
});

test('бои считаются по роли, очки по источнику', () => {
  const log = [
    { ev: 'revolt', winner: 0, loser: 1, att: 0, def: 1 },
    { ev: 'score', seat: 0, c: 0, n: 1, why: 'revolt' },
    { ev: 'revolt', winner: 0, loser: 1, att: 1, def: 0 },
    { ev: 'war', winner: 1, loser: 0, att: 0, def: 1 },
    { ev: 'score', seat: 1, c: 3, n: 4, why: 'war' },
    { ev: 'monument', seat: 0, id: 1, tl: 5 },
    { ev: 'wonder', seat: 1, center: 40 },
    { ev: 'catastrophe', seat: 1, pos: 9 },
    { ev: 'score', seat: 0, c: 2, n: 2, why: 'monument' },
    { ev: 'score', seat: 1, c: 1, n: 1, why: 'wonder' },
    { ev: 'score', seat: 0, c: 2, n: 1, why: 'tile' },
    { ev: 'tile', seat: 0, c: 2, pos: 3 },
  ];
  const s = matchStats(log, [0, 1]);
  assert.equal(s[0].revoltWinAtt, 1);
  assert.equal(s[0].revoltWinDef, 1);
  assert.equal(s[1].revoltLoseDef, 1);
  assert.equal(s[1].revoltLoseAtt, 1);
  assert.equal(s[0].warLoseAtt, 1);
  assert.equal(s[1].warWinDef, 1);
  assert.equal(s[0].monuments, 1);
  assert.equal(s[1].monuments, 1, 'чудо считается монументом');
  assert.equal(s[1].catastrophes, 1);
  assert.equal(s[0].ptsRevolt, 1);
  assert.equal(s[1].ptsWar, 4);
  assert.equal(s[0].ptsMonument, 2);
  assert.equal(s[1].ptsMonument, 1);
});

test('в таблице все строки BGA, у каждой есть значение', () => {
  assert.equal(STAT_ROWS.length, 18);
  const s = matchStats([], [0])[0], r = { score: [1, 2, 3, 4], treasures: 5 };
  assert.deepEqual(STAT_ROWS.slice(0, 5).map(([, f]) => f(s, r)), [1, 4, 3, 2, 5], 'порядок цветов как на BGA');
  for (const [name, f] of STAT_ROWS) assert.equal(typeof f(s, r), 'number', name);
});

test('настоящие партии: очки из таблицы складываются в счет игрока, бои сходятся', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const rng = makeRng(seed);
    const s = createGame({ layout: BOARDS.advanced, numPlayers: 3, cfg: { englishSupport: seed % 2 === 0, buildings: true, wonder: true } }, rng);
    const order = [0, 1, 2], log = [];
    s.log = [];
    for (let k = 0; k < 200000 && !s.over; k++) {
      const moves = legalMoves(s);
      const meta = { turn: s.turn, cur: s.cur, action: s.actionNo };
      const m = moves[Math.floor(rng() * moves.length)];
      s.log = [];
      applyMove(s, m, rng);
      log.push(...journalEntries(s.log, order, meta));
    }
    assert.ok(s.over, `партия ${seed} закончилась`);
    const st = matchStats(log, order);
    let wins = 0, loses = 0;
    for (const p of order) {
      const x = st[p], total = s.players[p].score.reduce((a, b) => a + b, 0);
      assert.equal(x.ptsTile + x.ptsWar + x.ptsRevolt + x.ptsMonument, total, `партия ${seed}, игрок ${p}`);
      wins += x.warWinAtt + x.warWinDef + x.revoltWinAtt + x.revoltWinDef;
      loses += x.warLoseAtt + x.warLoseDef + x.revoltLoseAtt + x.revoltLoseDef;
      assert.equal(x.catastrophes, 2 - s.players[p].cats, 'катастрофы');
    }
    assert.equal(wins, loses, 'у каждого боя победитель и проигравший');
  }
});
