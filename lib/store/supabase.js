'use strict';
// Room store on Supabase Postgres. All access goes through the te_* SQL functions
// (supabase/migrations), called with the secret key over PostgREST.
const { createClient } = require('@supabase/supabase-js');

class StoreError extends Error {
  constructor(fn, error) {
    super(`${fn}: ${error && error.message ? error.message : 'unknown database error'}`);
    this.cause = error;
  }
}

// A database call that hangs must fail well before the function's own time limit (vercel.json: 10 s).
const DB_TIMEOUT_MS = 6000;

function createSupabaseStore({ url, key, fetch: fetchImpl, timeoutMs }) {
  const base = fetchImpl || fetch;
  const limit = timeoutMs || DB_TIMEOUT_MS;
  const timedFetch = (input, init) => base(input, Object.assign({}, init, {
    signal: init && init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(limit)]) : AbortSignal.timeout(limit)
  }));
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: timedFetch }
  });

  async function call(fn, args) {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new StoreError(fn, error);
    return data;
  }

  // bigint columns come back as numbers or, from some PostgREST versions, as strings.
  const num = v => (v === null || v === undefined ? null : Number(v));

  return {
    kind: 'supabase',

    async sync(code, tokenHash, have) {
      const r = await call('te_sync', { p_code: code, p_token_hash: tokenHash || null, p_have: have || 0 });
      if (!r) return null;
      const seen = {};
      for (const [k, v] of Object.entries(r.seen || {})) seen[k] = Number(v);
      return { rev: num(r.rev), seated: !!r.seated, now: num(r.now), seen, data: r.data || null };
    },

    create(code, data, tokenHash, creator, limit, windowMs) {
      return call('te_create', {
        p_code: code, p_data: data, p_token_hash: tokenHash, p_creator: creator || null,
        p_limit: limit || 0, p_window_s: Math.ceil((windowMs || 0) / 1000)
      });
    },

    async save(code, rev, data, phase, tokenHash) {
      return num(await call('te_save', { p_code: code, p_rev: rev, p_data: data, p_phase: phase, p_token_hash: tokenHash || null }));
    },

    async remove(code, rev) {
      return !!(await call('te_delete', { p_code: code, p_rev: rev }));
    },

    async away(code, tokenHash, offlineMs) {
      await call('te_away', { p_code: code, p_token_hash: tokenHash, p_offline_s: Math.ceil(offlineMs / 1000) });
    },

    async cleanup() {
      return num(await call('te_cleanup', {})) || 0;
    },

    // A cheap round trip that also checks the migration is in place.
    async ping() {
      await call('te_sync', { p_code: 'AAAAAA', p_token_hash: null, p_have: 0 });
      return true;
    }
  };
}

// Tells the pages in a room that it changed; they then fetch their own (private) view.
// Carries only the revision number, so it is safe on a public channel.
function createBroadcastNotifier({ url, key, fetch: fetchImpl, timeoutMs, log }) {
  const doFetch = fetchImpl || fetch;
  const endpoint = `${url.replace(/\/+$/, '')}/realtime/v1/api/broadcast`;
  return async function notify(code, rev) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 2500);
    try {
      const res = await doFetch(endpoint, {
        method: 'POST',
        headers: { apikey: key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ topic: `te:${code}`, event: 'update', payload: { rev } }] }),
        signal: ctrl.signal
      });
      if (!res.ok && log) log.warn(`realtime broadcast failed: HTTP ${res.status}`);
    } catch (e) {
      // Pages still catch up on their next poll, so a lost notification only costs a few seconds.
      if (log) log.warn(`realtime broadcast failed: ${e.name === 'AbortError' ? 'timeout' : e.message}`);
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = { createSupabaseStore, createBroadcastNotifier, StoreError };
