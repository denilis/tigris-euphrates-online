'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const TE = require('../shared/engine');

const at = (c, r) => TE.cellIndex(c, r);
const T = (c, extra) => Object.assign({ k: 'tile', c }, extra || {});

// Treasure temples kept in the far corner so that clearing the board does not end the game
// (it ends when only one or two treasures are left at the end of a turn).
const RESERVE = [at(15, 0), at(15, 1), at(15, 2)];

// Game with an empty board unless `keepTemples`, fixed hands and first player 0.
function setup(opts) {
  opts = opts || {};
  const n = opts.players || 2;
  const names = ['Аня', 'Борис', 'Вера', 'Глеб'].slice(0, n);
  const s = TE.createGame({ names, rng: TE.mulberry32(opts.seed || 1), firstPlayer: 0 });
  if (!opts.keepTemples) {
    s.board = new Array(TE.SIZE).fill(null);
    if (!opts.noReserve) RESERVE.forEach(i => { s.board[i] = { k: 'tile', c: 'red', tr: true }; });
  }
  if (opts.hands) opts.hands.forEach((h, p) => { s.players[p].hand = h.slice(); });
  return s;
}
function place(s, i, cell) {
  s.board[i] = cell;
  if (cell && cell.k === 'leader') s.players[cell.p].leaders[cell.c] = i;
}
function leader(s, p, color, i) { place(s, i, { k: 'leader', c: color, p }); }
function ok(s, p, action) {
  const r = TE.applyAction(s, p, action);
  assert.ok(r.ok, `expected ok for ${JSON.stringify(action)}, got: ${r.error}`);
  return r.state;
}
function bad(s, p, action, fragment) {
  const r = TE.applyAction(s, p, action);
  assert.equal(r.ok, false, `expected failure for ${JSON.stringify(action)}`);
  if (fragment) assert.match(r.error, new RegExp(fragment));
  return r;
}

// ─── SETUP ─────────────────────────────────────────────────────────────────────

test('setup: board, bag, hands and pieces follow the rulebook', () => {
  for (const n of [2, 3, 4]) {
    const s = TE.createGame({ names: Array.from({ length: n }, (_, i) => `P${i}`), rng: TE.mulberry32(n) });
    const temples = s.board.map((c, i) => (c ? i : -1)).filter(i => i >= 0);
    assert.deepEqual(temples.sort((a, b) => a - b), TE.START_TEMPLES.slice().sort((a, b) => a - b));
    temples.forEach(i => assert.deepEqual(s.board[i], { k: 'tile', c: 'red', tr: true }));
    assert.equal(s.bag.length, 143 - 6 * n);
    s.players.forEach(pl => {
      assert.equal(pl.hand.length, 6);
      assert.equal(pl.catastrophes, 2);
      assert.deepEqual(pl.leaders, { red: null, blue: null, green: null, black: null });
    });
    const all = s.bag.concat(...s.players.map(p => p.hand));
    assert.equal(all.filter(c => c === 'red').length, 47);
    assert.equal(all.filter(c => c === 'blue').length, 36);
    assert.equal(all.filter(c => c === 'green').length, 30);
    assert.equal(all.filter(c => c === 'black').length, 30);
    assert.ok(s.current >= 0 && s.current < n);
  }
});

test('setup: rivers and temples are consistent', () => {
  assert.equal(TE.RIVER.filter(Boolean).length, 44);
  TE.START_TEMPLES.forEach(i => assert.equal(TE.RIVER[i], false));
  // Every river square touches another river square (rivers are continuous).
  TE.RIVER.forEach((r, i) => { if (r) assert.ok(TE.NEIGHBORS[i].some(n => TE.RIVER[n]), `isolated river ${i}`); });
});

test('setup: rejects bad player counts and dynasties', () => {
  assert.throws(() => TE.createGame({ names: ['a'] }), TE.RuleError);
  assert.throws(() => TE.createGame({ names: ['a', 'b', 'c', 'd', 'e'] }), TE.RuleError);
  assert.throws(() => TE.createGame({ names: ['a', 'b'], dynasties: ['lion', 'lion'] }), TE.RuleError);
});

// ─── TILES ─────────────────────────────────────────────────────────────────────

test('tiles: farms only on rivers, other tiles only on land, never on occupied squares', () => {
  const s = setup({ hands: [['blue', 'red', 'green', 'black', 'red', 'red'], ['red']] });
  bad(s, 0, { type: 'tile', color: 'blue', cell: at(0, 0) }, 'реку');
  bad(s, 0, { type: 'tile', color: 'red', cell: at(3, 2) }, 'только фермы');
  place(s, at(5, 5), T('red'));
  bad(s, 0, { type: 'tile', color: 'red', cell: at(5, 5) }, 'занята');
  bad(s, 1, { type: 'tile', color: 'red', cell: at(0, 0) }, 'не ваш ход');
  const s2 = ok(s, 0, { type: 'tile', color: 'blue', cell: at(3, 2) });
  assert.deepEqual(s2.board[at(3, 2)], { k: 'tile', c: 'blue' });
  assert.equal(s2.actionsLeft, 1);
  bad(s2, 0, { type: 'tile', color: 'blue', cell: at(4, 2) }, 'нет такого');
});

test('tiles: the matching leader scores, otherwise the king, regions score nothing', () => {
  const s = setup({ hands: [['green', 'blue', 'black', 'red', 'red', 'red'], ['red']] });
  place(s, at(6, 6), T('red'));
  leader(s, 1, 'green', at(7, 6)); // Борис' trader
  leader(s, 0, 'black', at(6, 7)); // Аня's king
  let s2 = ok(s, 0, { type: 'tile', color: 'green', cell: at(8, 6) });
  assert.equal(s2.players[1].vp.green, 1);
  assert.equal(s2.players[0].vp.green, 0);
  s2 = ok(s2, 0, { type: 'tile', color: 'black', cell: at(5, 6) });
  assert.equal(s2.players[0].vp.black, 1, 'king owner scores black');
  // Next turn for Борис; now Аня is on turn 3.
  const s3 = setup({ hands: [['red', 'red', 'red', 'red', 'red', 'red'], ['red']] });
  place(s3, at(6, 6), T('red'));
  leader(s3, 1, 'black', at(7, 6));
  const s4 = ok(s3, 0, { type: 'tile', color: 'red', cell: at(6, 5) });
  assert.equal(s4.players[1].vp.red, 1, 'king takes points for colors without a leader');
  const s5 = ok(s4, 0, { type: 'tile', color: 'red', cell: at(0, 0) });
  assert.deepEqual(s5.players.map(p => p.vp), s4.players.map(p => p.vp), 'isolated tile scores nothing');
});

test('tiles: cannot unite three kingdoms', () => {
  const s = setup({ players: 3, hands: [['red'], ['red'], ['red']] });
  // Three separate kingdoms around (8,5).
  place(s, at(8, 4), T('red')); leader(s, 0, 'black', at(8, 3)); place(s, at(7, 3), T('red'));
  place(s, at(7, 5), T('red')); leader(s, 1, 'black', at(6, 5)); place(s, at(5, 5), T('red'));
  place(s, at(9, 5), T('red')); leader(s, 2, 'black', at(10, 5)); place(s, at(11, 5), T('red'));
  // Kings are adjacent to temples already; the kingdoms are separate.
  bad(s, 0, { type: 'tile', color: 'red', cell: at(8, 5) }, 'больше двух');
});

test('tiles: uniting two kingdoms gives no points even without a war', () => {
  const s = setup({ hands: [['red', 'red', 'red', 'red', 'red', 'red'], ['red']] });
  place(s, at(5, 5), T('red')); leader(s, 0, 'red', at(4, 5));
  place(s, at(7, 5), T('red')); leader(s, 1, 'blue', at(8, 5));
  const s2 = ok(s, 0, { type: 'tile', color: 'red', cell: at(6, 5) });
  assert.equal(s2.players[0].vp.red, 0);
  assert.equal(s2.players[1].vp.red, 0);
  assert.equal(s2.unification, null);
  assert.equal(s2.pending, null);
});

// ─── LEADERS ───────────────────────────────────────────────────────────────────

test('leaders: must touch a temple, avoid rivers, never unite kingdoms; can move and withdraw', () => {
  const s = setup({ hands: [['red'], ['red']] });
  place(s, at(5, 5), T('red'));
  bad(s, 0, { type: 'leader', color: 'red', cell: at(0, 0) }, 'рядом с храмом');
  place(s, at(4, 3), T('red')); // next to river square (3,3)
  bad(s, 0, { type: 'leader', color: 'red', cell: at(3, 3) }, 'реку');
  // Two kingdoms with a gap at (6,6).
  place(s, at(6, 5), T('red')); leader(s, 1, 'black', at(7, 5));
  place(s, at(6, 7), T('red')); leader(s, 1, 'green', at(7, 7));
  bad(s, 0, { type: 'leader', color: 'red', cell: at(6, 6) }, 'объединять');
  let s2 = ok(s, 0, { type: 'leader', color: 'red', cell: at(5, 4) });
  assert.equal(s2.players[0].leaders.red, at(5, 4));
  bad(s2, 0, { type: 'leader', color: 'red', cell: at(5, 4) }, 'уже стоит');
  s2 = ok(s2, 0, { type: 'leader', color: 'red', cell: at(4, 5) });
  assert.equal(s2.board[at(5, 4)], null, 'moved leader leaves its square');
  assert.equal(s2.players[0].leaders.red, at(4, 5));
  // Turn passed to Борис after two actions.
  assert.equal(s2.current, 1);
  const s3 = ok(s2, 1, { type: 'withdraw', color: 'black' });
  assert.equal(s3.players[1].leaders.black, null);
  assert.equal(s3.board[at(7, 5)], null);
  bad(s3, 1, { type: 'withdraw', color: 'black' }, 'нет на поле');
});

// ─── REVOLTS ───────────────────────────────────────────────────────────────────

function revoltSetup() {
  const s = setup({
    hands: [['red', 'red', 'red', 'blue', 'blue', 'blue'], ['red', 'green', 'green', 'green', 'green', 'green']]
  });
  // Kingdom: T(5,5) L1(6,5) T(7,5) T(6,6) ... defender priest has 2 temples, attacker spot (5,4) has 1.
  place(s, at(5, 5), T('red'));
  place(s, at(7, 5), T('red'));
  place(s, at(6, 6), T('red'));
  leader(s, 1, 'red', at(6, 5)); // adjacent temples: (5,5), (7,5), (6,6) -> 3
  return s;
}

test('revolt: attacker commits first, defender second; winner +1 red; loser leaves', () => {
  let s = revoltSetup();
  s = ok(s, 0, { type: 'leader', color: 'red', cell: at(5, 4) }); // adjacent temple: (5,5) -> 1
  assert.equal(s.pending.type, 'conflict');
  assert.equal(s.pending.kind, 'revolt');
  assert.equal(s.pending.attacker.base, 1);
  assert.equal(s.pending.defender.base, 3);
  assert.equal(s.pending.player, 0);
  bad(s, 1, { type: 'commit', count: 0 }, 'другой игрок');
  bad(s, 0, { type: 'commit', count: 4 }, 'только');
  bad(s, 0, { type: 'tile', color: 'blue', cell: at(3, 2) }, 'решение');
  s = ok(s, 0, { type: 'commit', count: 3 }); // 4
  assert.equal(s.pending.player, 1);
  assert.equal(s.players[0].hand.filter(c => c === 'red').length, 0);
  s = ok(s, 1, { type: 'commit', count: 0 }); // 3
  assert.equal(s.pending, null);
  assert.equal(s.players[0].vp.red, 1);
  assert.equal(s.players[1].leaders.red, null);
  assert.equal(s.board[at(6, 5)], null);
  assert.equal(s.players[0].leaders.red, at(5, 4));
  assert.equal(s.actionsLeft, 1);
});

test('revolt: ties go to the defender; committed tiles leave the game and are refilled at turn end', () => {
  let s = revoltSetup();
  s = ok(s, 0, { type: 'leader', color: 'red', cell: at(5, 4) });
  s = ok(s, 0, { type: 'commit', count: 2 }); // 3
  s = ok(s, 1, { type: 'commit', count: 0 }); // 3 — tie
  assert.equal(s.players[1].vp.red, 1);
  assert.equal(s.players[0].leaders.red, null);
  assert.equal(s.players[1].leaders.red, at(6, 5));
  s = ok(s, 0, { type: 'end' });
  assert.equal(s.players[0].hand.length, 6);
  assert.equal(s.current, 1);
});

test('revolt: defender hand is refilled at the end of the active turn', () => {
  let s = revoltSetup();
  s.players[1].hand = ['red', 'red', 'green', 'green', 'green', 'green'];
  s = ok(s, 0, { type: 'leader', color: 'red', cell: at(5, 4) });
  s = ok(s, 0, { type: 'commit', count: 0 });
  s = ok(s, 1, { type: 'commit', count: 2 });
  assert.equal(s.players[1].hand.length, 4);
  s = ok(s, 0, { type: 'end' });
  assert.equal(s.players[1].hand.length, 6);
});

// ─── WARS ──────────────────────────────────────────────────────────────────────

// Left kingdom (Аня): trader at (4,5) with markets (3,5), (2,5); temple (4,6).
// Right kingdom (Борис): trader at (8,5) with market (9,5); temple (8,6).
// Gap at (6,5)/(5,5)/(7,5): placing a market at (6,5) with (5,5),(7,5) tiles unites them.
function warSetup() {
  const s = setup({
    hands: [['green', 'green', 'green', 'red', 'red', 'red'], ['green', 'green', 'blue', 'blue', 'blue', 'blue']]
  });
  place(s, at(4, 6), T('red')); leader(s, 0, 'green', at(4, 5));
  place(s, at(3, 5), T('green')); place(s, at(2, 5), T('green'));
  place(s, at(5, 5), T('black'));
  place(s, at(8, 6), T('red')); leader(s, 1, 'green', at(8, 5));
  place(s, at(9, 5), T('green'));
  place(s, at(7, 5), T('black'));
  return s;
}

test('war: supporters exclude the unification tile; loser loses leader and supporters', () => {
  let s = warSetup();
  s = ok(s, 0, { type: 'tile', color: 'green', cell: at(6, 5) });
  assert.equal(s.unification, at(6, 5));
  assert.equal(s.pending.kind, 'war');
  assert.equal(s.pending.attacker.player, 0, 'active player attacks');
  assert.equal(s.pending.attacker.base, 2);
  assert.equal(s.pending.defender.base, 1);
  s = ok(s, 0, { type: 'commit', count: 0 });
  s = ok(s, 1, { type: 'commit', count: 2 }); // 3 vs 2 — defender wins
  assert.equal(s.pending, null);
  assert.equal(s.unification, null);
  assert.equal(s.players[1].vp.green, 3, '1 leader + 2 markets');
  assert.equal(s.players[0].leaders.green, null);
  assert.equal(s.board[at(3, 5)], null);
  assert.equal(s.board[at(2, 5)], null);
  assert.deepEqual(s.board[at(6, 5)], { k: 'tile', c: 'green' }, 'unification tile stays');
  assert.equal(s.players[0].vp.green, 0, 'the uniting tile scores nothing');
  assert.deepEqual(s.board[at(9, 5)], { k: 'tile', c: 'green' });
});

test('war: lost war of priests keeps temples with treasures or next to other leaders', () => {
  const s0 = setup({ hands: [['black', 'red', 'red', 'red', 'red', 'red'], ['red', 'red', 'red', 'red', 'red', 'red']] });
  // Left (Аня): priest (5,6); temples (5,7) with treasure, (4,6) next to her king (3,6), (5,5) and (4,5) plain.
  leader(s0, 0, 'red', at(5, 6));
  place(s0, at(5, 7), T('red', { tr: true }));
  place(s0, at(4, 6), T('red'));
  leader(s0, 0, 'black', at(3, 6));
  place(s0, at(5, 5), T('red'));
  place(s0, at(4, 5), T('red'));
  place(s0, at(6, 6), T('green'));
  // Right (Борис): priest (8,6) with five temples.
  leader(s0, 1, 'red', at(8, 6));
  [at(9, 6), at(8, 5), at(8, 7), at(9, 5), at(9, 7)].forEach(i => place(s0, i, T('red')));
  let s = ok(s0, 0, { type: 'tile', color: 'black', cell: at(7, 6) });
  assert.equal(s.pending.kind, 'war');
  assert.equal(s.pending.color, 'red');
  assert.equal(s.pending.attacker.base, 4, 'left: 4 temples incl. the treasure one');
  assert.equal(s.pending.defender.base, 5);
  s = ok(s, 0, { type: 'commit', count: 0 });
  s = ok(s, 1, { type: 'commit', count: 0 });
  assert.ok(s.board[at(5, 7)], 'treasure temple stays');
  assert.ok(s.board[at(4, 6)], 'temple next to the king stays');
  assert.equal(s.board[at(5, 5)], null);
  assert.equal(s.board[at(4, 5)], null);
  assert.equal(s.players[1].vp.red, 3, 'leader + 2 removed temples');
  assert.equal(s.players[0].leaders.black, at(3, 6), 'king still supported');
  assert.equal(s.players[0].leaders.red, null);
});

test('war: active player picks the order; later wars use the current configuration', () => {
  const s0 = setup({ hands: [['black', 'red', 'red', 'red', 'red', 'red'], ['red', 'red', 'red', 'red', 'red', 'red']] });
  // Left kingdom (Аня): priest (3,5) + king (3,6); temples (2,5), (2,6).
  place(s0, at(2, 5), T('red')); place(s0, at(2, 6), T('red'));
  leader(s0, 0, 'red', at(3, 5)); leader(s0, 0, 'black', at(3, 6));
  place(s0, at(4, 5), T('red'));
  // Right kingdom (Борис): priest (6,5) + king (6,4); temples (7,5), (7,4), (6,6), (7,6).
  leader(s0, 1, 'red', at(6, 5)); leader(s0, 1, 'black', at(6, 4));
  place(s0, at(7, 5), T('red')); place(s0, at(7, 4), T('red')); place(s0, at(6, 6), T('red')); place(s0, at(7, 6), T('red'));
  let s = ok(s0, 0, { type: 'tile', color: 'black', cell: at(5, 5) });
  assert.equal(s.pending.type, 'warChoice');
  assert.deepEqual(s.pending.colors.sort(), ['black', 'red']);
  bad(s, 0, { type: 'war', color: 'green' }, 'одну из войн');
  s = ok(s, 0, { type: 'war', color: 'red' });
  assert.equal(s.pending.color, 'red');
  // Left red support: (2,5),(2,6),(4,5) = 3; right: 4.
  assert.equal(s.pending.attacker.base, 3);
  assert.equal(s.pending.defender.base, 4);
  s = ok(s, 0, { type: 'commit', count: 0 });
  s = ok(s, 1, { type: 'commit', count: 0 });
  // (4,5) and (2,5) touch no remaining leader and are removed; (2,6) touches the king (3,6) and stays.
  assert.equal(s.board[at(4, 5)], null);
  assert.equal(s.board[at(2, 5)], null);
  assert.ok(s.board[at(2, 6)]);
  assert.equal(s.players[1].vp.red, 3);
  // Kingdoms are now disconnected: (4,5) is gone so the black war cannot happen.
  assert.equal(s.pending, null);
  assert.equal(s.unification, null);
  assert.equal(s.players[0].leaders.black, at(3, 6));
  assert.equal(s.players[1].leaders.black, at(6, 4));
});

test('war: when the active player is not involved, the next involved player clockwise attacks', () => {
  const s0 = setup({ players: 3, hands: [['green'], ['green', 'green'], ['green', 'green']] });
  s0.current = 0;
  place(s0, at(4, 6), T('red')); leader(s0, 2, 'green', at(4, 5)); place(s0, at(5, 5), T('green'));
  place(s0, at(8, 6), T('red')); leader(s0, 1, 'green', at(8, 5)); place(s0, at(7, 5), T('green'));
  const s = ok(s0, 0, { type: 'tile', color: 'green', cell: at(6, 5) });
  assert.equal(s.pending.attacker.player, 1, 'Борис sits right after Аня');
  assert.equal(s.pending.defender.player, 2);
});

// ─── CATASTROPHES ──────────────────────────────────────────────────────────────

test('catastrophe: blocked squares, destroyed tiles and unsupported leaders', () => {
  let s = setup({ hands: [['red'], ['red']] });
  place(s, at(5, 5), T('red'));
  leader(s, 1, 'black', at(5, 6));
  place(s, at(9, 9), T('red', { tr: true }));
  place(s, at(2, 2), { k: 'cat', p: 1 });
  place(s, at(12, 1), T('red', { down: true, mon: 0 }));
  bad(s, 0, { type: 'catastrophe', cell: at(5, 6) }, 'лидера');
  bad(s, 0, { type: 'catastrophe', cell: at(9, 9) }, 'сокровищ');
  bad(s, 0, { type: 'catastrophe', cell: at(2, 2) }, 'уже катастрофа');
  bad(s, 0, { type: 'catastrophe', cell: at(12, 1) }, 'монумент');
  s = ok(s, 0, { type: 'catastrophe', cell: at(5, 5) });
  assert.deepEqual(s.board[at(5, 5)], { k: 'cat', p: 0 });
  assert.equal(s.players[1].leaders.black, null, 'king lost its only temple');
  assert.equal(s.board[at(5, 6)], null);
  assert.equal(s.players[0].catastrophes, 1);
  s = ok(s, 0, { type: 'catastrophe', cell: at(3, 2) }); // empty river square is fine
  assert.equal(s.players[0].catastrophes, 0);
  s.current = 0; s.actionsLeft = 2;
  bad(s, 0, { type: 'catastrophe', cell: at(0, 0) }, 'закончились');
  bad(s, 0, { type: 'tile', color: 'blue', cell: at(3, 2) }, null);
});

// ─── REPLACING TILES ───────────────────────────────────────────────────────────

test('swap: discarded tiles leave the game and the same number is drawn', () => {
  let s = setup({ hands: [['red', 'red', 'blue', 'green', 'black', 'black'], ['red']] });
  const bag = s.bag.length;
  bad(s, 0, { type: 'swap', tiles: [] }, 'от 1 до 6');
  bad(s, 0, { type: 'swap', tiles: ['blue', 'blue'] }, 'нет таких');
  bad(s, 0, { type: 'swap', tiles: ['purple'] }, 'цвет');
  s = ok(s, 0, { type: 'swap', tiles: ['red', 'black', 'black'] });
  assert.equal(s.players[0].hand.length, 6);
  assert.equal(s.bag.length, bag - 3, 'discards do not return to the bag');
});

// ─── MONUMENTS ─────────────────────────────────────────────────────────────────

test('monument: completing a 2x2 square offers a monument; building flips the tiles', () => {
  let s = setup({ hands: [['red', 'red', 'red', 'red', 'red', 'red'], ['red']] });
  place(s, at(5, 5), T('red', { tr: true })); place(s, at(6, 5), T('red')); place(s, at(5, 6), T('red'));
  leader(s, 1, 'green', at(7, 5)); // next to (6,5) only
  leader(s, 0, 'black', at(4, 5)); // next to (5,5) only
  place(s, at(4, 6), T('red'));    // keeps Аня's king supported
  s = ok(s, 0, { type: 'tile', color: 'red', cell: at(6, 6) });
  assert.equal(s.pending.type, 'monument');
  const opt = s.pending.options[0];
  assert.equal(opt.at, at(5, 5));
  assert.deepEqual(opt.monuments.sort(), [2, 3, 4]);
  bad(s, 0, { type: 'monument', at: at(5, 5), monument: 0 }, 'нельзя');
  s = ok(s, 0, { type: 'monument', at: at(5, 5), monument: 4 });
  assert.equal(s.monuments[4].at, at(5, 5));
  [at(5, 5), at(6, 5), at(5, 6), at(6, 6)].forEach(i => { assert.equal(s.board[i].down, true); assert.equal(s.board[i].mon, 4); });
  assert.equal(s.board[at(5, 5)].tr, true, 'treasure stays on the flipped temple');
  assert.equal(s.players[1].leaders.green, null, 'trader lost temple support');
  assert.equal(s.players[0].leaders.black, at(4, 5), 'king still next to (4,6)');
});

test('monument: can be declined; monument points at the end of the owner turn only', () => {
  let s = setup({ hands: [['black', 'black', 'red', 'red', 'red', 'red'], ['red', 'red', 'red', 'red', 'red', 'red']] });
  place(s, at(5, 5), T('black')); place(s, at(6, 5), T('black')); place(s, at(5, 6), T('black'));
  place(s, at(7, 7), T('red')); leader(s, 0, 'black', at(7, 6)); // Аня's king touches (6,6)? no: (7,6) touches (6,6)
  let d = ok(s, 0, { type: 'tile', color: 'black', cell: at(6, 6) });
  assert.equal(d.pending.type, 'monument');
  d = ok(d, 0, { type: 'monument', decline: true });
  assert.equal(d.pending, null);
  assert.ok([at(5, 5), at(6, 5), at(5, 6), at(6, 6)].every(i => !d.board[i].down));

  s = ok(s, 0, { type: 'tile', color: 'black', cell: at(6, 6) });
  // King scored 1 black for the settlement placed in its kingdom.
  assert.equal(s.players[0].vp.black, 1);
  s = ok(s, 0, { type: 'monument', at: at(5, 5), monument: 0 }); // green + black
  s = ok(s, 0, { type: 'end' });
  assert.equal(s.players[0].vp.black, 2, '+1 black from the monument at turn end');
  assert.equal(s.players[0].vp.green, 0);
  s = ok(s, 1, { type: 'end' });
  assert.equal(s.players[0].vp.black, 2, 'no monument points on other players turns');
});

// ─── TREASURES ─────────────────────────────────────────────────────────────────

test('treasure: the trader of a kingdom with two treasures takes one (even off-turn)', () => {
  let s = setup({ hands: [['red', 'red', 'red', 'red', 'red', 'red'], ['red']] });
  place(s, at(5, 5), T('red', { tr: true }));
  place(s, at(7, 5), T('red', { tr: true }));
  leader(s, 1, 'green', at(5, 4));
  s = ok(s, 0, { type: 'tile', color: 'red', cell: at(6, 5) });
  assert.equal(s.pending.type, 'treasure');
  assert.equal(s.pending.player, 1);
  assert.deepEqual(s.pending.cells, [at(5, 5), at(7, 5)]);
  bad(s, 0, { type: 'treasure', cell: at(5, 5) }, 'другой игрок');
  bad(s, 1, { type: 'treasure', cell: at(6, 5) }, 'сокровище');
  s = ok(s, 1, { type: 'treasure', cell: at(7, 5) });
  assert.equal(s.players[1].treasures, 1);
  assert.equal(s.board[at(7, 5)].tr, false);
  assert.equal(s.board[at(5, 5)].tr, true);
  assert.equal(s.pending, null);
  assert.equal(s.current, 0);
  assert.equal(s.players[0].vp.red, 0, 'no priest and no king: nobody scores');
});

// ─── TURN FLOW AND GAME END ────────────────────────────────────────────────────

test('turns: two actions end the turn, hands are refilled, not-your-turn is rejected', () => {
  let s = setup({ keepTemples: true, hands: [['red', 'red', 'red', 'red', 'red', 'red'], ['blue']] });
  s = ok(s, 0, { type: 'tile', color: 'red', cell: at(8, 6) });
  assert.equal(s.current, 0);
  s = ok(s, 0, { type: 'tile', color: 'red', cell: at(8, 7) });
  assert.equal(s.current, 1);
  assert.equal(s.players[0].hand.length, 6);
  assert.equal(s.actionsLeft, 2);
  assert.equal(s.turn, 2);
  bad(s, 0, { type: 'end' }, 'не ваш ход');
});

test('game end: two treasures left at the end of a turn', () => {
  let s = setup({ noReserve: true, hands: [['red', 'red', 'red', 'red', 'red', 'red'], ['red']] });
  place(s, at(0, 0), T('red', { tr: true }));
  place(s, at(15, 10), T('red', { tr: true }));
  s = ok(s, 0, { type: 'end' });
  assert.equal(s.phase, 'over');
  assert.equal(s.endReason, 'treasures');
  assert.ok(s.result.ranking.length === 2);
  bad(s, 1, { type: 'end' }, 'окончена');
});

test('game end: the bag runs out while refilling', () => {
  let s = setup({ keepTemples: true, hands: [['red', 'red', 'red', 'red', 'red', 'red'], ['red']] });
  s.bag = ['blue'];
  s = ok(s, 0, { type: 'tile', color: 'red', cell: at(8, 6) });
  s = ok(s, 0, { type: 'tile', color: 'red', cell: at(8, 7) });
  assert.equal(s.phase, 'over');
  assert.equal(s.endReason, 'bag');
});

test('game end: swap that empties the bag ends the game', () => {
  let s = setup({ keepTemples: true, hands: [['red', 'red', 'red', 'red', 'red', 'red'], ['red']] });
  s.bag = ['blue', 'green'];
  s = ok(s, 0, { type: 'swap', tiles: ['red', 'red', 'red'] });
  assert.equal(s.phase, 'over');
});

test('scoring: treasures fill the weakest spheres; ties compare the next sphere', () => {
  const players = [
    { name: 'A', dynasty: 'lion', vp: { red: 5, blue: 2, green: 7, black: 3 }, treasures: 3 },
    { name: 'B', dynasty: 'bow', vp: { red: 4, blue: 4, green: 4, black: 9 }, treasures: 0 },
    { name: 'C', dynasty: 'pot', vp: { red: 4, blue: 4, green: 5, black: 4 }, treasures: 0 }
  ];
  const r = TE.computeResult(players);
  const byName = Object.fromEntries(r.ranking.map(x => [x.name, x]));
  assert.deepEqual(byName.A.sorted, [4, 4, 5, 7]); // 2+2 -> 4, 3+1 -> 4
  assert.equal(byName.A.score, 4);
  // A: [4,4,5,7], B: [4,4,4,9], C: [4,4,4,5] -> A first, then C over B? third sphere: A 5, B 4, C 4; fourth: B 9 > C 5.
  assert.deepEqual(r.ranking.map(x => x.name), ['A', 'B', 'C']);
  assert.deepEqual(r.winners, [0]);
  const tie = TE.computeResult([
    { name: 'X', dynasty: 'lion', vp: { red: 1, blue: 1, green: 1, black: 1 }, treasures: 0 },
    { name: 'Y', dynasty: 'bow', vp: { red: 1, blue: 1, green: 1, black: 1 }, treasures: 0 }
  ]);
  assert.deepEqual(tie.winners, [0, 1]);
  assert.deepEqual(tie.ranking.map(x => x.place), [1, 1]);
});

// ─── VIEWS ─────────────────────────────────────────────────────────────────────

test('view: hides other hands and scores until the game ends', () => {
  const s = setup({ keepTemples: true });
  const v = TE.getView(s, 1);
  assert.equal(v.you, 1);
  assert.deepEqual(v.hand.slice().sort(), s.players[1].hand.slice().sort());
  assert.equal(v.players[0].vp, undefined);
  assert.equal(v.players[0].hand, undefined);
  assert.deepEqual(v.players[1].vp, s.players[1].vp);
  assert.equal(v.bag, undefined);
  assert.equal(v.players[0].handCount, 6);
  const spectator = TE.getView(s, -1);
  assert.deepEqual(spectator.hand, []);
});

// ─── ROBUSTNESS ────────────────────────────────────────────────────────────────

test('robustness: malformed actions are rejected without touching the state', () => {
  const s = setup({ keepTemples: true });
  const snapshot = JSON.stringify(s);
  const junk = [
    null, undefined, 42, 'tile', [], {}, { type: 42 }, { type: 'tile' },
    { type: 'tile', color: 'red', cell: -1 }, { type: 'tile', color: 'red', cell: 1e9 },
    { type: 'tile', color: 'red', cell: '5' }, { type: 'tile', color: '__proto__', cell: 5 },
    { type: 'leader', color: 'constructor', cell: 5 }, { type: 'leader', color: 'red', cell: 3.5 },
    { type: 'withdraw', color: 'toString' }, { type: 'swap', tiles: 'red' },
    { type: 'swap', tiles: new Array(100).fill('red') }, { type: 'commit', count: 1 },
    { type: 'war', color: 'red' }, { type: 'monument', at: 0, monument: 0 },
    { type: 'treasure', cell: 0 }, { type: 'catastrophe', cell: null }, { type: 'nope' }
  ];
  for (const a of junk) {
    for (const p of [0, 1, -1, 7, 'x', null]) {
      const r = TE.applyAction(s, p, a);
      assert.equal(r.ok, false, JSON.stringify([p, a]));
      assert.equal(r.internal, undefined, `internal error for ${JSON.stringify([p, a])}: ${r.internal}`);
    }
  }
  assert.equal(JSON.stringify(s), snapshot);
});

// ─── RANDOM PLAYOUTS ───────────────────────────────────────────────────────────

function randomAction(s, rng) {
  const pick = arr => arr[Math.floor(rng() * arr.length)];
  const pd = s.pending;
  if (pd) {
    const p = pd.player;
    if (pd.type === 'conflict') {
      const have = s.players[p].hand.filter(c => c === pd.support).length;
      return [p, { type: 'commit', count: Math.floor(rng() * (have + 1)) }];
    }
    if (pd.type === 'warChoice') return [p, { type: 'war', color: pick(pd.colors) }];
    if (pd.type === 'monument') {
      if (rng() < 0.3) return [p, { type: 'monument', decline: true }];
      const o = pick(pd.options);
      return [p, { type: 'monument', at: o.at, monument: pick(o.monuments) }];
    }
    return [p, { type: 'treasure', cell: pick(pd.cells) }];
  }
  const p = s.current, pl = s.players[p];
  for (let attempt = 0; attempt < 20; attempt++) {
    const roll = rng();
    if (roll < 0.5 && pl.hand.length) {
      const color = pick(pl.hand);
      const targets = TE.tileTargets(s.board, color);
      if (targets.length) return [p, { type: 'tile', color, cell: pick(targets) }];
    } else if (roll < 0.8) {
      const color = pick(TE.COLORS);
      const targets = TE.leaderTargets(s, p, color);
      if (targets.length) return [p, { type: 'leader', color, cell: pick(targets) }];
    } else if (roll < 0.85) {
      const on = TE.COLORS.filter(c => pl.leaders[c] !== null);
      if (on.length) return [p, { type: 'withdraw', color: pick(on) }];
    } else if (roll < 0.88 && pl.catastrophes > 0) {
      return [p, { type: 'catastrophe', cell: pick(TE.catastropheTargets(s.board)) }];
    } else if (roll < 0.95 && pl.hand.length) {
      return [p, { type: 'swap', tiles: pl.hand.slice(0, 1 + Math.floor(rng() * pl.hand.length)) }];
    }
  }
  return [p, { type: 'end' }];
}

function checkInvariants(s) {
  const leaderCells = [];
  s.board.forEach((cell, i) => {
    if (!cell) return;
    if (cell.k === 'leader') {
      leaderCells.push(i);
      assert.equal(TE.RIVER[i], false, 'leader on river');
      assert.equal(s.players[cell.p].leaders[cell.c], i, 'leader index mismatch');
      assert.ok(TE.templesAround(s.board, i).length > 0, 'leader without temple');
    } else if (cell.k === 'tile' && !cell.down) {
      assert.equal(cell.c === 'blue', TE.RIVER[i], `tile ${cell.c} on wrong terrain at ${i}`);
    }
    if (cell.tr) assert.equal(cell.c, 'red', 'treasure off a temple');
  });
  s.players.forEach((pl, p) => {
    TE.COLORS.forEach(c => {
      const i = pl.leaders[c];
      if (i !== null) assert.deepEqual(s.board[i], { k: 'leader', c, p });
      assert.ok(Number.isInteger(pl.vp[c]) && pl.vp[c] >= 0);
    });
    assert.ok(pl.hand.length <= 6);
  });
  const taken = s.players.reduce((n, pl) => n + pl.treasures, 0);
  assert.equal(TE.treasuresOnBoard(s.board) + taken, 10, 'treasures conserved');
  if (!s.pending && !s.ctx) {
    for (const g of TE.allGroups(s.board)) {
      const colors = g.leaders.map(i => s.board[i].c);
      assert.equal(new Set(colors).size, colors.length, 'two like-colored leaders in a kingdom');
      const traders = g.leaders.filter(i => s.board[i].c === 'green').length;
      const tr = g.cells.filter(i => s.board[i].tr).length;
      if (traders) assert.ok(tr <= 1, 'uncollected treasures in a kingdom with a trader');
    }
  }
}

test('random playouts: legal moves are accepted, invariants hold, every game ends', () => {
  let games = 0, wars = 0, revolts = 0, monuments = 0, treasures = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const rng = TE.mulberry32(seed * 7919);
    const n = 2 + (seed % 3);
    let s = TE.createGame({ names: Array.from({ length: n }, (_, i) => `P${i}`), rng });
    let steps = 0;
    while (s.phase === 'play') {
      assert.ok(++steps < 5000, `game ${seed} does not end`);
      const [p, a] = randomAction(s, rng);
      assert.equal(TE.awaiting(s), p);
      const r = TE.applyAction(s, p, a);
      assert.ok(r.ok, `seed ${seed} step ${steps}: ${JSON.stringify(a)} rejected: ${r.error} ${r.internal || ''}`);
      if (r.state.pending && r.state.pending.type === 'conflict' && !(s.pending && s.pending.type === 'conflict')) {
        if (r.state.pending.kind === 'war') wars++; else revolts++;
      }
      if (a.type === 'monument' && !a.decline) monuments++;
      if (a.type === 'treasure') treasures++;
      s = r.state;
      checkInvariants(s);
    }
    games++;
    assert.ok(s.result && s.result.winners.length >= 1);
  }
  assert.equal(games, 150);
  assert.ok(wars > 20 && revolts > 20 && monuments > 5 && treasures > 50,
    `coverage: wars ${wars}, revolts ${revolts}, monuments ${monuments}, treasures ${treasures}`);
});

test('skipping: defaultAction always makes progress', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const rng = TE.mulberry32(seed);
    let s = TE.createGame({ names: ['a', 'b', 'c'], rng });
    let steps = 0;
    while (s.phase === 'play' && steps++ < 3000) {
      const useDefault = rng() < 0.3;
      const [p, a] = useDefault ? [TE.awaiting(s), TE.defaultAction(s)] : randomAction(s, rng);
      const r = TE.applyAction(s, p, a);
      assert.ok(r.ok, `${JSON.stringify(a)}: ${r.error}`);
      s = r.state;
    }
    assert.equal(s.phase, 'over');
  }
});
