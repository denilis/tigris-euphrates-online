'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createApp } = require('../server');
const TE = require('../shared/engine');

const SKIP_MS = 150;

function startServer() {
  const app = createApp({ skipAfterMs: SKIP_MS, sweepMs: 1000 });
  return new Promise(resolve => {
    app.server.listen(0, () => resolve(Object.assign(app, { url: `http://localhost:${app.server.address().port}` })));
  });
}

// Client wrapper: remembers the latest `state` event and lets tests await the next one.
function client(url) {
  const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  const c = { socket, state: null, waiters: [] };
  socket.on('state', st => {
    c.state = st;
    c.waiters.splice(0).forEach(fn => fn(st));
  });
  c.emit = (event, payload) => new Promise(resolve => socket.emit(event, payload, resolve));
  c.next = () => new Promise(resolve => c.waiters.push(resolve));
  c.ready = () => new Promise(resolve => (socket.connected ? resolve() : socket.once('connect', resolve)));
  return c;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, what) {
  for (let k = 0; k < 100; k++) {
    if (fn()) return;
    await sleep(20);
  }
  assert.fail(`timeout waiting for ${what}`);
}

async function twoPlayerGame(srv) {
  const a = client(srv.url), b = client(srv.url);
  await Promise.all([a.ready(), b.ready()]);
  const created = await a.emit('room:create', { name: 'Аня', maxPlayers: 2 });
  assert.ok(created.ok);
  const joined = await b.emit('room:join', { name: 'Борис', code: created.code.toLowerCase() });
  assert.ok(joined.ok, joined.error);
  const started = await a.emit('room:start', {});
  assert.ok(started.ok, started.error);
  await waitFor(() => a.state && a.state.view && b.state && b.state.view, 'game views');
  return { a, b, code: created.code, tokenA: created.token, tokenB: joined.token };
}

test('server: full lobby flow, private views and authoritative actions', async () => {
  const srv = await startServer();
  try {
    const { a, b } = await twoPlayerGame(srv);
    const va = a.state.view, vb = b.state.view;
    assert.equal(va.you, 0);
    assert.equal(vb.you, 1);
    assert.equal(va.hand.length, 6);
    assert.equal(va.players[1].vp, undefined, 'opponent score is hidden');
    assert.equal(va.players[1].hand, undefined, 'opponent hand is hidden');
    assert.deepEqual(a.state.room.seats.map(s => s.dynasty), ['lion', 'bow']);

    const cur = va.current === 0 ? a : b;
    const other = cur === a ? b : a;
    const color = cur.state.view.hand.find(c => c !== 'blue') || 'blue';
    const target = TE.tileTargets(cur.state.view.board, color)[0];
    const bad = await other.emit('game:action', { type: 'tile', color, cell: target });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /не ваш ход/);
    const good = await cur.emit('game:action', { type: 'tile', color, cell: target });
    assert.ok(good.ok, good.error);
    await waitFor(() => other.state.view.board[target], 'broadcast');
    assert.equal(other.state.view.board[target].c, color);

    const late = client(srv.url);
    await late.ready();
    const denied = await late.emit('room:join', { name: 'Вера', code: a.state.room.code });
    assert.equal(denied.ok, false);
    assert.match(denied.error, /уже идёт/);
    late.socket.close();
    a.socket.close(); b.socket.close();
  } finally { srv.close(); }
});

test('server: malformed and hostile messages never crash the server', async () => {
  const srv = await startServer();
  try {
    const { a, b } = await twoPlayerGame(srv);
    const junk = [
      null, 42, 'x', [], {}, { type: 'leader', color: 'red', cell: 99999 },
      { type: 'withdraw', color: '__proto__' }, { type: 'swap', tiles: { length: 1e9 } },
      { type: 'commit', count: -1 }, { type: 'tile', color: 'red', cell: { toString: 1 } }
    ];
    for (const j of junk) {
      a.socket.emit('game:action', j);
      a.socket.emit('game:action', j, 'not a function');
      b.socket.emit('room:join', j);
      b.socket.emit('room:rejoin', j);
      b.socket.emit('room:dynasty', j);
    }
    a.socket.emit('room:create');
    await sleep(200);
    const probe = client(srv.url);
    await probe.ready();
    const res = await probe.emit('room:create', { name: '<img src=x onerror=alert(1)>' });
    assert.ok(res.ok, 'server is alive');
    await waitFor(() => probe.state, 'probe state');
    assert.equal(probe.state.room.seats[0].name.includes('<'), false, 'angle brackets stripped from names');
    probe.socket.close(); a.socket.close(); b.socket.close();
  } finally { srv.close(); }
});

test('server: a reloaded page rejoins its seat with the token', async () => {
  const srv = await startServer();
  try {
    const { a, b, code, tokenB } = await twoPlayerGame(srv);
    const handBefore = b.state.view.hand.slice();
    b.socket.close();
    await waitFor(() => a.state.room.seats[1].online === false, 'offline status');
    const b2 = client(srv.url);
    await b2.ready();
    const wrong = await b2.emit('room:rejoin', { code, token: 'f'.repeat(32) });
    assert.equal(wrong.ok, false);
    const res = await b2.emit('room:rejoin', { code, token: tokenB });
    assert.ok(res.ok, res.error);
    await waitFor(() => b2.state && b2.state.view, 'rejoined view');
    assert.equal(b2.state.view.you, 1);
    assert.deepEqual(b2.state.view.hand, handBefore);
    await waitFor(() => a.state.room.seats[1].online === true, 'online status');

    // Opening the game in a second tab takes the seat over and kicks the first one.
    const b3 = client(srv.url);
    await b3.ready();
    let kicked = false;
    b2.socket.on('kicked', () => { kicked = true; });
    const again = await b3.emit('room:rejoin', { code, token: tokenB });
    assert.ok(again.ok);
    await waitFor(() => kicked, 'kick of the old tab');
    await waitFor(() => b3.state && b3.state.view, 'second tab view');
    assert.equal(a.state.room.seats[1].online, true);
    b3.socket.close(); a.socket.close();
  } finally { srv.close(); }
});

test('server: decisions of an offline player can be skipped after a grace period', async () => {
  const srv = await startServer();
  try {
    const { a, b } = await twoPlayerGame(srv);
    const [active, idle] = a.state.view.current === 0 ? [a, b] : [b, a];
    active.socket.close();
    await waitFor(() => idle.state.room.seats.some(s => !s.online), 'offline status');
    const early = await idle.emit('game:skip', {});
    assert.equal(early.ok, false);
    await sleep(SKIP_MS + 50);
    const turnBefore = idle.state.view.turn;
    const res = await idle.emit('game:skip', {});
    assert.ok(res.ok, res.error);
    await waitFor(() => idle.state.view.turn === turnBefore + 1, 'turn advanced');
    assert.equal(idle.state.view.current, idle.state.view.you);
    const notNeeded = await idle.emit('game:skip', {});
    assert.equal(notNeeded.ok, false);
    idle.socket.close();
  } finally { srv.close(); }
});

test('server: lobby — dynasty choice, host-only start, leaving', async () => {
  const srv = await startServer();
  try {
    const a = client(srv.url), b = client(srv.url);
    await Promise.all([a.ready(), b.ready()]);
    const { code } = await a.emit('room:create', { name: 'Аня', maxPlayers: 3 });
    await b.emit('room:join', { name: 'аня', code });
    await waitFor(() => a.state && a.state.room.seats.length === 2, 'second seat');
    assert.equal(a.state.room.seats[1].name, 'аня 2', 'names are unique in a room');
    const taken = await b.emit('room:dynasty', { dynasty: 'lion' });
    assert.equal(taken.ok, false);
    const picked = await b.emit('room:dynasty', { dynasty: 'bull' });
    assert.ok(picked.ok);
    await waitFor(() => a.state.room.seats[1].dynasty === 'bull', 'dynasty update');
    const notHost = await b.emit('room:start', {});
    assert.equal(notHost.ok, false);
    await a.emit('room:leave', {});
    await waitFor(() => b.state.room.seats.length === 1 && b.state.room.host === 0, 'host handed over');
    const alone = await b.emit('room:start', {});
    assert.equal(alone.ok, false);
    assert.match(alone.error, /минимум 2/);
    a.socket.close(); b.socket.close();
  } finally { srv.close(); }
});

test('server: static files are served from public/ only', async () => {
  const srv = await startServer();
  try {
    const page = await fetch(`${srv.url}/`);
    assert.equal(page.status, 200);
    const engine = await fetch(`${srv.url}/engine.js`);
    assert.equal(engine.status, 200);
    for (const secret of ['/server.js', '/package.json', '/node_modules/express/package.json', '/.git/config']) {
      const res = await fetch(`${srv.url}${secret}`);
      assert.equal(res.status, 404, secret);
    }
  } finally { srv.close(); }
});
