'use strict';
// HTTP layer: the local server, the Vercel-style handlers and what is (not) served.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createServer } = require('../dev-server');
const { buildRuntime } = require('../lib/runtime');
const { createMemoryStore } = require('../lib/store/memory');
const { createBroadcastNotifier } = require('../lib/store/supabase');
const http = require('../lib/http');

const quiet = { error() {}, warn() {}, log() {} };

function listen(runtime) {
  const { app } = createServer({ runtime: runtime || buildRuntime({}, { store: createMemoryStore(), log: quiet }) });
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

const post = (url, body, headers) => fetch(`${url}/api/game`, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
  body: typeof body === 'string' ? body : JSON.stringify(body)
});

test('http: game API, config, health and cron endpoints', async () => {
  const { server, url } = await listen();
  try {
    const res = await post(url, { op: 'create', name: 'Аня', maxPlayers: 2 });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const created = await res.json();
    assert.ok(created.ok);
    const join = await (await post(url, { op: 'join', code: created.code, name: 'Боря' })).json();
    assert.ok(join.ok);

    assert.equal((await post(url, '{"op":')).status, 400, 'malformed JSON');
    assert.equal((await post(url, JSON.stringify({ op: 'create', name: 'x'.repeat(20000) }))).status, 413, 'oversized body');
    assert.equal((await fetch(`${url}/api/game`)).status, 405, 'GET is not allowed');
    assert.equal((await post(url, { op: 'nope' })).status, 400);

    const cfg = await (await fetch(`${url}/api/config`)).json();
    assert.deepEqual(cfg, { ok: true, realtime: null, heartbeatMs: 15000, pollMs: 2500 });
    const health = await (await fetch(`${url}/api/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.store, 'memory');
    const cron = await (await fetch(`${url}/api/cron`)).json();
    assert.deepEqual(cron, { ok: true, deleted: 0 });
  } finally { server.close(); }
});

test('http: static files come from public/ only', async () => {
  const { server, url } = await listen();
  try {
    for (const path of ['/', '/engine.js', '/vendor/supabase.js', '/js/app.js', '/css/game.css']) {
      assert.equal((await fetch(`${url}${path}`)).status, 200, path);
    }
    const secrets = ['/dev-server.js', '/server.js', '/package.json', '/lib/api.js', '/api/../lib/runtime.js', '/.git/config',
      '/supabase/migrations/20260926060000_te_rooms.sql', '/node_modules/express/package.json', '/.env'];
    for (const path of secrets) assert.equal((await fetch(`${url}${path}`)).status, 404, path);
  } finally { server.close(); }
});

test('http: cron requires the CRON_SECRET bearer token when one is set', async () => {
  const rt = buildRuntime({ CRON_SECRET: 's3cret' }, { store: createMemoryStore(), log: quiet });
  const { server, url } = await listen(rt);
  try {
    assert.equal((await fetch(`${url}/api/cron`)).status, 401);
    assert.equal((await fetch(`${url}/api/cron`, { headers: { Authorization: 'Bearer wrong!' } })).status, 401);
    assert.equal((await fetch(`${url}/api/cron`, { headers: { Authorization: 'Bearer s3cret' } })).status, 200);
  } finally { server.close(); }
});

// A minimal stand-in for the (req, res) pair Vercel passes to a function.
function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: '' };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.end = s => { res.body = s; };
  return res;
}
function fakeReq(method, body, headers) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  req.method = method;
  req.headers = headers || {};
  req.socket = { remoteAddress: '10.0.0.1' };
  return req;
}

test('http: Vercel handlers accept pre-parsed, string and streamed bodies', async () => {
  const rt = buildRuntime({}, { store: createMemoryStore(), log: quiet });
  for (const shape of ['object', 'string', 'buffer', 'stream']) {
    const payload = { op: 'create', name: shape };
    const req = fakeReq('POST', shape === 'stream' ? JSON.stringify(payload) : undefined, { 'x-forwarded-for': '198.51.100.9, 10.0.0.1' });
    if (shape === 'object') req.body = payload;
    if (shape === 'string') req.body = JSON.stringify(payload);
    if (shape === 'buffer') req.body = Buffer.from(JSON.stringify(payload));
    const res = fakeRes();
    await http.game(rt, req, res);
    assert.equal(res.statusCode, 200, shape);
    assert.equal(JSON.parse(res.body).room.seats[0].name, shape);
  }
  const broken = fakeReq('POST');
  Object.defineProperty(broken, 'body', { get() { throw new Error('Invalid JSON'); } });
  const res = fakeRes();
  await http.game(rt, broken, res);
  assert.equal(res.statusCode, 400);
  assert.equal(http.clientIp(fakeReq('GET', undefined, { 'x-forwarded-for': '198.51.100.9, 10.0.0.1' })), '198.51.100.9');
});

test('http: a Vercel deployment without Supabase variables says so instead of losing games', async () => {
  const rt = buildRuntime({ VERCEL: '1' });
  assert.match(rt.error, /SUPABASE_URL/);
  const res = fakeRes();
  await http.game(rt, fakeReq('POST', '{"op":"create"}'), res);
  assert.equal(res.statusCode, 503);
  assert.match(JSON.parse(res.body).error, /не настроен/);
  const health = fakeRes();
  await http.health(rt, fakeReq('GET'), health);
  assert.equal(health.statusCode, 503);
});

test('http: runtime reads the variable names of a manual setup and of the Vercel integration', () => {
  const manual = buildRuntime({ SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_SECRET_KEY: 'sb_secret_x', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' });
  assert.equal(manual.storeKind, 'supabase');
  assert.deepEqual(manual.publicConfig.realtime, { url: 'https://x.supabase.co', key: 'sb_publishable_x' });
  const integration = buildRuntime({
    NEXT_PUBLIC_SUPABASE_URL: 'https://y.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'jwt', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon'
  });
  assert.equal(integration.storeKind, 'supabase');
  assert.deepEqual(integration.publicConfig.realtime, { url: 'https://y.supabase.co', key: 'anon' });
  const noPublic = buildRuntime({ SUPABASE_URL: 'https://z.supabase.co', SUPABASE_SECRET_KEY: 's' });
  assert.equal(noPublic.publicConfig.realtime, null, 'without a publishable key pages fall back to polling');
  assert.equal(JSON.stringify(manual.publicConfig).includes('sb_secret'), false, 'the secret key never reaches the page');
});

test('http: Realtime notifier posts the revision to the broadcast endpoint and swallows failures', async () => {
  const calls = [];
  const notify = createBroadcastNotifier({
    url: 'https://ref.supabase.co/',
    key: 'sb_secret_k',
    log: quiet,
    fetch: async (u, opts) => { calls.push({ u, opts }); return { ok: true, status: 202 }; }
  });
  await notify('ABC123', 7);
  assert.equal(calls[0].u, 'https://ref.supabase.co/realtime/v1/api/broadcast');
  assert.equal(calls[0].opts.headers.apikey, 'sb_secret_k');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { messages: [{ topic: 'te:ABC123', event: 'update', payload: { rev: 7 } }] });

  const failing = createBroadcastNotifier({ url: 'https://ref.supabase.co', key: 'k', log: quiet, fetch: async () => { throw new Error('down'); } });
  await failing('ABC123', 8); // must not throw: the pages catch up by polling
  const slow = createBroadcastNotifier({
    url: 'https://ref.supabase.co', key: 'k', log: quiet, timeoutMs: 50,
    fetch: (u, opts) => new Promise((resolve, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
  });
  await slow('ABC123', 9);
});
