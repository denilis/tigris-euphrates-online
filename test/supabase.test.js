'use strict';
// Integration with a real Supabase database (a project, `supabase start`, or PostgREST in front of
// Postgres with the migration applied). Skipped unless these are set:
//   TEST_SUPABASE_URL, TEST_SUPABASE_SECRET_KEY — and optionally TEST_SUPABASE_PUBLISHABLE_KEY
// to check that the public key cannot read game data.
// Every room the test creates is deleted at the end.
const test = require('node:test');
const assert = require('node:assert/strict');
const TE = require('../shared/engine');
const { createApi } = require('../lib/api');
const { createSupabaseStore } = require('../lib/store/supabase');

const URL_ = process.env.TEST_SUPABASE_URL;
const SECRET = process.env.TEST_SUPABASE_SECRET_KEY;
const PUBLIC = process.env.TEST_SUPABASE_PUBLISHABLE_KEY;
const skip = !(URL_ && SECRET) && 'TEST_SUPABASE_URL / TEST_SUPABASE_SECRET_KEY are not set';

const quiet = { error() {}, warn() {}, log() {} };

test('supabase: a game through the real store — concurrency, privacy, cleanup of test rooms', { skip }, async () => {
  const store = createSupabaseStore({ url: URL_, key: SECRET });
  const pokes = [];
  const notify = async (code, rev) => { pokes.push(rev); };
  const api = createApi({ store, notify, log: quiet, rng: TE.mulberry32(3) });
  const second = createApi({ store, notify, log: quiet }); // another serverless instance, with its own cache
  const call = async (body, which) => (await (which || api).handle(body, { ip: '192.0.2.44' })).body;
  const codes = [];
  try {
    assert.equal(await store.ping(), true);
    const a = await call({ op: 'create', name: 'Интеграция', maxPlayers: 3 });
    assert.ok(a.ok, a.error);
    codes.push(a.code);
    const joins = await Promise.all(['Б', 'В'].map(name => call({ op: 'join', code: a.code, name }, second)));
    assert.ok(joins.every(j => j.ok), JSON.stringify(joins.map(j => j.error)));
    const seats = [{ code: a.code, token: a.token }].concat(joins.map(j => ({ code: a.code, token: j.token })));
    const started = await call(Object.assign({ op: 'start' }, seats[0]));
    assert.ok(started.ok, started.error);
    assert.equal(started.room.seats.length, 3);
    assert.ok(started.room.seats.every(s => s.online), 'joined seats were recorded as present');

    const cur = seats[started.view.current];
    const results = await Promise.all([api, second, api].map(inst =>
      call(Object.assign({ op: 'action', rev: started.rev, action: { type: 'end' } }, cur), inst)));
    assert.equal(results.filter(r => r.ok).length, 1, 'optimistic concurrency lets exactly one duplicate through');
    assert.ok(results.filter(r => !r.ok).every(r => r.stale));

    const synced = await call(Object.assign({ op: 'sync', since: started.rev }, seats[1]), second);
    assert.equal(synced.rev, started.rev + 1);
    assert.equal(synced.view.turn, started.view.turn + 1);
    const unchanged = await call(Object.assign({ op: 'sync', since: synced.rev }, seats[1]), second);
    assert.equal(unchanged.unchanged, true);

    assert.ok((await call(Object.assign({ op: 'leave' }, seats[2]))).ok);
    const afterLeave = await call(Object.assign({ op: 'sync', since: 0 }, seats[0]));
    assert.equal(afterLeave.room.seats[2].online, false, 'te_away marks the seat offline');
    // Two joins, the start and the one action that won; each announced with a fresh revision.
    assert.deepEqual(pokes, [2, 3, 4, 5], 'every save is announced once, in order');

    if (PUBLIC) {
      const pub = createSupabaseStore({ url: URL_, key: PUBLIC });
      await assert.rejects(pub.sync(a.code, null, 0), /permission denied/, 'the publishable key cannot call te_sync');
      const res = await fetch(`${URL_}/rest/v1/te_rooms?select=data`, { headers: { apikey: PUBLIC, Authorization: `Bearer ${PUBLIC}` } });
      const body = await res.json();
      assert.ok(!Array.isArray(body) || body.length === 0, 'the publishable key reads no rooms');
    }
  } finally {
    for (const code of codes) {
      const r = await store.sync(code, null, 0);
      if (r) await store.remove(code, r.rev);
    }
  }
});
