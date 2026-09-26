'use strict';
// Builds the API from environment variables once per process (one serverless instance or `npm start`).
const crypto = require('crypto');
const { createApi } = require('./api');
const { createMemoryStore } = require('./store/memory');

// Names used by a manual setup and by the Supabase ↔ Vercel integration; the first one set wins.
const ENV = {
  url: ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'],
  secret: ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
  publishable: [
    'SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'
  ]
};

// Pages poll this often while a Realtime subscription delivers changes, and this often without one.
const HEARTBEAT_MS = 15 * 1000;
const POLL_MS = 2500;

function pick(env, names) {
  for (const n of names) {
    const v = typeof env[n] === 'string' ? env[n].trim() : '';
    if (v) return v;
  }
  return '';
}

function readEnv(env) {
  const url = pick(env, ENV.url).replace(/\/+$/, '');
  return {
    url,
    secret: pick(env, ENV.secret),
    publishable: pick(env, ENV.publishable),
    onVercel: !!env.VERCEL,
    cronSecret: pick(env, ['CRON_SECRET'])
  };
}

// { api, publicConfig, storeKind, cronSecret } or { error } when a deployment is misconfigured.
function buildRuntime(env, overrides) {
  const e = readEnv(env || process.env);
  const o = overrides || {};
  let store, notify, ipKey;

  if (o.store) {
    store = o.store;
    notify = o.notify;
  } else if (e.url && e.secret) {
    // Loaded lazily: local games without a database do not need the Supabase client at all.
    const { createSupabaseStore, createBroadcastNotifier } = require('./store/supabase');
    store = createSupabaseStore({ url: e.url, key: e.secret });
    notify = createBroadcastNotifier({ url: e.url, key: e.secret, log: console });
    ipKey = crypto.createHash('sha256').update(`te-ip:${e.secret}`).digest();
  } else if (e.onVercel) {
    // Serverless instances do not share memory: without a database every request would see a different game.
    return {
      error: 'Сервер не настроен: задайте SUPABASE_URL и SUPABASE_SECRET_KEY в настройках проекта Vercel и сделайте Redeploy',
      storeKind: 'none'
    };
  } else {
    store = createMemoryStore();
  }

  const api = createApi({ store, notify, ipKey, config: o.config, rng: o.rng, log: o.log });
  const realtime = !o.store && e.url && e.secret && e.publishable ? { url: e.url, key: e.publishable } : null;
  return {
    api,
    storeKind: store.kind,
    cronSecret: e.cronSecret,
    publicConfig: {
      ok: true,
      realtime,
      heartbeatMs: HEARTBEAT_MS,
      pollMs: POLL_MS
    }
  };
}

let shared = null;
function getRuntime() {
  if (!shared) shared = buildRuntime(process.env);
  return shared;
}

module.exports = { buildRuntime, getRuntime, readEnv, HEARTBEAT_MS, POLL_MS };
