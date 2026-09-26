'use strict';
// Game API over the in-memory store: lobby, privacy, concurrency, presence and skipping, limits.
const test = require('node:test');
const assert = require('node:assert/strict');
const TE = require('../shared/engine');
const { createApi } = require('../lib/api');
const { createMemoryStore } = require('../lib/store/memory');

const quiet = { error() {}, warn() {}, log() {} };

function setup(extra) {
  let t = Date.UTC(2026, 0, 1);
  const clock = () => t;
  const store = createMemoryStore({ now: clock });
  const pokes = [];
  const api = createApi(Object.assign({
    store,
    now: clock,
    log: quiet,
    rng: TE.mulberry32(11),
    notify: async (code, rev) => { pokes.push({ code, rev }); }
  }, extra));
  const call = async (body, ip) => (await api.handle(body, { ip: ip || '203.0.113.7' })).body;
  const status = async (body, ip) => (await api.handle(body, { ip: ip || '203.0.113.7' })).status;
  return { api, store, pokes, call, status, advance: ms => { t += ms; }, clock };
}

// Seats a room of n players and starts the game. Returns per-seat sessions.
async function game(env, n) {
  const a = await env.call({ op: 'create', name: 'Аня', maxPlayers: n || 2 });
  assert.ok(a.ok, a.error);
  const seats = [{ code: a.code, token: a.token }];
  for (let i = 1; i < (n || 2); i++) {
    const j = await env.call({ op: 'join', code: a.code.toLowerCase(), name: `Игрок${i}` });
    assert.ok(j.ok, j.error);
    seats.push({ code: j.code, token: j.token });
  }
  const started = await env.call(Object.assign({ op: 'start' }, seats[0]));
  assert.ok(started.ok, started.error);
  return { code: a.code, seats, rev: started.rev };
}

const as = (seat, body) => Object.assign({}, seat, body);
const stored = (env, code) => env.store.rooms.get(code);

test('api: lobby flow, private views, hashed tokens', async () => {
  const env = setup();
  const created = await env.call({ op: 'create', name: '  Аня  ', maxPlayers: 3 });
  assert.ok(created.ok);
  assert.match(created.code, /^[A-Z0-9]{6}$/);
  assert.match(created.token, /^[a-f0-9]{32}$/);
  assert.equal(created.rev, 1);
  assert.equal(created.view, null);
  assert.deepEqual(created.room.seats, [{ name: 'Аня', dynasty: 'lion', online: true, offlineSince: null }]);

  const joined = await env.call({ op: 'join', code: created.code, name: 'аня' });
  assert.ok(joined.ok);
  assert.equal(joined.room.you, 1);
  assert.equal(joined.room.seats[1].name, 'аня 2', 'names are unique within a room');
  assert.equal(joined.room.seats[1].dynasty, 'bow');

  const raw = JSON.stringify(stored(env, created.code).data);
  assert.equal(raw.includes(created.token), false, 'plain tokens are never stored');
  assert.equal(JSON.stringify(joined).includes('tokenHash'), false, 'token hashes never leave the server');

  const b = { code: created.code, token: joined.token };
  const taken = await env.call(as(b, { op: 'dynasty', dynasty: 'lion' }));
  assert.equal(taken.ok, false);
  const picked = await env.call(as(b, { op: 'dynasty', dynasty: 'bull' }));
  assert.ok(picked.ok);
  assert.equal(picked.room.seats[1].dynasty, 'bull');

  const notHost = await env.call(as(b, { op: 'start' }));
  assert.equal(notHost.ok, false);
  assert.match(notHost.error, /создатель/);

  const a = { code: created.code, token: created.token };
  const started = await env.call(as(a, { op: 'start' }));
  assert.ok(started.ok, started.error);
  assert.equal(started.view.you, 0);
  assert.equal(started.view.hand.length, 6);
  assert.equal(started.view.players[1].vp, undefined, 'opponent score is hidden');
  assert.equal(started.view.players[1].hand, undefined, 'opponent hand is hidden');
  assert.deepEqual(started.view.players.map(p => p.dynasty), ['lion', 'bull']);

  const late = await env.call({ op: 'join', code: created.code, name: 'Вера' });
  assert.equal(late.ok, false);
  assert.match(late.error, /уже идёт/);
  assert.equal(env.pokes.at(-1).rev, started.rev, 'every save is announced with its revision');
});

test('api: actions are authoritative, stale revisions are refused', async () => {
  const env = setup();
  const g = await game(env, 2);
  const view = (await env.call(as(g.seats[0], { op: 'sync', since: 0 }))).view;
  const cur = g.seats[view.current], other = g.seats[1 - view.current];
  const hand = (await env.call(as(cur, { op: 'sync', since: 0 }))).view.hand;
  const color = hand.find(c => c !== 'blue') || 'blue';
  const cell = TE.tileTargets(view.board, color)[0];

  const wrong = await env.call(as(other, { op: 'action', rev: g.rev, action: { type: 'tile', color, cell } }));
  assert.equal(wrong.ok, false);
  assert.match(wrong.error, /не ваш ход/);

  const done = await env.call(as(cur, { op: 'action', rev: g.rev, action: { type: 'tile', color, cell } }));
  assert.ok(done.ok, done.error);
  assert.equal(done.rev, g.rev + 1);
  assert.equal(done.view.board[cell].c, color);

  const again = await env.call(as(cur, { op: 'action', rev: g.rev, action: { type: 'end' } }));
  assert.equal(again.ok, false);
  assert.equal(again.stale, true, 'an action based on an old screen is refused');
  assert.equal(await env.status(as(cur, { op: 'action', rev: g.rev, action: { type: 'end' } })), 409);

  const seen = await env.call(as(other, { op: 'sync', since: g.rev }));
  assert.equal(seen.view.board[cell].c, color, 'the other player gets the change');
  const same = await env.call(as(other, { op: 'sync', since: done.rev }));
  assert.equal(same.unchanged, true);
  assert.equal(same.view, undefined, 'an up-to-date page gets no view again');
});

test('api: concurrent requests — one action wins, parallel joins all get seats', async () => {
  const env = setup();
  const g = await game(env, 2);
  const s = stored(env, g.code).data.game;
  const cur = g.seats[s.current];
  const results = await Promise.all([1, 2, 3].map(() => env.call(as(cur, { op: 'action', rev: g.rev, action: { type: 'end' } }))));
  assert.equal(results.filter(r => r.ok).length, 1, 'exactly one of the duplicate submissions applies');
  assert.ok(results.filter(r => !r.ok).every(r => r.stale));
  assert.equal(stored(env, g.code).data.game.turn, s.turn + 1);

  const room = await env.call({ op: 'create', name: 'Хост', maxPlayers: 4 });
  const joins = await Promise.all(['Б', 'В', 'Г'].map(name => env.call({ op: 'join', code: room.code, name })));
  assert.ok(joins.every(j => j.ok), JSON.stringify(joins.map(j => j.error)));
  assert.deepEqual(new Set(joins.map(j => j.room.you)), new Set([1, 2, 3]));
  const full = await env.call({ op: 'join', code: room.code, name: 'Д' });
  assert.match(full.error, /заполнена/);
});

test('api: presence, offline status and skipping an absent player', async () => {
  const env = setup();
  const g = await game(env, 2);
  const s = stored(env, g.code).data.game;
  const active = g.seats[s.current], idle = g.seats[1 - s.current];
  const activeSeat = s.current;

  env.advance(30 * 1000);
  let st = await env.call(as(idle, { op: 'sync', since: 0 }));
  assert.equal(st.room.seats[activeSeat].online, true);
  const early = await env.call(as(idle, { op: 'skip', rev: st.rev }));
  assert.match(early.error, /в сети/);

  env.advance(20 * 1000); // 50 s of silence
  st = await env.call(as(idle, { op: 'sync', since: 0 }));
  assert.equal(st.room.seats[activeSeat].online, false);
  assert.equal(typeof st.room.seats[activeSeat].offlineSince, 'number');
  const wait = await env.call(as(idle, { op: 'skip', rev: st.rev }));
  assert.match(wait.error, /Подождите/);

  env.advance(30 * 1000); // 80 s > skipAfterMs
  const skipped = await env.call(as(idle, { op: 'skip', rev: st.rev }));
  assert.ok(skipped.ok, skipped.error);
  assert.equal(skipped.view.turn, s.turn + 1);
  assert.equal(skipped.view.current, skipped.view.you, 'the turn moved to the player who stayed');

  const back = await env.call(as(active, { op: 'sync', since: 0 }));
  assert.equal(back.room.seats[activeSeat].online, true, 'polling again brings the seat back online');
});

test('api: leaving — lobby seats are freed, game seats are kept and shown offline', async () => {
  const env = setup();
  const host = await env.call({ op: 'create', name: 'Хост', maxPlayers: 3 });
  const guest = await env.call({ op: 'join', code: host.code, name: 'Гость' });
  const h = { code: host.code, token: host.token }, gs = { code: host.code, token: guest.token };
  assert.ok((await env.call(as(h, { op: 'leave' }))).ok);
  const after = await env.call(as(gs, { op: 'sync', since: 0 }));
  assert.equal(after.room.seats.length, 1);
  assert.equal(after.room.host, 0, 'the host role moves on');
  assert.equal((await env.call(as(h, { op: 'sync', since: 0 }))).gone, true);
  const alone = await env.call(as(gs, { op: 'start' }));
  assert.match(alone.error, /минимум 2/);
  assert.ok((await env.call(as(gs, { op: 'leave' }))).ok);
  assert.equal(env.store.rooms.has(host.code), false, 'an empty lobby is deleted');

  const g = await game(env, 2);
  assert.ok((await env.call(as(g.seats[1], { op: 'leave' }))).ok);
  const view = await env.call(as(g.seats[0], { op: 'sync', since: 0 }));
  assert.equal(view.room.seats[1].online, false, 'a player who left a game shows offline at once');
  const back = await env.call(as(g.seats[1], { op: 'sync', since: 0 }));
  assert.ok(back.ok, 'the seat is kept for a return');
  assert.equal(back.view.you, 1);
});

test('api: a full game through the API, then a rematch', async () => {
  const env = setup();
  const g = await game(env, 3);
  const rng = TE.mulberry32(5);
  let requests = 0, rev = g.rev;
  for (let k = 0; k < 4000; k++) {
    const s = stored(env, g.code).data.game;
    if (s.phase !== 'play') break;
    const p = TE.awaiting(s);
    let action = TE.defaultAction(s);
    if (!s.pending && s.players[p].hand.length && rng() < 0.85) {
      const color = s.players[p].hand[Math.floor(rng() * s.players[p].hand.length)];
      const cells = TE.tileTargets(s.board, color);
      if (cells.length) action = { type: 'tile', color, cell: cells[Math.floor(rng() * cells.length)] };
    }
    let res = await env.call(as(g.seats[p], { op: 'action', rev, action }));
    if (!res.ok) res = await env.call(as(g.seats[p], { op: 'action', rev, action: TE.defaultAction(s) }));
    assert.ok(res.ok, res.error);
    rev = res.rev;
    requests++;
  }
  const end = await env.call(as(g.seats[0], { op: 'sync', since: 0 }));
  assert.equal(end.view.phase, 'over', `game finished after ${requests} actions`);
  assert.ok(end.view.result.ranking.length === 3);
  assert.equal(end.view.players[1].vp !== undefined, true, 'scores are revealed at the end');

  const again = await env.call(as(g.seats[2], { op: 'rematch', rev: end.rev }));
  assert.ok(again.ok, again.error);
  assert.equal(again.view.phase, 'play');
  assert.notEqual(again.view.id, end.view.id);
  const twice = await env.call(as(g.seats[1], { op: 'rematch', rev: end.rev }));
  assert.equal(twice.stale, true, 'a second rematch click does not restart the new game');
});

test('api: two server instances share one store', async () => {
  const env = setup();
  const other = createApi({ store: env.store, now: env.clock, log: quiet });
  const g = await game(env, 2);
  const s = stored(env, g.code).data.game;
  const cur = g.seats[s.current];
  const viaB = await other.handle(as(cur, { op: 'action', rev: g.rev, action: { type: 'end' } }), {});
  assert.ok(viaB.body.ok, viaB.body.error);
  const viaA = await env.call(as(g.seats[1 - s.current], { op: 'sync', since: g.rev }));
  assert.equal(viaA.rev, g.rev + 1, 'the first instance notices the newer revision despite its cache');
  assert.equal(viaA.view.turn, s.turn + 1);

  // The code is reused by a brand-new room while instance A still caches the old one.
  const row = stored(env, g.code);
  env.store.rooms.set(g.code, Object.assign({}, row, { rev: 1, data: Object.assign({}, row.data, { maxPlayers: 4 }) }));
  const fresh = await env.call(as(g.seats[0], { op: 'sync', since: 0 }));
  assert.equal(fresh.rev, 1);
  assert.equal(fresh.room.maxPlayers, 4);
});

test('api: hostile input never crashes and is answered with an error', async () => {
  const env = setup();
  const g = await game(env, 2);
  const junk = [
    null, 42, 'x', [], {}, { op: '__proto__' }, { op: 'constructor' }, { op: 'sync' },
    { op: 'sync', code: g.code, token: 'nope' },
    { op: 'sync', code: g.code, token: 'f'.repeat(32) },
    { op: 'join', code: '../../etc' }, { op: 'join', code: 'ZZZZZZ' },
    as(g.seats[0], { op: 'action', action: null }),
    as(g.seats[0], { op: 'action', action: [] }),
    as(g.seats[0], { op: 'action', action: { type: 'leader', color: 'red', cell: 99999 } }),
    as(g.seats[0], { op: 'action', action: { type: 'withdraw', color: '__proto__' } }),
    as(g.seats[0], { op: 'action', action: { type: 'swap', tiles: { length: 1e9 } } }),
    as(g.seats[0], { op: 'action', action: { type: 'commit', count: -1 } }),
    as(g.seats[0], { op: 'dynasty', dynasty: 'lion' }),
    as(g.seats[0], { op: 'rematch' })
  ];
  for (const body of junk) {
    const res = await env.api.handle(body, {});
    assert.equal(res.body.ok, false, JSON.stringify(body));
    assert.ok(res.status >= 400 && res.status < 500, `${res.status} for ${JSON.stringify(body)}`);
    assert.equal(typeof res.body.error, 'string');
  }
  const gone = await env.call({ op: 'sync', code: g.code, token: 'f'.repeat(32) });
  assert.equal(gone.gone, true, 'an unknown seat tells the page to drop its session');
  const xss = await env.call({ op: 'create', name: '<img src=x onerror=alert(1)>' });
  assert.ok(xss.ok);
  assert.equal(xss.room.seats[0].name.includes('<'), false);
});

test('api: room creation is limited per address; abandoned rooms are purged', async () => {
  const env = setup();
  for (let i = 0; i < 10; i++) assert.ok((await env.call({ op: 'create', name: 'A' }, '198.51.100.1')).ok);
  const limited = await env.call({ op: 'create', name: 'A' }, '198.51.100.1');
  assert.equal(limited.ok, false);
  assert.equal(await env.status({ op: 'create', name: 'A' }, '198.51.100.1'), 429);
  assert.ok((await env.call({ op: 'create', name: 'B' }, '198.51.100.2')).ok, 'other addresses are not affected');
  env.advance(11 * 60 * 1000);
  assert.ok((await env.call({ op: 'create', name: 'A' }, '198.51.100.1')).ok, 'the limit is per 10 minutes');

  const g = await game(env, 2);
  env.advance(7 * 3600 * 1000);
  const deleted = await env.api.cleanup();
  assert.equal(deleted, 12, 'idle lobbies go after 6 hours');
  assert.ok(env.store.rooms.has(g.code), 'a game in progress is kept');
  env.advance(15 * 24 * 3600 * 1000);
  assert.equal(await env.api.cleanup(), 1, 'anything idle for two weeks goes');
});
